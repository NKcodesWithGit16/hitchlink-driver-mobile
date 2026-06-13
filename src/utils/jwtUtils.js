// Decode a JWT and extract userId + role without verifying the signature.
// Verification happens on the backend — this is only for routing/UX decisions.

const ROLE_CLAIM_KEYS = [
  'role', 'roles',
  'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
];
const ROLE_BY_NUMBER = { 1: 'admin', 2: 'dispatcher', 3: 'driver', 4: 'broker' };

function b64Decode(str) {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/');
  const fix = pad + '='.repeat((4 - pad.length % 4) % 4);
  if (typeof atob === 'function') return atob(fix);
  return Buffer.from(fix, 'base64').toString('binary');
}

function normalizeRole(v) {
  if (v == null) return null;
  if (Array.isArray(v)) { for (const x of v) { const r = normalizeRole(x); if (r) return r; } return null; }
  if (typeof v === 'number') return ROLE_BY_NUMBER[v] ?? null;
  const s = String(v).toLowerCase();
  return ['admin', 'dispatcher', 'driver', 'broker'].includes(s) ? s : (ROLE_BY_NUMBER[s] ?? null);
}

export function decodeJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(b64Decode(parts[1])); } catch { return null; }
}

export function readUserFromToken(token) {
  const claims = decodeJwt(token);
  if (!claims) return null;
  if (claims.exp && Date.now() / 1000 > claims.exp) return null;

  let role = null;
  for (const key of ROLE_CLAIM_KEYS) {
    if (claims[key] !== undefined) { role = normalizeRole(claims[key]); if (role) break; }
  }

  const userId =
    claims.sub ?? claims.userId ?? claims.nameid ??
    claims['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] ?? null;

  return { userId: userId != null ? String(userId) : null, role, exp: claims.exp ?? null };
}
