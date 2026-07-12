// Per-load "actual miles" odometer.
//
// The heartbeat pipeline already accepts/rejects every GPS fix and measures the
// segment between fixes with haversineMeters (see lib/geo). This module taps
// that same accepted-fix stream and sums the segments into per-load buckets, so
// on delivery the driver sees how far he ACTUALLY drove — deadhead to the
// pickup plus loaded miles under freight — not just the broker's quoted number.
//
// State lives in AsyncStorage, not React, for two reasons: it must survive an
// app restart mid-load, and the background location task runs in a headless JS
// context that can't reach component state. Mutations are read-modify-write and
// serialized through a single in-flight chain so two overlapping fixes can't
// lose a segment. In mock mode there is no real GPS, so finalize synthesizes
// believable actuals from the planned miles and the feature stays demonstrable.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { USE_MOCK } from '../api/config';
import { haversineMeters } from './geo';
import { loadPhase } from './load';
import { computeLoadStats, freezeRecord, synthActuals, METERS_PER_MILE } from './loadStats';

const ACTIVE_KEY = 'hl_odometer_active';
const STATS_PREFIX = 'hl_load_stats:';

// Serialize storage mutations so read-modify-write can't race. Each op chains
// off the previous one; a rejection is swallowed from the chain (but still
// surfaced to that op's own caller) so one failure can't stall the queue.
let chain = Promise.resolve();
function serialize(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function readActive() {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeActive(active) {
  try {
    if (active) await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
    else await AsyncStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Storage unavailable — the odometer just under-counts; never crash a drive.
  }
}

/**
 * Point the odometer at the load the driver is currently running. Safe to call
 * on every render / status change: it creates the accumulator the first time it
 * sees a load id and only updates the phase (deadhead vs loaded) thereafter, so
 * buckets are never reset mid-load. Pass planned miles + rate so finalize can
 * compute rpm even if it can't read them back later.
 */
export function setActiveLoad({ loadId, status, plannedMiles, rate }) {
  if (!loadId) return Promise.resolve();
  return serialize(async () => {
    const phase = loadPhase(status);
    const cur = await readActive();
    if (cur && String(cur.loadId) === String(loadId)) {
      await writeActive({ ...cur, phase, plannedMiles: plannedMiles ?? cur.plannedMiles, rate: rate ?? cur.rate });
    } else {
      // A different load became active — start fresh buckets. A prior load that
      // was never finalized is dropped; delivery is what freezes a record.
      await writeActive({
        loadId: String(loadId),
        phase,
        plannedMiles: plannedMiles ?? null,
        rate: rate ?? null,
        deadheadMeters: 0,
        loadedMeters: 0,
        startedAt: Date.now(),
      });
    }
  });
}

/**
 * Add the distance between two accepted GPS fixes to the active load's current
 * bucket. No-op when there's no active load, the phase isn't a driving phase
 * (posted / delivered), or in mock mode (no real GPS to measure). Called from
 * both the foreground watch and the background task — the same accepted-fix
 * gating (isAcceptableFix) has already run before we get here.
 */
export function recordSegment(prevFix, curFix) {
  if (USE_MOCK || !prevFix || !curFix) return Promise.resolve();
  return serialize(async () => {
    const a = await readActive();
    if (!a || (a.phase !== 'deadhead' && a.phase !== 'loaded')) return;
    const meters = haversineMeters(
      prevFix.coords.latitude, prevFix.coords.longitude,
      curFix.coords.latitude, curFix.coords.longitude,
    );
    if (!isFinite(meters) || meters <= 0) return;
    if (a.phase === 'loaded') a.loadedMeters += meters;
    else a.deadheadMeters += meters;
    await writeActive(a);
  });
}

/**
 * Freeze the active load's actuals into a stored stats record (keyed by load
 * id) and clear the accumulator. Returns the record so the completion screen
 * can show it immediately. When there's no measured trail (mock mode, or a load
 * delivered without any fixes) the actuals are synthesized from planned miles
 * so the screen is never blank.
 */
export function finalizeActiveLoad({ loadId, plannedMiles, rate }) {
  if (!loadId) return Promise.resolve(null);
  return serialize(async () => {
    const a = await readActive();
    const mine = a && String(a.loadId) === String(loadId) ? a : null;
    const planned = plannedMiles ?? mine?.plannedMiles ?? null;
    const r = rate ?? mine?.rate ?? null;

    const measured = mine ? mine.deadheadMeters + mine.loadedMeters : 0;
    let deadheadMiles;
    let loadedMiles;
    if (measured > 0) {
      deadheadMiles = mine.deadheadMeters / METERS_PER_MILE;
      loadedMiles = mine.loadedMeters / METERS_PER_MILE;
    } else {
      ({ deadheadMiles, loadedMiles } = synthActuals(planned));
    }

    const record = freezeRecord({ loadId, plannedMiles: planned, rate: r, deadheadMiles, loadedMiles });
    try {
      await AsyncStorage.setItem(STATS_PREFIX + loadId, JSON.stringify(record));
    } catch {}
    if (mine) await writeActive(null);
    return record;
  });
}

/** The stored actuals for a completed load, or null if none was recorded. */
export function getStats(loadId) {
  if (!loadId) return Promise.resolve(null);
  return AsyncStorage.getItem(STATS_PREFIX + loadId)
    .then((raw) => (raw ? JSON.parse(raw) : null))
    .catch(() => null);
}

// Re-exported so screens have one import for "load stats" whether they need the
// pure merge or the stored record.
export { computeLoadStats };
