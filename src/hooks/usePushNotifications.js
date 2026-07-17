// Push notifications: the driver's only way to learn about a new load,
// a cancelled load, or a dispatcher message while the app is closed or
// backgrounded (chat is REST + polling, so no socket wakes the app).
//
// Registration: after sign-in we ask permission, fetch the Expo push token
// and PATCH it to /drivers/{id}/push-token. The backend then targets this
// device for LoadAssigned / LoadCancelled / chat pushes.
//
// Loaded defensively like the other native-module hooks: on web or a build
// without expo-notifications, everything no-ops.

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { registerPushToken } from '../api/main';

let Notifications = null;
try {
  Notifications = require('expo-notifications');
} catch {
  Notifications = null;
}

// Show pushes even while the app is foregrounded — a "New Load Assigned"
// banner is useful mid-drive regardless of which screen is open.
if (Notifications?.setNotificationHandler) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

/**
 * Requests permission, fetches the Expo push token and registers it with the
 * backend so this device receives the driver's pushes. Call after sign-in.
 * @returns {Promise<boolean>} true when a token was registered.
 */
export async function registerForPushNotifications(driverId) {
  if (!Notifications || Platform.OS === 'web' || !driverId) return false;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'HitchLink',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1FB6CE',
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return false;

    const projectId =
      Constants?.easConfig?.projectId ??
      Constants?.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await registerPushToken(driverId, tokenData.data);
    return true;
  } catch (err) {
    // Android: throws until FCM credentials are uploaded to Expo.
    // iOS: throws on simulator / missing APNs entitlement.
    // Push is unavailable but the app must keep working.
    if (__DEV__) console.warn('[push] disabled:', err?.message || err);
    return false;
  }
}

/**
 * Deactivates this device's push token on the backend (best-effort).
 * Call on sign-out so a signed-out phone stops receiving the old
 * driver's messages.
 */
export async function unregisterPushNotifications(driverId) {
  if (!driverId) return;
  // Empty token — the backend's send guard skips blank tokens.
  await registerPushToken(driverId, '').catch(() => {});
}

/**
 * Mount once (root layout). Handles notification taps — including the tap
 * that cold-started the app — and clears the badge when the app opens.
 * Data shapes come from the backend: { type: "LoadAssigned"|"LoadCancelled",
 * loadId }, { type: "chat", driverId }, and { type: "call", callId }.
 */
export function usePushNotificationRouting(signedIn) {
  const router = useRouter();
  const responseSub = useRef(null);

  useEffect(() => {
    if (!Notifications || Platform.OS === 'web' || !signedIn) return undefined;

    const route = (data) => {
      if (data?.type === 'chat') router.push('/(tabs)/messages');
      else if (data?.type === 'call' && data?.callId) router.push(`/call/${data.callId}`);
      else if (data?.type === 'LoadAssigned' || data?.type === 'LoadCancelled') router.push('/(tabs)');
    };

    // Tap while the app is running (foreground or backgrounded).
    responseSub.current = Notifications.addNotificationResponseReceivedListener((response) => {
      route(response?.notification?.request?.content?.data);
    });

    // Tap that cold-started the app — the listener above never fires for it.
    Notifications.getLastNotificationResponseAsync?.()
      .then((response) => { if (response) route(response?.notification?.request?.content?.data); })
      .catch(() => {});

    Notifications.setBadgeCountAsync?.(0).catch(() => {});

    return () => responseSub.current?.remove();
  }, [signedIn]);
}
