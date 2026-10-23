import { useRef, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import Markdown from 'react-native-markdown-display';

const EXAMPLES = [
  'Explain this like I am five: why is my signal weak indoors?',
  'Write a short, friendly out-of-office reply.',
  'Give me 5 ideas for dinner with chicken and rice.',
  'Summarize the plot of Romeo and Juliet in 3 lines.',
];

const SendArrow = ({ c }) => <Svg width={20} height={20} viewBox="0 0 20 20"><Path d="M10 16V5M10 5l-5 5M10 5l5 5" fill="none" stroke={c} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
const StopSquare = ({ c }) => <Svg width={18} height={18} viewBox="0 0 18 18"><Path d="M4 4h10v10H4z" fill={c} /></Svg>;
const PhotoIcon = ({ c }) => <Svg width={22} height={22} viewBox="0 0 24 24"><Path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="none" stroke={c} strokeWidth={1.8} strokeLinejoin="round" /><Path d="M3 16l5-5 4 4 3-3 6 6" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /><Path d="M9 9.5a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z" fill={c} /></Svg>;
const MenuIcon = ({ c }) => <Svg width={24} height={24} viewBox="0 0 24 24"><Path d="M4 7h16M4 12h16M4 17h16" stroke={c} strokeWidth={2} strokeLinecap="round" /></Svg>;
const PlusIcon = ({ c }) => <Svg width={24} height={24} viewBox="0 0 24 24"><Path d="M12 5v14M5 12h14" stroke={c} strokeWidth={2} strokeLinecap="round" /></Svg>;
const TrashIcon = ({ c }) => <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke={c} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></Svg>;

function timeAgo(ts) {
  const s = Math.round((Date.now() - (ts || 0)) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

export default function ChatUI({
  t, messages, input, setInput, onSend, onStop, generating,
  status, onDownload, onPickExample, banner,
  onPickImage, attachedUri, onClearImage, canSend,
  title, chats, activeChatId, onNewChat, onOpenChat, onDeleteChat,
}) {
  const insets = useSafeAreaInsets();
  const s = styles(t);
  const scrollRef = useRef(null);
  const [drawer, setDrawer] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [messages, generating, attachedUri]);

  const ready = status.state === 'ready';
  const empty = messages.length === 0;
  const sendEnabled = (canSend !== undefined ? canSend : ready) && (!!input.trim() || !!attachedUri);
  const hasChats = Array.isArray(chats);

  const copy = (text) => {
    try { const C = require('expo-clipboard'); C.setStringAsync(text); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch (e) {}
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* header */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <View style={s.headRow}>
          {hasChats ? (
            <Pressable onPress={() => setDrawer(true)} hitSlop={10} style={s.headBtn}><MenuIcon c={t.label} /></Pressable>
          ) : <View style={s.headBtn} />}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.hTitle} numberOfLines={1}>{title || 'Assistant'}</Text>
            <View style={s.hStatus}>
              <View style={[s.dot, { backgroundColor: ready ? t.green : status.state === 'unavailable' ? t.label3 : t.label2 }]} />
              <Text style={s.hStatusTxt}>{status.label}</Text>
            </View>
          </View>
          {hasChats ? (
            <Pressable onPress={onNewChat} hitSlop={10} style={s.headBtn}><PlusIcon c={t.blue} /></Pressable>
          ) : <View style={s.headBtn} />}
        </View>
      </View>

      {banner ? (<View style={s.banner}><Text style={s.bannerTxt}>{banner}</Text></View>) : null}

      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 20, flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {status.state === 'needs-download' && (
          <View style={s.setup}>
            <Text style={s.setupTitle}>Set up offline AI</Text>
            <Text style={s.setupBody}>Download the AI model once (about 1 GB, needs internet this one time — use Wi-Fi). After that it runs entirely on your phone — no signal required — and can answer questions about photos too.</Text>
            <Pressable onPress={onDownload} style={({ pressed }) => [s.setupBtn, { backgroundColor: t.blue }, pressed && { opacity: 0.6 }]}><Text style={s.setupBtnTxt}>Download model</Text></Pressable>
          </View>
        )}
        {status.state === 'downloading' && (
          <View style={s.setup}>
            <Text style={s.setupTitle}>Downloading model…</Text>
            <View style={s.progressTrack}><View style={[s.progressFill, { backgroundColor: t.blue, width: `${Math.round((status.progress || 0) * 100)}%` }]} /></View>
            <Text style={s.setupBody}>{Math.round((status.progress || 0) * 100)}% — keep the app open</Text>
          </View>
        )}
        {status.state === 'loading' && (<View style={s.setup}><ActivityIndicator color={t.label2} /><Text style={[s.setupBody, { marginTop: 12 }]}>Loading the model into memory…</Text></View>)}
        {status.state === 'unavailable' && (<View style={s.setup}><Text style={s.setupTitle}>Runs in the installed app</Text><Text style={s.setupBody}>The on-device AI needs the native build. Open Signal Scout from TestFlight to chat offline. This preview shows the interface.</Text></View>)}

        {ready && empty && (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={s.greet}>Ask me anything</Text>
            <Text style={s.greetSub}>I run on your phone — no internet needed. You can send a photo too.</Text>
            <View style={{ marginTop: 18, gap: 8 }}>
              {EXAMPLES.map((ex) => (<Pressable key={ex} onPress={() => onPickExample(ex)} style={({ pressed }) => [s.example, pressed && { opacity: 0.6 }]}><Text style={s.exampleTxt}>{ex}</Text></Pressable>))}
            </View>
          </View>
        )}

        {messages.map((m, i) => (
          <Pressable key={i} onLongPress={() => m.text && copy(m.text)} style={[s.msgRow, { justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }]}>
            <View style={[s.bubble, m.role === 'user' ? { backgroundColor: t.bubbleUser, borderBottomRightRadius: 5 } : { backgroundColor: t.bubbleAI, borderBottomLeftRadius: 5, borderWidth: t.dark ? 0 : StyleSheet.hairlineWidth, borderColor: t.sep }]}>
              {m.imageUri ? <Image source={{ uri: m.imageUri }} style={s.msgImage} resizeMode="cover" /> : null}
              {m.text ? (
                m.role === 'user'
                  ? <Text style={[s.bubbleTxt, { color: t.onBlue }]}>{m.text}</Text>
                  : <Markdown style={mdStyles(t)}>{m.text}</Markdown>
              ) : null}
            </View>
          </Pressable>
        ))}
        {generating && (<Text style={s.thinking}>Thinking…</Text>)}
      </ScrollView>

      {attachedUri ? (
        <View style={s.attachRow}>
          <Image source={{ uri: attachedUri }} style={s.attachThumb} resizeMode="cover" />
          <Text style={s.attachLabel} numberOfLines={1}>Photo attached</Text>
          <Pressable onPress={onClearImage} hitSlop={10} style={s.attachX}><Text style={{ color: t.label2, fontSize: 18 }}>✕</Text></Pressable>
        </View>
      ) : null}

      <View style={[s.inputBar, { paddingBottom: insets.bottom ? 10 : 12 }]}>
        <View style={s.inputWrap}>
          {onPickImage ? (<Pressable onPress={onPickImage} disabled={!ready || generating} style={[s.photoBtn, { opacity: ready && !generating ? 1 : 0.4 }]}><PhotoIcon c={t.blue} /></Pressable>) : null}
          <TextInput style={s.input} value={input} onChangeText={setInput} placeholder={ready ? 'Message' : 'Set up the model to start'} placeholderTextColor={t.label3} editable={ready && !generating} multiline onSubmitEditing={onSend} blurOnSubmit={false} />
          {generating ? (
            <Pressable onPress={onStop} style={[s.sendBtn, { backgroundColor: t.label2 }]}><StopSquare c="#FFFFFF" /></Pressable>
          ) : (
            <Pressable onPress={onSend} disabled={!sendEnabled} style={[s.sendBtn, { backgroundColor: sendEnabled ? t.blue : t.fill }]}><SendArrow c={sendEnabled ? '#FFFFFF' : t.label3} /></Pressable>
          )}
        </View>
      </View>

      {/* chats drawer */}
      <Modal visible={drawer} transparent animationType="fade" onRequestClose={() => setDrawer(false)}>
        <Pressable style={s.drawerBackdrop} onPress={() => setDrawer(false)}>
          <Pressable style={[s.drawer, { paddingTop: insets.top + 12 }]} onPress={() => {}}>
            <View style={s.drawerHead}>
              <Text style={s.drawerTitle}>Chats</Text>
              <Pressable onPress={() => { onNewChat(); setDrawer(false); }} hitSlop={10} style={s.newChatBtn}>
                <PlusIcon c={t.blue} /><Text style={{ color: t.blue, fontSize: 15, fontWeight: '600', marginLeft: 4 }}>New</Text>
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {(chats || []).length === 0 ? (
                <Text style={[s.setupBody, { marginTop: 20 }]}>No saved chats yet.</Text>
              ) : (chats || []).map((c) => (
                <Pressable key={c.id} onPress={() => { onOpenChat(c.id); setDrawer(false); }} style={[s.chatRow, c.id === activeChatId && { backgroundColor: t.fill }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.chatRowTitle} numberOfLines={1}>{c.title || 'New chat'}</Text>
                    <Text style={s.chatRowTime}>{timeAgo(c.updatedAt)}</Text>
                  </View>
                  <Pressable onPress={() => onDeleteChat(c.id)} hitSlop={10} style={{ padding: 6 }}><TrashIcon c={t.label2} /></Pressable>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {copied ? (<View style={[s.copied, { bottom: insets.bottom + 80 }]} pointerEvents="none"><Text style={s.copiedTxt}>Copied</Text></View>) : null}
    </KeyboardAvoidingView>
  );
}

function mdStyles(t) {
  return {
    body: { color: t.label, fontSize: 16, lineHeight: 22 },
    strong: { fontWeight: '700' },
    bullet_list: { marginVertical: 2 },
    ordered_list: { marginVertical: 2 },
    code_inline: { backgroundColor: t.fill, color: t.label, borderRadius: 4, paddingHorizontal: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    fence: { backgroundColor: t.fill, color: t.label, borderRadius: 8, padding: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    code_block: { backgroundColor: t.fill, color: t.label, borderRadius: 8, padding: 10 },
    link: { color: t.blue },
    heading1: { color: t.label, fontSize: 20, fontWeight: '700' },
    heading2: { color: t.label, fontSize: 18, fontWeight: '700' },
  };
}

function styles(t) {
  return StyleSheet.create({
    header: { paddingHorizontal: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.sep, backgroundColor: t.card },
    headRow: { flexDirection: 'row', alignItems: 'center' },
    headBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    hTitle: { color: t.label, fontSize: 16, fontWeight: '600', letterSpacing: 0.1, maxWidth: '90%' },
    hStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    hStatusTxt: { color: t.label2, fontSize: 12 },

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
    bubble: { maxWidth: '86%', borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14 },
    bubbleTxt: { fontSize: 16, lineHeight: 22 },
    msgImage: { width: 180, height: 180, borderRadius: 12, marginVertical: 6 },
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

    drawerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', flexDirection: 'row' },
    drawer: { width: '80%', maxWidth: 320, backgroundColor: t.card, paddingHorizontal: 14, paddingBottom: 20 },
    drawerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.sep },
    drawerTitle: { color: t.label, fontSize: 20, fontWeight: '700' },
    newChatBtn: { flexDirection: 'row', alignItems: 'center' },
    chatRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12, marginTop: 4 },
    chatRowTitle: { color: t.label, fontSize: 15, fontWeight: '500' },
    chatRowTime: { color: t.label2, fontSize: 12, marginTop: 2 },

    copied: { position: 'absolute', alignSelf: 'center', backgroundColor: t.dark ? '#2C2C2E' : '#1C1C1E', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12 },
    copiedTxt: { color: '#fff', fontSize: 13.5, fontWeight: '500' },
  });
}
