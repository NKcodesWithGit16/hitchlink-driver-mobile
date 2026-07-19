// Registers this iOS device for APNs VoIP push (via expo-callkit-telecom's
// PKPushRegistry wrapper) and keeps the backend's copy of the token in sync.
// The token itself is what lets DriverCallPushService send a VoIP push
// instead of a regular banner for an incoming call — see CallContext.js for
// how that push gets turned into a ringing CallKit screen.
//
// Android and any build without the native module no-op entirely (mirrors
// the defensive-require pattern used for Daily/expo-notifications elsewhere).
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { registerVoipPushToken } from '../api/main';

let CallKit = null;
try {
  CallKit = Platform.OS === 'ios' ? require('expo-callkit-telecom') : null;
} catch {
  CallKit = null;
}

const SUPPORTED = !!CallKit;
// Stable for the app's lifetime either way, so calling it unconditionally
// below never violates the rules of hooks.
const useNativeVoipToken = SUPPORTED ? CallKit.useVoIPPushToken : () => null;

let didRegister = false;

/** Mount once (root layout), passed the signed-in driver's id. */
export function useVoipPushTokenSync(driverId) {
  useEffect(() => {
    if (!SUPPORTED || didRegister) return;
    didRegister = true;
    CallKit.registerVoIPPush();
  }, []);

  const voip = useNativeVoipToken();

  useEffect(() => {
    if (!SUPPORTED || !driverId || !voip?.token) return;
    registerVoipPushToken(driverId, voip.token).catch(() => {});
  }, [driverId, voip?.token]);
}
