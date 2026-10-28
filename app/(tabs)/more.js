import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../components/theme';

const TOOLS = [
  { route: '/browser', icon: '🌐', title: 'Browser', sub: 'Browse online, save pages to read with no signal' },
  { route: '/notes', icon: '📝', title: 'Notes', sub: 'Jot things down, saved offline on your phone' },
  { route: '/photos', icon: '📷', title: 'Photos', sub: 'Ask the on-device AI about a photo' },
  { route: '/light', icon: '🔦', title: 'Light', sub: 'Flashlight, colored signal light, and SOS' },
];

export default function MoreScreen() {
  const t = useTheme();
  const s = styles(t);
  const router = useRouter();

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.title}>More</Text>

        <View style={s.section}>
          {TOOLS.map((x) => (
            <Pressable key={x.route} style={s.row} onPress={() => router.push(x.route)}>
              <Text style={s.icon}>{x.icon}</Text>
              <View style={s.flex}><Text style={s.rowTitle}>{x.title}</Text><Text style={s.rowSub}>{x.sub}</Text></View>
              <Text style={s.go}>›</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.help}>
          <Text style={s.helpTitle}>Send your son’s homework to the iPad</Text>
          <Text style={s.helpStep}>1. At lunch (with signal), open the Classroom email and the homework file.</Text>
          <Text style={s.helpStep}>2. Tap the attachment → Share → <Text style={s.b}>Save to Files</Text>.</Text>
          <Text style={s.helpStep}>3. Open <Text style={s.b}>Share</Text> here → <Text style={s.b}>Send a file</Text> → pick it. It waits in the queue.</Text>
          <Text style={s.helpStep}>4. Back at work (no signal needed), open this app near the iPad with Share open on it — the file sends itself and lands in the iPad’s library.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (t) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  flex: { flex: 1 },
  wrap: { padding: 20, gap: 16 },
  title: { fontSize: 34, fontWeight: '700', color: t.label, letterSpacing: 0.3 },
  section: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.card, borderRadius: 12, padding: 14 },
  icon: { fontSize: 22 },
  rowTitle: { color: t.label, fontSize: 16, fontWeight: '600' },
  rowSub: { color: t.label2, fontSize: 12, marginTop: 2 },
  go: { color: t.label3, fontSize: 24, fontWeight: '300' },
  help: { backgroundColor: t.card, borderRadius: 14, padding: 16, gap: 8 },
  helpTitle: { color: t.label, fontSize: 15, fontWeight: '700' },
  helpStep: { color: t.label2, fontSize: 13, lineHeight: 19 },
  b: { color: t.label, fontWeight: '700' },
});
