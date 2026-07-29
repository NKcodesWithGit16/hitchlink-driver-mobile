import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import { apiFetch, apiUpload, apiFetchRaw, USE_MOCK, BASE } from './client';
import { baseMime, extForMime, isWebSafeImage, photoFilename } from '../lib/imageMime';
import * as mock from '../data/mock';

const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));

// The chat API speaks { fromDriver, time, type, audioUrl, attachments[] };
// the UI bubbles speak { from, at, kind, uri, durationSec }. Bridge the two.
const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function replyKind(type) {
  if (type === 'voice') return 'voice';
  if (type === 'document') return 'document';
  if (type === 'video') return 'video';
  if (type && type !== 'text') return 'image';
  return undefined;
}

function normalizeMessage(m) {
  // One message can carry several attachments — the dispatcher portal bundles a
  // multi-file pick into a single message. Everything below still reads `att`
  // (the first) for the scalar fields a bubble needs, but photos also get the
  // full list as `uris`; this used to stop at attachments[0] and silently drop
  // the rest, so a 4-photo message from dispatch showed the driver one photo.
  const atts = Array.isArray(m.attachments) ? m.attachments : [];
  const att = atts[0] || null;
  const isVoice = m.type === 'voice';
  const isImage = !isVoice && (m.type === 'photo' || ['photo', 'image', 'gif', 'sticker'].includes(att?.kind));
  const isDocument = !isVoice && !isImage && (m.type === 'document' || att?.kind === 'document');
  const isVideo = !isVoice && !isImage && !isDocument && (m.type === 'video' || att?.kind === 'video');
  const isMissedCall = m.type === 'missed_call';
  const deleted = !!m.deletedForEveryone;
  return {
    id: m.id,
    from: m.fromDriver ? 'driver' : 'dispatcher',
    at: fmtTime(m.time),
    ts: m.time,                         // raw timestamp for edit/delete-window checks
    deleted,
    // Read receipt: has the OTHER side's cursor passed this message yet.
    // Only meaningful for messages this driver sent — drives the
    // single-check (sent) vs. double-check (read) indicator.
    read: !!m.read,
    editedAt: m.editedAt ?? undefined,
    text: deleted ? undefined : (m.text ?? undefined),
    kind: deleted ? undefined : (isMissedCall ? 'missed_call' : isVoice ? 'voice' : isImage ? 'image' : isDocument ? 'document' : isVideo ? 'video' : undefined),
    // audioUrl is a relative path on the main API; photo/document/video come back as signed URLs.
    uri: deleted ? undefined : (isVoice ? (m.audioUrl ? `${BASE}${m.audioUrl}` : undefined) : ((isImage || isDocument || isVideo) ? att?.url : undefined)),
    // Every photo in the message, in order. `uri` above stays the first one so
    // the single-photo path (and save-to-docs, reply previews, the viewer) is
    // untouched; bubbles read this to render the rest.
    uris: deleted || !isImage ? undefined : atts.map((a) => a?.url).filter(Boolean),
    // Small companion images for the bubble. Falls back to the full URL per
    // photo, so messages sent before thumbnails existed still render.
    thumbUris: deleted || !isImage ? undefined : atts.map((a) => a?.thumbnailUrl || a?.url).filter(Boolean),
    // Natural pixel size of the first photo, when the sender recorded it. The
    // bubble uses it to reserve the right shape before the image downloads;
    // older messages have nulls here and fall back to measuring the loaded
    // image, so this is an optimization, not a requirement.
    width: deleted ? undefined : (att?.width ?? undefined),
    height: deleted ? undefined : (att?.height ?? undefined),
    thumbnailUri: deleted ? undefined : (isVideo ? att?.thumbnailUrl : undefined),
    filename: deleted ? undefined : (isDocument ? (att?.caption || 'Document') : undefined),
    mimeType: deleted ? undefined : att?.mimeType,
    sizeBytes: deleted ? undefined : att?.sizeBytes,
    durationSec: deleted ? undefined : (m.durationSeconds ?? undefined),
    waveformPeaks: deleted ? undefined : (m.waveformPeaks ?? undefined),
    replyToId: m.replyToMessageId ?? undefined,
    replyTo: m.replyTo ? {
      id: m.replyTo.id,
      from: m.replyTo.fromDriver ? 'driver' : 'dispatcher',
      text: m.replyTo.text ?? undefined,
      kind: replyKind(m.replyTo.type),
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

  // Goes through normalizePhoto (and so statLocalFile) rather than reading the
  // file with `fetch(uri)` as it used to — see the note above statLocalFile:
  // fetching a file:// URI throws on Android, so the avatar upload could never
  // have worked there.
  const { uri: sendUri, sizeBytes, mimeType, blob } = await normalizePhoto(uri);

  const signed = await apiFetch(`/drivers/${driverId}/photo/sign`, {
    method: 'POST',
    body: JSON.stringify({ mimeType, sizeBytes }),
  });

  await putSignedFile(signed.uploadUrl, sendUri, mimeType, blob, 'Profile photo');

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

// `limit` is sent explicitly rather than relying on the server's default (100).
// GET /chat/{driverId} takes the NEWEST `limit` rows and has no cursor/`before`
// parameter, so this is a window on the tail of the thread, not a page: there
// is currently no way to reach anything older than the newest `limit` messages.
// Loading further back needs a cursor added to ChatController.GetHistory.
export async function fetchMessages(driverId, { limit = 100 } = {}) {
  if (USE_MOCK) { await wait(); return mock.messages; }
  if (!driverId) return [];
  const params = new URLSearchParams({ as_: 'driver', actorId: String(driverId), limit: String(limit) });
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

// Advances the driver's read cursor to the latest message currently visible
// to them — the dispatcher's next fetchMessages() then sees `read: true` on
// any of their own sent messages up to that point (WhatsApp-style double
// check). Called whenever the driver has the chat open and fetched history.
export async function markChatRead(driverId, actorId) {
  if (USE_MOCK) return { ok: true };
  if (!driverId) return null;
  return apiFetch(`/chat/${driverId}/read`, {
    method: 'POST',
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

// ─── Direct-to-R2 uploads (chat attachments, load photos) ──────────────────
// Every one of these is sign → PUT the bytes straight to R2 → create the record
// with the returned storage key, so the bytes never pass through Railway.
//
// Reading the picked file is deliberately NOT `fetch(fileUri)`. That works on
// iOS (RCTFileRequestHandler serves file:// URIs) but throws on Android, where
// RN hands the URL to OkHttp, which only accepts http/https — so every chat
// photo and document upload failed there before it made a single network call.
// expo-file-system understands file:// on both platforms, and its `uploadAsync`
// streams the file natively instead of pulling it through JS, which also keeps
// a 40 MB document from being base64'd into memory just to be sent.

/** Size + MIME of a picked local file, for the sign request. */
async function statLocalFile(uri, fallbackMime) {
  if (Platform.OS === 'web') {
    // On web the picker hands back a blob:/data: URL, which fetch resolves.
    const blob = await (await fetch(uri)).blob();
    return { sizeBytes: blob.size, mimeType: blob.type || fallbackMime, blob };
  }
  const file = new File(uri);
  if (!file.exists) throw new Error(`File no longer exists: ${uri}`);
  // The sign endpoint rejects sizeBytes <= 0 with a bare 400 — catch it here so
  // the failure names the actual problem instead of blaming the server.
  if (!(file.size > 0)) throw new Error(`File is empty or unreadable: ${uri}`);
  return { sizeBytes: file.size, mimeType: file.type || fallbackMime, blob: null };
}

/**
 * PUTs a local file to a presigned R2 URL. No auth header — the signed URL
 * carries its own — but the Content-Type must match what was signed, because
 * R2 folds it into the signature.
 */
async function putSignedFile(uploadUrl, uri, mimeType, blob, label, onProgress) {
  if (Platform.OS === 'web') {
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: blob,
    });
    if (!put.ok) throw new Error(`${label} upload failed (${put.status})`);
    onProgress?.(1);
    return;
  }
  const options = {
    httpMethod: 'PUT',
    uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': mimeType },
  };
  // createUploadTask is the only path that reports bytes as they go. Worth the
  // extra branch: a driver on cab LTE sending four photos otherwise stares at a
  // finished-looking bubble for a long time with no sign anything is happening.
  if (onProgress) {
    const task = LegacyFS.createUploadTask(uploadUrl, uri, options, (p) => {
      const total = p?.totalBytesExpectedToSend;
      if (total > 0) onProgress(Math.min(1, p.totalBytesSent / total));
    });
    const res = await task.uploadAsync();
    if (!res || res.status < 200 || res.status >= 300) {
      throw new Error(`${label} upload failed (${res?.status ?? 'no response'})`);
    }
    onProgress(1);
    return;
  }
  const put = await LegacyFS.uploadAsync(uploadUrl, uri, options);
  if (put.status < 200 || put.status >= 300) {
    throw new Error(`${label} upload failed (${put.status})`);
  }
}

// Every photo we upload is eventually rendered in a browser — the dispatcher's
// web chat, the Drivers list avatar, the Completed Loads paperwork gallery — so
// the format the picker happened to hand us is not good enough. iOS returns the
// camera roll's original HEIC, which no mainstream desktop browser can decode,
// and the result was a permanently broken image the dispatcher couldn't even
// rescue by downloading it.
const MAX_PHOTO_EDGE = 2560;
const PHOTO_JPEG_QUALITY = 0.8;

// Measuring an image means decoding it, which is slow on the cheap Android
// phones plenty of drivers carry. A file this small can't be a wasteful camera
// frame, so skip the decode entirely and send it as-is.
const PHOTO_INSPECT_BYTES = 1.5 * 1024 * 1024;

// `expo-image-manipulator` is required lazily, NOT imported at the top of this
// file. This module is pulled in by AuthContext at the root of the tree, and a
// top-level import of a native module throws at boot on any binary that predates
// the dependency — a dev client built before it was added takes down the whole
// app, sign-in screen included, rather than just failing to normalize a photo.
// Deferring it to first use turns that into a per-upload failure the catch below
// already handles. Rebuilding the client is still the actual fix.
function loadImageManipulator() {
  // eslint-disable-next-line global-require
  const mod = require('expo-image-manipulator');
  return { ImageManipulator: mod.ImageManipulator, SaveFormat: mod.SaveFormat };
}

/**
 * Resolves a picked image to something a browser is guaranteed to render,
 * transcoding to JPEG when the format isn't web-safe and downscaling frames
 * larger than MAX_PHOTO_EDGE. Returns the same shape as statLocalFile plus the
 * (possibly rewritten) uri, ready for putSignedFile.
 */
async function normalizePhoto(uri) {
  const stat = await statLocalFile(uri, 'image/jpeg');
  const mimeType = baseMime(stat.mimeType);
  const webSafe = isWebSafeImage(mimeType);
  const original = { uri, mimeType, sizeBytes: stat.sizeBytes, blob: stat.blob };

  if (webSafe && stat.sizeBytes <= PHOTO_INSPECT_BYTES) return original;

  try {
    const { ImageManipulator, SaveFormat } = loadImageManipulator();
    const ctx = ImageManipulator.manipulate(uri);
    let rendered = await ctx.renderAsync();
    const longEdge = Math.max(rendered.width, rendered.height);

    if (longEdge > MAX_PHOTO_EDGE) {
      // Constrain the long edge and let the module derive the other side, so
      // the aspect ratio survives regardless of orientation.
      ctx.resize(rendered.width >= rendered.height
        ? { width: MAX_PHOTO_EDGE }
        : { height: MAX_PHOTO_EDGE });
      rendered = await ctx.renderAsync();
    } else if (webSafe) {
      // A big file, but the pixels are already modest and the format renders
      // fine — re-encoding would only throw away quality for nothing.
      return original;
    }

    const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_JPEG_QUALITY });
    // Re-stat rather than reusing the original size: the sign endpoint 400s when
    // sizeBytes doesn't match the bytes we actually PUT.
    const outStat = await statLocalFile(out.uri, 'image/jpeg');
    return {
      uri: out.uri,
      mimeType: 'image/jpeg',
      sizeBytes: outStat.sizeBytes,
      blob: outStat.blob,
      // Post-resize dimensions — the chat bubble sizes itself from these, so
      // they have to describe the bytes actually uploaded.
      width: rendered.width,
      height: rendered.height,
    };
  } catch (err) {
    // Only the downscale failed and the format was already fine — send the
    // original rather than blocking the driver over an optimization.
    if (webSafe) return original;
    // Otherwise these bytes would land in chat as a broken image nobody can
    // open. Failing here marks the bubble failed and names the format in the
    // log, which beats a silent upload the dispatcher discovers hours later.
    // The cause is carried through so a missing native module reads as exactly
    // that rather than as an unsupported format.
    throw new Error(`This photo is in a format we can't send (${mimeType || 'unknown'}): ${err?.message || err}`);
  }
}

// Normalizes, signs and PUTs one photo, returning the attachment ref the
// message endpoint wants. Split out so a batch can run these concurrently.
// Chat bubbles show a photo about 260pt wide. Downloading a 2560px original to
// fill that is why photos took seconds to appear in the thread, so a small
// companion image goes up alongside and the bubble reads that instead; the full
// one is only fetched when the viewer opens. MessageAttachment.ThumbnailKey and
// the API's `thumbnailUrl` already existed for videos — this reuses both.
const PHOTO_THUMB_EDGE = 480;
const PHOTO_THUMB_QUALITY = 0.7;

async function uploadPhotoThumbnail(driverId, uri) {
  try {
    const { ImageManipulator, SaveFormat } = loadImageManipulator();
    const ctx = ImageManipulator.manipulate(uri);
    let rendered = await ctx.renderAsync();
    if (Math.max(rendered.width, rendered.height) > PHOTO_THUMB_EDGE) {
      ctx.resize(rendered.width >= rendered.height
        ? { width: PHOTO_THUMB_EDGE }
        : { height: PHOTO_THUMB_EDGE });
      rendered = await ctx.renderAsync();
    }
    const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_THUMB_QUALITY });
    const stat = await statLocalFile(out.uri, 'image/jpeg');

    const signed = await apiFetch(`/chat/${driverId}/attachments/sign`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'photo', mimeType: 'image/jpeg', sizeBytes: stat.sizeBytes }),
    });
    await putSignedFile(signed.uploadUrl, out.uri, 'image/jpeg', stat.blob, 'Thumbnail');
    return signed.storageKey;
  } catch (err) {
    // A thumbnail is an optimization. Losing it costs a slower bubble, not the
    // message — never fail a send over it.
    console.warn('[Chat] Thumbnail generation failed, sending without one:', err?.message || err);
    return null;
  }
}

