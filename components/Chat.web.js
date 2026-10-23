import { useState, useRef } from 'react';
import ChatUI from './ChatUI';
import { useTheme } from './theme';
import { newChat, titleFrom } from './chatStore';

const DEMO_REPLY =
  "Here's a **preview** of the chat. On your phone I run completely on-device — no internet needed — and I can:\n\n- answer questions\n- look at **photos** you send\n- keep your **saved chats**\n\nInstall Signal Scout from TestFlight to use the real offline AI.";

const DEMO_IMG =
  "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='120' height='120' fill='#34C759'/><circle cx='60' cy='48' r='22' fill='#fff'/><rect x='24' y='78' width='72' height='30' rx='8' fill='#fff'/></svg>");

export default function ChatWeb() {
  const t = useTheme();
  const [chats, setChats] = useState([newChat()]);
  const [activeId, setActiveId] = useState(() => null);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [attachedUri, setAttachedUri] = useState(null);
  const timer = useRef(null);

  const id = activeId || chats[0].id;
  const active = chats.find((c) => c.id === id) || chats[0];
  const messages = active.messages || [];

  const setMessages = (msgs) => setChats((cs) => cs.map((c) => c.id === id
    ? { ...c, messages: msgs, title: (!c.title || c.title === 'New chat') ? titleFrom(msgs) : c.title, updatedAt: Date.now() } : c));

  const stream = (full, base) => {
    const words = full.split(' ');
    let i = 0;
    setGenerating(true);
    timer.current = setInterval(() => {
      i += 1;
      setMessages([...base, { role: 'assistant', text: words.slice(0, i).join(' '), streaming: i < words.length }]);
      if (i >= words.length) { clearInterval(timer.current); setGenerating(false); }
    }, 40);
  };

  const onSend = () => {
    const text = input.trim();
    if ((!text && !attachedUri) || generating) return;
    const shown = text || "What's in this photo?";
    const base = [...messages, { role: 'user', text: shown, imageUri: attachedUri }];
    setMessages([...base, { role: 'assistant', text: '', streaming: true }]);
    setInput(''); setAttachedUri(null);
    setTimeout(() => stream(DEMO_REPLY, base), 250);
  };

  const onNewChat = () => { const c = newChat(); setChats((cs) => [c, ...cs]); setActiveId(c.id); };
  const onDeleteChat = (cid) => setChats((cs) => { let n = cs.filter((c) => c.id !== cid); if (n.length === 0) n = [newChat()]; if (cid === id) setActiveId(n[0].id); return n; });

  return (
    <ChatUI
      t={t}
      messages={messages}
      input={input}
      setInput={setInput}
      onSend={onSend}
      onStop={() => { clearInterval(timer.current); setGenerating(false); }}
      generating={generating}
      status={{ state: 'ready', label: 'Preview (demo)' }}
      onDownload={() => {}}
      onPickExample={(ex) => setInput(ex)}
      onPickImage={() => setAttachedUri(DEMO_IMG)}
      attachedUri={attachedUri}
      onClearImage={() => setAttachedUri(null)}
      banner="Preview — the real on-device AI runs in the installed app"
      title={active.title}
      chats={chats}
      activeChatId={id}
      onNewChat={onNewChat}
      onOpenChat={(cid) => setActiveId(cid)}
      onDeleteChat={onDeleteChat}
    />
  );
}
