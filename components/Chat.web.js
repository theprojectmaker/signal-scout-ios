import { useState, useRef } from 'react';
import ChatUI from './ChatUI';
import { useTheme } from './theme';

const DEMO_REPLY =
  "This is a preview of the chat interface. On your phone, I run completely on-device — no internet needed, and I can look at photos you send. Install Signal Scout from TestFlight to use the real offline AI.";

// a small inline sample image so the attach UI is visible in the web preview
const DEMO_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='120' height='120' fill='#34C759'/><circle cx='60' cy='48' r='22' fill='#fff'/><rect x='24' y='78' width='72' height='30' rx='8' fill='#fff'/></svg>"
  );

export default function ChatWeb() {
  const t = useTheme();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [attachedUri, setAttachedUri] = useState(null);
  const timer = useRef(null);

  const stream = (full) => {
    const words = full.split(' ');
    let i = 0;
    setGenerating(true);
    timer.current = setInterval(() => {
      i += 1;
      const text = words.slice(0, i).join(' ');
      setMessages((m) => {
        const c = [...m];
        c[c.length - 1] = { role: 'assistant', text, streaming: i < words.length };
        return c;
      });
      if (i >= words.length) { clearInterval(timer.current); setGenerating(false); }
    }, 45);
  };

  const onSend = () => {
    const text = input.trim();
    if ((!text && !attachedUri) || generating) return;
    const shown = text || (attachedUri ? "What's in this photo?" : '');
    const uri = attachedUri;
    setMessages((m) => [...m, { role: 'user', text: shown, imageUri: uri }, { role: 'assistant', text: '', streaming: true }]);
    setInput('');
    setAttachedUri(null);
    setTimeout(() => stream(DEMO_REPLY), 250);
  };
  const onStop = () => { clearInterval(timer.current); setGenerating(false); };

  return (
    <ChatUI
      t={t}
      messages={messages}
      input={input}
      setInput={setInput}
      onSend={onSend}
      onStop={onStop}
      generating={generating}
      status={{ state: 'ready', label: 'Preview (demo)' }}
      onDownload={() => {}}
      onPickExample={(ex) => setInput(ex)}
      onPickImage={() => setAttachedUri(DEMO_IMG)}
      attachedUri={attachedUri}
      onClearImage={() => setAttachedUri(null)}
      banner="Preview — the real on-device AI runs in the installed app"
    />
  );
}
