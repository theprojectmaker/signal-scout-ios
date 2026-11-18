import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet, Image, PanResponder, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useTheme } from '../../components/theme';
import { useICloudRemote, newRoom } from '../../components/icloudClient';

// Captures the ckWebAuthToken whether CloudKit returns it in the URL or via postMessage.
const CAPTURE_JS = `(function(){
  function grab(h){ var m=(h||'').match(/[?&#]ckWebAuthToken=([^&#]+)/); if(m){ window.ReactNativeWebView.postMessage(JSON.stringify({t:'cwt',v:decodeURIComponent(m[1])})); return true; } return false; }
  grab(location.href);
  window.addEventListener('message', function(ev){ try{ var d=typeof ev.data==='string'?JSON.parse(ev.data):ev.data; if(d&&d.ckWebAuthToken){ window.ReactNativeWebView.postMessage(JSON.stringify({t:'cwt',v:d.ckWebAuthToken})); } }catch(e){} });
}()); true;`;
function tokenFromUrl(u) { const m = (u || '').match(/[?&#]ckWebAuthToken=([^&#]+)/); return m ? decodeURIComponent(m[1]) : null; }

// [label, name the PC agent understands]
const KEYS = [
  ['Enter', 'ENTER'], ['Backspace', 'BACKSPACE'], ['Tab', 'TAB'], ['Esc', 'ESC'],
  ['↑', 'UP'], ['↓', 'DOWN'], ['←', 'LEFT'], ['→', 'RIGHT'],
  ['Delete', 'DELETE'], ['Home', 'HOME'], ['End', 'END'], ['Win', 'WIN'],
  ['Ctrl+C', 'CTRL+C'], ['Ctrl+V', 'CTRL+V'], ['Ctrl+Z', 'CTRL+Z'], ['Ctrl+A', 'CTRL+A'],
  ['Alt+Tab', 'ALTTAB'], ['Task Mgr', 'TASKMGR'],
];

export default function ICloudRemoteScreen() {
  const t = useTheme();
  const s = styles(t);
  const insets = useSafeAreaInsets();
  const r = useICloudRemote();

  const [menuOpen, setMenuOpen] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [gesture, setGesture] = useState('');

  // refs so the (once-created) PanResponder always sees the latest frame + senders
  const box = useRef({ w: 1, h: 1 });
  const frameRef = useRef(null);
  const sendRef = useRef(r.sendCmd);
  useEffect(() => { frameRef.current = r.frame; }, [r.frame]);
  useEffect(() => { sendRef.current = r.sendCmd; }, [r.sendCmd]);

  const mapPt = useCallback((lx, ly) => {
    const f = frameRef.current;
    if (!f || !f.w || !f.h) return null;
    const bw = box.current.w, bh = box.current.h;
    const scale = Math.min(bw / f.w, bh / f.h);
    const dw = f.w * scale, dh = f.h * scale;
    const ox = (bw - dw) / 2, oy = (bh - dh) / 2;
    const x = Math.round((lx - ox) / scale), y = Math.round((ly - oy) / scale);
    return { x: Math.max(0, Math.min(f.w, x)), y: Math.max(0, Math.min(f.h, y)) };
  }, []);

  const flash = useCallback((label) => { setGesture(label); setTimeout(() => setGesture(''), 900); }, []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        pan.state = { start: mapPt(locationX, locationY), moved: false, dragging: false, longFired: false };
        pan.longTimer = setTimeout(() => {
          const st = pan.state;
          if (st && !st.moved && st.start) { st.longFired = true; sendRef.current('rightclick', st.start); flash('right-click'); }
        }, 450);
      },
      onPanResponderMove: (e, g) => {
        const st = pan.state; if (!st) return;
        if (!st.dragging && (Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8)) {
          st.moved = true; st.dragging = true;
          clearTimeout(pan.longTimer);
          if (st.start) { sendRef.current('move', st.start); sendRef.current('down'); flash('drag'); }
        }
      },
      onPanResponderRelease: (e) => {
        const st = pan.state; if (!st) return;
        clearTimeout(pan.longTimer);
        const end = mapPt(e.nativeEvent.locationX, e.nativeEvent.locationY) || st.start;
        if (st.dragging) { if (end) sendRef.current('move', end); sendRef.current('up'); }
        else if (st.longFired) { /* right-click already sent */ }
        else if (st.start) { sendRef.current('click', st.start); flash('click'); }
        pan.state = null;
      },
      onPanResponderTerminate: () => { clearTimeout(pan.longTimer); pan.state = null; },
    })
  ).current;

  const needsSetup = !r.cfg.container || !r.cfg.room || (!r.native && !r.cfg.token);
  const errish = /error|fail|401|403|AUTHENTICATION|unauthenticated|CloudKit \d/i.test(r.status || '');
  const frameAgeS = r.frame ? Math.max(0, Math.round((Date.now() - r.frame.ts) / 1000)) : null;
  const live = r.connected && !!r.frame && !errish;
  const dotColor = errish ? t.red : live ? t.green : r.connected ? '#FF9F0A' : t.label3;

  const doMenu = (fn) => () => { setMenuOpen(false); setTimeout(fn, 60); };
  const sendType = (enter) => {
    if (typed) r.sendCmd('type', { text: typed });
    if (enter) r.sendCmd('key', { text: 'ENTER' });
    setTyped('');
  };

  const title = r.native ? 'native iCloud' : 'web iCloud';
  const sub = r.frame
    ? `${r.frame.w}×${r.frame.h} · ${frameAgeS}s ago · ${r.cfg.env}`
    : r.connected ? (errish ? r.status : 'waiting for your PC…') : 'not connected';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* slim top bar — same shape as the Remote tab */}
      <View style={s.topBar}>
        <View style={s.dotRow}>
          <View style={[s.dot, { backgroundColor: dotColor }]} />
          <Text style={s.topTxt} numberOfLines={1}>{title}  ·  {sub}</Text>
        </View>
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} style={s.menuBtn}>
          <Text style={s.menuDots}>•••</Text>
        </Pressable>
      </View>

      {/* full-bleed letterboxed screen */}
      <View
        style={s.screenWrap}
        onLayout={(e) => { box.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}
        {...pan.panHandlers}
      >
        {r.frame ? (
          <Image source={{ uri: `data:image/jpeg;base64,${r.frame.jpeg}` }} style={s.frame} resizeMode="contain" fadeDuration={0} />
        ) : !r.connected ? (
          <View style={s.center}>
            <Text style={s.emptyTitle}>iCloud Remote</Text>
            <Text style={s.emptyHint}>Control your PC over iCloud — works on locked-down Wi-Fi.</Text>
            <Pressable
              style={[s.bigBtn, needsSetup && { opacity: 0.4 }]}
              disabled={needsSetup}
              onPress={r.connect}
            ><Text style={s.bigBtnTxt}>Connect</Text></Pressable>
            {needsSetup ? <Text style={s.emptyMeta}>Open ••• → Settings to finish setup</Text> : null}
          </View>
        ) : (
          <View style={s.center}>
            {!errish && <ActivityIndicator color="#8a8a8a" />}
            <Text style={s.emptyTitle}>{errish ? 'Can’t reach CloudKit' : 'Waiting for your PC…'}</Text>
            {errish ? (
              <Text style={s.emptyErr}>{r.status}</Text>
            ) : (
              <>
                <Text style={s.emptyHint}>No screenshot yet. On your PC, make sure the Remote agent is running, then run:</Text>
                <Text style={s.emptyCode}>node icloud-agent.js</Text>
              </>
            )}
            <Text style={s.emptyMeta}>{r.native ? 'native' : 'web'} · env {r.cfg.env} · room {r.cfg.room || '—'}</Text>
          </View>
        )}
        {!!gesture && <View style={s.badge}><Text style={s.badgeTxt}>{gesture}</Text></View>}
      </View>

      <Text style={s.hint}>Tap = click · drag = move · hold = right-click</Text>

      {/* ============ dropdown menu ============ */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={s.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={[s.menuCard, { top: insets.top + 44 }]}>
            <MenuItem s={s} label="Refresh" onPress={doMenu(r.requestShot)} />
            <MenuItem s={s} label="Type text…" onPress={doMenu(() => setKbOpen(true))} />
            <MenuItem s={s} label="Keys…" onPress={doMenu(() => setKeysOpen(true))} />
            <MenuItem s={s} label="Scroll up" onPress={doMenu(() => r.sendCmd('wheel', { dy: -240 }))} />
            <MenuItem s={s} label="Scroll down" onPress={doMenu(() => r.sendCmd('wheel', { dy: 240 }))} />
            {r.connected && !r.signedIn ? <MenuItem s={s} label="Sign in to control" onPress={doMenu(r.beginSignIn)} /> : null}
            <MenuItem s={s} label="Settings" onPress={doMenu(() => setSetupOpen(true))} />
            {r.connected
              ? <MenuItem s={s} label="Disconnect" danger last onPress={doMenu(r.disconnect)} />
              : <MenuItem s={s} label="Connect" accent last disabled={needsSetup} onPress={doMenu(r.connect)} />}
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
              <Pressable style={[s.kbBtn, s.kbGhost]} onPress={() => r.sendCmd('key', { text: 'BACKSPACE' })}><Text style={s.kbGhostTxt}>Backspace</Text></Pressable>
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
            <View style={s.keyGrid}>
              {KEYS.map(([label, name]) => (
                <Pressable key={name} style={s.keyBtn} onPress={() => r.sendCmd('key', { text: name })}><Text style={s.keyTxt}>{label}</Text></Pressable>
              ))}
            </View>
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
              {!r.native ? <Field s={s} label="API token (web path)" value={r.cfg.token} onChange={(v) => r.setCfg({ token: v.trim() })} placeholder="paste the ckAPIToken" /> : null}
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
                {r.native ? 'Using native iCloud (your device account — no token or sign-in).' : 'Using web iCloud — sending taps needs a one-time Apple sign-in.'}
                {'\n'}Run icloud-agent.js on your PC with the same room and environment.
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
    </SafeAreaView>
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

const styles = (t) => {
  const st = StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
    center: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 6 },

    topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 10 },
    dotRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    topTxt: { flex: 1, color: t.label2, fontSize: 11 },
    menuBtn: { backgroundColor: t.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: t.sep },
    menuDots: { color: t.label, fontSize: 14, fontWeight: '800', letterSpacing: 1 },

    screenWrap: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    frame: { width: '100%', height: '100%' },
    badge: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
    badgeTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
    hint: { textAlign: 'center', color: t.label3, fontSize: 11, paddingVertical: 8, backgroundColor: t.bg },

    emptyTitle: { color: '#e6e6e6', fontSize: 17, fontWeight: '700', marginTop: 6, textAlign: 'center' },
    emptyHint: { color: '#8a8a8a', fontSize: 12, textAlign: 'center', lineHeight: 17, maxWidth: 280 },
    emptyCode: { color: '#9bd94e', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },
    emptyErr: { color: '#ff6b60', fontSize: 12, textAlign: 'center', lineHeight: 17, maxWidth: 300 },
    emptyMeta: { color: '#6a6a6a', fontSize: 11, marginTop: 10 },
    bigBtn: { backgroundColor: t.blue, borderRadius: 12, paddingHorizontal: 34, paddingVertical: 13, marginTop: 14 },
    bigBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },

    menuBackdrop: { flex: 1 },
    menuCard: { position: 'absolute', right: 12, minWidth: 190, backgroundColor: t.card, borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: t.sep, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
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
