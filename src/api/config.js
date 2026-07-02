import { Platform } from 'react-native';

const IDENTITY_REMOTE = process.env.EXPO_PUBLIC_API_BASE_URL || '';
const MAIN_REMOTE = process.env.EXPO_PUBLIC_API_MAIN_URL || '';

// Browsers enforce CORS and the Railway backends don't return
// Access-Control-Allow-Origin headers, so direct calls from web are blocked.
// On web we route through the local dev proxy (`npm run web`, scripts/web-dev.js)
// which injects those headers. Native builds (APK/iOS) don't do CORS checks,
// so they talk to Railway directly.
const ON_WEB = Platform.OS === 'web';

export const IDENTITY_BASE = ON_WEB
  ? (process.env.EXPO_PUBLIC_PROXY_IDENTITY || 'http://localhost:8788')
  : IDENTITY_REMOTE;

export const MAIN_BASE = ON_WEB
  ? (process.env.EXPO_PUBLIC_PROXY_MAIN || 'http://localhost:8789')
  : MAIN_REMOTE;

// Mock only when there's no real backend configured at all.
export const USE_MOCK = !MAIN_REMOTE;