async function uploadPhotoAttachment(driverId, photo, onProgress) {
  const { uri, width: pickedW, height: pickedH } = typeof photo === 'string' ? { uri: photo } : photo;
  const norm = await normalizePhoto(uri);
  const { uri: sendUri, sizeBytes, mimeType, blob } = norm;

  const signed = await apiFetch(`/chat/${driverId}/attachments/sign`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'photo', mimeType, sizeBytes }),
  });

  await putSignedFile(signed.uploadUrl, sendUri, mimeType, blob, 'Photo', onProgress);

  // After the full image, so progress still reaches 100% on the thing the
  // driver is actually waiting for.
  const thumbnailKey = await uploadPhotoThumbnail(driverId, sendUri);

  return {
    storageKey: signed.storageKey,
    thumbnailKey,
    kind: 'photo',
    mimeType,
    sizeBytes,
    filename: photoFilename(mimeType),
    // Sent so the receiving bubble can size itself before the image downloads.
    // normalizePhoto's dimensions win when it re-encoded; otherwise the picker's
    // are still accurate because the bytes went up untouched.
    width: norm.width ?? pickedW ?? null,
    height: norm.height ?? pickedH ?? null,
  };
}

/**
 * Sends several photos as ONE message, the way the dispatcher portal already
 * does — `attachments` is a list server-side, so N photos in one bubble needs
 * no backend change. Uploads run concurrently; if any one fails the whole send
 * fails rather than posting a partial album, because a silently-missing photo
 * is worse than a bubble the driver can retry.
 */
