import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../components/theme';

/* ---------------- calculator ---------------- */
function Calculator({ t }) {
  const s = styles(t);
  const [disp, setDisp] = useState('0');
  const [prev, setPrev] = useState(null);
  const [op, setOp] = useState(null);
  const [fresh, setFresh] = useState(true); // next digit starts a new number

  const compute = (a, b, o) => {
    const x = parseFloat(a), y = parseFloat(b);
    if (o === '+') return x + y; if (o === '−') return x - y;
    if (o === '×') return x * y; if (o === '÷') return y === 0 ? NaN : x / y;
    return y;
  };
  const show = (n) => {
    if (!isFinite(n)) return 'Error';
    const r = Math.round(n * 1e10) / 1e10;
    return String(r);
  };
  const digit = (d) => {
    if (fresh) { setDisp(d === '.' ? '0.' : d); setFresh(false); return; }
    if (d === '.' && disp.includes('.')) return;
    setDisp(disp.length < 12 ? (disp === '0' && d !== '.' ? d : disp + d) : disp);
  };
  const operator = (o) => {
    if (op && !fresh) { const r = compute(prev, disp, op); setDisp(show(r)); setPrev(show(r)); }
    else setPrev(disp);
    setOp(o); setFresh(true);
  };
  const equals = () => { if (op == null) return; const r = compute(prev, disp, op); setDisp(show(r)); setPrev(null); setOp(null); setFresh(true); };
  const clear = () => { setDisp('0'); setPrev(null); setOp(null); setFresh(true); };
  const negate = () => setDisp(show(parseFloat(disp) * -1));
  const percent = () => setDisp(show(parseFloat(disp) / 100));

  const Btn = ({ label, kind, onPress, wide }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [s.key, wide && s.keyWide, kind === 'op' && s.keyOp, kind === 'fn' && s.keyFn, pressed && { opacity: 0.6 }]}>
      <Text style={[s.keyTxt, kind === 'op' && { color: '#fff' }, kind === 'fn' && { color: t.label }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={s.calcWrap}>
      <View style={s.calcDisp}><Text style={s.calcDispTxt} numberOfLines={1} adjustsFontSizeToFit>{disp}</Text></View>
      <View style={s.keyRow}>
        <Btn label={disp !== '0' || op ? 'C' : 'AC'} kind="fn" onPress={clear} />
        <Btn label="±" kind="fn" onPress={negate} />
        <Btn label="%" kind="fn" onPress={percent} />
        <Btn label="÷" kind="op" onPress={() => operator('÷')} />
      </View>
      {[['7', '8', '9', '×'], ['4', '5', '6', '−'], ['1', '2', '3', '+']].map((rowArr, ri) => (
        <View key={ri} style={s.keyRow}>
          {rowArr.map((k) => ['÷', '×', '−', '+'].includes(k)
            ? <Btn key={k} label={k} kind="op" onPress={() => operator(k)} />
            : <Btn key={k} label={k} onPress={() => digit(k)} />)}
        </View>
      ))}
      <View style={s.keyRow}>
        <Btn label="0" wide onPress={() => digit('0')} />
        <Btn label="." onPress={() => digit('.')} />
        <Btn label="=" kind="op" onPress={equals} />
      </View>
    </View>
  );
}

/* ---------------- unit converter ---------------- */
const CATS = {
  Length: { base: 'm', units: { km: 1000, m: 1, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 } },
  Weight: { base: 'kg', units: { t: 1000, kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, oz: 0.028349523 } },
  Volume: { base: 'L', units: { L: 1, mL: 0.001, gal: 3.7854118, qt: 0.9463529, cup: 0.2365882, 'fl oz': 0.0295735 } },
  Temp: { base: 'C', units: { '°C': 'C', '°F': 'F', K: 'K' } },
};
function toBaseTemp(v, u) { if (u === '°C') return v; if (u === '°F') return (v - 32) * 5 / 9; return v - 273.15; }
function fromBaseTemp(c, u) { if (u === '°C') return c; if (u === '°F') return c * 9 / 5 + 32; return c + 273.15; }

function Converter({ t }) {
  const s = styles(t);
  const cats = Object.keys(CATS);
  const [cat, setCat] = useState('Length');
  const units = Object.keys(CATS[cat].units);
  const [from, setFrom] = useState(units[0]);
  const [to, setTo] = useState(units[1] || units[0]);
  const [val, setVal] = useState('1');

  const pickCat = (c) => { const u = Object.keys(CATS[c].units); setCat(c); setFrom(u[0]); setTo(u[1] || u[0]); };

  const convert = () => {
    const x = parseFloat(val); if (!isFinite(x)) return '—';
    let out;
    if (cat === 'Temp') out = fromBaseTemp(toBaseTemp(x, from), to);
    else out = x * CATS[cat].units[from] / CATS[cat].units[to];
    const r = Math.round(out * 1e6) / 1e6;
    return String(r);
  };

  const UnitRow = ({ value, onPick }) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.unitRow}>
      {units.map((u) => (
        <Pressable key={u} onPress={() => onPick(u)} style={[s.unit, value === u && { backgroundColor: t.blue, borderColor: t.blue }]}>
          <Text style={[s.unitTxt, value === u && { color: t.onBlue }]}>{u}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  return (
    <View style={{ gap: 14 }}>
      <View style={s.seg}>
        {cats.map((c) => (
          <Pressable key={c} onPress={() => pickCat(c)} style={[s.segBtn, cat === c && s.segOn]}>
            <Text style={[s.segTxt, { color: cat === c ? t.label : t.label2 }]}>{c}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.lbl}>From</Text>
        <TextInput style={s.in} value={val} onChangeText={setVal} keyboardType="numbers-and-punctuation" selectTextOnFocus />
        <UnitRow value={from} onPick={setFrom} />
      </View>
      <View style={s.card}>
        <Text style={s.lbl}>To</Text>
        <Text style={s.result}>{convert()}</Text>
        <UnitRow value={to} onPick={setTo} />
      </View>
    </View>
  );
}

export default function ToolsScreen() {
  const t = useTheme();
  const s = styles(t);
  const [tab, setTab] = useState('calc');
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>Tools</Text>
        <Text style={s.sub}>Calculator and converter — work with no signal.</Text>
        <View style={s.seg}>
          <Pressable onPress={() => setTab('calc')} style={[s.segBtn, tab === 'calc' && s.segOn]}><Text style={[s.segTxt, { color: tab === 'calc' ? t.label : t.label2 }]}>Calculator</Text></Pressable>
          <Pressable onPress={() => setTab('conv')} style={[s.segBtn, tab === 'conv' && s.segOn]}><Text style={[s.segTxt, { color: tab === 'conv' ? t.label : t.label2 }]}>Converter</Text></Pressable>
        </View>
        {tab === 'calc' ? <Calculator t={t} /> : <Converter t={t} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (t) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  wrap: { padding: 20, gap: 14 },
  title: { fontSize: 34, fontWeight: '700', color: t.label, letterSpacing: 0.3 },
  sub: { fontSize: 15, color: t.label2, marginTop: -6 },
  seg: { flexDirection: 'row', backgroundColor: t.fill, borderRadius: 10, padding: 3, gap: 2 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segOn: { backgroundColor: t.card },
  segTxt: { fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: t.card, borderRadius: 16, padding: 16, gap: 10 },
  lbl: { color: t.label2, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  in: { backgroundColor: t.fill, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: t.label, fontSize: 24, fontWeight: '600' },
  result: { color: t.label, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  unitRow: { gap: 8, paddingVertical: 2 },
  unit: { borderWidth: 1, borderColor: t.sep, backgroundColor: t.bg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  unitTxt: { color: t.label, fontSize: 13, fontWeight: '600' },

  calcWrap: { gap: 10 },
  calcDisp: { backgroundColor: t.card, borderRadius: 16, paddingHorizontal: 20, paddingVertical: 24, alignItems: 'flex-end' },
  calcDispTxt: { color: t.label, fontSize: 52, fontWeight: '300', letterSpacing: -1 },
  keyRow: { flexDirection: 'row', gap: 10 },
  key: { flex: 1, aspectRatio: 1, backgroundColor: t.card, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  keyWide: { flex: 2.08, aspectRatio: undefined, borderRadius: 999 },
  keyOp: { backgroundColor: t.blue },
  keyFn: { backgroundColor: t.fill },
  keyTxt: { color: t.label, fontSize: 28, fontWeight: '500' },
});
