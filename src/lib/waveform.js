/* Pure helpers for turning raw recorder metering samples into the bar-height
   data a voice bubble renders — used both when a recording finishes (compact
   the samples before upload) and when rendering a bubble (map whatever
   length of peaks arrived to however many bars are actually drawn). No React
   Native imports here on purpose — kept easy to unit test in isolation. */

// expo-audio's `metering` is a dBFS-ish level; -50dB is already a very quiet
// voice, so treat it as the silence floor for more visible dynamic range
// than the true noise floor (~-160dB) would give.
const METERING_FLOOR_DB = -50;

// Converts one raw metering reading (dBFS, roughly -160..0) into a 0..1 bar height.
export function normalizeMetering(db) {
  if (typeof db !== 'number' || !isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - METERING_FLOOR_DB) / -METERING_FLOOR_DB));
}

// Maps a samples array of any length onto exactly targetCount values by
// bucket-averaging — used both to compact a long recording before upload and
// to fit whatever peaks a message carries to the bar count a bubble draws.
export function resamplePeaks(samples, targetCount) {
  if (!Array.isArray(samples) || samples.length === 0 || targetCount <= 0) return [];
  if (samples.length === targetCount) return samples.slice();
  const out = new Array(targetCount);
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor((i * samples.length) / targetCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * samples.length) / targetCount));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < samples.length; j++) { sum += samples[j]; count++; }
    out[i] = count ? sum / count : 0;
  }
  return out;
}

// The wire format is a plain comma-joined string (matches what the dispatcher
// web app already sends — see HitchLink_frontend's useSignalRChat sendVoice).
export function peaksToString(samples) {
  return Array.isArray(samples) ? samples.map((n) => n.toFixed(3)).join(',') : '';
}

export function parsePeaksString(str) {
  if (!str) return [];
  return String(str).split(',').map(Number).filter((n) => isFinite(n));
}
