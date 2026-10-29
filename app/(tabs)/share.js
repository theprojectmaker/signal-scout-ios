import React, { useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, TextInput, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../components/theme';
import { useNearbyShare } from '../../components/nearbyShare';

function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ShareScreen() {
  const t = useTheme();
  const s = styles(t);
  const n = useNearbyShare();

  const pick = useCallback(async () => {
    try {
      const DP = require('expo-document-picker');
      const res = await DP.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      n.enqueueFile(res.assets[0]);
    } catch (e) { Alert.alert('Could not pick a file'); }
  }, [n]);

  if (!n.available) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScrollView contentContainerStyle={s.wrap}>
          <Text style={s.title}>Share</Text>
          <Text style={s.sub}>Offline file sharing works in the installed app on two devices. It isn’t available in this preview.</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.title}>Share</Text>
        <Text style={s.sub}>Send files phone↔iPad with no internet, Wi‑Fi, or signal. Keep the app open on both; it connects and sends when they’re near each other.</Text>

        {/* connection status + live progress */}
        <View style={s.statusCard}>
          <View style={s.statusRow}>
            <View style={[s.dot, { backgroundColor: n.peer ? t.green : t.label3 }]} />
            <Text style={s.statusTxt}>{n.status}</Text>
          </View>
          {n.progress ? (
            <View style={s.progWrap}>
              <Text style={s.progLbl}>{n.progress.dir === 'send' ? 'Sending' : 'Receiving'} {n.progress.name} · {n.progress.pct}%</Text>
              <View style={s.track}><View style={[s.fill, { width: `${n.progress.pct}%` }]} /></View>
            </View>
          ) : null}
        </View>

        {n.log && n.log.length ? (
          <View style={s.diag}>
            <Text style={s.diagTitle}>Diagnostics (read this to me)</Text>
            {n.log.slice(0, 12).map((line, i) => <Text key={i} style={s.diagLine}>{line}</Text>)}
          </View>
        ) : null}

        <View style={s.nameRow}>
          <Text style={s.nameLbl}>This device</Text>
          <TextInput style={s.nameIn} value={n.nick} onChangeText={n.saveNick} placeholder="Name this device" placeholderTextColor={t.label3} autoCapitalize="words" />
        </View>

        <Pressable style={s.primary} onPress={pick}><Text style={s.primaryTxt}>Send a file</Text></Pressable>

        {n.queue.length > 0 ? (
          <View style={s.section}>
            <Text style={s.secTitle}>Waiting to send</Text>
            {n.queue.map((f) => (
              <Pressable key={f.id} style={s.row} onLongPress={() => n.removeQueued(f.id)}>
                <Text style={s.fileIcon}>⏳</Text>
                <View style={s.flex}><Text style={s.fileName} numberOfLines={1}>{f.name}</Text><Text style={s.fileMeta}>{fmtBytes(f.size)} · {n.peer ? 'sending…' : 'waiting for a nearby device'}</Text></View>
              </Pressable>
            ))}
            <Text style={s.hint}>Long-press to cancel. Files wait here until delivered.</Text>
          </View>
        ) : null}

        <View style={s.section}>
          <Text style={s.secTitle}>Received</Text>
          {n.library.length === 0 ? (
            <Text style={s.empty}>Nothing yet. Files others send you land here — even hours later when you reopen the app.</Text>
          ) : n.library.map((f) => (
            <Pressable key={f.id} style={s.row} onPress={() => n.openFile(f)} onLongPress={() => n.removeLibrary(f.id)}>
              <Text style={s.fileIcon}>📄</Text>
              <View style={s.flex}><Text style={s.fileName} numberOfLines={1}>{f.name}</Text><Text style={s.fileMeta}>{fmtBytes(f.size)} · from {f.from} · {new Date(f.at).toLocaleDateString()}</Text></View>
              <Text style={s.go}>↗</Text>
            </Pressable>
          ))}
          {n.library.length > 0 ? <Text style={s.hint}>Tap to open or save · long-press to remove</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (t) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  flex: { flex: 1 },
  wrap: { padding: 20, gap: 14 },
  title: { fontSize: 34, fontWeight: '700', color: t.label, letterSpacing: 0.3 },
  sub: { fontSize: 14, color: t.label2, lineHeight: 20 },
  statusCard: { backgroundColor: t.card, borderRadius: 14, padding: 14, gap: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statusTxt: { color: t.label, fontSize: 15, fontWeight: '600' },
  progWrap: { gap: 6 },
  progLbl: { color: t.label2, fontSize: 13 },
  track: { height: 6, borderRadius: 3, backgroundColor: t.fill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: t.blue },
  diag: { backgroundColor: t.fill, borderRadius: 10, padding: 10, gap: 2 },
  diagTitle: { color: t.label2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  diagLine: { color: t.label, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameLbl: { color: t.label2, fontSize: 13, fontWeight: '600' },
  nameIn: { flex: 1, backgroundColor: t.fill, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: t.label, fontSize: 15 },
  primary: { backgroundColor: t.blue, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryTxt: { color: t.onBlue, fontSize: 17, fontWeight: '600' },
  section: { gap: 8 },
  secTitle: { color: t.label2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.card, borderRadius: 12, padding: 13 },
  fileIcon: { fontSize: 20 },
  fileName: { color: t.label, fontSize: 15, fontWeight: '600' },
  fileMeta: { color: t.label2, fontSize: 12, marginTop: 2 },
  go: { color: t.blue, fontSize: 18, fontWeight: '600' },
  empty: { color: t.label2, fontSize: 14, lineHeight: 20 },
  hint: { color: t.label3, fontSize: 11, marginTop: 2 },
});
