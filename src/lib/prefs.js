// Lightweight driver preferences store. One in-memory cache per flag with a
// durable AsyncStorage backing, plus a tiny subscribe/emit so a change made on
// the More tab is reflected everywhere else without either remounting.
//
// Two flags today:
//   - "confirm every status update" — a safety opt-in for drivers who'd rather
//     tap twice on every step than rely on Undo. Off by default: milestones
//     (Loaded, Delivered) already confirm regardless.
//   - "distance unit" — mi/km display preference. Every internal mile/GPS
//     computation (lib/geo, lib/odometer, lib/loadStats, the AsyncStorage
//     stats records) always stays in miles; this only controls what screens
//     convert to at render time, so it's safe to flip anytime.

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'hl_confirm_every_step';

let confirmEveryStep = false;
let loaded = false;
const listeners = new Set();

function emit() {
  listeners.forEach((l) => { try { l(confirmEveryStep); } catch {} });
}

// Read the persisted value once (idempotent). Safe to call on every mount.
export async function loadPrefs() {
  if (loaded) return confirmEveryStep;
  try {
    const v = await AsyncStorage.getItem(KEY);
    confirmEveryStep = v === '1';
  } catch {}
  loaded = true;
  emit();
  return confirmEveryStep;
}

export function getConfirmEveryStep() {
  return confirmEveryStep;
}

export async function setConfirmEveryStep(on) {
  confirmEveryStep = !!on;
  loaded = true;
  emit();
  try { await AsyncStorage.setItem(KEY, on ? '1' : '0'); } catch {}
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// React binding: current value, kept in sync across screens.
export function useConfirmEveryStep() {
  const [on, setOn] = useState(confirmEveryStep);
  useEffect(() => {
    loadPrefs().then(setOn);
    return subscribe(setOn);
  }, []);
  return on;
}

const UNIT_KEY = 'hl_distance_unit';

let distanceUnit = 'mi'; // 'mi' | 'km'
let unitLoaded = false;
const unitListeners = new Set();

function emitUnit() {
  unitListeners.forEach((l) => { try { l(distanceUnit); } catch {} });
}

export async function loadDistanceUnit() {
  if (unitLoaded) return distanceUnit;
  try {
    const v = await AsyncStorage.getItem(UNIT_KEY);
    if (v === 'mi' || v === 'km') distanceUnit = v;
  } catch {}
  unitLoaded = true;
  emitUnit();
  return distanceUnit;
}

export function getDistanceUnit() {
  return distanceUnit;
}

export async function setDistanceUnit(unit) {
  distanceUnit = unit === 'km' ? 'km' : 'mi';
  unitLoaded = true;
  emitUnit();
  try { await AsyncStorage.setItem(UNIT_KEY, distanceUnit); } catch {}
}

export function subscribeDistanceUnit(fn) {
  unitListeners.add(fn);
  return () => unitListeners.delete(fn);
}

export function useDistanceUnit() {
  const [unit, setUnit] = useState(distanceUnit);
  useEffect(() => {
    loadDistanceUnit().then(setUnit);
    return subscribeDistanceUnit(setUnit);
  }, []);
  return unit;
}
