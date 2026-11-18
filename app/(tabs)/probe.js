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

// Test one endpoint. 'ok' = the REAL host answered; 'portal' = we were redirected to a different host
// (a captive-portal / filter login page — not a real reach); 'blocked' = timeout / refused / error.
// A genuine internet round trip (DNS+TCP+TLS+HTTP) is basically never under ~20ms, so an "ok" that
// fast is almost certainly a LOCAL block page the network injected — we flag it suspect, not trusted.
const SUSPECT_MS = 20;
function hostOf(u) { try { return new URL(u).host; } catch (e) { return ''; } }

function testOne(p) {
  const start = Date.now();
  return new Promise((resolve) => {
    let done = false;
    const finish = (status, extra) => { if (done) return; done = true; resolve({ status, ms: Date.now() - start, ...(extra || {}) }); };

    if (p.type === 'wss') {
      let ws;
      const timer = setTimeout(() => { try { ws && ws.close(); } catch (e) {} finish('blocked'); }, TIMEOUT_MS);
      try {
        ws = new WebSocket(p.url);
        ws.onopen = () => { clearTimeout(timer); const ms = Date.now() - start; try { ws.close(); } catch (e) {} finish('ok', { suspect: ms < SUSPECT_MS }); };
        ws.onerror = () => { clearTimeout(timer); finish('blocked'); };
        ws.onclose = (e) => { clearTimeout(timer); finish(e && e.code === 1000 ? 'ok' : 'blocked'); };
      } catch (e) { clearTimeout(timer); finish('blocked'); }
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} finish('blocked'); }, TIMEOUT_MS);
    const target = hostOf(p.url);
    fetch(p.url, { method: 'GET', cache: 'no-store', redirect: 'follow', signal: ctrl.signal })
      .then((res) => {
        clearTimeout(timer);
        const ms = Date.now() - start;
        const finalHost = hostOf(res.url || '');
        if (res.redirected && finalHost && target && finalHost !== target) { finish('portal', { code: res.status, to: finalHost }); return; }
        finish('ok', { code: res.status, suspect: ms < SUSPECT_MS });
      })
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
    let real = 0, chan = 0, suspect = 0, blocked = 0;
    for (const p of probes) {
      const r = results[p.id];
      if (!r) continue;
      if (r.status === 'ok' && !r.suspect) { real++; if (p.channel) chan++; }
      else if ((r.status === 'ok' && r.suspect) || r.status === 'portal') suspect++;
      else if (r.status === 'blocked') blocked++;
    }
    return { real, chan, suspect, blocked, total: probes.length };
  }, [results, probes]);

  const isReal = useCallback((id) => results[id]?.status === 'ok' && !results[id]?.suspect, [results]);
  const isSuspect = useCallback((id) => (results[id]?.status === 'ok' && results[id]?.suspect) || results[id]?.status === 'portal', [results]);

  const data = useMemo(() => {
    let list = probes;
    if (filter === 'ok') list = probes.filter((p) => isReal(p.id));
    else if (filter === 'blocked') list = probes.filter((p) => results[p.id]?.status === 'blocked');
    else if (filter === 'channels') list = probes.filter((p) => p.channel && isReal(p.id));
    else if (filter === 'suspect') list = probes.filter((p) => isSuspect(p.id));
    // genuinely reachable first, channels first within that
    return [...list].sort((a, b) => {
      const ra = isReal(a.id) ? 0 : 1;
      const rb = isReal(b.id) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      if (a.channel !== b.channel) return a.channel ? -1 : 1;
      return 0;
    });
  }, [probes, results, filter, isReal, isSuspect]);

  const copyGreens = useCallback(async () => {
    const real = probes.filter((p) => results[p.id]?.status === 'ok' && !results[p.id]?.suspect);
    const chans = real.filter((p) => p.channel);
    const suspects = probes.filter((p) => (results[p.id]?.status === 'ok' && results[p.id]?.suspect) || results[p.id]?.status === 'portal');
    const lines = [];
    lines.push('Signal Scout — Reachability results');
    lines.push(`Genuinely reachable: ${real.length}/${probes.length}  ·  channel-capable: ${chans.length}  ·  suspect (block page?): ${suspects.length}`);
    lines.push('');
    lines.push('== CHANNELS THAT WORK (can carry control) ==');
    for (const p of chans) lines.push(`⭐ ${p.cat} — ${p.name} (${p.url})  ${results[p.id].code || ''} ${results[p.id].ms}ms`);
    lines.push('');
    lines.push('== OTHER GENUINELY REACHABLE ==');
    for (const p of real.filter((x) => !x.channel)) lines.push(`✓ ${p.cat} — ${p.name}  ${results[p.id].ms}ms`);
    lines.push('');
    lines.push('== SUSPECT (likely the network\'s own block/login page, not a real reach) ==');
    for (const p of suspects) lines.push(`⚠ ${p.name}  ${results[p.id].ms}ms${results[p.id].to ? ' → ' + results[p.id].to : ''}`);
    await Clipboard.setStringAsync(lines.join('\n'));
  }, [probes, results]);

  const renderItem = useCallback(({ item }) => {
    const r = results[item.id];
    const real = r && r.status === 'ok' && !r.suspect;
    const suspect = r && ((r.status === 'ok' && r.suspect) || r.status === 'portal');
    const color = !r ? t.label3 : real ? t.green : suspect ? '#FF9F0A' : r.status === 'testing' ? t.blue : t.red;
    const label = !r ? '—'
      : r.status === 'testing' ? '…'
      : real ? `✓ ${r.code || ''} ${r.ms}ms`.replace('  ', ' ').trim()
      : r.status === 'portal' ? '→ portal'
      : (r.status === 'ok' && r.suspect) ? `⚠ ${r.ms}ms`
      : '✗';
    return (
      <View style={s.row}>
        <View style={[s.dot, { backgroundColor: color }]} />
        <View style={s.flex}>
          <Text style={s.rowTitle} numberOfLines={1}>
            {item.channel ? '⭐ ' : ''}{item.name}
          </Text>
          <Text style={s.rowSub} numberOfLines={1}>
            {suspect ? (r.status === 'portal' ? `block/login page → ${r.to}` : 'likely a block page (too fast)') : `${item.cat} · ${item.type}`}
          </Text>
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
          {probes.length} real endpoints. Green = genuinely reached; ⚠ amber = suspect (the network
          likely answered with its own block/login page, not a real reach); red = blocked. ⭐ marks
          services that could carry remote control. A full run takes a few minutes.
        </Text>
      </View>

      <View style={s.summary}>
        <Stat s={s} n={counts.real} label="Reachable" color={t.green} />
        <Stat s={s} n={counts.chan} label="⭐ Channels" color={t.blue} />
        <Stat s={s} n={counts.suspect} label="⚠ Suspect" color="#FF9F0A" />
        <Stat s={s} n={counts.blocked} label="Blocked" color={t.red} />
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
        {[['all', 'All'], ['ok', 'Reachable'], ['channels', '⭐ Channels'], ['suspect', '⚠ Suspect'], ['blocked', 'Blocked']].map(([k, lbl]) => (
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
