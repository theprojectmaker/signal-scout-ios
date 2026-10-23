import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ChatUI from './ChatUI';
import { useTheme } from './theme';
import { loadChats, saveChats, newChat, titleFrom } from './chatStore';

const ENABLED_KEY = 'ai.enabled.v1';

class Boundary extends React.Component {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch() {}
  render() { return this.state.err ? this.props.fallback : this.props.children; }
}

/* Loads + runs the model for ONE chat. Keyed by chat id in the parent, so a
   fresh session (seeded with that chat's history) is created per chat. */
function ModelChat({ t, chat, chats, activeChatId, persistMessages, onNewChat, onOpenChat, onDeleteChat }) {
  const { models, useLLMChatSession } = require('react-native-executorch');
  const initialMessages = useMemo(
    () => (chat.messages || []).filter((m) => m.text).map((m) => ({ role: m.role, content: m.text })),
    [] // chat is fixed for this mount (component is keyed by chat id)
  );
  const llm = useLLMChatSession(models.llm.LFM2_5_VL_450M.DEFAULT, { initialMessages });

  const [messages, setMessages] = useState(chat.messages || []);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [attachedUri, setAttachedUri] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const attachRef = useRef(null);

  const status = (() => {
    if (llm.error) return { state: 'unavailable', label: 'Could not load model' };
    if (!llm.isReady && (llm.downloadProgress || 0) < 1) return { state: 'downloading', progress: llm.downloadProgress || 0, label: `Downloading ${Math.round((llm.downloadProgress || 0) * 100)}%` };
    if (!llm.isReady) return { state: 'loading', label: 'Loading model…' };
    return { state: 'ready', label: preparing ? 'Reading photo…' : 'On-device · ready' };
  })();

  const commit = (next) => { setMessages(next); persistMessages(next); };
  const clearAttach = () => { attachRef.current = null; setAttachedUri(null); };

  const capture = useCallback(async (mode) => {
    try {
      const IP = require('expo-image-picker');
      if (mode === 'camera') {
        const p = await IP.requestCameraPermissionsAsync();
        if (!p.granted) return;
      }
      const res = mode === 'camera'
        ? await IP.launchCameraAsync({ quality: 1 })
        : await IP.launchImageLibraryAsync({ mediaTypes: (IP.MediaTypeOptions && IP.MediaTypeOptions.Images) || 'images', quality: 1 });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const uri = res.assets[0].uri;
      setAttachedUri(uri);
      setPreparing(true);
      const { uriToImageBuffer } = require('./imageBuffer');
      attachRef.current = await uriToImageBuffer(uri);
    } catch (e) {
      clearAttach();
    } finally { setPreparing(false); }
  }, []);

  const pickImage = useCallback(() => {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take Photo', onPress: () => capture('camera') },
      { text: 'Choose Photo', onPress: () => capture('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [capture]);

  const onSend = useCallback(async () => {
    const text = input.trim();
    const img = attachRef.current;
    if ((!text && !img) || generating || preparing || !llm.isReady || !llm.sendMessage) return;
    const shown = text || (img ? "What's in this photo?" : '');
    const uri = attachedUri;
    setInput('');
    clearAttach();
    const base = [...messages, { role: 'user', text: shown, imageUri: uri }];
    commit([...base, { role: 'assistant', text: '', streaming: true }]);
    setGenerating(true);
    let acc = '';
    try {
      const content = img ? [{ kind: 'image', image: img }, shown] : shown;
      await llm.sendMessage(content, (tok) => {
        acc += tok;
        setMessages([...base, { role: 'assistant', text: acc, streaming: true }]);
      });
    } catch (e) {
      acc = acc || 'Sorry — something went wrong generating a reply.';
    }
    commit([...base, { role: 'assistant', text: acc, streaming: false }]);
    setGenerating(false);
  }, [input, generating, preparing, attachedUri, messages, llm]);

  const onStop = useCallback(() => { try { llm.stop && llm.stop(); } catch (e) {} setGenerating(false); }, [llm]);

  return (
    <ChatUI
      t={t}
      messages={messages}
      input={input}
      setInput={setInput}
      onSend={onSend}
      onStop={onStop}
      generating={generating}
      status={status}
      onDownload={() => {}}
      onPickExample={(ex) => setInput(ex)}
      onPickImage={pickImage}
      attachedUri={attachedUri}
      onClearImage={clearAttach}
      canSend={llm.isReady && !preparing}
      title={chat.title}
      chats={chats}
      activeChatId={activeChatId}
      onNewChat={onNewChat}
      onOpenChat={onOpenChat}
      onDeleteChat={onDeleteChat}
    />
  );
}

function ChatsManager({ t }) {
  const [chats, setChats] = useState(null);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    (async () => {
      let list = await loadChats();
      if (list.length === 0) { const c = newChat(); list = [c]; await saveChats(list); }
      setChats(list);
      setActiveId(list[0].id);
    })();
  }, []);

  const persist = useCallback((next) => { setChats(next); saveChats(next); }, []);

  if (!chats || !activeId) return null;
  const active = chats.find((c) => c.id === activeId) || chats[0];

  const persistMessages = (msgs) => {
    const next = chats.map((c) => c.id === active.id
      ? { ...c, messages: msgs, title: (!c.title || c.title === 'New chat') ? titleFrom(msgs) : c.title, updatedAt: Date.now() }
      : c);
    next.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    persist(next);
  };
  const onNewChat = () => { const c = newChat(); persist([c, ...chats]); setActiveId(c.id); };
  const onOpenChat = (id) => setActiveId(id);
  const onDeleteChat = (id) => {
    let next = chats.filter((c) => c.id !== id);
    if (next.length === 0) next = [newChat()];
    persist(next);
    if (id === activeId) setActiveId(next[0].id);
  };

  return (
    <ModelChat
      key={active.id}
      t={t}
      chat={active}
      chats={chats}
      activeChatId={activeId}
      persistMessages={persistMessages}
      onNewChat={onNewChat}
      onOpenChat={onOpenChat}
      onDeleteChat={onDeleteChat}
    />
  );
}

export default function ChatNative() {
  const t = useTheme();
  const [enabled, setEnabled] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ENABLED_KEY).then((v) => { if (v === '1') setEnabled(true); setChecked(true); });
  }, []);

  const enable = () => { setEnabled(true); AsyncStorage.setItem(ENABLED_KEY, '1').catch(() => {}); };

  if (!checked) return null;

  if (!enabled) {
    return (
      <ChatUI
        t={t} messages={[]} input="" setInput={() => {}} onSend={() => {}} onStop={() => {}}
        generating={false} status={{ state: 'needs-download', label: 'Model not downloaded' }}
        onDownload={enable} onPickExample={() => {}}
      />
    );
  }

  const fallback = (
    <ChatUI
      t={t} messages={[]} input="" setInput={() => {}} onSend={() => {}} onStop={() => {}}
      generating={false} status={{ state: 'unavailable', label: 'Needs the installed app' }}
      onDownload={() => {}} onPickExample={() => {}}
    />
  );

  return (
    <Boundary fallback={fallback}>
      <ChatsManager t={t} />
    </Boundary>
  );
}
