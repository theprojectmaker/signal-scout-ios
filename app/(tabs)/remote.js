import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, Modal, Image, PanResponder,
  StyleSheet, Alert, Platform, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from '../../components/theme';
import { useRemoteDesktop, parseQr, targetsForComputer, targetsForScan } from '../../components/remoteClient';

const COMPUTERS_KEY = 'remote.computers.v2';

// On-screen key buttons -> the agent's SPECIAL_KEY names (tests/remote-control/agent.js).
const MACROS = [
  ['Esc', 'ESC'], ['Tab', 'TAB'], ['Enter', 'ENTER'], ['Back', 'BACKSPACE'], ['Del', 'DELETE'],
  ['▲', 'UP'], ['▼', 'DOWN'], ['◀', 'LEFT'], ['▶', 'RIGHT'],
  ['Copy', 'CTRL+C'], ['Paste', 'CTRL+V'], ['Undo', 'CTRL+Z'], ['All', 'CTRL+A'],
  ['Alt+Tab', 'ALTTAB'], ['Win', 'WIN'], ['Lock', 'LOCK'], ['Task Mgr', 'TASKMGR'],
];

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function loadComputers() {
  try { const raw = await AsyncStorage.getItem(COMPUTERS_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
async function persistComputers(list) {
  try { await AsyncStorage.setItem(COMPUTERS_KEY, JSON.stringify(list)); } catch (e) {}
}

export default function RemoteScreen() {
  const t = useTheme();
  const r = useRemoteDesktop();
  const s = styles(t);

  const [computers, setComputers] = useState([]);
  const [view, setView] = useState('home'); // home | scan | connect
  const [perm, requestPerm] = useCameraPermissions();

  // the connection the user is setting up (chosen saved computer, or a fresh scan)
  const [pendingName, setPendingName] = useState('');
  const [password, setPassword] = useState('');
  const pendingRef = useRef(null); // { targets, lan, existingId, save }
  const scannedOnce = useRef(false);

  // keyboard / keys / typing
  const [kbOpen, setKbOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => { loadComputers().then(setComputers); }, []);

  // When a connection reports its stable identity, save/merge the computer so next time it's
  // one tap + password. We never store the password.
  useEffect(() => {
    const p = r.paired;
    const pend = pendingRef.current;
    if (!p || !p.hostId || !pend || !pend.save) return;
    setComputers((prev) => {
      const list = prev.slice();
      const i = list.findIndex((c) => c.id === p.hostId);
      const base = i >= 0 ? list[i] : { id: p.hostId, addedAt: Date.now() };
      const merged = {
        ...base,
        name: p.deviceName || base.name || 'Computer',
        lan: pend.lan || base.lan || null,
        relay: p.token ? { token: p.token } : (base.relay || null),
        lastUsed: Date.now(),
      };
      if (i >= 0) list[i] = merged; else list.unshift(merged);
      persistComputers(list);
      return list;
    });
    // only save once per pairing
    pendingRef.current = { ...pend, save: false, existingId: p.hostId };
  }, [r.paired]);

  const ready = r.phase === 'ready';
  const busy = r.phase === 'connecting' || r.phase === 'authing';

  // ---- gesture -> remote input ----
  const boxRef = useRef({ w: 0, h: 0 });
  const screenRef = useRef(r.screen); screenRef.current = r.screen;
  const sendRef = useRef(r.sendInput); sendRef.current = r.sendInput;
  const startRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const longFiredRef = useRef(false);
  const scrolledRef = useRef(false);
  const pinchRef = useRef(null); // { dist, mx, my } between two-finger moves
  const lastMoveRef = useRef(0);
  const longTimer = useRef(null);
  const clearLong = () => { if (longTimer.current) { clearTimeout(longTimer.current); longTimer.current = null; } };

  // Local zoom/pan of the received frame (like a real remote app). Transform on the Image is
  // [{translateX},{translateY},{scale}] about its centre; toRemote() inverts exactly that.
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1); zoomRef.current = zoom;
  const offsetRef = useRef({ x: 0, y: 0 }); offsetRef.current = offset;

  const applyZP = useCallback((z, px, py) => {
    const b = boxRef.current;
    const nz = Math.max(1, Math.min(8, z));
    const maxX = (nz - 1) * b.w / 2, maxY = (nz - 1) * b.h / 2;
    const nx = Math.max(-maxX, Math.min(maxX, px));
    const ny = Math.max(-maxY, Math.min(maxY, py));
    zoomRef.current = nz; offsetRef.current = { x: nx, y: ny };
    setZoom(nz); setOffset({ x: nx, y: ny });
  }, []);

  // reset zoom whenever the remote screen (or monitor) changes size
  useEffect(() => { applyZP(1, 0, 0); }, [r.screen.w, r.screen.h, applyZP]);

  const toRemote = (lx, ly) => {
    const b = boxRef.current, sc = screenRef.current;
    if (!b.w || !b.h || !sc.w || !sc.h) return null;
    const cx = b.w / 2, cy = b.h / 2, z = zoomRef.current, p = offsetRef.current;
    const ux = cx + (lx - cx - p.x) / z; // undo pan+scale (origin = centre)
    const uy = cy + (ly - cy - p.y) / z;
    const imgA = sc.w / sc.h, boxA = b.w / b.h;
    let dW, dH, offX, offY;
    if (boxA > imgA) { dH = b.h; dW = b.h * imgA; offX = (b.w - dW) / 2; offY = 0; }
    else { dW = b.w; dH = b.w / imgA; offX = 0; offY = (b.h - dH) / 2; }
    const x = Math.max(0, Math.min(sc.w - 1, Math.round((ux - offX) / dW * sc.w)));
    const y = Math.max(0, Math.min(sc.h - 1, Math.round((uy - offY) / dH * sc.h)));
    return { x, y };
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const n = e.nativeEvent;
        startRef.current = { x: n.locationX, y: n.locationY };
        draggingRef.current = false; longFiredRef.current = false; scrolledRef.current = false; pinchRef.current = null;
        const rc = toRemote(n.locationX, n.locationY);
        if (rc) sendRef.current({ cmd: 'move', x: rc.x, y: rc.y });
        clearLong();
        longTimer.current = setTimeout(() => {
          if (!draggingRef.current && !scrolledRef.current && rc) { longFiredRef.current = true; sendRef.current({ cmd: 'rightclick', x: rc.x, y: rc.y }); }
        }, 500);
      },
      onPanResponderMove: (e, g) => {
        const n = e.nativeEvent;
        if (g.numberActiveTouches >= 2) {
          // two fingers: pinch = zoom (+ pan by the midpoint); parallel drag while NOT zoomed
          // = scroll the remote; while zoomed = pan the view.
          clearLong(); scrolledRef.current = true;
          const ts = n.touches;
          if (!ts || ts.length < 2) return;
          const ax = ts[0].pageX, ay = ts[0].pageY, bx = ts[1].pageX, by = ts[1].pageY;
          const dist = Math.hypot(ax - bx, ay - by);
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          const prev = pinchRef.current;
          pinchRef.current = { dist, mx, my };
          if (!prev) return;
          const dScale = prev.dist ? dist / prev.dist : 1;
          const dmx = mx - prev.mx, dmy = my - prev.my;
          if (Math.abs(dist - prev.dist) > 4 || zoomRef.current > 1.01) {
            applyZP(zoomRef.current * dScale, offsetRef.current.x + dmx, offsetRef.current.y + dmy);
          } else if (Math.abs(dmy) >= 2) {
            sendRef.current({ cmd: 'wheel', delta: Math.round(-dmy * 2) });
          }
          return;
        }
        if (scrolledRef.current) return; // a multi-touch gesture happened; don't also move the pointer
        const rc = toRemote(n.locationX, n.locationY);
        if (!rc) return;
        if (!draggingRef.current) {
          if (Math.hypot(n.locationX - startRef.current.x, n.locationY - startRef.current.y) > 8) {
            draggingRef.current = true; clearLong();
            sendRef.current({ cmd: 'move', x: rc.x, y: rc.y }); sendRef.current({ cmd: 'down' });
          }
          return;
        }
        const now = Date.now();
        if (now - lastMoveRef.current > 28) { sendRef.current({ cmd: 'move', x: rc.x, y: rc.y }); lastMoveRef.current = now; }
      },
      onPanResponderRelease: () => {
        clearLong();
        if (draggingRef.current) sendRef.current({ cmd: 'up' });
        else if (!longFiredRef.current && !scrolledRef.current) {
          const rc = toRemote(startRef.current.x, startRef.current.y);
          if (rc) sendRef.current({ cmd: 'click', x: rc.x, y: rc.y });
        }
        draggingRef.current = false; pinchRef.current = null;
      },
      onPanResponderTerminate: () => { clearLong(); if (draggingRef.current) sendRef.current({ cmd: 'up' }); draggingRef.current = false; pinchRef.current = null; },
    })
  ).current;

  // ---- fetched clipboard from PC -> this phone ----
  useEffect(() => {
    if (r.clipboardText != null) { Clipboard.setStringAsync(r.clipboardText).catch(() => {}); Alert.alert('Clipboard from PC', r.clipboardText.slice(0, 500) || '(empty)'); }
  }, [r.clipboardText]);

  // ---- actions ----
  const openConnect = (opts) => { pendingRef.current = opts; setPendingName(opts.name || ''); setPassword(''); setView('connect'); };

  const connectSaved = (c) => openConnect({ targets: targetsForComputer(c), lan: c.lan || null, existingId: c.id, save: true, name: c.name });

  const startScan = async () => {
    scannedOnce.current = false;
    if (!perm || !perm.granted) { const res = await requestPerm(); if (!res || !res.granted) { Alert.alert('Camera needed', 'Allow camera access to scan the QR on your computer.'); return; } }
    setView('scan');
  };

  const onScanned = useCallback((e) => {
    if (scannedOnce.current) return;
    const info = parseQr(e && e.data);
    if (!info) { return; } // ignore non-connect QRs; keep scanning
    scannedOnce.current = true;
    const targets = targetsForScan(info);
    openConnect({ targets, lan: info.lan || null, save: true, name: info.lan ? info.lan.host : 'New computer' });
  }, [perm]);

  const addManual = () => {
    Alert.prompt
      ? Alert.prompt('Computer address', 'Enter its Wi-Fi address (e.g. 192.168.1.50)', (host) => {
          if (host) openConnect({ targets: targetsForScan({ lan: { host: host.trim(), port: 8771 } }), lan: { host: host.trim(), port: 8771 }, save: true, name: host.trim() });
        })
      : Alert.alert('Use Scan', 'Add this computer by scanning the QR on its Remote Control dashboard.');
  };

  const doConnect = () => r.connect(pendingRef.current.targets, password);

  const removeComputer = (c) => {
    Alert.alert('Remove computer', `Remove “${c.name || c.id}”?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => setComputers((prev) => { const next = prev.filter((x) => x.id !== c.id); persistComputers(next); return next; }) },
    ]);
  };

  const endSession = () => { r.disconnect(); setView('home'); };

  const sendType = (withEnter) => { const text = typed; if (text) r.sendInput({ cmd: 'type', text }); if (withEnter) r.sendInput({ cmd: 'key', name: 'ENTER' }); setTyped(''); };
  const sendClipFromPhone = async () => {
    try { const text = await Clipboard.getStringAsync(); r.sendClipboard(text || ''); Alert.alert('Sent', 'This phone’s clipboard was sent to the PC.'); }
    catch (e) { Alert.alert('Could not read clipboard'); }
  };

  // ================= LIVE CONTROL =================
  if (ready) {
    const avg = r.stats.frames ? r.stats.bytesIn / r.stats.frames : 0;
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.topBar}>
          <View style={s.dotRow}>
            <View style={[s.dot, { backgroundColor: t.green }]} />
            <Text style={s.topTxt} numberOfLines={1}>{pendingName || 'PC'}  ·  {fmtBytes(r.stats.bytesIn)} in · {fmtBytes(r.stats.bytesOut)} out · {r.stats.frames}f · {fmtBytes(avg)}/f</Text>
          </View>
          <Pressable onPress={endSession} hitSlop={8}><Text style={s.endTxt}>End</Text></Pressable>
        </View>

        <View style={s.screenWrap} onLayout={(e) => { boxRef.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }} {...pan.panHandlers}>
          {r.frameUri
            ? <Image source={{ uri: r.frameUri }} style={[s.frame, { transform: [{ translateX: offset.x }, { translateY: offset.y }, { scale: zoom }] }]} resizeMode="contain" fadeDuration={0} />
            : <Text style={s.waiting}>Waiting for the first frame…</Text>}
          {zoom > 1.01 ? (
            <Pressable style={s.resetZoom} onPress={() => applyZP(1, 0, 0)}><Text style={s.resetZoomTxt}>{Math.round(zoom * 100)}%  ✕</Text></Pressable>
          ) : null}
        </View>

        <View style={s.controls}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {r.views.multiMonitor ? r.views.list.map((v, i) => (
              <Chip key={String(v.id)} t={t} active={r.views.current === v.id} label={`Screen ${i + 1}`} onPress={() => { r.selectView(v.id); applyZP(1, 0, 0); }} />
            )) : null}
            {r.views.multiMonitor ? <Chip t={t} active={r.views.current === 'full'} label="All screens" onPress={() => { r.selectView('full'); applyZP(1, 0, 0); }} /> : null}
            <Chip t={t} active={r.mode.dataSaver} label="Data-saver" onPress={() => r.setDataSaver(!r.mode.dataSaver)} />
            <Chip t={t} active={r.mode.grayscale} label="Gray" onPress={() => r.setGrayscale(!r.mode.grayscale)} />
            <Chip t={t} label="Keyboard" onPress={() => setKbOpen(true)} />
            <Chip t={t} label="Keys" onPress={() => setKeysOpen(true)} />
            <Chip t={t} label="Scroll ▲" onPress={() => r.sendInput({ cmd: 'wheel', delta: -240 })} />
            <Chip t={t} label="Scroll ▼" onPress={() => r.sendInput({ cmd: 'wheel', delta: 240 })} />
            <Chip t={t} label="Send clip" onPress={sendClipFromPhone} />
            <Chip t={t} label="Get clip" onPress={r.requestClipboard} />
          </ScrollView>
          <Text style={s.hint}>Tap = click · drag = move · hold = right-click · pinch = zoom · two-finger drag = scroll / pan</Text>
        </View>

        <Modal visible={kbOpen} transparent animationType="slide" onRequestClose={() => setKbOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kbWrap}>
            <View style={s.kbCard}>
              <View style={s.kbHead}><Text style={s.kbTitle}>Type to PC</Text><Pressable onPress={() => setKbOpen(false)} hitSlop={8}><Text style={s.kbClose}>Done</Text></Pressable></View>
              <TextInput style={s.kbInput} value={typed} onChangeText={setTyped} placeholder="Type here, then Send" placeholderTextColor={t.label3} autoFocus multiline />
              <View style={s.kbBtns}>
                <Pressable style={[s.kbBtn, s.kbGhost]} onPress={() => r.sendInput({ cmd: 'key', name: 'BACKSPACE' })}><Text style={s.kbGhostTxt}>Backspace</Text></Pressable>
                <Pressable style={[s.kbBtn, s.kbGhost]} onPress={() => sendType(false)}><Text style={s.kbGhostTxt}>Send</Text></Pressable>
                <Pressable style={[s.kbBtn, s.kbBlue]} onPress={() => sendType(true)}><Text style={s.kbBlueTxt}>Send + Enter</Text></Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={keysOpen} transparent animationType="fade" onRequestClose={() => setKeysOpen(false)}>
          <Pressable style={s.keysBackdrop} onPress={() => setKeysOpen(false)}>
            <Pressable style={s.keysCard} onPress={() => {}}>
              <View style={s.kbHead}><Text style={s.kbTitle}>Keys</Text><Pressable onPress={() => setKeysOpen(false)} hitSlop={8}><Text style={s.kbClose}>Done</Text></Pressable></View>
              <View style={s.keyGrid}>
                {MACROS.map(([label, name]) => (
                  <Pressable key={name} style={s.keyBtn} onPress={() => r.sendInput({ cmd: 'key', name })}><Text style={s.keyTxt}>{label}</Text></Pressable>
                ))}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    );
  }

  // ================= SCAN =================
  if (view === 'scan') {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: '#000' }]} edges={['top']}>
        <View style={s.scanHead}>
          <Pressable onPress={() => setView('home')} hitSlop={8}><Text style={s.scanCancel}>Cancel</Text></Pressable>
          <Text style={s.scanTitle}>Scan the QR on your computer</Text>
          <View style={{ width: 54 }} />
        </View>
        <View style={s.scanBody}>
          {perm && perm.granted ? (
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
          ) : (
            <View style={s.scanFallback}><Text style={s.waiting}>Camera unavailable here.</Text></View>
          )}
          <View style={s.scanFrame} pointerEvents="none" />
        </View>
        <Text style={s.scanHint}>Open the Remote Control dashboard on your PC and point the camera at its QR code.</Text>
      </SafeAreaView>
    );
  }

  // ================= CONNECT (enter password) =================
  if (view === 'connect') {
    const err = r.phase === 'error' || r.phase === 'locked';
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex}>
          <ScrollView contentContainerStyle={s.formWrap} keyboardShouldPersistTaps="handled">
            <Pressable onPress={() => { r.disconnect(); setView('home'); }} hitSlop={8}><Text style={s.back}>‹ Computers</Text></Pressable>
            <Text style={s.title}>{pendingName || 'Connect'}</Text>
            <Text style={s.sub}>Enter this computer’s password. It’s never saved — only the computer is, so next time it’s one tap and your password.</Text>
            <View style={s.card}>
              <Text style={s.lbl}>Password</Text>
              <TextInput style={s.in} value={password} onChangeText={setPassword} placeholder="Agent password" placeholderTextColor={t.label3} secureTextEntry autoCapitalize="none" autoCorrect={false} autoFocus onSubmitEditing={doConnect} />
            </View>
            {busy
              ? <View style={s.busyRow}><ActivityIndicator color={t.blue} /><Text style={s.status}>{r.statusLabel}</Text></View>
              : <Pressable style={s.primary} onPress={doConnect}><Text style={s.primaryTxt}>Connect</Text></Pressable>}
            {err ? <Text style={[s.status, { color: t.red }]}>{r.statusLabel}</Text> : null}
            {busy ? <Pressable onPress={() => { r.disconnect(); }}><Text style={s.cancel}>Cancel</Text></Pressable> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ================= HOME (saved computers) =================
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.formWrap}>
        <Text style={s.title}>Remote</Text>
        <Text style={s.sub}>Control your computer from here. Low-data by default — grayscale still frames. On Wi-Fi it connects directly; otherwise it uses the relay.</Text>

        {computers.length === 0 ? (
          <View style={s.empty}><Text style={s.emptyTxt}>No computers yet. Scan the QR on your PC’s Remote Control dashboard to add one.</Text></View>
        ) : computers.map((c) => (
          <Pressable key={c.id} style={s.pcRow} onPress={() => connectSaved(c)} onLongPress={() => removeComputer(c)}>
            <View style={s.pcIcon}><Text style={s.pcIconTxt}>🖥</Text></View>
            <View style={s.flex}>
              <Text style={s.pcName}>{c.name || 'Computer'}</Text>
              <Text style={s.pcSub}>{[c.lan && 'Wi-Fi', (c.relay || c.id) && 'Relay'].filter(Boolean).join(' · ') || 'Saved'}</Text>
            </View>
            <Text style={s.pcGo}>›</Text>
          </Pressable>
        ))}

        <Pressable style={s.primary} onPress={startScan}><Text style={s.primaryTxt}>Scan QR to add a computer</Text></Pressable>
        <Pressable onPress={addManual}><Text style={s.cancel}>Add by Wi-Fi address instead</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ t, label, active, onPress }) {
  const s = styles(t);
  return (
    <Pressable style={[s.chip, active && { backgroundColor: t.blue, borderColor: t.blue }]} onPress={onPress}>
      <Text style={[s.chipTxt, active && { color: t.onBlue }]}>{label}</Text>
    </Pressable>
  );
}

const styles = (t) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  flex: { flex: 1 },
  formWrap: { padding: 20, gap: 14 },
  title: { fontSize: 34, fontWeight: '700', color: t.label, letterSpacing: 0.3 },
  sub: { fontSize: 14, color: t.label2, lineHeight: 20 },
  back: { color: t.blue, fontSize: 16, fontWeight: '600' },
  card: { backgroundColor: t.card, borderRadius: 14, padding: 14, gap: 6 },
  lbl: { fontSize: 12, color: t.label2, marginTop: 6, fontWeight: '600' },
  in: { backgroundColor: t.fill, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: t.label, fontSize: 16 },
  primary: { backgroundColor: t.blue, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryTxt: { color: t.onBlue, fontSize: 17, fontWeight: '600' },
  status: { color: t.label2, fontSize: 13 },
  busyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  cancel: { textAlign: 'center', color: t.blue, fontSize: 15, marginTop: 4 },

  empty: { backgroundColor: t.card, borderRadius: 14, padding: 18 },
  emptyTxt: { color: t.label2, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  pcRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.card, borderRadius: 14, padding: 14 },
  pcIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: t.fill, alignItems: 'center', justifyContent: 'center' },
  pcIconTxt: { fontSize: 20 },
  pcName: { color: t.label, fontSize: 16, fontWeight: '600' },
  pcSub: { color: t.label2, fontSize: 12, marginTop: 2 },
  pcGo: { color: t.label3, fontSize: 24, fontWeight: '300' },

  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 10 },
  dotRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  topTxt: { flex: 1, color: t.label2, fontSize: 11 },
  endTxt: { color: t.red, fontSize: 15, fontWeight: '600' },

  screenWrap: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  frame: { width: '100%', height: '100%' },
  waiting: { color: '#8E8E93', fontSize: 14 },
  resetZoom: { position: 'absolute', right: 12, bottom: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  resetZoomTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },

  controls: { paddingVertical: 8, backgroundColor: t.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
  chipRow: { paddingHorizontal: 12, gap: 8 },
  chip: { borderWidth: 1, borderColor: t.sep, backgroundColor: t.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipTxt: { color: t.label, fontSize: 13, fontWeight: '600' },
  hint: { textAlign: 'center', color: t.label3, fontSize: 11, marginTop: 7 },

  scanHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  scanCancel: { color: '#fff', fontSize: 16, fontWeight: '600', width: 54 },
  scanTitle: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center' },
  scanBody: { flex: 1, position: 'relative', overflow: 'hidden' },
  scanFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { position: 'absolute', left: '15%', right: '15%', top: '22%', bottom: '22%', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 18 },
  scanHint: { color: '#c7c7cc', fontSize: 13, textAlign: 'center', padding: 18 },

  kbWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  kbCard: { backgroundColor: t.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 12 },
  kbHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kbTitle: { fontSize: 17, fontWeight: '700', color: t.label },
  kbClose: { color: t.blue, fontSize: 16, fontWeight: '600' },
  kbInput: { backgroundColor: t.fill, borderRadius: 10, padding: 12, color: t.label, fontSize: 16, minHeight: 48 },
  kbBtns: { flexDirection: 'row', gap: 10 },
  kbBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  kbGhost: { backgroundColor: t.fill },
  kbGhostTxt: { color: t.label, fontSize: 15, fontWeight: '600' },
  kbBlue: { backgroundColor: t.blue, flex: 1.4 },
  kbBlueTxt: { color: t.onBlue, fontSize: 15, fontWeight: '700' },

  keysBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  keysCard: { backgroundColor: t.card, borderRadius: 18, padding: 16, gap: 12 },
  keyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  keyBtn: { backgroundColor: t.fill, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, minWidth: 64, alignItems: 'center' },
  keyTxt: { color: t.label, fontSize: 14, fontWeight: '600' },
});
