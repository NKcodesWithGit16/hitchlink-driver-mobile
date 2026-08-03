// Turning an inbound URL into "is this an invite, and for which token" is the
// hinge of the whole deep-link feature, and it has to agree in two places: the
// root router that catches cold/warm starts, and the register screen's
// paste-a-link box. Pure and shared so the two cannot drift.
//
// Deliberately does NOT use expo-linking's parse(): that pulls in a native
// module, which would put this logic beyond the reach of the test suite — and
// this is precisely the logic that fails silently when it breaks (a tapped
// invite just does nothing, with no error on either side).

const ROUTE = 'driver-register';

/**
 * Splits a URL into its path segments and query string, handling both forms:
 *
 *   https://app.gethitchlink.com/driver-register?token=…   → host, then path
 *   hitchlinkdriver://driver-register?token=…              → no host; the
 *                                                            route sits where
 *                                                            the authority goes
 */
function split(url) {
  const noHash = url.split('#')[0];
  const schemeEnd = noHash.indexOf('://');
  if (schemeEnd === -1) return null;

  const scheme = noHash.slice(0, schemeEnd).toLowerCase();
  const rest = noHash.slice(schemeEnd + 3);

  const qIndex = rest.indexOf('?');
  const pathPart = qIndex === -1 ? rest : rest.slice(0, qIndex);
  const query = qIndex === -1 ? '' : rest.slice(qIndex + 1);

  const segments = pathPart.split('/').filter(Boolean);
  // For http(s) the first segment is the host and not part of the route; under
  // a custom scheme there is no host, so every segment counts.
  const path = (scheme === 'http' || scheme === 'https') ? segments.slice(1) : segments;

  return { path: path.join('/'), query };
}

function queryParam(query, name) {
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    if (key !== name) continue;
    const raw = eq === -1 ? '' : pair.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;   // malformed escape — better the raw value than nothing
    }
  }
  return null;
}

/**
 * Both delivery forms resolve here. Returns the token, or null when the URL
 * isn't an invite.
 */
export function parseInviteUrl(url) {
  if (!url || typeof url !== 'string') return null;

  const parts = split(url.trim());
  if (!parts || parts.path !== ROUTE) return null;

  const token = queryParam(parts.query, 'token');
  return token ? token.trim() || null : null;
}

/**
 * What the driver typed or pasted into "open your invite": a full link, or the
 * bare 8-character code from their dispatcher's message. Anything that isn't a
 * recognisable invite URL passes through as a code — the server decides whether
 * it's real.
 */
export function extractToken(raw) {
  const value = (raw ?? '').trim();
  if (!value) return '';
  return parseInviteUrl(value) ?? value;
}
