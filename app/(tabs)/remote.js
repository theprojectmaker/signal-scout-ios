import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, Modal, Image, PanResponder,
  StyleSheet, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../components/theme';
import { useRemoteDesktop } from '../../components/remoteClient';

const HOST_KEY = 'remote.host.v1';
const PORT_KEY = 'remote.port.v1';

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

export default function RemoteScreen() {
  const t = useTheme();
  const r = useRemoteDesktop();

  const [host, setHost] = useState('');
  const [port, setPort] = useState('8771');
  const [password, setPassword] = useState('');
  const [kbOpen, setKbOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const h = await AsyncStorage.getItem(HOST_KEY);
        const p = await AsyncStorage.getItem(PORT_KEY);
        if (h) setHost(h);
        if (p) setPort(p);
      } catch (e) {}
    })();
  }, []);

  // Fetched clipboard from the PC -> copy onto this phone.
  useEffect(() => {
    if (r.clipboardText != null) {
      Clipboard.setStringAsync(r.clipboardText).catch(() => {});
      Alert.alert('Clipboard from PC', r.clipboardText.slice(0, 500) || '(empty)');
    }
  }, [r.clipboardText]);

  const ready = r.phase === 'ready';

  // ---- gesture -> remote input (coords map the letterboxed image back to PC pixels) ----
  const boxRef = useRef({ w: 0, h: 0 });
  const screenRef = useRef(r.screen);
  screenRef.current = r.screen;
  const sendRef = useRef(r.sendInput);
  sendRef.current = r.sendInput;

  const startRef = useRef({ x: 0, y: 0, t: 0 });
  const draggingRef = useRef(false);
  const longFiredRef = useRef(false);
  const scrolledRef = useRef(false);
  const lastTwoYRef = useRef(null);
  const lastMoveRef = useRef(0);
  const longTimer = useRef(null);
  const clearLong = () => { if (longTimer.current) { clearTimeout(longTimer.current); longTimer.current = null; } };

  const toRemote = (lx, ly) => {
    const b = boxRef.current, s = screenRef.current;
    if (!b.w || !b.h || !s.w || !s.h) return null;
    const imgA = s.w / s.h, boxA = b.w / b.h;
    let dW, dH, offX, offY;
    if (boxA > imgA) { dH = b.h; dW = b.h * imgA; offX = (b.w - dW) / 2; offY = 0; }
    else { dW = b.w; dH = b.w / imgA; offX = 0; offY = (b.h - dH) / 2; }
    const x = Math.max(0, Math.min(s.w - 1, Math.round((lx - offX) / dW * s.w)));
    const y = Math.max(0, Math.min(s.h - 1, Math.round((ly - offY) / dH * s.h)));
    return { x, y };
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const n = e.nativeEvent;
        startRef.current = { x: n.locationX, y: n.locationY, t: Date.now() };
        draggingRef.current = false; longFiredRef.current = false; scrolledRef.current = false;
        lastTwoYRef.current = null;
        const rc = toRemote(n.locationX, n.locationY);
        if (rc) sendRef.current({ cmd: 'move', x: rc.x, y: rc.y });
        clearLong();
        longTimer.current = setTimeout(() => {
          if (!draggingRef.current && !scrolledRef.current && rc) {
            longFiredRef.current = true;
            sendRef.current({ cmd: 'rightclick', x: rc.x, y: rc.y });
          }
        }, 500);
      },
      onPanResponderMove: (e, g) => {
        const n = e.nativeEvent;
        if (g.numberActiveTouches >= 2) {
          clearLong(); scrolledRef.current = true;
          const y = g.moveY;
          if (lastTwoYRef.current == null) lastTwoYRef.current = y;
          const d = y - lastTwoYRef.current;
          if (Math.abs(d) >= 3) { sendRef.current({ cmd: 'wheel', delta: Math.round(-d * 2) }); lastTwoYRef.current = y; }
          return;
        }
        const rc = toRemote(n.locationX, n.locationY);
        if (!rc) return;
        if (!draggingRef.current) {
          if (Math.hypot(n.locationX - startRef.current.x, n.locationY - startRef.current.y) > 8) {
            draggingRef.current = true; clearLong();
            sendRef.current({ cmd: 'move', x: rc.x, y: rc.y });
            sendRef.current({ cmd: 'down' });
          }
          return;
        }
        const now = Date.now();
        if (now - lastMoveRef.current > 28) { sendRef.current({ cmd: 'move', x: rc.x, y: rc.y }); lastMoveRef.current = now; }
      },
      onPanResponderRelease: () => {
        clearLong();
        if (draggingRef.current) {
          sendRef.current({ cmd: 'up' });
        } else if (!longFiredRef.current && !scrolledRef.current) {
          const rc = toRemote(startRef.current.x, startRef.current.y);
          if (rc) sendRef.current({ cmd: 'click', x: rc.x, y: rc.y });
        }
        draggingRef.current = false; lastTwoYRef.current = null;
      },
      onPanResponderTerminate: () => {
        clearLong();
        if (draggingRef.current) sendRef.current({ cmd: 'up' });
        draggingRef.current = false; lastTwoYRef.current = null;
      },
    })
  ).current;

  // ---- actions ----
  const onConnect = useCallback(() => {
    AsyncStorage.setItem(HOST_KEY, host).catch(() => {});
    AsyncStorage.setItem(PORT_KEY, port).catch(() => {});
    r.connect(host, port, password);
  }, [host, port, password, r]);

  const sendType = (withEnter) => {
    const text = typed;
    if (text) r.sendInput({ cmd: 'type', text });
    if (withEnter) r.sendInput({ cmd: 'key', name: 'ENTER' });
    setTyped('');
  };

  const sendClipFromPhone = async () => {
    try { const text = await Clipboard.getStringAsync(); r.sendClipboard(text || ''); Alert.alert('Sent', 'This phone’s clipboard was sent to the PC.'); }
    catch (e) { Alert.alert('Could not read clipboard'); }
  };

  const s = styles(t);

  // ---------- connect panel ----------
  if (!ready) {
    const busy = r.phase === 'connecting' || r.phase === 'authing';
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex}>
          <ScrollView contentContainerStyle={s.formWrap} keyboardShouldPersistTaps="handled">
            <Text style={s.title}>Remote</Text>
            <Text style={s.sub}>Control your computer from here. Low-data by default — grayscale still frames over your Wi-Fi or relay. Connects only to a PC running your Remote Control agent.</Text>

            <View style={s.card}>
              <Text style={s.lbl}>Computer address</Text>
              <TextInput
                style={s.in} value={host} onChangeText={setHost} placeholder="192.168.1.50" placeholderTextColor={t.label3}
                autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation"
              />
              <Text style={s.lbl}>Port</Text>
              <TextInput style={s.in} value={port} onChangeText={setPort} placeholder="8771" placeholderTextColor={t.label3} keyboardType="number-pad" />
              <Text style={s.lbl}>Password</Text>
              <TextInput style={s.in} value={password} onChangeText={setPassword} placeholder="Your agent password" placeholderTextColor={t.label3} secureTextEntry autoCapitalize="none" autoCorrect={false} />
            </View>

            <Pressable style={[s.primary, busy && s.dim]} onPress={onConnect} disabled={busy}>
              <Text style={s.primaryTxt}>{busy ? 'Connecting…' : 'Connect'}</Text>
            </Pressable>

            <Text style={[s.status, (r.phase === 'error' || r.phase === 'locked') && { color: t.red }]}>{r.statusLabel}</Text>
            {busy ? <Pressable onPress={r.disconnect}><Text style={s.cancel}>Cancel</Text></Pressable> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ---------- live control ----------
  const avg = r.stats.frames ? r.stats.bytesIn / r.stats.frames : 0;
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <View style={s.dotRow}>
          <View style={[s.dot, { backgroundColor: t.green }]} />
          <Text style={s.topTxt} numberOfLines={1}>{host}  ·  {fmtBytes(r.stats.bytesIn)} in · {fmtBytes(r.stats.bytesOut)} out · {r.stats.frames}f · {fmtBytes(avg)}/frame</Text>
        </View>
        <Pressable onPress={r.disconnect} hitSlop={8}><Text style={s.endTxt}>End</Text></Pressable>
      </View>

      <View style={s.screenWrap} onLayout={(e) => { boxRef.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }} {...pan.panHandlers}>
        {r.frameUri
          ? <Image source={{ uri: r.frameUri }} style={s.frame} resizeMode="contain" fadeDuration={0} />
          : <Text style={s.waiting}>Waiting for the first frame…</Text>}
      </View>

      <View style={s.controls}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
          <Chip t={t} active={r.mode.dataSaver} label="Data-saver" onPress={() => r.setDataSaver(!r.mode.dataSaver)} />
          <Chip t={t} active={r.mode.grayscale} label="Gray" onPress={() => r.setGrayscale(!r.mode.grayscale)} />
          <Chip t={t} label="Keyboard" onPress={() => setKbOpen(true)} />
          <Chip t={t} label="Keys" onPress={() => setKeysOpen(true)} />
          <Chip t={t} label="Scroll ▲" onPress={() => r.sendInput({ cmd: 'wheel', delta: -240 })} />
          <Chip t={t} label="Scroll ▼" onPress={() => r.sendInput({ cmd: 'wheel', delta: 240 })} />
          <Chip t={t} label="Send clip" onPress={sendClipFromPhone} />
          <Chip t={t} label="Get clip" onPress={r.requestClipboard} />
        </ScrollView>
        <Text style={s.hint}>Tap = click · drag = move/drag · hold = right-click · two fingers = scroll</Text>
      </View>

      {/* Keyboard */}
      <Modal visible={kbOpen} transparent animationType="slide" onRequestClose={() => setKbOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kbWrap}>
          <View style={s.kbCard}>
            <View style={s.kbHead}>
              <Text style={s.kbTitle}>Type to PC</Text>
              <Pressable onPress={() => setKbOpen(false)} hitSlop={8}><Text style={s.kbClose}>Done</Text></Pressable>
            </View>
            <TextInput
              style={s.kbInput} value={typed} onChangeText={setTyped} placeholder="Type here, then Send" placeholderTextColor={t.label3}
              autoFocus multiline
            />
            <View style={s.kbBtns}>
              <Pressable style={[s.kbBtn, s.kbGhost]} onPress={() => r.sendInput({ cmd: 'key', name: 'BACKSPACE' })}><Text style={s.kbGhostTxt}>Backspace</Text></Pressable>
              <Pressable style={[s.kbBtn, s.kbGhost]} onPress={() => sendType(false)}><Text style={s.kbGhostTxt}>Send</Text></Pressable>
              <Pressable style={[s.kbBtn, s.kbBlue]} onPress={() => sendType(true)}><Text style={s.kbBlueTxt}>Send + Enter</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Special keys */}
      <Modal visible={keysOpen} transparent animationType="fade" onRequestClose={() => setKeysOpen(false)}>
        <Pressable style={s.keysBackdrop} onPress={() => setKeysOpen(false)}>
          <Pressable style={s.keysCard} onPress={() => {}}>
            <View style={s.kbHead}>
              <Text style={s.kbTitle}>Keys</Text>
              <Pressable onPress={() => setKeysOpen(false)} hitSlop={8}><Text style={s.kbClose}>Done</Text></Pressable>
            </View>
            <View style={s.keyGrid}>
              {MACROS.map(([label, name]) => (
                <Pressable key={name} style={s.keyBtn} onPress={() => r.sendInput({ cmd: 'key', name })}>
                  <Text style={s.keyTxt}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  card: { backgroundColor: t.card, borderRadius: 14, padding: 14, gap: 6 },
  lbl: { fontSize: 12, color: t.label2, marginTop: 6, fontWeight: '600' },
  in: { backgroundColor: t.fill, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: t.label, fontSize: 16 },
  primary: { backgroundColor: t.blue, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryTxt: { color: t.onBlue, fontSize: 17, fontWeight: '600' },
  dim: { opacity: 0.5 },
  status: { textAlign: 'center', color: t.label2, fontSize: 13 },
  cancel: { textAlign: 'center', color: t.blue, fontSize: 15, marginTop: 4 },

  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 10 },
  dotRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  topTxt: { flex: 1, color: t.label2, fontSize: 11 },
  endTxt: { color: t.red, fontSize: 15, fontWeight: '600' },

  screenWrap: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  frame: { width: '100%', height: '100%' },
  waiting: { color: '#8E8E93', fontSize: 14 },

  controls: { paddingVertical: 8, backgroundColor: t.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
  chipRow: { paddingHorizontal: 12, gap: 8 },
  chip: { borderWidth: 1, borderColor: t.sep, backgroundColor: t.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipTxt: { color: t.label, fontSize: 13, fontWeight: '600' },
  hint: { textAlign: 'center', color: t.label3, fontSize: 11, marginTop: 7 },

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
