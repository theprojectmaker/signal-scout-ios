import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet, Image, PanResponder, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator, useWindowDimensions, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import Svg, { Path } from 'react-native-svg';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Updates from 'expo-updates';
import { useTheme } from '../../components/theme';
import { useICloudRemote, newRoom } from '../../components/icloudClient';
import TurboCanvas from '../../components/TurboCanvas';

// Captures the ckWebAuthToken whether CloudKit returns it in the URL or via postMessage.
const CAPTURE_JS = `(function(){
  function grab(h){ var m=(h||'').match(/[?&#]ckWebAuthToken=([^&#]+)/); if(m){ window.ReactNativeWebView.postMessage(JSON.stringify({t:'cwt',v:decodeURIComponent(m[1])})); return true; } return false; }
  grab(location.href);
  window.addEventListener('message', function(ev){ try{ var d=typeof ev.data==='string'?JSON.parse(ev.data):ev.data; if(d&&d.ckWebAuthToken){ window.ReactNativeWebView.postMessage(JSON.stringify({t:'cwt',v:d.ckWebAuthToken})); } }catch(e){} });
}()); true;`;
function tokenFromUrl(u) { const m = (u || '').match(/[?&#]ckWebAuthToken=([^&#]+)/); return m ? decodeURIComponent(m[1]) : null; }

// Keys grouped for the panel: [label, name the PC agent understands]. Combos follow the proven
// CTRL+C / ALTTAB patterns; the bridge upper-cases anything it doesn't alias, so new keys pass through.
const KEY_GROUPS = [
  ['Basics', [['Enter', 'ENTER'], ['Backspace', 'BACKSPACE'], ['Tab', 'TAB'], ['Esc', 'ESC'], ['Delete', 'DELETE'], ['Space', 'SPACE']]],
  ['Arrows & nav', [['↑', 'UP'], ['↓', 'DOWN'], ['←', 'LEFT'], ['→', 'RIGHT'], ['Home', 'HOME'], ['End', 'END'], ['PgUp', 'PAGEUP'], ['PgDn', 'PAGEDOWN']]],
  ['Edit', [['Ctrl+C', 'CTRL+C'], ['Ctrl+V', 'CTRL+V'], ['Ctrl+X', 'CTRL+X'], ['Ctrl+Z', 'CTRL+Z'], ['Ctrl+Y', 'CTRL+Y'], ['Ctrl+A', 'CTRL+A'], ['Ctrl+S', 'CTRL+S'], ['Ctrl+F', 'CTRL+F']]],
  ['Windows', [['Win', 'WIN'], ['Win+D', 'WIN+D'], ['Win+E', 'WIN+E'], ['Win+L', 'WIN+L'], ['Alt+Tab', 'ALTTAB'], ['Alt+F4', 'ALT+F4'], ['Task Mgr', 'TASKMGR'], ['PrtSc', 'PRINTSCREEN']]],
  ['Function', [['F2', 'F2'], ['F3', 'F3'], ['F5', 'F5'], ['F11', 'F11'], ['F12', 'F12']]],
];
const NAMES = { click: 'Click', dblclick: 'Double-click', rightclick: 'Right-click', move: 'Move', up: 'Drag', wheel: 'Scroll', type: 'Typing', key: 'Key', shot: 'Refresh', quality: 'Quality' };
const PIC_LABEL = { fast: 'Fast (fastest)', clear: 'Clear (sharper)', text: 'Text (crisp code)' };
const TQ_LABEL = { 0: 'Best (adapts to the link)', 2: 'Smooth (smaller, steadier)', 4: 'Fastest (smallest)' };
const MARK_COLOR = { sending: '#0A84FF', sent: '#FF9F0A', unconfirmed: '#FF9F0A', done: '#30D158', failed: '#FF453B', timeout: '#FF453B' };
const shortErr = (s) => String(s || '').replace(/^CloudKit \d+:\s*/, '').slice(0, 70);
const MAX_ZOOM = 6;

export default function ICloudRemoteScreen() {
  const t = useTheme();
  const s = styles(t);
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [mode, setMode] = useState('computer');   // 'computer' = your PC (classic) · 'turbo' = your PC (delta-tile engine, beta) · 'web' = the iCloud web browser (room WEB)
  // All three ride CloudKit. Computer and Turbo are the SAME room (your PC) read two different ways; Web is the
  // browser agent's room. Switching Computer <-> Turbo keeps the connection and just swaps the reader.
  const r = useICloudRemote(mode === 'web' ? 'WEB' : null, true, mode === 'turbo');
  const isTurbo = mode === 'turbo';
  const [boxDim, setBoxDim] = useState({ w: 0, h: 0 });   // layout size as STATE so rotating the iPad redraws the Turbo canvas

  const [menuOpen, setMenuOpen] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [screenPickOpen, setScreenPickOpen] = useState(false);
  const [barText, setBarText] = useState('');
  const [typed, setTyped] = useState('');
  const [dragMode, setDragMode] = useState(false);
  const [picMode, setPicMode] = useState('fast');   // fast | clear | text (PC picture quality)
  const [precision, setPrecision] = useState(false);   // trackpad-style fine movement (opt-in)
  const precisionRef = useRef(false);
  useEffect(() => { precisionRef.current = precision; }, [precision]);
  const [modePickOpen, setModePickOpen] = useState(false);

  // ---------- Chrome Remote Desktop-style immersive canvas ----------
  // The picture fills the whole screen; a top status pill and a bottom control pill float over it and
  // fade to a translucent ghost after a few seconds idle (never fully gone, so they're always findable),
  // coming back to full opacity the instant you touch the screen or press anything in them.
  const chromeOpacity = useRef(new Animated.Value(1)).current;
  const hideTimerRef = useRef(null);
  const showChrome = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    Animated.timing(chromeOpacity, { toValue: 1, duration: 140, useNativeDriver: true }).start();
    hideTimerRef.current = setTimeout(() => {
      Animated.timing(chromeOpacity, { toValue: 0.16, duration: 450, useNativeDriver: true }).start();
    }, 3200);
  }, [chromeOpacity]);
  useEffect(() => { showChrome(); return () => clearTimeout(hideTimerRef.current); }, [showChrome]);

  // ---------- zoom / pan ----------
  const box = useRef({ w: 1, h: 1 });
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const offRef = useRef({ x: 0, y: 0 });
  const applyZP = useCallback((z, x, y) => {
    const bw = box.current.w, bh = box.current.h;
    const zz = Math.max(1, Math.min(MAX_ZOOM, z));
    const mx = ((zz - 1) * bw) / 2, my = ((zz - 1) * bh) / 2;   // keep the picture from leaving the view
    const cx = Math.max(-mx, Math.min(mx, x)), cy = Math.max(-my, Math.min(my, y));
    zoomRef.current = zz; offRef.current = { x: cx, y: cy };
    setZoom(zz); setOff({ x: cx, y: cy });
  }, []);
  const zoomBy = useCallback((k) => {
    const z0 = zoomRef.current, z1 = Math.max(1, Math.min(MAX_ZOOM, z0 * k));
    const f = z1 / z0;
    applyZP(z1, offRef.current.x * f, offRef.current.y * f);   // zoom about the centre
  }, [applyZP]);

  // ---------- live refs for the (once-created) PanResponder ----------
  const frameRef = useRef(null);
  const sendRef = useRef(r.sendCmd);
  const dragModeRef = useRef(false);
  useEffect(() => { frameRef.current = r.frame; }, [r.frame]);
  useEffect(() => { sendRef.current = r.sendCmd; }, [r.sendCmd]);
  useEffect(() => { dragModeRef.current = dragMode; }, [dragMode]);
  const webRef = useRef(false);
  useEffect(() => { webRef.current = mode === 'web'; }, [mode]);   // web mode = touch-browser gestures
  // (auto-connect on open is handled inside the useICloudRemote hook)

  // box point → PC pixel, undoing zoom/pan then the letterbox
  const mapPt = useCallback((lx, ly) => {
    const f = frameRef.current;
    if (!f || !f.w || !f.h) return null;
    const bw = box.current.w, bh = box.current.h;
    const z = zoomRef.current, o = offRef.current;
    const cx = bw / 2, cy = bh / 2;
    const ix = cx + (lx - cx - o.x) / z, iy = cy + (ly - cy - o.y) / z;
    const scale = Math.min(bw / f.w, bh / f.h);
    const dw = f.w * scale, dh = f.h * scale;
    const ox = (bw - dw) / 2, oy = (bh - dh) / 2;
    const x = Math.round((ix - ox) / scale), y = Math.round((iy - oy) / scale);
    return { x: Math.max(0, Math.min(f.w, x)), y: Math.max(0, Math.min(f.h, y)) };
  }, []);

  // ---------- "did it go through?" feedback ----------
  // Each action becomes a ticket: sending (writing to iCloud) → sent (in iCloud, PC hasn't run it)
  // → done (the PC's receipt says it ran it) | failed | timeout | unconfirmed (old bridge).
  const [marks, setMarks] = useState([]);
  const marksRef = useRef([]);
  const markId = useRef(0);
  const inflight = useRef(0);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  // where the PC's mouse is headed, in PC pixels. It follows the finger INSTANTLY (no iCloud delay),
  // so you always see where the mouse will go; the real one catches up about a second later.
  const [cursor, setCursor] = useState(null);
  const cursorRef = useRef(null);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  const commit = useCallback(() => setMarks(marksRef.current.slice()), []);
  const showToast = useCallback((text, tone) => {
    setToast({ text, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  }, []);
  const patchMark = useCallback((id, patch) => {
    marksRef.current = marksRef.current.map((m) => (m.id === id ? { ...m, ...patch } : m));
    commit();
  }, [commit]);

  // fire(kind, extra, at, opts): send a command with feedback. `at` = {x,y} in box coords for the ring.
  const fire = useCallback((kind, extra, at, opts = {}) => {
    const id = ++markId.current;
    const name = opts.label || NAMES[kind] || kind;
    marksRef.current = [...marksRef.current.slice(-9), {
      id, kind, name, x: at ? at.x : null, y: at ? at.y : null,
      state: 'sending', t0: Date.now(), seq: 0, quiet: !!opts.quiet,
    }];
    commit();
    inflight.current++;
    Promise.resolve(sendRef.current(kind, extra)).then((res) => {
      inflight.current = Math.max(0, inflight.current - 1);
      if (res && res.ok) {
        patchMark(id, { state: 'sent', seq: res.seq, tSent: Date.now() });
        if (!opts.quiet) showToast(`${name} sent — waiting for the PC…`, 'wait');
      } else {
        patchMark(id, { state: 'failed', tDone: Date.now() });
        showToast(`✗ ${name} NOT sent${res && res.error ? ': ' + shortErr(res.error) : ''}`, 'bad');
      }
    }).catch(() => { inflight.current = Math.max(0, inflight.current - 1); });
  }, [commit, patchMark, showToast]);

  // fire-and-forget send with no ticket (cursor streaming); still counted for back-pressure
  const rawSend = useCallback((kind, extra) => {
    inflight.current++;
    Promise.resolve(sendRef.current(kind, extra)).finally(() => { inflight.current = Math.max(0, inflight.current - 1); });
  }, []);

  // settle tickets against the PC's receipts, time out the silent ones, clear the faded ones
  const settle = useCallback(() => {
    const f = frameRef.current;
    const ack = f && f.ack > 0 ? f.ack : 0;
    const now = Date.now();
    let changed = false;
    const next = marksRef.current.map((m) => {
      if (m.state === 'sending' && now - m.t0 > 20000) {
        changed = true; showToast(`✗ ${m.name} timed out before reaching iCloud`, 'bad');
        return { ...m, state: 'failed', tDone: now };
      }
      if (m.state === 'sent') {
        if (ack && m.seq && ack >= m.seq) {
          changed = true;
          if (!m.quiet) showToast(`✓ ${m.name} done on the PC · ${((now - m.t0) / 1000).toFixed(1)}s`, 'ok');
          return { ...m, state: 'done', tDone: now };
        }
        const age = now - (m.tSent || m.t0);
        if (ack && age > 15000) {
          changed = true; showToast(`✗ ${m.name}: no reply from the PC — is the bridge running?`, 'bad');
          return { ...m, state: 'timeout', tDone: now };
        }
        if (!ack && age > 3500) {
          changed = true; if (!m.quiet) showToast(`${m.name} sent — this bridge can’t confirm (update it)`, 'wait');
          return { ...m, state: 'unconfirmed', tDone: now };
        }
      }
      return m;
    }).filter((m) => !m.tDone || now - m.tDone < (m.state === 'done' ? 1300 : 2600));
    if (changed || next.length !== marksRef.current.length) { marksRef.current = next; commit(); }
    else marksRef.current = next;
  }, [commit, showToast]);

  useEffect(() => { settle(); }, [r.frame, settle]);          // a new frame may carry a receipt
  // live fps estimate from frame arrivals over the last ~2s (shown in the status line)
  const fpsRef = useRef([]);
  useEffect(() => {
    if (!r.frame || r.frame.cached) return;
    const now = Date.now();
    fpsRef.current = [...fpsRef.current.filter((x) => now - x < 2000), now];
  }, [r.frame]);
  const fps = fpsRef.current.length >= 3 ? Math.round(fpsRef.current.length / 2) : 0;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!r.connected) return undefined;
    const id = setInterval(() => { setTick((n) => n + 1); settle(); }, 500);
    return () => clearInterval(id);
  }, [r.connected, settle]);

  // ---------- touch: finger follows mouse · tap clicks · hold right-clicks · pinch zooms ----------
  const g = useRef({}).current;
  const dist = (a, b) => Math.hypot(a.locationX - b.locationX, a.locationY - b.locationY) || 1;
  const startPinch = (ts) => {
    clearTimeout(g.longTimer);
    if (g.tracking && dragModeRef.current) rawSend('up', {});   // never leave the button held
    g.tracking = false; g.multi = true;
    const a = ts[0], b = ts[1];
    const mx = (a.locationX + b.locationX) / 2, my = (a.locationY + b.locationY) / 2;
    const cx = box.current.w / 2, cy = box.current.h / 2;
    const z0 = zoomRef.current, o = offRef.current;
    g.pinch = { d0: dist(a, b), z0, ax: cx + (mx - cx - o.x) / z0, ay: cy + (my - cy - o.y) / z0 };
  };
  const updatePinch = (ts) => {
    const a = ts[0], b = ts[1], p = g.pinch;
    const mx = (a.locationX + b.locationX) / 2, my = (a.locationY + b.locationY) / 2;
    const cx = box.current.w / 2, cy = box.current.h / 2;
    const z = Math.max(1, Math.min(MAX_ZOOM, (p.z0 * dist(a, b)) / p.d0));
    // keep the picture point under the fingers' midpoint fixed while zooming/panning
    applyZP(z, mx - cx - z * (p.ax - cx), my - cy - z * (p.ay - cy));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        showChrome();
        const ts = e.nativeEvent.touches;
        g.moved = false; g.tracking = false; g.longFired = false; g.pinch = null; g.multi = false; g.last = null; g.webDragged = false;
        if (ts && ts.length >= 2) { startPinch(ts); return; }
        const { locationX: lx, locationY: ly } = e.nativeEvent;
        g.start = { lx, ly };
        g.longTimer = setTimeout(() => {
          if (g.moved || g.multi) return;
          const p = mapPt(lx, ly);
          if (p) { g.longFired = true; setCursor(p); fire('rightclick', p, { x: lx, y: ly }); }
        }, 450);
      },
      onPanResponderMove: (e, gs) => {
        const ts = e.nativeEvent.touches;
        if (ts && ts.length >= 2) { if (!g.pinch) startPinch(ts); else updatePinch(ts); return; }
        if (g.multi) return;                       // a pinch just ended — wait for a fresh touch
        if (webRef.current) {                       // WEB: a drag scrolls the page; a tap (on release) clicks
          const { locationX: wx, locationY: wy } = e.nativeEvent;
          if (!g.tracking) {
            if (Math.abs(gs.dx) < 12 && Math.abs(gs.dy) < 12) return;   // small jitter stays a tap
            g.tracking = true; g.webDragged = true; clearTimeout(g.longTimer);
            g.lastDragX = g.start.lx; g.lastDragY = g.start.ly;
          }
          const f = frameRef.current; if (!f) return;
          const scale = Math.min(box.current.w / f.w, box.current.h / f.h) || 1;
          const dY = wy - g.lastDragY, dX = wx - g.lastDragX;
          if ((Math.abs(dY) >= 6 || Math.abs(dX) >= 6) && inflight.current <= 3) {
            g.lastDragX = wx; g.lastDragY = wy;
            rawSend('wheel', { dy: Math.round(-(dY / scale)), dx: Math.round(-(dX / scale)) });   // natural scroll
          }
          return;
        }
        const { locationX: lx, locationY: ly } = e.nativeEvent;
        if (!g.tracking) {
          if (Math.abs(gs.dx) < 8 && Math.abs(gs.dy) < 8) return;
          g.moved = true; g.tracking = true; clearTimeout(g.longTimer);
          if (precisionRef.current) {              // trackpad mode: carry the cursor from where it is
            g.precPos = cursorRef.current || mapPt(g.start.lx, g.start.ly);
            g.precPrev = { lx, ly };
          }
          if (dragModeRef.current) {               // drag mode: grab at the start point, then carry it
            const p0 = precisionRef.current ? g.precPos : mapPt(g.start.lx, g.start.ly);
            if (p0) { rawSend('move', p0); rawSend('down', {}); }
          }
        }
        const p = mapPt(lx, ly);
        if (!p) return;
        let target = p;
        if (precisionRef.current && g.precPos && g.precPrev) {
          const pPrev = mapPt(g.precPrev.lx, g.precPrev.ly);
          const f = frameRef.current;
          if (pPrev && f) {
            const GAIN = 2.6;                        // finger travels 2.6× the mouse → fine, steady control
            const nx = Math.max(0, Math.min(f.w, g.precPos.x + (p.x - pPrev.x) / GAIN));
            const ny = Math.max(0, Math.min(f.h, g.precPos.y + (p.y - pPrev.y) / GAIN));
            target = { x: Math.round(nx), y: Math.round(ny) };
            g.precPos = target; g.precPrev = { lx, ly };
          }
        }
        setCursor(target);                           // the on-screen pointer follows with zero lag
        // the real mouse follows too — throttled, because every move is an iCloud write
        const now = Date.now(), L = g.last;
        if (L && (now - L.t < 300 || Math.hypot(lx - L.lx, ly - L.ly) < 4)) return;
        if (inflight.current > 4) return;          // back-pressure: don't pile up behind a slow link
        g.last = { t: now, lx, ly };
        rawSend('move', target);
      },
      onPanResponderRelease: (e) => {
        clearTimeout(g.longTimer);
        const { locationX: lx, locationY: ly } = e.nativeEvent;
        if (g.multi) { g.pinch = null; g.multi = false; return; }
        if (webRef.current) {                       // WEB: a drag was a scroll; anything else is a click
          if (g.longFired) { g.tracking = false; g.webDragged = false; return; }
          if (g.webDragged || g.tracking) { g.tracking = false; g.webDragged = false; return; }
          const p = mapPt(g.start.lx, g.start.ly);
          if (!p) return;
          setCursor(p);
          const now = Date.now(), lt = g.lastTap, at = { x: g.start.lx, y: g.start.ly };
          if (lt && now - lt.t < 320 && Math.hypot(g.start.lx - lt.lx, g.start.ly - lt.ly) < 30) {
            g.lastTap = null; fire('dblclick', p, at, { label: 'Double-click' });
          } else {
            g.lastTap = { t: now, lx: g.start.lx, ly: g.start.ly }; fire('click', p, at);
          }
          return;
        }
        if (g.tracking) {
          const p = (precisionRef.current && g.precPos) ? g.precPos : mapPt(lx, ly);
          if (dragModeRef.current) {
            if (p) rawSend('move', { ...p });
            fire('up', {}, { x: lx, y: ly }, { label: 'Drag' });
          } else if (p) {
            fire('move', { ...p, final: true }, { x: lx, y: ly }, { label: 'Move', quiet: true });
          }
          if (p) setCursor(p);
          g.tracking = false; g.precPos = null; g.precPrev = null;
          return;
        }
        if (g.longFired) return;                   // right-click already sent
        // a tap: in precision mode it clicks where the cursor already sits (trackpad-style); otherwise
        // where you tapped. Two quick taps in the same place = a real double-click (one PC command).
        const p = (precisionRef.current && cursorRef.current) ? cursorRef.current : mapPt(g.start.lx, g.start.ly);
        if (!p) return;
        setCursor(p);
        const now = Date.now(), lt = g.lastTap, at = { x: g.start.lx, y: g.start.ly };
        if (lt && now - lt.t < 320 && Math.hypot(g.start.lx - lt.lx, g.start.ly - lt.ly) < 30) {
          g.lastTap = null;
          fire('dblclick', p, at, { label: 'Double-click' });
        } else {
          g.lastTap = { t: now, lx: g.start.lx, ly: g.start.ly };
          fire('click', p, at);
        }
      },
      onPanResponderTerminate: () => {
        clearTimeout(g.longTimer);
        if (g.tracking && dragModeRef.current) rawSend('up', {});
        g.tracking = false; g.multi = false; g.pinch = null; g.precPos = null; g.precPrev = null; g.webDragged = false;
      },
    })
  ).current;

  // PC pixel → position on screen (through the letterbox, then the current zoom/pan)
  const curScreen = (() => {
    const f = r.frame;
    if (!cursor || !f || !f.w || !f.h) return null;
    const bw = box.current.w, bh = box.current.h;
    const scale = Math.min(bw / f.w, bh / f.h);
    const ix = (bw - f.w * scale) / 2 + cursor.x * scale;
    const iy = (bh - f.h * scale) / 2 + cursor.y * scale;
    const cx = bw / 2, cy = bh / 2;
    return { x: cx + off.x + zoom * (ix - cx), y: cy + off.y + zoom * (iy - cy) };
  })();

  const needsSetup = !r.cfg.container || !r.cfg.room || (!r.native && !r.cfg.token);
  const errish = /error|fail|401|403|AUTHENTICATION|unauthenticated|CloudKit \d/i.test(r.status || '');
  // A cached frame (shown instantly on reopen, before the stream resumes) isn't "stale" — it's the
  // last screen while we reconnect. Only live frames get an age / stale check.
  const turboLive = isTurbo && !!(r.turboView && r.turboView.base);
  const cachedOnly = !!(r.frame && r.frame.cached) && !turboLive;
  // Turbo is silent while the screen is still, so "age" there means "how long since the PC's index last answered".
  const frameAgeS = isTurbo
    ? (turboLive && r.turboInfo.aliveAt ? Math.max(0, Math.round((Date.now() - r.turboInfo.aliveAt) / 1000)) : null)
    : (r.frame && !cachedOnly ? Math.max(0, Math.round((Date.now() - (r.frame.rxAt || r.frame.ts)) / 1000)) : null);
  const stale = frameAgeS != null && frameAgeS > 40;
  const live = r.connected && !!r.frame && !errish && !stale;
  const dotColor = errish ? t.red : live ? t.green : r.connected ? '#FF9F0A' : t.label3;

  const doMenu = (fn) => () => { setMenuOpen(false); setTimeout(fn, 60); };
  const sendType = (enter) => {
    if (typed) fire('type', { text: typed }, null, { label: 'Typing' });
    if (enter) fire('key', { text: 'ENTER' }, null, { label: 'Enter' });
    setTyped('');
  };

  const title = mode === 'web' ? 'Web browser' : isTurbo ? 'Turbo β' : (r.native ? 'iCloud Remote' : 'iCloud Remote · web');
  const sub = cachedOnly
    ? (r.connected ? 'reconnecting…' : 'tap to resume')
    : (isTurbo && turboLive)
    ? (stale ? `no link for ${frameAgeS}s — check the PC bridge` : `Live · ${r.turboInfo.fps} fps · ${r.turboInfo.kbs} KB/s`)
    : r.frame
    ? (stale ? `frozen ${frameAgeS}s — check the PC bridge` : (frameAgeS <= 2 ? (fps >= 2 ? `Live · ${fps} fps` : 'Live') : `Live · ${frameAgeS}s`))
    : r.connected ? (errish ? 'can’t reach CloudKit' : 'waiting for your PC…') : 'not connected';

  const modeInfo = { computer: ['🖥', 'Computer'], turbo: ['⚡', 'Turbo β'], web: ['🌐', 'Web'] }[mode];

  return (
    <View style={s.safe}>
      <View
        style={s.screenWrap}
        onLayout={(e) => { const w = e.nativeEvent.layout.width, h = e.nativeEvent.layout.height; box.current = { w, h }; setBoxDim({ w, h }); }}
        {...pan.panHandlers}
      >
        {turboLive ? (
          <View style={[StyleSheet.absoluteFill, { transform: [{ translateX: off.x }, { translateY: off.y }, { scale: zoom }] }]} pointerEvents="none">
            <TurboCanvas view={r.turboView} boxW={boxDim.w} boxH={boxDim.h} />
          </View>
        ) : r.frame && r.frame.jpeg ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Image
              source={{ uri: `data:image/jpeg;base64,${r.frame.jpeg}` }}
              style={[s.frame, { transform: [{ translateX: off.x }, { translateY: off.y }, { scale: zoom }] }]}
              resizeMode="contain" fadeDuration={0}
            />
          </View>
        ) : !r.connected ? (
          <View style={[s.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <Text style={s.emptyTitle}>iCloud Remote</Text>
            <Text style={s.emptyHint}>Control your PC over iCloud — works on locked-down Wi-Fi.</Text>
            <Pressable style={[s.bigBtn, needsSetup && { opacity: 0.4 }]} disabled={needsSetup} onPress={r.connect}>
              <Text style={s.bigBtnTxt}>Connect</Text>
            </Pressable>
            {needsSetup ? <Text style={s.emptyMeta}>Open ••• → Settings to finish setup</Text> : null}
          </View>
        ) : (
          <View style={[s.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            {!errish && <ActivityIndicator color="#8a8a8a" />}
            <Text style={s.emptyTitle}>{errish ? 'Can’t reach CloudKit' : 'Waiting for your PC…'}</Text>
            {errish ? (
              <Text style={s.emptyErr}>{r.status}</Text>
            ) : (
              <>
                <Text style={s.emptyHint}>{mode === 'web' ? 'No page yet. On your PC, the web browser agent should be running:' : isTurbo ? 'Turbo is asking your PC for a fresh picture. If nothing appears in a few seconds, make sure the bridge is running (and up to date):' : 'No screenshot yet. On your PC, make sure the Remote agent is running, then run:'}</Text>
                <Text style={s.emptyCode}>node {mode === 'web' ? 'browser-agent.js' : 'icloud-agent.js'}</Text>
              </>
            )}
            <Text style={s.emptyMeta}>{`${r.native ? 'native' : 'web'} · env ${r.cfg.env} · room ${mode === 'web' ? 'WEB' : (r.cfg.room || '—')}`}</Text>
            {!r.native ? (
              <Text style={s.emptyWarn}>
                This version signs in through Apple’s web login, whose token expires every few minutes, so it can’t be kept reliable.
                Use the Remote tab (live, no sign-in) — or install the newest TestFlight build, which uses your iCloud account directly.
              </Text>
            ) : null}
          </View>
        )}

        {/* rings where you touched: blue sending → amber waiting for the PC → green done / red failed */}
        {marks.filter((m) => m.x != null).map((m) => (
          <View
            key={m.id} pointerEvents="none"
            style={[s.ring, m.kind === 'move' && s.ringSmall, { left: m.x - (m.kind === 'move' ? 11 : 20), top: m.y - (m.kind === 'move' ? 11 : 20), borderColor: MARK_COLOR[m.state] }]}
          >
            <Text style={[s.ringTxt, { color: MARK_COLOR[m.state] }]}>
              {m.state === 'done' ? '✓' : (m.state === 'failed' || m.state === 'timeout') ? '✕' : ''}
            </Text>
          </View>
        ))}
        {curScreen ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: curScreen.x, top: curScreen.y }}>
            <Svg width={22} height={28} viewBox="0 0 22 28">
              <Path d="M1.5 1.5 L1.5 21 L6.2 16.6 L9.6 24.6 L13 23.1 L9.6 15.2 L16.2 15.2 Z" fill="#ffffff" stroke="#0A84FF" strokeWidth={2} strokeLinejoin="round" />
            </Svg>
          </View>
        ) : null}

        {(dragMode || precision) ? (
          <View style={s.modeBadge} pointerEvents="none">
            <Text style={s.modeBadgeTxt}>{[dragMode && 'DRAG', precision && 'PRECISE'].filter(Boolean).join(' · ')}</Text>
          </View>
        ) : null}
        {zoom > 1.01 ? (
          <Pressable style={s.resetZoom} onPress={() => applyZP(1, 0, 0)}><Text style={s.resetZoomTxt}>{Math.round(zoom * 100)}%  ✕</Text></Pressable>
        ) : null}
        {/* ============ floating top pill — tap the mode chip to switch, ••• for everything else ============ */}
        <Animated.View pointerEvents="box-none" style={[s.floatTop, { top: insets.top + 8, opacity: chromeOpacity }]}>
          <View style={s.floatTopInner}>
            <Pressable onPress={() => { showChrome(); setModePickOpen(true); }} style={s.modeChip} hitSlop={4}>
              <View style={[s.dot, { backgroundColor: dotColor }]} />
              <Text style={s.modeChipTxt} numberOfLines={1}>{modeInfo[0]} {modeInfo[1]}</Text>
              <Text style={s.modeChipCaret}>▾</Text>
            </Pressable>
            <Text
              style={[s.floatStatusTxt, toast && { color: toast.tone === 'bad' ? t.red : toast.tone === 'ok' ? t.green : t.label, fontWeight: '700' }]}
              numberOfLines={1}
            >
              {toast ? toast.text : sub}
            </Text>
            <Pressable onPress={() => { showChrome(); setMenuOpen(true); }} hitSlop={10} style={s.menuBtn}>
              <Text style={s.menuDots}>•••</Text>
            </Pressable>
          </View>
        </Animated.View>

        {/* ============ floating bottom pill — the few controls used constantly; everything else lives in ••• ============ */}
        <Animated.View pointerEvents="box-none" style={[s.floatBottom, { bottom: insets.bottom + 14, opacity: chromeOpacity }]}>
          <View style={s.floatBottomInner}>
            <FloatBtn s={s} glyph="⌨" onPress={() => { showChrome(); setKbOpen(true); }} />
            <FloatBtn s={s} glyph="◎" on={precision} onPress={() => { showChrome(); const n = !precision; setPrecision(n); showToast(n ? 'Precision on — fine trackpad control' : 'Precision off', 'wait'); }} />
            <FloatBtn s={s} glyph="✋" on={dragMode} onPress={() => { showChrome(); setDragMode((v) => !v); }} />
            {zoom > 1.01 ? (
              <Pressable style={s.floatZoomChip} onPress={() => { showChrome(); applyZP(1, 0, 0); }}>
                <Text style={s.floatZoomTxt}>{Math.round(zoom * 100)}%  ✕</Text>
              </Pressable>
            ) : null}
            <FloatBtn s={s} glyph="•••" wide onPress={() => { showChrome(); setMenuOpen(true); }} />
          </View>
        </Animated.View>
      </View>

      {/* ============ mode picker ============ */}
      <Modal visible={modePickOpen} transparent animationType="fade" onRequestClose={() => setModePickOpen(false)}>
        <Pressable style={s.keysBackdrop} onPress={() => setModePickOpen(false)}>
          <Pressable style={s.keysCard} onPress={() => {}}>
            <View style={s.sheetHead}><Text style={s.sheetTitle}>Switch to</Text><Pressable onPress={() => setModePickOpen(false)} hitSlop={8}><Text style={s.sheetDone}>Done</Text></Pressable></View>
            {[['computer', '🖥  Computer'], ['turbo', '⚡  Turbo β'], ['web', '🌐  Web']].map(([m, label]) => (
              <Pressable key={m} style={s.screenRow} onPress={() => { setModePickOpen(false); setMode(m); }}>
                <Text style={[s.screenRowTxt, mode === m && { color: t.blue, fontWeight: '700' }]}>{label}{mode === m ? '   ✓' : ''}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ============ dropdown menu ============ */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={s.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={[s.menuCard, { top: insets.top + 44, maxHeight: winH - insets.top - 110 }]}>
            <ScrollView bounces={false}>
              <MenuItem s={s} label={isTurbo ? 'Repaint screen' : 'Refresh now'} onPress={doMenu(() => (isTurbo ? fire('tr', {}, null, { label: 'Repaint' }) : fire('shot', {}, null, { label: 'Refresh' })))} />
              <MenuItem s={s} label="Type text…" onPress={doMenu(() => setKbOpen(true))} />
              <MenuItem s={s} label="Scroll up" onPress={doMenu(() => fire('wheel', { dy: -300 }, null, { label: 'Scroll up' }))} />
              <MenuItem s={s} label="Scroll down" onPress={doMenu(() => fire('wheel', { dy: 300 }, null, { label: 'Scroll down' }))} />
              {mode === 'web' ? (
                <>
                  <MenuItem s={s} label="Back" onPress={doMenu(() => fire('key', { text: 'BrowserBack' }, null, { label: 'Back' }))} />
                  <MenuItem s={s} label="Reload" onPress={doMenu(() => fire('key', { text: 'BrowserReload' }, null, { label: 'Reload' }))} />
                  <MenuItem s={s} label="Home" onPress={doMenu(() => fire('key', { text: 'BrowserHome' }, null, { label: 'Home' }))} />
                </>
              ) : (
                <>
                  <MenuItem s={s} label="Screens…" onPress={doMenu(() => setScreenPickOpen(true))} />
                  {isTurbo
                    ? <MenuItem s={s} label="Repaint screen" onPress={doMenu(() => fire('tr', {}, null, { label: 'Repaint' }))} />
                    : <MenuItem s={s} label="HD boost" onPress={doMenu(() => fire('hd', {}, null, { label: 'HD boost' }))} />}
                </>
              )}
              {zoom > 1.01 ? <MenuItem s={s} label="Reset zoom" onPress={doMenu(() => applyZP(1, 0, 0))} /> : null}
              <MenuItem s={s} label="Gestures help" onPress={doMenu(() => showToast(mode === 'web' ? 'Tap the blue bar to type a URL · tap links · scroll with ▲▼ or a drag · pinch to zoom' : 'Move = mouse · tap = click · double-tap = double-click · hold = right-click · pinch = zoom · 2 fingers = pan', 'wait'))} />
              {isTurbo ? (
                <MenuItem s={s} label={`Turbo quality: ${TQ_LABEL[r.cfg.turboQ || 0]}`} accent
                  onPress={doMenu(() => { const order = [0, 2, 4]; const n = order[(order.indexOf(r.cfg.turboQ || 0) + 1) % 3]; r.setCfg({ turboQ: n }); fire('tq', { text: String(n) }, null, { label: `Quality: ${TQ_LABEL[n]}` }); })} />
              ) : (
                <MenuItem s={s} label={`Picture: ${PIC_LABEL[picMode]}`} accent={picMode !== 'fast'}
                  onPress={doMenu(() => { const order = ['fast', 'clear', 'text']; const n = order[(order.indexOf(picMode) + 1) % 3]; setPicMode(n); fire('quality', { text: n }, null, { label: `Picture: ${PIC_LABEL[n]}` }); })} />
              )}
              {mode === 'computer' ? (
                <MenuItem s={s} label={`Frame packing: ${r.cfg.packing ? 'ON · smoother' : 'off'}`} accent={!!r.cfg.packing}
                  onPress={doMenu(() => { const on = !r.cfg.packing; r.setCfg({ packing: on }); fire('pack', { text: on ? 'on' : 'off' }, null, { label: on ? 'Frame packing on' : 'Frame packing off' }); })} />
              ) : null}
              {r.connected && !r.signedIn ? <MenuItem s={s} label="Sign in to control" onPress={doMenu(r.beginSignIn)} /> : null}
              <MenuItem s={s} label="Live Remote (faster, normal Wi-Fi)" onPress={doMenu(() => router.push('/remote'))} />
              <MenuItem s={s} label="Error log" onPress={doMenu(() => setLogOpen(true))} />
              <MenuItem s={s} label="Settings" onPress={doMenu(() => setSetupOpen(true))} />
              {r.connected
                ? <MenuItem s={s} label="Disconnect" danger last onPress={doMenu(r.disconnect)} />
                : <MenuItem s={s} label="Connect" accent last disabled={needsSetup} onPress={doMenu(r.connect)} />}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* ============ type text ============ */}
      <Modal visible={kbOpen} transparent animationType="slide" onRequestClose={() => setKbOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kbWrap}>
          <View style={s.sheet}>
            <View style={s.sheetHead}><Text style={s.sheetTitle}>Type to PC</Text><Pressable onPress={() => setKbOpen(false)} hitSlop={8}><Text style={s.sheetDone}>Done</Text></Pressable></View>
            <TextInput style={s.kbInput} value={typed} onChangeText={setTyped} placeholder="Type here, then Send" placeholderTextColor={t.label3} autoFocus multiline autoCapitalize="none" autoCorrect={false} />
            <View style={s.kbBtns}>
              <Pressable style={[s.kbBtn, s.kbGhost]} onPress={() => fire('key', { text: 'BACKSPACE' }, null, { label: 'Backspace' })}><Text style={s.kbGhostTxt}>Backspace</Text></Pressable>
              <Pressable style={[s.kbBtn, s.kbGhost]} onPress={() => sendType(false)}><Text style={s.kbGhostTxt}>Send</Text></Pressable>
              <Pressable style={[s.kbBtn, s.kbBlue]} onPress={() => sendType(true)}><Text style={s.kbBlueTxt}>Send + Enter</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ============ keys ============ */}
      <Modal visible={keysOpen} transparent animationType="fade" onRequestClose={() => setKeysOpen(false)}>
        <Pressable style={s.keysBackdrop} onPress={() => setKeysOpen(false)}>
          <Pressable style={s.keysCard} onPress={() => {}}>
            <View style={s.sheetHead}><Text style={s.sheetTitle}>Keys</Text><Pressable onPress={() => setKeysOpen(false)} hitSlop={8}><Text style={s.sheetDone}>Done</Text></Pressable></View>
            <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
              {KEY_GROUPS.map(([group, ks]) => (
                <View key={group} style={{ marginBottom: 12 }}>
                  <Text style={s.keyGroupLabel}>{group}</Text>
                  <View style={s.keyGrid}>
                    {ks.map(([label, name]) => (
                      <Pressable key={name} style={s.keyBtn} onPress={() => fire('key', { text: name }, null, { label })}><Text style={s.keyTxt}>{label}</Text></Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ============ screen picker (multi-monitor) ============ */}
      <Modal visible={screenPickOpen} transparent animationType="fade" onRequestClose={() => setScreenPickOpen(false)}>
        <Pressable style={s.keysBackdrop} onPress={() => setScreenPickOpen(false)}>
          <Pressable style={s.keysCard} onPress={() => {}}>
            <View style={s.sheetHead}><Text style={s.sheetTitle}>Screens</Text><Pressable onPress={() => setScreenPickOpen(false)} hitSlop={8}><Text style={s.sheetDone}>Done</Text></Pressable></View>
            <Text style={s.fieldHint}>Pick a monitor to view, or see them all at once. Options past your monitor count simply do nothing.</Text>
            {[['0', '🖥  Screen 1'], ['1', '🖥  Screen 2'], ['2', '🖥  Screen 3'], ['full', '⊞  Both — all screens at once']].map(([v, label]) => (
              <Pressable key={v} style={s.screenRow} onPress={() => { setScreenPickOpen(false); fire('view', { text: v }, null, { label: label.replace(/^[^ ]+\s+/, '') }); }}>
                <Text style={s.screenRowTxt}>{label}</Text>
              </Pressable>
            ))}
            <Pressable style={[s.screenRow, { borderBottomWidth: 0 }]} onPress={() => { setScreenPickOpen(false); fire('view', {}, null, { label: 'Next screen' }); }}>
              <Text style={[s.screenRowTxt, { color: t.blue }]}>↻  Next screen</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ============ settings ============ */}
      <Modal visible={setupOpen} transparent animationType="slide" onRequestClose={() => setSetupOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kbWrap}>
          <View style={[s.sheet, { maxHeight: '85%' }]}>
            <View style={s.sheetHead}><Text style={s.sheetTitle}>Settings</Text><Pressable onPress={() => setSetupOpen(false)} hitSlop={8}><Text style={s.sheetDone}>Done</Text></Pressable></View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10 }}>
              <Field s={s} label="CloudKit container" value={r.cfg.container} onChange={(v) => r.setCfg({ container: v.trim() })} placeholder="iCloud.com.solyapps.signalscout" />
              {!r.native ? <Field s={s} label="API token (web path)" value={r.cfg.token} onChange={(v) => r.setCfg({ token: v.trim(), tokenManual: !!v.trim() })} placeholder="paste the ckAPIToken" /> : null}
              <View style={s.roomRow}>
                <View style={s.flex}><Field s={s} label="Room code (must match the PC)" value={r.cfg.room} onChange={(v) => r.setCfg({ room: v.trim().toUpperCase() })} placeholder="SOLYPC" /></View>
                <Pressable onPress={() => r.setCfg({ room: newRoom() })} style={s.genBtn}><Text style={s.genTxt}>New</Text></Pressable>
              </View>
              <View style={{ gap: 6 }}>
                <Text style={s.fieldLabel}>Environment (must match the PC)</Text>
                <View style={s.envBtns}>
                  {['development', 'production'].map((ev) => (
                    <Pressable key={ev} onPress={() => r.setCfg({ env: ev })} style={[s.envBtn, r.cfg.env === ev && s.envBtnOn]}>
                      <Text style={[s.envTxt, r.cfg.env === ev && s.envTxtOn]}>{ev === 'development' ? 'Development' : 'Production'}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <Text style={s.fieldHint}>
                {(r.native ? 'Using native iCloud (your device account — no token or sign-in).' : 'Using web iCloud — sending taps needs a one-time Apple sign-in.')}
                {'\nRun icloud-agent.js on your PC with the same room and environment.'}
              </Text>
              <View style={{ gap: 6, marginTop: 6 }}>
                <Text style={s.fieldLabel}>
                  App version: {Updates.createdAt ? new Date(Updates.createdAt).toLocaleString() : (Updates.isEnabled ? 'embedded' : 'dev')}
                </Text>
                <Pressable
                  style={s.genBtn}
                  onPress={async () => {
                    try {
                      const u = await Updates.checkForUpdateAsync();
                      if (u.isAvailable) { await Updates.fetchUpdateAsync(); await Updates.reloadAsync(); }
                      else { r.pushLog && r.pushLog('ok', 'app already up to date'); }
                    } catch (e) { r.pushLog && r.pushLog('error', 'update check: ' + (e && e.message ? e.message : e)); }
                  }}
                ><Text style={s.genTxt}>Check for update now</Text></Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ============ error log ============ */}
      <Modal visible={logOpen} transparent animationType="slide" onRequestClose={() => setLogOpen(false)}>
        <View style={s.kbWrap}>
          <View style={[s.sheet, { maxHeight: '82%' }]}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Error log</Text>
              <View style={{ flexDirection: 'row', gap: 18 }}>
                <Pressable onPress={async () => { await Clipboard.setStringAsync((r.log || []).map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.level} ${e.msg}`).join('\n')); }}><Text style={s.sheetDone}>Copy</Text></Pressable>
                <Pressable onPress={r.clearLog}><Text style={[s.sheetDone, { color: t.red }]}>Clear</Text></Pressable>
                <Pressable onPress={() => setLogOpen(false)}><Text style={s.sheetDone}>Done</Text></Pressable>
              </View>
            </View>
            <ScrollView style={{ maxHeight: 440 }}>
              {(r.log || []).length === 0
                ? <Text style={s.fieldHint}>No events yet. Connection, errors and confirmations show up here.</Text>
                : [...r.log].reverse().map((e, i) => (
                  <Text key={i} style={{ color: e.level === 'error' ? t.red : e.level === 'ok' ? t.green : t.label2, fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 3 }}>
                    {new Date(e.t).toLocaleTimeString()} · {e.msg}
                  </Text>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ============ Apple sign-in (web path) ============ */}
      <Modal visible={!!r.authUrl} animationType="slide" onRequestClose={() => r.completeSignIn(null)}>
        <SafeAreaView style={s.authSafe} edges={['top']}>
          <View style={s.authHead}>
            <Text style={s.sheetTitle}>Sign in to iCloud</Text>
            <Pressable onPress={() => r.completeSignIn(null)}><Text style={s.sheetDone}>Close</Text></Pressable>
          </View>
          {r.authUrl ? (
            <WebView
              source={{ uri: r.authUrl }}
              injectedJavaScript={CAPTURE_JS}
              onMessage={(e) => { try { const d = JSON.parse(e.nativeEvent.data); if (d.t === 'cwt' && d.v) r.completeSignIn(d.v); } catch (err) {} }}
              onShouldStartLoadWithRequest={(req) => { const tk = tokenFromUrl(req.url); if (tk) { r.completeSignIn(tk); return false; } return true; }}
              onNavigationStateChange={(nav) => { const tk = tokenFromUrl(nav.url); if (tk) r.completeSignIn(tk); }}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function MenuItem({ s, label, onPress, danger, accent, last, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [s.menuItem, !last && s.menuSep, pressed && { opacity: 0.55 }, disabled && { opacity: 0.35 }]}>
      <Text style={[s.menuTxt, danger && { color: s.red }, accent && { color: s.blue, fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}
function Field({ s, label, value, onChange, placeholder }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput style={s.fieldInput} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#999" autoCapitalize="none" autoCorrect={false} />
    </View>
  );
}
function DockBtn({ s, glyph, label, onPress, on }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.dockBtn, on && s.dockBtnOn, pressed && { opacity: 0.6 }]}>
      <Text style={[s.dockGlyph, on && s.dockOnTxt]}>{glyph}</Text>
      <Text style={[s.dockLabel, on && s.dockOnTxt]}>{label}</Text>
    </Pressable>
  );
}
function FloatBtn({ s, glyph, onPress, on, wide }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.floatBtn, wide && s.floatBtnWide, on && s.floatBtnOn, pressed && { opacity: 0.6 }]}>
      <Text style={[s.floatBtnGlyph, on && s.floatBtnOnTxt]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = (t) => {
  const st = StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
    center: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 6 },

    topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 10 },
    dotRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    topTxt: { flex: 1, color: t.label2, fontSize: 11 },
    menuBtn: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
    menuDots: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
    tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
    tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: t.card, borderWidth: StyleSheet.hairlineWidth, borderColor: t.sep },
    tabBtnOn: { backgroundColor: t.blue, borderColor: t.blue },
    tabTxt: { color: t.label2, fontSize: 13.5, fontWeight: '700' },
    tabTxtOn: { color: '#fff' },

    screenWrap: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },

    // Chrome-Remote-Desktop-style floating pills: the canvas fills the whole screen; these float over it
    // and fade to a translucent ghost when idle (see showChrome), so the picture — not the UI — dominates.
    floatTop: { position: 'absolute', left: 10, right: 10 },
    floatTopInner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(28,28,30,0.72)', borderRadius: 999, paddingLeft: 6, paddingRight: 6, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
    modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
    modeChipTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
    modeChipCaret: { color: 'rgba(255,255,255,0.55)', fontSize: 10 },
    floatStatusTxt: { flex: 1, color: 'rgba(255,255,255,0.72)', fontSize: 11, textAlign: 'center' },
    floatBottom: { position: 'absolute', alignSelf: 'center' },
    floatBottomInner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(28,28,30,0.72)', borderRadius: 999, padding: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
    floatBtn: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
    floatBtnWide: { width: 54 },
    floatBtnOn: { backgroundColor: '#0A84FF' },
    floatBtnGlyph: { color: '#fff', fontSize: 18 },
    floatBtnOnTxt: { color: '#fff' },
    floatZoomChip: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 12, height: 44, alignItems: 'center', justifyContent: 'center' },
    floatZoomTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
    frame: { width: '100%', height: '100%' },
    dock: { backgroundColor: t.bg, flexGrow: 0 },
    dockRow: { paddingHorizontal: 10, paddingVertical: 7, gap: 7, alignItems: 'center' },
    dockBtn: { minWidth: 54, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: t.card, borderWidth: StyleSheet.hairlineWidth, borderColor: t.sep, alignItems: 'center' },
    dockBtnOn: { backgroundColor: t.blue, borderColor: t.blue },
    dockGlyph: { color: t.label, fontSize: 16, lineHeight: 20 },
    dockLabel: { color: t.label3, fontSize: 9, fontWeight: '600', marginTop: 1 },
    dockOnTxt: { color: '#fff' },

    ring: { position: 'absolute', width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' },
    ringSmall: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
    ringTxt: { fontSize: 18, fontWeight: '900', marginTop: -1 },
    ghost: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#0A84FF', borderWidth: 2, borderColor: '#fff' },
    modeBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: '#0A84FF', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    modeBadgeTxt: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    resetZoom: { position: 'absolute', right: 12, bottom: 12, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    resetZoomTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
    toast: { position: 'absolute', left: 14, right: 14, top: 10, alignSelf: 'center', backgroundColor: 'rgba(40,40,44,0.95)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
    typeBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, backgroundColor: t.bg },
    typeBarInput: { flex: 1, backgroundColor: t.card, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, color: t.label, fontSize: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: t.sep },
    typeBarIcon: { paddingHorizontal: 6, paddingVertical: 6 },
    typeBarIconTxt: { fontSize: 20 },
    typeBarSend: { backgroundColor: t.blue, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
    typeBarSendTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
    typeBarGhost: { backgroundColor: t.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.sep },
    typeBarGhostTxt: { color: t.label, fontSize: 15, fontWeight: '600' },
    screenRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.sep },
    screenRowTxt: { color: t.label, fontSize: 16, fontWeight: '500' },
    toastOk: { backgroundColor: 'rgba(28,120,56,0.94)' },
    toastBad: { backgroundColor: 'rgba(170,40,32,0.95)' },
    toastTxt: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },

    emptyTitle: { color: '#e6e6e6', fontSize: 17, fontWeight: '700', marginTop: 6, textAlign: 'center' },
    emptyHint: { color: '#8a8a8a', fontSize: 12, textAlign: 'center', lineHeight: 17, maxWidth: 280 },
    emptyCode: { color: '#9bd94e', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },
    emptyErr: { color: '#ff6b60', fontSize: 12, textAlign: 'center', lineHeight: 17, maxWidth: 300 },
    emptyMeta: { color: '#6a6a6a', fontSize: 11, marginTop: 10 },
    emptyWarn: { color: '#e0b45a', fontSize: 12, textAlign: 'center', lineHeight: 17, maxWidth: 300, marginTop: 12 },
    bigBtn: { backgroundColor: t.blue, borderRadius: 12, paddingHorizontal: 34, paddingVertical: 13, marginTop: 14 },
    bigBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },

    menuBackdrop: { flex: 1 },
    menuCard: { position: 'absolute', right: 12, minWidth: 210, backgroundColor: t.card, borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: t.sep, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
    menuItem: { paddingVertical: 13, paddingHorizontal: 18 },
    menuSep: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.sep },
    menuTxt: { color: t.label, fontSize: 16 },

    kbWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
    sheet: { backgroundColor: t.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 12 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sheetTitle: { fontSize: 17, fontWeight: '700', color: t.label },
    sheetDone: { color: t.blue, fontSize: 16, fontWeight: '600' },
    kbInput: { backgroundColor: t.fill, borderRadius: 10, padding: 12, color: t.label, fontSize: 16, minHeight: 48 },
    kbBtns: { flexDirection: 'row', gap: 10 },
    kbBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    kbGhost: { backgroundColor: t.fill },
    kbGhostTxt: { color: t.label, fontSize: 15, fontWeight: '600' },
    kbBlue: { backgroundColor: t.blue, flex: 1.4 },
    kbBlueTxt: { color: t.onBlue, fontSize: 15, fontWeight: '700' },

    keysBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
    keysCard: { backgroundColor: t.card, borderRadius: 18, padding: 16, gap: 12 },
    keyGroupLabel: { color: t.label2, fontSize: 12, fontWeight: '600', marginBottom: 7 },
    keyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    keyBtn: { backgroundColor: t.fill, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
    keyTxt: { color: t.label, fontSize: 14, fontWeight: '600' },

    fieldLabel: { color: t.label2, fontSize: 12 },
    fieldInput: { backgroundColor: t.fill, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: t.label, fontSize: 14 },
    fieldHint: { color: t.label3, fontSize: 11, lineHeight: 16 },
    roomRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    genBtn: { backgroundColor: t.blue, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
    genTxt: { color: '#fff', fontWeight: '600' },
    envBtns: { flexDirection: 'row', gap: 8 },
    envBtn: { flex: 1, backgroundColor: t.fill, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    envBtnOn: { backgroundColor: t.blue },
    envTxt: { color: t.label2, fontSize: 13, fontWeight: '600' },
    envTxtOn: { color: '#fff' },

    authSafe: { flex: 1, backgroundColor: t.bg },
    authHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.sep },
  });
  st.red = t.red; st.blue = t.blue; // expose colours to MenuItem
  return st;
};
