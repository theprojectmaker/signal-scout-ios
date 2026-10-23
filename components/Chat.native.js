import React, { useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ChatUI from './ChatUI';
import { useTheme } from './theme';

const ENABLED_KEY = 'ai.enabled.v1';

/* If the native AI module is missing (e.g. Expo Go), show the unavailable
   state instead of crashing. */
class Boundary extends React.Component {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch() {}
  render() { return this.state.err ? this.props.fallback : this.props.children; }
}

function ModelChat({ t }) {
  const { models, useLLMChatSession } = require('react-native-executorch');
  // Small on-device vision-language model: loads reliably AND understands photos.
  const llm = useLLMChatSession(models.llm.LFM2_5_VL_450M.DEFAULT);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [attachedUri, setAttachedUri] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const attachRef = useRef(null); // ImageBuffer for the next send

  const status = (() => {
    if (llm.error) return { state: 'unavailable', label: 'Could not load model' };
    if (!llm.isReady && (llm.downloadProgress || 0) < 1) {
      return { state: 'downloading', progress: llm.downloadProgress || 0, label: `Downloading ${Math.round((llm.downloadProgress || 0) * 100)}%` };
    }
    if (!llm.isReady) return { state: 'loading', label: 'Loading model…' };
    return { state: 'ready', label: preparing ? 'Reading photo…' : 'On-device · ready' };
  })();

  const clearAttach = () => { attachRef.current = null; setAttachedUri(null); };

  const pickImage = useCallback(async () => {
    try {
      const IP = require('expo-image-picker');
      const res = await IP.launchImageLibraryAsync({
        mediaTypes: (IP.MediaTypeOptions && IP.MediaTypeOptions.Images) || 'images',
        quality: 1,
      });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const uri = res.assets[0].uri;
      setAttachedUri(uri);
      setPreparing(true);
      const { uriToImageBuffer } = require('./imageBuffer');
      attachRef.current = await uriToImageBuffer(uri);
    } catch (e) {
      clearAttach();
    } finally {
      setPreparing(false);
    }
  }, []);

  const onSend = useCallback(async () => {
    const text = input.trim();
    const img = attachRef.current;
    if ((!text && !img) || generating || preparing || !llm.isReady || !llm.sendMessage) return;
    const shown = text || (img ? "What's in this photo?" : '');
    const uri = attachedUri;
    setInput('');
    clearAttach();
    setMessages((m) => [...m, { role: 'user', text: shown, imageUri: uri }, { role: 'assistant', text: '', streaming: true }]);
    setGenerating(true);
    let acc = '';
    try {
      const content = img ? [{ kind: 'image', image: img }, shown] : shown;
      await llm.sendMessage(content, (tok) => {
        acc += tok;
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = { role: 'assistant', text: acc, streaming: true };
          return c;
        });
      });
    } catch (e) {
      acc = acc || 'Sorry — something went wrong generating a reply.';
    }
    setMessages((m) => {
      const c = [...m];
      c[c.length - 1] = { role: 'assistant', text: acc, streaming: false };
      return c;
    });
    setGenerating(false);
  }, [input, generating, preparing, attachedUri, llm]);

  const onStop = useCallback(() => {
    try { llm.stop && llm.stop(); } catch (e) {}
    setGenerating(false);
  }, [llm]);

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
      <ModelChat t={t} />
    </Boundary>
  );
}
