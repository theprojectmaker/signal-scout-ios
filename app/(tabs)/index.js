import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Platform,
  Modal, TextInput, LayoutAnimation, UIManager, useColorScheme, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Polyline, Line } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE = 'scout.spots.v1';
const HISTORY_MAX = 32;
const PING_TIMEOUT = 3000;
const DOWN_TIMEOUT = 6000;
const DOWN_BYTES = 160000; // lighter than before: fast + saves data
const CYCLE_GAP = 800;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ---------------- theme (iOS system colors) ---------------- */
function useTheme() {
  const dark = useColorScheme() === 'dark';
  return useMemo(() => dark ? {
    dark: true,
    bg: '#000000', card: '#1C1C1E', fill: '#2C2C2E', sep: '#38383A', track: '#2C2C2E',
    label: '#FFFFFF', label2: '#98989F', label3: '#636366',
    blue: '#0A84FF', green: '#30D158', orange: '#FF9F0A', red: '#FF453B', onBlue: '#FFFFFF',
  } : {
    dark: false,
    bg: '#F2F2F7', card: '#FFFFFF', fill: '#E9E9EB', sep: '#E5E5EA', track: '#E9E9EB',
    label: '#1C1C1E', label2: '#8E8E93', label3: '#C7C7CC',
    blue: '#007AFF', green: '#34C759', orange: '#FF9500', red: '#FF3B30', onBlue: '#FFFFFF',
  }, [dark]);
}

/* ---------------- scoring + measurement ---------------- */
const band = (s) => (s >= 67 ? 'green' : s >= 34 ? 'orange' : 'red');
const bandColor = (t, s) => t[band(s)];
const word = (s) =>
  s >= 85 ? 'Excellent' : s >= 67 ? 'Good' : s >= 45 ? 'Fair' : s >= 25 ? 'Weak' : 'Very weak';

function scoreOf(pingMs, mbps) {
  const p = Math.max(0, Math.min(100, ((400 - pingMs) / (400 - 20)) * 100));
  const s = Math.max(0, Math.min(100, (mbps / 12) * 100));
  const score = mbps > 0 ? Math.round(p * 0.45 + s * 0.55) : Math.round(p);
  return Math.max(0, Math.min(100, score));
}

// fetch that can never hang — aborts after `ms`
function fetchT(url, ms) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), ms);
  return fetch(url, { cache: 'no-store', signal: ac.signal }).finally(() => clearTimeout(to));
}
async function pingTest(n = 3) {
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const t = Date.now();
    try {
      await fetchT('https://speed.cloudflare.com/__down?bytes=0&r=' + Math.random(), PING_TIMEOUT);
      best = Math.min(best, Date.now() - t);
    } catch (e) { /* timed out or failed — try the next */ }
  }
  return best;
}
async function downloadTest() {
  const t = Date.now();
  try {
    const r = await fetchT('https://speed.cloudflare.com/__down?bytes=' + DOWN_BYTES + '&r=' + Math.random(), DOWN_TIMEOUT);
    const buf = await r.arrayBuffer();
    const sec = (Date.now() - t) / 1000;
    return sec > 0 ? (buf.byteLength * 8) / sec / 1e6 : 0;
  } catch (e) { return 0; }
}
async function measure() {
  const p = await pingTest();
  if (p === Infinity) return { ping: null, mbps: 0, score: 0, offline: true };
  const mbps = await downloadTest();
  return { ping: Math.round(p), mbps: +mbps.toFixed(1), score: scoreOf(p, mbps), offline: false };
}
function netLabel() {
  try {
    const c = typeof navigator !== 'undefined' && (navigator.connection || navigator.webkitConnection);
    if (c && c.effectiveType) return c.effectiveType.toUpperCase();
  } catch (e) {}
  return 'Live';
}
const haptic = (kind) => {
  try {
    const H = require('expo-haptics');
    if (kind === 'success') H.notificationAsync(H.NotificationFeedbackType.Success);
    else H.impactAsync(H.ImpactFeedbackStyle.Light);
  } catch (e) {}
};

