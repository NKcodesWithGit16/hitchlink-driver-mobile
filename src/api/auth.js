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

// A failed refresh is only worth ending the driver's session over when the
// Identity service explicitly says the token is no good. Everything else — no
// signal, a Railway cold start, a 502 from the gateway, an HTML error page
// where JSON was expected — is infrastructure, and treating it as a rejection
// is what logged drivers out several times a shift. Errors carrying
// `transient` tell session.js which is which.
function transientError(message) {
  const err = new Error(message);
  err.transient = true;
  return err;
}

// Exchanges a refresh token for a new access + refresh token pair (the
// Identity service rotates the refresh token on every use). Resolves to
// { token, refreshToken }; throws a `transient` error when the request simply
// didn't come back with a usable answer, and a plain error only when the token
// was actually rejected.
export async function refreshSession(refreshToken) {
  let res;
  try {
    res = await fetch(`${BASE}/api/Auth/RefreshToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (e) {
    throw transientError(`Session refresh unreachable: ${e?.message || e}`);
  }

  // AuthController.RefreshToken always answers 200 with an `isAccepted`
  // verdict, so a non-2xx is never "your token is bad" — it's the service
  // being down, restarting, or behind a failing proxy.
  if (!res.ok) throw transientError(`Session refresh failed (HTTP ${res.status})`);

  let data = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    throw transientError(`Session refresh returned an unreadable body: ${e?.message || e}`);
  }

  // The one genuinely terminal case.
  if (data?.isAccepted === false) throw new Error(data?.message || 'Refresh token rejected');

  // A 200 carrying no usable pair is a server-side anomaly, not a rejection.
  // Accepting a blank refreshToken here would also wipe the stored one (see
  // writeRefreshToken) and guarantee the NEXT refresh ends the session.
  if (!data?.token || !data?.refreshToken) {
    throw transientError('Session refresh returned an incomplete token pair');
  }
  return { token: data.token, refreshToken: data.refreshToken };
}
