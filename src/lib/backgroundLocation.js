// Background GPS: keeps heartbeats flowing to the dispatcher when the app is
// backgrounded or the phone is locked — exactly when useLocationSharing's
// foreground watch + JS timers stop. Without this the dispatcher map freezes
// the moment the driver switches to their navigation app, and the backend
// watchdog falsely flags them Offline after 5 minutes.
//
// The task callback runs in a headless JS context (the OS may relaunch the
// app process just to deliver a fix), so it can't reach React state: identity
// and auth both come from the stored JWT.
//
// Loaded defensively like useLocationSharing: if expo-location or
// expo-task-manager aren't linked in this build (web, Expo Go), everything
// silently no-ops instead of crashing the app.

import { AppState } from 'react-native';
import { USE_MOCK } from '../api/config';
import { sendHeartbeat } from '../api/main';
import { readToken } from '../utils/tokenStorage';
import { readUserFromToken } from '../utils/jwtUtils';

let Location = null;
let TaskManager = null;
try {
  Location = require('expo-location');
  TaskManager = require('expo-task-manager');
} catch {
  Location = null;
  TaskManager = null;
}

export const BG_LOCATION_TASK = 'hitchlink-driver-location';

// The server paces foreground heartbeats at 8s while moving; background
// reports don't need to be tighter than that.
const MIN_SEND_INTERVAL_MS = 8000;
let lastSentAt = 0;

if (TaskManager?.defineTask) {
  TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;

    // While the app is active, useLocationSharing owns the heartbeat cadence
    // (it also feeds the on-screen status) — sending from here too would
    // double every pulse.
    if (AppState.currentState === 'active') return;

    const now = Date.now();
    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) return;

    const claims = readUserFromToken(await readToken());
    if (!claims?.userId) return;

    const fix = data.locations[data.locations.length - 1];
    const { latitude, longitude, speed } = fix?.coords ?? {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    lastSentAt = now;
    try {
      await sendHeartbeat(claims.userId, {
        lat: latitude,
        lng: longitude,
        // GPS speed is m/s (and -1/null when unknown) → clamp to kph.
        speedKph: Math.max(0, (speed ?? 0) * 3.6),
      });
    } catch {
      // Offline / server hiccup — the next fix will retry.
    }
  });
}

/**
 * Starts background location updates. Call after foreground permission is
 * granted; escalates to background ("Allow all the time") here. Safe to call
 * repeatedly — no-ops if already running, in mock mode, or unsupported.
 * @returns {Promise<boolean>} true when background tracking is active.
 */
export async function startBackgroundTracking() {
  if (USE_MOCK || !Location || !TaskManager) return false;
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return false;

    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) return false;

    const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)
      .catch(() => false);
    if (alreadyRunning) return true;

    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 10000,
      distanceInterval: 50,
      // iOS: keep delivering while backgrounded; show the status-bar
      // indicator so the driver always knows sharing is on.
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      // Android: background location must run as a foreground service with a
      // persistent notification.
      foregroundService: {
        notificationTitle: 'HitchLink is sharing your location',
        notificationBody: 'Your dispatcher can see your live position and ETA.',
        notificationColor: '#1FB6CE',
      },
    });
    return true;
  } catch {
    // Simulator without GPS, Expo Go, web, or a declined dialog — foreground
    // sharing still works, so fail quietly.
    return false;
  }
}

/** Stops background updates (call on sign-out). Safe when not running. */
export async function stopBackgroundTracking() {
  if (!Location || !TaskManager) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
    }
  } catch {
    // Task not registered — nothing to stop.
  }
}