/* ---------------- gauge ---------------- */
function Gauge({ t, score, offline, idle, pulse }) {
  const size = 212, stroke = 14, r = (size - stroke) / 2, c = size / 2;
  const circ = 2 * Math.PI * r;
  const col = offline ? t.red : idle ? t.label2 : bandColor(t, score);
  const pct = offline || idle ? 0 : score / 100;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={r} stroke={t.track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={c} cy={c} r={r} stroke={col} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={circ * (1 - pct)} transform={`rotate(-90 ${c} ${c})`}
        />
      </Svg>
      <Animated.View style={{ position: 'absolute', alignItems: 'center', transform: [{ scale: pulse }] }}>
        <Text style={{ fontSize: 60, fontWeight: '700', letterSpacing: -2, color: offline ? t.red : idle ? t.label2 : t.label, lineHeight: 64 }}>
          {offline ? '0' : idle ? '—' : score}
        </Text>
        <Text style={{ fontSize: 15, fontWeight: '600', color: col, marginTop: 2 }}>
          {offline ? 'No connection' : idle ? 'Ready' : word(score)}
        </Text>
        <Text style={{ fontSize: 12, color: t.label3, marginTop: 3 }}>out of 100</Text>
      </Animated.View>
    </View>
  );
}

function Signal({ t, score, size = 1 }) {
  const col = bandColor(t, score);
  const lit = Math.ceil(score / 20);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3 * size }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ width: 4 * size, borderRadius: 2, height: (6 + i * 4) * size, backgroundColor: i < lit ? col : t.sep }} />
      ))}
    </View>
  );
}

