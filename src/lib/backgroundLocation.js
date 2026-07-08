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
import { getValidToken } from './session';
import { readUserFromToken } from '../utils/jwtUtils';
import { deriveSpeedKph, isAcceptableFix } from './geo';

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
// Last accepted fix, persisted across headless task invocations so speed can be
// derived and teleports rejected the same way the foreground watch does.
let lastBgFix = null;

if (TaskManager?.defineTask) {
  TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;

    // While the app is active, useLocationSharing owns the heartbeat cadence
    // (it also feeds the on-screen status) — sending from here too would
    // double every pulse.
    if (AppState.currentState === 'active') return;

    const now = Date.now();
    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) return;

    // getValidToken refreshes an expired access token, so heartbeats keep
    // flowing on long shifts even while the app stays backgrounded.
    const claims = readUserFromToken(await getValidToken());
    if (!claims?.userId) return;

    // Walk every fix in the batch so speed is derived and teleports rejected
    // against the running previous fix — same rules as the foreground watch.
    // Send only the last accepted one (heartbeats are paced, not per-fix).
    let toSend = null;
    for (const loc of data.locations) {
      if (!isAcceptableFix(lastBgFix, loc)) continue;
      loc._speedKph = deriveSpeedKph(lastBgFix, loc);
      lastBgFix = loc;
      toSend = loc;
    }
    if (!toSend) return;

    lastSentAt = now;
    try {
      await sendHeartbeat(claims.userId, {
        lat: toSend.coords.latitude,
        lng: toSend.coords.longitude,
        speedKph: Math.max(0, toSend._speedKph ?? 0),
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
      accuracy: Location.Accuracy.High,
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
