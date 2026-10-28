import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Platform, KeyboardAvoidingView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import { useTheme } from '../../components/theme';

const SAVED_KEY = 'browser.saved.v1';
const HOME = 'https://www.google.com';

// Turn whatever the user typed into a URL: a real address stays, anything else becomes a search.
function toUrl(text) {
  const s = (text || '').trim();
  if (!s) return HOME;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) && !s.includes(' ')) return 'https://' + s;
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}

// Grabs the current page's HTML + title so it can be re-opened with no signal.
const GRAB_HTML = `(function(){try{window.ReactNativeWebView.postMessage(JSON.stringify({t:'save',title:document.title||location.href,html:'<!doctype html>'+document.documentElement.outerHTML}));}catch(e){}})();true;`;

async function loadSaved() { try { const r = await AsyncStorage.getItem(SAVED_KEY); return r ? JSON.parse(r) : []; } catch (e) { return []; } }
async function persistSaved(l) { try { await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(l)); } catch (e) {} }

export default function BrowserScreen() {
  const t = useTheme();
  const s = styles(t);
  const webRef = useRef(null);

  const [addr, setAddr] = useState('');          // text in the bar
  const [source, setSource] = useState({ uri: HOME });
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [saved, setSaved] = useState([]);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => { loadSaved().then(setSaved); }, []);

  const go = useCallback(() => {
    const uri = toUrl(addr);
    setShowSaved(false); setOffline(false);
    setSource({ uri });
  }, [addr]);

  const onNav = useCallback((n) => {
    setCanBack(!!n.canGoBack); setCanFwd(!!n.canGoForward);
    if (n.url && !n.url.startsWith('about:') && !n.loading) setAddr(n.url);
  }, []);

  const onMessage = useCallback((e) => {
    let msg; try { msg = JSON.parse(e.nativeEvent.data); } catch (err) { return; }
    if (msg.t === 'save' && msg.html) {
      const page = { id: String(Date.now()), title: (msg.title || 'Saved page').slice(0, 120), url: addr, html: msg.html, at: Date.now() };
      setSaved((prev) => { const next = [page, ...prev].slice(0, 100); persistSaved(next); return next; });
      Alert.alert('Saved for offline', page.title);
    }
  }, [addr]);

  const savePage = useCallback(() => {
    if (!webRef.current) return;
    webRef.current.injectJavaScript(GRAB_HTML);
  }, []);

  const openSaved = useCallback((p) => {
    setShowSaved(false); setOffline(false); setAddr(p.url || p.title);
    setSource({ html: p.html, baseUrl: p.url || HOME });
  }, []);

  const removeSaved = useCallback((id) => {
    setSaved((prev) => { const next = prev.filter((x) => x.id !== id); persistSaved(next); return next; });
  }, []);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex}>
        <View style={s.bar}>
          <Pressable onPress={() => webRef.current && webRef.current.goBack()} disabled={!canBack} hitSlop={6}><Text style={[s.nav, !canBack && s.navOff]}>‹</Text></Pressable>
          <Pressable onPress={() => webRef.current && webRef.current.goForward()} disabled={!canFwd} hitSlop={6}><Text style={[s.nav, !canFwd && s.navOff]}>›</Text></Pressable>
          <TextInput
            style={s.addr} value={addr} onChangeText={setAddr} onSubmitEditing={go}
            placeholder="Search or enter address" placeholderTextColor={t.label3}
            autoCapitalize="none" autoCorrect={false} keyboardType="web-search" returnKeyType="go" selectTextOnFocus
          />
          <Pressable onPress={() => (loading ? webRef.current && webRef.current.stopLoading() : webRef.current && webRef.current.reload())} hitSlop={6}>
            <Text style={s.nav}>{loading ? '✕' : '⟳'}</Text>
          </Pressable>
        </View>
        <View style={s.chips}>
          <Pressable style={s.chip} onPress={savePage}><Text style={s.chipTxt}>Save offline</Text></Pressable>
          <Pressable style={[s.chip, showSaved && s.chipOn]} onPress={() => setShowSaved((v) => !v)}><Text style={[s.chipTxt, showSaved && s.chipTxtOn]}>Saved ({saved.length})</Text></Pressable>
          <Pressable style={s.chip} onPress={() => { setAddr(''); setSource({ uri: HOME }); setShowSaved(false); setOffline(false); }}><Text style={s.chipTxt}>Home</Text></Pressable>
        </View>

        {showSaved ? (
          <ScrollView style={s.flex} contentContainerStyle={s.savedWrap}>
            {saved.length === 0 ? <Text style={s.empty}>No saved pages yet. Open a page with signal and tap “Save offline” to read it later with none.</Text>
              : saved.map((p) => (
                <Pressable key={p.id} style={s.savedRow} onPress={() => openSaved(p)} onLongPress={() => removeSaved(p.id)}>
                  <View style={s.flex}><Text style={s.savedTitle} numberOfLines={1}>{p.title}</Text><Text style={s.savedUrl} numberOfLines={1}>{p.url}</Text></View>
                  <Text style={s.savedGo}>›</Text>
                </Pressable>
              ))}
            {saved.length > 0 ? <Text style={s.hint}>Tap to open offline · long-press to remove</Text> : null}
          </ScrollView>
        ) : (
          <View style={s.flex}>
            <WebView
              ref={webRef}
              source={source}
              onNavigationStateChange={onNav}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onMessage={onMessage}
              onError={() => { setLoading(false); setOffline(true); }}
              onHttpError={() => setLoading(false)}
              allowsBackForwardNavigationGestures
              domStorageEnabled
              startInLoadingState
              style={s.flex}
            />
            {offline ? (
              <View style={s.offline}>
                <Text style={s.offlineTxt}>Can’t load this page — you may be offline.</Text>
                <Pressable style={s.chip} onPress={() => setShowSaved(true)}><Text style={s.chipTxt}>Open saved pages</Text></Pressable>
              </View>
            ) : null}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = (t) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  nav: { color: t.blue, fontSize: 28, fontWeight: '300', width: 22, textAlign: 'center' },
  navOff: { color: t.label3 },
  addr: { flex: 1, backgroundColor: t.fill, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: t.label, fontSize: 15 },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  chip: { borderWidth: 1, borderColor: t.sep, backgroundColor: t.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  chipOn: { backgroundColor: t.blue, borderColor: t.blue },
  chipTxt: { color: t.label, fontSize: 13, fontWeight: '600' },
  chipTxtOn: { color: t.onBlue },
  savedWrap: { padding: 14, gap: 10 },
  empty: { color: t.label2, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingTop: 20 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.card, borderRadius: 12, padding: 13 },
  savedTitle: { color: t.label, fontSize: 15, fontWeight: '600' },
  savedUrl: { color: t.label2, fontSize: 12, marginTop: 2 },
  savedGo: { color: t.label3, fontSize: 22, fontWeight: '300' },
  hint: { textAlign: 'center', color: t.label3, fontSize: 11, marginTop: 4 },
  offline: { position: 'absolute', left: 20, right: 20, bottom: 24, backgroundColor: t.card, borderRadius: 12, padding: 14, gap: 10, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.sep },
  offlineTxt: { color: t.label, fontSize: 14, textAlign: 'center' },
});
