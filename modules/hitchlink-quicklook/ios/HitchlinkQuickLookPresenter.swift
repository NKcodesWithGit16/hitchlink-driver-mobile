import QuickLook
import UIKit

// Owns the QLPreviewController and the file it's showing.
//
// QLPreviewController takes its item from a DATA SOURCE it queries lazily, and
// it does not retain that data source — so the object handing it the URL has to
// outlive the presentation. Hence the shared singleton rather than a local
// object: a per-call instance would be deallocated the moment the presenting
// function returned, and the preview would come up blank.
//
// The delegate callback is what lets JS know the driver dismissed the preview,
// so a promise on the other side can resolve instead of hanging forever.
final class HitchlinkQuickLookPresenter: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
  static let shared = HitchlinkQuickLookPresenter()

  private var fileURL: URL?
  private var onDismiss: (() -> Void)?
  private var isPresenting = false

  /// True when QuickLook can actually render the file — checked before
  /// presenting so the caller can fall back to the share sheet rather than
  /// showing the driver an empty preview.
  static func canPreview(url: URL) -> Bool {
    QLPreviewController.canPreview(url as QLPreviewItem)
  }

  /// Presents the system preview over whatever is currently on screen.
  /// `completion` fires with an error string, or nil once the driver closes it.
  func present(url: URL, from viewController: UIViewController, completion: @escaping (String?) -> Void) {
    if isPresenting {
      completion("A document preview is already open.")
      return
    }
    guard Self.canPreview(url: url) else {
      completion("QuickLook cannot preview this file type.")
      return
    }

    fileURL = url
    onDismiss = { completion(nil) }
    isPresenting = true

    let controller = QLPreviewController()
    controller.dataSource = self
    controller.delegate = self
    // Modal rather than pushed: this module has no navigation stack of its own,
    // and the driver expects a Done button, not a back chevron.
    controller.modalPresentationStyle = .fullScreen
    viewController.present(controller, animated: true)
  }

  // MARK: - QLPreviewControllerDataSource

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
    fileURL == nil ? 0 : 1
  }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    fileURL! as QLPreviewItem
  }

  // MARK: - QLPreviewControllerDelegate

  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    isPresenting = false
    fileURL = nil
    let callback = onDismiss
    onDismiss = nil
    callback?()
  }
}
