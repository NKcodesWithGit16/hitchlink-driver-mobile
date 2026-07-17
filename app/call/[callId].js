// Landing point for a tapped "Incoming call" push notification — reached when
// the app was backgrounded/killed and missed the live SignalR IncomingCall
// event. Fetches the call (if still ringing) into CallContext, which drives
// the actual UI via the globally-mounted CallOverlay, then steps back onto
// a normal screen underneath it.
import { useEffect, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCall } from '../../src/context/CallContext';

export default function CallFallback() {
  const { callId } = useLocalSearchParams();
  const router = useRouter();
  const { loadCallFallback } = useCall();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !callId) return;
    ran.current = true;
    loadCallFallback(String(callId)).finally(() => router.replace('/(tabs)/messages'));
  }, [callId, loadCallFallback, router]);

  return null;
}
