import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../components/theme';

const KEY = 'notes.v1';
const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function titleOf(body) {
  const line = (body || '').split('\n').find((l) => l.trim());
  return (line || 'New note').trim().slice(0, 60);
}
function previewOf(body) {
  const rest = (body || '').split('\n').slice(1).join(' ').trim();
  return rest.slice(0, 80);
}

export default function NotesScreen() {
  const t = useTheme();
  const s = styles(t);
  const [notes, setNotes] = useState([]);
  const [editing, setEditing] = useState(null); // { id, body }
  const notesRef = useRef([]); notesRef.current = notes;

  useEffect(() => { (async () => { try { const r = await AsyncStorage.getItem(KEY); if (r) setNotes(JSON.parse(r)); } catch (e) {} })(); }, []);
  const persist = (next) => { setNotes(next); AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {}); };

  const openNew = () => setEditing({ id: rid(), body: '', isNew: true });
  const openNote = (n) => setEditing({ id: n.id, body: n.body });

  const save = useCallback(() => {
    if (!editing) return;
    const body = editing.body;
    const list = notesRef.current.slice();
    const i = list.findIndex((n) => n.id === editing.id);
    if (!body.trim()) { // discard empty
      if (i >= 0) { list.splice(i, 1); persist(list); }
      setEditing(null); return;
    }
    const entry = { id: editing.id, body, updatedAt: Date.now() };
    if (i >= 0) list[i] = entry; else list.unshift(entry);
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    persist(list);
    setEditing(null);
  }, [editing]);

  const removeNote = (id) => { persist(notesRef.current.filter((n) => n.id !== id)); };

  if (editing) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex}>
          <View style={s.editHead}>
            <Pressable onPress={save} hitSlop={8}><Text style={s.done}>‹ Notes</Text></Pressable>
            {!editing.isNew ? <Pressable onPress={() => { removeNote(editing.id); setEditing(null); }} hitSlop={8}><Text style={s.del}>Delete</Text></Pressable> : <View />}
          </View>
          <TextInput
            style={s.editor}
            value={editing.body}
            onChangeText={(v) => setEditing((e) => ({ ...e, body: v }))}
            placeholder="Write a note… saved on your phone, works with no signal."
            placeholderTextColor={t.label3}
            multiline autoFocus textAlignVertical="top"
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.head}>
        <Text style={s.title}>Notes</Text>
        <Pressable onPress={openNew} hitSlop={8} style={s.add}><Text style={s.addTxt}>＋</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={s.wrap}>
        {notes.length === 0 ? (
          <Text style={s.empty}>No notes yet. Tap ＋ to jot something — it stays on your phone, no internet needed.</Text>
        ) : notes.map((n) => (
          <Pressable key={n.id} style={s.row} onPress={() => openNote(n)} onLongPress={() => removeNote(n.id)}>
            <Text style={s.noteTitle} numberOfLines={1}>{titleOf(n.body)}</Text>
            {previewOf(n.body) ? <Text style={s.notePrev} numberOfLines={1}>{previewOf(n.body)}</Text> : null}
          </Pressable>
        ))}
        {notes.length > 0 ? <Text style={s.hint}>Tap to edit · long-press to delete</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (t) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 34, fontWeight: '700', color: t.label, letterSpacing: 0.3 },
  add: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.blue, alignItems: 'center', justifyContent: 'center' },
  addTxt: { color: t.onBlue, fontSize: 26, fontWeight: '400', lineHeight: 30 },
  wrap: { padding: 20, paddingTop: 10, gap: 10 },
  empty: { color: t.label2, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingTop: 20 },
  row: { backgroundColor: t.card, borderRadius: 12, padding: 14, gap: 3 },
  noteTitle: { color: t.label, fontSize: 16, fontWeight: '600' },
  notePrev: { color: t.label2, fontSize: 13 },
  hint: { textAlign: 'center', color: t.label3, fontSize: 11, marginTop: 4 },
  editHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  done: { color: t.blue, fontSize: 16, fontWeight: '600' },
  del: { color: t.red, fontSize: 15, fontWeight: '600' },
  editor: { flex: 1, color: t.label, fontSize: 17, lineHeight: 24, paddingHorizontal: 20, paddingTop: 4 },
});