export async function sendPhotosMessage(driverId, { uris, text = null, replyToMessageId = null, onProgress } = {}) {
  if (USE_MOCK) { await wait(200); return { ok: true }; }
  const list = (uris || []).filter(Boolean);
  if (!driverId || list.length === 0) return null;

  // Progress is the mean across the batch, so one bar covers the whole album
  // rather than the last photo's bar overwriting the others'.
  const shares = new Array(list.length).fill(0);
  const report = onProgress
    ? (i) => (fraction) => {
      shares[i] = fraction;
      onProgress(shares.reduce((a, b) => a + b, 0) / list.length);
    }
    : () => undefined;

  const attachments = await Promise.all(
    list.map((photo, i) => uploadPhotoAttachment(driverId, photo, report(i))),
  );

  return apiFetch(`/chat/${driverId}/message`, {
    method: 'POST',
    body: JSON.stringify({
      text,
      senderId: driverId,
      senderRole: 'driver',
      replyToMessageId,
      attachments,
    }),
  });
}

// Single-photo send. Kept as its own entry point because the proof-of-delivery
// capture on the load screen sends exactly one and reads better this way.
export async function sendPhotoMessage(driverId, { uri, text = null, replyToMessageId = null } = {}) {
  if (USE_MOCK) { await wait(200); return { ok: true }; }
  if (!driverId || !uri) return null;
  return sendPhotosMessage(driverId, { uris: [uri], text, replyToMessageId });
}

