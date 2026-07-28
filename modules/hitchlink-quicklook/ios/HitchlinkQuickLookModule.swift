import ExpoModulesCore
import QuickLook

public class HitchlinkQuickLookModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HitchlinkQuickLook")

    // Lets JS decide between the in-app preview and the share-sheet fallback
    // WITHOUT presenting anything first. Takes a file:// URI.
    Function("canPreview") { (uri: String) -> Bool in
      guard let url = Self.fileURL(from: uri) else { return false }
      return HitchlinkQuickLookPresenter.canPreview(url: url)
    }

    // Resolves once the driver closes the preview; rejects if it couldn't be
    // shown at all, so the caller can fall back rather than leave them staring
    // at nothing.
    AsyncFunction("previewAsync") { (uri: String, promise: Promise) in
      guard let url = Self.fileURL(from: uri) else {
        promise.reject("ERR_BAD_URI", "Expected a local file:// URI, got: \(uri)")
        return
      }
      guard FileManager.default.fileExists(atPath: url.path) else {
        promise.reject("ERR_NO_FILE", "No file at \(url.path)")
        return
      }

      DispatchQueue.main.async {
        guard let presenter = Self.topViewController() else {
          promise.reject("ERR_NO_VIEW_CONTROLLER", "No view controller available to present from.")
          return
        }
        HitchlinkQuickLookPresenter.shared.present(url: url, from: presenter) { error in
          if let error { promise.reject("ERR_PREVIEW_FAILED", error) }
          else { promise.resolve(nil) }
        }
      }
    }
  }

  /// expo-file-system hands back percent-encoded `file:///…` strings, and a
  /// path with a space in it (labels like "Medical Card" become filenames here)
  /// is only a valid URL once decoded — URL(string:) alone returns nil for it.
  private static func fileURL(from uri: String) -> URL? {
    if let url = URL(string: uri), url.isFileURL { return url }
    if uri.hasPrefix("file://") {
      let path = String(uri.dropFirst("file://".count)).removingPercentEncoding ?? String(uri.dropFirst("file://".count))
      return URL(fileURLWithPath: path)
    }
    if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
    return nil
  }

  /// Mirrors expo-modules-core's own currentViewController(): walk down to the
  /// topmost presented controller, but never target one that is mid-dismissal —
  /// presenting into a dismissing controller is exactly the collision that has
  /// bitten this app repeatedly on the JS side.
  private static func topViewController() -> UIViewController? {
    var controller = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }?
      .rootViewController

    while let presented = controller?.presentedViewController, !presented.isBeingDismissed {
      controller = presented
    }
    return controller
  }
}
