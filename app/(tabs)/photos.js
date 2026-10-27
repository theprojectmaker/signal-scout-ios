import React, { useState, useRef, useCallback } from 'react';
import { Alert } from 'react-native';
import { usePathname } from 'expo-router';
import ChatUI from '../../components/ChatUI';
import { useTheme } from '../../components/theme';

const SYSTEM = 'You look at the photo the user sends and answer their question about it clearly and concisely. If no question is given, briefly describe what is in the photo.';

class Boundary extends React.Component {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch() {}
  render() { return this.state.err ? this.props.fallback : this.props.children; }
}

function VLModel({ t }) {
  const { models, useLLMChatSession } = require('react-native-executorch');
  const llm = useLLMChatSession(models.llm.LFM2_5_VL_450M.DEFAULT, {
    initialMessages: [{ role: 'system', content: SYSTEM }],
    generationConfig: { maxNewTokens: 384, temperature: 0.7 },
  });

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [attachedUri, setAttachedUri] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const attachRef = useRef(null);

  const clearAttach = () => { attachRef.current = null; setAttachedUri(null); };

  const status = (() => {
    if (llm.error) return { state: 'unavailable', label: 'Could not load vision model' };
    if (!llm.isReady && (llm.downloadProgress || 0) < 1) return { state: 'downloading', progress: llm.downloadProgress || 0, label: `Downloading ${Math.round((llm.downloadProgress || 0) * 100)}%` };
    if (!llm.isReady) return { state: 'loading', label: 'Loading vision model…' };
    return { state: 'ready', label: preparing ? 'Reading photo…' : 'On-device · ready' };
  })();

  const capture = useCallback(async (mode) => {
    try {
      const IP = require('expo-image-picker');
      if (mode === 'camera') { const p = await IP.requestCameraPermissionsAsync(); if (!p.granted) return; }
      const res = mode === 'camera'
        ? await IP.launchCameraAsync({ quality: 1 })
        : await IP.launchImageLibraryAsync({ mediaTypes: (IP.MediaTypeOptions && IP.MediaTypeOptions.Images) || 'images', quality: 1 });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const uri = res.assets[0].uri;
      setAttachedUri(uri);
      setPreparing(true);
      const { uriToImageBuffer } = require('../../components/imageBuffer');
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
    setMessages([...base, { role: 'assistant', text: '', streaming: true }]);
    setGenerating(true);
    let acc = '';
    try {
      const content = img ? [{ kind: 'image', image: img }, shown] : shown;
      await llm.sendMessage(content, (tok) => {
        acc += tok;
        setMessages([...base, { role: 'assistant', text: acc, streaming: true }]);
      });
    } catch (e) {
      const info = img ? ` [img ${img.width}x${img.height} ${img.format} ${img.data && img.data.length}b]` : '';
      acc = acc || ('⚠️ ' + ((e && e.message) ? e.message : String(e)) + info);
    }
    setMessages([...base, { role: 'assistant', text: acc, streaming: false }]);
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
      title="Photos"
    />
  );
}

export default function PhotosScreen() {
  const t = useTheme();
  const onPhotos = (usePathname() || '').startsWith('/photos');

  // Only load the vision model while this tab is open, so it never coexists
  // with the chat model (one model at a time = no out-of-memory crash).
  if (!onPhotos) {
    return (
      <ChatUI
        t={t} messages={[]} input="" setInput={() => {}} onSend={() => {}} onStop={() => {}}
        generating={false} status={{ state: 'loading', label: 'Opening…' }}
        onDownload={() => {}} onPickExample={() => {}} title="Photos"
      />
    );
  }

  const fallback = (
    <ChatUI
      t={t} messages={[]} input="" setInput={() => {}} onSend={() => {}} onStop={() => {}}
      generating={false} status={{ state: 'unavailable', label: 'Needs the installed app' }}
      onDownload={() => {}} onPickExample={() => {}} title="Photos"
    />
  );

  return (
    <Boundary fallback={fallback}>
      <VLModel t={t} />
    </Boundary>
  );
}
