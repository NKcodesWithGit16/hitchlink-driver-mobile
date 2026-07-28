// session.js owns the trickiest invariants in the app:
//  - refresh is single-flight (the server rotates refresh tokens, so two
//    parallel refreshes would invalidate each other and log the driver out)
//  - only an explicit Identity rejection ends the session; network blips don't
//  - tokens are refreshed *before* they expire (60s margin)
// The module holds state (in-flight promise, listener set), so each test gets
// a fresh copy via jest.resetModules().

jest.mock('../src/utils/tokenStorage', () => ({
  readToken: jest.fn(),
  writeToken: jest.fn(() => Promise.resolve(true)),
  readRefreshToken: jest.fn(),
  readRefreshTokenStrict: jest.fn(),
  // Writes report whether the value actually reached storage — see
  // __tests__/tokenStorage.test.js for the memory fallback behind it.
  writeRefreshToken: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../src/api/auth', () => ({
  refreshSession: jest.fn(),
}));

function makeToken(expInSec) {
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payload = { sub: 'driver-1' };
  if (expInSec != null) payload.exp = Math.floor(Date.now() / 1000) + expInSec;
  return `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;
}

let session, storage, authApi;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  session = require('../src/lib/session');
  storage = require('../src/utils/tokenStorage');
  authApi = require('../src/api/auth');
});

describe('getValidToken', () => {
  test('returns the stored token untouched while it is fresh', async () => {
    const token = makeToken(3600);
    storage.readToken.mockResolvedValue(token);
    await expect(session.getValidToken()).resolves.toBe(token);
    expect(authApi.refreshSession).not.toHaveBeenCalled();
  });

  test('refreshes proactively inside the 60s expiry margin', async () => {
    storage.readToken.mockResolvedValue(makeToken(30)); // expires in 30s < margin
    storage.readRefreshTokenStrict.mockResolvedValue('rt-1');
    authApi.refreshSession.mockResolvedValue({ token: 'new-access', refreshToken: 'rt-2' });

    await expect(session.getValidToken()).resolves.toBe('new-access');
    expect(authApi.refreshSession).toHaveBeenCalledWith('rt-1');
    // Rotated pair is persisted.
    expect(storage.writeToken).toHaveBeenCalledWith('new-access');
    expect(storage.writeRefreshToken).toHaveBeenCalledWith('rt-2');
  });

  test('returns null when there is no session at all', async () => {
    storage.readToken.mockResolvedValue(null);
    await expect(session.getValidToken()).resolves.toBeNull();
  });

  test('a token without an exp claim is trusted (server decides)', async () => {
    const token = makeToken(null);
    storage.readToken.mockResolvedValue(token);
    await expect(session.getValidToken()).resolves.toBe(token);
    expect(authApi.refreshSession).not.toHaveBeenCalled();
  });
});

describe('single-flight refresh', () => {
  test('concurrent callers share one refresh call', async () => {
    storage.readToken.mockResolvedValue(makeToken(10));
    storage.readRefreshTokenStrict.mockResolvedValue('rt-1');
    let release;
    authApi.refreshSession.mockReturnValue(new Promise((r) => { release = r; }));

    const a = session.getValidToken();
    const b = session.getValidToken();
    const c = session.refreshNow();
    // Let the async readers reach the refresh step before releasing it.
    await new Promise((r) => setTimeout(r, 0));
    release({ token: 'fresh', refreshToken: 'rt-2' });

    await expect(Promise.all([a, b, c])).resolves.toEqual(['fresh', 'fresh', 'fresh']);
    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
  });

  test('a later refresh after completion starts a new flight', async () => {
    storage.readRefreshTokenStrict.mockResolvedValue('rt-1');
    authApi.refreshSession.mockResolvedValue({ token: 't1', refreshToken: 'rt-2' });
    await session.refreshNow();
    await session.refreshNow();
    expect(authApi.refreshSession).toHaveBeenCalledTimes(2);
  });
});

describe('session expiry semantics', () => {
  test('an explicit rejection from Identity fires sessionExpired', async () => {
    storage.readRefreshTokenStrict.mockResolvedValue('rt-dead');
    authApi.refreshSession.mockRejectedValue(new Error('Invalid or expired refresh token'));
    const expired = jest.fn();
    session.onSessionExpired(expired);

    await expect(session.refreshNow()).resolves.toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  test('missing refresh token is terminal too', async () => {
    storage.readRefreshTokenStrict.mockResolvedValue(null);
    const expired = jest.fn();
    session.onSessionExpired(expired);

    await expect(session.refreshNow()).resolves.toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  test('a network blip does NOT end the session — stale token rides along', async () => {
    const stale = makeToken(10);
    storage.readToken.mockResolvedValue(stale);
    storage.readRefreshTokenStrict.mockResolvedValue('rt-1');
    authApi.refreshSession.mockRejectedValue(new TypeError('Network request failed'));
    const expired = jest.fn();
    session.onSessionExpired(expired);

    // Falls back to the not-yet-dead token so the request can still try.
    await expect(session.getValidToken()).resolves.toBe(stale);
    expect(expired).not.toHaveBeenCalled();
  });

  // Access tokens live 15 minutes, so this path runs several times an hour on
  // a shift. Every one of these used to sign the driver out — the Identity
  // service answers 200 with an `isAccepted` verdict for a real rejection, so
  // none of them is one.
  test.each([
    ['a 502 from a restarting service', 'Session refresh failed (HTTP 502)'],
    ['an HTML error page instead of JSON', 'Session refresh returned an unreadable body: Unexpected token <'],
    ['a 200 carrying no token pair', 'Session refresh returned an incomplete token pair'],
    ['an unreachable host', 'Session refresh unreachable: Network request failed'],
  ])('%s does NOT end the session', async (_label, message) => {
    storage.readRefreshTokenStrict.mockResolvedValue('rt-1');
    const err = new Error(message);
    err.transient = true;
    authApi.refreshSession.mockRejectedValue(err);
    const expired = jest.fn();
    session.onSessionExpired(expired);

    await expect(session.refreshNow()).resolves.toBeNull();
    expect(expired).not.toHaveBeenCalled();
  });

  test('an unreadable keystore does NOT end the session', async () => {
    // iOS refuses keychain reads while the device is locked — the normal state
    // while the background location task is sending heartbeats.
    storage.readRefreshTokenStrict.mockRejectedValue(new Error('User interaction is not allowed.'));
    const expired = jest.fn();
    session.onSessionExpired(expired);

    await expect(session.refreshNow()).resolves.toBeNull();
    expect(expired).not.toHaveBeenCalled();
    expect(authApi.refreshSession).not.toHaveBeenCalled();
  });

  test('a transient failure leaves the stored refresh token alone', async () => {
    storage.readRefreshTokenStrict.mockResolvedValue('rt-1');
    const err = new Error('Session refresh failed (HTTP 503)');
    err.transient = true;
    authApi.refreshSession.mockRejectedValue(err);

    await session.refreshNow();
    // Overwriting it here — with a blank, or anything at all — is what made the
    // NEXT refresh terminal instead of just retrying this one.
    expect(storage.writeRefreshToken).not.toHaveBeenCalled();
    expect(storage.writeToken).not.toHaveBeenCalled();
  });

  test('a refresh token that cannot be persisted does NOT end the session', async () => {
    storage.readRefreshTokenStrict.mockResolvedValue('rt-1');
    authApi.refreshSession.mockResolvedValue({ token: 'fresh', refreshToken: 'rt-2' });
    storage.writeRefreshToken.mockResolvedValue(false); // keystore refused the write
    const expired = jest.fn();
    session.onSessionExpired(expired);

    // The refresh itself succeeded, so the caller still gets a usable token —
    // tokenStorage holds the rotated one in memory for the rest of this run.
    await expect(session.refreshNow()).resolves.toBe('fresh');
    expect(expired).not.toHaveBeenCalled();
  });

  test('the rotated refresh token is persisted BEFORE the access token', async () => {
    storage.readRefreshTokenStrict.mockResolvedValue('rt-1');
    authApi.refreshSession.mockResolvedValue({ token: 'fresh', refreshToken: 'rt-2' });
    const order = [];
    storage.writeRefreshToken.mockImplementation(() => { order.push('refresh'); return Promise.resolve(true); });
    storage.writeToken.mockImplementation(() => { order.push('access'); return Promise.resolve(true); });

    await session.refreshNow();
    // The server has already rotated by now; the refresh token is the only
    // value that can't be re-derived, so it goes down first.
    expect(order).toEqual(['refresh', 'access']);
  });

  test('unsubscribe stops notifications', async () => {
    storage.readRefreshTokenStrict.mockResolvedValue(null);
    const expired = jest.fn();
    const off = session.onSessionExpired(expired);
    off();
    await session.refreshNow();
    expect(expired).not.toHaveBeenCalled();
  });
});
