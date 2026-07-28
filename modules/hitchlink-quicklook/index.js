// Thin JS surface over the native HitchlinkQuickLook module (see ios/).
//
// QuickLook is the system document viewer — the same one Files and Mail use —
// so a PDF, scan or Office doc renders in place with pinch-zoom and a Done
// button, instead of being exported through the share sheet and read in some
// other app. iOS only: the module isn't built for Android, and every export
// below degrades to "not available" there so callers fall back to sharing.
import { Platform } from 'react-native';

let NativeModule = null;
try {
  if (Platform.OS === 'ios') {
    // Resolved lazily and defensively, exactly like modules/hitchlink-voip:
    // Expo Go and any build without this module linked must no-op rather than
    // crash the Documents tab.
    const { requireNativeModule } = require('expo-modules-core');
    NativeModule = requireNativeModule('HitchlinkQuickLook');
  }
} catch {
  NativeModule = null;
}

/** True when the in-app viewer is usable at all on this build/platform. */
export function isQuickLookAvailable() {
  return !!NativeModule;
}

/**
 * Whether QuickLook can render this particular file. Checked before presenting
 * so an unsupported type falls back to the share sheet instead of opening an
 * empty preview.
 * @param {string} uri local file:// URI
 */
export function canPreview(uri) {
  if (!NativeModule || !uri) return false;
  try { return !!NativeModule.canPreview(uri); } catch { return false; }
}

/**
 * Opens the system preview. Resolves once the driver closes it; rejects if it
 * couldn't be presented, which the caller should treat as "fall back to
 * Sharing.shareAsync" rather than as an error worth showing.
 * @param {string} uri local file:// URI
 */
export function previewAsync(uri) {
  if (!NativeModule) return Promise.reject(new Error('QuickLook is not available on this platform.'));
  return NativeModule.previewAsync(uri);
}
