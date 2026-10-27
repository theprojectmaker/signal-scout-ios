import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import ChatUI from './ChatUI';
import { useTheme } from './theme';
import { loadChats, saveChats, newChat, titleFrom } from './chatStore';

const ENABLED_KEY = 'ai.enabled.v1';

const SYSTEM_PROMPT =
  "You are a helpful, friendly AI assistant running privately on the user's phone, with no internet. " +
  "Give clear, direct, and accurate answers. Think it through, then answer. Keep it concise unless the user asks for detail. " +
  "If you are unsure or don't know, say so honestly rather than making something up.";

// Qwen3 reasons inside <think>…</think>; show only the final answer.
function cleanThink(s) {
  if (!s) return s;
  let out = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  const open = out.indexOf('<think>');
  if (open !== -1) out = out.slice(0, open); // still thinking — hide the rest
  return out.replace(/^\s+/, '');
}

class Boundary extends React.Component {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch() {}
  render() { return this.state.err ? this.props.fallback : this.props.children; }
}

/* The model is loaded ONCE here and never reloaded (reloading a model on a
   phone can run it out of memory -> "can't load"). Switching chats only swaps
   the on-screen transcript; the model stays resident. */
function ModelChat({ t, active, activeChatId, chats, persistMessages, onNewChat, onOpenChat, onDeleteChat }) {
  const { models, useLLMChatSession } = require('react-native-executorch');
  const llm = useLLMChatSession(models.llm.QWEN3_1_7B.DEFAULT, {
    initialMessages: [{ role: 'system', content: SYSTEM_PROMPT }],
    generationConfig: { maxNewTokens: 512, temperature: 0.7 },
  });

  const [messages, setMessages] = useState(active.messages || []);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [attachedUri, setAttachedUri] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const attachRef = useRef(null);

  // show the active chat's transcript (model is NOT reloaded on switch)
  useEffect(() => { setMessages(active.messages || []); setInput(''); clearAttach(); }, [activeChatId]);

  const status = (() => {
    if (llm.error) return { state: 'unavailable', label: 'Could not load model' };
    if (!llm.isReady && (llm.downloadProgress || 0) < 1) return { state: 'downloading', progress: llm.downloadProgress || 0, label: `Downloading ${Math.round((llm.downloadProgress || 0) * 100)}%` };
    if (!llm.isReady) return { state: 'loading', label: 'Loading model…' };
    return { state: 'ready', label: preparing ? 'Reading photo…' : 'On-device · ready' };
  })();

  const commit = (next) => { setMessages(next); persistMessages(next); };
  function clearAttach() { attachRef.current = null; setAttachedUri(null); }

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
    } catch (e) { clearAttach(); } finally { setPreparing(false); }
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
        setMessages([...base, { role: 'assistant', text: cleanThink(acc), streaming: true }]);
      });
    } catch (e) {
      const info = img ? ` [img ${img.width}x${img.height} ${img.format} ${img.data && img.data.length}b]` : '';
      acc = acc || ('⚠️ ' + ((e && e.message) ? e.message : String(e)) + info);
    }
    commit([...base, { role: 'assistant', text: cleanThink(acc) || acc, streaming: false }]);
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
      onPickImage={undefined}
      attachedUri={attachedUri}
      onClearImage={clearAttach}
      canSend={llm.isReady && !preparing}
      title={active.title}
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
  const chatsRef = useRef([]);
  const activeIdRef = useRef(null);
  chatsRef.current = chats || [];
  activeIdRef.current = activeId;
  const onPhotos = (usePathname() || '').startsWith('/photos');

  useEffect(() => {
    (async () => {
      let list = await loadChats();
      if (list.length === 0) { const c = newChat(); list = [c]; await saveChats(list); }
      setChats(list);
      setActiveId(list[0].id);
    })();
  }, []);

  // stable so a send always writes to the chat that is active right now
  const persistMessages = useCallback((msgs) => {
    const next = chatsRef.current.map((c) => c.id === activeIdRef.current
      ? { ...c, messages: msgs, title: (!c.title || c.title === 'New chat') ? titleFrom(msgs) : c.title, updatedAt: Date.now() }
      : c);
    next.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    setChats(next); saveChats(next);
  }, []);

  const onNewChat = useCallback(() => {
    const c = newChat();
    setChats((cs) => [c, ...(cs || [])]);
    setActiveId(c.id);
  }, []);
  const onOpenChat = useCallback((id) => setActiveId(id), []);
  const onDeleteChat = useCallback((id) => {
    setChats((cs) => {
      let next = (cs || []).filter((c) => c.id !== id);
      if (next.length === 0) next = [newChat()];
      saveChats(next);
      if (id === activeIdRef.current) setActiveId(next[0].id);
      return next;
    });
  }, []);

  if (!chats || !activeId) return null;
  const active = chats.find((c) => c.id === activeId) || chats[0];

  // On the Photos tab, unload the chat model so the vision model can load
  // (the phone holds only one model at a time).
  if (onPhotos) {
    return (
      <ChatUI
        t={t} messages={[]} input="" setInput={() => {}} onSend={() => {}} onStop={() => {}}
        generating={false} status={{ state: 'loading', label: 'Paused — using Photos' }}
        onDownload={() => {}} onPickExample={() => {}}
        title={active.title} chats={chats} activeChatId={activeId}
        onNewChat={onNewChat} onOpenChat={onOpenChat} onDeleteChat={onDeleteChat}
      />
    );
  }

  return (
    <ModelChat
      t={t}
      active={active}
      activeChatId={activeId}
      chats={chats}
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
