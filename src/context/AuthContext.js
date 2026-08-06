import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  readToken, writeToken, clearToken,
  readRefreshToken, writeRefreshToken, clearRefreshToken,
} from '../utils/tokenStorage';
import { readUserFromToken } from '../utils/jwtUtils';
import { fetchDriver } from '../api/main';
import { registerForPushNotifications, unregisterPushNotifications } from '../hooks/usePushNotifications';
import { stopBackgroundTracking } from '../lib/backgroundLocation';
import { cancelAllLocalReminders } from '../lib/localNotifications';
import { clearAll as clearDocumentCache } from '../lib/docCache';
import { onSessionExpired, refreshNow, SESSION_END_DEACTIVATED } from '../lib/session';
import { identify } from '../lib/observability';
import { useT } from '../i18n/LanguageContext';

const AuthContext = createContext(null);

const NAME_KEY  = 'hl_driver_name';
const EMAIL_KEY = 'hl_driver_email';
const OKEY      = 'hl_onboarded';

export function AuthProvider({ children }) {
  const t = useT();
  const [userId,        setUserId]        = useState(null);
  const [userRole,      setUserRole]      = useState(null);
  const [userName,      setUserName]      = useState('');
  const [userEmail,     setUserEmail]     = useState('');
  // Read off the access token, never stored: see readUserFromToken. Surfaced in
  // More > Profile because a driver who forgets it has no self-service recovery.
  const [userUsername,  setUserUsername]  = useState('');
  const [driverProfile, setDriverProfile] = useState(null);
  const [onboarded,     setOnboarded]     = useState(false);
  const [ready,         setReady]         = useState(false);
  // Set when the session ends without the driver asking for it (refresh token
  // rejected) — the sign-in screen shows it so the logout isn't mysterious.
  const [sessionNotice, setSessionNotice] = useState('');

  // Boot: restore session from stored token
  useEffect(() => {
    (async () => {
      try {
        let [token, name, email, o] = await Promise.all([
          readToken(),
          AsyncStorage.getItem(NAME_KEY),
          AsyncStorage.getItem(EMAIL_KEY),
          AsyncStorage.getItem(OKEY),
        ]);
        let claims = readUserFromToken(token);
        // Access token expired while the app was closed — try the refresh
        // token before bouncing the driver to the sign-in screen.
        if (!claims?.userId && (await readRefreshToken())) {
          const fresh = await refreshNow();
          if (fresh) {
            token = fresh;
            claims = readUserFromToken(fresh);
          }
        }
        if (claims?.userId) {
          setUserId(claims.userId);
          setUserRole(claims.role);
          setUserName(name || '');
          setUserEmail(email || '');
          setUserUsername(claims.username || '');
          // Fetch driver profile in background — screens handle null gracefully
          fetchDriver(claims.userId).then(setDriverProfile).catch(() => {});
          // Re-register push on every boot: the Expo token can rotate, and the
          // call is an idempotent PATCH.
          registerForPushNotifications(claims.userId);
        }
        if (o === '1') setOnboarded(true);
      } catch {}
      setReady(true);
    })();
  }, []);

  // Called by sign-in screen after a successful login()
  const signIn = async (token, name, email, refreshToken = null) => {
    const claims = readUserFromToken(token);
    if (!claims?.userId) throw new Error('Invalid token received from server');
    await writeToken(token);
    await writeRefreshToken(refreshToken);
    await AsyncStorage.multiSet([
      [NAME_KEY,  name  || ''],
      [EMAIL_KEY, email || ''],
    ]);
    setSessionNotice('');
    setUserId(claims.userId);
    setUserRole(claims.role);
    setUserName(name  || '');
    setUserEmail(email || '');
    setUserUsername(claims.username || '');
    fetchDriver(claims.userId).then(setDriverProfile).catch(() => {});
    registerForPushNotifications(claims.userId);
  };

  const signOut = async () => {
    // Tear down device-level channels while the token still works: stop the
    // background GPS task and deactivate this device's push token so a
    // signed-out phone doesn't keep receiving the old driver's messages.
    await stopBackgroundTracking();
    await unregisterPushNotifications(userId);
    // Locally-scheduled reminders live on the device, not the server, so
    // deactivating the push token doesn't stop them — a signed-out phone would
    // otherwise keep announcing the previous driver's break and CDL expiry.
    await cancelAllLocalReminders();
    // Same reasoning for the offline document copies: a driver's CDL, medical
    // card and insurance are sitting in this app's own storage, and a shared
    // cab phone must not hand them to whoever signs in next.
    await clearDocumentCache(userId);
    await clearToken();
    await clearRefreshToken();
    await AsyncStorage.multiRemove([NAME_KEY, EMAIL_KEY]);
    setUserId(null);
    setUserRole(null);
    setUserName('');
    setUserEmail('');
    setUserUsername('');
    setDriverProfile(null);
  };

  // Tag crash reports with the driver id (and only the id) so a field crash
  // can be traced back to the shift and load it happened on. Cleared on sign
  // out so a shared cab phone never attributes one driver's crash to another.
  useEffect(() => { identify(userId); }, [userId]);

  // Terminal session expiry: the Identity service rejected our refresh token
  // (revoked, or the driver was away longer than its lifetime). Sign out and
  // leave a notice for the sign-in screen so the logout isn't mysterious.
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  // A removed driver gets told why. "Session expired" would send them round the
  // sign-in screen retyping a password that Identity will never accept again,
  // and leave them assuming the app is broken rather than that their dispatcher
  // ended their access.
  useEffect(() => onSessionExpired((reason) => {
    setSessionNotice(
      reason === SESSION_END_DEACTIVATED
        ? t('auth.accountRemoved')
        : t('auth.sessionExpired'),
    );
    signOutRef.current();
  }), [t]);

  const completeOnboarding = () => {
    setOnboarded(true);
    AsyncStorage.setItem(OKEY, '1').catch(() => {});
  };

  // Called after a successful profile save so the hero header, greeting, etc.
  // reflect the new name/email immediately — no need to re-fetch the driver.
  const updateDriverProfile = (patch) => {
    setDriverProfile((prev) => ({ ...(prev || {}), ...patch }));
    const newName = [patch.firstName, patch.lastName].filter(Boolean).join(' ').trim();
    if (newName) {
      setUserName(newName);
      AsyncStorage.setItem(NAME_KEY, newName).catch(() => {});
    }
    if (patch.email) {
      setUserEmail(patch.email);
      AsyncStorage.setItem(EMAIL_KEY, patch.email).catch(() => {});
    }
  };

  // Expose a `user` object shaped like the old mock driver so existing
  // screens that read user.name / user.truck / user.firstName keep working.
  const user = useMemo(() => {
    if (!userId) return null;
    const p = driverProfile || {};
    return {
      id:        userId,
      role:      userRole,
      name:      p.name       || p.displayName  || userName || 'Driver',
      firstName: p.firstName  || (userName.split(' ')[0]) || 'Driver',
      lastName:  p.lastName   || '',
      email:     p.email      || userEmail,
      // The login name, not the display name. Only the token knows it — the
      // driver record in Main has no copy, since credentials live in Identity.
      username:  userUsername,
      phone:     p.phoneNumber || p.phone || '',
      photoUrl:  p.photoUrl    || null,
      truck:     p.truck      || p.truckInfo     || p.vehicleInfo || '',
      dispatcher: p.dispatcher || null,
    };
  }, [userId, userRole, userName, userEmail, userUsername, driverProfile]);

  const value = useMemo(() => ({
    user,
    userId,
    userRole,
    signedIn: !!userId,
    onboarded,
    ready,
    driverProfile,
    sessionNotice,
    signIn,
    signOut,
    completeOnboarding,
    updateDriverProfile,
  }), [user, userId, userRole, onboarded, ready, driverProfile, sessionNotice]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
