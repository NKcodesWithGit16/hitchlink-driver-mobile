// MIME lookups shared by the upload and download halves of src/api/main.js.
//
// The upload side exists because of a real bug: an iPhone photo picked out of
// the library comes back as HEIC, we uploaded it verbatim, and the dispatcher's
// web chat rendered a dead <img> — Chrome, Edge and Firefox can't decode HEIC.
// Screenshots (PNG) worked, which is what made it look intermittent. Anything
// leaving this app for a browser has to be in a format a browser actually
// renders, so `isWebSafeImage` is the gate and JPEG is the fallback.

const MIME_EXT = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/** Strips any `;charset=…` parameter and case-normalizes a Content-Type. */
export const baseMime = (ct) => (ct || '').split(';')[0].trim().toLowerCase();

/** File extension for a Content-Type, or null when we don't know one. */
export const extForMime = (ct) => MIME_EXT[baseMime(ct)] || null;

// Broad file family for a Content-Type, for anything that has to *show* what a
// file is rather than decide what to do with it. `ext` is the uppercased
// extension shown on a document card ("PDF", "JPG") — deliberately untranslated,
// same treatment as the app's other compact abbreviations.
//
// Feather has no distinct glyph per office format, so the specific ones come
// from MaterialCommunityIcons; `family` is passed straight to <Icon>.
export function fileKind(ct) {
  const mime = baseMime(ct);
  const ext = extForMime(mime);
  const label = ext ? ext.toUpperCase() : null;

  if (mime.startsWith('image/')) return { key: 'image', icon: 'file-image', family: 'material-community', ext: label };
  if (mime === 'application/pdf') return { key: 'pdf', icon: 'file-pdf-box', family: 'material-community', ext: label };
  if (mime === 'application/msword' || mime.includes('wordprocessingml'))
    return { key: 'word', icon: 'file-word-box', family: 'material-community', ext: label };
  if (mime === 'application/vnd.ms-excel' || mime.includes('spreadsheetml'))
    return { key: 'sheet', icon: 'file-excel-box', family: 'material-community', ext: label };
  if (mime.startsWith('text/')) return { key: 'text', icon: 'file-document-outline', family: 'material-community', ext: label };
  return { key: 'other', icon: 'file-outline', family: 'material-community', ext: label };
}

// What every browser a dispatcher might be running will decode. AVIF is
// deliberately absent: current Chrome handles it, but this list is about what
// is *safe*, not what *usually* works, and a photo that fails to render is
// invisible rather than merely ugly.
const WEB_SAFE_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const isWebSafeImage = (ct) => WEB_SAFE_IMAGE_MIMES.has(baseMime(ct));

// Photos are sent without a real filename — the picker doesn't give us one and
// the dispatcher only ever sees it as a download name. It still has to carry an
// honest extension: this used to be hardcoded to "photo.jpg", so a HEIC arrived
// named .jpg and Windows Photos refused to open it, which is why the dispatcher
// couldn't rescue the image by downloading it either.
export const photoFilename = (ct) => `photo.${extForMime(ct) || 'jpg'}`;
