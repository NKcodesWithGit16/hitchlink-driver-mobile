// JWT storage. On native we use SecureStore (Android Keystore / iOS Keychain).
// expo-secure-store is NOT available on web — its calls throw — so there we use
// AsyncStorage, which is localStorage-backed and always present. Without this
// split, readToken() swallowed the web error and returned null, so every API
// call went out with no Authorization header and the backend answered 401.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'hl_driver_token';
const REFRESH_KEY = 'hl_driver_refresh_token';
const isWeb = Platform.OS === 'web';
let migrated = false;

// SecureStore's default accessibility is WHEN_UNLOCKED, which makes both keys
// unreadable while the phone is locked. That's exactly the state this app runs
// in most of the time: the headless background-location task keeps sending
// heartbeats from a locked phone in a truck mount, and each one needs a token.
// AFTER_FIRST_UNLOCK keeps the keychain entry protected at rest (nothing is
// readable until the driver has unlocked the phone once since boot) while
// letting those background refreshes actually succeed.
const SECURE_OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

// In-memory fallbacks, used ONLY after a write to the keystore has actually
// failed. A failed write used to be swallowed entirely, which is worse than it
// sounds for the refresh token: the Identity service rotates it on every use,
// so the moment a write fails the copy still on disk is the *previous* token —
// dead as soon as the server's 30s rotation grace window closes. The next
// refresh then sends a rejected token and the driver is signed out mid-shift,
// with nothing in the logs.
//
// Holding the value in memory downgrades an unwritable keystore from "signed
// out in 30 seconds" to "session lasts until the app restarts".
//
// These are deliberately NOT a general-purpose cache. Storage stays the source
// of truth whenever the last write succeeded, because a second JS context (the
// headless background-location task runs in its own runtime, with its own copy
// of this module) can rotate the token underneath us — preferring memory
// unconditionally would make THAT the stale copy and cause the very sign-out
// this is meant to prevent.
let memoToken = null;
let memoRefresh = null;
let tokenWriteFailed = false;
let refreshWriteFailed = false;

// On native, move any token left behind in AsyncStorage into SecureStore so
// existing logged-in users aren't bounced. No-op on web (AsyncStorage is home).
async function migrateLegacy() {
  if (migrated || isWeb) return;
  migrated = true;
  try {
    const legacy = await AsyncStorage.getItem(KEY);
    if (legacy) {
      await SecureStore.setItemAsync(KEY, legacy, SECURE_OPTS);
      await AsyncStorage.removeItem(KEY);
    }
  } catch {}
}

export async function readToken() {
  await migrateLegacy();
  try {
    const stored = isWeb
      ? await AsyncStorage.getItem(KEY)
      : await SecureStore.getItemAsync(KEY);
    // Only prefer memory when we know what's on disk is the older value.
    return tokenWriteFailed && memoToken ? memoToken : stored;
  } catch {
    return memoToken;
  }
}

/** @returns {Promise<boolean>} whether the value actually reached storage. */
export async function writeToken(token) {
  if (!token) { await clearToken(); return true; }
  memoToken = token;
  try {
    if (isWeb) await AsyncStorage.setItem(KEY, token);
    else await SecureStore.setItemAsync(KEY, token, SECURE_OPTS);
    tokenWriteFailed = false;
    return true;
  } catch (e) {
    // Swallowing this used to mean every later request read the stale, expired
    // token back and triggered its own refresh — a rotation storm, each round
    // of which could race the others.
    tokenWriteFailed = true;
    console.warn('[TokenStorage] Access token could not be persisted, keeping it in memory:', e?.message || e);
    return false;
  }
}

export async function clearToken() {
  memoToken = null;
  tokenWriteFailed = false;
  try {
    if (isWeb) await AsyncStorage.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {}
  // Always clear any legacy AsyncStorage copy on native too.
  if (!isWeb) { try { await AsyncStorage.removeItem(KEY); } catch {} }
}

// ── Refresh token (long-lived; rotated by the Identity service on every use) ──

export async function readRefreshToken() {
  try {
    return await readRefreshTokenStrict();
  } catch { return null; }
}

/**
 * Same read, but a storage failure THROWS instead of coming back as null.
 * Anything that would end the session on a missing refresh token has to use
 * this: "the keystore wouldn't answer just now" and "this driver has no
 * refresh token" are the same `null` otherwise, and the first one is a locked
 * screen, not a signed-out driver. See refreshNow() in src/lib/session.js.
 */
export async function readRefreshTokenStrict() {
  // A known-failed write means the stored copy is the token the server has
  // already rotated away from — the memo is the only live one we hold.
  if (refreshWriteFailed && memoRefresh) return memoRefresh;
  return isWeb
    ? await AsyncStorage.getItem(REFRESH_KEY)
    : await SecureStore.getItemAsync(REFRESH_KEY);
}

/** @returns {Promise<boolean>} whether the value actually reached storage. */
export async function writeRefreshToken(token) {
  if (!token) { await clearRefreshToken(); return true; }
  memoRefresh = token;
  try {
    if (isWeb) await AsyncStorage.setItem(REFRESH_KEY, token);
    else await SecureStore.setItemAsync(REFRESH_KEY, token, SECURE_OPTS);
    refreshWriteFailed = false;
    return true;
  } catch (e) {
    refreshWriteFailed = true;
    console.warn('[TokenStorage] Rotated refresh token could not be persisted, keeping it in memory:', e?.message || e);
    return false;
  }
}

export async function clearRefreshToken() {
  memoRefresh = null;
  refreshWriteFailed = false;
  try {
    if (isWeb) await AsyncStorage.removeItem(REFRESH_KEY);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch {}
}
