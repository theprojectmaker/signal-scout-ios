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
import { createAssembler, ingest, sequence, applyMsg, snapshot, TURBO_SLOTS, turboIdxNames, turboPayName } from './turboAssembler';

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
  packing: false,                         // ON = ask the PC to pack several frames per write (smoother)
  turboQ: 0,                              // Turbo quality floor: 0 = best the link allows … 4 = smallest/fastest
  videoQ: 0,                              // Video β quality floor: 0 = best … 4 = smallest/fastest
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
const frameName = (room) => `frame-${room}`;                       // legacy single frame record (back-compat)
// Frame RING: the PC writes frames round-robin across these slots with several CloudKit writes in
// flight at once, which is what lifts the ~1fps single-record ceiling toward ~6-8fps. We read all of
// them (plus the legacy record) in ONE lookup-by-name and play them back through a small jitter buffer.
// Ring records are the SAME schema as the legacy one (room, seq, ts, w, h, jpeg) — `ts` is the frame
// order key and `seq` (negative) is still the delivery receipt — so there's no production schema change.
const FRAME_RING = 8;
const ringNames = (room) => Array.from({ length: FRAME_RING }, (_, i) => `frame-${room}-${i}`);
const normNativeFrame = (r) => {
  if (!r || !r.jpeg) return null;
  const ts = Number(r.ts) || 0, seq = Number(r.seq) || 0;
  return { jpeg: r.jpeg, w: Number(r.w) || 0, h: Number(r.h) || 0, ts, ack: seq < 0 ? -seq : 0 };
};
const normWebFrame = (rec) => {
  const f = rec && rec.fields;
  if (!f || !f.jpeg) return null;
  const v = (k) => (f[k] ? f[k].value : undefined);
  const ts = Number(v('ts')) || 0, seq = Number(v('seq')) || 0;
  return { jpeg: v('jpeg'), w: Number(v('w')) || 0, h: Number(v('h')) || 0, ts, ack: seq < 0 ? -seq : 0 };
};

