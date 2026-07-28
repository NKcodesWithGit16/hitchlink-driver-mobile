// refreshSession decides whether a driver keeps their session. The Identity
// service always answers HTTP 200 with an `isAccepted` verdict (see
// AuthController.RefreshToken), so a non-2xx can only ever be infrastructure —
// a restarting Railway service, a gateway error, a captive portal. Treating
// those as a rejection is what signed drivers out several times a shift, so
// each classification below is load-bearing: anything NOT flagged `transient`
// ends the session in src/lib/session.js.

jest.mock('../src/api/config', () => ({
  IDENTITY_BASE: 'https://identity.test',
  MAIN_BASE: 'https://main.test',
  USE_MOCK: false,
}));

let refreshSession;

const respond = ({ ok = true, status = 200, body = '' }) => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(body),
  }));
};

beforeEach(() => {
  jest.resetModules();
  ({ refreshSession } = require('../src/api/auth'));
});

afterEach(() => { delete global.fetch; });

const accepted = JSON.stringify({
  isAccepted: true, token: 'access-2', refreshToken: 'rt-2',
});

describe('refreshSession — the happy path', () => {
  test('returns the rotated pair', async () => {
    respond({ body: accepted });
    await expect(refreshSession('rt-1')).resolves.toEqual({
      token: 'access-2', refreshToken: 'rt-2',
    });
  });

  test('sends the refresh token to the Identity service', async () => {
    respond({ body: accepted });
    await refreshSession('rt-1');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://identity.test/api/Auth/RefreshToken');
    expect(JSON.parse(opts.body)).toEqual({ refreshToken: 'rt-1' });
  });
});

describe('refreshSession — terminal vs transient', () => {
  test('an explicit rejection is TERMINAL', async () => {
    respond({ body: JSON.stringify({ isAccepted: false, message: 'Invalid or expired refresh token' }) });
    const err = await refreshSession('rt-dead').catch((e) => e);
    expect(err.message).toBe('Invalid or expired refresh token');
    // Unflagged — this is the one case session.js signs the driver out for.
    expect(err.transient).toBeUndefined();
  });

  test.each([500, 502, 503, 504])('HTTP %i is transient', async (status) => {
    respond({ ok: false, status, body: '<html>Application failed to respond</html>' });
    await expect(refreshSession('rt-1')).rejects.toMatchObject({ transient: true });
  });

  test('a 200 with an unparseable body is transient', async () => {
    respond({ body: '<html>proxy error</html>' });
    await expect(refreshSession('rt-1')).rejects.toMatchObject({ transient: true });
  });

  test('an unreachable host is transient', async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    await expect(refreshSession('rt-1')).rejects.toMatchObject({ transient: true });
  });

  // Returning these would hand session.js a blank refreshToken, which
  // writeRefreshToken turns into clearRefreshToken() — wiping the only thing
  // that could have recovered the session on the next attempt.
  test('a 200 missing the refresh token is transient, not a rejection', async () => {
    respond({ body: JSON.stringify({ isAccepted: true, token: 'access-2' }) });
    await expect(refreshSession('rt-1')).rejects.toMatchObject({ transient: true });
  });

  test('a 200 missing the access token is transient, not a rejection', async () => {
    respond({ body: JSON.stringify({ isAccepted: true, refreshToken: 'rt-2' }) });
    await expect(refreshSession('rt-1')).rejects.toMatchObject({ transient: true });
  });

  test('an empty 200 body is transient', async () => {
    respond({ body: '' });
    await expect(refreshSession('rt-1')).rejects.toMatchObject({ transient: true });
  });
});
