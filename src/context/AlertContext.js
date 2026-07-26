import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { weatherAlert } from '../data/mock';
import { USE_MOCK } from '../api/config';
import { useAuth } from './AuthContext';
import { useWeather } from './WeatherContext';
import {
  fetchNotifications, markNotificationRead, dismissNotification,
} from '../api/main';

const AlertContext = createContext(null);

// One provider owns two related things:
//  1. The weather takeover  — a single high-priority alert that arrives live,
//     slides in a top toast, and can escalate to a full-screen modal. This is
//     a demo-only simulation (the backend has no weather feed yet) so it only
//     runs in mock mode.
//  2. The notifications inbox — the full Alerts feed, backed by the live
//     `/notifications` API (loads, driver, settlement, etc.) with read/unread
//     and dismiss state, reached from the home bell.
export function AlertProvider({ children }) {
  const { userId, signedIn } = useAuth();
  const { weatherAlert: liveWeatherAlert } = useWeather();

  // ── Weather takeover (demo-only) ──
  const [activeAlert, setActiveAlert] = useState(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  // ── Notifications inbox ──
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  // Latest list, so bulk/deferred actions read fresh state without re-binding
  // every callback to `items`.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Ids removed from the UI but not yet committed to the backend — the Undo
  // window. Committed on undo-toast expiry, discarded on Undo. See commitPending.
  const pendingRef = useRef([]);

  const refresh = useCallback(async () => {
    // Live mode needs a signed-in user; mock mode serves fixtures regardless.
    if (!USE_MOCK && !signedIn) { setItems([]); return; }
    setLoading(true);
    try {
      const data = await fetchNotifications(userId);
      setItems(Array.isArray(data) ? data : []);
    } catch {
      // Leave the last-known list in place on a transient failure.
    } finally {
      setLoading(false);
    }
  }, [userId, signedIn]);

  // Load (and reload when the signed-in user changes).
  useEffect(() => { refresh(); }, [refresh]);

  // Simulate the weather alert arriving 4s after launch — the toast is the
  // live "something just happened" moment. Demo-only: gated to mock mode.
  useEffect(() => {
    if (!USE_MOCK || !weatherAlert) return;
    const t = setTimeout(() => {
      setActiveAlert(weatherAlert);
      setToastVisible(true);
    }, 4000);
    return () => clearTimeout(t);
  }, []);

  // Live: surface a real weather alert the moment a heartbeat response
  // carries one. Keeps activeAlert's displayed data fresh on every recheck
  // (etaMinutes counts down as the truck gets closer), but only pops the
  // toast when it's actually a new/changed alert — the server itself may
  // re-report the same still-active alert every ~15 min, and re-popping the
  // takeover that often for an unchanged warning would be more annoying than
  // useful. Clearing back to null (alert resolved) resets the tracker, so a
  // later alert — even one with the same title/area — pops again as new.
  const lastLiveAlertKeyRef = useRef(null);
  useEffect(() => {
    if (USE_MOCK) return;
    if (!liveWeatherAlert) { lastLiveAlertKeyRef.current = null; return; }
    const key = `${liveWeatherAlert.title}|${liveWeatherAlert.near}`;
    const isNew = key !== lastLiveAlertKeyRef.current;
    lastLiveAlertKeyRef.current = key;
    setActiveAlert(liveWeatherAlert);
    if (isNew) setToastVisible(true);
  }, [liveWeatherAlert]);

  // Read state is idempotent on the backend, so commit it immediately (optimistic).
  const markRead = useCallback((id) => {
    setItems((xs) => xs.map((n) => (n.id === id ? { ...n, read: true } : n)));
    markNotificationRead(id).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    const unread = itemsRef.current.filter((n) => !n.read);
    setItems((xs) => xs.map((n) => ({ ...n, read: true })));
    unread.forEach((n) => markNotificationRead(n.id).catch(() => {}));
  }, []);

  // Dismiss/clear remove from the UI immediately but *defer* the backend
  // delete (which is irreversible) until the Undo window closes.
  const dismiss = useCallback((id) => {
    pendingRef.current = [...pendingRef.current, id];
    setItems((xs) => xs.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    pendingRef.current = [...pendingRef.current, ...itemsRef.current.map((n) => n.id)];
    setItems([]);
  }, []);

  // Undo: restore the pre-removal snapshot and cancel the pending deletes so
  // they never reach the backend.
  const restoreAll = useCallback((snapshot) => {
    pendingRef.current = [];
    setItems(snapshot);
  }, []);

  // Commit the deferred deletes to the backend (undo window expired, or the
  // screen is tearing down and we don't want the rows to resurrect on refetch).
  const commitPending = useCallback(() => {
    const ids = pendingRef.current;
    pendingRef.current = [];
    ids.forEach((id) => dismissNotification(id).catch(() => {}));
  }, []);

  const dismissToast = useCallback(() => setToastVisible(false), []);

  // Opening the takeover also marks the weather row read — 'n-weather' is a
  // synthetic id that only exists in the mock inbox fixture. A live alert
  // isn't (yet) mirrored into the notifications inbox by a client-known id,
  // so there's nothing to mark read there.
  const openModal = useCallback(() => {
    setActiveAlert((a) => a || (USE_MOCK ? weatherAlert : null));
    setToastVisible(false);
    setModalVisible(true);
    if (USE_MOCK) markRead('n-weather');
  }, [markRead]);

  const closeModal = useCallback(() => setModalVisible(false), []);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);

  const value = {
    // weather takeover
    activeAlert,
    toastVisible,
    modalVisible,
    dismissToast,
    openModal,
    closeModal,
    // notifications inbox
    notifications: items,
    unreadCount,
    loading,
    refresh,
    markRead,
    markAllRead,
    dismiss,
    clearAll,
    restoreAll,
    commitPending,
    // back-compat: the home bell used a boolean before the inbox existed
    unread: unreadCount > 0,
  };
  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
}

export function useAlert() {
  return useContext(AlertContext);
}

// Alias for inbox-facing screens — same context, clearer intent at the callsite.
export function useNotifications() {
  return useContext(AlertContext);
}
