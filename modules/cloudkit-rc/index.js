// Optional native CloudKit module. Present only in the native (TestFlight/App Store) build;
// null on web, Expo Go, or before the native build ships — callers must handle null and fall back
// to the web-services client. Writes run as the device's iCloud account (_icloud), so no API token
// and no web sign-in, and it uses ckdatabasews.icloud.com (confirmed reachable on the work network).
//
// Native interface:
//   saveRecord(recordType, fieldsJSON) -> Promise<recordName>
//   queryRecords(recordType, room, limit) -> Promise<JSON array string>
//   deleteRecord(recordName) -> Promise<null>
import { requireOptionalNativeModule } from 'expo-modules-core';

export default requireOptionalNativeModule('CloudKitRc');
