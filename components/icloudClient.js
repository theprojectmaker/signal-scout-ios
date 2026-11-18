// iCloud Remote — talks to the SAME CloudKit public database two ways:
//   • NATIVE (preferred): the built-in native module, as the device's iCloud account (_icloud).
//     No token, no sign-in; uses ckdatabasews.icloud.com (confirmed reachable on the work network).
//   • WEB fallback: CloudKit Web Services over HTTPS (api.apple-cloudkit.com). Reads use the API
//     token (World = read); writes need a one-time Apple sign-in (World write is forbidden).
// The PC runs icloud-agent.js at home and does the reverse. Which path is used is automatic.
//
//   RCCmd   : room(String) seq(Int64) kind(String) x/y/dx/dy(Double) text(String) ts(Int64)
//   RCFrame : room(String) seq(Int64) jpeg(String base64) w(Int64) h(Int64) ts(Int64)

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FRAME_CACHE = 'icloud_last_frame_v1';   // the last screen, so a reopen shows it instantly
import Constants from 'expo-constants';
import { hasNativeCK, nativePut, nativeGet } from './icloudNative';

const RC = (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.rc) || {};
const CFG_KEY = 'icloud_remote_cfg_v1';
const LOG_KEY = 'icloud_remote_log_v1';   // errors persist here so a crash/restart keeps the last failures
// CloudKit API tokens are per-environment: pick the one matching the env.
export const tokenForEnv = (env) => (env === 'development' ? RC.cloudkitTokenDev : RC.cloudkitTokenProd) || '';
const DEFAULT_CFG = {
  container: RC.container || 'iCloud.com.solyapps.signalscout',
  token: tokenForEnv(RC.env || 'production'),   // secret: from env via app.config.js, else ⚙ paste
  env: RC.env || 'production',           // native build uses prod CloudKit; keep web path aligned
  room: RC.room || 'SOLYPC',              // not secret — pairing room default
  webAuthToken: '',
  tokenManual: false,                     // true only if the user pasted a token in Settings
};

const ckBase = (cfg, kind, op) => `https://api.apple-cloudkit.com/database/1/${encodeURIComponent(cfg.container)}/${encodeURIComponent(cfg.env || 'development')}/public/${kind}/${op}`;
function ckUrl(cfg, op) {
  let u = `${ckBase(cfg, 'records', op)}?ckAPIToken=${encodeURIComponent(cfg.token)}`;
  if (op === 'modify' && cfg.webAuthToken) u += `&ckWebAuthToken=${encodeURIComponent(cfg.webAuthToken)}`;
  return u;
}
async function ckPost(cfg, op, body, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ckUrl(cfg, op), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
    if (!res.ok) throw new Error(`CloudKit ${res.status}: ${json.serverErrorCode || text.slice(0, 120)}`);
    return json;
  } finally { clearTimeout(timer); }
}

// ---- backend (native preferred, web fallback) -------------------------------
// MAILBOX: nothing is queried or deleted. Measured on live CloudKit, a QUERY only sees a new record
// after ~21s (index lag) while a LOOKUP BY NAME sees it in <1s. So:
//   frame    = ONE record  frame-<ROOM>, overwritten in place by the PC → we just look it up
//   commands = a ring of 16 records cmd-<ROOM>-0..15; we overwrite slot (seq % 16) → the PC looks them all up
// The PC runs a command only if its seq is newer than the last it ran, so a command can never replay.
const SLOTS = 16;
const slotName = (room, seq) => `cmd-${room}-${seq % SLOTS}`;
const frameName = (room) => `frame-${room}`;

