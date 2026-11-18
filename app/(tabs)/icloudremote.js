import React, { useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../components/theme';
import { useICloudRemote, newRoom } from '../../components/icloudClient';

export default function ICloudRemoteScreen() {
  const t = useTheme();
  const s = styles(t);
  const r = useICloudRemote();
  const [showSetup, setShowSetup] = useState(false);
  const [typeText, setTypeText] = useState('');
  const [rightNext, setRightNext] = useState(false);
  const box = useRef({ x: 0, y: 0, w: 1, h: 1 });

  const onBoxLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    box.current.w = width; box.current.h = height;
  }, []);

  const mapTap = useCallback((lx, ly) => {
    const f = r.frame;
    if (!f || !f.w || !f.h) return null;
    const bw = box.current.w, bh = box.current.h;
    const scale = Math.min(bw / f.w, bh / f.h);
    const dw = f.w * scale, dh = f.h * scale;
    const ox = (bw - dw) / 2, oy = (bh - dh) / 2;
    if (lx < ox || lx > ox + dw || ly < oy || ly > oy + dh) return null;
    return { x: Math.round((lx - ox) / scale), y: Math.round((ly - oy) / scale) };
  }, [r.frame]);

  const onScreenTap = useCallback((e) => {
    const { locationX, locationY } = e.nativeEvent;
    const p = mapTap(locationX, locationY);
    if (!p) return;
    r.sendCmd(rightNext ? 'rightclick' : 'click', p);
    if (rightNext) setRightNext(false);
  }, [mapTap, r, rightNext]);

  const key = (k) => r.sendCmd('key', { text: k });
  const scroll = (dy) => r.sendCmd('wheel', { dy });

  const needsSetup = !r.cfg.container || !r.cfg.token || !r.cfg.room;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.head}>
        <Text style={s.title}>iCloud Remote</Text>
        <Pressable onPress={() => setShowSetup((v) => !v)} style={s.gear}><Text style={s.gearTxt}>⚙</Text></Pressable>
      </View>
      <Text style={s.sub}>Controls your PC over iCloud — works on the locked Wi-Fi. Slow (a few seconds per tap), but real.</Text>

      {(showSetup || needsSetup) && (
        <View style={s.setup}>
          <Text style={s.setupTitle}>Setup (one time)</Text>
          <Field s={s} label="CloudKit container" value={r.cfg.container} onChange={(v) => r.setCfg({ container: v.trim() })} placeholder="iCloud.com.solyapps.signalscout" />
          <Field s={s} label="API token" value={r.cfg.token} onChange={(v) => r.setCfg({ token: v.trim() })} placeholder="paste the ckAPIToken" />
          <View style={s.roomRow}>
            <View style={s.flex}><Field s={s} label="Room code (must match the PC)" value={r.cfg.room} onChange={(v) => r.setCfg({ room: v.trim().toUpperCase() })} placeholder="ABC123" /></View>
            <Pressable onPress={() => r.setCfg({ room: newRoom() })} style={s.genBtn}><Text style={s.genTxt}>New</Text></Pressable>
          </View>
          <Text style={s.hint}>Run icloud-agent.js on your PC with the same container, token and room. Setup steps are in ICLOUD-REMOTE-SETUP.md.</Text>
        </View>
      )}

      <View style={s.screenBox} onLayout={onBoxLayout}>
        {r.frame ? (
          <Pressable style={s.fill} onPress={onScreenTap}>
            <Image source={{ uri: `data:image/jpeg;base64,${r.frame.jpeg}` }} style={s.fill} resizeMode="contain" />
          </Pressable>
        ) : (
          <View style={[s.fill, s.center]}>
            <Text style={s.ph}>{r.connected ? (r.status || 'waiting for your PC…') : 'Not connected'}</Text>
          </View>
        )}
        {rightNext && <View style={s.rightBadge}><Text style={s.rightBadgeTxt}>right-click armed</Text></View>}
      </View>

      <Text style={s.status} numberOfLines={1}>{r.status ? `· ${r.status}` : (r.frame ? `· frame ${r.frame.w}×${r.frame.h}` : '')}</Text>

      <ScrollView style={s.controls} contentContainerStyle={s.controlsInner} keyboardShouldPersistTaps="handled">
        <View style={s.btnRow}>
          {!r.connected
            ? <Btn s={s} t={t} primary label="Connect" onPress={r.connect} disabled={needsSetup} />
            : <Btn s={s} t={t} danger label="Disconnect" onPress={r.disconnect} />}
          <Btn s={s} t={t} label="Refresh" onPress={r.requestShot} />
          <Btn s={s} t={t} label={rightNext ? 'Right-click ✓' : 'Right-click'} onPress={() => setRightNext((v) => !v)} />
        </View>

        <View style={s.btnRow}>
          <Btn s={s} t={t} label="▲ Scroll up" onPress={() => scroll(-120)} />
          <Btn s={s} t={t} label="▼ Scroll down" onPress={() => scroll(120)} />
        </View>

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
  screenBox: { flex: 1, margin: 16, marginBottom: 6, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden', minHeight: 180 },
  ph: { color: '#888', fontSize: 14 },
  rightBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: t.red, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  rightBadgeTxt: { color: '#fff', fontSize: 11, fontWeight: '600' },
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
