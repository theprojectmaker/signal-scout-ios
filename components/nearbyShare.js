// Fully-offline file sharing between two installs of the app.
//
// Transport: expo-nearby-connections (Apple MultipeerConnectivity on iOS) — a direct
// phone<->iPad radio link over Wi-Fi/Bluetooth, NO internet, Wi-Fi router, or cell. The module
// only ships sendText(peerId, string), so files ride a small chunk protocol on top:
//   {k:'begin', id, name, mime, size, n}  ->  {k:'c', id, i, d:<base64 chunk>} * n  ->  {k:'end', id}
//   the receiver writes the file and replies {k:'ack', id} so the sender can drop it from its queue.
// Both sides advertise AND discover under one service; the device with the smaller id initiates, the
// other auto-accepts. Queued files and received files are persisted, so opening the app hours later
// still shows them. iOS won't transfer while an app is fully killed — the app must be open on at
// least the receiving side; then it auto-sends the instant the two are in range.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVICE = 'sigscout-share';
const QUEUE_KEY = 'share.queue.v2';
const LIB_KEY = 'share.library.v2';
const ID_KEY = 'share.deviceid.v1';
const NICK_KEY = 'share.nick.v1';
const CHUNK = 8000;              // base64 chars per message (~6 KB binary)

// Lazy, guarded access — the native module is absent on web / Expo Go, so never throw at import.
let NBC = null;
let FS = null;
let AVAILABLE = false;
if (Platform.OS !== 'web') {
  try {
    NBC = require('expo-nearby-connections');
    FS = require('expo-file-system/legacy');
    AVAILABLE = !!(NBC && NBC.startAdvertise);
  } catch (e) { AVAILABLE = false; }
}