// Sends a document into the dispatcher chat from the driver's device. Same
// flow as sendPhotoMessage — not the base64-to-/documents flow uploadDocument()
// uses, which targets the separate load-paperwork feature.
export async function sendDocumentMessage(driverId, { uri, name, mimeType, replyToMessageId = null } = {}) {
  if (USE_MOCK) { await wait(200); return { ok: true }; }
  if (!driverId || !uri) return null;

  // The picker's own mimeType wins here: it comes from the provider that
  // actually owns the file, whereas ours is guessed from the extension.
  const stat = await statLocalFile(uri, 'application/octet-stream');
  const finalMime = mimeType || stat.mimeType || 'application/octet-stream';

  const signed = await apiFetch(`/chat/${driverId}/attachments/sign`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'document', mimeType: finalMime, sizeBytes: stat.sizeBytes }),
  });

  await putSignedFile(signed.uploadUrl, uri, finalMime, stat.blob, 'Document');

  return apiFetch(`/chat/${driverId}/message`, {
    method: 'POST',
    body: JSON.stringify({
      text: null,
      senderId: driverId,
      senderRole: 'driver',
      replyToMessageId,
      attachments: [{
        storageKey: signed.storageKey,
        kind: 'document',
        mimeType: finalMime,
        sizeBytes: stat.sizeBytes,
        filename: name || 'document',
      }],
    }),
  });
}

