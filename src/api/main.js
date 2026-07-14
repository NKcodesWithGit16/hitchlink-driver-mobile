import { Platform } from 'react-native';
import { apiFetch, apiUpload, USE_MOCK, BASE } from './client';
import * as mock from '../data/mock';

const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));

// The chat API speaks { fromDriver, time, type, audioUrl, attachments[] };
// the UI bubbles speak { from, at, kind, uri, durationSec }. Bridge the two.
const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function normalizeMessage(m) {
  const att = Array.isArray(m.attachments) ? m.attachments[0] : null;
  const isVoice = m.type === 'voice';
  const isImage = !isVoice && (m.type === 'photo' || ['photo', 'image', 'gif', 'sticker'].includes(att?.kind));
  const deleted = !!m.deletedForEveryone;
  return {
    id: m.id,
    from: m.fromDriver ? 'driver' : 'dispatcher',
    at: fmtTime(m.time),
    ts: m.time,                         // raw timestamp for edit/delete-window checks
    deleted,
    editedAt: m.editedAt ?? undefined,
    text: deleted ? undefined : (m.text ?? undefined),
    kind: deleted ? undefined : (isVoice ? 'voice' : isImage ? 'image' : undefined),
    // audioUrl is a relative path on the main API; images come back as signed URLs.
    uri: deleted ? undefined : (isVoice ? (m.audioUrl ? `${BASE}${m.audioUrl}` : undefined) : (isImage ? att?.url : undefined)),
    durationSec: deleted ? undefined : (m.durationSeconds ?? undefined),
    replyToId: m.replyToMessageId ?? undefined,
    replyTo: m.replyTo ? {
      id: m.replyTo.id,
      from: m.replyTo.fromDriver ? 'driver' : 'dispatcher',
      text: m.replyTo.text ?? undefined,
      kind: m.replyTo.type === 'voice' ? 'voice' : (m.replyTo.type && m.replyTo.type !== 'text' ? 'image' : undefined),
    } : undefined,
    reactions: Array.isArray(m.reactions)
      ? m.reactions.map((r) => ({ emoji: r.emoji, count: r.count, mine: (r.reactors || []).some((x) => x.role === 'driver') }))
      : [],
  };
}

export async function fetchDriver(driverId) {
  if (USE_MOCK) { await wait(); return mock.driver; }
  const data = await apiFetch(`/drivers/${driverId}`);
  return data ?? null;
}

// Driver-editable profile fields — everything else (truck, dispatcher, status)
// is dispatcher-managed and not exposed on this form.
export async function updateDriver(driverId, { firstName, lastName, phoneNumber, email }) {
  if (USE_MOCK) { await wait(300); return { ...mock.driver, firstName, lastName, phoneNumber, email }; }
  return apiFetch(`/drivers/${driverId}`, {
    method: 'PUT',
    body: JSON.stringify({ firstName, lastName, phoneNumber, email }),
  });
}

// Same three-step flow as uploadLoadPhoto (sign → PUT the bytes straight to
// R2 → save the storage key), just against the driver's single photo slot
// instead of a load's photo gallery. Returns { photoUrl }.
export async function uploadDriverPhoto(driverId, uri) {
  if (USE_MOCK) { await wait(300); return { photoUrl: uri }; }
  if (!driverId || !uri) return null;

  const blob = await (await fetch(uri)).blob();
  const mimeType = blob.type || 'image/jpeg';

  const signed = await apiFetch(`/drivers/${driverId}/photo/sign`, {
    method: 'POST',
    body: JSON.stringify({ mimeType, sizeBytes: blob.size }),
  });

  const put = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });
  if (!put.ok) throw new Error(`Profile photo upload failed (${put.status})`);

  return apiFetch(`/drivers/${driverId}/photo`, {
    method: 'PATCH',
    body: JSON.stringify({ storageKey: signed.storageKey }),
  });
}

export async function removeDriverPhoto(driverId) {
  if (USE_MOCK) { await wait(200); return null; }
  return apiFetch(`/drivers/${driverId}/photo`, { method: 'DELETE' });
}

// The driver's completed-load history — terminal-state loads (Delivered /
// Closed / Cancelled), newest first, each with its proof-of-delivery photos
// resolved inline. Empty history is a normal state, not an error.
export async function fetchLoadHistory(driverId) {
  if (USE_MOCK) { await wait(); return mock.loadHistory; }
  if (!driverId) return [];
  const data = await apiFetch(`/loads/driver/${driverId}/history`, { allow404: true });
  return Array.isArray(data) ? data : [];
}

