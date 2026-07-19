import Foundation

// Shared state between the Expo Module (JS-facing) and the plain
// Objective-C PushKit delegate (HitchlinkVoipPushDelegate.m), which needs to
// import RNCallKeep.h directly and so is written in Objective-C rather than
// Swift (see that file's header comment). This class is `@objc` so the ObjC
// side can call into it via this pod's auto-generated -Swift.h header —
// that's a same-pod bridge, which always works, unlike importing a
// *different* pod's Objective-C headers from Swift, whose module-map status
// this app's build isn't guaranteed to have enabled.
@objc(HitchlinkVoipCoordinator)
public class HitchlinkVoipCoordinator: NSObject {
  @objc public static let shared = HitchlinkVoipCoordinator()

  private var metadataByUUID: [String: [String: Any]] = [:]
  private let lock = NSLock()

  @objc public private(set) var token: String?

  // Set by HitchlinkVoipModule so native code can emit the JS event without
  // holding a hard reference to the module (which Expo owns the lifecycle of).
  var onTokenUpdated: ((String?) -> Void)?

  private override init() {
    super.init()
  }

  @objc public func updateToken(_ newToken: String?) {
    guard token != newToken else { return }
    token = newToken
    let callback = onTokenUpdated
    DispatchQueue.main.async {
      callback?(newToken)
    }
  }

  @objc public func putMetadata(_ metadata: [String: Any], forUUID uuid: String) {
    lock.lock()
    metadataByUUID[uuid] = metadata
    lock.unlock()
  }

  @objc public func takeMetadata(forUUID uuid: String) -> [String: Any]? {
    lock.lock()
    defer { lock.unlock() }
    return metadataByUUID.removeValue(forKey: uuid)
  }
}
