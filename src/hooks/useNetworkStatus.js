import { useEffect, useState } from 'react';

/* Network detection, restored after the crash-diagnosis pass — but loaded
   defensively. If the native module ever fails to load (e.g. a build where it
   isn't linked yet), we fall back to "online" instead of letting it take down
   a screen. Requires @react-native-community/netinfo; after pulling, run
   `npx expo install @react-native-community/netinfo` and rebuild the dev client. */
let NetInfo = null;
try {
  NetInfo = require('@react-native-community/netinfo').default;
} catch {
  NetInfo = null;
}

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
    if (!NetInfo) return; // module unavailable → stay optimistic, never crash

    let unsub;
    try {
      unsub = NetInfo.addEventListener((s) => setOnline(isUp(s)));
      NetInfo.fetch().then((s) => setOnline(isUp(s))).catch(() => {});
    } catch {
      return; // a native hiccup must never crash the screen
    }
    return () => { try { unsub?.(); } catch {} };
  }, []);

  return online;
}
