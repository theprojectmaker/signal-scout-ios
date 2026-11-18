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

    AsyncFunction("deleteRecord") { (recordName: String, promise: Promise) in
      self.container.publicCloudDatabase.delete(withRecordID: CKRecord.ID(recordName: recordName)) { _, error in
        if let error = error { promise.reject("ERR_CK_DELETE", error.localizedDescription) }
        else { promise.resolve(nil) }
      }
    }
  }
}