// ─── Opening a downloaded file on the device ───────────────────────────────
// iOS works out what a file IS from its extension, which it resolves to a UTI.
// Both download paths below used to write the cache file under whatever name
// the record carried — and that is often a human label like "CDL" rather than
// a filename, so the file landed extensionless. With no extension iOS can't
// resolve a type, the share sheet offers nothing useful, and no PDF viewer
// appears as a target at all. Android's content:// handoff behaves the same.
//
// expo-sharing's `mimeType` option is Android-only (see its SharingOptions
// type); iOS reads `UTI`. Passing only mimeType, as both callers did, means iOS
// got no type hint whatsoever on top of the missing extension.

const MIME_UTI = {
  'application/pdf': 'com.adobe.pdf',
  'image/jpeg': 'public.jpeg',
  'image/png': 'public.png',
  'image/heic': 'public.heic',
  'image/gif': 'com.compuserve.gif',
  'text/plain': 'public.plain-text',
  'text/csv': 'public.comma-separated-values-text',
  'application/msword': 'com.microsoft.word.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'org.openxmlformats.wordprocessingml.document',
  'application/vnd.ms-excel': 'com.microsoft.excel.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'org.openxmlformats.spreadsheetml.sheet',
  'video/mp4': 'public.mpeg-4',
  'video/quicktime': 'com.apple.quicktime-movie',
};

/** iOS Uniform Type Identifier for a Content-Type, for Sharing.shareAsync. */
export const utiForContentType = (ct) => MIME_UTI[baseMime(ct)] || null;

