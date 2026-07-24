// Local (on-device) notifications for the two things the app already knows are
// coming but never told the driver about:
//
//   1. The HOS 30-minute break. `hos.breakInMinutes` was rendered on the More
//      tab and nowhere else — a driver only learned a break was due if they
//      happened to open that screen mid-shift.
//   2. Credential expiry. expiryStatus() has always computed "expires in N
//      days" for the CDL, medical card, insurance and registration, but it only
//      surfaced on the Documents tab. Rolling up to a scale with an expired
//      medical card is a DOT violation the phone could simply have warned about.
//
// These are LOCAL notifications, not pushes: they're scheduled on the device
// from data the app already holds, so they fire with no backend involvement and
// work with no signal — which is exactly when a driver is most likely to be
// out of range and least likely to open the app.
//
// Loaded defensively like the other native-backed modules: on web, or a build
// without expo-notifications linked, every export no-ops.

import { Platform } from 'react-native';
import { daysUntil } from './format';

let Notifications = null;
try {
  Notifications = require('expo-notifications');
} catch {
  Notifications = null;
}

const available = () => !!Notifications && Platform.OS !== 'web';

// Identifiers are stable and derived, so re-scheduling replaces the previous
// reminder instead of stacking duplicates every time a screen refetches.
const HOS_BREAK_ID = 'hl-hos-break';
const DOC_PREFIX = 'hl-doc-expiry:';

// Warn this far ahead of the break becoming due — long enough to actually find
// somewhere legal to stop a 70-foot vehicle, which is the whole point.
const BREAK_LEAD_MINUTES = 20;

// Credential reminders fire at these day marks before expiry. 30 gives time to
// book a DOT physical; 7 and 1 are the "this is now urgent" nudges.
const DOC_LEAD_DAYS = [30, 7, 1];

/**
 * Ensures we're allowed to post notifications. Returns false when the driver
 * declined — callers should treat that as "skip", never as an error.
 */
async function ensurePermission() {
  if (!available()) return false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.status === 'granted';
  } catch {
    return false;
  }
}

async function cancel(identifier) {
  try { await Notifications.cancelScheduledNotificationAsync(identifier); } catch {}
}

/**
 * Schedules the "break due soon" reminder from the driver's live HOS clocks.
 * Safe to call on every HOS refetch — it always cancels the previous one first,
 * so the reminder tracks the latest clock rather than piling up.
 *
 * @param {{ breakInMinutes: number }} hos
 * @param {{ title: string, body: string }} copy already-translated strings
 */
export async function scheduleHosBreakReminder(hos, copy) {
  if (!(await ensurePermission())) return false;
  await cancel(HOS_BREAK_ID);

  const mins = Number(hos?.breakInMinutes);
  if (!isFinite(mins)) return false;

  const fireInMinutes = mins - BREAK_LEAD_MINUTES;
  // Already inside the lead window (or overdue) — a notification scheduled in
  // the past either fires instantly or is dropped, and neither is useful. The
  // on-screen HOS pill is already red in this range.
  if (fireInMinutes <= 0) return false;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: HOS_BREAK_ID,
      content: {
        title: copy.title,
        body: copy.body,
        data: { type: 'hos' },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.round(fireInMinutes * 60),
        repeats: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Schedules expiry reminders for every document that has an expiry date.
 * Re-scheduled wholesale on each documents refetch: previously-scheduled ids
 * are cancelled first so a renewed (or deleted) document stops nagging.
 *
 * @param {Array<{id, label, expires}>} docs
 * @param {(doc, days) => {title: string, body: string}} makeCopy translator
 */
export async function scheduleDocumentExpiryReminders(docs, makeCopy) {
  if (!(await ensurePermission())) return 0;

  // Clear every reminder this module owns before re-scheduling, so a document
  // that was renewed or removed doesn't keep firing from a stale schedule.
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => String(n.identifier || '').startsWith(DOC_PREFIX))
        .map((n) => cancel(n.identifier)),
    );
  } catch {}

  const list = Array.isArray(docs) ? docs : [];
  let scheduledCount = 0;

  for (const doc of list) {
    if (!doc?.expires || !doc?.id) continue;
    const days = daysUntil(doc.expires);
    if (days == null || days <= 0) continue; // already expired — the UI shouts about it

    for (const lead of DOC_LEAD_DAYS) {
      const fireInDays = days - lead;
      if (fireInDays <= 0) continue; // that mark has already passed
      const copy = makeCopy(doc, lead);
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: `${DOC_PREFIX}${doc.id}:${lead}`,
          content: {
            title: copy.title,
            body: copy.body,
            data: { type: 'document', documentId: doc.id },
            sound: false, // informational — never wake a sleeping driver for this
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: Math.round(fireInDays * 24 * 60 * 60),
            repeats: false,
          },
        });
        scheduledCount += 1;
      } catch {}
    }
  }

  return scheduledCount;
}

/** Drops every reminder this module owns. Call on sign-out. */
export async function cancelAllLocalReminders() {
  if (!available()) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => {
          const id = String(n.identifier || '');
          return id === HOS_BREAK_ID || id.startsWith(DOC_PREFIX);
        })
        .map((n) => cancel(n.identifier)),
    );
  } catch {}
}
