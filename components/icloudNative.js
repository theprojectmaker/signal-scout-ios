// Thin JS wrapper over the optional native CloudKit module. hasNativeCK is false on web / Expo Go /
// before the native build ships, in which case callers use the web-services client instead.
import CloudKitRc from '../modules/cloudkit-rc';

export const hasNativeCK = !!CloudKitRc;

export async function nativeSave(recordType, fields) {
  return CloudKitRc.saveRecord(recordType, JSON.stringify(fields));
}
export async function nativeQuery(recordType, room, limit) {
  const s = await CloudKitRc.queryRecords(recordType, room, limit);
  try { return JSON.parse(s) || []; } catch (e) { return []; }
}
export async function nativeDelete(recordName) {
  return CloudKitRc.deleteRecord(recordName);
}
