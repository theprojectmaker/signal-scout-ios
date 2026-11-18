// Force the newest OTA to APPLY on launch, instead of expo-updates' default (download now, apply on
// the *next* launch) — which left the app a step behind after every publish. On launch we check,
// and if an update exists we fetch it and reload straight into it. Also exposes a manual trigger
// and the running version's timestamp so you can confirm what's actually installed.
import { useEffect, useCallback, useState, useRef } from 'react';
import * as Updates from 'expo-updates';

export function useOtaUpdate() {
  const [state, setState] = useState('idle');   // idle | checking | downloading | current | error
  const [detail, setDetail] = useState('');
  const busy = useRef(false);

  const runningAt = Updates.createdAt ? new Date(Updates.createdAt) : null;

  const check = useCallback(async () => {
    if (busy.current) return;
    if (!Updates.isEnabled) { setState('current'); setDetail('dev build — OTA disabled'); return; }
    busy.current = true;
    try {
      setState('checking'); setDetail('checking for an update…');
      const r = await Updates.checkForUpdateAsync();
      if (r.isAvailable) {
        setState('downloading'); setDetail('downloading update…');
        await Updates.fetchUpdateAsync();
        setDetail('restarting…');
        await Updates.reloadAsync();           // relaunch into the new version right now
      } else {
        setState('current'); setDetail('up to date');
      }
    } catch (e) {
      setState('error'); setDetail(String(e && e.message ? e.message : e));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => { check(); }, [check]);        // run once on every launch

  return { state, detail, check, runningAt };
}
