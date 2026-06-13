import * as Haptics from 'expo-haptics';

/* One place for "how the app feels". Call by intent, never by primitive, so
   the same kind of action always feels the same across the app. Every call is
   fire-and-forget and swallows errors (web / unsupported devices). */

const safe = (fn) => { try { fn(); } catch {} };

export const haptics = {
  // light tick — selection within a control (chips, segmented, tabs, swatches)
  tap:     () => safe(() => Haptics.selectionAsync()),
  // a deliberate button press (secondary actions)
  press:   () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  // a heavier, physical moment (start recording, open a takeover)
  impact:  () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  // something good landed (delivered, synced, saved)
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  // heads-up, not an error (offline, doc expiring, weather ahead)
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  // something failed (send failed, wrong password)
  error:   () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

export default haptics;
