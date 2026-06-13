import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

// QA override: ?offline=1 (web) forces the offline state for testing.
function forcedOffline() {
  try { return typeof window !== 'undefined' && /[?&]offline=1/.test(window.location?.search || ''); }
  catch { return false; }
}

const isUp = (s) => !!(s && s.isConnected && s.isInternetReachable !== false);

export function useNetworkStatus() {
  const [online, setOnline] = useState(!forcedOffline());

  useEffect(() => {
    if (forcedOffline()) { setOnline(false); return; }
    const unsub = NetInfo.addEventListener((s) => setOnline(isUp(s)));
    NetInfo.fetch().then((s) => setOnline(isUp(s))).catch(() => {});
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  return online;
}
