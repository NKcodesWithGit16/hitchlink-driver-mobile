import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import haptics from '../lib/haptics';
import { useT } from '../i18n/LanguageContext';
import { normalizeMetering, resamplePeaks, peaksToString } from '../lib/waveform';

// Longest clip we'll capture before auto-stopping — keeps a forgotten recording
// from running forever (and the upload from ballooning).
const MAX_SECONDS = 300;
// How often we sample the mic level while recording, and how many points we
// compact that down to before upload — a real (if coarse) waveform instead of
// a generic decorative one, without sending thousands of samples for a long clip.
const METER_SAMPLE_MS = 120;
const WAVEFORM_POINTS = 40;

/* Tap-to-record voice capture, lifted out of the composer so the whole input
   row can switch into a recording bar. Tap start() to begin, then either
   stop() to send the clip via onSend, or cancel() to discard it.

   Returns { recording, elapsed, start, stop, cancel }:
   · recording — is a capture in progress
   · elapsed   — seconds recorded so far (live, updates each second)        */
export function useVoiceRecorder({ onSend } = {}) {
  const t = useT();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef  = useRef(0);
  const activeRef = useRef(false);
  const timerRef  = useRef(null);
  const meterTimerRef = useRef(null);
  const peaksRef  = useRef([]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (meterTimerRef.current) { clearInterval(meterTimerRef.current); meterTimerRef.current = null; }
  }, []);

  // Restore the session to loud playback so recorded clips are audible again.
  const restorePlayback = useCallback(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert(t('messages.micNeededTitle'), t('messages.micNeededBody')); return; }
      // iOS needs the session in recording mode to capture the mic.
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }).catch(() => {});
      await recorder.prepareToRecordAsync();
      recorder.record();
      activeRef.current = true;
      startRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      peaksRef.current = [];
      haptics.impact();
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startRef.current) / 1000);
        setElapsed(secs);
        if (secs >= MAX_SECONDS) stopRef.current();   // auto-stop + send
      }, 1000);
      // Sample the live mic level so the sent clip carries its own real
      // waveform instead of a generic decorative one.
      meterTimerRef.current = setInterval(() => {
        try {
          const level = recorder.getStatus()?.metering;
          peaksRef.current.push(normalizeMetering(level));
        } catch {}
      }, METER_SAMPLE_MS);
    } catch {
      activeRef.current = false;
      setRecording(false);
      restorePlayback();
    }
  }, [recorder, restorePlayback, t]);

  // Common teardown for both stop() and cancel(): halt the recorder, clear
  // UI state, and hand the audio session back to playback. Returns the clip.
  const finish = useCallback(async () => {
    if (!activeRef.current) return null;
    activeRef.current = false;
    clearTimer();
    const secs = Math.max(1, Math.round((Date.now() - startRef.current) / 1000));
    setRecording(false);
    setElapsed(0);
    let uri = null;
    try { await recorder.stop(); uri = recorder.uri || null; } catch {}
    restorePlayback();
    const waveformPeaks = peaksRef.current.length ? peaksToString(resamplePeaks(peaksRef.current, WAVEFORM_POINTS)) : null;
    peaksRef.current = [];
    return { uri, durationSec: secs, waveformPeaks };
  }, [recorder, clearTimer, restorePlayback]);

  const stop = useCallback(async () => {
    const clip = await finish();
    if (!clip) return;
    haptics.tap();
    onSend?.(clip);
  }, [finish, onSend]);

  const cancel = useCallback(async () => {
    const clip = await finish();
    if (!clip) return;
    haptics.tap();   // discarded — the clip is dropped, never sent
  }, [finish]);

  // Keep the latest stop() reachable from the interval without re-arming it.
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // Safety net: if the screen unmounts mid-recording (navigation away), stop
  // the recorder and drop the clip so the mic/session isn't left open.
  useEffect(() => () => {
    if (activeRef.current) {
      activeRef.current = false;
      clearTimer();
      recorder.stop().catch(() => {});
      restorePlayback();
    }
  }, [recorder, clearTimer, restorePlayback]);

  return { recording, elapsed, start, stop, cancel };
}
