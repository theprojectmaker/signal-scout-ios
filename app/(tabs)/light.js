import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { CameraView, getCameraPermissionsAsync, requestCameraPermissionsAsync } from 'expo-camera';
import * as Brightness from 'expo-brightness';

const IS_WEB = Platform.OS === 'web';

/* Morse SOS: ... --- ...  (unit = 250ms) */
function sosSteps() {
  const U = 250, s = [];
  const dot = () => { s.push({ on: true, d: U }); s.push({ on: false, d: U }); };
  const dash = () => { s.push({ on: true, d: 3 * U }); s.push({ on: false, d: U }); };
  dot(); dot(); dot(); s.push({ on: false, d: 2 * U });
  dash(); dash(); dash(); s.push({ on: false, d: 2 * U });
  dot(); dot(); dot(); s.push({ on: false, d: 6 * U });
  return s;
}
const STEPS = sosSteps();

function useTheme() {
  const dark = useColorScheme() === 'dark';
  return useMemo(() => dark
    ? { bg: '#000', card: '#1C1C1E', fill: '#2C2C2E', sep: '#38383A', label: '#fff', label2: '#98989F', blue: '#0A84FF', red: '#FF453B', amber: '#FFD60A' }
    : { bg: '#F2F2F7', card: '#fff', fill: '#E9E9EB', sep: '#E5E5EA', label: '#1C1C1E', label2: '#8E8E93', blue: '#007AFF', red: '#FF3B30', amber: '#FF9F0A' }, [dark]);
}

const PowerIcon = ({ c }) => <Svg width={44} height={44} viewBox="0 0 24 24"><Path d="M12 3v9" stroke={c} strokeWidth={2.2} strokeLinecap="round" /><Path d="M7 5.5a8 8 0 1 0 10 0" fill="none" stroke={c} strokeWidth={2.2} strokeLinecap="round" /></Svg>;

