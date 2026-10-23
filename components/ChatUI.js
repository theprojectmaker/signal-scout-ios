import { useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

const EXAMPLES = [
  'Explain this like I am five: why is my signal weak indoors?',
  'Write a short, friendly out-of-office reply.',
  'Give me 5 ideas for dinner with chicken and rice.',
  'Summarize the plot of Romeo and Juliet in 3 lines.',
];

function SendArrow({ color }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 20 20">
      <Path d="M10 16V5M10 5l-5 5M10 5l5 5" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
function StopSquare({ color }) {
  return <Svg width={18} height={18} viewBox="0 0 18 18"><Path d="M4 4h10v10H4z" fill={color} /></Svg>;
}
function PhotoIcon({ color }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M3 16l5-5 4 4 3-3 6 6" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M9 9.5a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z" fill={color} />
    </Svg>
  );
}

export default function ChatUI({
  t, messages, input, setInput, onSend, onStop, generating,
  status, onDownload, onPickExample, banner,
  onPickImage, attachedUri, onClearImage, canSend,
}) {
  const insets = useSafeAreaInsets();
  const s = styles(t);
  const scrollRef = useRef(null);

  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [messages, generating, attachedUri]);

  const ready = status.state === 'ready';
  const empty = messages.length === 0;
  const sendEnabled = (canSend !== undefined ? canSend : ready) && (!!input.trim() || !!attachedUri);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Text style={s.hTitle}>Assistant</Text>
        <View style={s.hStatus}>
          <View style={[s.dot, { backgroundColor: ready ? t.green : status.state === 'unavailable' ? t.label3 : t.label2 }]} />
          <Text style={s.hStatusTxt}>{status.label}</Text>
        </View>
      </View>

      {banner ? (<View style={s.banner}><Text style={s.bannerTxt}>{banner}</Text></View>) : null}

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 20, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {status.state === 'needs-download' && (
          <View style={s.setup}>
            <Text style={s.setupTitle}>Set up offline AI</Text>
            <Text style={s.setupBody}>
              Download the AI model once (about 500 MB, needs internet this one time). After that it runs entirely on your phone — no signal required — and can answer questions about photos too.
            </Text>
            <Pressable onPress={onDownload} style={({ pressed }) => [s.setupBtn, { backgroundColor: t.blue }, pressed && { opacity: 0.6 }]}>
              <Text style={s.setupBtnTxt}>Download model</Text>
            </Pressable>
          </View>
        )}
        {status.state === 'downloading' && (
          <View style={s.setup}>
            <Text style={s.setupTitle}>Downloading model…</Text>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { backgroundColor: t.blue, width: `${Math.round((status.progress || 0) * 100)}%` }]} />
            </View>
            <Text style={s.setupBody}>{Math.round((status.progress || 0) * 100)}% — keep the app open</Text>
          </View>
        )}
        {status.state === 'loading' && (
          <View style={s.setup}>
            <ActivityIndicator color={t.label2} />
            <Text style={[s.setupBody, { marginTop: 12 }]}>Loading the model into memory…</Text>
          </View>
        )}
        {status.state === 'unavailable' && (
          <View style={s.setup}>
            <Text style={s.setupTitle}>Runs in the installed app</Text>
            <Text style={s.setupBody}>
              The on-device AI needs the native build. Open Signal Scout from TestFlight (or a dev build) to chat offline. This preview shows the interface.
            </Text>
          </View>
        )}

        {ready && empty && (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={s.greet}>Ask me anything</Text>
            <Text style={s.greetSub}>I run on your phone — no internet needed. You can send a photo too.</Text>
            <View style={{ marginTop: 18, gap: 8 }}>
              {EXAMPLES.map((ex) => (
                <Pressable key={ex} onPress={() => onPickExample(ex)} style={({ pressed }) => [s.example, pressed && { opacity: 0.6 }]}>
                  <Text style={s.exampleTxt}>{ex}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {messages.map((m, i) => (
          <View key={i} style={[s.msgRow, { justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }]}>
            <View style={[
              s.bubble,
              m.role === 'user'
                ? { backgroundColor: t.bubbleUser, borderBottomRightRadius: 5 }
                : { backgroundColor: t.bubbleAI, borderBottomLeftRadius: 5, borderWidth: t.dark ? 0 : StyleSheet.hairlineWidth, borderColor: t.sep },
            ]}>
              {m.imageUri ? (
                <Image source={{ uri: m.imageUri }} style={s.msgImage} resizeMode="cover" />
              ) : null}
              {m.text ? (
                <Text style={[s.bubbleTxt, { color: m.role === 'user' ? t.onBlue : t.label }]}>{m.text}</Text>
              ) : null}
            </View>
          </View>
        ))}
        {generating && (<Text style={s.thinking}>Thinking…</Text>)}
      </ScrollView>

      {/* attachment preview */}
      {attachedUri ? (
        <View style={s.attachRow}>
          <Image source={{ uri: attachedUri }} style={s.attachThumb} resizeMode="cover" />
          <Text style={s.attachLabel} numberOfLines={1}>Photo attached</Text>
          <Pressable onPress={onClearImage} hitSlop={10} style={s.attachX}>
            <Text style={{ color: t.label2, fontSize: 18, fontWeight: '500' }}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {/* input bar */}
      <View style={[s.inputBar, { paddingBottom: insets.bottom ? 10 : 12 }]}>
        <View style={s.inputWrap}>
          {onPickImage ? (
            <Pressable onPress={onPickImage} disabled={!ready || generating} style={[s.photoBtn, { opacity: ready && !generating ? 1 : 0.4 }]}>
              <PhotoIcon color={t.blue} />
            </Pressable>
          ) : null}
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder={ready ? 'Message' : 'Set up the model to start'}
            placeholderTextColor={t.label3}
            editable={ready && !generating}
            multiline
            onSubmitEditing={onSend}
            blurOnSubmit={false}
          />
          {generating ? (
            <Pressable onPress={onStop} style={[s.sendBtn, { backgroundColor: t.label2 }]}>
              <StopSquare color="#FFFFFF" />
            </Pressable>
          ) : (
            <Pressable onPress={onSend} disabled={!sendEnabled} style={[s.sendBtn, { backgroundColor: sendEnabled ? t.blue : t.fill }]}>
              <SendArrow color={sendEnabled ? '#FFFFFF' : t.label3} />
            </Pressable>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function styles(t) {
  return StyleSheet.create({
    header: { paddingHorizontal: 18, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.sep, backgroundColor: t.card },
    hTitle: { color: t.label, fontSize: 22, fontWeight: '700', letterSpacing: 0.2 },
    hStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    hStatusTxt: { color: t.label2, fontSize: 12.5 },

    banner: { backgroundColor: t.fill, paddingVertical: 8, paddingHorizontal: 16 },
    bannerTxt: { color: t.label2, fontSize: 12.5, textAlign: 'center' },

    setup: { backgroundColor: t.card, borderRadius: 16, padding: 20, marginTop: 8, alignItems: 'center' },
    setupTitle: { color: t.label, fontSize: 17, fontWeight: '600', marginBottom: 8 },
    setupBody: { color: t.label2, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    setupBtn: { marginTop: 16, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28 },
    setupBtnTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: t.fill, width: '100%', marginTop: 16, overflow: 'hidden' },
    progressFill: { height: 8, borderRadius: 4 },

    greet: { color: t.label, fontSize: 26, fontWeight: '700', textAlign: 'center', letterSpacing: -0.4 },
    greetSub: { color: t.label2, fontSize: 15, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
    example: { backgroundColor: t.card, borderRadius: 13, paddingVertical: 12, paddingHorizontal: 14, borderWidth: t.dark ? 0 : StyleSheet.hairlineWidth, borderColor: t.sep },
    exampleTxt: { color: t.label, fontSize: 14 },

    msgRow: { flexDirection: 'row', marginVertical: 5 },
    bubble: { maxWidth: '84%', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
    bubbleTxt: { fontSize: 16, lineHeight: 22 },
    msgImage: { width: 180, height: 180, borderRadius: 12, marginBottom: 6 },
    thinking: { color: t.label3, fontSize: 13, marginTop: 6, marginLeft: 4 },

    attachRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: t.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
    attachThumb: { width: 36, height: 36, borderRadius: 8 },
    attachLabel: { flex: 1, color: t.label2, fontSize: 13.5 },
    attachX: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

    inputBar: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep, backgroundColor: t.card },
    inputWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    photoBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    input: { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: t.fill, borderRadius: 20, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, color: t.label, fontSize: 16 },
    sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  });
}