// Read every ring slot AND the legacy record in ONE lookup-by-name, return all frames found
// (normalized, newest-first by ts). The caller dedupes by ts and buffers. Works whether the PC is a
// new ring-writing bridge (8 fresh frames) or an old single-record one (just the legacy frame).
async function backendRingFrames(cfg) {
  const names = [...ringNames(cfg.room), frameName(cfg.room)];
  if (hasNativeCK) {
    const recs = await nativeGet(names);                          // missing slots are simply omitted
    return (recs || []).map(normNativeFrame).filter(Boolean).sort((a, b) => b.ts - a.ts);
  }
  const resp = await ckPost(cfg, 'lookup', { records: names.map((n) => ({ recordName: n })) });
  return (resp.records || []).map(normWebFrame).filter(Boolean).sort((a, b) => b.ts - a.ts);
}
// Look records up by name (native or web) and return plain {name, ts, seq, w, h, jpeg} objects. Used by Turbo,
// which polls tiny index records and then downloads only the payload records that changed.
async function backendLookup(cfg, names) {
  if (hasNativeCK) {
    const recs = await nativeGet(names);
    return (recs || []).map((r) => ({ name: r.recordName, ts: Number(r.ts) || 0, seq: Number(r.seq) || 0, w: Number(r.w) || 0, h: Number(r.h) || 0, jpeg: r.jpeg }));
  }
  const resp = await ckPost(cfg, 'lookup', { records: names.map((n) => ({ recordName: n })) });
  return (resp.records || []).filter((rec) => rec && rec.fields).map((rec) => {
    const v = (k) => (rec.fields[k] ? rec.fields[k].value : undefined);
    return { name: rec.recordName, ts: Number(v('ts')) || 0, seq: Number(v('seq')) || 0, w: Number(v('w')) || 0, h: Number(v('h')) || 0, jpeg: v('jpeg') };
  });
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

export function useICloudRemote(activeRoom, enabled = true, turbo = false, video = false) {
  // activeRoom overrides cfg.room (e.g. 'WEB' for the browser tab) without changing the saved desktop room,
  // so Computer and Web are two tabs over the same container/creds — just different mailbox rooms.
  const activeRoomRef = useRef(activeRoom || null);
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
  const bufRef = useRef([]);        // jitter buffer: frames fetched but not yet shown, oldest-first
  const lastAckRef = useRef(0);     // highest delivery-receipt ack seen (shown on every played frame)
  const playRef = useRef(null);     // playback timer that steps the buffer into view at a steady cadence
  const liveRef = useRef(false);   // have we received at least one frame this session
  const cfgRef = useRef(DEFAULT_CFG);
  const pollFrameRef = useRef(() => {});
  // ---- Turbo (delta-tile stream) state ----
  const turboRef = useRef(!!turbo);                       // current mode, read by callbacks
  const asmRef = useRef(createAssembler());                // orders + paints the bridge's messages
  const slotTsRef = useRef(new Array(TURBO_SLOTS).fill(0));    // newest payload ts we hold, per slot
  const slotWantRef = useRef(new Array(TURBO_SLOTS).fill(0)); // newest ts we already asked for (never fetch a slot twice)
  const playQRef = useRef([]);                             // sequenced messages waiting for their playout moment
  const lastPlayAtRef = useRef(0);
  const lastPlayTsRef = useRef(0);
  const turboTokenRef = useRef(0);                         // bumping it stops the running Turbo loops
  const fetchBusyRef = useRef(0);
  const screenSzRef = useRef({ w: 0, h: 0 });              // the PC's real screen size (for tap mapping)
  const lastResyncRef = useRef(0);
  const turboErrRef = useRef(0);
  const tStat = useRef({ commits: 0, bytes: 0, idxMs: [], aliveAt: 0, t0: Date.now() });
  const [turboView, setTurboView] = useState(null);        // {rev, base, rects, W, H} → drawn by TurboCanvas
  const [turboInfo, setTurboInfo] = useState({ fps: 0, kbs: 0, rtt: 0, aliveAt: 0 });
  // ---- Video β (H.264 over CloudKit) state ----
  const videoRef = useRef(!!video);                        // current mode
  const videoSinkRef = useRef(null);                       // VideoCanvas sets this: (obj)=>inject into the WebView
  const vidTokenRef = useRef(0);                           // bump to stop the running video loop
  const vidGenRef = useRef(-1);                            // current encoder generation (restarts on resync/quality change)
  const vidChunksRef = useRef(new Map());                  // seg# -> { n, parts:Map(k->b64) }
  const vidNextRef = useRef(0);                            // next segment number to deliver (in order)
  const vidSlotTsRef = useRef(new Array(12).fill(0));      // newest ts seen per vid payload slot
  const vidFetchRef = useRef(0);
  const vidStat = useRef({ segs: 0, bytes: 0, idxMs: [], aliveAt: 0, t0: Date.now() });
  const [videoInfo, setVideoInfo] = useState({ fps: 0, kbs: 0, rtt: 0, aliveAt: 0, playing: false });
  const [webTabs, setWebTabs] = useState({ tabs: [], active: 0 });   // the PC browser's open tabs (Web mode)

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
  const lastKeepRef = useRef(0);   // last time we nudged the bridge, for the freshness watchdog
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
        if (connectedRef.current) {
          const c = cfgRef.current;
          if (videoRef.current) { if (hasNativeCK || c.webAuthToken) { sendCmdRef.current('video', { text: 'on' }); sendCmdRef.current('vr'); } }   // back from background: fresh keyframe + init
          else if (turboRef.current) { if (hasNativeCK || c.webAuthToken) { sendCmdRef.current('turbo', { text: 'on' }); sendCmdRef.current('tr'); } }   // repaint from a fresh preview
          else { pollFrameRef.current(); if (hasNativeCK || c.webAuthToken) sendCmdRef.current('shot'); }
        }
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

  // One lookup of the whole ring per poll. We don't show frames here — we ENQUEUE the new ones and let
  // the playback timer step them out at a steady cadence, so a burst of ring writes becomes smooth
  // motion instead of a stutter. (ack = delivery receipt: commands up to it have run on the PC.)
  const pollFrame = useCallback(async () => {
    const cfg = { ...cfgRef.current, room: activeRoomRef.current || cfgRef.current.room };
    if (!cfg.container || !cfg.room || (!hasNativeCK && !cfg.token)) return;
    try {
      const raw = await backendRingFrames(cfg);                    // newest-first; may be 1 (old bridge) or many
      if (!raw.length) { setStatus('waiting for your PC…'); return; }
      // a PACKED frame's jpeg is a JSON array of {j, fts} — expand each into its own frame so playback is
      // smoother. Each carries its own capture time (fts) so the ts-dedupe below drops the overlaps.
      const frames = [];
      for (const f of raw) {
        if (typeof f.jpeg === 'string' && f.jpeg[0] === '[') {
          try { const arr = JSON.parse(f.jpeg); for (const it of arr) { if (it && it.j) frames.push({ jpeg: it.j, w: f.w, h: f.h, ts: Number(it.fts) || f.ts, ack: f.ack }); } }
          catch (e) { frames.push(f); }
        } else frames.push(f);
      }
      for (const f of frames) if (f.ack > lastAckRef.current) lastAckRef.current = f.ack;
      const fresh = frames.filter((f) => f.ts > lastTsRef.current).sort((a, b) => a.ts - b.ts);   // oldest-first
      if (fresh.length) {
        lastTsRef.current = fresh[fresh.length - 1].ts;
        const buf = bufRef.current.concat(fresh);
        bufRef.current = buf.length > 8 ? buf.slice(-6) : buf;      // fell behind → skip to newest, cap latency
      }
      setStatus('connected');
    } catch (e) { fail(e.message || e); }
  }, [fail]);

  // ===================== TURBO: delta-tile stream =====================
  // The PC sends only the screen rectangles that changed (full resolution) plus a small whole-screen preview
  // during big motion, packed into a ring of payload records, each with a TINY index record beside it. So:
  //   index loop  — every ~240ms look up the tiny indexes (cheap even when nothing changes);
  //   fetch       — when an index shows a newer payload, download JUST that payload (in parallel, not blocking
  //                 the index loop);  assemble — order/dedupe/repair gaps (turboAssembler);
  //   playout     — apply messages at their capture cadence (bursts look like motion, not a jump).
  const turboReset = useCallback(() => {
    asmRef.current = createAssembler();
    slotTsRef.current = new Array(TURBO_SLOTS).fill(0);
    slotWantRef.current = new Array(TURBO_SLOTS).fill(0);
    playQRef.current = []; lastPlayAtRef.current = 0; lastPlayTsRef.current = 0;
    setTurboView(null);
  }, []);

  const requestResync = useCallback((why) => {
    const now = Date.now();
    if (now - lastResyncRef.current < 3000) return;          // at most one repaint request per 3s
    lastResyncRef.current = now;
    pushLog('info', 'turbo: repaint requested (' + why + ')');
    sendCmdRef.current('tr');
  }, [pushLog]);

  const turboSequence = useCallback(() => {
    const { ready, resync } = sequence(asmRef.current, Date.now());
    if (ready.length) playQRef.current.push(...ready);
    if (resync) requestResync('gap');
  }, [requestResync]);

  const turboFetch = useCallback(async (cfg, want) => {
    fetchBusyRef.current++;
    try {
      const recs = await backendLookup(cfg, want.map((w) => turboPayName(cfg.room, w.k)));
      for (const r of recs) {
        const k = Number(r.name.slice(r.name.lastIndexOf('-p') + 2));
        const w = want.find((x) => x.k === k);
        if (!w || r.ts < w.ts || typeof r.jpeg !== 'string') continue;   // payload older than its index → asked again next poll
        slotTsRef.current[k] = r.ts;
        tStat.current.bytes += r.jpeg.length;
        let arr = []; try { arr = JSON.parse(r.jpeg); } catch (e) { /* torn record: the gap logic repairs it */ }
        ingest(asmRef.current, arr);
      }
      for (const w of want) if (slotTsRef.current[w.k] < w.ts) slotWantRef.current[w.k] = slotTsRef.current[w.k];   // not obtained → allow a retry
      turboSequence();
      turboErrRef.current = 0;
    } catch (e) {
      for (const w of want) slotWantRef.current[w.k] = slotTsRef.current[w.k];
      turboErrRef.current++;
      if (turboErrRef.current >= 3) fail(e.message || e);
    } finally { fetchBusyRef.current--; }
  }, [fail, turboSequence]);

  const turboIndexOnce = useCallback(async () => {
    const cfg = { ...cfgRef.current, room: activeRoomRef.current || cfgRef.current.room };
    if (!cfg.container || !cfg.room || (!hasNativeCK && !cfg.token)) return;
    const t0 = Date.now();
    const idx = await backendLookup(cfg, turboIdxNames(cfg.room));
    const ms = tStat.current.idxMs; ms.push(Date.now() - t0); if (ms.length > 8) ms.shift();
    tStat.current.aliveAt = Date.now();
    turboErrRef.current = 0;
    let ack = lastAckRef.current; const want = [];
    for (const r of idx) {
      const k = Number(r.name.slice(r.name.lastIndexOf('-i') + 2));
      if (!(k >= 0 && k < TURBO_SLOTS)) continue;
      if (r.w && r.h) screenSzRef.current = { w: r.w, h: r.h };
      if (r.seq < 0 && -r.seq > ack) ack = -r.seq;                       // delivery receipt rides the index (tiny)
      if (r.ts > slotTsRef.current[k] && r.ts > slotWantRef.current[k]) want.push({ k, ts: r.ts });
    }
    if (want.length && fetchBusyRef.current < 2) {
      for (const w of want) slotWantRef.current[w.k] = w.ts;
      turboFetch(cfg, want);                                              // not awaited: indexes keep ticking meanwhile
    }
    if (ack !== lastAckRef.current) { lastAckRef.current = ack; setFrame((f) => (f ? { ...f, ack } : f)); }
    turboSequence();                                                      // a gap may have timed out even with nothing new
    setStatus('connected');
  }, [turboFetch, turboSequence]);

  const startTurbo = useCallback(() => {
    const token = ++turboTokenRef.current;
    const alive = () => turboTokenRef.current === token;
    (async () => {                                                        // index loop
      while (alive()) {
        const t0 = Date.now();
        try { await turboIndexOnce(); }
        catch (e) { turboErrRef.current++; if (turboErrRef.current >= 3) fail(e.message || e); }
        await new Promise((res) => setTimeout(res, Math.max(70, 240 - (Date.now() - t0))));
      }
    })();
    const play = () => {                                                  // playout loop
      if (!alive()) return;
      const q = playQRef.current, now = Date.now();
      let changed = false, lastTs = 0;
      if (q.length > 14) { let last = -1; for (let i = 0; i < q.length; i++) if (q[i].t === 'b') last = i; if (last > 0) q.splice(0, last); }   // far behind → jump to the newest preview
      while (q.length) {
        const m = q[0];
        let gap = lastPlayTsRef.current ? Math.min(120, Math.max(0, m.ts - lastPlayTsRef.current)) : 0;   // replay the capture cadence (≤120ms)
        if (q.length > 12) gap = 0; else if (q.length > 6) gap *= 0.4;                                      // catching up → faster
        if (now - lastPlayAtRef.current < gap) break;
        q.shift();
        if (applyMsg(asmRef.current, m)) changed = true;
        if (m.ts !== lastPlayTsRef.current) lastPlayAtRef.current = now;
        lastPlayTsRef.current = m.ts; lastTs = m.ts;
      }
      if (changed) {
        const snap = snapshot(asmRef.current), sz = screenSzRef.current;
        setTurboView(snap);
        const f = { jpeg: '', w: sz.w || snap.W, h: sz.h || snap.H, ts: lastTs, ack: lastAckRef.current, rxAt: Date.now(), kb: 0, turbo: true };
        lastFrameObjRef.current = f;
        setFrame(f);
        tStat.current.commits++;
        if (!liveRef.current) { liveRef.current = true; pushLog('ok', `turbo screen is live (${snap.W}×${snap.H}, ${hasNativeCK ? 'native' : 'web'})`); }
      }
      setTimeout(play, 16);
    };
    play();
    const hud = () => {                                                   // 1s numbers for the status bar
      if (!alive()) return;
      const s = tStat.current, dt = Math.max(0.5, (Date.now() - s.t0) / 1000), ms = s.idxMs.slice().sort((a, b) => a - b);
      setTurboInfo({ fps: Math.round(s.commits / dt), kbs: Math.round(s.bytes / 1024 / dt), rtt: ms.length ? ms[ms.length >> 1] : 0, aliveAt: s.aliveAt });
      s.commits = 0; s.bytes = 0; s.t0 = Date.now();
      setTimeout(hud, 1000);
    };
    hud();
  }, [turboIndexOnce, fail, pushLog]);
  const stopTurbo = useCallback(() => { turboTokenRef.current++; }, []);

  // ===================== VIDEO β: H.264 stream =====================
  // Poll the tiny vid-ROOM-i* indexes + vid-ROOM-init; fetch changed payload chunks; reassemble each segment
  // (k of n chunks) and hand the init (once per encoder generation) + segments IN ORDER to the WebView player,
  // which hardware-decodes them via MSE. Segments are keyframe-led, so a missing one just skips ahead.
  const videoReset = useCallback(() => {
    vidGenRef.current = -1; vidChunksRef.current = new Map(); vidNextRef.current = 0;
    vidSlotTsRef.current = new Array(12).fill(0);
  }, []);
  const vName = { idx: (room, k) => `vid-${room}-i${k}`, pay: (room, k) => `vid-${room}-p${k}`, init: (room) => `vid-${room}-init` };

  const videoIndexOnce = useCallback(async () => {
    const cfg = { ...cfgRef.current, room: activeRoomRef.current || cfgRef.current.room };
    if (!cfg.container || !cfg.room || (!hasNativeCK && !cfg.token)) return;
    const names = [...Array.from({ length: 12 }, (_, k) => vName.idx(cfg.room, k)), vName.init(cfg.room)];
    const t0 = Date.now();
    const recs = await backendLookup(cfg, names);
    const ms = vidStat.current.idxMs; ms.push(Date.now() - t0); if (ms.length > 8) ms.shift();
    vidStat.current.aliveAt = Date.now();
    let ack = lastAckRef.current; const want = [];
    for (const r of recs) {
      if (r.name === vName.init(cfg.room)) {
        try {
          const j = JSON.parse(r.jpeg);
          if (j.g > vidGenRef.current) {                       // new encoder generation → reset player with its init
            vidGenRef.current = j.g; vidChunksRef.current = new Map(); vidNextRef.current = 0;
            if (videoSinkRef.current) videoSinkRef.current({ t: 'init', g: j.g, d: j.d });
            pushLog('ok', `video init gen ${j.g}`);
          }
        } catch (e) {}
        continue;
      }
      const k = Number(r.name.slice(r.name.lastIndexOf('-i') + 2));
      if (!(k >= 0 && k < 12)) continue;
      if (r.w && r.h) screenSzRef.current = { w: r.w, h: r.h };
      if (r.seq < 0 && -r.seq > ack) ack = -r.seq;
      if (r.ts > vidSlotTsRef.current[k]) want.push({ k, ts: r.ts });
    }
    lastAckRef.current = ack;
    // keep a lightweight frame object carrying the PC's screen size + ack, so tap-mapping and the local cursor work
    const sz = screenSzRef.current;
    if (sz.w && sz.h) setFrame((f) => (f && f.video && f.w === sz.w && f.h === sz.h && f.ack === ack ? f : { jpeg: '', w: sz.w, h: sz.h, ts: Date.now(), ack, video: true, rxAt: Date.now() }));
    if (want.length && vidFetchRef.current < 2) {
      vidFetchRef.current++;
      (async () => {
        try {
          const prs = await backendLookup(cfg, want.map((w) => vName.pay(cfg.room, w.k)));
          for (const r of prs) {
            const k = Number(r.name.slice(r.name.lastIndexOf('-p') + 2));
            let j; try { j = JSON.parse(r.jpeg); } catch (e) { continue; }
            vidSlotTsRef.current[k] = r.ts;
            vidStat.current.bytes += (j.d || '').length;
            if (j.g !== vidGenRef.current) continue;
            let e = vidChunksRef.current.get(j.s); if (!e) { e = { n: j.n, parts: new Map() }; vidChunksRef.current.set(j.s, e); }
            e.parts.set(j.k, j.d);
          }
          // deliver every COMPLETE segment in order; skip a permanently-missing one once a later segment is ready
          const chunks = vidChunksRef.current;
          for (;;) {
            const cur = chunks.get(vidNextRef.current);
            if (cur && cur.parts.size === cur.n) {
              let b64 = ''; for (let i = 0; i < cur.n; i++) b64 += cur.parts.get(i) || '';
              if (videoSinkRef.current) videoSinkRef.current({ t: 'seg', d: b64 });
              chunks.delete(vidNextRef.current); vidNextRef.current++; vidStat.current.segs++;
              continue;
            }
            // nextSeg not ready: if a strictly-later segment is already complete, we've lost this one → skip to it
            let nextReady = -1;
            for (const [s, e] of chunks) { if (s > vidNextRef.current && e.parts.size === e.n && (nextReady < 0 || s < nextReady)) nextReady = s; }
            if (nextReady >= 0 && chunks.size > 6) { for (const s of [...chunks.keys()]) if (s < nextReady) chunks.delete(s); vidNextRef.current = nextReady; continue; }
            break;
          }
        } catch (e) { pushLog('error', 'video fetch: ' + (e.message || e)); }
        finally { vidFetchRef.current--; }
      })();
    }
    setStatus('connected');
  }, [pushLog]);

  const startVideo = useCallback(() => {
    const token = ++vidTokenRef.current;
    const alive = () => vidTokenRef.current === token;
    vidStat.current = { segs: 0, bytes: 0, idxMs: [], aliveAt: 0, t0: Date.now() };
    (async () => {
      let errs = 0;
      while (alive()) {
        const t0 = Date.now();
        try { await videoIndexOnce(); errs = 0; }
        catch (e) { errs++; if (errs >= 3) fail(e.message || e); }
        await new Promise((res) => setTimeout(res, Math.max(90, 220 - (Date.now() - t0))));
      }
    })();
    const hud = () => {
      if (!alive()) return;
      const s = vidStat.current, dt = Math.max(0.5, (Date.now() - s.t0) / 1000), ms = s.idxMs.slice().sort((a, b) => a - b);
      setVideoInfo((v) => ({ ...v, fps: Math.round((s.segs / dt) * 10) / 10, kbs: Math.round(s.bytes / 1024 / dt), rtt: ms.length ? ms[ms.length >> 1] : 0, aliveAt: s.aliveAt }));
      s.segs = 0; s.bytes = 0; s.t0 = Date.now();
      setTimeout(hud, 1000);
    };
    hud();
  }, [videoIndexOnce, fail]);
  const stopVideo = useCallback(() => { vidTokenRef.current++; }, []);

  useEffect(() => { pollFrameRef.current = pollFrame; }, [pollFrame]);
  useEffect(() => { connectedRef.current = connected; }, [connected]);

  // jitter buffer playback — step one buffered frame into the <Image> every ~110ms so bursty ring
  // arrivals look like smooth motion. Empty buffer = nothing changes (the watchdog then nudges the PC).
  useEffect(() => {
    if (!connected) return undefined;
    const id = setInterval(() => {
      const buf = bufRef.current;
      if (!buf.length) return;
      const f = buf.shift();
      const withMeta = { ...f, ack: lastAckRef.current, rxAt: Date.now(), kb: Math.round((f.jpeg.length * 0.75) / 1024) };
      setFrame(withMeta);
      persistFrame(withMeta);
      if (!liveRef.current) { liveRef.current = true; pushLog('ok', `screen is live (${f.w}×${f.h}, ${hasNativeCK ? 'native' : 'web'})`); }
    }, 110);
    playRef.current = id;
    return () => { clearInterval(id); playRef.current = null; };
  }, [connected, persistFrame, pushLog]);

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
    const cfg = { ...cfgRef.current, room: extra.room || activeRoomRef.current || cfgRef.current.room };   // extra.room: address a specific bridge
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
    stopTurbo(); stopVideo();
    liveRef.current = false;
    bufRef.current = []; lastTsRef.current = 0; lastAckRef.current = 0;   // fresh buffer each connect
    turboReset(); videoReset();
    const c = { ...cfgRef.current, room: activeRoomRef.current || cfgRef.current.room };
    setConnected(true); setStatus('connecting…');
    const kind = videoRef.current ? 'VIDEO' : turboRef.current ? 'TURBO' : 'classic';
    pushLog('info', `connecting · ${kind} · ${hasNativeCK ? 'native' : 'web'} · env ${c.env} · room ${c.room}`);
    if (videoRef.current) {
      sendCmd('video', { text: 'on' });                        // ask the PC for the H.264 encoder
      sendCmd('vq', { text: String(c.videoQ || 0) });
      startVideo();
    } else if (turboRef.current) {
      sendCmd('turbo', { text: 'on' });                        // ask the PC for the delta-tile engine
      sendCmd('tq', { text: String(c.turboQ || 0) });
      sendCmd('tr');                                           // …and a fresh whole-screen preview to start from
      startTurbo();
    } else {
      pollFrame();
      sendCmd('shot');
      if (c.room !== 'WEB') { sendCmd('turbo', { text: 'off' }); sendCmd('video', { text: 'off' }); }  // a bridge left in Turbo/Video goes back to the classic ring
      sendCmd('pack', { text: c.packing ? 'on' : 'off' });   // restore the frame-packing preference on the PC
      pollRef.current = setInterval(pollFrame, 700);   // one lookup of the whole ring per tick (don't flood)
    }
    lastKeepRef.current = Date.now();
    // Freshness watchdog + keepalive. Runs often and nudges the PC bridge with a 'shot' when the picture
    // has gone stale (so the age never silently climbs to "100s ago" — if frames stop, we actively ask
    // for one), and at least every ~16s even when fresh, so the bridge stays in its fast push mode while
    // you're just watching. Only when we can actually write (native, or signed in on web).
    keepRef.current = setInterval(() => {
      const c = cfgRef.current;
      if (!(hasNativeCK || c.webAuthToken)) return;
      if (videoRef.current) {                                   // keep the PC's "viewer active" flag warm (idempotent 'video on')
        if (Date.now() - lastKeepRef.current > 12000) { lastKeepRef.current = Date.now(); sendCmd('video', { text: 'on' }); }
        return;
      }
      if (turboRef.current) {                                   // Turbo is silent on a still screen — only keep the PC's "viewer active" flag warm
        if (Date.now() - lastKeepRef.current > 14000) { lastKeepRef.current = Date.now(); sendCmd('shot'); }
        return;
      }
      const fr = lastFrameObjRef.current;
      const age = fr && fr.rxAt ? Date.now() - fr.rxAt : Infinity;   // Infinity before the first live frame
      if (age > 2500 || Date.now() - lastKeepRef.current > 16000) {
        lastKeepRef.current = Date.now();
        sendCmd('shot');
      }
    }, 1500);
  }, [pollFrame, sendCmd, pushLog, stopTurbo, startTurbo, turboReset, stopVideo, startVideo, videoReset]);

  const disconnect = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (keepRef.current) { clearInterval(keepRef.current); keepRef.current = null; }
    stopTurbo(); stopVideo();
    if (videoRef.current) sendCmdRef.current('video', { text: 'off', room: cfgRef.current.room });   // stop the PC encoder promptly
    setConnected(false); setStatus(''); pushLog('info', 'disconnected');
  }, [pushLog, stopTurbo, stopVideo]);

  // auto-connect on open when pre-configured AND this transport is active (enabled). When the user
  // switches to another transport (e.g. the Azure tab) this hook is disabled, so it disconnects and
  // stops polling CloudKit in the background.
  useEffect(() => {
    if (!loaded) return;
    if (!enabled) { if (connectedRef.current) disconnect(); return; }
    if (connectedRef.current) return;
    const c = cfgRef.current;
    if (c.container && c.room && (hasNativeCK || c.token)) connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, enabled]);

  // switch tabs (Computer <-> Web): point at the new room and refresh, without tearing the connection down
  useEffect(() => {
    activeRoomRef.current = activeRoom || null;
    if (!connectedRef.current) return;
    bufRef.current = []; lastTsRef.current = 0; lastAckRef.current = 0; liveRef.current = false;
    setFrame(null); setStatus('switching…');
    pollFrameRef.current(); sendCmdRef.current('shot');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoom]);

  // Swap the reader (classic ⇄ Turbo ⇄ Video) on a live connection without dropping the link. (Declared AFTER
  // the room effect above so activeRoomRef is current when commands go out.)
  useEffect(() => {
    const wasT = turboRef.current, wasV = videoRef.current;
    turboRef.current = !!turbo; videoRef.current = !!video;
    if (wasT === !!turbo && wasV === !!video) return;
    if (!connectedRef.current) return;
    // tear down whatever was running
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    stopTurbo(); turboReset(); stopVideo(); videoReset();
    if (wasV && !video) sendCmdRef.current('video', { text: 'off', room: cfgRef.current.room });   // leaving video → stop the PC encoder
    bufRef.current = []; lastTsRef.current = 0; liveRef.current = false;
    setFrame(null); setStatus('switching…');
    if (video) {
      sendCmdRef.current('video', { text: 'on' });
      sendCmdRef.current('vq', { text: String(cfgRef.current.videoQ || 0) });
      startVideo();
    } else if (turbo) {
      sendCmdRef.current('turbo', { text: 'on' });
      sendCmdRef.current('tq', { text: String(cfgRef.current.turboQ || 0) });
      sendCmdRef.current('tr');
      startTurbo();
    } else {
      sendCmdRef.current('turbo', { text: 'off', room: cfgRef.current.room });
      if ((activeRoomRef.current || cfgRef.current.room) !== 'WEB') pollFrameRef.current();
      sendCmdRef.current('shot');
      pollRef.current = setInterval(() => pollFrameRef.current(), 700);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turbo, video]);

  // Web mode: poll the PC browser's tab list (tabs-WEB record) so the app can show a tab strip.
  useEffect(() => {
    if (!connected || (activeRoom !== 'WEB')) { setWebTabs({ tabs: [], active: 0 }); return undefined; }
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const recs = await backendLookup({ ...cfgRef.current, room: 'WEB' }, ['tabs-WEB']);
        const r0 = recs && recs[0];
        if (r0 && r0.jpeg) { try { const j = JSON.parse(r0.jpeg); if (Array.isArray(j.tabs)) setWebTabs({ tabs: j.tabs, active: j.a || 0 }); } catch (e) {} }
      } catch (e) {}
      if (!stop) setTimeout(tick, 1500);
    };
    tick();
    return () => { stop = true; };
  }, [connected, activeRoom]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (keepRef.current) clearInterval(keepRef.current);
    turboTokenRef.current++; vidTokenRef.current++;
  }, []);

  return {
    cfg, loaded, connected, status, frame, authUrl,
    native: hasNativeCK, signedIn: hasNativeCK || !!cfg.webAuthToken,
    turbo: !!turbo, turboView, turboInfo,
    video: !!video, videoSinkRef, videoInfo, setVideoStat: setVideoInfo,
    webTabs, webCmd: (kind, text) => sendCmd(kind, { text, room: 'WEB' }),
    repaint: () => sendCmd(videoRef.current ? 'vr' : 'tr'),
    setCfg, connect, disconnect, sendCmd, requestShot: () => sendCmd('shot'),
    beginSignIn, completeSignIn,
    log, clearLog, pushLog,
  };
}