export default function LightScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const s = styles(t);

  const [mode, setMode] = useState(IS_WEB ? 'screen' : 'torch');
  const [on, setOn] = useState(false);
  const [sos, setSos] = useState(false);
  const [sosOn, setSosOn] = useState(false);
  const [camPerm, setCamPerm] = useState(null);
  const [screenColor, setScreenColor] = useState('#FFFFFF');
  const stepRef = useRef(0);
  const timerRef = useRef(null);
  const prevBrightness = useRef(null);

  const lightOn = sos ? sosOn : on;
  const torchActive = mode === 'torch' && lightOn && !IS_WEB;
  const screenWhite = mode === 'screen' && lightOn;
  const active = on || sos;

  useEffect(() => {
    let K;
    try { K = require('expo-keep-awake'); } catch (e) {}
    if (active && K) Promise.resolve(K.activateKeepAwakeAsync()).catch(() => {});
    return () => { if (K) Promise.resolve(K.deactivateKeepAwake()).catch(() => {}); };
  }, [active]);

  useEffect(() => {
    if (IS_WEB) return;
    (async () => {
      try {
        if (screenWhite) {
          if (prevBrightness.current == null) prevBrightness.current = await Brightness.getBrightnessAsync();
          await Brightness.setBrightnessAsync(1);
        } else if (prevBrightness.current != null) {
          await Brightness.setBrightnessAsync(prevBrightness.current);
          prevBrightness.current = null;
        }
      } catch (e) {}
    })();
  }, [screenWhite]);

  useEffect(() => {
    if (!sos) { clearTimeout(timerRef.current); setSosOn(false); return; }
    stepRef.current = 0;
    const run = () => {
      const step = STEPS[stepRef.current % STEPS.length];
      setSosOn(step.on);
      timerRef.current = setTimeout(() => { stepRef.current += 1; run(); }, step.d);
    };
    run();
    return () => clearTimeout(timerRef.current);
  }, [sos]);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (!IS_WEB && prevBrightness.current != null) Brightness.setBrightnessAsync(prevBrightness.current).catch(() => {});
  }, []);

  const ensureTorchPerm = useCallback(async () => {
    if (IS_WEB) return false;
    try {
      let p = camPerm || await getCameraPermissionsAsync();
      if (!p.granted) p = await requestCameraPermissionsAsync();
      setCamPerm(p);
      return p.granted;
    } catch (e) { return false; }
  }, [camPerm]);

  const togglePower = async () => {
    if (!on) {
      if (sos) setSos(false);
      if (mode === 'torch') { const ok = await ensureTorchPerm(); if (!ok) setMode('screen'); }
    }
    setOn((v) => !v);
  };
  const toggleSos = async () => {
    if (!sos) {
      if (on) setOn(false);
      if (mode === 'torch') { const ok = await ensureTorchPerm(); if (!ok) setMode('screen'); }
    }
    setSos((v) => !v);
  };
  const switchMode = async (m) => {
    if (m === 'torch') { const ok = await ensureTorchPerm(); if (!ok) return; }
    setMode(m);
  };

  if (screenWhite) {
    const darkText = screenColor === '#FFFFFF' || screenColor === '#FFD60A';
    return (
      <Pressable style={[st.white, { backgroundColor: screenColor }]} onPress={() => { setOn(false); setSos(false); }}>
        <Text style={[st.whiteHint, { color: darkText ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.7)' }]}>Tap anywhere to turn off</Text>
      </Pressable>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}>
      {!IS_WEB && mode === 'torch' && camPerm && camPerm.granted ? (
        <CameraView style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }} facing="back" enableTorch={torchActive} active />
      ) : null}

      <Text style={s.title}>Flashlight</Text>
      <Text style={s.sub}>Works with no signal. {mode === 'torch' ? 'Using the camera light.' : 'Using a bright white screen.'}</Text>

      <View style={s.seg}>
        {(IS_WEB ? ['screen'] : ['torch', 'screen']).map((m) => (
          <Pressable key={m} onPress={() => switchMode(m)} style={[s.segBtn, mode === m && { backgroundColor: t.card }]}>
            <Text style={[s.segTxt, { color: mode === m ? t.label : t.label2 }]}>{m === 'torch' ? 'Torch (LED)' : 'Screen'}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'screen' ? (
        <View style={s.colorRow}>
          {['#FFFFFF', '#FF453B', '#30D158', '#0A84FF', '#FFD60A'].map((c) => (
            <Pressable key={c} onPress={() => setScreenColor(c)} style={[s.swatch, { backgroundColor: c }, screenColor === c && { borderColor: t.blue, borderWidth: 3 }]} />
          ))}
        </View>
      ) : null}

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        <Pressable onPress={togglePower} style={[s.power, { backgroundColor: on ? t.amber : t.card, borderColor: on ? t.amber : t.sep }]}>
          <PowerIcon c={on ? '#1A1500' : t.label2} />
          <Text style={[s.powerTxt, { color: on ? '#1A1500' : t.label2 }]}>{on ? 'On' : 'Off'}</Text>
        </Pressable>

        <Pressable onPress={toggleSos} style={[s.sosBtn, { backgroundColor: sos ? t.red : t.fill }]}>
          <Text style={[s.sosTxt, { color: sos ? '#fff' : t.red }]}>{sos ? 'Stop SOS' : 'Flash SOS'}</Text>
        </Pressable>
        <Text style={s.sosHint}>{sos ? 'Flashing · · · — — — · · · (Morse SOS)' : 'Repeatedly flashes the Morse code for SOS'}</Text>
      </View>

      <Text style={s.foot}>Everything here runs on your phone — no internet needed.</Text>
    </View>
  );
}

const st = StyleSheet.create({
  white: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 60 },
  whiteHint: { color: '#999', fontSize: 14 },
});

function styles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg, paddingHorizontal: 20 },
    title: { color: t.label, fontSize: 34, fontWeight: '700', letterSpacing: 0.37 },
    sub: { color: t.label2, fontSize: 15, marginTop: 4, marginBottom: 18 },
    seg: { flexDirection: 'row', backgroundColor: t.fill, borderRadius: 10, padding: 3 },
    colorRow: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 14 },
    swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: t.sep },
    segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
    segTxt: { fontSize: 14, fontWeight: '600' },
    power: { width: 150, height: 150, borderRadius: 75, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: 6 },
    powerTxt: { fontSize: 17, fontWeight: '700' },
    sosBtn: { paddingVertical: 15, paddingHorizontal: 40, borderRadius: 14 },
    sosTxt: { fontSize: 17, fontWeight: '700', letterSpacing: 0.5 },
    sosHint: { color: t.label2, fontSize: 13, textAlign: 'center', paddingHorizontal: 20 },
    foot: { color: t.label2, fontSize: 12.5, textAlign: 'center', opacity: 0.8 },
  });
}
