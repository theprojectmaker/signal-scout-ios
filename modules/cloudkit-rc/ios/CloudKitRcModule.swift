import ExpoModulesCore
import CloudKit

public class CloudKitRcModule: Module {
  private let container = CKContainer(identifier: "iCloud.com.solyapps.signalscout")
  // schema numeric fields that are Int(64); everything else numeric (x/y/dx/dy) is Double.
  private let intKeys: Set<String> = ["seq", "ts", "w", "h"]

  public func definition() -> ModuleDefinition {
    Name("CloudKitRc")

    // fieldsJSON: {"room":"...","seq":123,"kind":"click","x":10,...}
    AsyncFunction("saveRecord") { (recordType: String, fieldsJSON: String, promise: Promise) in
      guard let data = fieldsJSON.data(using: .utf8),
            let fields = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
        promise.reject("ERR_CK_JSON", "bad fieldsJSON")
        return
      }
      let record = CKRecord(recordType: recordType)
      for (key, value) in fields {
        if let s = value as? String {
          record[key] = s as NSString
        } else if let n = value as? NSNumber {
          record[key] = self.intKeys.contains(key) ? NSNumber(value: n.int64Value) : NSNumber(value: n.doubleValue)
        }
      }
      self.container.publicCloudDatabase.save(record) { saved, error in
        if let error = error { promise.reject("ERR_CK_SAVE", error.localizedDescription) }
        else { promise.resolve(saved?.recordID.recordName ?? "") }
      }
    }

    // returns a JSON array string: [{"recordName":"...","room":"...","jpeg":"...","ts":123,...}, ...]
    AsyncFunction("queryRecords") { (recordType: String, room: String, limit: Int, promise: Promise) in
      let predicate = NSPredicate(format: "room == %@", room)
      let query = CKQuery(recordType: recordType, predicate: predicate)
      query.sortDescriptors = [NSSortDescriptor(key: "ts", ascending: false)]
      let op = CKQueryOperation(query: query)
      op.resultsLimit = limit > 0 ? limit : CKQueryOperation.maximumResults
      var results: [[String: Any]] = []
      op.recordMatchedBlock = { (_, result) in
        if case .success(let record) = result {
          var m: [String: Any] = ["recordName": record.recordID.recordName]
          for key in record.allKeys() {
            if let s = record[key] as? String { m[key] = s }
            else if let n = record[key] as? NSNumber { m[key] = n }
          }
          results.append(m)
        }
      }
      op.queryResultBlock = { result in
        switch result {
        case .success:
          if let data = try? JSONSerialization.data(withJSONObject: results),
             let str = String(data: data, encoding: .utf8) {
            promise.resolve(str)
          } else {
            promise.resolve("[]")
          }
        case .failure(let error):
          promise.reject("ERR_CK_QUERY", error.localizedDescription)
        }
      }
      self.container.publicCloudDatabase.add(op)
    }

    // putRecord: create-or-overwrite a record with a CLIENT-CHOSEN name (the command slots).
    // .allKeys ignores the change tag, so overwriting an existing slot just works.
    AsyncFunction("putRecord") { (recordType: String, recordName: String, fieldsJSON: String, promise: Promise) in
      guard let data = fieldsJSON.data(using: .utf8),
            let fields = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
        promise.reject("ERR_CK_JSON", "bad fieldsJSON")
        return
      }
      let record = CKRecord(recordType: recordType, recordID: CKRecord.ID(recordName: recordName))
      for (key, value) in fields {
        if let s = value as? String {
          record[key] = s as NSString
        } else if let n = value as? NSNumber {
          record[key] = self.intKeys.contains(key) ? NSNumber(value: n.int64Value) : NSNumber(value: n.doubleValue)
        }
      }
      let op = CKModifyRecordsOperation(recordsToSave: [record], recordIDsToDelete: nil)
      op.savePolicy = .allKeys
      op.modifyRecordsResultBlock = { result in
        switch result {
        case .success:
          promise.resolve(recordName)
        case .failure(let error):
          promise.reject("ERR_CK_PUT", error.localizedDescription)
        }
      }
      self.container.publicCloudDatabase.add(op)
    }

    // getRecords: fetch records BY NAME in one request. Unlike a query (whose index lags ~20s) a
    // fetch sees a new record in well under a second. Returns a JSON array of the ones that exist;
    // names with no record are simply left out.
    AsyncFunction("getRecords") { (names: [String], promise: Promise) in
      let ids = names.map { CKRecord.ID(recordName: $0) }
      let op = CKFetchRecordsOperation(recordIDs: ids)
      var results: [[String: Any]] = []
      op.perRecordResultBlock = { (recordID, result) in
        if case .success(let record) = result {
          var m: [String: Any] = ["recordName": recordID.recordName]
          for key in record.allKeys() {
            if let s = record[key] as? String { m[key] = s }
            else if let n = record[key] as? NSNumber { m[key] = n }
          }
          if let mod = record.modificationDate { m["_modified"] = mod.timeIntervalSince1970 * 1000 }
          results.append(m)
        }
      }
      op.fetchRecordsResultBlock = { result in
        if case .failure(let error) = result {
          // some names not existing surfaces as a partial failure — that's expected, not an error
          let partial = (error as? CKError)?.code == .partialFailure
          if !partial {
            promise.reject("ERR_CK_GET", error.localizedDescription)
            return
          }
        }
        if let data = try? JSONSerialization.data(withJSONObject: results),
           let str = String(data: data, encoding: .utf8) {
          promise.resolve(str)
        } else {
          promise.resolve("[]")
        }
      }
      self.container.publicCloudDatabase.add(op)
    }

    AsyncFunction("deleteRecord") { (recordName: String, promise: Promise) in
      self.container.publicCloudDatabase.delete(withRecordID: CKRecord.ID(recordName: recordName)) { _, error in
        if let error = error { promise.reject("ERR_CK_DELETE", error.localizedDescription) }
        else { promise.resolve(nil) }
      }
    }
  }
}
