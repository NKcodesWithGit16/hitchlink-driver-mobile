import { readToken } from '../utils/tokenStorage';
import { MAIN_BASE, USE_MOCK } from './config';

export const BASE = MAIN_BASE;
export { USE_MOCK };

export async function apiFetch(path, options = {}) {
  // `allow404` lets a caller treat "not found" as an empty result (null)
  // instead of an error — e.g. a driver with no active load assigned yet.
  const { allow404, ...fetchOptions } = options;
  const token = await readToken();
  const res = await fetch(`${BASE}${path}`, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...fetchOptions.headers,
    },
  });
  if (res.status === 404 && allow404) return null;
  if (!res.ok) throw new Error(`API ${res.status} — ${path}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Multipart upload (e.g. voice notes). We must NOT set Content-Type here — the
// runtime sets `multipart/form-data` with the correct boundary from the FormData.
export async function apiUpload(path, formData, options = {}) {
  const token = await readToken();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: formData,
  });
  if (!res.ok) throw new Error(`API ${res.status} — ${path}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
