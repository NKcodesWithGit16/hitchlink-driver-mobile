import ExpoModulesCore

// Registers for VoIP push at app launch — before JS runs — so a terminated
// app still gets woken by PushKit when a call comes in. Nothing else needs
// to happen here: RNCallKeep.reportNewIncomingCall (called from
// HitchlinkVoipPushDelegate.m when a push actually arrives) initializes its
// own CXProvider lazily, so there's no CallKeep "setup" step to pre-warm.
public class HitchlinkVoipAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    HitchlinkVoipPushDelegate.shared.register()
    return true
  }
}
