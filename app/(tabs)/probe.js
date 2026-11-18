import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../components/theme';
import { buildProbes } from '../../data/probes';

const STORE_KEY = 'probe_results_v2';
const CONCURRENCY = 64;     // 12k+ endpoints — run many at once (most non-resolving hosts fail fast)
const TIMEOUT_MS = 5000;
const ROW_H = 58;

// Test one endpoint. Resolves 'ok' if the host answered at all (any HTTP status, or a
// socket that opened), 'blocked' if it timed out / refused / errored. Reachable = a door.
function testOne(p) {
  const start = Date.now();
  return new Promise((resolve) => {
    let done = false;
    const finish = (status) => { if (done) return; done = true; resolve({ status, ms: Date.now() - start }); };

    if (p.type === 'wss') {
      let ws;
      const timer = setTimeout(() => { try { ws && ws.close(); } catch (e) {} finish('blocked'); }, TIMEOUT_MS);
      try {
        ws = new WebSocket(p.url);
        ws.onopen = () => { clearTimeout(timer); try { ws.close(); } catch (e) {} finish('ok'); };
        ws.onerror = () => { clearTimeout(timer); finish('blocked'); };
        ws.onclose = (e) => { clearTimeout(timer); finish(e && e.code === 1000 ? 'ok' : 'blocked'); };
      } catch (e) { clearTimeout(timer); finish('blocked'); }
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} finish('blocked'); }, TIMEOUT_MS);
    fetch(p.url, { method: 'GET', cache: 'no-store', signal: ctrl.signal })
      .then(() => { clearTimeout(timer); finish('ok'); })
      .catch(() => { clearTimeout(timer); finish('blocked'); });
  });
}