// A cache filename has to survive being a path segment, and carry the right
// extension for the OS to type it. Labels legitimately contain spaces and
// slashes ("Medical Card", "Insurance / COI"), neither of which belongs here.
function cacheFileName(name, contentType) {
  const cleaned = (name || 'file')
    .replace(/[/\\:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'file';

  const ext = extForMime(contentType);
  if (!ext) return cleaned;
  return cleaned.toLowerCase().endsWith(`.${ext}`) ? cleaned : `${cleaned}.${ext}`;
}

// Required lazily for the same reason as expo-image-manipulator above: this
// module is pulled in by AuthContext at the root of the tree, so a top-level
// import of a native module takes the whole app down at boot on a binary that
// predates the dependency.
function loadMediaLibrary() {
  // eslint-disable-next-line global-require
  return require('expo-media-library');
}

/**
 * Saves a chat photo into the phone's camera roll.
 *
 * Returns 'saved' | 'denied'; throws only on a real failure. A refused
 * permission is a normal outcome the caller should explain (with a route to
 * Settings), not an error to surface as "something went wrong".
 */
export async function saveToPhotoLibrary(url, fileName = 'photo.jpg') {
  if (USE_MOCK) { await wait(200); return 'saved'; }
  if (Platform.OS === 'web') throw new Error('Saving to the photo library is a native-only action');

  const MediaLibrary = loadMediaLibrary();
  // writeOnly: the app only ever adds photos — asking for full library read
  // access would prompt for far more than we need.
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) return 'denied';

  // Reuses the same download path as sharing, so the file lands in the cache
  // with a correct extension — the library rejects a file it can't type.
  const file = await downloadChatAttachment(url, fileName);
  if (!file?.uri) throw new Error('Photo download returned nothing');
  await MediaLibrary.saveToLibraryAsync(file.uri);
  return 'saved';
}

// Downloads a chat attachment (document/video) for local viewing/sharing.
// Unlike /documents/{id}/content, attachment URLs from /chat/{driverId}
// history are already-presigned R2 GET URLs — auth is baked into the query
// string, so a plain fetch (no Bearer header) is enough. Native: writes to
// the cache dir and returns a local file:// uri (for Sharing.shareAsync).
// Web: returns an object URL.
export async function downloadChatAttachment(url, fileName = 'file') {
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream';

  if (Platform.OS === 'web') {
    const blob = await res.blob();
    return { uri: URL.createObjectURL(blob), contentType, fileName, uti: null };
  }
  const named = cacheFileName(fileName, contentType);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const dest = new File(Paths.cache, named);
  if (dest.exists) dest.delete();
  dest.create();
  dest.write(bytes);
  return { uri: dest.uri, contentType, fileName: named, uti: utiForContentType(contentType) };
}

// Stores a proof-of-delivery photo against the load itself — the permanent
// record the dispatcher's Completed Loads history reads from. Same flow as
// sendPhotoMessage, but against POST /loads/{id}/photos instead of the chat
// thread. Captured at delivery on the load screen.
export async function uploadLoadPhoto(loadId, { uri, caption = 'Delivery paperwork' } = {}) {
  if (USE_MOCK) { await wait(200); return { ok: true }; }
  if (!loadId || !uri) return null;

  const { uri: sendUri, sizeBytes, mimeType, blob } = await normalizePhoto(uri);

  const signed = await apiFetch(`/loads/${loadId}/photos/sign`, {
    method: 'POST',
    body: JSON.stringify({ mimeType, sizeBytes }),
  });

  await putSignedFile(signed.uploadUrl, sendUri, mimeType, blob, 'Load photo');

  return apiFetch(`/loads/${loadId}/photos`, {
    method: 'POST',
    body: JSON.stringify({
      uploadedByRole: 'driver',
      photos: [{
        storageKey: signed.storageKey,
        mimeType,
        sizeBytes,
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

// The backend's DocumentDto carries type/label/documentNumber/expiresAt but no
// icon or filter-friendly sub-text; the mock fixtures carry label/sub/number/icon
// directly. Bridge the two so DocCard/DocViewer can render either shape the same way.
export const DOC_TYPE_META = {
  License:      { icon: 'credit-card', label: "Driver's License",   sub: 'CDL' },
  MedicalCard:  { icon: 'activity',    label: 'Medical Certificate', sub: 'DOT Medical Card' },
  Insurance:    { icon: 'shield',      label: 'Insurance Card',      sub: 'Insurance' },
  Registration: { icon: 'truck',       label: 'Truck Registration',  sub: 'Registration' },
  Inspection:   { icon: 'clipboard',   label: 'Inspection Report',   sub: 'Inspection' },
  Other:        { icon: 'file-text',   label: 'Document',            sub: 'Other' },
};

function normalizeDocument(d) {
  const meta = DOC_TYPE_META[d.type] || DOC_TYPE_META.Other;
  return {
    ...d,
    label: d.label || meta.label,
    sub: d.notes || meta.sub,
    number: d.documentNumber || '—',
    expires: d.expiresAt ? d.expiresAt.slice(0, 10) : null,
    icon: meta.icon,
  };
}

export async function fetchDocuments(driverId) {
  if (USE_MOCK) { await wait(); return mock.documents; }
  const data = await apiFetch(`/documents?driverId=${driverId}`);
  return Array.isArray(data) ? data.map(normalizeDocument) : [];
}

// expo-document-picker only hands back a base64 payload on web (as a
// "data:<mime>;base64,<data>" URI); strip the prefix so both platforms send
// the same raw base64 string.
const stripDataUriPrefix = (b64) => (b64?.startsWith('data:') ? b64.slice(b64.indexOf(',') + 1) : b64);

// Reads a picked file into raw base64 once, so callers (AI extraction + the
// final upload) can share a single file read instead of re-reading per call.
// On web the picker normally supplies the base64 itself; when it doesn't — a
// chat attachment being filed into Documents arrives as a downloaded blob URL,
// with no picker involved — fall back to reading the URI.
export async function readDocumentBase64(uri, base64) {
  if (Platform.OS !== 'web') return await new File(uri).base64();
  if (base64) return stripDataUriPrefix(base64);
  const blob = await (await fetch(uri)).blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(stripDataUriPrefix(String(reader.result)));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(blob);
  });
}

// Adds a real document file (PDF, scan, etc. — not just a photo) picked via
// expo-document-picker. Sent as base64 JSON straight to POST /documents,
// matching the backend's UploadDocumentCommand contract (Kestrel's request
// body limit is raised specifically for this).
export async function uploadDocument(driverId, { uri, name, mimeType, sizeBytes, type = 'Other', base64, notes, expiresAt, label, documentNumber } = {}) {
  if (USE_MOCK) { await wait(300); return { id: String(Date.now()), fileName: name, contentType: mimeType, sizeBytes, type, expiresAt, label, documentNumber }; }
  if (!driverId || !uri) return null;

  const contentBase64 = await readDocumentBase64(uri, base64);

  return apiFetch('/documents', {
    method: 'POST',
    body: JSON.stringify({
      type,
      contentBase64,
      fileName: name,
      contentType: mimeType,
      sizeBytes,
      driverId,
      uploadedById: driverId,
      notes,
      expiresAt,
      label,
      documentNumber,
    }),
  });
}

export async function deleteDocument(documentId) {
  if (USE_MOCK) { await wait(150); return { ok: true }; }
  return apiFetch(`/documents/${documentId}`, { method: 'DELETE', allow404: true });
}

// Downloads a document's file bytes for viewing. Native: writes to the cache
// dir and returns a local file:// uri (for <Image> or Sharing.shareAsync). Web:
// returns an object URL. No real file storage exists in mock mode, so mock
// callers get null and the caller falls back to a "can't preview" message.
export async function fetchDocumentContent(documentId, fileName = 'document') {
  if (USE_MOCK) return null;
  const res = await apiFetchRaw(`/documents/${documentId}/content`);
  if (!res.ok) throw new Error(`API ${res.status} — /documents/${documentId}/content`);
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream';

  if (Platform.OS === 'web') {
    const blob = await res.blob();
    // `uri` (not `blobUrl`) — the Documents screen read `result.blobUrl` while
    // this returned `blobUrl` only here and `uri` everywhere else, so the web
    // viewer was calling window.open(undefined).
    return { uri: URL.createObjectURL(blob), contentType, fileName, uti: null };
  }
  const named = cacheFileName(fileName, contentType);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const dest = new File(Paths.cache, named);
  if (dest.exists) dest.delete();
  dest.create();
  dest.write(bytes);
  return { uri: dest.uri, contentType, fileName: named, uti: utiForContentType(contentType) };
}

// Reads a freshly-picked image via Claude Haiku vision (server-side — see
// POST /ai/extract-document) and returns editable type/label/number/expiry
// fields for the add-document review step. Metered server-side against a
// tight monthly quota, so failures (429/502/503) are expected and non-fatal —
// callers should fall back to a blank, manually-filled form.
export async function extractDocumentFields({ base64, mediaType } = {}) {
  if (USE_MOCK) { await wait(600); return null; }
  if (!base64) return null;
  return apiFetch('/ai/extract-document', {
    method: 'POST',
    body: JSON.stringify({ imageBase64: base64, mediaType }),
  });
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

// Separate from the regular Expo push token above — this is the APNs VoIP
// token (from PKPushRegistry via expo-callkit-telecom), which lets an
// incoming call ring through CallKit even while the phone is locked.
export async function registerVoipPushToken(driverId, voipPushToken) {
  if (USE_MOCK) return { ok: true };
  return apiFetch(`/drivers/${driverId}/voip-push-token`, {
    method: 'PATCH',
    body: JSON.stringify({ voipPushToken }),
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
