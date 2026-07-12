import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { sendHeartbeat } from '../api/main';
import { startBackgroundTracking } from '../lib/backgroundLocation';
import { deriveSpeedKph, isAcceptableFix } from '../lib/geo';
import { recordSegment } from '../lib/odometer';

/* GPS → dispatcher heartbeats.

   While the driver is signed in and the app is open, we keep a cheap OS
   position watch running and POST the latest fix to the backend heartbeat
   endpoint. The server does the heavy lifting (status evaluation, geofence
   auto-arrival, ETA, SignalR broadcast to the dispatcher map) and replies
   with nextHeartbeatSeconds — faster while moving, slower while parked.

   Loaded defensively like useNetworkStatus: if expo-location isn't linked in
   this build, everything silently no-ops instead of crashing the app. */
let Location = null;
try {
  Location = require('expo-location');
} catch {
  Location = null;
}

const DEFAULT_INTERVAL_SEC = 60;   // until the server suggests a cadence
const MIN_INTERVAL_SEC = 8;        // never hammer, whatever the server says
const RETRY_INTERVAL_SEC = 120;    // backoff while offline / endpoint down
const MAX_FIX_AGE_MS = 5 * 60 * 1000; // never report a stale fix as "here now"

export function useLocationSharing() {
  const { userId } = useAuth();

  useEffect(() => {
    if (!userId || !Location) return;

    let sub = null;        // position watch subscription
    let timer = null;      // heartbeat pacing timer
    let appStateSub = null;
    let cancelled = false;
    let started = false;   // first fix kicks off the send loop exactly once
    // `fix` carries a derived `_speedKph` (see geo.deriveSpeedKph); `prev` is the
    // last accepted fix, used to derive speed and reject teleports.
    const latest = { fix: null, prev: null };

    const schedule = (sec) => {
      if (cancelled) return;
      clearTimeout(timer);
      timer = setTimeout(send, Math.max(MIN_INTERVAL_SEC, sec) * 1000);
    };

    async function send() {
      const fix = latest.fix;
      // A stale coordinate reads as "the truck is here right now" on the
      // dispatcher map — worse than silence. Skip and wait for a fresh fix.
      if (!fix || Date.now() - fix.timestamp > MAX_FIX_AGE_MS) {
        schedule(DEFAULT_INTERVAL_SEC);
        return;
      }
      try {
        const res = await sendHeartbeat(userId, {
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
          // Derived when the fix was accepted — real speed even when Android's
          // coords.speed comes back null (see geo.deriveSpeedKph).
          speedKph: Math.max(0, fix._speedKph ?? 0),
        });
        schedule(res?.nextHeartbeatSeconds ?? DEFAULT_INTERVAL_SEC);
      } catch {
        // Offline or backend hiccup — keep the loop alive, try again later.
        schedule(RETRY_INTERVAL_SEC);
      }
    }

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        // Keep heartbeats flowing when the app is backgrounded (navigation
        // hand-off, locked phone). Escalates to "Allow all the time" — if the
        // driver declines, foreground sharing below still works unchanged.
        startBackgroundTracking();
        sub = await Location.watchPositionAsync(
          {
            // High (not Balanced): precise fixes with a reliable coords.speed,
            // so the marker tracks smoothly and the server keeps the 8s cadence.
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,    // keep the ref fresh, sends are paced above
            distanceInterval: 20,
          },
          (pos) => {
            // Drop coarse/cached fixes (the "snap back to the origin" bug)
            // instead of reporting them as the live position.
            if (!isAcceptableFix(latest.prev, pos)) return;
            pos._speedKph = deriveSpeedKph(latest.prev, pos);
            // Accrue actual miles for the active load off the same accepted fix.
            recordSegment(latest.prev, pos);
            latest.prev = pos;
            latest.fix = pos;
            if (!started) { started = true; send(); } // first fix → beat now
          }
        );
        // Timers pause while backgrounded; on return, beat right away so the
        // dispatcher isn't left staring at a pre-background position.
        appStateSub = AppState.addEventListener('change', (s) => {
          if (s === 'active' && started) send();
        });
      } catch {
        // No GPS available (web over http, simulator without a fix, denied
        // services) — the app must keep working without location sharing.
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      try { sub?.remove(); } catch {}
      try { appStateSub?.remove(); } catch {}
    };
  }, [userId]);
}
