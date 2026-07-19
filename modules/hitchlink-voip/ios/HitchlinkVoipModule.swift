import ExpoModulesCore

public class HitchlinkVoipModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HitchlinkVoip")

    Events("onVoipPushTokenUpdated")

    OnCreate { [weak self] in
      HitchlinkVoipCoordinator.shared.onTokenUpdated = { [weak self] token in
        self?.sendEvent("onVoipPushTokenUpdated", ["token": token as Any])
      }
    }

    Function("registerVoipPush") {
      HitchlinkVoipPushDelegate.shared.register()
    }

    Function("getVoipPushToken") { () -> String? in
      HitchlinkVoipCoordinator.shared.token
    }

    Function("getPendingCallMetadata") { (uuid: String) -> [String: Any]? in
      HitchlinkVoipCoordinator.shared.takeMetadata(forUUID: uuid)
    }
  }
}
