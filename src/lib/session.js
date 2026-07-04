// Session lifetime management. Access tokens from the Identity service are
// short-lived; without this module they silently died mid-shift — API calls
// started 401ing, heartbeats and chat stopped, and the driver had no idea
// until they relaunched the app.
//
// Strategy:
//   1. Proactive — getValidToken() refreshes when the access token is within
//      a minute of expiry, so requests almost never go out with a dead token.
//   2. Reactive — apiFetch retries a 401 once after forcing a refresh
//      (covers server-side clock skew and revocations).
//   3. Terminal — only when the *refresh* token is rejected does the session
//      actually end: listeners (AuthContext) are told to sign out and show
//      the "session expired" notice.
//
// Refresh is single-flight: concurrent callers (poll + heartbeat + socket
// reconnect) share one in-flight refresh instead of racing, which matters
// because the Identity service rotates the refresh token on every use — two
// parallel refreshes would invalidate each other.

import {
  readToken, writeToken,
  readRefreshToken, writeRefreshToken,
} from '../utils/tokenStorage';
import { decodeJwt } from '../utils/jwtUtils';
import { refreshSession } from '../api/auth';

// Refresh this long before the access token's exp to absorb clock skew and
// in-flight request time.
const EXPIRY_MARGIN_SEC = 60;

let inflightRefresh = null;
const expiredListeners = new Set();

/** AuthContext subscribes to learn when the session is unrecoverable. */
export function onSessionExpired(listener) {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

function emitSessionExpired() {
  expiredListeners.forEach((l) => { try { l(); } catch {} });
}

function isExpiring(token) {
  const claims = decodeJwt(token);
  if (!claims?.exp) return false; // no exp claim — let the server decide
  return Date.now() / 1000 > claims.exp - EXPIRY_MARGIN_SEC;
}

/**
 * Exchanges the stored refresh token for a fresh pair (single-flight).
 * Resolves to the new access token, or null when the session is beyond
 * saving (no refresh token / Identity rejected it) — in which case the
 * sessionExpired event has fired.
 */
export function refreshNow() {
  if (!inflightRefresh) {
    inflightRefresh = (async () => {
      try {
        const rt = await readRefreshToken();
        if (!rt) { emitSessionExpired(); return null; }
        const fresh = await refreshSession(rt);
        await writeToken(fresh.token);
        await writeRefreshToken(fresh.refreshToken);
        return fresh.token;
      } catch (e) {
        // Network blips must NOT end the session — only an explicit rejection
        // from the Identity service does. refreshSession throws with the
        // server's message for rejections and TypeError for network failures.
        if (e?.name !== 'TypeError') emitSessionExpired();
        return null;
      } finally {
        inflightRefresh = null;
      }
    })();
  }
  return inflightRefresh;
}

/**
 * The one true way to get a token for a request: returns the stored access
 * token, refreshing it first when it's expired or about to be. Returns null
 * when there's no session at all.
 */
export async function getValidToken() {
  const token = await readToken();
  if (!token) return null;
  if (!isExpiring(token)) return token;
  return (await refreshNow()) ?? token; // stale token as last resort (network blip)
}
