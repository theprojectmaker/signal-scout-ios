// Remote-desktop transport for the Remote tab.
//
// Speaks the viewer protocol that the user's own Remote Control agent already serves
// (tests/remote-control: lan-server.js -> viewer-session.js). The agent plays host directly:
//   connect ws://<host>:<port>/join
//     <- {type:'joined'} {type:'need-auth'}
//     -> {cmd:'auth', password}
//     <- {type:'authenticated'} {type:'screen',w,h} {type:'mode',dataSaver,grayscale}
//     <- binary JPEG frames (FF D8…; a zoom-crop frame is prefixed with a 12-byte 'RGN1' header)
//     -> input: {cmd:'move',x,y} down/up click/rightclick{x,y} wheel{delta} type{text} key{name}
//        and set-data-saver/set-grayscale/clipboard-set/clipboard-get
// No new server protocol is invented and nothing here touches a web filter — it connects only
// to a PC the user runs the agent on, over their Wi-Fi (LAN, default port 8771) or relay.
//
// Built for a weak link: data-saver + grayscale are ON by default (the agent's tiny "trickle"
// frames), outbound input is a seq-numbered queue that survives drops and coalesces moves, and
// the socket reconnects with backoff. Byte counters make the data cost visible.

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

const BACKOFF_MIN = 800;
const BACKOFF_MAX = 15000;
const MAX_QUEUE = 200; // bounded; oldest non-critical events drop first on a dead link

