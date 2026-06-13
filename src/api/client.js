import { readToken } from '../utils/tokenStorage';

export const BASE = process.env.EXPO_PUBLIC_API_MAIN_URL || '';
export const USE_MOCK = !BASE;

export async function apiFetch(path, options = {}) {
  const token = await readToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`API ${res.status} — ${path}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