export default function ProbeScreen() {
  const t = useTheme();
  const s = styles(t);
  const probes = useMemo(() => buildProbes(), []);
  const [results, setResults] = useState({});      // id -> { status, ms }
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [filter, setFilter] = useState('all');     // all | ok | channels | blocked
  const cancelRef = useRef(false);
  const resultsRef = useRef({});

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then((v) => {
      if (v) { try { const r = JSON.parse(v); resultsRef.current = r; setResults(r); } catch (e) {} }
    }).catch(() => {});
  }, []);

  const save = useCallback(() => {
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(resultsRef.current)).catch(() => {});
  }, []);

  const run = useCallback(async (list) => {
    if (running) return;
    cancelRef.current = false;
    setRunning(true);
    setProgress({ done: 0, total: list.length });
    // clear prior status for the ones we're about to test
    for (const p of list) { resultsRef.current[p.id] = { status: 'testing', ms: 0 }; }
    setResults({ ...resultsRef.current });

    let idx = 0, done = 0, sinceSave = 0;
    const worker = async () => {
      while (!cancelRef.current) {
        const i = idx++;
        if (i >= list.length) return;
        const p = list[i];
        const r = await testOne(p);
        resultsRef.current[p.id] = r;
        done++; sinceSave++;
        if (sinceSave >= 80) { sinceSave = 0; setResults({ ...resultsRef.current }); save(); }   // batch UI/storage for 8k list
        setProgress({ done, total: list.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
    setResults({ ...resultsRef.current });
    save();
    setRunning(false);
  }, [running, save]);

  const stop = useCallback(() => { cancelRef.current = true; }, []);
  const clear = useCallback(() => {
    resultsRef.current = {}; setResults({}); setProgress({ done: 0, total: 0 });
    AsyncStorage.removeItem(STORE_KEY).catch(() => {});
  }, []);

  const counts = useMemo(() => {
    let ok = 0, blocked = 0, chan = 0;
    for (const p of probes) {
      const r = results[p.id];
      if (!r) continue;
      if (r.status === 'ok') { ok++; if (p.channel) chan++; }
      else if (r.status === 'blocked') blocked++;
    }
    return { ok, blocked, chan, total: probes.length };
  }, [results, probes]);

  const data = useMemo(() => {
    let list = probes;
    if (filter === 'ok') list = probes.filter((p) => results[p.id]?.status === 'ok');
    else if (filter === 'blocked') list = probes.filter((p) => results[p.id]?.status === 'blocked');
    else if (filter === 'channels') list = probes.filter((p) => p.channel && results[p.id]?.status === 'ok');
    // reachable first, channels first within that
    return [...list].sort((a, b) => {
      const ra = results[a.id]?.status === 'ok' ? 0 : 1;
      const rb = results[b.id]?.status === 'ok' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      if (a.channel !== b.channel) return a.channel ? -1 : 1;
      return 0;
    });
  }, [probes, results, filter]);

  const copyGreens = useCallback(async () => {
    const greens = probes.filter((p) => results[p.id]?.status === 'ok');
    const chans = greens.filter((p) => p.channel);
    const lines = [];
    lines.push(`Signal Scout — Reachability results`);
    lines.push(`Reachable: ${greens.length}/${probes.length}  ·  Channel-capable reachable: ${chans.length}`);
    lines.push('');
    lines.push('== CHANNELS THAT WORK (can carry control) ==');
    for (const p of chans) lines.push(`⭐ ${p.cat} — ${p.name} (${p.url})`);
    lines.push('');
    lines.push('== OTHER REACHABLE ==');
    for (const p of greens.filter((x) => !x.channel)) lines.push(`✓ ${p.cat} — ${p.name}`);
    const text = lines.join('\n');
    await Clipboard.setStringAsync(text);
  }, [probes, results]);

  const renderItem = useCallback(({ item }) => {
    const r = results[item.id];
    const color = !r ? t.label3 : r.status === 'ok' ? t.green : r.status === 'testing' ? t.blue : t.red;
    const label = !r ? '—' : r.status === 'ok' ? `✓ ${r.ms}ms` : r.status === 'testing' ? '…' : '✗';
    return (
      <View style={s.row}>
        <View style={[s.dot, { backgroundColor: color }]} />
        <View style={s.flex}>
          <Text style={s.rowTitle} numberOfLines={1}>
            {item.channel ? '⭐ ' : ''}{item.name}
          </Text>
          <Text style={s.rowSub} numberOfLines={1}>{item.cat} · {item.type}</Text>
        </View>
        <Text style={[s.stat, { color }]}>{label}</Text>
      </View>
    );
  }, [results, t, s]);

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.head}>
        <Text style={s.title}>Reachability Lab</Text>
        <Text style={s.subtitle}>
          {probes.length} real endpoints. Run this on the locked network — green ones are doors.
          ⭐ marks services that could carry remote control. A full run takes a few minutes; most will
          be blocked (that's expected on an Apple-only network) — watch for any surprise greens.
        </Text>
      </View>

      <View style={s.summary}>
        <Stat s={s} n={counts.ok} label="Reachable" color={t.green} />
        <Stat s={s} n={counts.chan} label="⭐ Channels" color={t.blue} />
        <Stat s={s} n={counts.blocked} label="Blocked" color={t.red} />
        <Stat s={s} n={counts.total} label="Total" color={t.label2} />
      </View>

      {running && (
        <View style={s.progWrap}>
          <View style={s.progTrack}><View style={[s.progFill, { width: `${pct}%` }]} /></View>
          <Text style={s.progText}>{progress.done}/{progress.total}</Text>
        </View>
      )}

      <View style={s.btnWrap}>
        {!running ? (
          <>
            <Btn s={s} t={t} primary label="Run all" onPress={() => run(probes)} />
            <Btn s={s} t={t} label="⭐ Channels only" onPress={() => run(probes.filter((p) => p.channel))} />
            <Btn s={s} t={t} label="Copy greens" onPress={copyGreens} />
            <Btn s={s} t={t} danger label="Clear" onPress={clear} />
          </>
        ) : (
          <Btn s={s} t={t} danger label="Stop" onPress={stop} />
        )}
      </View>

      <View style={s.filterWrap}>
        {[['all', 'All'], ['ok', 'Reachable'], ['channels', '⭐ Channels'], ['blocked', 'Blocked']].map(([k, lbl]) => (
          <Pressable key={k} onPress={() => setFilter(k)} style={[s.chip, filter === k && s.chipOn]}>
            <Text style={[s.chipTxt, filter === k && s.chipTxtOn]}>{lbl}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
        initialNumToRender={20}
        maxToRenderPerBatch={30}
        windowSize={11}
        removeClippedSubviews
        ListEmptyComponent={<Text style={s.empty}>No matches. Run the tests, then filter.</Text>}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}

function Stat({ s, n, label, color }) {
  return (
    <View style={s.statBox}>
      <Text style={[s.statN, { color }]}>{n}</Text>
      <Text style={s.statL}>{label}</Text>
    </View>
  );
}
function Btn({ s, t, label, onPress, primary, danger }) {
  return (
    <Pressable onPress={onPress} style={[s.btn, primary && { backgroundColor: t.blue }, danger && { backgroundColor: t.red }]}>
      <Text style={[s.btnTxt, (primary || danger) && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = (t) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  flex: { flex: 1 },
  head: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  title: { fontSize: 30, fontWeight: '700', color: t.label, letterSpacing: 0.3 },
  subtitle: { fontSize: 13, color: t.label2, marginTop: 4, lineHeight: 18 },
  summary: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  statBox: { flex: 1, backgroundColor: t.card, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  statN: { fontSize: 22, fontWeight: '700' },
  statL: { fontSize: 11, color: t.label2, marginTop: 2 },
  progWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingBottom: 6 },
  progTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: t.fill, overflow: 'hidden' },
  progFill: { height: 6, backgroundColor: t.blue },
  progText: { fontSize: 12, color: t.label2, width: 72, textAlign: 'right' },
  btnWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4 },
  filterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  btn: { backgroundColor: t.card, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  btnTxt: { color: t.label, fontSize: 14, fontWeight: '600' },
  chip: { backgroundColor: t.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  chipOn: { backgroundColor: t.blue },
  chipTxt: { color: t.label2, fontSize: 13, fontWeight: '600' },
  chipTxtOn: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: ROW_H, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.sep },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle: { color: t.label, fontSize: 15, fontWeight: '500' },
  rowSub: { color: t.label2, fontSize: 11, marginTop: 2 },
  stat: { fontSize: 13, fontWeight: '600', minWidth: 60, textAlign: 'right' },
  empty: { color: t.label2, textAlign: 'center', marginTop: 40, fontSize: 14 },
});
