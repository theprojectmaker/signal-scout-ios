// Azure Remote — experimental THIRD transport for the remote screen (alongside CloudKit Computer/Web).
// Mailbox on Azure Blob Storage: the same frame-ring + command-ring idea as CloudKit, but over plain
// HTTPS to {account}.blob.core.windows.net, where a SAS token carries the auth — so the app just does
// GET/PUT, no signing. WHY: to test whether Azure is reachable on the locked school Wi-Fi AND faster
// than CloudKit's ~0.8s-per-op floor (a normal blob GET/PUT is ~50-150ms, so this could do more fps).
//
// Blobs (fixed names, no listing):
//   frame-<ROOM>-0..7 (+ legacy frame-<ROOM>): PC writes JSON {jpeg,seq,ts,w,h}; seq<0 is the receipt
//   cmd-<ROOM>-0..15: the app writes JSON {room,seq,kind,x,y,dx,dy,text,ts}
// Pairs with the PC bridge tests/remote-control/azure-agent.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const RC = (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.rc) || {};
const CFG_KEY = 'azure_remote_cfg_v1';
const FRAME_CACHE = 'azure_last_frame_v1';
const RING = 8, SLOTS = 16;
const DEFAULT_CFG = {
  base: RC.azureBase || '',        // https://ACCT.blob.core.windows.net/CONTAINER  (no trailing slash)
  sas: RC.azureSas || '',          // ?sv=...&sig=...   (with or without the leading ?)
  room: RC.room || 'SOLYPC',
};
const joinSas = (url, sas) => url + (sas ? (sas[0] === '?' ? sas : '?' + sas) : '');
const blobUrl = (c, name) => joinSas(`${c.base}/${name}`, c.sas);
const frameNames = (room) => [...Array.from({ length: RING }, (_, i) => `frame-${room}-${i}`), `frame-${room}`];
const cmdName = (room, seq) => `cmd-${room}-${seq % SLOTS}`;

async function azureGetJson(url, timeoutMs = 9000) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;                                   // 404 = not published yet
    const t = await res.text();
    try { return JSON.parse(t); } catch (e) { return null; }
  } catch (e) { return null; } finally { clearTimeout(timer); }
}
async function azurePut(url, body, timeoutMs = 9000) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json' }, body, signal: ctrl.signal });
    if (!res.ok) { const tx = await res.text().catch(() => ''); throw new Error(`Azure ${res.status}: ${tx.slice(0, 120)}`); }
    return true;
  } finally { clearTimeout(timer); }
}

