import { IDENTITY_BASE as BASE } from './config';

export async function login(usernameOrEmail, password) {
  const res = await fetch(`${BASE}/api/Auth/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameOrEmail, password }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || 'Login failed');
  if (data?.isAccepted === false) throw new Error(data?.message || 'Invalid username or password');
  return data; // { token, refreshToken, ... }
}

// Exchanges a refresh token for a new access + refresh token pair (the
// Identity service rotates the refresh token on every use). Resolves to
// { token, refreshToken } or throws when the refresh token is invalid/expired.
export async function refreshSession(refreshToken) {
  const res = await fetch(`${BASE}/api/Auth/RefreshToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok || data?.isAccepted === false || !data?.token) {
    throw new Error(data?.message || 'Session refresh failed');
  }
  return { token: data.token, refreshToken: data.refreshToken };
}
