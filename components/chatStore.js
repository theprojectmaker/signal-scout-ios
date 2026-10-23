import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'ai.chats.v1';

export function newChat() {
  return { id: String(Date.now()) + Math.random().toString(36).slice(2, 6), title: 'New chat', messages: [], updatedAt: Date.now() };
}

export function titleFrom(messages) {
  const firstUser = messages.find((m) => m.role === 'user' && m.text);
  if (!firstUser) return 'New chat';
  const t = firstUser.text.trim().replace(/\s+/g, ' ');
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}

export async function loadChats() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (e) { return []; }
}

export async function saveChats(chats) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(chats)); } catch (e) {}
}
