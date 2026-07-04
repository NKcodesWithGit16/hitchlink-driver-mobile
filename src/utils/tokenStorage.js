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

// On native, move any token left behind in AsyncStorage into SecureStore so
// existing logged-in users aren't bounced. No-op on web (AsyncStorage is home).
async function migrateLegacy() {
  if (migrated || isWeb) return;
  migrated = true;
  try {
    const legacy = await AsyncStorage.getItem(KEY);
    if (legacy) {
      await SecureStore.setItemAsync(KEY, legacy);
      await AsyncStorage.removeItem(KEY);
    }
  } catch {}
}

export async function readToken() {
  await migrateLegacy();
  try {
    return isWeb
      ? await AsyncStorage.getItem(KEY)
      : await SecureStore.getItemAsync(KEY);
  } catch { return null; }
}

export async function writeToken(token) {
  if (!token) return clearToken();
  try {
    if (isWeb) await AsyncStorage.setItem(KEY, token);
    else await SecureStore.setItemAsync(KEY, token);
  } catch {}
}

export async function clearToken() {
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
    return isWeb
      ? await AsyncStorage.getItem(REFRESH_KEY)
      : await SecureStore.getItemAsync(REFRESH_KEY);
  } catch { return null; }
}

export async function writeRefreshToken(token) {
  if (!token) return clearRefreshToken();
  try {
    if (isWeb) await AsyncStorage.setItem(REFRESH_KEY, token);
    else await SecureStore.setItemAsync(REFRESH_KEY, token);
  } catch {}
}

export async function clearRefreshToken() {
  try {
    if (isWeb) await AsyncStorage.removeItem(REFRESH_KEY);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch {}
}