export async function fetchActiveLoad(driverId) {
  if (USE_MOCK) { await wait(); return mock.activeLoad; }
  if (!driverId) return null; // not signed in yet — don't hit /loads/driver/undefined
  // A 404 here means "no active load assigned to this driver", which is a
  // normal empty state, not a connection error.
  const data = await apiFetch(`/loads/driver/${driverId}`, { allow404: true });
  return data ?? null;
}

export async function updateLoadStatus(loadId, status) {
  if (USE_MOCK) { await wait(150); return { ok: true, status }; }
  return apiFetch(`/loads/${loadId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// Driver "take-back" of a mistaken tap — rolls the load back to an earlier
// active state. The backend enforces the guards (own load, still in progress,
// earlier step, within a short window); a 4xx here means it's too late to undo
// and the driver should ask dispatch to correct it.
export async function undoLoadStatus(loadId, driverId, toStatus) {
  if (USE_MOCK) { await wait(150); return { ok: true, status: toStatus }; }
  return apiFetch(`/loads/${loadId}/undo-status`, {
    method: 'PATCH',
    body: JSON.stringify({ driverId, toStatus }),
  });
}

export async function acceptLoad(loadId, driverId) {
  if (USE_MOCK) { await wait(150); return { ok: true }; }
  return apiFetch(`/loads/${loadId}/accept`, { method: 'POST', body: JSON.stringify({ driverId }) });
}

export async function declineLoad(loadId, driverId, reason) {
  if (USE_MOCK) { await wait(150); return { ok: true }; }
  return apiFetch(`/loads/${loadId}/decline`, { method: 'POST', body: JSON.stringify({ driverId, reason: reason ?? null }) });
}

export async function fetchMessages(driverId) {
  if (USE_MOCK) { await wait(); return mock.messages; }
  if (!driverId) return [];
  const params = new URLSearchParams({ as_: 'driver', actorId: String(driverId) });
  const data = await apiFetch(`/chat/${driverId}?${params}`, { allow404: true });
  return Array.isArray(data) ? data.map(normalizeMessage) : [];
}

export async function sendMessage(driverId, text, replyToMessageId = null) {
  if (USE_MOCK) { await wait(120); return { ok: true }; }
  return apiFetch(`/chat/${driverId}`, {
    method: 'POST',
    body: JSON.stringify({ message: text, senderId: driverId, senderRole: 'driver', replyToMessageId }),
  });
}

// Edit own text message (backend enforces a 15-minute window + sender check).
export async function editMessage(messageId, text, actorId) {
  if (USE_MOCK) { await wait(120); return { ok: true }; }
  return apiFetch(`/chat/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ text, actorRole: 'driver', actorId }),
  });
}

// Delete for everyone (backend enforces a 1-hour window + sender check).
export async function deleteMessage(messageId, actorId, scope = 'everyone') {
  if (USE_MOCK) { await wait(120); return { ok: true }; }
  return apiFetch(`/chat/messages/${messageId}`, {
    method: 'DELETE',
    body: JSON.stringify({ scope, actorRole: 'driver', actorId }),
  });
}

