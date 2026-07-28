import AsyncStorage from '@react-native-async-storage/async-storage';

/* Loads the driver has removed from their own Pay-tab history.
 *
 * This is a DEVICE-LOCAL view preference, not a delete. A delivered load is a
 * financial record — it still exists for the dispatcher, for billing and for
 * settlements, and the earnings figures above the history list (which the
 * backend computes) are deliberately unaffected. All that changes is which
 * cards this driver sees on this phone.
 *
 * (The backend's DELETE /loads/{id} is a global soft-delete that would pull the
 * load out of everyone's records, so it is intentionally NOT used here.)
 *
 * Storage is keyed by driver so a shared cab phone never applies one driver's
 * hidden list to another's history. Each entry keeps a small snapshot of the
 * load (route, date, pay) so the "Hidden loads" restore screen still renders
 * with no signal, but the snapshot is only a fallback — live history wins.
 *
 * REMOVALS GO PERMANENT AFTER THREE WEEKS. Until then an entry is restorable
 * and appears on the Hidden-loads screen. Past the window it is compacted down
 * to a bare {id, hiddenAt} tombstone: the load stays hidden forever, the
 * snapshot is wiped off the device, and it is no longer offered for restore.
 * The tombstone has to survive — dropping the id outright would un-hide the
 * load on the next fetch, which is the opposite of a permanent delete.
 *
 * Should this ever become a server-side per-driver flag, only the read/write
 * pair below has to change; every caller works in terms of these functions.
 */

const KEY = (driverId) => `hl_hidden_loads_${driverId || 'anon'}`;

/* How long a removed load can still be brought back. */
export const RESTORE_WINDOW_MS = 21 * 24 * 60 * 60 * 1000; // 3 weeks

// Guids arrive as strings from the API but mock fixtures use numbers — compare
// and store one canonical form so a hidden load doesn't reappear on the next
// fetch because '7' !== 7.
const idOf = (x) => (x == null ? '' : String(x));

/* Pure: is this entry still inside its restore window? A missing hiddenAt
   (hand-edited or pre-window storage) counts as expired — fail closed, so a
   load the driver deleted never quietly resurfaces as restorable. */
export function isRestorable(entry, now = Date.now()) {
  return !!entry?.hiddenAt && now - entry.hiddenAt < RESTORE_WINDOW_MS;
}

/* Pure: whole days left in the restore window, floored at 0. Drives the
   "restorable for N more days" line on the Hidden-loads screen. */
export function daysLeft(entry, now = Date.now()) {
  if (!entry?.hiddenAt) return 0;
  return Math.max(0, Math.ceil((entry.hiddenAt + RESTORE_WINDOW_MS - now) / 86400000));
}

/* Pure: strip expired entries down to tombstones. Returns the same array
   reference when nothing changed, so read() can skip a pointless write. */
export function compact(list, now = Date.now()) {
  let changed = false;
  const out = list.map((e) => {
    if (isRestorable(e, now)) return e;
    if (Object.keys(e).length <= 2) return e;   // already a bare tombstone
    changed = true;
    return { id: e.id, hiddenAt: e.hiddenAt };
  });
  return changed ? out : list;
}

async function read(driverId) {
  let list;
  try {
    const raw = await AsyncStorage.getItem(KEY(driverId));
    const parsed = raw ? JSON.parse(raw) : [];
    list = Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
  // Enforce the window on every read — there's no background job, and the app
  // may sit closed for months. Whatever the driver looks at is already correct.
  const compacted = compact(list);
  if (compacted !== list) await write(driverId, compacted);
  return compacted;
}

async function write(driverId, list) {
  try { await AsyncStorage.setItem(KEY(driverId), JSON.stringify(list)); } catch {}
}

/* Restorable entries only, newest-hidden first — what the restore screen
   lists. Expired tombstones are hidden from the driver, not restorable. */
export async function getHidden(driverId) {
  const list = await read(driverId);
  return list.filter((e) => isRestorable(e)).sort((a, b) => (b.hiddenAt || 0) - (a.hiddenAt || 0));
}

/* EVERY hidden id, tombstones included — what the history list filters
   against, so a permanently-removed load stays gone. */
export async function getHiddenIds(driverId) {
  return new Set((await read(driverId)).map((e) => e.id));
}

/* Both in one read: the filter set and how many are still restorable. The Pay
   tab needs the two together and shouldn't hit storage twice for them. */
export async function getHiddenState(driverId) {
  const list = await read(driverId);
  return {
    ids: new Set(list.map((e) => e.id)),
    restorable: list.filter((e) => isRestorable(e)).length,
  };
}

export async function hideLoad(driverId, load) {
  const id = idOf(load?.id);
  if (!id) return;
  const list = await read(driverId);
  if (list.some((e) => e.id === id)) return; // already hidden — keep the original timestamp
  list.push({
    id,
    hiddenAt: Date.now(),
    // snapshot for offline rendering of the restore list
    origin: load.origin, destination: load.destination,
    completedAt: load.completedAt, rate: load.rate, miles: load.miles,
    status: load.status,
  });
  await write(driverId, list);
}

/* Bring one load back. A tombstone is past its window and can't be restored —
   guarded here as well as in the UI, so no caller can undo a permanent delete. */
export async function unhideLoad(driverId, loadId) {
  const id = idOf(loadId);
  const list = await read(driverId);
  const entry = list.find((e) => e.id === id);
  if (!entry || !isRestorable(entry)) return false;
  await write(driverId, list.filter((e) => e.id !== id));
  return true;
}

/* "Restore all" — everything still inside its window. Tombstones stay put. */
export async function clearHidden(driverId) {
  const list = await read(driverId);
  await write(driverId, list.filter((e) => !isRestorable(e)));
}

/* Pure: split a history list into what the driver sees and what they removed.
   The hidden side is live history rows, not the stored snapshots, so callers
   that do arithmetic on it (src/lib/earningsAdjust.js) work from the same
   numbers the visible cards do. */
export function partitionHidden(history, hiddenIds) {
  if (!Array.isArray(history)) return { visible: [], hidden: [] };
  if (!hiddenIds || hiddenIds.size === 0) return { visible: history, hidden: [] };
  const visible = [], hidden = [];
  for (const l of history) (hiddenIds.has(idOf(l?.id)) ? hidden : visible).push(l);
  return { visible, hidden };
}

/* Pure: drop hidden loads from a history list. Kept separate from storage so
   the filtering rule is unit-testable without AsyncStorage. */
export function filterHidden(history, hiddenIds) {
  return partitionHidden(history, hiddenIds).visible;
}

/* Pure: the inverse — the hidden entries, refreshed from live history where
   the load is still in the payload, falling back to the stored snapshot for
   anything history no longer returns (or when there's no signal). */
export function hydrateHidden(entries, history) {
  const byId = new Map((Array.isArray(history) ? history : []).map((l) => [idOf(l?.id), l]));
  return (entries || []).map((e) => ({ ...e, ...(byId.get(e.id) || {}), id: e.id, hiddenAt: e.hiddenAt }));
}
