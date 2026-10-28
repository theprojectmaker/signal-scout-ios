// Remote-desktop transport for the Remote tab.
//
// Speaks the viewer protocol that the user's own Remote Control agent already serves, over two
// paths that behave identically once connected (tests/remote-control):
//   LAN    ws://<ip>:<port>/join                 (same Wi-Fi, no internet, default port 8771)
//   Relay  wss://<relay>/join?code=CODE          (first pairing — the dashboard QR)
//          wss://<relay>/join?token=TOKEN        (a saved computer; token minted on first pairing)
//          wss://<relay>/join?hostId=ID          (open access — password is the gate)
// After connect: <-{type:'joined',hostId,deviceName,token?} (relay mints `token` when via=code)
//   <-{type:'need-auth'} ->{cmd:'auth',password} <-{type:'authenticated'} <-{screen}{mode}
//   <- binary JPEG frames (FF D8…; zoom-crop frames prefixed 'RGN1'+u16 x,y,w,h)
//   -> input: move{x,y} down/up click/rightclick{x,y} wheel{delta} type{text} key{name}
//      plus set-data-saver/set-grayscale/clipboard-set/clipboard-get
// No new server protocol and no filter circumvention — connects only to a PC the user runs the
// agent on. The relay endpoints are the agent's own public domains (no secret); the per-device
// hostId/token live only on this phone and in the QR.
//
// Built for a weak link: data-saver + grayscale ON by default (the agent's tiny "trickle"
// frames), seq-numbered outbound queue that coalesces moves and survives drops, and the socket
// cycles LAN->relay and reconnects with backoff. Byte counters make the data cost visible.

import { useCallback, useEffect, useRef, useState } from 'react';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// Standard base64 over raw bytes, no dependency — frames are small in data-saver mode.
function bytesToBase64(bytes) {
  const out = [];
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out.push(B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]);
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out.push(B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==');
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out.push(B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=');
  }
  return out.join('');
}

// A frame is a plain JPEG, or a zoom-crop prefixed with 'RGN1' + u16 x,y,w,h (12 bytes). We never
// request a region, so these are always full frames; strip the header defensively just in case.
const RGN = [0x52, 0x47, 0x4e, 0x31]; // 'RGN1'
function stripRegion(bytes) {
  if (bytes.length > 12 && bytes[0] === RGN[0] && bytes[1] === RGN[1] && bytes[2] === RGN[2] && bytes[3] === RGN[3]) {
    return bytes.subarray(12);
  }
  return bytes;
}

// The agent's own public relay domain (tests/remote-control agent.js RELAY_CANDIDATES). Only the
// live one is listed — remote.sitey.my and remote.scriptly.workers.dev went dead (DNS ENOTFOUND),
// and trying them just wasted seconds on a weak link. Keep this in sync with the agent.
export const RELAY_BASES = ['wss://remote.agentdomains.co'];

const BACKOFF_MIN = 800;
const BACKOFF_MAX = 15000;
const CONNECT_TIMEOUT = 5000; // give up on one target and try the next after this (weak-link friendly)
const MAX_QUEUE = 200;

