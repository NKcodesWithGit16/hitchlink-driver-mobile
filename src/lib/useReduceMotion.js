import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/* True when the OS "reduce motion" setting is on — all our animations
   check this and fall back to an instant, non-animated state. */
export function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => { if (mounted) setReduce(!!v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setReduce(!!v));
    return () => { mounted = false; sub?.remove?.(); };
  }, []);
  return reduce;
}
