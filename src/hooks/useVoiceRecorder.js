import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import haptics from '../lib/haptics';
import { useT } from '../i18n/LanguageContext';

// Longest clip we'll capture before auto-stopping — keeps a forgotten recording
// from running forever (and the upload from ballooning).
const MAX_SECONDS = 300;

/* Tap-to-record voice capture, lifted out of the composer so the whole input
   row can switch into a recording bar. Tap start() to begin, then either
   stop() to send the clip via onSend, or cancel() to discard it.

   Returns { recording, elapsed, start, stop, cancel }:
   · recording — is a capture in progress
   · elapsed   — seconds recorded so far (live, updates each second)        */
export function useVoiceRecorder({ onSend } = {}) {
  const t = useT();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef  = useRef(0);
  const activeRef = useRef(false);
  const timerRef  = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
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
      haptics.impact();
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startRef.current) / 1000);
        setElapsed(secs);
        if (secs >= MAX_SECONDS) stopRef.current();   // auto-stop + send
      }, 1000);
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
    return { uri, durationSec: secs };
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