/* live trend sparkline of recent scores */
function Sparkline({ t, history, color }) {
  const W = 300, H = 44, pad = 3;
  if (history.length < 2) {
    return <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: t.label3, fontSize: 12.5 }}>Start scanning to see your signal over time</Text>
    </View>;
  }
  const n = history.length;
  const stepX = (W - pad * 2) / (HISTORY_MAX - 1);
  const pts = history.map((v, i) => {
    const x = pad + (HISTORY_MAX - n + i) * stepX;
    const y = pad + (1 - v / 100) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const midY = pad + (1 - 0.5) * (H - pad * 2);
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <Line x1={0} y1={midY} x2={W} y2={midY} stroke={t.sep} strokeWidth={1} strokeDasharray="3 4" />
      <Polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

/* ---------------- screen ---------------- */
export default function Screen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();

  const [scanning, setScanning] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [reading, setReading] = useState(null);
  const [history, setHistory] = useState([]);
  const [lastAt, setLastAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [spots, setSpots] = useState([]);
  const [showTips, setShowTips] = useState(false);
  const [naming, setNaming] = useState(false);
  const [nameText, setNameText] = useState('My desk');
  const [toast, setToast] = useState('');

  const scanRef = useRef(false);
  const seqRef = useRef(0);
  const timerRef = useRef(null);
  const lastBandRef = useRef(null);
  const toastTimer = useRef(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const dot = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    AsyncStorage.getItem(STORE).then((v) => { if (v) try { setSpots(JSON.parse(v)); } catch (e) {} });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(tick); clearTimeout(timerRef.current); scanRef.current = false; };
  }, []);

  // pulsing live dot while scanning
  useEffect(() => {
    if (scanning) {
      const anim = Animated.loop(Animated.sequence([
        Animated.timing(dot, { toValue: 0.25, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(dot, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      anim.start();
      return () => anim.stop();
    } else {
      dot.setValue(1);
    }
  }, [scanning]);

  const persist = useCallback((next) => {
    setSpots(next);
    AsyncStorage.setItem(STORE, JSON.stringify(next)).catch(() => {});
  }, []);
  const flash = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  };

  const applyReading = (m) => {
    setReading(m);
    setLastAt(Date.now());
    setHistory((h) => [...h, m.offline ? 0 : m.score].slice(-HISTORY_MAX));
    // quick pulse so a new reading is unmistakable
    pulse.setValue(1);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.05, duration: 140, useNativeDriver: true }),
      Animated.spring(pulse, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();

    const b = m.offline ? 'red' : band(m.score);
    if (b === 'green' && lastBandRef.current && lastBandRef.current !== 'green') {
      haptic('success');
      flash('Good spot here — ' + m.score + ' out of 100');
      if (Platform.OS !== 'web') {
        try {
          const N = require('expo-notifications');
          N.scheduleNotificationAsync({ content: { title: 'Good signal here', body: m.score + ' out of 100. A good spot for your files.' }, trigger: null });
        } catch (e) {}
      }
    }
    lastBandRef.current = b;
  };

  const loop = useCallback(() => {
    if (!scanRef.current) return;
    const seq = ++seqRef.current;
    setMeasuring(true);
    measure().then((m) => {
      if (seqRef.current !== seq || !scanRef.current) return;
      applyReading(m);
    }).catch(() => {}).finally(() => {
      if (seqRef.current !== seq) return;
      setMeasuring(false);
      if (scanRef.current) timerRef.current = setTimeout(loop, CYCLE_GAP);
    });
  }, []);

  const toggleScan = () => {
    const next = !scanning;
    setScanning(next); scanRef.current = next; haptic('light');
    if (next) {
      try { const K = require('expo-keep-awake'); Promise.resolve(K.activateKeepAwakeAsync()).catch(() => {}); } catch (e) {}
      if (Platform.OS !== 'web') { try { const N = require('expo-notifications'); Promise.resolve(N.requestPermissionsAsync()).catch(() => {}); } catch (e) {} }
      loop();
    } else {
      clearTimeout(timerRef.current);
      setMeasuring(false);
      try { const K = require('expo-keep-awake'); Promise.resolve(K.deactivateKeepAwake()).catch(() => {}); } catch (e) {}
    }
  };

  const openSave = () => {
    if (!reading || reading.offline) { flash('Measure a spot first'); return; }
    haptic('light'); setNameText('Spot ' + (spots.length + 1)); setNaming(true);
  };
  const confirmSave = () => {
    const nm = (nameText || '').trim() || 'Spot ' + (spots.length + 1);
    const r = reading;
    persist([...spots, { id: Date.now(), name: nm, score: r.score, ping: r.ping, mbps: r.mbps }]);
    setNaming(false); haptic('success'); flash('Saved “' + nm + '”');
  };
  const removeSpot = (id) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    persist(spots.filter((x) => x.id !== id)); haptic('light');
  };

  const sorted = [...spots].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const r = reading;
  const idle = !r && !scanning;

  // trend from recent history
  const trend = useMemo(() => {
    if (history.length < 4) return null;
    const recent = history.slice(-3);
    const prev = history.slice(-6, -3);
    if (prev.length === 0) return null;
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const d = avg(recent) - avg(prev);
    if (d > 4) return { dir: 'up', txt: 'Rising', color: t.green };
    if (d < -4) return { dir: 'down', txt: 'Falling', color: t.red };
    return { dir: 'flat', txt: 'Steady', color: t.label2 };
  }, [history, t]);

  // "updated Ns ago" text
  const agoTxt = (() => {
    if (!lastAt) return scanning ? 'Starting…' : 'Not started';
    if (measuring) return 'Measuring…';
    const secs = Math.max(0, Math.round((now - lastAt) / 1000));
    if (secs <= 1) return 'Updated just now';
    return `Updated ${secs}s ago`;
  })();

  const liveColor = r && r.offline ? t.red : scanning ? t.green : t.label2;
  const sparkColor = r && r.offline ? t.red : trend ? trend.color : t.blue;
  const vsBest = r && !r.offline && best ? r.score - best.score : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 44, paddingHorizontal: 18 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.title}>Signal Scout</Text>
        <Text style={s.subtitle}>Find the spot with the best data.</Text>

        {/* live gauge card */}
        <View style={[s.card, { paddingTop: 16, paddingBottom: 18 }]}>
          {/* status row */}
          <View style={s.statusRow}>
            <View style={s.statusLeft}>
              <Animated.View style={[s.liveDot, { backgroundColor: liveColor, opacity: scanning ? dot : 1 }]} />
              <Text style={[s.statusTxt, { color: t.label2 }]}>{agoTxt}</Text>
            </View>
            {trend && scanning && (
              <View style={[s.trendChip, { backgroundColor: t.dark ? t.fill : t.bg }]}>
                <Text style={{ color: trend.color, fontSize: 13, fontWeight: '600' }}>
                  {trend.dir === 'up' ? '↑ ' : trend.dir === 'down' ? '↓ ' : '→ '}{trend.txt}
                </Text>
              </View>
            )}
          </View>

          <View style={{ alignItems: 'center', marginTop: 6 }}>
            <Gauge t={t} score={r ? r.score : 0} offline={r ? r.offline : false} idle={idle} pulse={pulse} />
          </View>

          {/* stats */}
          <View style={s.stats}>
            <Stat s={s} value={r && r.ping != null ? String(r.ping) : '—'} unit="ms" label="Ping" />
            <View style={s.vsep} />
            <Stat s={s} value={r && r.mbps > 0 ? String(r.mbps) : '—'} unit="Mbps" label="Download" />
            <View style={s.vsep} />
            <Stat s={s} value={r && !r.offline ? netLabel() : '—'} unit="" label="Network" />
          </View>

          {/* live sparkline */}
          <View style={{ marginTop: 16 }}>
            <Sparkline t={t} history={history} color={sparkColor} />
          </View>
          {vsBest != null && best && (
            <Text style={s.vsBest}>
              {vsBest >= 0
                ? `As good as or better than your best spot (${best.name})`
                : `${Math.abs(vsBest)} below your best spot (${best.name})`}
            </Text>
          )}
        </View>

        {/* actions */}
        <Pressable onPress={toggleScan} style={({ pressed }) => [s.primary, { backgroundColor: scanning ? t.red : t.blue }, pressed && s.pressed]}>
          <Text style={s.primaryTxt}>{scanning ? 'Stop Scanning' : 'Start Scanning'}</Text>
        </Pressable>
        <Pressable onPress={openSave} style={({ pressed }) => [s.secondary, pressed && s.pressed]}>
          <Text style={s.secondaryTxt}>Save This Spot</Text>
        </Pressable>

        {/* spots */}
        <Text style={s.section}>YOUR SPOTS</Text>
        <View style={s.card}>
          {best && (
            <View style={[s.bestRow, { backgroundColor: t.dark ? 'rgba(48,209,88,0.14)' : 'rgba(52,199,89,0.12)' }]}>
              <Signal t={t} score={best.score} />
              <Text style={s.bestTxt}>
                Best spot: <Text style={{ fontWeight: '600', color: t.label }}>{best.name}</Text>. Stand here for your files.
              </Text>
            </View>
          )}
          {sorted.length === 0 ? (
            <Text style={s.empty}>No spots yet. Measure a place, then tap Save This Spot.</Text>
          ) : (
            sorted.map((x, i) => (
              <View key={x.id} style={[s.row, i > 0 && s.rowSep]}>
                <Signal t={t} score={x.score} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowName} numberOfLines={1}>{x.name}</Text>
                  <Text style={s.rowMeta}>{x.ping != null ? x.ping + ' ms' : '—'} · {x.mbps > 0 ? x.mbps + ' Mbps' : 'no data'}</Text>
                </View>
                <Text style={[s.rowScore, { color: bandColor(t, x.score) }]}>{x.score}</Text>
                <Pressable onPress={() => removeSpot(x.id)} hitSlop={12} style={({ pressed }) => [pressed && s.pressed]}>
                  <Text style={[s.remove, { color: t.blue }]}>Remove</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        {/* tips */}
        <Text style={s.section}>IMPROVE SIGNAL</Text>
        <View style={s.card}>
          <Pressable onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setShowTips(!showTips); haptic('light'); }} style={({ pressed }) => [s.tipsHead, pressed && s.pressed]}>
            <Text style={s.tipsTitle}>Ways to actually improve signal</Text>
            <Text style={[s.disclose, { color: t.label2 }]}>{showTips ? 'Hide' : 'Show'}</Text>
          </Pressable>
          {showTips && (
            <View>
              <Tip s={s} t="Walk while scanning" d="Keep the app open and move slowly. Watch the graph above rise or fall — stop where it peaks. That is the strongest spot nearby." />
              <Tip s={s} t="Turn on Wi-Fi Calling" d="Settings › Phone › Wi-Fi Calling. If any Wi-Fi exists, calls and texts use it instead of the weak cell signal." />
              <Tip s={s} t="Toggle Airplane Mode" d="Flip it on, then off. Forces the phone to grab the strongest tower instead of clinging to a weak one." />
              <Tip s={s} t="Move toward a window" d="Signal is far stronger near glass and exterior walls." />
              <Tip s={s} t="Keep the edges clear" d="The antennas sit at the top and bottom. A hand or thick case over them lowers signal." />
              <Tip s={s} t="A booster is the only real amplifier" d="Hardware like weBoost truly strengthens signal. No app can — transmit power is fixed and capped by law." last />
            </View>
          )}
        </View>

        <Text style={s.footer}>
          Measures real data speed to a test server, not the raw radio — which the phone keeps apps from reading. Everything stays on your device.
        </Text>
      </ScrollView>

      {/* name sheet */}
      <Modal visible={naming} transparent animationType="fade" onRequestClose={() => setNaming(false)}>
        <Pressable style={s.backdrop} onPress={() => setNaming(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <Text style={s.sheetTitle}>Name this spot</Text>
            <TextInput
              value={nameText} onChangeText={setNameText} placeholder="My desk" placeholderTextColor={t.label3}
              style={s.input} autoFocus selectTextOnFocus onSubmitEditing={confirmSave} returnKeyType="done"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable onPress={() => setNaming(false)} style={({ pressed }) => [s.sheetBtn, { backgroundColor: t.fill }, pressed && s.pressed]}>
                <Text style={[s.sheetBtnTxt, { color: t.label }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmSave} style={({ pressed }) => [s.sheetBtn, { backgroundColor: t.blue }, pressed && s.pressed]}>
                <Text style={[s.sheetBtnTxt, { color: t.onBlue }]}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {toast ? (
        <View style={[s.toast, { bottom: insets.bottom + 26, backgroundColor: t.dark ? '#2C2C2E' : '#1C1C1E' }]} pointerEvents="none">
          <Text style={s.toastTxt}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Stat({ s, value, unit, label }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={s.statVal}>{value}{unit ? <Text style={s.statUnit}> {unit}</Text> : null}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}
function Tip({ s, t, d, last }) {
  return (
    <View style={[s.tip, s.rowSep, last && { borderBottomWidth: 0 }]}>
      <Text style={s.tipT}>{t}</Text>
      <Text style={s.tipD}>{d}</Text>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    title: { color: t.label, fontSize: 34, fontWeight: '700', letterSpacing: 0.37, marginTop: 6 },
    subtitle: { color: t.label2, fontSize: 15, marginTop: 2, marginBottom: 20 },

    card: { backgroundColor: t.card, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 6, marginBottom: 8, overflow: 'hidden' },

    statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 },
    statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    liveDot: { width: 9, height: 9, borderRadius: 5 },
    statusTxt: { fontSize: 13.5, fontWeight: '500' },
    trendChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9 },

    stats: { flexDirection: 'row', alignItems: 'center', marginTop: 20, alignSelf: 'stretch' },
    vsep: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: t.sep },
    statVal: { color: t.label, fontSize: 21, fontWeight: '600', letterSpacing: -0.4 },
    statUnit: { color: t.label2, fontSize: 13, fontWeight: '500' },
    statLabel: { color: t.label2, fontSize: 12.5, marginTop: 3 },
    vsBest: { color: t.label2, fontSize: 12.5, textAlign: 'center', marginTop: 10 },

    primary: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 10 },
    primaryTxt: { color: '#FFFFFF', fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
    secondary: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 10, backgroundColor: t.card },
    secondaryTxt: { color: t.blue, fontSize: 17, fontWeight: '500' },
    pressed: { opacity: 0.55 },

    section: { color: t.label2, fontSize: 12.5, fontWeight: '500', letterSpacing: 0.5, marginTop: 22, marginBottom: 8, marginLeft: 16 },

    bestRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, marginHorizontal: -16, paddingLeft: 16 },
    bestTxt: { flex: 1, color: t.label2, fontSize: 13.5, lineHeight: 18 },

    empty: { color: t.label2, fontSize: 14, textAlign: 'center', paddingVertical: 18 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
    rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
    rowName: { color: t.label, fontSize: 16, fontWeight: '500' },
    rowMeta: { color: t.label2, fontSize: 13, marginTop: 2 },
    rowScore: { fontSize: 19, fontWeight: '600', letterSpacing: -0.4 },
    remove: { fontSize: 14, fontWeight: '400' },

    tipsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
    tipsTitle: { color: t.label, fontSize: 16, fontWeight: '500' },
    disclose: { fontSize: 15 },
    tip: { paddingVertical: 13 },
    tipT: { color: t.label, fontSize: 15, fontWeight: '600' },
    tipD: { color: t.label2, fontSize: 13.5, marginTop: 3, lineHeight: 18 },

    footer: { color: t.label3, fontSize: 12.5, textAlign: 'center', marginTop: 18, lineHeight: 17, paddingHorizontal: 10 },

    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingHorizontal: 32 },
    sheet: { backgroundColor: t.card, borderRadius: 20, padding: 18 },
    sheetTitle: { color: t.label, fontSize: 17, fontWeight: '600', marginBottom: 14, textAlign: 'center' },
    input: { backgroundColor: t.fill, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: t.label, fontSize: 17 },
    sheetBtn: { flex: 1, borderRadius: 13, paddingVertical: 14, alignItems: 'center' },
    sheetBtnTxt: { fontSize: 17, fontWeight: '600' },

    toast: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14 },
    toastTxt: { color: '#FFFFFF', fontWeight: '500', fontSize: 14 },
  });
}