async function backendLatestFrame(cfg) {
  if (hasNativeCK) {
    const recs = await nativeGet([frameName(cfg.room)]);
    const r = recs && recs[0];
    if (!r || !r.jpeg) return null;
    return { jpeg: r.jpeg, w: Number(r.w) || 0, h: Number(r.h) || 0, ts: Number(r.ts) || Date.now(), seq: Number(r.seq) || 0 };
  }
  const resp = await ckPost(cfg, 'lookup', { records: [{ recordName: frameName(cfg.room) }] });
  const rec = resp.records && resp.records[0];
  if (!rec || !rec.fields || !rec.fields.jpeg) return null;       // NOT_FOUND → the PC hasn't published yet
  const f = rec.fields;
  return { jpeg: f.jpeg.value, w: f.w ? Number(f.w.value) : 0, h: f.h ? Number(f.h.value) : 0, ts: f.ts ? Number(f.ts.value) : Date.now(), seq: f.seq ? Number(f.seq.value) : 0 };
}
async function backendWriteCmd(cfg, plain) {
  const name = slotName(cfg.room, plain.seq);
  if (hasNativeCK) return nativePut('RCCmd', name, plain);
  const f = {}; for (const k in plain) f[k] = { value: plain[k] };
  const resp = await ckPost(cfg, 'modify', { operations: [{ operationType: 'forceReplace', record: { recordType: 'RCCmd', recordName: name, fields: f } }] });
  const bad = resp.records && resp.records[0] && resp.records[0].serverErrorCode;   // per-record errors arrive inside a 200
  if (bad) throw new Error(`CloudKit ${bad}: ${((resp.records[0].reason) || '').slice(0, 80)}`);
  return resp;
}