const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
async function loadJSON(k, d) { try { const r = await AsyncStorage.getItem(k); return r ? JSON.parse(r) : d; } catch (e) { return d; } }
async function saveJSON(k, v) { try { await AsyncStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

export function useNearbyShare() {
  const [available] = useState(AVAILABLE);
  const [status, setStatus] = useState(AVAILABLE ? 'Looking for nearby devices…' : 'Needs the installed app');
  const [peer, setPeer] = useState(null);         // { id, name } when connected
  const [queue, setQueue] = useState([]);         // outgoing, waiting for a peer
  const [library, setLibrary] = useState([]);     // received files
  const [progress, setProgress] = useState(null); // { dir:'send'|'recv', name, pct }
  const [nick, setNick] = useState('');
  const [log, setLog] = useState([]); // on-screen diagnostics

  const deviceId = useRef('');
  const peerRef = useRef(null);
  const queueRef = useRef([]); queueRef.current = queue;
  const sendingRef = useRef(false);
  const rx = useRef({});          // id -> { name, mime, size, n, parts:[] }
  const subs = useRef([]);
  const mounted = useRef(true);
  const roleRef = useRef('adv');      // current single role: 'adv' | 'disc'
  const hopTimerRef = useRef(null);
  const connectedRef = useRef(false);

  const setQ = (next) => { queueRef.current = next; setQueue(next); saveJSON(QUEUE_KEY, next); };
  const setLib = (next) => { setLibrary(next); saveJSON(LIB_KEY, next); };
  const pushLog = useCallback((m) => {
    const ts = new Date().toTimeString().slice(0, 8);
    setLog((l) => [`${ts}  ${m}`, ...l].slice(0, 40));
  }, []);

  // ---- lifecycle: advertise + discover while the tab is open ----
  useEffect(() => {
    mounted.current = true;
    (async () => {
      let id = await AsyncStorage.getItem(ID_KEY); if (!id) { id = rid(); AsyncStorage.setItem(ID_KEY, id); }
      deviceId.current = id;
      let nk = await AsyncStorage.getItem(NICK_KEY) || (Platform.OS === 'ios' ? 'My device' : 'Device');
      setNick(nk);
      setQ(await loadJSON(QUEUE_KEY, []));
      setLib(await loadJSON(LIB_KEY, []));
      if (!AVAILABLE) return;
      const myName = `${nk}~${id}`;
      pushLog(`me: ${nk} (${id.slice(0, 4)})`);
      try {
        // The native module makes a SEPARATE peer id for advertising vs discovering, so doing both
        // at once makes the invite target one identity while the accept uses the other -> peers
        // find each other but never connect. Fix: hold ONE role at a time and hop between them with
        // jitter; when two devices land in opposite roles the discoverer invites and the advertiser
        // accepts, identities match, and they connect. Hopping stops once connected.
        const setRole = async (r) => {
          if (!AVAILABLE || !mounted.current || connectedRef.current) return;
          roleRef.current = r;
          try {
            if (r === 'adv') { try { await NBC.stopDiscovery(); } catch (e) {} await NBC.startAdvertise(myName); pushLog('→ advertising'); }
            else { try { await NBC.stopAdvertise(); } catch (e) {} await NBC.startDiscovery(myName); pushLog('→ searching'); }
          } catch (e) { pushLog('role err: ' + (e && e.message)); }
        };
        const startHop = () => {
          if (hopTimerRef.current) clearTimeout(hopTimerRef.current);
          const tick = () => {
            hopTimerRef.current = setTimeout(async () => {
              if (mounted.current && !connectedRef.current) await setRole(roleRef.current === 'adv' ? 'disc' : 'adv');
              if (mounted.current && !connectedRef.current) tick();
            }, 2500 + Math.floor(Math.random() * 1500));
          };
          tick();
        };

        subs.current.push(NBC.onPeerFound(({ peerId, name }) => {
          // we only browse while in 'disc' role, so finding a peer = invite it (we're the discoverer)
          pushLog(`found ${String(name).split('~')[0]} → inviting`);
          NBC.requestConnection(peerId).then(() => pushLog('invite sent')).catch((e) => pushLog('invite err: ' + (e && e.message)));
        }));
        subs.current.push(NBC.onPeerLost(() => pushLog('peer lost')));
        subs.current.push(NBC.onInvitationReceived(({ peerId, name }) => {
          // invitations only arrive while in 'adv' role = accept (we're the advertiser)
          pushLog(`invite from ${String(name).split('~')[0]} → accepting`);
          NBC.acceptConnection(peerId).then(() => pushLog('accepted')).catch((e) => pushLog('accept err: ' + (e && e.message)));
        }));
        subs.current.push(NBC.onConnected(({ peerId, name }) => {
          const nm = String(name || '').split('~')[0] || 'device';
          connectedRef.current = true;
          if (hopTimerRef.current) { clearTimeout(hopTimerRef.current); hopTimerRef.current = null; }
          peerRef.current = { id: peerId, name: nm }; setPeer({ id: peerId, name: nm });
          setStatus(`Connected to ${nm}`); pushLog(`CONNECTED to ${nm}`);
          flush();
        }));
        subs.current.push(NBC.onDisconnected(() => {
          peerRef.current = null; setPeer(null); sendingRef.current = false; connectedRef.current = false;
          if (mounted.current) { setStatus('Looking for nearby devices…'); pushLog('disconnected'); startHop(); }
        }));
        subs.current.push(NBC.onTextReceived(({ peerId, text }) => onText(peerId, text)));

        await setRole(Math.random() < 0.5 ? 'adv' : 'disc'); // random start so two devices desync
        startHop();
      } catch (e) { setStatus('Sharing unavailable on this device'); pushLog('start error: ' + (e && e.message)); }
    })();
    return () => {
      mounted.current = false;
      if (hopTimerRef.current) { clearTimeout(hopTimerRef.current); hopTimerRef.current = null; }
      subs.current.forEach((u) => { try { u && u(); } catch (e) {} });
      subs.current = [];
      if (AVAILABLE) { try { NBC.stopAdvertise(); } catch (e) {} try { NBC.stopDiscovery(); } catch (e) {} }
    };
  }, []);

  // ---- receive ----
  function onText(peerId, text) {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (m.k === 'begin') { rx.current[m.id] = { name: m.name, mime: m.mime, size: m.size, n: m.n, parts: new Array(m.n) }; setProgress({ dir: 'recv', name: m.name, pct: 0 }); return; }
    if (m.k === 'c') {
      const a = rx.current[m.id]; if (!a) return;
      a.parts[m.i] = m.d;
      const got = a.parts.filter(Boolean).length;
      setProgress({ dir: 'recv', name: a.name, pct: Math.round((got / a.n) * 100) });
      return;
    }
    if (m.k === 'end') {
      const a = rx.current[m.id]; if (!a) return;
      (async () => {
        try {
          const b64 = a.parts.join('');
          const dir = FS.documentDirectory + 'shared/';
          try { await FS.makeDirectoryAsync(dir, { intermediates: true }); } catch (e) {}
          const safe = (a.name || 'file').replace(/[^\w.\-]+/g, '_');
          const uri = dir + Date.now() + '_' + safe;
          await FS.writeAsStringAsync(uri, b64, { encoding: 'base64' });
          const entry = { id: m.id, name: a.name, mime: a.mime, size: a.size, uri, from: (peerRef.current && peerRef.current.name) || 'device', at: Date.now() };
          const next = [entry, ...(await loadJSON(LIB_KEY, []))].slice(0, 300);
          if (mounted.current) setLib(next);
          if (peerRef.current) NBC.sendText(peerId, JSON.stringify({ k: 'ack', id: m.id })).catch(() => {});
        } catch (e) {}
        delete rx.current[m.id];
        if (mounted.current) { setProgress(null); setStatus(peerRef.current ? `Connected to ${peerRef.current.name}` : 'Looking for nearby devices…'); }
      })();
      return;
    }
    if (m.k === 'ack') {
      // the peer confirmed it has this file — drop it from our queue for good
      setQ(queueRef.current.filter((f) => f.id !== m.id));
      return;
    }
  }

  // ---- send: flush the queue to the connected peer, one file at a time ----
  async function flush() {
    if (sendingRef.current || !AVAILABLE) return;
    const p = peerRef.current; if (!p) return;
    sendingRef.current = true;
    try {
      while (peerRef.current && queueRef.current.length) {
        const f = queueRef.current[0];
        try {
          const b64 = await FS.readAsStringAsync(f.uri, { encoding: 'base64' });
          const n = Math.max(1, Math.ceil(b64.length / CHUNK));
          await NBC.sendText(p.id, JSON.stringify({ k: 'begin', id: f.id, name: f.name, mime: f.mime, size: f.size, n }));
          for (let i = 0; i < n; i++) {
            if (!peerRef.current) throw new Error('lost peer');
            await NBC.sendText(p.id, JSON.stringify({ k: 'c', id: f.id, i, d: b64.slice(i * CHUNK, (i + 1) * CHUNK) }));
            if (mounted.current) setProgress({ dir: 'send', name: f.name, pct: Math.round(((i + 1) / n) * 100) });
          }
          await NBC.sendText(p.id, JSON.stringify({ k: 'end', id: f.id }));
          // wait briefly for the ack to remove it; if it never comes, it stays queued and retries
          await new Promise((r) => setTimeout(r, 400));
        } catch (e) { break; }
        if (mounted.current) setProgress(null);
        // if the file is still at the head (no ack yet), stop to avoid resending in a tight loop
        if (queueRef.current[0] && queueRef.current[0].id === f.id) break;
      }
    } finally {
      sendingRef.current = false;
      if (mounted.current && peerRef.current) setStatus(`Connected to ${peerRef.current.name}`);
    }
  }

  // ---- public actions ----
  const enqueueFile = useCallback(async (file) => {
    // copy the picked file into our own storage so the queue survives app restarts
    try {
      const dir = FS.documentDirectory + 'outgoing/';
      try { await FS.makeDirectoryAsync(dir, { intermediates: true }); } catch (e) {}
      const safe = (file.name || 'file').replace(/[^\w.\-]+/g, '_');
      const uri = dir + Date.now() + '_' + safe;
      await FS.copyAsync({ from: file.uri, to: uri });
      const entry = { id: rid(), uri, name: file.name || safe, mime: file.mimeType || 'application/octet-stream', size: file.size || 0, addedAt: Date.now() };
      const next = [...queueRef.current, entry];
      setQ(next);
      if (peerRef.current) flush();
    } catch (e) {}
  }, []);

  const removeQueued = useCallback((id) => setQ(queueRef.current.filter((f) => f.id !== id)), []);
  const removeLibrary = useCallback(async (id) => {
    const lib = await loadJSON(LIB_KEY, []);
    const item = lib.find((x) => x.id === id);
    if (item && item.uri) { try { await FS.deleteAsync(item.uri, { idempotent: true }); } catch (e) {} }
    setLib(lib.filter((x) => x.id !== id));
  }, []);

  const openFile = useCallback(async (item) => {
    try { const Sharing = require('expo-sharing'); if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(item.uri, { mimeType: item.mime }); } catch (e) {}
  }, []);

  const saveNick = useCallback((v) => { setNick(v); AsyncStorage.setItem(NICK_KEY, v).catch(() => {}); }, []);

  return { available, status, peer, queue, library, progress, nick, log, enqueueFile, removeQueued, removeLibrary, openFile, saveNick };
}