export function useRemoteDesktop() {
  const [phase, setPhase] = useState('idle'); // idle|connecting|authing|ready|error|locked
  const [statusLabel, setStatusLabel] = useState('Not connected');
  const [frameUri, setFrameUri] = useState(null);
  const [screen, setScreen] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState({ dataSaver: true, grayscale: true });
  const [stats, setStats] = useState({ bytesIn: 0, bytesOut: 0, frames: 0 });
  const [clipboardText, setClipboardText] = useState(null);

  const ws = useRef(null);
  const want = useRef(false); // user wants to be connected (drives reconnect)
  const creds = useRef({ host: '', port: 8771, password: '' });
  const seq = useRef(0);
  const queue = useRef([]);
  const backoff = useRef(BACKOFF_MIN);
  const reconnectTimer = useRef(null);
  const bytesIn = useRef(0);
  const bytesOut = useRef(0);
  const frames = useRef(0);
  const lastFrameAt = useRef(0);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; hardClose(); if (reconnectTimer.current) clearTimeout(reconnectTimer.current); }, []);

  const bumpStats = useCallback(() => {
    if (!mounted.current) return;
    setStats({ bytesIn: bytesIn.current, bytesOut: bytesOut.current, frames: frames.current });
  }, []);

  function rawSend(obj) {
    const s = ws.current;
    if (!s || s.readyState !== 1) return false;
    try {
      const str = JSON.stringify(obj);
      s.send(str);
      bytesOut.current += str.length;
      return true;
    } catch (e) { return false; }
  }

  // Drain the outbound queue to the socket, coalescing is already done on enqueue.
  function flush() {
    const s = ws.current;
    if (!s || s.readyState !== 1) return;
    while (queue.current.length) {
      const msg = queue.current[0];
      if (!rawSend(msg)) break;
      queue.current.shift();
    }
    bumpStats();
  }

  // Public: enqueue an input/control message. Each gets a sequence number so the order is
  // explicit and nothing is silently lost; consecutive moves collapse to the latest.
  const sendInput = useCallback((msg) => {
    const m = { ...msg, seq: ++seq.current };
    const q = queue.current;
    if (m.cmd === 'move' && q.length && q[q.length - 1].cmd === 'move') {
      q[q.length - 1] = m; // only the newest cursor position matters
    } else {
      q.push(m);
      if (q.length > MAX_QUEUE) {
        // drop the oldest coalescible event (a move) to stay bounded; keep clicks/keys
        const i = q.findIndex((e) => e.cmd === 'move');
        q.splice(i >= 0 ? i : 0, 1);
      }
    }
    flush();
  }, []);

  function handleJSON(text) {
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    switch (msg.type) {
      case 'need-auth':
        setPhase('authing'); setStatusLabel('Signing in…');
        rawSend({ cmd: 'auth', password: creds.current.password });
        break;
      case 'authenticated':
        backoff.current = BACKOFF_MIN;
        setPhase('ready'); setStatusLabel('Connected');
        // Minimum-data defaults for a weak link, then flush anything queued while connecting.
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
      case 'clipboard':
        if (typeof msg.text === 'string') setClipboardText(msg.text);
        break;
      default:
        break; // joined / views / pong / text-probe — not needed here
    }
  }

  function handleFrame(buf) {
    const bytes = stripRegion(new Uint8Array(buf));
    bytesIn.current += bytes.length + 2; // +WS framing overhead, rough
    frames.current += 1;
    const now = Date.now();
    // Throttle re-render so a fast level can't flood the JS thread; data-saver is slow anyway.
    if (now - lastFrameAt.current >= 40) {
      lastFrameAt.current = now;
      setFrameUri('data:image/jpeg;base64,' + bytesToBase64(bytes));
    }
    bumpStats();
  }

  function open() {
    if (!mounted.current || !want.current) return;
    const { host, port } = creds.current;
    setPhase('connecting'); setStatusLabel(`Connecting to ${host}:${port}…`);
    let sock;
    try {
      sock = new WebSocket(`ws://${host}:${port}/join`);
    } catch (e) { scheduleReconnect(); return; }
    sock.binaryType = 'arraybuffer';
    ws.current = sock;
    sock.onopen = () => { /* wait for need-auth */ };
    sock.onmessage = (evt) => {
      const d = evt.data;
      if (typeof d === 'string') handleJSON(d);
      else if (d && d.byteLength !== undefined) handleFrame(d);
    };
    sock.onerror = () => { /* onclose follows */ };
    sock.onclose = () => {
      if (ws.current === sock) ws.current = null;
      if (want.current && mounted.current) { setPhase('connecting'); scheduleReconnect(); }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    const wait = backoff.current;
    backoff.current = Math.min(BACKOFF_MAX, Math.round(backoff.current * 1.7));
    setStatusLabel(`Reconnecting in ${Math.round(wait / 1000)}s…`);
    reconnectTimer.current = setTimeout(() => { if (want.current) open(); }, wait);
  }

  function hardClose() {
    const s = ws.current;
    ws.current = null;
    if (s) { try { s.onclose = null; s.onmessage = null; s.onerror = null; s.close(); } catch (e) {} }
  }

  const connect = useCallback((host, port, password) => {
    creds.current = { host: String(host || '').trim(), port: Number(port) || 8771, password: password || '' };
    if (!creds.current.host) { setPhase('error'); setStatusLabel('Enter your computer’s address'); return; }
    want.current = true;
    backoff.current = BACKOFF_MIN;
    queue.current = [];
    bytesIn.current = 0; bytesOut.current = 0; frames.current = 0; bumpStats();
    setFrameUri(null);
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    hardClose();
    open();
  }, [bumpStats]);

  const disconnect = useCallback(() => {
    want.current = false;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    hardClose();
    queue.current = [];
    setPhase('idle'); setStatusLabel('Not connected'); setFrameUri(null);
  }, []);

  const setDataSaver = useCallback((on) => { sendInput({ cmd: 'set-data-saver', on: !!on }); }, [sendInput]);
  const setGrayscale = useCallback((on) => { sendInput({ cmd: 'set-grayscale', on: !!on }); }, [sendInput]);
  const sendClipboard = useCallback((text) => { sendInput({ cmd: 'clipboard-set', text: String(text || '') }); }, [sendInput]);
  const requestClipboard = useCallback(() => { setClipboardText(null); sendInput({ cmd: 'clipboard-get' }); }, [sendInput]);

  return {
    phase, statusLabel, frameUri, screen, mode, stats, clipboardText,
    connect, disconnect, sendInput, setDataSaver, setGrayscale, sendClipboard, requestClipboard,
  };
}