export function useAzureRemote(enabled) {
  const [cfg, setCfgState] = useState(DEFAULT_CFG);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('');
  const [frame, setFrame] = useState(null);
  const cfgRef = useRef(DEFAULT_CFG);
  const seqRef = useRef(Date.now());
  const pollRef = useRef(null), keepRef = useRef(null), playRef = useRef(null);
  const bufRef = useRef([]), lastTsRef = useRef(0), lastAckRef = useRef(0), liveRef = useRef(false);
  const lastFrameObjRef = useRef(null), framePersistRef = useRef(0);
  const connectedRef = useRef(false);
  const pollFrameRef = useRef(() => {}), sendCmdRef = useRef(() => {});
  const logRef = useRef([]); const [log, setLog] = useState([]);

  const pushLog = useCallback((level, msg) => {
    const e = { t: Date.now(), level, msg: String(msg == null ? '' : msg).slice(0, 400) };
    logRef.current = [...logRef.current, e].slice(-150); setLog(logRef.current);
  }, []);
  const clearLog = useCallback(() => { logRef.current = []; setLog([]); }, []);
  const fail = useCallback((m) => { setStatus(String(m)); pushLog('error', m); }, [pushLog]);
  const ready = (c) => !!(c && c.base && c.sas && c.room);

  const persistFrame = useCallback((fr, force) => {
    lastFrameObjRef.current = fr; const now = Date.now();
    if (!force && now - framePersistRef.current < 4000) return;
    framePersistRef.current = now;
    AsyncStorage.setItem(FRAME_CACHE, JSON.stringify({ jpeg: fr.jpeg, w: fr.w, h: fr.h, ts: fr.ts })).catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(FRAME_CACHE).then((v) => {
      if (v && !lastFrameObjRef.current) { try { const fr = JSON.parse(v); if (fr && fr.jpeg) setFrame({ ...fr, rxAt: 0, cached: true, kb: Math.round((fr.jpeg.length * 0.75) / 1024) }); } catch (e) {} }
    }).catch(() => {});
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') { if (connectedRef.current) { pollFrameRef.current(); sendCmdRef.current('shot'); } }
      else if (lastFrameObjRef.current) persistFrame(lastFrameObjRef.current, true);
    });
    return () => sub.remove();
  }, [persistFrame]);

  useEffect(() => {
    AsyncStorage.getItem(CFG_KEY).then((v) => {
      const stored = v ? (() => { try { return JSON.parse(v); } catch (e) { return {}; } })() : {};
      const c = { ...DEFAULT_CFG };
      for (const k of Object.keys(DEFAULT_CFG)) if (stored[k] != null && stored[k] !== '') c[k] = stored[k];
      cfgRef.current = c; setCfgState(c); setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const setCfg = useCallback((patch) => {
    const c = { ...cfgRef.current, ...patch }; cfgRef.current = c; setCfgState(c);
    AsyncStorage.setItem(CFG_KEY, JSON.stringify(c)).catch(() => {});
  }, []);

  // one parallel read of the whole frame ring; enqueue new frames, play them through a jitter buffer
  const pollFrame = useCallback(async () => {
    const c = cfgRef.current; if (!ready(c)) return;
    try {
      const got = await Promise.all(frameNames(c.room).map((n) => azureGetJson(blobUrl(c, n))));
      const frames = got.filter((j) => j && j.jpeg).map((j) => {
        const seq = Number(j.seq) || 0;
        return { jpeg: j.jpeg, w: Number(j.w) || 0, h: Number(j.h) || 0, ts: Number(j.ts) || 0, ack: seq < 0 ? -seq : (Number(j.ack) || 0) };
      });
      if (!frames.length) { setStatus('waiting for your PC…'); return; }
      for (const f of frames) if (f.ack > lastAckRef.current) lastAckRef.current = f.ack;
      const fresh = frames.filter((f) => f.ts > lastTsRef.current).sort((a, b) => a.ts - b.ts);
      if (fresh.length) {
        lastTsRef.current = fresh[fresh.length - 1].ts;
        const buf = bufRef.current.concat(fresh);
        bufRef.current = buf.length > 8 ? buf.slice(-6) : buf;
      }
      setStatus('connected');
    } catch (e) { fail(e.message || e); }
  }, [fail]);
  useEffect(() => { pollFrameRef.current = pollFrame; }, [pollFrame]);
  useEffect(() => { connectedRef.current = connected; }, [connected]);

  useEffect(() => {
    if (!connected) return undefined;
    const id = setInterval(() => {
      const buf = bufRef.current; if (!buf.length) return;
      const f = buf.shift();
      const withMeta = { ...f, ack: lastAckRef.current, rxAt: Date.now(), kb: Math.round((f.jpeg.length * 0.75) / 1024) };
      setFrame(withMeta); persistFrame(withMeta);
      if (!liveRef.current) { liveRef.current = true; pushLog('ok', `Azure screen is live (${f.w}×${f.h})`); }
    }, 110);
    playRef.current = id; return () => { clearInterval(id); playRef.current = null; };
  }, [connected, persistFrame, pushLog]);

  const sendCmd = useCallback(async (kind, extra = {}) => {
    const c = cfgRef.current;
    if (!ready(c)) { setStatus('Set up Azure first'); return { ok: false, seq: 0, error: 'Set up Azure first' }; }
    const seq = ++seqRef.current;
    const plain = { room: c.room, seq, kind, x: extra.x || 0, y: extra.y || 0, dx: extra.dx || 0, dy: extra.dy || 0, text: extra.text || '', ts: Date.now() };
    try {
      await azurePut(blobUrl(c, cmdName(c.room, seq)), JSON.stringify(plain));
      if (kind !== 'move' || extra.final) [250, 650, 1200].forEach((ms) => setTimeout(() => pollFrameRef.current(), ms));
      return { ok: true, seq };
    } catch (e) {
      const m = String(e.message || e); setStatus(m); pushLog('error', `${kind} failed: ${m}`);
      return { ok: false, seq, error: m };
    }
  }, [pushLog]);
  useEffect(() => { sendCmdRef.current = sendCmd; }, [sendCmd]);

  const connect = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (keepRef.current) clearInterval(keepRef.current);
    liveRef.current = false; bufRef.current = []; lastTsRef.current = 0; lastAckRef.current = 0;
    const c = cfgRef.current; setConnected(true); setStatus('connecting…');
    pushLog('info', `Azure connecting · room ${c.room}`);
    pollFrame(); sendCmd('shot');
    pollRef.current = setInterval(pollFrame, 500);   // blob GET is fast (~100ms) — poll quicker than CloudKit
    let lastKeep = Date.now();
    keepRef.current = setInterval(() => {
      const fr = lastFrameObjRef.current;
      const age = fr && fr.rxAt ? Date.now() - fr.rxAt : Infinity;
      if (age > 2000 || Date.now() - lastKeep > 14000) { lastKeep = Date.now(); sendCmd('shot'); }
    }, 1200);
  }, [pollFrame, sendCmd, pushLog]);

  const disconnect = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (keepRef.current) { clearInterval(keepRef.current); keepRef.current = null; }
    setConnected(false); setStatus(''); pushLog('info', 'disconnected');
  }, [pushLog]);

  // auto-connect only while this transport is the ACTIVE one (enabled) and configured; disconnect when
  // the user switches away, so Azure never polls in the background behind the CloudKit modes.
  useEffect(() => {
    if (!loaded) return;
    if (enabled && !connectedRef.current && ready(cfgRef.current)) connect();
    if (!enabled && connectedRef.current) disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, enabled]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); if (keepRef.current) clearInterval(keepRef.current); }, []);

  return {
    cfg, loaded, connected, status, frame, authUrl: null,
    native: true, signedIn: true,
    setCfg, connect, disconnect, sendCmd, requestShot: () => sendCmd('shot'),
    beginSignIn: () => {}, completeSignIn: () => {},
    log, clearLog, pushLog,
  };
}
