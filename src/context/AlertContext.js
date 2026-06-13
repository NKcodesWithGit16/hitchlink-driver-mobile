import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { weatherAlert } from '../data/mock';

const AlertContext = createContext(null);

export function AlertProvider({ children }) {
  const [activeAlert, setActiveAlert] = useState(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [unread, setUnread] = useState(false);

  // Simulate a weather alert arriving 4 seconds after launch.
  useEffect(() => {
    if (!weatherAlert) return;
    const t = setTimeout(() => {
      setActiveAlert(weatherAlert);
      setToastVisible(true);
      setUnread(true);
    }, 4000);
    return () => clearTimeout(t);
  }, []);

  const dismissToast = useCallback(() => setToastVisible(false), []);

  const openModal = useCallback(() => {
    setToastVisible(false);
    setUnread(false);
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => setModalVisible(false), []);

  const value = { activeAlert, toastVisible, modalVisible, unread, dismissToast, openModal, closeModal };
  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
}

export function useAlert() {
  return useContext(AlertContext);
}
