import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { fetchDocuments, fetchDocumentContent, fetchDocumentThumbnail } from '../api/main';
import { expiryStatus, daysUntil } from './format';

/* Offline copies of the driver's documents.
 *
 * WHY THIS EXISTS. The Documents tab told drivers "Documents are cached offline
 * — accessible at weigh stations with no signal" and nothing was cached at all:
 * the list was fetched on every tab open and kept in component state, and
 * opening a document downloaded it on the spot. At a weigh station with no
 * signal the driver got an error box. That is the one moment the tab exists
 * for, so the promise had to become true rather than be deleted.
 *
 * WHERE THE FILES GO. Under `Paths.document`, NOT `Paths.cache`. The cache
 * directory is explicitly "a place to store files that can be deleted by the
 * system when the device runs low on storage" — a phone that drops a CDL to
 * free space the night before an inspection is worse than no caching at all,
 * because by then the driver believes it works. The old download path used
 * Paths.cache AND deleted any existing copy before re-downloading.
 *
 * ONE DIRECTORY PER DOCUMENT (`documents/<docId>/<human name>`). Lookup is by
 * id through the manifest, so it never depends on a display filename that the
 * dispatcher can change — but the file on disk keeps its human name, because
 * that name is what the share sheet and QuickLook show. A flat directory would
 * force one or the other: two documents both called "license.jpg" would collide.
 *
 * KEYED BY DRIVER, like lib/hiddenLoads.js and for the same reason — a shared
 * cab phone must never serve one driver's credentials to the next. clearAll()
 * runs on sign-out alongside cancelAllLocalReminders().
 *
 * The pure half (shouldAutoCache / isStale / evictionPlan / sortDocuments) is
 * deliberately separate from the storage half so the policy is unit-testable
 * without mocking a filesystem — the same split hiddenLoads.js uses.
 */

const LIST_KEY     = (driverId) => `hl_docs_${driverId || 'anon'}`;
const MANIFEST_KEY = (driverId) => `hl_doc_files_${driverId || 'anon'}`;

const idOf = (x) => (x == null ? '' : String(x));

/* ─────────── Policy (pure) ─────────── */

/* The documents an officer actually asks for. These are cached automatically
   whatever their size, and are never evicted to free space. */
export const CREDENTIAL_TYPES = ['License', 'MedicalCard', 'Insurance', 'Registration', 'Inspection'];

/* The order a DOT inspection asks for them in — also the display order. */
const CREDENTIAL_ORDER = { License: 0, MedicalCard: 1, Insurance: 2, Registration: 3, Inspection: 4 };

/* Anything else caches automatically only if it's small. A driver on a metered
   plan should not silently pull a 40 MB scan of last year's paperwork. */
export const AUTO_CACHE_SIZE_CAP = 8 * 1024 * 1024;    // 8 MB
export const CACHE_BUDGET_BYTES  = 200 * 1024 * 1024;  // 200 MB total

export const isCredential = (doc) => CREDENTIAL_TYPES.includes(doc?.type);

/** Should this document be downloaded ahead of time, without being asked for? */
export function shouldAutoCache(doc, { sizeCapBytes = AUTO_CACHE_SIZE_CAP } = {}) {
  if (!doc?.id) return false;
  // Url-only documents (an external link, no bytes in the database) have
  // nothing to download — /content would 404.
  if (!doc.hasContent) return false;
  if (isCredential(doc)) return true;
  const size = Number(doc.sizeBytes);
  // Unknown size is not "under the cap": don't guess with someone's data plan.
  if (!isFinite(size) || size <= 0) return false;
  return size <= sizeCapBytes;
}

/** Has the server's copy moved on from the one on disk? */
export function isStale(doc, entry) {
  if (!entry?.path) return true;
  // Nothing to compare against — keep what we have rather than re-downloading
  // every document on every visit.
  if (!doc?.lastModifiedAt) return false;
  return entry.lastModifiedAt !== doc.lastModifiedAt;
}

/**
 * Which cached documents to drop, given the driver's current list.
 * Orphans first (the document was deleted server-side), then least-recently
 * opened until the total is back under budget. Credentials are never dropped.
 */
export function evictionPlan(manifest, docs, budgetBytes = CACHE_BUDGET_BYTES) {
  const byId = new Map((docs || []).map((d) => [idOf(d.id), d]));
  const drop = [];
  const keep = [];

  for (const [id, entry] of Object.entries(manifest || {})) {
    if (byId.has(id)) keep.push([id, entry]);
    else drop.push(id);
  }

  let total = keep.reduce((sum, [, e]) => sum + (Number(e.sizeBytes) || 0), 0);
  if (total <= budgetBytes) return drop;

  const evictable = keep
    .filter(([id]) => !isCredential(byId.get(id)))
    .sort((a, b) => (a[1].openedAt || a[1].cachedAt || 0) - (b[1].openedAt || b[1].cachedAt || 0));

  for (const [id, entry] of evictable) {
    if (total <= budgetBytes) break;
    drop.push(id);
    total -= Number(entry.sizeBytes) || 0;
  }
  return drop;
}