export function newRoom() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export function useICloudRemote() {
  const [cfg, setCfgState] = useState(DEFAULT_CFG);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('');
  const [frame, setFrame] = useState(null);
  const [authUrl, setAuthUrl] = useState(null);
  const seqRef = useRef(Date.now());
  const pollRef = useRef(null);
  const keepRef = useRef(null);
  const lastTsRef = useRef(0);
  const liveRef = useRef(false);   // have we received at least one frame this session
  const cfgRef = useRef(DEFAULT_CFG);
  const pollFrameRef = useRef(() => {});

  // ---- in-app event log (so a failure is diagnosable without a cable) ----
  const logRef = useRef([]);
  const [log, setLog] = useState([]);
  const logSaveRef = useRef(0);
  const pushLog = useCallback((level, msg) => {
    const e = { t: Date.now(), level, msg: String(msg == null ? '' : msg).slice(0, 400) };
    const next = [...logRef.current, e].slice(-150);
    logRef.current = next; setLog(next);
    if (level === 'error' || level === 'ok') {
      const now = Date.now();
      if (now - logSaveRef.current > 1500) { logSaveRef.current = now; AsyncStorage.setItem(LOG_KEY, JSON.stringify(next.slice(-80))).catch(() => {}); }
    }
  }, []);
  const clearLog = useCallback(() => { logRef.current = []; setLog([]); AsyncStorage.removeItem(LOG_KEY).catch(() => {}); }, []);
  useEffect(() => {
    AsyncStorage.getItem(LOG_KEY).then((v) => {
      if (v) { try { const prev = JSON.parse(v); if (Array.isArray(prev) && prev.length) { logRef.current = prev; setLog(prev); } } catch (e) {} }
    }).catch(() => {});
  }, []);
  // a single place that both shows the user the status AND records it in the log
  const fail = useCallback((msg) => { setStatus(String(msg)); pushLog('error', msg); }, [pushLog]);

  // ---- make reopen feel continuous (iOS can't stream while the app is closed) ----
  // Keep the newest frame and persist it (throttled) so a relaunch shows the last screen instantly;
  // on foreground, resume streaming. The bridge still idles while closed, so there's no ongoing cost.
  const lastFrameObjRef = useRef(null);
  const framePersistRef = useRef(0);
  const connectedRef = useRef(false);
  const sendCmdRef = useRef(() => {});
  const persistFrame = useCallback((fr, force) => {
    lastFrameObjRef.current = fr;
    const now = Date.now();
    if (!force && now - framePersistRef.current < 4000) return;
    framePersistRef.current = now;
    AsyncStorage.setItem(FRAME_CACHE, JSON.stringify({ jpeg: fr.jpeg, w: fr.w, h: fr.h, ts: fr.ts })).catch(() => {});
  }, []);
  useEffect(() => {
    AsyncStorage.getItem(FRAME_CACHE).then((v) => {
      if (v && !lastFrameObjRef.current) {
        try { const fr = JSON.parse(v); if (fr && fr.jpeg) setFrame({ ...fr, rxAt: 0, cached: true, kb: Math.round((fr.jpeg.length * 0.75) / 1024) }); } catch (e) {}
      }
    }).catch(() => {});
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        if (connectedRef.current) { pollFrameRef.current(); const c = cfgRef.current; if (hasNativeCK || c.webAuthToken) sendCmdRef.current('shot'); }
      } else if (lastFrameObjRef.current) {
        persistFrame(lastFrameObjRef.current, true);   // save the last screen right before we're suspended
      }
    });
    return () => sub.remove();
  }, [persistFrame]);

  useEffect(() => {
    AsyncStorage.getItem(CFG_KEY).then((v) => {
      // start from the injected defaults; let any non-empty saved override win (⚙ edits persist)
      const stored = v ? (() => { try { return JSON.parse(v); } catch (e) { return {}; } })() : {};
      const c = { ...DEFAULT_CFG };
      for (const k of Object.keys(DEFAULT_CFG)) { if (stored[k] != null && stored[k] !== '') c[k] = stored[k]; }
      c.webAuthToken = stored.webAuthToken || DEFAULT_CFG.webAuthToken || '';
      // CloudKit API tokens are per-environment. A token saved from an earlier version (e.g. the
      // development one) must NOT override the right one for the current env — that mismatch is
      // exactly what produced "auth failed". Only a token the user typed by hand is kept.
      if (!stored.tokenManual) c.token = tokenForEnv(c.env) || c.token;
      cfgRef.current = c; setCfgState(c); setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const setCfg = useCallback((patch) => {
    // switching env swaps in that env's baked token (unless the user typed one in the same patch)
    if (patch.env && patch.env !== cfgRef.current.env && patch.token == null) {
      const t = tokenForEnv(patch.env);
      if (t) patch = { ...patch, token: t };
    }
    const c = { ...cfgRef.current, ...patch };
    cfgRef.current = c; setCfgState(c);
    AsyncStorage.setItem(CFG_KEY, JSON.stringify(c)).catch(() => {});
  }, []);

  const pollFrame = useCallback(async () => {
    const cfg = cfgRef.current;
    if (!cfg.container || !cfg.room || (!hasNativeCK && !cfg.token)) return;
    try {
      const fr = await backendLatestFrame(cfg);
      if (fr && fr.jpeg) {
        if (fr.ts !== lastTsRef.current) {
          lastTsRef.current = fr.ts;
          // The PC bridge writes seq = -(newest command it has executed) as a delivery receipt.
          // ack > 0  → this bridge reports receipts (every command with seq <= ack has run).
          // ack = 0  → older bridge: it can't confirm, so the screen says "sent" rather than guess.
          // rxAt = when THIS phone received the frame. Age is measured from this, never from the
          // PC's clock (fr.ts), so clock skew can't make a fresh frame read as "1500s ago".
          const withMeta = { ...fr, ack: fr.seq < 0 ? -fr.seq : 0, rxAt: Date.now(), kb: Math.round((fr.jpeg.length * 0.75) / 1024) };
          setFrame(withMeta);
          persistFrame(withMeta);   // cache so a reopen shows this screen instantly
          if (!liveRef.current) { liveRef.current = true; pushLog('ok', `screen is live (${fr.w}×${fr.h}, ${hasNativeCK ? 'native' : 'web'})`); }
        }
        setStatus('connected');
      } else { setStatus('waiting for your PC…'); }
    } catch (e) { fail(e.message || e); }
  }, [pushLog, fail]);

  useEffect(() => { pollFrameRef.current = pollFrame; }, [pollFrame]);
  useEffect(() => { connectedRef.current = connected; }, [connected]);

  // After an action, re-check for the new screenshot sooner than the steady poll. Rate-limited so a
  // stream of cursor moves can't turn into a flood of CloudKit queries.
  const lastBurstRef = useRef(0);
  const burstFrames = useCallback(() => {
    const now = Date.now();
    if (now - lastBurstRef.current < 700) return;
    lastBurstRef.current = now;
    [250, 700, 1300].forEach((ms) => setTimeout(() => pollFrameRef.current(), ms));
  }, []);

  // web path only: one-time Apple sign-in so the user can write (native doesn't need this).
  const beginSignIn = useCallback(async () => {
    const cfg = cfgRef.current;
    if (hasNativeCK) return;
    if (!cfg.container || !cfg.token) { setStatus('Set up iCloud first'); return; }
    try {
      const res = await fetch(`${ckBase(cfg, 'users', 'caller')}?ckAPIToken=${encodeURIComponent(cfg.token)}`, { method: 'GET' });
      const text = await res.text(); let j; try { j = JSON.parse(text); } catch (e) { j = {}; }
      if (j.redirectURL) { setAuthUrl(j.redirectURL); setStatus('sign in to control'); pushLog('info', 'opening Apple sign-in (web route needs it)'); }
      else if (res.ok) { setStatus('already signed in'); }
      else { fail('sign-in unavailable: ' + (j.serverErrorCode || res.status)); }
    } catch (e) { fail(e.message || e); }
  }, [pushLog, fail]);

  const completeSignIn = useCallback((token) => {
    if (!token) { setAuthUrl(null); return; }
    setCfg({ webAuthToken: token });
    setAuthUrl(null); setStatus('signed in — controls ready'); pushLog('ok', 'signed in to iCloud');
  }, [setCfg, pushLog]);

  const sendCmd = useCallback(async (kind, extra = {}) => {
    const cfg = cfgRef.current;
    if (!cfg.container || !cfg.room || (!hasNativeCK && !cfg.token)) {
      setStatus('Set up iCloud first');
      return { ok: false, seq: 0, error: 'Set up iCloud first' };
    }
    const seq = ++seqRef.current;
    const plain = {
      room: cfg.room, seq, kind,
      x: extra.x || 0, y: extra.y || 0, dx: extra.dx || 0, dy: extra.dy || 0,
      text: extra.text || '', ts: Date.now(),
    };
    try {
      await backendWriteCmd(cfg, plain);
      // a plain cursor move streams several per second — don't re-fetch frames for each one
      if (kind !== 'move' || extra.final) burstFrames();
      return { ok: true, seq };
    } catch (e) {
      const m = String(e.message || e);
      setStatus(m);
      pushLog('error', `${kind} failed: ${m}`);
      if (!hasNativeCK && !cfgRef.current.webAuthToken && /AUTHENTICATION_REQUIRED|authentication|unauthenticated|\b401\b|\b421\b/i.test(m)) beginSignIn();
      return { ok: false, seq, error: m };
    }
  }, [burstFrames, beginSignIn, pushLog]);
  useEffect(() => { sendCmdRef.current = sendCmd; }, [sendCmd]);

  const connect = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (keepRef.current) clearInterval(keepRef.current);
    liveRef.current = false;
    const c = cfgRef.current;
    setConnected(true); setStatus('connecting…');
    pushLog('info', `connecting · ${hasNativeCK ? 'native' : 'web'} · env ${c.env} · room ${c.room}`);
    pollFrame();
    sendCmd('shot');
    pollRef.current = setInterval(pollFrame, 550);   // a by-name lookup is one cheap request; poll fast
    // keepalive: tells the PC bridge a viewer is still here so it keeps polling fast and pushing
    // frames. Only when we can actually write (native, or signed in on web) — otherwise a failing
    // write would keep re-opening the Apple sign-in sheet.
    keepRef.current = setInterval(() => {
      const c = cfgRef.current;
      if (hasNativeCK || c.webAuthToken) sendCmd('shot');
    }, 25000);
  }, [pollFrame, sendCmd, pushLog]);

  const disconnect = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (keepRef.current) { clearInterval(keepRef.current); keepRef.current = null; }
    setConnected(false); setStatus(''); pushLog('info', 'disconnected');
  }, [pushLog]);

  // auto-connect on open when pre-configured
  useEffect(() => {
    if (!loaded || connected) return;
    const c = cfgRef.current;
    if (c.container && c.room && (hasNativeCK || c.token)) connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (keepRef.current) clearInterval(keepRef.current);
  }, []);

  return {
    cfg, loaded, connected, status, frame, authUrl,
    native: hasNativeCK, signedIn: hasNativeCK || !!cfg.webAuthToken,
    setCfg, connect, disconnect, sendCmd, requestShot: () => sendCmd('shot'),
    beginSignIn, completeSignIn,
    log, clearLog, pushLog,
  };
}