export function useRemoteDesktop() {
  const [phase, setPhase] = useState('idle'); // idle|connecting|authing|ready|error|locked
  const [statusLabel, setStatusLabel] = useState('Not connected');
  const [frameUri, setFrameUri] = useState(null);
  const [screen, setScreen] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState({ dataSaver: true, grayscale: true });
  const [stats, setStats] = useState({ bytesIn: 0, bytesOut: 0, frames: 0 });
  const [clipboardText, setClipboardText] = useState(null);
  const [paired, setPaired] = useState(null); // {hostId, deviceName, token} from the last 'joined'
  const [views, setViews] = useState({ multiMonitor: false, current: null, list: [] }); // monitors

  const ws = useRef(null);
  const want = useRef(false);
  const targets = useRef([]); // ordered [{ url, label }]
  const idx = useRef(0);
  const triesInCycle = useRef(0);
  const authedSock = useRef(false); // did the CURRENT socket reach 'authenticated'
  const password = useRef('');
  const seq = useRef(0);
  const queue = useRef([]);
  const backoff = useRef(BACKOFF_MIN);
  const reconnectTimer = useRef(null);
  const attemptTimer = useRef(null);
  const bytesIn = useRef(0);
  const bytesOut = useRef(0);
  const frames = useRef(0);
  const lastFrameAt = useRef(0);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false; want.current = false; hardClose();
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (attemptTimer.current) clearTimeout(attemptTimer.current);
  }, []);

  const bumpStats = useCallback(() => {
    if (mounted.current) setStats({ bytesIn: bytesIn.current, bytesOut: bytesOut.current, frames: frames.current });
  }, []);

  function rawSend(obj) {
    const s = ws.current;
    if (!s || s.readyState !== 1) return false;
    try { const str = JSON.stringify(obj); s.send(str); bytesOut.current += str.length; return true; }
    catch (e) { return false; }
  }

  function flush() {
    const s = ws.current;
    if (!s || s.readyState !== 1) return;
    while (queue.current.length) { if (!rawSend(queue.current[0])) break; queue.current.shift(); }
    bumpStats();
  }

  // Public: enqueue an input/control message; each gets a sequence number so order is explicit
  // and nothing is silently lost. Consecutive moves collapse to the latest.
  const sendInput = useCallback((msg) => {
    const m = { ...msg, seq: ++seq.current };
    const q = queue.current;
    if (m.cmd === 'move' && q.length && q[q.length - 1].cmd === 'move') q[q.length - 1] = m;
    else {
      q.push(m);
      if (q.length > MAX_QUEUE) { const i = q.findIndex((e) => e.cmd === 'move'); q.splice(i >= 0 ? i : 0, 1); }
    }
    flush();
  }, []);

  function handleJSON(msg) {
    switch (msg.type) {
      case 'joined':
        setPaired({ hostId: msg.hostId || null, deviceName: msg.deviceName || null, token: msg.token || null });
        break;
      case 'need-auth':
        setPhase('authing'); setStatusLabel('Signing in…');
        rawSend({ cmd: 'auth', password: password.current });
        break;
      case 'authenticated':
        setPhase('ready'); setStatusLabel('Connected');
        rawSend({ cmd: 'set-data-saver', on: true });
        rawSend({ cmd: 'set-grayscale', on: true });
        flush();
        break;
      case 'auth-failed':
        want.current = false; setPhase('error');
        setStatusLabel(`Wrong password${typeof msg.attemptsLeft === 'number' ? ` · ${msg.attemptsLeft} left` : ''}`);
        hardClose();
        break;
      case 'auth-locked':
        want.current = false; setPhase('locked');
        setStatusLabel('Locked — too many tries. Wait and retry.');
        hardClose();
        break;
      case 'screen':
        if (msg.w && msg.h) setScreen({ w: msg.w, h: msg.h });
        break;
      case 'mode':
        setMode({ dataSaver: !!msg.dataSaver, grayscale: !!msg.grayscale });
        break;
      case 'views':
        setViews({ multiMonitor: !!msg.multiMonitor, current: msg.current ?? null, list: Array.isArray(msg.views) ? msg.views : [] });
        break;
      case 'clipboard':
        if (typeof msg.text === 'string') setClipboardText(msg.text);
        break;
      case 'host-left':
        setStatusLabel('Computer went offline');
        break;
      default:
        break; // views / pong / text-probe / phone-joined / webrtc-* — not needed here
    }
  }

  function handleFrame(buf) {
    const bytes = stripRegion(new Uint8Array(buf));
    bytesIn.current += bytes.length + 2;
    frames.current += 1;
    const now = Date.now();
    if (now - lastFrameAt.current >= 40) {
      lastFrameAt.current = now;
      setFrameUri('data:image/jpeg;base64,' + bytesToBase64(bytes));
    }
    bumpStats();
  }

  function open() {
    if (!mounted.current || !want.current || targets.current.length === 0) return;
    const target = targets.current[idx.current % targets.current.length];
    setPhase('connecting');
    setStatusLabel(`Connecting${target.label ? ` · ${target.label}` : ''}…`);
    let sock;
    try { sock = new WebSocket(target.url); } catch (e) { failTarget(); return; }
    sock.binaryType = 'arraybuffer';
    ws.current = sock;
    authedSock.current = false;

    if (attemptTimer.current) clearTimeout(attemptTimer.current);
    attemptTimer.current = setTimeout(() => {
      if (ws.current === sock && !authedSock.current) { try { sock.close(); } catch (e) {} }
    }, CONNECT_TIMEOUT);

    sock.onopen = () => { /* wait for joined / need-auth */ };
    sock.onmessage = (evt) => {
      const d = evt.data;
      if (typeof d === 'string') {
        let msg; try { msg = JSON.parse(d); } catch (e) { return; }
        if (msg.type === 'authenticated') {
          authedSock.current = true;
          triesInCycle.current = 0;
          backoff.current = BACKOFF_MIN;
          if (attemptTimer.current) { clearTimeout(attemptTimer.current); attemptTimer.current = null; }
          // Pin the working target so a later reconnect tries it first.
          targets.current = [target, ...targets.current.filter((x) => x.url !== target.url)];
          idx.current = 0;
        }
        handleJSON(msg);
      } else if (d && d.byteLength !== undefined) {
        handleFrame(d);
      }
    };
    sock.onerror = () => { /* onclose follows */ };
    sock.onclose = () => {
      if (ws.current === sock) ws.current = null;
      if (attemptTimer.current) { clearTimeout(attemptTimer.current); attemptTimer.current = null; }
      if (!want.current || !mounted.current) return;
      if (authedSock.current) { setPhase('connecting'); scheduleSameTarget(); } // lost an established link
      else failTarget(); // this target never authed — try the next one
    };
  }

  // Move to the next target; after a full lap with no success, back off before the next lap.
  function failTarget() {
    idx.current += 1;
    triesInCycle.current += 1;
    let wait = 300;
    if (triesInCycle.current >= targets.current.length) {
      triesInCycle.current = 0;
      wait = backoff.current;
      backoff.current = Math.min(BACKOFF_MAX, Math.round(backoff.current * 1.7));
      setStatusLabel(`No answer — retrying in ${Math.round(wait / 1000)}s…`);
    }
    schedule(wait);
  }

  function scheduleSameTarget() {
    const wait = backoff.current;
    backoff.current = Math.min(BACKOFF_MAX, Math.round(backoff.current * 1.7));
    setStatusLabel(`Reconnecting in ${Math.round(wait / 1000)}s…`);
    schedule(wait);
  }

  function schedule(wait) {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(() => { if (want.current) open(); }, wait);
  }

  function hardClose() {
    const s = ws.current;
    ws.current = null;
    if (s) { try { s.onclose = null; s.onmessage = null; s.onerror = null; s.close(); } catch (e) {} }
  }

  // Public: connect using an ordered list of targets [{url,label}] (LAN first, then relay).
  const connect = useCallback((targetList, pass) => {
    const list = (targetList || []).filter((x) => x && x.url);
    if (list.length === 0) { setPhase('error'); setStatusLabel('Nothing to connect to'); return; }
    password.current = pass || '';
    targets.current = list;
    idx.current = 0; triesInCycle.current = 0; backoff.current = BACKOFF_MIN;
    want.current = true;
    queue.current = [];
    bytesIn.current = 0; bytesOut.current = 0; frames.current = 0; bumpStats();
    setFrameUri(null); setPaired(null);
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (attemptTimer.current) clearTimeout(attemptTimer.current);
    hardClose();
    open();
  }, [bumpStats]);

  const disconnect = useCallback(() => {
    want.current = false;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (attemptTimer.current) clearTimeout(attemptTimer.current);
    hardClose();
    queue.current = [];
    setPhase('idle'); setStatusLabel('Not connected'); setFrameUri(null);
  }, []);

  const setDataSaver = useCallback((on) => sendInput({ cmd: 'set-data-saver', on: !!on }), [sendInput]);
  const setGrayscale = useCallback((on) => sendInput({ cmd: 'set-grayscale', on: !!on }), [sendInput]);
  const sendClipboard = useCallback((text) => sendInput({ cmd: 'clipboard-set', text: String(text || '') }), [sendInput]);
  const requestClipboard = useCallback(() => { setClipboardText(null); sendInput({ cmd: 'clipboard-get' }); }, [sendInput]);
  const selectView = useCallback((view) => sendInput({ cmd: 'select-view', view }), [sendInput]);

  return {
    phase, statusLabel, frameUri, screen, mode, stats, clipboardText, paired, views,
    connect, disconnect, sendInput, setDataSaver, setGrayscale, sendClipboard, requestClipboard, selectView,
  };
}

