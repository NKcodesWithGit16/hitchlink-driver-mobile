import { baseMime, extForMime, isWebSafeImage, photoFilename } from '../src/lib/imageMime';

describe('baseMime', () => {
  test('strips parameters and normalizes case', () => {
    expect(baseMime('image/JPEG; charset=binary')).toBe('image/jpeg');
    expect(baseMime('  Image/Png  ')).toBe('image/png');
  });
  test('missing input collapses to empty rather than throwing', () => {
    expect(baseMime(null)).toBe('');
    expect(baseMime(undefined)).toBe('');
    expect(baseMime('')).toBe('');
  });
});

describe('isWebSafeImage', () => {
  test('accepts the formats every dispatcher browser decodes', () => {
    expect(isWebSafeImage('image/jpeg')).toBe(true);
    expect(isWebSafeImage('image/png')).toBe(true);
    expect(isWebSafeImage('image/webp')).toBe(true);
    expect(isWebSafeImage('image/gif')).toBe(true);
  });

  // The whole reason this module exists: an iPhone camera photo picked from the
  // library uploads as HEIC and renders as a dead <img> in the web chat.
  test('rejects HEIC/HEIF — the format that caused the broken chat photos', () => {
    expect(isWebSafeImage('image/heic')).toBe(false);
    expect(isWebSafeImage('image/heif')).toBe(false);
  });
  test('rejects AVIF, which only newer browsers decode', () => {
    expect(isWebSafeImage('image/avif')).toBe(false);
  });
  test('rejects unknown and missing types instead of assuming they render', () => {
    expect(isWebSafeImage('application/octet-stream')).toBe(false);
    expect(isWebSafeImage(null)).toBe(false);
    expect(isWebSafeImage('')).toBe(false);
  });
  test('still matches when the type carries a parameter', () => {
    expect(isWebSafeImage('image/jpeg; charset=binary')).toBe(true);
  });
});

describe('extForMime', () => {
  test('maps known types', () => {
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('image/heic')).toBe('heic');
    expect(extForMime('application/pdf')).toBe('pdf');
  });
  test('returns null for unknown types so callers can leave the name bare', () => {
    expect(extForMime('application/x-nonsense')).toBeNull();
    expect(extForMime(null)).toBeNull();
  });
});

describe('photoFilename', () => {
  test('carries the real extension', () => {
    expect(photoFilename('image/png')).toBe('photo.png');
    expect(photoFilename('image/jpeg')).toBe('photo.jpg');
  });
  // A HEIC named .jpg is exactly why the dispatcher couldn't open the download.
  test('does not mislabel HEIC as jpg', () => {
    expect(photoFilename('image/heic')).toBe('photo.heic');
  });
  test('falls back to jpg when the type is unknown', () => {
    expect(photoFilename('application/x-nonsense')).toBe('photo.jpg');
    expect(photoFilename(null)).toBe('photo.jpg');
  });
});
