import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, Image, PanResponder, Modal, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

export default function ICloudRemoteScreen() {
  const t = useTheme();
  const s = styles(t);
  const r = useICloudRemote();
  const [showSetup, setShowSetup] = useState(false);
  const [typeText, setTypeText] = useState('');
  const [gesture, setGesture] = useState('');     // transient label: "click" / "right-click" / "drag"

  // refs so the (once-created) PanResponder always sees the latest frame + senders
  const box = useRef({ w: 1, h: 1 });
  const frameRef = useRef(null);
  const sendRef = useRef(r.sendCmd);
  useEffect(() => { frameRef.current = r.frame; }, [r.frame]);
  useEffect(() => { sendRef.current = r.sendCmd; }, [r.sendCmd]);

  const onBoxLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    box.current.w = width; box.current.h = height;
  }, []);

  // map a touch point in the box to a PC screen pixel (accounts for letterboxing)
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
        const p = mapPt(locationX, locationY);
        pan.state = { start: p, moved: false, dragging: false, longFired: false };
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
      onPanResponderRelease: (e, g) => {
        const st = pan.state; if (!st) { return; }
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

  const key = (k) => r.sendCmd('key', { text: k });
  const scroll = (dy) => r.sendCmd('wheel', { dy });
  // native mode authenticates as the device's iCloud account, so it needs no API token
  const needsSetup = !r.cfg.container || !r.cfg.room || (!r.native && !r.cfg.token);
  const errish = /error|fail|401|403|AUTHENTICATION|unauthenticated|CloudKit \d/i.test(r.status || '');
  const frameAgeS = r.frame ? Math.max(0, Math.round((Date.now() - r.frame.ts) / 1000)) : null;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.head}>
        <Text style={s.title}>iCloud Remote</Text>
        <Pressable onPress={() => setShowSetup((v) => !v)} style={s.gear}><Text style={s.gearTxt}>⚙</Text></Pressable>
      </View>
      <Text style={s.sub}>Touch the screen like a trackpad — tap to click, hold to right-click, drag to drag. Works on the locked Wi-Fi; a few seconds per action.</Text>

      {(showSetup || needsSetup) && (
        <View style={s.setup}>
          <Text style={s.setupTitle}>Setup (one time)</Text>
          <Field s={s} label="CloudKit container" value={r.cfg.container} onChange={(v) => r.setCfg({ container: v.trim() })} placeholder="iCloud.com.solyapps.signalscout" />
          <Field s={s} label="API token" value={r.cfg.token} onChange={(v) => r.setCfg({ token: v.trim() })} placeholder="paste the ckAPIToken" />
          <View style={s.roomRow}>
            <View style={s.flex}><Field s={s} label="Room code (must match the PC)" value={r.cfg.room} onChange={(v) => r.setCfg({ room: v.trim().toUpperCase() })} placeholder="ABC123" /></View>
            <Pressable onPress={() => r.setCfg({ room: newRoom() })} style={s.genBtn}><Text style={s.genTxt}>New</Text></Pressable>
          </View>
          <View style={s.envRow}>
            <Text style={s.fieldLabel}>Environment (must match the PC)</Text>
            <View style={s.envBtns}>
              {['development', 'production'].map((ev) => (
                <Pressable key={ev} onPress={() => r.setCfg({ env: ev })} style={[s.envBtn, r.cfg.env === ev && s.envBtnOn]}>
                  <Text style={[s.envTxt, r.cfg.env === ev && s.envTxtOn]}>{ev === 'development' ? 'Development' : 'Production'}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Text style={s.hint}>Run icloud-agent.js on your PC with the same container, room and environment. Steps are in ICLOUD-REMOTE-SETUP.md.</Text>
        </View>
      )}

      <View style={s.screenBox} onLayout={onBoxLayout} {...pan.panHandlers}>
        {r.frame ? (
          <Image source={{ uri: `data:image/jpeg;base64,${r.frame.jpeg}` }} style={s.fill} resizeMode="contain" />
        ) : !r.connected ? (
          <View style={[s.fill, s.center]}><Text style={s.ph}>Not connected — tap Connect</Text></View>
        ) : (
          <View style={[s.fill, s.center, { padding: 24 }]}>
            {!errish && <ActivityIndicator color="#8a8a8a" />}
            <Text style={s.emptyTitle}>{errish ? 'Can’t reach CloudKit' : 'Waiting for your PC…'}</Text>
            {errish ? (
              <Text style={s.emptyErr}>{r.status}</Text>
            ) : (
              <>
                <Text style={s.emptyHint}>No screenshot yet. On your PC, make sure the normal Remote agent is running, then run:</Text>
                <Text style={s.emptyCode}>node icloud-agent.js</Text>
              </>
            )}
            <Text style={s.emptyMeta}>{r.native ? 'native' : 'web'} · env {r.cfg.env} · room {r.cfg.room || '—'}</Text>
          </View>
        )}
        {!!gesture && <View style={s.badge}><Text style={s.badgeTxt}>{gesture}</Text></View>}
      </View>

      <Text style={s.status} numberOfLines={1}>
        {`${r.native ? 'native iCloud' : 'web iCloud'} · env ${r.cfg.env}`}
        {r.frame ? ` · live ${r.frame.w}×${r.frame.h} · ${frameAgeS}s ago` : (r.status ? ` · ${r.status}` : '')}
      </Text>

      <ScrollView style={s.controls} contentContainerStyle={s.controlsInner} keyboardShouldPersistTaps="handled">
        <View style={s.btnRow}>
          {!r.connected
            ? <Btn s={s} t={t} primary label="Connect" onPress={r.connect} disabled={needsSetup} />
            : <Btn s={s} t={t} danger label="Disconnect" onPress={r.disconnect} />}
          <Btn s={s} t={t} label="Refresh" onPress={r.requestShot} />
          <Btn s={s} t={t} label="▲ Scroll" onPress={() => scroll(-120)} />
          <Btn s={s} t={t} label="▼ Scroll" onPress={() => scroll(120)} />
        </View>

        {r.connected && !r.signedIn && (
          <View style={s.signRow}>
            <Btn s={s} t={t} primary label="Sign in to control" onPress={r.beginSignIn} />
            <Text style={s.signHint}>You can see the screen now — sending taps needs a one-time Apple sign-in.</Text>
          </View>
        )}

        <View style={s.typeRow}>
          <TextInput
            style={s.input}
            value={typeText}
            onChangeText={setTypeText}
            placeholder="Type text to send…"
            placeholderTextColor={t.label3}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={s.sendBtn} onPress={() => { if (typeText) { r.sendCmd('type', { text: typeText }); setTypeText(''); } }}>
            <Text style={s.sendTxt}>Send</Text>
          </Pressable>
        </View>

        <View style={s.keyRow}>
          {['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map((k) => (
            <Pressable key={k} style={s.keyBtn} onPress={() => key(k)}>
              <Text style={s.keyTxt}>{k.replace('Arrow', '')}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={!!r.authUrl} animationType="slide" onRequestClose={() => r.completeSignIn(null)}>
        <SafeAreaView style={s.authSafe} edges={['top']}>
          <View style={s.authHead}>
            <Text style={s.authTitle}>Sign in to iCloud</Text>
            <Pressable onPress={() => r.completeSignIn(null)}><Text style={s.authClose}>Close</Text></Pressable>
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

function Field({ s, label, value, onChange, placeholder }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput style={s.fieldInput} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#999" autoCapitalize="none" autoCorrect={false} />
    </View>
  );
}
function Btn({ s, t, label, onPress, primary, danger, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.btn, primary && { backgroundColor: t.blue }, danger && { backgroundColor: t.red }, disabled && { opacity: 0.4 }]}>
      <Text style={[s.btnTxt, (primary || danger) && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = (t) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  flex: { flex: 1 },
  fill: { width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 6 },
  title: { fontSize: 30, fontWeight: '700', color: t.label, flex: 1 },
  gear: { padding: 6 }, gearTxt: { fontSize: 22, color: t.label2 },
  sub: { fontSize: 13, color: t.label2, paddingHorizontal: 20, marginTop: 2, lineHeight: 18 },
  setup: { margin: 16, padding: 14, backgroundColor: t.card, borderRadius: 14, gap: 8 },
  setupTitle: { color: t.label, fontWeight: '700', fontSize: 15 },
  field: { gap: 4 },
  fieldLabel: { color: t.label2, fontSize: 12 },
  fieldInput: { backgroundColor: t.fill, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: t.label, fontSize: 14 },
  roomRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  genBtn: { backgroundColor: t.blue, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  genTxt: { color: '#fff', fontWeight: '600' },
  hint: { color: t.label3, fontSize: 11, lineHeight: 16 },
  envRow: { gap: 6 },
  envBtns: { flexDirection: 'row', gap: 8 },
  envBtn: { flex: 1, backgroundColor: t.fill, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  envBtnOn: { backgroundColor: t.blue },
  envTxt: { color: t.label2, fontSize: 13, fontWeight: '600' },
  envTxtOn: { color: '#fff' },
  signRow: { gap: 6 },
  signHint: { color: t.label3, fontSize: 11, lineHeight: 15 },
  authSafe: { flex: 1, backgroundColor: t.bg },
  authHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.sep },
  authTitle: { color: t.label, fontSize: 16, fontWeight: '700' },
  authClose: { color: t.blue, fontSize: 16, fontWeight: '600' },
  screenBox: { flex: 1, margin: 16, marginBottom: 6, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden', minHeight: 180 },
  ph: { color: '#888', fontSize: 14 },
  emptyTitle: { color: '#d0d0d0', fontSize: 15, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  emptyHint: { color: '#8a8a8a', fontSize: 12, marginTop: 8, textAlign: 'center', lineHeight: 17 },
  emptyCode: { color: '#9bd94e', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 6 },
  emptyErr: { color: '#ff6b60', fontSize: 12, marginTop: 8, textAlign: 'center', lineHeight: 17 },
  emptyMeta: { color: '#6a6a6a', fontSize: 11, marginTop: 12 },
  badge: { position: 'absolute', top: 8, right: 8, backgroundColor: t.blue, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeTxt: { color: '#fff', fontSize: 11, fontWeight: '600' },
  status: { color: t.label3, fontSize: 11, paddingHorizontal: 20 },
  controls: { maxHeight: 220 },
  controlsInner: { padding: 16, gap: 10 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { backgroundColor: t.card, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  btnTxt: { color: t.label, fontSize: 14, fontWeight: '600' },
  typeRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: t.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: t.label, fontSize: 15 },
  sendBtn: { backgroundColor: t.blue, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  sendTxt: { color: '#fff', fontWeight: '600' },
  keyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  keyBtn: { backgroundColor: t.fill, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  keyTxt: { color: t.label, fontSize: 13 },
});
