// Global in-app calling state — mounted once at the root layout so a
// dispatcher-initiated call rings no matter which tab is open. Mirrors the
// dispatcher web app's CallContext.js; the only real difference is this side
// also has a `tel:` fallback (see Messages screen) for cellular dead zones.
//
// Audio-only MVP: never requests the camera.
//
// iOS lock-screen ringing: a dispatcher-initiated call also triggers an APNs
// VoIP push (see backend DriverCallPushService), which expo-callkit-telecom
// reports straight to CallKit natively — before this JS is necessarily
// running — so the phone genuinely rings even locked/backgrounded. The
// SignalR "IncomingCall" path below stays as the foreground-live path and as
// the fallback for as long as VoIP push isn't configured/registered yet
// (Android always, iOS until Apple credentials are set up) — see
// callKitCallIdsRef, which lets CallKit's path take exclusive ownership of a
// call the moment it reports it, without the two paths double-ringing.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
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

let CallKit = null;
try {
  CallKit = Platform.OS === 'ios' ? require('expo-callkit-telecom') : null;
} catch {
  CallKit = null;
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

  // CallKit bookkeeping: nativeSessionId -> the call metadata carried in the
  // VoIP push (serverCallId/roomUrl/token/callerName), and the set of
  // serverCallIds CallKit has already reported (so the SignalR path below
  // knows to stand down for that call instead of double-ringing).
  const callKitMetaRef = useRef(new Map());
  const callKitCallIdsRef = useRef(new Set());

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
      console.error('[Call] Daily native module unavailable — is this build using a dev client with @daily-co/react-native-daily-js linked?');
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
    // CallKit already reported (or is about to report) this exact call
    // natively — let its own screen/ringtone own it instead of also showing
    // our JS overlay + ringtone on top of it.
    if (callKitCallIdsRef.current.has(String(p.callId))) return;
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
    } catch (err) {
      console.error('[Call] acceptCall failed:', err);
      teardownCallObject();
      setState({ ...initialState, status: 'ended', error: 'Could not connect the call.' });
      setTimeout(() => setState((s) => (s.status === 'ended' ? initialState : s)), 2500);
      // apiAcceptCall above may already have flipped the call to Accepted
      // server-side before the join itself failed — /decline only works while
      // still Ringing and would silently 409 here, leaving the call stuck
      // "Accepted" and blocking every future call for this driver until the
      // backend's 20-minute self-heal catches it. /end is idempotent across
      // both Ringing and Accepted, so it always actually clears the call.
      if (callId) apiEndCall(callId).catch(() => {});
    }
  }, [joinDailyRoom, teardownCallObject]);

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

  // ── CallKit (iOS): reacts to the native call UI a VoIP push already put on
  // screen — see the module-level comment for how this and the SignalR path
  // above divide ownership of a given call.
  useEffect(() => {
    if (!CallKit) return undefined;

    // Fired once CallKit accepts the native call report (from the VoIP push
    // the backend sent alongside "IncomingCall") — cache the metadata we need
    // to actually answer it later, keyed by CallKit's own session id.
    const onSessionAdded = (event) => {
      const session = event?.session ?? event;
      const info = session?.incomingCallEvent;
      if (!session?.id || !info?.serverCallId) return;
      callKitMetaRef.current.set(session.id, {
        serverCallId: info.serverCallId,
        roomUrl: info.metadata?.roomUrl,
        token: info.metadata?.token,
        callerName: info.caller?.displayName || 'Dispatcher',
      });
      callKitCallIdsRef.current.add(String(info.serverCallId));
    };

    // Fired when the user taps Accept on CallKit's native screen — including
    // from the lock screen. Joins Daily the same way acceptCall() does, then
    // tells CallKit the media connected once it has.
    const onAnswered = (event) => {
      const meta = callKitMetaRef.current.get(event?.id);
      if (!meta?.serverCallId || !meta.roomUrl) return;
      setState({
        ...initialState,
        status: 'ringing-in',
        callId: meta.serverCallId,
        peerName: meta.callerName,
        roomUrl: meta.roomUrl,
        token: meta.token,
      });
      apiAcceptCall(meta.serverCallId)
        .then(() => joinDailyRoom(meta.roomUrl, meta.token))
        .then(() => CallKit.fulfillIncomingCallConnected(event.requestId))
        .catch((err) => {
          console.error('[Call] CallKit accept failed:', err);
          reset();
          // Same reasoning as acceptCall() above — accept may have already
          // landed server-side, so /end (not /decline) is what actually
          // clears it instead of leaving a stuck Accepted call.
          apiEndCall(meta.serverCallId).catch(() => {});
        });
    };

    // Fired when the call ends for any reason — user hit CallKit's decline/
    // end button, the other side hung up (reflected back into CallKit by our
    // own SignalR handlers above via reportCallEnded — not wired yet, so for
    // now this only covers the local end/decline action), or it timed out.
    const onEnded = (event) => {
      const session = event?.session;
      const meta = callKitMetaRef.current.get(event?.id)
        ?? { serverCallId: session?.incomingCallEvent?.serverCallId };
      callKitMetaRef.current.delete(event?.id);
      const serverCallId = meta.serverCallId;
      if (serverCallId) callKitCallIdsRef.current.delete(String(serverCallId));
      const wasActive = stateRef.current.status === 'active' && String(stateRef.current.callId) === String(serverCallId);
      reset();
      if (!serverCallId) return;
      if (wasActive) apiEndCall(serverCallId).catch(() => {});
      else apiDeclineCall(serverCallId).catch(() => {});
    };

    const subs = [
      CallKit.addCallSessionAddedListener(onSessionAdded),
      CallKit.addCallAnsweredListener(onAnswered),
      CallKit.addCallEndedListener(onEnded),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [joinDailyRoom, reset]);

  // Ring for as long as the call is waiting on either side — ringtone for an
  // incoming call, a quieter ringback tone while our own call rings out.
  useEffect(() => {
    if (state.status === 'ringing-in') startRinging('incoming');
    else if (state.status === 'ringing-out') startRinging('outgoing');
    else stopRinging();
  }, [state.status]);

  // Ring timeout — mirrors the dispatcher web app's RING_TIMEOUT_MS. Without
  // this, a ring nobody answers (app killed, notch of dead air, CallKit's own
  // timeout not firing because VoIP push isn't configured yet) leaves this
  // side stuck on the ringing overlay forever with no way back except a
  // reload, and never tells the backend to free up the call. Re-armed
  // whenever status/callId change, and torn down the moment either does
  // (accept, decline, hang up, or a remote CallAccepted/Declined/Ended event).
  const RING_TIMEOUT_MS = 45000;
  useEffect(() => {
    if (state.status !== 'ringing-in' && state.status !== 'ringing-out') return undefined;
    const { status, callId } = state;
    const timer = setTimeout(() => {
      const s = stateRef.current;
      if (s.status !== status || s.callId !== callId) return; // already resolved elsewhere
      teardownCallObject();
      if (status === 'ringing-out') {
        setState({ ...initialState, status: 'ended', error: 'No answer.' });
        setTimeout(() => setState((cur) => (cur.status === 'ended' ? initialState : cur)), 2500);
      } else {
        setState(initialState);
      }
      if (callId) apiEndCall(callId, 'timeout').catch(() => {});
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.status, state.callId, teardownCallObject]);

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
