import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { weatherAlert, notifications as seedNotifications } from '../data/mock';

const AlertContext = createContext(null);

// One provider owns two related things:
//  1. The weather takeover  — a single high-priority alert that arrives live,
//     slides in a top toast, and can escalate to a full-screen modal.
//  2. The notifications inbox — the full Alerts feed (loads, HOS, docs, pay,
//     weather) with read/unread state, reached from the home bell.
// The weather item lives in both: it drives the takeover *and* appears as a
// row in the inbox, so the two surfaces never disagree.
export function AlertProvider({ children }) {
  // ── Weather takeover ──
  const [activeAlert, setActiveAlert] = useState(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  // ── Notifications inbox ──
  const [items, setItems] = useState(seedNotifications);

  // Simulate the weather alert arriving 4s after launch — the toast is the
  // live "something just happened" moment (the row already sits unread in the
  // inbox from the start).
  useEffect(() => {
    if (!weatherAlert) return;
    const t = setTimeout(() => {
      setActiveAlert(weatherAlert);
      setToastVisible(true);
    }, 4000);
    return () => clearTimeout(t);
  }, []);

  const markRead = useCallback(
    (id) => setItems((xs) => xs.map((n) => (n.id === id ? { ...n, read: true } : n))),
    [],
  );
  const markAllRead = useCallback(
    () => setItems((xs) => xs.map((n) => ({ ...n, read: true }))),
    [],
  );
  const dismiss = useCallback(
    (id) => setItems((xs) => xs.filter((n) => n.id !== id)),
    [],
  );
  const clearAll = useCallback(() => setItems([]), []);
  // Restore a previous snapshot — powers Undo after a Clear all.
  const restoreAll = useCallback((snapshot) => setItems(snapshot), []);

  const dismissToast = useCallback(() => setToastVisible(false), []);

  // Opening the takeover also marks the weather row read. Guard activeAlert so
  // it still works if the inbox row is tapped before the 4s live-arrival timer.
  const openModal = useCallback(() => {
    setActiveAlert((a) => a || weatherAlert);
    setToastVisible(false);
    setModalVisible(true);
    markRead('n-weather');
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
    markRead,
    markAllRead,
    dismiss,
    clearAll,
    restoreAll,
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
