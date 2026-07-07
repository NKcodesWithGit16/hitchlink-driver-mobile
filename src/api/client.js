import { getValidToken, refreshNow } from '../lib/session';
import { MAIN_BASE, USE_MOCK } from './config';

export const BASE = MAIN_BASE;
export { USE_MOCK };

// Attaches a valid access token (refreshing it first when it's about to
// expire — see src/lib/session.js). On a 401 the request is retried once
// after a forced refresh; if the session is beyond saving, session.js has
// already told AuthContext to sign out.
async function authedFetch(url, buildOptions) {
  let token = await getValidToken();
  let res = await fetch(url, buildOptions(token));
  if (res.status === 401) {
    const fresh = await refreshNow();
    if (fresh) res = await fetch(url, buildOptions(fresh));
  }
  return res;
}

export async function apiFetch(path, options = {}) {
  // `allow404` lets a caller treat "not found" as an empty result (null)
  // instead of an error — e.g. a driver with no active load assigned yet.
  const { allow404, ...fetchOptions } = options;
  const res = await authedFetch(`${BASE}${path}`, (token) => ({
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...fetchOptions.headers,
    },
  }));
  if (res.status === 404 && allow404) return null;
  if (!res.ok) throw apiError(res.status, path);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Error carrying the HTTP status so callers can tell a "the server rejected
// this" (4xx — don't retry, roll back the optimistic UI) from a transient
// network/server blip (offline or 5xx — safe to queue and replay).
function apiError(status, path) {
  const err = new Error(`API ${status} — ${path}`);
  err.status = status;
  return err;
}

// Multipart upload (e.g. voice notes). We must NOT set Content-Type here — the
// runtime sets `multipart/form-data` with the correct boundary from the FormData.
export async function apiUpload(path, formData, options = {}) {
  const res = await authedFetch(`${BASE}${path}`, (token) => ({
    method: 'POST',
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: formData,
  }));
  if (!res.ok) throw new Error(`API ${res.status} — ${path}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
