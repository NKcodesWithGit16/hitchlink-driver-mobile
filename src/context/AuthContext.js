import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readToken, writeToken, clearToken } from '../utils/tokenStorage';
import { readUserFromToken } from '../utils/jwtUtils';
import { fetchDriver } from '../api/main';

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

  // Boot: restore session from stored token
  useEffect(() => {
    (async () => {
      try {
        const [token, name, email, o] = await Promise.all([
          readToken(),
          AsyncStorage.getItem(NAME_KEY),
          AsyncStorage.getItem(EMAIL_KEY),
          AsyncStorage.getItem(OKEY),
        ]);
        const claims = readUserFromToken(token);
        if (claims?.userId) {
          setUserId(claims.userId);
          setUserRole(claims.role);
          setUserName(name || '');
          setUserEmail(email || '');
          // Fetch driver profile in background — screens handle null gracefully
          fetchDriver(claims.userId).then(setDriverProfile).catch(() => {});
        }
        if (o === '1') setOnboarded(true);
      } catch {}
      setReady(true);
    })();
  }, []);

  // Called by sign-in screen after a successful login()
  const signIn = async (token, name, email) => {
    const claims = readUserFromToken(token);
    if (!claims?.userId) throw new Error('Invalid token received from server');
    await writeToken(token);
    await AsyncStorage.multiSet([
      [NAME_KEY,  name  || ''],
      [EMAIL_KEY, email || ''],
    ]);
    setUserId(claims.userId);
    setUserRole(claims.role);
    setUserName(name  || '');
    setUserEmail(email || '');
    fetchDriver(claims.userId).then(setDriverProfile).catch(() => {});
  };

  const signOut = async () => {
    await clearToken();
    await AsyncStorage.multiRemove([NAME_KEY, EMAIL_KEY]);
    setUserId(null);
    setUserRole(null);
    setUserName('');
    setUserEmail('');
    setDriverProfile(null);
  };

  const completeOnboarding = () => {
    setOnboarded(true);
    AsyncStorage.setItem(OKEY, '1').catch(() => {});
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
      phone:     p.phone      || '',
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
    signIn,
    signOut,
    completeOnboarding,
  }), [user, userId, userRole, onboarded, ready, driverProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
