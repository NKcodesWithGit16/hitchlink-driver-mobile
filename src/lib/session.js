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
//      the "session expired" notice. "Rejected" means the Identity service
//      said so, not merely that a request failed — a 502 from a restarting
//      Railway service, an unreadable keystore on a locked phone, or a dead
//      zone all leave the session alone. Access tokens last 15 minutes, so
//      this path runs several times an hour; anything less strict than that
//      turns every backend hiccup into a sign-in screen mid-shift.
//
// Refresh is single-flight: concurrent callers (poll + heartbeat + socket
// reconnect) share one in-flight refresh instead of racing, which matters
// because the Identity service rotates the refresh token on every use — two
// parallel refreshes would invalidate each other.

import {
  readToken, writeToken,
  readRefreshTokenStrict, writeRefreshToken,
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
        let rt;
        try {
          rt = await readRefreshTokenStrict();
        } catch (e) {
          // The keystore refused the read — on iOS that's a locked device,
          // which is the normal state while the background location task is
          // sending heartbeats. "Can't read it right now" is not "there
          // isn't one"; ending the session here signed drivers out over a
          // lock screen. Keep the session and let the next attempt retry.
          console.warn('[Session] Refresh token unreadable, keeping session:', e?.message || e);
          return null;
        }
        if (!rt) { emitSessionExpired(); return null; }

        const fresh = await refreshSession(rt);
        // Refresh token first, deliberately: the server has already rotated by
        // this point, so the copy on disk is dead the moment its 30s grace
        // window closes. It's the one value worth persisting before anything
        // else can go wrong — the access token is recoverable from it, not the
        // other way round.
        const savedRefresh = await writeRefreshToken(fresh.refreshToken);
        await writeToken(fresh.token);
        if (!savedRefresh) {
          // Not fatal: tokenStorage keeps the rotated token in memory, so this
          // app run carries on refreshing normally. It does mean the session
          // won't survive a restart, which is worth saying out loud rather than
          // discovering as a mystery sign-out later.
          console.warn('[Session] Refresh token was not persisted — session is memory-only until the next successful write.');
        }
        return fresh.token;
      } catch (e) {
        // Only an explicit rejection from the Identity service ends the
        // session. refreshSession flags everything else — unreachable host,
        // 5xx, unparseable body, incomplete token pair — as `transient`; the
        // TypeError check additionally covers a network failure thrown before
        // that classification can happen.
        if (!isTransient(e)) emitSessionExpired();
        else console.warn('[Session] Refresh failed transiently, session kept:', e?.message || e);
        return null;
      } finally {
        inflightRefresh = null;
      }
    })();
  }
  return inflightRefresh;
}

function isTransient(err) {
  return !!err?.transient || err?.name === 'TypeError';
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
