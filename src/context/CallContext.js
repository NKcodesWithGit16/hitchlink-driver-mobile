// Global in-app calling state — mounted once at the root layout so a
// dispatcher-initiated call rings no matter which tab is open. Mirrors the
// dispatcher web app's CallContext.js; the only real difference is this side
// also has a `tel:` fallback (see Messages screen) for cellular dead zones.
//
// Audio-only MVP: never requests the camera.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useCallSocket } from '../hooks/useCallSocket';
import { startCall as apiStartCall, getCall, acceptCall as apiAcceptCall, declineCall as apiDeclineCall, endCall as apiEndCall } from '../api/calls';
import { startRinging, stopRinging } from '../lib/sound';

let Daily = null;
try {
  Daily = require('@daily-co/react-native-daily-js').default;
} catch {
  Daily = null;
}

const CallContext = createContext(null);

const initialState = {
  status: 'idle', // idle | ringing-out | ringing-in | active | ended
  callId: null,
  peerName: null,
  roomUrl: null,
  token: null,
  muted: false,
  error: null,
  startedAt: null,
};

export function CallProvider({ children }) {
  const { user, signedIn } = useAuth();
  const [state, setState] = useState(initialState);
  const callObjectRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const teardownCallObject = useCallback(async () => {
    const co = callObjectRef.current;
    callObjectRef.current = null;
    if (co) {
      try { await co.leave(); } catch {}
      try { co.destroy(); } catch {}
    }
  }, []);

  const reset = useCallback(() => {
    teardownCallObject();
    setState(initialState);
  }, [teardownCallObject]);

  const joinDailyRoom = useCallback(async (roomUrl, token) => {
    if (!Daily) {
      setState((s) => ({ ...initialState, status: 'ended', error: 'Calling is unavailable on this build.' }));
      return;
    }
    const co = Daily.createCallObject({ audioSource: true, videoSource: false });
    callObjectRef.current = co;
    await co.join({ url: roomUrl, token, startVideoOff: true });
    setState((s) => ({ ...s, status: 'active', startedAt: Date.now() }));
  }, []);

  // ── Outgoing: driver taps Call on the Messages header ──────────────────
  const startCall = useCallback(async () => {
    if (!user?.id || stateRef.current.status !== 'idle') return;
    setState({ ...initialState, status: 'ringing-out', peerName: user?.dispatcher?.name || 'Dispatcher' });
    try {
      const res = await apiStartCall(user.id);
      setState((s) => (s.status === 'ringing-out'
        ? { ...s, callId: res.callId, roomUrl: res.roomUrl, token: res.token }
        : s));
    } catch (err) {
      setState({ ...initialState, status: 'ended', error: 'Could not start the call.' });
      setTimeout(() => setState((s) => (s.status === 'ended' ? initialState : s)), 2500);
    }
  }, [user?.id, user?.dispatcher]);

  // ── Incoming: dispatcher called the driver (live SignalR event) ────────
  const onIncomingCall = useCallback((p) => {
    if (stateRef.current.status !== 'idle') return; // already on a call
    setState({
      ...initialState,
      status: 'ringing-in',
      callId: p.callId,
      peerName: p.callerName || 'Dispatcher',
      roomUrl: p.roomUrl,
      token: p.token,
    });
  }, []);

  // ── Fallback: push-notification tap (app was backgrounded/killed, so the
  // live SignalR event above was never caught). Re-fetches the call if it's
  // still ringing; a no-op if it already timed out or was answered elsewhere.
  const loadCallFallback = useCallback(async (callId) => {
    if (stateRef.current.status !== 'idle') return;
    try {
      const res = await getCall(callId);
      if (!res || res.status !== 'Ringing') return;
      setState({
        ...initialState,
        status: 'ringing-in',
        callId: res.callId,
        peerName: user?.dispatcher?.name || 'Dispatcher',
        roomUrl: res.roomUrl,
        token: res.token,
      });
    } catch {
      // Already answered/declined/expired — nothing to show.
    }
  }, [user?.dispatcher]);

  const acceptCall = useCallback(async () => {
    const { callId, roomUrl, token } = stateRef.current;
    if (!callId || !roomUrl) return;
    try {
      await apiAcceptCall(callId);
      await joinDailyRoom(roomUrl, token);
    } catch {
      reset();
    }
  }, [joinDailyRoom, reset]);

  const declineCall = useCallback(() => {
    const { callId } = stateRef.current;
    reset();
    if (callId) apiDeclineCall(callId).catch(() => {});
  }, [reset]);

  const hangUp = useCallback(() => {
    const { callId, status } = stateRef.current;
    const reason = status === 'ringing-out' ? 'cancelled' : undefined;
    reset();
    if (callId) apiEndCall(callId, reason).catch(() => {});
  }, [reset]);

  const toggleMute = useCallback(() => {
    const co = callObjectRef.current;
    if (!co) return;
    setState((s) => {
      const muted = !s.muted;
      co.setLocalAudio(!muted);
      return { ...s, muted };
    });
  }, []);

  const onCallAccepted = useCallback(({ callId }) => {
    const s = stateRef.current;
    if (s.callId !== callId || s.status !== 'ringing-out') return;
    joinDailyRoom(s.roomUrl, s.token);
  }, [joinDailyRoom]);

  const onCallDeclined = useCallback(({ callId }) => {
    if (stateRef.current.callId !== callId) return;
    reset();
  }, [reset]);

  const onCallEnded = useCallback(({ callId }) => {
    if (stateRef.current.callId !== callId) return;
    reset();
  }, [reset]);

  const onCallCancelled = useCallback(({ callId }) => {
    if (stateRef.current.callId !== callId) return;
    reset();
  }, [reset]);

  useCallSocket(signedIn ? user?.id : null, { onIncomingCall, onCallAccepted, onCallDeclined, onCallEnded, onCallCancelled });

  // Ring for as long as the call is waiting on either side — ringtone for an
  // incoming call, a quieter ringback tone while our own call rings out.
  useEffect(() => {
    if (state.status === 'ringing-in') startRinging('incoming');
    else if (state.status === 'ringing-out') startRinging('outgoing');
    else stopRinging();
  }, [state.status]);

  useEffect(() => () => { teardownCallObject(); stopRinging(); }, [teardownCallObject]);

  return (
    <CallContext.Provider value={{ ...state, startCall, acceptCall, declineCall, hangUp, toggleMute, loadCallFallback }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within a CallProvider');
  return ctx;
}
