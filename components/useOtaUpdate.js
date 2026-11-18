// Force the newest OTA to APPLY promptly, instead of expo-updates' default (download now, apply on the
// *next* launch) — which left the app a step behind after every publish.
//
// Why updates "never landed": the old version only checked ONCE, on mount. But iOS keeps the app
// resident for a long time, so a real cold launch — the only thing that re-ran the check — almost never
// happens. Backgrounding and reopening the app does NOT remount, so a freshly published OTA just sat
// there. The fix is to check again every time the app returns to the FOREGROUND (debounced), and when
// an update is found, fetch it and reload straight into it. Now an update lands within a few seconds of
// the next time you open the app.
import { useEffect, useCallback, useState, useRef } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

export function useOtaUpdate() {
  const [state, setState] = useState('idle');   // idle | checking | downloading | current | error
  const [detail, setDetail] = useState('');
  const busy = useRef(false);
  const lastCheck = useRef(0);

  const runningAt = Updates.createdAt ? new Date(Updates.createdAt) : null;

  const check = useCallback(async (force) => {
    if (busy.current) return;
    if (!Updates.isEnabled) { setState('current'); setDetail('dev build — OTA disabled'); return; }
    const now = Date.now();
    if (!force && now - lastCheck.current < 60000) return;   // debounce foreground checks to ~1/min
    lastCheck.current = now;
    busy.current = true;
    try {
      setState('checking'); setDetail('checking for an update…');
      const r = await Updates.checkForUpdateAsync();
      if (r.isAvailable) {
        setState('downloading'); setDetail('downloading update…');
        await Updates.fetchUpdateAsync();
        setDetail('restarting…');
        await Updates.reloadAsync();            // relaunch into the new version right now
      } else {
        setState('current'); setDetail('up to date');
      }
    } catch (e) {
      setState('error'); setDetail(String(e && e.message ? e.message : e));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    check(true);                                 // on launch
    // AND every time the app comes back to the foreground — this is the actual fix for "OTAs don't
    // land": a resident app never re-mounts, so a launch-only check almost never fires.
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(false); });
    return () => sub.remove();
  }, [check]);

  return { state, detail, check: () => check(true), runningAt };
}
