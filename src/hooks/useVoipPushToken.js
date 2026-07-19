// Registers this iOS device for APNs VoIP push (via the local `hitchlink-voip`
// native module's PKPushRegistry wrapper) and keeps the backend's copy of the
// token in sync. The token itself is what lets DriverCallPushService send a
// VoIP push instead of a regular banner for an incoming call — see
// CallContext.js for how that push (reported to CallKit by
// hitchlink-voip + react-native-callkeep) turns into an answered call.
//
// Android and any build without the native module no-op entirely (mirrors
// the defensive-require pattern used for Daily/expo-notifications elsewhere).
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { registerVoipPushToken } from '../api/main';

let Voip = null;
try {
  Voip = Platform.OS === 'ios' ? require('hitchlink-voip') : null;
} catch {
  Voip = null;
}

let didRegister = false;

/** Mount once (root layout), passed the signed-in driver's id. */
export function useVoipPushTokenSync(driverId) {
  const [token, setToken] = useState(() => Voip?.getVoipPushToken() ?? null);

  useEffect(() => {
    if (!Voip || didRegister) return;
    didRegister = true;
    Voip.registerVoipPush();
  }, []);

  useEffect(() => {
    if (!Voip) return undefined;
    const sub = Voip.addVoipPushTokenListener(({ token: t }) => setToken(t || null));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!driverId || !token) return;
    registerVoipPushToken(driverId, token).catch(() => {});
  }, [driverId, token]);
}