/**
 * Display order. The list used to be newest-uploaded first, which is the one
 * ordering that matches nothing a driver needs: what's lapsed, what's about to,
 * and then the credentials in the order they get asked for at a scale.
 */
export function sortDocuments(docs) {
  const rank = (d) => {
    const key = expiryStatus(d?.expires).key;
    return key === 'expired' ? 0 : key === 'expiring' ? 1 : 2;
  };
  return [...(docs || [])].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    // Inside the two problem buckets, soonest deadline first.
    if (ra < 2) {
      const da = daysUntil(a?.expires);
      const db = daysUntil(b?.expires);
      if (da != null && db != null && da !== db) return da - db;
    }
    const ca = CREDENTIAL_ORDER[a?.type] ?? 99;
    const cb = CREDENTIAL_ORDER[b?.type] ?? 99;
    if (ca !== cb) return ca - cb;
    return new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0);
  });
}

/* ─────────── Filesystem (native only) ─────────── */

// expo-file-system's Paths are native-only; on web every call below no-ops and
// the screen simply behaves as it did before (network-only). The list cache
// above still works there, since AsyncStorage does.
const fsReady = () => Platform.OS !== 'web';

function rootDir() {
  const dir = new Directory(Paths.document, 'documents');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function docDir(docId, { create = false } = {}) {
  const dir = new Directory(rootDir(), idOf(docId));
  if (create && !dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function thumbsDir() {
  const dir = new Directory(rootDir(), 'thumbs');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/* ─────────── Manifest ─────────── */

async function readManifest(driverId) {
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_KEY(driverId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeManifest(driverId, manifest) {
  try {
    await AsyncStorage.setItem(MANIFEST_KEY(driverId), JSON.stringify(manifest));
  } catch {
    // A failed manifest write costs a re-download, not correctness.
  }
}

/* ─────────── The document list ─────────── */

/**
 * The driver's documents, network-first with the last good response as a
 * fallback. Returns { docs, fromCache, savedAt } — the screen shows a "saved
 * copy" banner on fromCache rather than the old all-or-nothing error box, and
 * only reports a hard failure when there is nothing stored either.
 */
export async function loadDocuments(driverId) {
  try {
    const docs = await fetchDocuments(driverId);
    const savedAt = Date.now();
    try {
      await AsyncStorage.setItem(LIST_KEY(driverId), JSON.stringify({ savedAt, docs }));
    } catch {
      // Out of storage — still return the live docs.
    }
    return { docs, fromCache: false, savedAt };
  } catch (err) {
    const cached = await readCachedList(driverId);
    if (!cached) throw err;
    return { docs: cached.docs, fromCache: true, savedAt: cached.savedAt };
  }
}

export async function readCachedList(driverId) {
  try {
    const raw = await AsyncStorage.getItem(LIST_KEY(driverId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.docs) ? parsed : null;
  } catch {
    return null;
  }
}

/* ─────────── Document files ─────────── */

/**
 * The on-disk copy of a document, or null. Records the access so eviction can
 * drop the ones a driver never opens.
 */
export async function cachedFileFor(driverId, docId) {
  if (!fsReady()) return null;
  const manifest = await readManifest(driverId);
  const entry = manifest[idOf(docId)];
  if (!entry?.path) return null;

  try {
    const file = new File(entry.path);
    if (!file.exists) {
      // Deleted underneath us (a restore, a cleaner app). Forget it so the
      // next read re-downloads instead of handing back a dead uri.
      delete manifest[idOf(docId)];
      await writeManifest(driverId, manifest);
      return null;
    }
  } catch {
    return null;
  }

  manifest[idOf(docId)] = { ...entry, openedAt: Date.now() };
  await writeManifest(driverId, manifest);
  return { uri: entry.path, contentType: entry.contentType, fileName: entry.name, uti: entry.uti || null };
}

/**
 * Downloads a document into its own directory and records it. Returns the same
 * shape as fetchDocumentContent so callers can use either interchangeably.
 */
export async function saveFile(driverId, doc) {
  if (!fsReady()) return null;
  const id = idOf(doc?.id);
  if (!id) return null;

  const dir = docDir(id, { create: true });
  // One document per directory, so a re-download replaces its own file rather
  // than accumulating renamed copies.
  try {
    for (const child of dir.list()) child.delete();
  } catch {
    // Empty or unreadable — the write below is what matters.
  }

  const result = await fetchDocumentContent(id, doc.fileName || doc.label, { directory: dir });
  if (!result) return null;

  let sizeBytes = Number(doc.sizeBytes) || 0;
  try {
    const size = new File(result.uri).size;
    if (size) sizeBytes = size;
  } catch {
    // Fall back to the reported size.
  }

  const manifest = await readManifest(driverId);
  manifest[id] = {
    path: result.uri,
    name: result.fileName,
    contentType: result.contentType,
    uti: result.uti || null,
    sizeBytes,
    lastModifiedAt: doc.lastModifiedAt || null,
    cachedAt: Date.now(),
    openedAt: Date.now(),
  };
  await writeManifest(driverId, manifest);
  return result;
}

/** Cached copy if it's current, otherwise download and record one. */
export async function ensureCached(driverId, doc) {
  if (!fsReady()) return null;
  const manifest = await readManifest(driverId);
  const entry = manifest[idOf(doc?.id)];
  if (!isStale(doc, entry)) {
    const hit = await cachedFileFor(driverId, doc.id);
    if (hit) return hit;
  }
  return saveFile(driverId, doc);
}

/** Ids the driver can open with no signal. Drives the card's offline dot. */
export async function cachedIds(driverId) {
  if (!fsReady()) return new Set();
  const manifest = await readManifest(driverId);
  return new Set(Object.keys(manifest));
}

/**
 * Brings the offline copies in line with the current list: caches whatever
 * policy says should be there, then evicts orphans and anything over budget.
 * Runs in the background after a successful fetch — every failure is ignored,
 * because this is an optimization and must never surface as an error.
 */
export async function syncOfflineCopies(driverId, docs, { onChange } = {}) {
  if (!fsReady() || !driverId) return;

  const manifest = await readManifest(driverId);
  for (const doc of docs || []) {
    if (!shouldAutoCache(doc)) continue;
    if (!isStale(doc, manifest[idOf(doc.id)])) continue;
    try {
      await saveFile(driverId, doc);
      onChange?.();
    } catch {
      // Offline, or this one document is unreachable. Move on.
    }
  }

  try {
    const current = await readManifest(driverId);
    const drop = evictionPlan(current, docs);
    if (drop.length) {
      for (const id of drop) {
        try { const dir = docDir(id); if (dir.exists) dir.delete(); } catch {}
        // Its preview goes too — otherwise a driver who churns through
        // documents accumulates thumbnails for files that no longer exist.
        try { const thumb = new File(thumbsDir(), `${id}.jpg`); if (thumb.exists) thumb.delete(); } catch {}
        delete current[id];
      }
      await writeManifest(driverId, current);
      onChange?.();
    }
  } catch {
    // Eviction is housekeeping; failing it just leaves files on disk.
  }
}

/** Wipes every offline copy for a driver. Called on sign-out. */
export async function clearAll(driverId) {
  try {
    await AsyncStorage.multiRemove([LIST_KEY(driverId), MANIFEST_KEY(driverId)]);
  } catch {}
  if (!fsReady()) {
    for (const url of webThumbs.values()) { try { URL.revokeObjectURL(url); } catch {} }
    webThumbs.clear();
    return;
  }
  try {
    const root = rootDir();
    if (root.exists) root.delete();
  } catch {}
}

/* ─────────── Thumbnails ─────────── */

// Web has no filesystem here, so its thumbnails live as object URLs for the
// lifetime of the page. Native ones are written next to the documents and
// survive a restart like everything else in this directory.
const webThumbs = new Map();

/** Local uri of an already-cached thumbnail, or null. Never hits the network. */
export function cachedThumb(docId) {
  if (!fsReady()) return webThumbs.get(idOf(docId)) || null;
  try {
    const file = new File(thumbsDir(), `${idOf(docId)}.jpg`);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/**
 * A renderable uri for a document's preview, downloading it once if needed.
 * Returns null when the document has no thumbnail (PDFs, anything uploaded
 * before thumbnails existed) — the card falls back to its file-type icon.
 */
export async function ensureThumb(docId) {
  const id = idOf(docId);
  if (!id) return null;

  const hit = cachedThumb(id);
  if (hit) return hit;

  const bytes = await fetchDocumentThumbnail(id);
  if (!bytes || !bytes.length) return null;

  if (!fsReady()) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    webThumbs.set(id, url);
    return url;
  }
  try {
    const file = new File(thumbsDir(), `${id}.jpg`);
    if (file.exists) file.delete();
    file.create({ intermediates: true, overwrite: true });
    file.write(bytes);
    return file.uri;
  } catch {
    return null;
  }
}
