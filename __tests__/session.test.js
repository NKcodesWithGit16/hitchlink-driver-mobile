// session.js owns the trickiest invariants in the app:
//  - refresh is single-flight (the server rotates refresh tokens, so two
//    parallel refreshes would invalidate each other and log the driver out)
//  - only an explicit Identity rejection ends the session; network blips don't
//  - tokens are refreshed *before* they expire (60s margin)
// The module holds state (in-flight promise, listener set), so each test gets
// a fresh copy via jest.resetModules().

jest.mock('../src/utils/tokenStorage', () => ({
  readToken: jest.fn(),
  writeToken: jest.fn(() => Promise.resolve()),
  readRefreshToken: jest.fn(),
  writeRefreshToken: jest.fn(() => Promise.resolve()),
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
    storage.readRefreshToken.mockResolvedValue('rt-1');
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
    storage.readRefreshToken.mockResolvedValue('rt-1');
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
    storage.readRefreshToken.mockResolvedValue('rt-1');
    authApi.refreshSession.mockResolvedValue({ token: 't1', refreshToken: 'rt-2' });
    await session.refreshNow();
    await session.refreshNow();
    expect(authApi.refreshSession).toHaveBeenCalledTimes(2);
  });
});

describe('session expiry semantics', () => {
  test('an explicit rejection from Identity fires sessionExpired', async () => {
    storage.readRefreshToken.mockResolvedValue('rt-dead');
    authApi.refreshSession.mockRejectedValue(new Error('Invalid or expired refresh token'));
    const expired = jest.fn();
    session.onSessionExpired(expired);

    await expect(session.refreshNow()).resolves.toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  test('missing refresh token is terminal too', async () => {
    storage.readRefreshToken.mockResolvedValue(null);
    const expired = jest.fn();
    session.onSessionExpired(expired);

    await expect(session.refreshNow()).resolves.toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  test('a network blip does NOT end the session — stale token rides along', async () => {
    const stale = makeToken(10);
    storage.readToken.mockResolvedValue(stale);
    storage.readRefreshToken.mockResolvedValue('rt-1');
    authApi.refreshSession.mockRejectedValue(new TypeError('Network request failed'));
    const expired = jest.fn();
    session.onSessionExpired(expired);

    // Falls back to the not-yet-dead token so the request can still try.
    await expect(session.getValidToken()).resolves.toBe(stale);
    expect(expired).not.toHaveBeenCalled();
  });

  test('unsubscribe stops notifications', async () => {
    storage.readRefreshToken.mockResolvedValue(null);
    const expired = jest.fn();
    const off = session.onSessionExpired(expired);
    off();
    await session.refreshNow();
    expect(expired).not.toHaveBeenCalled();
  });
});
