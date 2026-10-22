import React, { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ChatUI from './ChatUI';
import { useTheme } from './theme';

const ENABLED_KEY = 'ai.enabled.v1';

/* Error boundary: if the native AI module is missing (e.g. Expo Go), show the
   unavailable state instead of crashing. */
class Boundary extends React.Component {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch() {}
  render() { return this.state.err ? this.props.fallback : this.props.children; }
}

/* Loads + runs the model. Only mounted after the user opts in, so the ~1GB
   download never starts without consent. */
function ModelChat({ t }) {
  const { models, useLLMChatSession } = require('react-native-executorch');
  const llm = useLLMChatSession(models.llm.LLAMA3_2_1B);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);

  const status = (() => {
    if (llm.error) return { state: 'unavailable', label: 'Could not load model' };
    if (!llm.isReady && (llm.downloadProgress || 0) < 1) {
      return { state: 'downloading', progress: llm.downloadProgress || 0, label: `Downloading ${Math.round((llm.downloadProgress || 0) * 100)}%` };
    }
    if (!llm.isReady) return { state: 'loading', label: 'Loading model…' };
    return { state: 'ready', label: 'On-device · ready' };
  })();

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || generating || !llm.isReady || !llm.sendMessage) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '', streaming: true }]);
    setGenerating(true);
    let acc = '';
    try {
      await llm.sendMessage(text, (tok) => {
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
  }, [input, generating, llm]);

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
        t={t}
        messages={[]}
        input=""
        setInput={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        generating={false}
        status={{ state: 'needs-download', label: 'Model not downloaded' }}
        onDownload={enable}
        onPickExample={() => {}}
      />
    );
  }

  const fallback = (
    <ChatUI
      t={t}
      messages={[]}
      input=""
      setInput={() => {}}
      onSend={() => {}}
      onStop={() => {}}
      generating={false}
      status={{ state: 'unavailable', label: 'Needs the installed app' }}
      onDownload={() => {}}
      onPickExample={() => {}}
    />
  );

  return (
    <Boundary fallback={fallback}>
      <ModelChat t={t} />
    </Boundary>
  );
}
