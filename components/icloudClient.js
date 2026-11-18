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
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { hasNativeCK, nativeSave, nativeQuery } from './icloudNative';

const RC = (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.rc) || {};
const CFG_KEY = 'icloud_remote_cfg_v1';
// CloudKit API tokens are per-environment: pick the one matching the env.
export const tokenForEnv = (env) => (env === 'development' ? RC.cloudkitTokenDev : RC.cloudkitTokenProd) || '';
const DEFAULT_CFG = {
  container: RC.container || 'iCloud.com.solyapps.signalscout',
  token: tokenForEnv(RC.env || 'production'),   // secret: from env via app.config.js, else ⚙ paste
  env: RC.env || 'production',           // native build uses prod CloudKit; keep web path aligned
  room: RC.room || 'SOLYPC',              // not secret — pairing room default
  webAuthToken: '',
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
async function backendLatestFrame(cfg) {
  if (hasNativeCK) {
    const recs = await nativeQuery('RCFrame', cfg.room, 1);
    const r = recs && recs[0];
    if (!r || !r.jpeg) return null;
    return { jpeg: r.jpeg, w: Number(r.w) || 0, h: Number(r.h) || 0, ts: Number(r.ts) || Date.now() };
  }
  const resp = await ckPost(cfg, 'query', {
    query: {
      recordType: 'RCFrame',
      filterBy: [{ fieldName: 'room', comparator: 'EQUALS', fieldValue: { value: cfg.room } }],
      sortBy: [{ fieldName: 'ts', ascending: false }],
    }, resultsLimit: 1,
  });
  const rec = resp.records && resp.records[0];
  if (!rec || !rec.fields || !rec.fields.jpeg) return null;
  const f = rec.fields;
  return { jpeg: f.jpeg.value, w: f.w ? Number(f.w.value) : 0, h: f.h ? Number(f.h.value) : 0, ts: f.ts ? Number(f.ts.value) : Date.now() };
}
async function backendWriteCmd(cfg, plain) {
  if (hasNativeCK) return nativeSave('RCCmd', plain);
  const f = {}; for (const k in plain) f[k] = { value: plain[k] };
  return ckPost(cfg, 'modify', { operations: [{ operationType: 'create', record: { recordType: 'RCCmd', fields: f } }] });
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
  const lastTsRef = useRef(0);
  const cfgRef = useRef(DEFAULT_CFG);
  const pollFrameRef = useRef(() => {});

  useEffect(() => {
    AsyncStorage.getItem(CFG_KEY).then((v) => {
      // start from the injected defaults; let any non-empty saved override win (⚙ edits persist)
      const stored = v ? (() => { try { return JSON.parse(v); } catch (e) { return {}; } })() : {};
      const c = { ...DEFAULT_CFG };
      for (const k of Object.keys(DEFAULT_CFG)) { if (stored[k] != null && stored[k] !== '') c[k] = stored[k]; }
      c.webAuthToken = stored.webAuthToken || DEFAULT_CFG.webAuthToken || '';
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
        if (fr.ts !== lastTsRef.current) { lastTsRef.current = fr.ts; setFrame(fr); }
        setStatus('connected');
      } else { setStatus('waiting for your PC…'); }
    } catch (e) { setStatus(String(e.message || e)); }
  }, []);

  useEffect(() => { pollFrameRef.current = pollFrame; }, [pollFrame]);

  const burstFrames = useCallback(() => {
    [400, 1000, 1800, 2800].forEach((ms) => setTimeout(() => pollFrameRef.current(), ms));
  }, []);

  // web path only: one-time Apple sign-in so the user can write (native doesn't need this).
  const beginSignIn = useCallback(async () => {
    const cfg = cfgRef.current;
    if (hasNativeCK) return;
    if (!cfg.container || !cfg.token) { setStatus('Set up iCloud first'); return; }
    try {
      const res = await fetch(`${ckBase(cfg, 'users', 'caller')}?ckAPIToken=${encodeURIComponent(cfg.token)}`, { method: 'GET' });
      const text = await res.text(); let j; try { j = JSON.parse(text); } catch (e) { j = {}; }
      if (j.redirectURL) { setAuthUrl(j.redirectURL); setStatus('sign in to control'); }
      else if (res.ok) { setStatus('already signed in'); }
      else { setStatus('sign-in unavailable: ' + (j.serverErrorCode || res.status)); }
    } catch (e) { setStatus(String(e.message || e)); }
  }, []);

  const completeSignIn = useCallback((token) => {
    if (!token) { setAuthUrl(null); return; }
    setCfg({ webAuthToken: token });
    setAuthUrl(null); setStatus('signed in — controls ready');
  }, [setCfg]);

  const sendCmd = useCallback(async (kind, extra = {}) => {
    const cfg = cfgRef.current;
    if (!cfg.container || !cfg.room || (!hasNativeCK && !cfg.token)) { setStatus('Set up iCloud first'); return; }
    const seq = ++seqRef.current;
    const plain = {
      room: cfg.room, seq, kind,
      x: extra.x || 0, y: extra.y || 0, dx: extra.dx || 0, dy: extra.dy || 0,
      text: extra.text || '', ts: Date.now(),
    };
    try {
      await backendWriteCmd(cfg, plain);
      burstFrames();
    } catch (e) {
      const m = String(e.message || e);
      setStatus(m);
      if (!hasNativeCK && !cfgRef.current.webAuthToken && /AUTHENTICATION_REQUIRED|authentication|unauthenticated|\b401\b|\b421\b/i.test(m)) beginSignIn();
    }
  }, [burstFrames, beginSignIn]);

  const connect = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setConnected(true); setStatus('connecting…');
    pollFrame();
    sendCmd('shot');
    pollRef.current = setInterval(pollFrame, 1300);
  }, [pollFrame, sendCmd]);

  const disconnect = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setConnected(false); setStatus('');
  }, []);

  // auto-connect on open when pre-configured
  useEffect(() => {
    if (!loaded || connected) return;
    const c = cfgRef.current;
    if (c.container && c.room && (hasNativeCK || c.token)) connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return {
    cfg, loaded, connected, status, frame, authUrl,
    native: hasNativeCK, signedIn: hasNativeCK || !!cfg.webAuthToken,
    setCfg, connect, disconnect, sendCmd, requestShot: () => sendCmd('shot'),
    beginSignIn, completeSignIn,
  };
}
