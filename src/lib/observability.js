// Crash reporting. Until this existed, a crash in the field left no trace
// beyond whatever the driver could describe over the phone — which is how
// three shipped-but-dead features (iOS VoIP ringing, foreground push banners,
// document expiry math) went unnoticed.
//
// Entirely opt-in: with no EXPO_PUBLIC_SENTRY_DSN configured, every function
// here is a no-op, so a checkout with no Sentry account behaves exactly as
// before. Loaded defensively like the other native-backed modules (Daily,
// expo-notifications, signalr) so a build without the native side linked
// degrades instead of crashing at import.

import Constants from 'expo-constants';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';

let Sentry = null;
try {
  Sentry = DSN ? require('@sentry/react-native') : null;
} catch {
  Sentry = null;
}

let started = false;

/** Call once, as early as possible (root layout module scope). */
export function initObservability() {
  if (started || !Sentry) return;
  started = true;
  try {
    Sentry.init({
      dsn: DSN,
      // Traces are sampled down hard: drivers are on metered cellular for
      // whole shifts, and crash reports — not performance spans — are the
      // point of this. Errors are always sent.
      tracesSampleRate: 0.05,
      // Chat text, load notes and dispatcher names are all business data we
      // have no reason to ship to a third party.
      sendDefaultPii: false,
      environment: __DEV__ ? 'development' : 'production',
      release: Constants?.expoConfig?.version ?? undefined,
    });
  } catch {
    // Never let telemetry setup take down app startup.
    started = false;
    Sentry = null;
  }
}

/**
 * Report a caught error. `context` is a plain object of extra scope — keep it
 * to identifiers and states, never message bodies or credentials.
 */
export function reportError(error, context) {
  if (!Sentry) {
    if (__DEV__) console.error('[observability]', error, context ?? '');
    return;
  }
  try {
    Sentry.withScope((scope) => {
      if (context) scope.setContext('detail', context);
      Sentry.captureException(error);
    });
  } catch {}
}

/** Breadcrumb for the trail leading up to a crash. */
export function addBreadcrumb(message, data) {
  if (!Sentry) return;
  try {
    Sentry.addBreadcrumb({ message, data, level: 'info' });
  } catch {}
}

/**
 * Ties reports to a driver so a crash can be matched to the load/shift it
 * happened on. Id only — no name, phone or email.
 */
export function identify(driverId) {
  if (!Sentry) return;
  try {
    Sentry.setUser(driverId ? { id: String(driverId) } : null);
  } catch {}
}

/** True when reports are actually being delivered somewhere. */
export function isObservabilityEnabled() {
  return !!Sentry;
}
