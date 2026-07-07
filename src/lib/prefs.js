// Lightweight driver preferences store. One in-memory cache with a durable
// AsyncStorage backing, plus a tiny subscribe/emit so a change made on the
// More tab is reflected on the Load tab without either remounting.
//
// Currently holds a single flag — "confirm every status update" — a safety
// opt-in for drivers who'd rather tap twice on every step than rely on Undo.
// Off by default: milestones (Loaded, Delivered) already confirm regardless.

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
