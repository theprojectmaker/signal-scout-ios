// Thin JS wrapper over the optional native CloudKit module.
// hasNativeCK is false on web / Expo Go, AND on an older native build that lacks the by-name
// methods (putRecord / getRecords) — in those cases callers use the web-services client instead,
// so an OTA can never leave the app calling a native method that isn't there.
import CloudKitRc from '../modules/cloudkit-rc';

export const hasNativeCK = !!CloudKitRc
  && typeof CloudKitRc.putRecord === 'function'
  && typeof CloudKitRc.getRecords === 'function';

// create-or-overwrite one record with a client-chosen name
export async function nativePut(recordType, recordName, fields) {
  return CloudKitRc.putRecord(recordType, recordName, JSON.stringify(fields));
}
// fetch records by name in one request; returns only the ones that exist
export async function nativeGet(names) {
  const s = await CloudKitRc.getRecords(names);
  try { return JSON.parse(s) || []; } catch (e) { return []; }
}
