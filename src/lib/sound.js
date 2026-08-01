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

// How long to keep the one-shot message player alive before tearing it down and
// releasing quiet mode. This MUST outlast message.wav itself — `player.remove()`
// mid-playback cuts the sound off — so it tracks the asset's length plus
// headroom rather than being a round number chosen once. message.wav is 0.85s
// today; raise this if a longer ding is ever swapped in. (Nothing reads the
// asset's duration at runtime, so the coupling is only enforced here.)
const MESSAGE_SOUND_MS = 1200;

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
  }, MESSAGE_SOUND_MS);
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

/**
 * Stops the looping call sound, if any is playing. Safe to call repeatedly.
 *
 * The three steps are deliberately independent, and the order is deliberate.
 * This used to be one `try { pause(); remove(); } catch {}`, which had two ways
 * to strand a LOOPING player playing forever: a throwing `pause()` skipped the
 * `remove()` that actually frees it, and either failure was swallowed while the
 * module dropped its only reference — so no later call could retry, since the
 * `!ringPlayer` guard returned immediately. A ringback playing over a connected
 * call, unstoppable for the rest of the session, is exactly what that produced.
 *
 * `volume = 0` goes first because it is the one step that makes the phone quiet
 * on its own: even if both teardown calls fail, nothing is audible.
 */
export function stopRinging() {
  const player = ringPlayer;
  if (!player) return;
  ringPlayer = null;
  ringKind = null;

  let clean = true;
  try { player.volume = 0; } catch { /* silencing is best-effort; pause/remove still follow */ }
  try { player.pause(); } catch (err) { clean = false; console.warn('[Sound] ring pause() failed:', err); }
  try { player.remove(); } catch (err) { clean = false; console.warn('[Sound] ring remove() failed:', err); }

  // Retry once, off the current turn. The realistic cause is another subsystem
  // reconfiguring the audio session at this exact moment (Daily taking it over
  // for a call it is joining), which a moment later has settled.
  if (!clean) {
    setTimeout(() => {
      try { player.pause(); } catch { /* nothing further to try */ }
      try { player.remove(); } catch { /* nothing further to try */ }
    }, 300);
  }

  exitQuietMode();
}
