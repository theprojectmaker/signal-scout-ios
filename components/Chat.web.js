import { useState, useRef } from 'react';
import ChatUI from './ChatUI';
import { useTheme } from './theme';

const DEMO_REPLY =
  "This is a preview of the chat interface. On your phone, I run completely on-device — no internet needed. Install Signal Scout from TestFlight to use the real offline AI.";

export default function ChatWeb() {
  const t = useTheme();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
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
    if (!text || generating) return;
    setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '', streaming: true }]);
    setInput('');
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
      banner="Preview — the real on-device AI runs in the installed app"
    />
  );
}