// ---- helpers the screen uses to turn a scanned QR / saved computer into connect targets ----

// Parse a scanned QR into connection info. The agent's dashboard shows two kinds:
//   LAN   "http://192.168.1.50:8771"                           -> { lan:{host,port} }
//   Relay "https://remote-control-xxx.pages.dev/?code=ABC123"  -> { code }
export function parseQr(data) {
  const s = String(data || '').trim();
  if (!s) return null;
  // bare "host:port" or "host"
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(s)) {
    const [host, port] = s.split(':');
    return { lan: { host, port: Number(port) || 8771 } };
  }
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  const code = u.searchParams.get('code');
  if (code) return { code: code.toUpperCase().trim() };
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    if (u.hostname && (/^\d/.test(u.hostname) || u.hostname.endsWith('.local'))) {
      return { lan: { host: u.hostname, port: Number(u.port) || 8771 } };
    }
  }
  return null;
}

// Build the ordered target list for a saved computer: LAN first (fast, no data), then relay by
// token (saved device), then relay by hostId (open access), across every relay base.
export function targetsForComputer(c) {
  const list = [];
  if (c.lan && c.lan.host) list.push({ url: `ws://${c.lan.host}:${c.lan.port || 8771}/join`, label: 'Wi-Fi' });
  for (const base of RELAY_BASES) {
    if (c.relay && c.relay.token) list.push({ url: `${base}/join?token=${encodeURIComponent(c.relay.token)}`, label: 'Relay' });
    if (c.id) list.push({ url: `${base}/join?hostId=${encodeURIComponent(c.id)}`, label: 'Relay' });
  }
  return list;
}

// Targets for a brand-new pairing straight from a scanned QR (before we know hostId/token).
export function targetsForScan(info) {
  if (info.lan) return [{ url: `ws://${info.lan.host}:${info.lan.port || 8771}/join`, label: 'Wi-Fi' }];
  if (info.code) return RELAY_BASES.map((base) => ({ url: `${base}/join?code=${encodeURIComponent(info.code)}`, label: 'Relay' }));
  return [];
}
