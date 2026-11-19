// Turbo stream assembler — PURE JS (no React Native imports) so the app and the PC-side test harness run the
// exact same logic. The bridge (icloud-agent.js, "TURBO engine") sends messages:
//   {t:'b', n, ts, W, H, T, j}                 whole-screen preview (replaces everything)
//   {t:'r', n, ts, W, H, T, x, y, w, h, j}     full-resolution rectangle (tile aligned) painted over the preview
// `n` is a gap-free counter in transmission order, `ts` the PC capture time, `j` a base64 JPEG. Messages arrive
// out of order (several POSTs overlap) and some may be overwritten before we read them, so this module:
//   1. de-dupes + orders by n,  2. waits briefly for a missing n, then jumps ahead and asks for a resync,
//   3. keeps a tile-ownership map so each rectangle can be drawn as ONE image and an older rectangle is dropped
//      the moment newer ones cover all of its tiles (bounded memory, correct z-order).

export const TURBO_SLOTS = 12;
export const turboIdxName = (room, k) => `turbo-${room}-i${k}`;
export const turboPayName = (room, k) => `turbo-${room}-p${k}`;
export const turboIdxNames = (room) => Array.from({ length: TURBO_SLOTS }, (_, k) => turboIdxName(room, k));

export function createAssembler() {
  return {
    sid: 0, synced: false, nextN: 0, pending: new Map(), gapSince: 0,
    base: null, rects: new Map(), owner: new Map(), rectSeq: 0,
    W: 0, H: 0, T: 128, rev: 0,
  };
}

// add decoded messages (a payload record's JSON array). Returns how many were new.
export function ingest(a, msgs) {
  let added = 0;
  for (const m of msgs || []) {
    if (!m || typeof m.n !== 'number' || !m.j) continue;
    if (m.s != null) {                                       // bridge run id: counters restart when the bridge restarts
      if (a.sid && m.s < a.sid) continue;                    // leftovers from an older run
      if (m.s !== a.sid) { a.sid = m.s; a.synced = false; a.nextN = 0; a.pending = new Map(); a.gapSince = 0; }   // newer run → start over (picture stays until its first preview)
    }
    if (a.synced && m.n < a.nextN) continue;                 // already applied / skipped
    if (!a.pending.has(m.n)) { a.pending.set(m.n, m); added++; }
  }
  if (a.pending.size > 400) {                                // runaway guard: keep the newest 200
    const keys = [...a.pending.keys()].sort((x, y) => x - y);
    for (const k of keys.slice(0, keys.length - 200)) a.pending.delete(k);
  }
  return added;
}

// Pull every message that is now in order out of `pending` and return it ([] if none).
// `resync` is true when we had to jump over a missing message (the caller should ask the PC for a repaint).
export function sequence(a, now) {
  const out = []; let resync = false;
  for (let guard = 0; guard < 1000; guard++) {
    const cur = a.pending.get(a.nextN);
    if (a.synced && cur) { a.pending.delete(a.nextN); out.push(cur); a.nextN++; a.gapSince = 0; continue; }
    if (!a.pending.size) break;
    // find the newest preview waiting: it repaints everything, so it is always a valid place to (re)start from
    let bestBase = -1, minN = Infinity;
    for (const [n, m] of a.pending) { if (m.t === 'b' && n > bestBase && (!a.synced || n > a.nextN)) bestBase = n; if (n < minN) minN = n; }
    if (!a.synced) {
      if (bestBase < 0) break;                               // nothing to start from yet
      for (const n of [...a.pending.keys()]) if (n < bestBase) a.pending.delete(n);
      a.synced = true; a.nextN = bestBase; a.gapSince = 0; continue;
    }
    // synced, but nextN is missing while later messages are here: a gap
    if (bestBase > a.nextN) {                                // a later preview exists → skip straight to it, no waiting
      for (const n of [...a.pending.keys()]) if (n < bestBase) a.pending.delete(n);
      a.nextN = bestBase; a.gapSince = 0; continue;
    }
    if (!a.gapSince) { a.gapSince = now; break; }
    if (now - a.gapSince > 1800) { a.nextN = minN; a.gapSince = 0; resync = true; continue; }   // give up waiting
    break;
  }
  return { ready: out, resync };
}

// paint one message into the state
export function applyMsg(a, m) {
  if (m.t === 'b') {
    a.base = { uri: 'data:image/jpeg;base64,' + m.j, W: m.W, H: m.H, n: m.n };
    a.rects = new Map(); a.owner = new Map();
    a.W = m.W; a.H = m.H; a.T = m.T || 128; a.rev++;
    return true;
  }
  if (m.t === 'r' && a.base) {
    const T = a.T || 128, id = ++a.rectSeq;
    const tx0 = Math.floor(m.x / T), tx1 = Math.ceil((m.x + m.w) / T) - 1;
    const ty0 = Math.floor(m.y / T), ty1 = Math.ceil((m.y + m.h) / T) - 1;
    const cols = Math.ceil((m.W || a.W) / T);
    const tiles = new Set();
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.add(ty * cols + tx);
    for (const t of tiles) {
      const old = a.owner.get(t);
      if (old != null) { const r = a.rects.get(old); if (r) { r.tiles.delete(t); if (!r.tiles.size) a.rects.delete(old); } }
      a.owner.set(t, id);
    }
    a.rects.set(id, { id, x: m.x, y: m.y, w: m.w, h: m.h, uri: 'data:image/jpeg;base64,' + m.j, tiles });
    a.W = m.W || a.W; a.H = m.H || a.H; a.rev++;
    return true;
  }
  return false;
}

export function snapshot(a) {
  return { rev: a.rev, base: a.base, rects: [...a.rects.values()].sort((x, y) => x.id - y.id), W: a.W, H: a.H };
}
