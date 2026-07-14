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
import { onSessionExpired, refreshNow } from '../lib/session';

const AuthContext = createContext(null);

const NAME_KEY  = 'hl_driver_name';
const EMAIL_KEY = 'hl_driver_email';
const OKEY      = 'hl_onboarded';

export function AuthProvider({ children }) {
  const [userId,        setUserId]        = useState(null);
  const [userRole,      setUserRole]      = useState(null);
  const [userName,      setUserName]      = useState('');
  const [userEmail,     setUserEmail]     = useState('');
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
    fetchDriver(claims.userId).then(setDriverProfile).catch(() => {});
    registerForPushNotifications(claims.userId);
  };

  const signOut = async () => {
    // Tear down device-level channels while the token still works: stop the
    // background GPS task and deactivate this device's push token so a
    // signed-out phone doesn't keep receiving the old driver's messages.
    await stopBackgroundTracking();
    await unregisterPushNotifications(userId);
    await clearToken();
    await clearRefreshToken();
    await AsyncStorage.multiRemove([NAME_KEY, EMAIL_KEY]);
    setUserId(null);
    setUserRole(null);
    setUserName('');
    setUserEmail('');
    setDriverProfile(null);
  };

  // Terminal session expiry: the Identity service rejected our refresh token
  // (revoked, or the driver was away longer than its lifetime). Sign out and
  // leave a notice for the sign-in screen so the logout isn't mysterious.
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  useEffect(() => onSessionExpired(() => {
    setSessionNotice('Your session expired — please sign in again.');
    signOutRef.current();
  }), []);

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
      phone:     p.phoneNumber || p.phone || '',
      photoUrl:  p.photoUrl    || null,
      truck:     p.truck      || p.truckInfo     || p.vehicleInfo || '',
      dispatcher: p.dispatcher || null,
    };
  }, [userId, userRole, userName, userEmail, driverProfile]);

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
