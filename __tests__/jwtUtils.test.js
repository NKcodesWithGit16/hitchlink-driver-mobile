import { decodeJwt, readUserFromToken } from '../src/utils/jwtUtils';

// Build an unsigned JWT with the given payload (signature isn't verified
// client-side, so any third segment works).
function makeToken(payload) {
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

describe('decodeJwt', () => {
  test('round-trips a payload', () => {
    expect(decodeJwt(makeToken({ sub: 'abc', exp: future }))).toMatchObject({ sub: 'abc', exp: future });
  });
  test('rejects malformed input without throwing', () => {
    expect(decodeJwt(null)).toBeNull();
    expect(decodeJwt('')).toBeNull();
    expect(decodeJwt('only.two')).toBeNull();
    expect(decodeJwt('not@base64.!!.sig')).toBeNull();
  });
});

describe('readUserFromToken', () => {
  test('extracts userId from sub and normalizes a string role', () => {
    const u = readUserFromToken(makeToken({ sub: 'driver-1', role: 'Driver', exp: future }));
    expect(u).toEqual({ userId: 'driver-1', role: 'driver', exp: future });
  });

  test('normalizes numeric role codes (3 = driver)', () => {
    expect(readUserFromToken(makeToken({ sub: 'x', role: 3, exp: future })).role).toBe('driver');
  });

  test('reads the long Microsoft role claim key and array values', () => {
    const msKey = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';
    expect(readUserFromToken(makeToken({ sub: 'x', [msKey]: ['Dispatcher'], exp: future })).role).toBe('dispatcher');
  });

  test('falls back through userId / nameid claims for the id', () => {
    expect(readUserFromToken(makeToken({ userId: 'u1', exp: future })).userId).toBe('u1');
    expect(readUserFromToken(makeToken({ nameid: 'u2', exp: future })).userId).toBe('u2');
  });

  test('an expired token reads as no session at all', () => {
    expect(readUserFromToken(makeToken({ sub: 'x', role: 'Driver', exp: past }))).toBeNull();
  });

  test('a token without exp is treated as live (server decides)', () => {
    expect(readUserFromToken(makeToken({ sub: 'x', role: 'Driver' }))?.userId).toBe('x');
  });
});
