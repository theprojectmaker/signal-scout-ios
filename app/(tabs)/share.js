import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../components/theme';

// AirDrop-based sharing: pick a file, then hand it to the iOS share sheet (which includes AirDrop).
// AirDrop is Apple's own device-to-device transfer over Wi-Fi/Bluetooth — fully offline, no cell,
// no router — and it's rock solid, unlike the custom peer-to-peer we couldn't get reliable.
export default function ShareScreen() {
  const t = useTheme();
  const s = styles(t);
  const [busy, setBusy] = useState(false);

  const sendFile = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const DP = require('expo-document-picker');
      const Sharing = require('expo-sharing');
      const res = await DP.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets || !res.assets[0]) { setBusy(false); return; }
      const a = res.assets[0];
      if (!(await Sharing.isAvailableAsync())) { Alert.alert('Sharing unavailable', 'This needs the installed app on a real device.'); setBusy(false); return; }
      await Sharing.shareAsync(a.uri, { mimeType: a.mimeType || undefined, dialogTitle: 'AirDrop to another device' });
    } catch (e) { Alert.alert('Could not share that file'); }
    setBusy(false);
  }, [busy]);

  const web = Platform.OS === 'web';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.title}>Share</Text>
        <Text style={s.sub}>Send a file to your iPad (or any device) over AirDrop — Apple’s own transfer. Fully offline: no Wi‑Fi, no signal, no internet.</Text>

        <Pressable style={[s.primary, busy && { opacity: 0.6 }]} onPress={sendFile} disabled={busy || web}>
          <Text style={s.primaryTxt}>{busy ? 'Opening…' : 'Send a file'}</Text>
        </Pressable>
        {web ? <Text style={s.note}>Works in the installed app on a real device.</Text> : null}

        <View style={s.card}>
          <Text style={s.cardTitle}>How it works</Text>
          <Step n="1" t={t} s={s}>Tap <Text style={s.b}>Send a file</Text> and pick the file (e.g. the homework you saved to Files).</Step>
          <Step n="2" t={t} s={s}>In the share sheet, tap your iPad under <Text style={s.b}>AirDrop</Text> (make sure the iPad is unlocked and nearby).</Step>
          <Step n="3" t={t} s={s}>Accept it on the iPad — the file lands in its Files app. Done, with no signal.</Step>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Send your son’s homework</Text>
          <Step n="1" t={t} s={s}>At lunch, open the Classroom email, tap the homework file → Share → <Text style={s.b}>Save to Files</Text>.</Step>
          <Step n="2" t={t} s={s}>Here, tap <Text style={s.b}>Send a file</Text>, pick it, and AirDrop it to the iPad when you’re near it.</Step>
        </View>

        <Text style={s.foot}>Tip: if the iPad doesn’t appear, open Control Center on it and turn AirDrop to “Everyone for 10 Minutes.”</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({ n, t, s, children }) {
  return (
    <View style={s.step}>
      <View style={s.stepNum}><Text style={s.stepNumTxt}>{n}</Text></View>
      <Text style={s.stepTxt}>{children}</Text>
    </View>
  );
}

const styles = (t) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  wrap: { padding: 20, gap: 16 },
  title: { fontSize: 34, fontWeight: '700', color: t.label, letterSpacing: 0.3 },
  sub: { fontSize: 15, color: t.label2, lineHeight: 21, marginTop: -8 },
  primary: { backgroundColor: t.blue, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  primaryTxt: { color: t.onBlue, fontSize: 17, fontWeight: '600' },
  note: { color: t.label2, fontSize: 13, textAlign: 'center', marginTop: -8 },
  card: { backgroundColor: t.card, borderRadius: 16, padding: 16, gap: 12 },
  cardTitle: { color: t.label, fontSize: 16, fontWeight: '700' },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: t.fill, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumTxt: { color: t.label, fontSize: 13, fontWeight: '700' },
  stepTxt: { flex: 1, color: t.label2, fontSize: 14, lineHeight: 20 },
  b: { color: t.label, fontWeight: '700' },
  foot: { color: t.label3, fontSize: 12.5, textAlign: 'center', lineHeight: 17, paddingHorizontal: 6 },
});
