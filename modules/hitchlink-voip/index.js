// Thin JS surface over the native HitchlinkVoip module (see ios/ for the
// Swift/ObjC side). Registers for APNs VoIP push and exposes the token plus
// a lookup for the call metadata a push carried — react-native-callkeep owns
// the actual CallKit ring UI and answer/end events; this module only owns
// getting the app woken via PushKit and reporting the call to CallKit.
import { requireNativeModule, EventEmitter } from 'expo-modules-core';

let NativeModule = null;
try {
  NativeModule = requireNativeModule('HitchlinkVoip');
} catch {
  NativeModule = null;
}

const emitter = NativeModule ? new EventEmitter(NativeModule) : null;

/** Starts PKPushRegistry registration. Call once, early (e.g. root layout). */
export function registerVoipPush() {
  NativeModule?.registerVoipPush();
}

/** Returns the current APNs VoIP token, or null if not yet issued. */
export function getVoipPushToken() {
  return NativeModule?.getVoipPushToken() ?? null;
}

/**
 * Looks up (and consumes) the call metadata — { serverCallId, roomUrl, token,
 * driverId, callerName } — the native push handler cached for this CallKit
 * call UUID. Call this once, right when react-native-callkeep's own
 * `answerCall` event fires with the same uuid.
 */
export function getPendingCallMetadata(uuid) {
  return NativeModule?.getPendingCallMetadata(uuid) ?? null;
}

/**
 * Mount once. Fires whenever the OS issues/rotates the VoIP token — pass a
 * callback rather than polling getVoipPushToken().
 */
export function addVoipPushTokenListener(listener) {
  if (!emitter) return { remove() {} };
  return emitter.addListener('onVoipPushTokenUpdated', listener);
}