// Set/replace this driver's reaction on a message (one reaction per person).
export async function reactToMessage(messageId, emoji, actorId) {
  if (USE_MOCK) { await wait(80); return { ok: true }; }
  return apiFetch(`/chat/messages/${messageId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji, actorRole: 'driver', actorId }),
  });
}

export async function removeReaction(messageId, actorId) {
  if (USE_MOCK) { await wait(80); return { ok: true }; }
  return apiFetch(`/chat/messages/${messageId}/reactions`, {
    method: 'DELETE',
    body: JSON.stringify({ actorRole: 'driver', actorId }),
  });
}

const mimeToExt = (mime) => ({
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a',
  'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
}[(mime || '').split(';')[0].trim().toLowerCase()]);

const extToMime = (uri) => ({
  m4a: 'audio/m4a', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg',
  wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm',
}[(uri.split('?')[0].split('.').pop() || '').toLowerCase()] || 'audio/m4a');

// Uploads a recorded clip to POST /chat/{driverId}/voice (multipart). The
// dispatcher receives it via the hub broadcast the controller fires on save.
export async function sendVoiceMessage(driverId, { uri, durationSec, waveformPeaks, replyToMessageId } = {}) {
  if (USE_MOCK) { await wait(150); return { ok: true }; }
  if (!driverId || !uri) return null;

  const form = new FormData();
  if (Platform.OS === 'web') {
    // expo-audio hands back a blob: URL on web — fetch it into a real Blob.
    const blob = await (await fetch(uri)).blob();
    form.append('audio', blob, `voice.${mimeToExt(blob.type) || 'webm'}`);
  } else {
    const type = extToMime(uri);
    form.append('audio', { uri, name: `voice.${mimeToExt(type) || 'm4a'}`, type });
  }
  form.append('fromDriver', 'true');
  if (durationSec) form.append('durationSeconds', String(durationSec));
  if (waveformPeaks) form.append('waveformPeaks', waveformPeaks);
  if (replyToMessageId) form.append('replyToMessageId', replyToMessageId);

  return apiUpload(`/chat/${driverId}/voice`, form);
}

// Sends a photo into the dispatcher chat. Three steps, mirroring the
// dispatcher web app's attachment flow: sign → PUT the bytes straight to R2
// → create the message with the storage key. Used by the Messages attach
// button and the proof-of-delivery capture on the load screen.
export async function sendPhotoMessage(driverId, { uri, text = null, replyToMessageId = null } = {}) {
  if (USE_MOCK) { await wait(200); return { ok: true }; }
  if (!driverId || !uri) return null;

  // RN's fetch reads the picker's file:// URI into a Blob; on web the picker
  // hands back a blob:/data: URL which resolves the same way.
  const blob = await (await fetch(uri)).blob();
  const mimeType = blob.type || 'image/jpeg';

  const signed = await apiFetch(`/chat/${driverId}/attachments/sign`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'photo', mimeType, sizeBytes: blob.size }),
  });

  // Bare fetch — the signed URL carries its own auth, and the Content-Type
  // must match what was signed (R2 folds it into the signature).
  const put = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });
  if (!put.ok) throw new Error(`Photo upload failed (${put.status})`);

  return apiFetch(`/chat/${driverId}/message`, {
    method: 'POST',
    body: JSON.stringify({
      text,
      senderId: driverId,
      senderRole: 'driver',
      replyToMessageId,
      attachments: [{
        storageKey: signed.storageKey,
        kind: 'photo',
        mimeType,
        sizeBytes: blob.size,
        filename: 'photo.jpg',
      }],
    }),
  });
}

// Stores a proof-of-delivery photo against the load itself — the permanent
// record the dispatcher's Completed Loads history reads from. Same three-step
// flow as sendPhotoMessage (sign → PUT the bytes straight to R2 → create the
// record with the storage key), but against POST /loads/{id}/photos instead of
// the chat thread. Captured at delivery on the load screen.
export async function uploadLoadPhoto(loadId, { uri, caption = 'Delivery paperwork' } = {}) {
  if (USE_MOCK) { await wait(200); return { ok: true }; }
  if (!loadId || !uri) return null;

  const blob = await (await fetch(uri)).blob();
  const mimeType = blob.type || 'image/jpeg';

  const signed = await apiFetch(`/loads/${loadId}/photos/sign`, {
    method: 'POST',
    body: JSON.stringify({ mimeType, sizeBytes: blob.size }),
  });

  // Bare fetch — the signed URL carries its own auth, and the Content-Type must
  // match what was signed (R2 folds it into the signature).
  const put = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });
  if (!put.ok) throw new Error(`Load photo upload failed (${put.status})`);

  return apiFetch(`/loads/${loadId}/photos`, {
    method: 'POST',
    body: JSON.stringify({
      uploadedByRole: 'driver',
      photos: [{
        storageKey: signed.storageKey,
        mimeType,
        sizeBytes: blob.size,
        caption,
      }],
    }),
  });
}

export async function fetchEarnings(driverId) {
  if (USE_MOCK) { await wait(); return mock.earnings; }
  // Real endpoint: GET /drivers/{id}/earnings (settlements aggregated into the
  // week/month + recent-loads shape). Falls back to mock if the backend hasn't
  // been redeployed with this endpoint yet, so the screen never sits empty.
  try {
    const data = await apiFetch(`/drivers/${driverId}/earnings`);
    return data ?? mock.earnings;
  } catch {
    return mock.earnings;
  }
}

export async function fetchDocuments(driverId) {
  if (USE_MOCK) { await wait(); return mock.documents; }
  const data = await apiFetch(`/documents?driverId=${driverId}`);
  return data ?? [];
}

export async function fetchHos(driverId) {
  if (USE_MOCK) { await wait(120); return mock.hos; }
  // Real endpoint: GET /drivers/{id}/hos (federal-limit defaults until an ELD /
  // the app reports clocks via PATCH). Falls back to mock until redeployed.
  try {
    const data = await apiFetch(`/drivers/${driverId}/hos`);
    return data ?? mock.hos;
  } catch {
    return mock.hos;
  }
}

export async function updateHos(driverId, clocks) {
  if (USE_MOCK) { await wait(120); return { ok: true }; }
  return apiFetch(`/drivers/${driverId}/hos`, {
    method: 'PATCH',
    body: JSON.stringify(clocks),
  });
}

// Reports the driver's live GPS fix. The backend stores it as the driver's
// current position, evaluates moving/stopped status, auto-advances the active
// load through pickup/delivery geofences, recomputes the ETA, and broadcasts
// DriverLocationUpdated to the dispatcher's live map. The response carries
// nextHeartbeatSeconds — the server-suggested delay before the next beat
// (faster while moving, slower while parked).
export async function sendHeartbeat(driverId, { lat, lng, speedKph }) {
  if (USE_MOCK) { return { nextHeartbeatSeconds: 60 }; }
  return apiFetch(`/drivers/${driverId}/heartbeat`, {
    method: 'POST',
    body: JSON.stringify({ lat, lng, speedKph }),
  });
}

export async function registerPushToken(driverId, pushToken) {
  if (USE_MOCK) return { ok: true };
  return apiFetch(`/drivers/${driverId}/push-token`, {
    method: 'PATCH',
    body: JSON.stringify({ pushToken }),
  });
}

// ── Notifications ────────────────────────────────────────────────────
// The backend speaks { id, title, message, type, isRead, createdAt }; the
// Alerts UI speaks { id, category, tone, icon, critical, title, body,
// minutesAgo, read, action }. Map the type string onto the UI's visual
// language. The backend currently emits load / driver / success / warning /
// error; the map also covers domain-ish strings (document, hos, earnings,
// weather) so richer server-side tagging drops in without a UI change.
const NOTIF_TYPE_MAP = {
  load:     { category: 'load',     tone: 'teal',    icon: 'truck',          route: '/(tabs)',           actionLabel: 'View load' },
  driver:   { category: 'load',     tone: 'teal',    icon: 'user',           route: '/(tabs)',           actionLabel: 'View' },
  document: { category: 'document', tone: 'caution', icon: 'file-text',      route: '/(tabs)/documents', actionLabel: 'View documents' },
  hos:      { category: 'hos',      tone: 'caution', icon: 'clock',          route: null,                actionLabel: null },
  earnings: { category: 'earnings', tone: 'go',      icon: 'dollar-sign',    route: '/(tabs)/earnings',  actionLabel: 'See breakdown' },
  weather:  { category: 'weather',  tone: 'caution', icon: 'cloud',          route: null,                actionLabel: null },
  success:  { category: 'load',     tone: 'go',      icon: 'check-circle',   route: '/(tabs)',           actionLabel: 'View' },
  warning:  { category: 'load',     tone: 'caution', icon: 'alert-triangle', route: '/(tabs)',           actionLabel: 'View' },
  error:    { category: 'load',     tone: 'danger',  icon: 'alert-triangle', route: '/(tabs)',           actionLabel: 'View' },
};
const NOTIF_FALLBACK = { category: 'load', tone: 'teal', icon: 'bell', route: null, actionLabel: null };

// .NET serializes DateTime.UtcNow; if the string carries no timezone, read it
// as UTC rather than letting JS assume the device's local zone.
function notifMinutesAgo(iso) {
  if (!iso) return 0;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  const ms = new Date(hasTz ? iso : `${iso}Z`).getTime();
  return isNaN(ms) ? 0 : Math.max(0, Math.round((Date.now() - ms) / 60000));
}

function normalizeNotification(n) {
  const key = (n.type || '').toLowerCase();
  const m = NOTIF_TYPE_MAP[key] || NOTIF_FALLBACK;
  return {
    id: n.id,
    category: m.category,
    tone: m.tone,
    icon: m.icon,
    critical: key === 'error',
    title: n.title ?? '',
    body: n.message ?? '',
    minutesAgo: notifMinutesAgo(n.createdAt),
    read: !!n.isRead,
    action: m.actionLabel ? { label: m.actionLabel, route: m.route } : undefined,
  };
}

export async function fetchNotifications(userId) {
  if (USE_MOCK) { await wait(); return mock.notifications; }
  if (!userId) return [];
  // A 404 / empty inbox is a normal empty state, not a connection error.
  const data = await apiFetch(`/notifications?userId=${userId}`, { allow404: true });
  return Array.isArray(data) ? data.map(normalizeNotification) : [];
}

export async function markNotificationRead(id) {
  if (USE_MOCK) { await wait(80); return { ok: true }; }
  return apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
}

// Soft-deletes the notification on the backend (IsActive = false). There is no
// un-delete endpoint, so callers that offer Undo must defer this until the
// undo window closes rather than delete first and try to restore.
export async function dismissNotification(id) {
  if (USE_MOCK) { await wait(80); return { ok: true }; }
  return apiFetch(`/notifications/${id}`, { method: 'DELETE' });
}
