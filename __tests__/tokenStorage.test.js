// tokenStorage decides whether a driver's session survives a keystore hiccup.
// The dangerous case is a failed WRITE: the Identity service rotates the
// refresh token on every use, so the instant a write fails the copy on disk is
// the previous token — rejected as soon as the server's 30s rotation grace
// window closes, which signs the driver out mid-shift. These tests pin the
// memory-fallback behaviour that turns that into a survivable condition.
//
// The module holds state (the memos), so each test gets a fresh copy via
// jest.resetModules().

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

let storage, SecureStore;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  storage = require('../src/utils/tokenStorage');
  SecureStore = require('expo-secure-store');
  SecureStore.setItemAsync.mockResolvedValue(undefined);
  SecureStore.getItemAsync.mockResolvedValue(null);
});

describe('keychain accessibility', () => {
  test('writes are stored AFTER_FIRST_UNLOCK so a locked phone can still read them', async () => {
    await storage.writeRefreshToken('rt-1');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'hl_driver_refresh_token', 'rt-1', { keychainAccessible: 'afterFirstUnlock' },
    );
  });
});

describe('refresh token — write failures', () => {
  test('a successful write reports true and is read back from storage', async () => {
    await expect(storage.writeRefreshToken('rt-1')).resolves.toBe(true);
    SecureStore.getItemAsync.mockResolvedValue('rt-1');
    await expect(storage.readRefreshTokenStrict()).resolves.toBe('rt-1');
  });

  test('a failed write reports false instead of being swallowed', async () => {
    SecureStore.setItemAsync.mockRejectedValue(new Error('User interaction is not allowed.'));
    await expect(storage.writeRefreshToken('rt-2')).resolves.toBe(false);
  });

  test('after a failed write the ROTATED token is returned, not the dead stored one', async () => {
    SecureStore.setItemAsync.mockRejectedValue(new Error('keystore unavailable'));
    await storage.writeRefreshToken('rt-2');
    // Disk still holds rt-1, which the server rotated away from — using it
    // would be rejected the moment the 30s grace window closes.
    SecureStore.getItemAsync.mockResolvedValue('rt-1');
    await expect(storage.readRefreshTokenStrict()).resolves.toBe('rt-2');
  });

  test('once a write succeeds again, storage is authoritative once more', async () => {
    SecureStore.setItemAsync.mockRejectedValueOnce(new Error('transient'));
    await storage.writeRefreshToken('rt-2');
    await storage.writeRefreshToken('rt-3');           // this one lands
    // A second JS context (the headless location task) may have rotated past
    // us; preferring memory here is what would strand the session.
    SecureStore.getItemAsync.mockResolvedValue('rt-4');
    await expect(storage.readRefreshTokenStrict()).resolves.toBe('rt-4');
  });

  test('a read failure with nothing memoised still throws (session.js needs that signal)', async () => {
    SecureStore.getItemAsync.mockRejectedValue(new Error('User interaction is not allowed.'));
    await expect(storage.readRefreshTokenStrict()).rejects.toThrow();
    // The lenient variant keeps its null-on-failure contract for callers that
    // only use it to decide whether to attempt a refresh at boot.
    await expect(storage.readRefreshToken()).resolves.toBeNull();
  });

  test('clearing drops the memo too, so a signed-out phone cannot resurrect a session', async () => {
    SecureStore.setItemAsync.mockRejectedValue(new Error('nope'));
    await storage.writeRefreshToken('rt-2');
    await storage.clearRefreshToken();
    SecureStore.getItemAsync.mockResolvedValue(null);
    await expect(storage.readRefreshTokenStrict()).resolves.toBeNull();
  });
});

describe('access token — write failures', () => {
  test('a failed write reports false and the value is still readable', async () => {
    SecureStore.setItemAsync.mockRejectedValue(new Error('keystore unavailable'));
    await expect(storage.writeToken('access-2')).resolves.toBe(false);
    // Reading the stale expired token back is what caused a refresh per
    // request, each one rotating the refresh token against the others.
    SecureStore.getItemAsync.mockResolvedValue('access-1');
    await expect(storage.readToken()).resolves.toBe('access-2');
  });

  test('clearing drops the memo', async () => {
    SecureStore.setItemAsync.mockRejectedValue(new Error('nope'));
    await storage.writeToken('access-2');
    await storage.clearToken();
    SecureStore.getItemAsync.mockResolvedValue(null);
    await expect(storage.readToken()).resolves.toBeNull();
  });
});
