// iCloud Remote — CloudKit Web Services client (pure JS, no native module).
// Both the iPad app and the home PC talk to the SAME CloudKit public database over HTTPS.
// On the locked work network only Apple hosts (incl. api.apple-cloudkit.com) are reachable,
// so this is the one channel that gets through. The PC runs icloud-agent.js at home.
//
// Record types (create these in CloudKit Console, World role = read+write, deploy to prod):
//   RCCmd   : room(String) seq(Int64) kind(String) x(Double) y(Double) dx(Double) dy(Double) text(String) ts(Int64)
//   RCFrame : room(String) seq(Int64) jpeg(String base64) w(Int64) h(Int64) ts(Int64)
//
// The app writes RCCmd (commands) and reads the newest RCFrame (screenshot). The PC does the reverse.

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CFG_KEY = 'icloud_remote_cfg_v1';
const DEFAULT_CFG = { container: '', token: '', env: 'development', room: '', webAuthToken: '' };

const ckBase = (cfg, kind, op) => `https://api.apple-cloudkit.com/database/1/${encodeURIComponent(cfg.container)}/${encodeURIComponent(cfg.env || 'development')}/public/${kind}/${op}`;
function ckUrl(cfg, op) {
  // Reads (query) work with just the apiToken (World = read). Writes (modify) need a signed-in
  // user — CloudKit forbids World write — so append the ckWebAuthToken captured at sign-in.
  let u = `${ckBase(cfg, 'records', op)}?ckAPIToken=${encodeURIComponent(cfg.token)}`;
  if (op === 'modify' && cfg.webAuthToken) u += `&ckWebAuthToken=${encodeURIComponent(cfg.webAuthToken)}`;
  return u;
}

async function ckPost(cfg, op, body, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ckUrl(cfg, op), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
    if (!res.ok) throw new Error(`CloudKit ${res.status}: ${json.serverErrorCode || text.slice(0, 120)}`);
    return json;
  } finally { clearTimeout(timer); }
}

// random short id for a pairing room
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
  const [frame, setFrame] = useState(null);     // { jpeg, w, h, ts }
  const [authUrl, setAuthUrl] = useState(null); // when set, the screen shows the Apple sign-in WebView
  const seqRef = useRef(Date.now());
  const pollRef = useRef(null);
  const lastTsRef = useRef(0);
  const cfgRef = useRef(DEFAULT_CFG);
  const pollFrameRef = useRef(() => {});

  useEffect(() => {
    AsyncStorage.getItem(CFG_KEY).then((v) => {
      if (v) { try { const c = { ...DEFAULT_CFG, ...JSON.parse(v) }; cfgRef.current = c; setCfgState(c); } catch (e) {} }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const setCfg = useCallback((patch) => {
    const c = { ...cfgRef.current, ...patch };
    cfgRef.current = c; setCfgState(c);
    AsyncStorage.setItem(CFG_KEY, JSON.stringify(c)).catch(() => {});
  }, []);

  const pollFrame = useCallback(async () => {
    const cfg = cfgRef.current;
    if (!cfg.container || !cfg.token || !cfg.room) return;
    try {
      const r = await ckPost(cfg, 'query', {
        query: {
          recordType: 'RCFrame',
          filterBy: [{ fieldName: 'room', comparator: 'EQUALS', fieldValue: { value: cfg.room } }],
          sortBy: [{ fieldName: 'ts', ascending: false }],
        },
        resultsLimit: 1,
      });
      const rec = r.records && r.records[0];
      if (rec && rec.fields && rec.fields.jpeg) {
        const ts = rec.fields.ts ? Number(rec.fields.ts.value) : Date.now();
        if (ts !== lastTsRef.current) {
          lastTsRef.current = ts;
          setFrame({
            jpeg: rec.fields.jpeg.value,
            w: rec.fields.w ? Number(rec.fields.w.value) : 0,
            h: rec.fields.h ? Number(rec.fields.h.value) : 0,
            ts,
          });
        }
        setStatus('connected');
      } else {
        setStatus('waiting for your PC…');
      }
    } catch (e) {
      setStatus(String(e.message || e));
    }
  }, []);

  useEffect(() => { pollFrameRef.current = pollFrame; }, [pollFrame]);

  // After any action, fetch fresh frames quickly instead of waiting for the steady poll.
  const burstFrames = useCallback(() => {
    [400, 1000, 1800, 2800].forEach((ms) => setTimeout(() => pollFrameRef.current(), ms));
  }, []);

  // CloudKit forbids World write, so sending commands needs a signed-in user. Fetch Apple's
  // sign-in URL; the screen opens it in a WebView and hands the captured token to completeSignIn.
  const beginSignIn = useCallback(async () => {
    const cfg = cfgRef.current;
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
    setAuthUrl(null);
    setStatus('signed in — controls ready');
  }, [setCfg]);

  const sendCmd = useCallback(async (kind, extra = {}) => {
    const cfg = cfgRef.current;
    if (!cfg.container || !cfg.token || !cfg.room) { setStatus('Set up iCloud first'); return; }
    const seq = ++seqRef.current;
    const f = {
      room: { value: cfg.room }, seq: { value: seq }, kind: { value: kind },
      x: { value: extra.x || 0 }, y: { value: extra.y || 0 },
      dx: { value: extra.dx || 0 }, dy: { value: extra.dy || 0 },
      text: { value: extra.text || '' }, ts: { value: Date.now() },
    };
    try {
      await ckPost(cfg, 'modify', {
        operations: [{ operationType: 'create', record: { recordType: 'RCCmd', fields: f } }],
      });
      burstFrames();
    } catch (e) {
      const m = String(e.message || e);
      setStatus(m);
      if (!cfgRef.current.webAuthToken && /AUTHENTICATION_REQUIRED|authentication|unauthenticated|\b401\b|\b421\b/i.test(m)) beginSignIn();
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

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return {
    cfg, loaded, connected, status, frame, authUrl, signedIn: !!cfg.webAuthToken,
    setCfg, connect, disconnect, sendCmd, requestShot: () => sendCmd('shot'),
    beginSignIn, completeSignIn,
  };
}
