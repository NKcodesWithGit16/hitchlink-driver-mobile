// Notification audio: a one-shot "ding" for new chat messages, and looping
// ringtone/ringback for calls (CallContext drives start/stop from call
// status — see there for the ringing-in/ringing-out wiring).
//
// The app's default audio mode (see app/_layout.js) is playsInSilentMode:
// true, so voice notes are always audible — a deliberate choice for that
// feature. Message/call sounds should behave like a normal notification
// instead (silenced by the phone's silent switch), so we flip the session
// into "respect silent mode" for the duration of each sound and restore it
// afterward. A ref count handles overlap (e.g. a message ding arriving while
// a call rings) without one sound's end clobbering the other's mode.
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

const SOURCES = {
  message: require('../../assets/sounds/message.wav'),
  ringtone: require('../../assets/sounds/ringtone.wav'),
  ringback: require('../../assets/sounds/ringback.wav'),
};

let quietRefCount = 0;
function enterQuietMode() {
  quietRefCount += 1;
  if (quietRefCount === 1) setAudioModeAsync({ playsInSilentMode: false }).catch(() => {});
}
function exitQuietMode() {
  quietRefCount = Math.max(0, quietRefCount - 1);
  if (quietRefCount === 0) setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
}

/** Plays the message ding once. Fire-and-forget. */
export function playMessageSound() {
  enterQuietMode();
  let player;
  try {
    player = createAudioPlayer(SOURCES.message);
    player.play();
  } catch {
    exitQuietMode();
    return;
  }
  setTimeout(() => {
    try { player.remove(); } catch {}
    exitQuietMode();
  }, 600);
}

let ringPlayer = null;
let ringKind = null;

/**
 * Starts (or switches) the looping call sound.
 * @param {'incoming'|'outgoing'} kind
 */
export function startRinging(kind) {
  if (ringPlayer && ringKind === kind) return;
  stopRinging();
  enterQuietMode();
  try {
    ringPlayer = createAudioPlayer(kind === 'outgoing' ? SOURCES.ringback : SOURCES.ringtone);
    ringPlayer.loop = true;
    ringPlayer.volume = kind === 'outgoing' ? 0.6 : 1;
    ringPlayer.play();
    ringKind = kind;
  } catch {
    ringPlayer = null;
    ringKind = null;
    exitQuietMode();
  }
}

/** Stops the looping call sound, if any is playing. Safe to call repeatedly. */
export function stopRinging() {
  if (!ringPlayer) return;
  try { ringPlayer.pause(); ringPlayer.remove(); } catch {}
  ringPlayer = null;
  ringKind = null;
  exitQuietMode();
}
