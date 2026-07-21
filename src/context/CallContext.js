// Global in-app calling state — mounted once at the root layout so a
// dispatcher-initiated call rings no matter which tab is open. Mirrors the
// dispatcher web app's CallContext.js; the only real difference is this side
// also has a `tel:` fallback (see Messages screen) for cellular dead zones.
//
// Audio-only MVP: never requests the camera.
//
// iOS lock-screen ringing: a dispatcher-initiated call also triggers an APNs
// VoIP push (see backend DriverCallPushService), which the local
// `hitchlink-voip` native module (PKPushRegistry) reports straight to
// CallKit via react-native-callkeep — before this JS is necessarily running —
// so the phone genuinely rings even locked/backgrounded. On iOS, CallKit's
// native screen is the ONE incoming-call experience we want (product
// decision — more "professional" than our own in-app modal, and CallKit is
// the only path that rings from the lock screen at all). But its VoIP push
// is a separate delivery path from the live SignalR "IncomingCall" below and
// can arrive later — so on iOS, onIncomingCall holds off showing our own
// overlay for a short grace window (pendingSignalRIncomingRef) to let CallKit
// claim the call first (callKitCallIdsRef), and only falls back to the in-app
// overlay if CallKit never shows up in that window (a failed/unregistered
// push). On Android, which has no CallKit, the SignalR path is the only path
// and shows immediately, same as always.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useAuth } from './AuthContext';
import { useCallSocket } from '../hooks/useCallSocket';
import { startCall as apiStartCall, getCall, acceptCall as apiAcceptCall, declineCall as apiDeclineCall, endCall as apiEndCall } from '../api/calls';
import { startRinging, stopRinging } from '../lib/sound';
import { useT } from '../i18n/LanguageContext';

let Daily = null;
try {
  Daily = require('@daily-co/react-native-daily-js').default;
} catch {
  Daily = null;
}

let RNCallKeep = null;
let Voip = null;
try {
  if (Platform.OS === 'ios') {
    RNCallKeep = require('react-native-callkeep').default;
    Voip = require('hitchlink-voip');
  }
} catch {
  RNCallKeep = null;
  Voip = null;
}

// Raw native event-name constants react-native-callkeep replays through
// `didLoadWithEvents` for anything that fired before JS attached its
// listeners (e.g. the call was answered from the lock screen while the app
// was killed) — see the cold-start replay in the effect below.
const RAW_EVENT = {
  didDisplayIncomingCall: 'RNCallKeepDidDisplayIncomingCall',
  answerCall: 'RNCallKeepPerformAnswerCallAction',
  endCall: 'RNCallKeepPerformEndCallAction',
};

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
  const t = useT();
  const { user, signedIn } = useAuth();
  const [state, setState] = useState(initialState);
  const callObjectRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const acceptInFlightRef = useRef(false);

  // The set of serverCallIds CallKit has already reported (via a VoIP push) —
  // lets the SignalR path below stand down for that call instead of
  // double-ringing. The actual call metadata (roomUrl/token/callerName) lives
  // natively, keyed by CallKit's call UUID — see Voip.getPendingCallMetadata.
  const callKitCallIdsRef = useRef(new Set());
  // serverCallId -> CallKit's own callUUID, for calls CallKit answered (see
  // onAnswered below). Lets any JS-driven end of the call (remote hangup,
  // local hangup/decline, ring timeout) also retire CallKit's native session
  // — without this, ending the call any way OTHER than tapping CallKit's own
  // end button leaves iOS showing a phantom "active call" (lock screen,
  // Dynamic Island, in-call UI) that never clears, and can block/confuse the
  // next call.
  const callKitUuidBySrvIdRef = useRef(new Map());
  // Product decision: on iOS, CallKit's native incoming-call screen is the
  // one experience we want (more "professional" than our own in-app modal —
  // also gets the driver a lock-screen/Dynamic-Island ring our JS overlay
  // never could). But the VoIP push that triggers it is a separate delivery
  // path from this live SignalR event and can arrive later (or, rarely, not
  // at all — a failed push, an unregistered token). So on iOS we hold this
  // SignalR "IncomingCall" back for a short grace window instead of showing
  // our overlay immediately: if CallKit claims the call (onDisplayed) within
  // that window, we never show anything; if it doesn't, we fall back to the
  // in-app overlay rather than silently dropping the call. On Android there's
  // no CallKit to defer to, so this whole mechanism is skipped.
  const pendingSignalRIncomingRef = useRef(null); // { callId, timer } | null
  const CALLKIT_GRACE_MS = 3000;
  // "CallAccepted"/"CallDeclined" for our own outgoing call can arrive over
  // SignalR before the /start POST that tells us our own callId even
  // resolves. Without this, that event is unmatchable (we don't know our
  // callId yet) and gets silently dropped: the dispatcher is already
  // connected/hung up, and we sit on "Calling…" until the 45s ring timeout
  // eventually cleans it up. Set by onCallAccepted/onCallDeclined when that
  // happens; consumed by startCall once its POST resolves. There's only ever
  // one outgoing call in flight per client, so an early resolution can only
  // be about it.
  const pendingResolutionRef = useRef(null);

  const endCallKitSession = useCallback((serverCallId) => {
    if (!RNCallKeep || !serverCallId) return;
    const uuid = callKitUuidBySrvIdRef.current.get(String(serverCallId));
    if (!uuid) return;
    callKitUuidBySrvIdRef.current.delete(String(serverCallId));
    console.info(`[Call] Retiring CallKit session ${uuid} for call ${serverCallId}.`);
    try { RNCallKeep.endCall(uuid); } catch (err) { console.warn(`[Call] RNCallKeep.endCall(${uuid}) failed:`, err); }
  }, []);

  const teardownCallObject = useCallback(async () => {
    const co = callObjectRef.current;
    callObjectRef.current = null;
    if (co) {
      try { await co.leave(); } catch (err) { console.warn('[Call] co.leave() failed during teardown (likely already left):', err); }
      try { co.destroy(); } catch (err) { console.warn('[Call] co.destroy() failed during teardown (likely already destroyed):', err); }
    }
  }, []);

  const reset = useCallback(() => {
    endCallKitSession(stateRef.current.callId);
    teardownCallObject();
    setState(initialState);
  }, [teardownCallObject, endCallKitSession]);

  const joinDailyRoom = useCallback(async (roomUrl, token) => {
    if (!Daily) {
      console.error('[Call] Daily native module unavailable — is this build using a dev client with @daily-co/react-native-daily-js linked?');
      setState((s) => ({ ...initialState, status: 'ended', error: t('call.callingUnavailable') }));
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
    pendingResolutionRef.current = null;
    setState({ ...initialState, status: 'ringing-out', peerName: user?.dispatcher?.name || 'Dispatcher' });
    try {
      const res = await apiStartCall(user.id);
      const pending = pendingResolutionRef.current;
      pendingResolutionRef.current = null;
      if (stateRef.current.status !== 'ringing-out') return; // cancelled locally while /start was in flight

      if (pending && pending.callId === res.callId && pending.type === 'accepted') {
        // The dispatcher already answered before we even learned our own
        // callId (see pendingResolutionRef above) — join right away instead
        // of sitting on "Calling…" for a resolution that already happened.
        console.info(`[Call] ${res.callId} was already accepted before we learned our own callId — joining now instead of waiting.`);
        setState((s) => ({ ...s, callId: res.callId, roomUrl: res.roomUrl, token: res.token }));
        joinDailyRoom(res.roomUrl, res.token).catch((err) => {
          console.error(`[Call] Join failed for ${res.callId} (early-accepted path):`, err);
          teardownCallObject();
          setState({ ...initialState, status: 'ended', error: t('call.couldNotConnect') });
          setTimeout(() => setState((cur) => (cur.status === 'ended' ? initialState : cur)), 2500);
          apiEndCall(res.callId).catch(() => {});
        });
        return;
      }
      if (pending && pending.callId === res.callId) {
        // Declined (or ended) before we learned our own callId.
        console.info(`[Call] ${res.callId} was already ${pending.type} before we learned our own callId.`);
        setState({ ...initialState, status: 'ended', error: pending.type === 'declined' ? t('call.callDeclined') : t('call.callEndedError') });
        setTimeout(() => setState((cur) => (cur.status === 'ended' ? initialState : cur)), 2500);
        return;
      }
      setState((s) => (s.status === 'ringing-out'
        ? { ...s, callId: res.callId, roomUrl: res.roomUrl, token: res.token }
        : s));
    } catch (err) {
      console.error('[Call] startCall failed:', err);
      setState({ ...initialState, status: 'ended', error: t('call.couldNotStart') });
      setTimeout(() => setState((s) => (s.status === 'ended' ? initialState : s)), 2500);
    }
  }, [user?.id, user?.dispatcher, joinDailyRoom, teardownCallObject]);

  const showIncomingOverlay = useCallback((p) => {
    setState({
      ...initialState,
      status: 'ringing-in',
      callId: p.callId,
      peerName: p.callerName || 'Dispatcher',
      roomUrl: p.roomUrl,
      token: p.token,
    });
  }, []);

  // ── Incoming: dispatcher called the driver (live SignalR event) ────────
  const onIncomingCall = useCallback((p) => {
    if (stateRef.current.status !== 'idle') return; // already on a call
    // CallKit already reported this exact call natively — let its own
    // screen/ringtone own it instead of also showing our JS overlay + ringtone
    // on top of it.
    if (callKitCallIdsRef.current.has(String(p.callId))) return;

    if (RNCallKeep && Voip) {
      // iOS with CallKit available — give its VoIP push a short grace window
      // to show up (see pendingSignalRIncomingRef above) instead of racing it.
      if (pendingSignalRIncomingRef.current) clearTimeout(pendingSignalRIncomingRef.current.timer);
      const callId = p.callId;
      const timer = setTimeout(() => {
        pendingSignalRIncomingRef.current = null;
        if (stateRef.current.status !== 'idle') return; // resolved some other way meanwhile
        if (callKitCallIdsRef.current.has(String(callId))) return; // CallKit claimed it just in time
        console.info(`[Call] CallKit never displayed ${callId} within ${CALLKIT_GRACE_MS}ms — falling back to the in-app overlay.`);
        showIncomingOverlay(p);
      }, CALLKIT_GRACE_MS);
      pendingSignalRIncomingRef.current = { callId: String(callId), timer };
      return;
    }

    showIncomingOverlay(p);
  }, [showIncomingOverlay]);

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
    // Synchronous re-entrancy guard — without it, a double-fire (double tap,
    // or CallKit's onAnswered firing while the SignalR path is also mid-way
    // through this) sends a second /accept that always 409s (the first
    // already flipped the call to Accepted), whose catch block then calls
    // /end and tears down the call the FIRST invocation just connected. A
    // React-state guard can't close this race; a ref can.
    if (acceptInFlightRef.current) return;
    const { callId, roomUrl, token } = stateRef.current;
    if (!callId || !roomUrl) return;
    acceptInFlightRef.current = true;
    try {
      await apiAcceptCall(callId);
      await joinDailyRoom(roomUrl, token);
    } catch (err) {
      console.error('[Call] acceptCall failed:', err);
      endCallKitSession(callId);
      teardownCallObject();
      setState({ ...initialState, status: 'ended', error: t('call.couldNotConnect') });
      setTimeout(() => setState((s) => (s.status === 'ended' ? initialState : s)), 2500);
      // apiAcceptCall above may already have flipped the call to Accepted
      // server-side before the join itself failed — /decline only works while
      // still Ringing and would silently 409 here, leaving the call stuck
      // "Accepted" and blocking every future call for this driver until the
      // backend's 20-minute self-heal catches it. /end is idempotent across
      // both Ringing and Accepted, so it always actually clears the call.
      if (callId) apiEndCall(callId).catch(() => {});
    } finally {
      acceptInFlightRef.current = false;
    }
  }, [joinDailyRoom, teardownCallObject, endCallKitSession]);

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
    if (s.status !== 'ringing-out') return;
    if (s.callId === null) {
      // Our own /start hasn't resolved yet — remember it and let startCall's
      // continuation pick it up once it knows the callId (and has
      // roomUrl/token to actually join with). See pendingResolutionRef above.
      console.info(`[Call] CallAccepted for ${callId} arrived before our own callId was known — queuing it.`);
      pendingResolutionRef.current = { type: 'accepted', callId };
      return;
    }
    if (s.callId !== callId) return;
    // The dispatcher answered — join our own side. If *our* join fails, end the
    // call so they're not left alone in an already-connected room, and surface
    // why. Mirrors acceptCall()'s error handling, which was previously missing
    // on this caller-side path (an unhandled rejection that left the dispatcher
    // stranded until the ring timeout eventually fired).
    joinDailyRoom(s.roomUrl, s.token).catch((err) => {
      console.error(`[Call] Join failed for ${callId} after the dispatcher accepted:`, err);
      teardownCallObject();
      setState({ ...initialState, status: 'ended', error: t('call.couldNotConnect') });
      setTimeout(() => setState((cur) => (cur.status === 'ended' ? initialState : cur)), 2500);
      if (callId) apiEndCall(callId).catch(() => {});
    });
  }, [joinDailyRoom, teardownCallObject]);

  const onCallDeclined = useCallback(({ callId }) => {
    const s = stateRef.current;
    if (s.status === 'ringing-out' && s.callId === null) {
      console.info(`[Call] CallDeclined for ${callId} arrived before our own callId was known — queuing it.`);
      pendingResolutionRef.current = { type: 'declined', callId };
      return;
    }
    if (s.callId !== callId) return;
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

  // A sibling session (e.g. this same driver signed in on a second device)
  // already answered/declined this call — stand down instead of being left
  // ringing here forever. Ignored while we ourselves are mid-accept
  // (acceptInFlightRef) so this can't race the call this device is in the
  // middle of connecting.
  const onCallHandledElsewhere = useCallback(({ callId }) => {
    if (acceptInFlightRef.current) return;
    const s = stateRef.current;
    if (s.callId !== callId || s.status !== 'ringing-in') return;
    console.info(`[Call] ${callId} was answered/declined on another session — dismissing here.`);
    reset();
  }, [reset]);

  useCallSocket(signedIn ? user?.id : null, { onIncomingCall, onCallAccepted, onCallDeclined, onCallEnded, onCallCancelled, onCallHandledElsewhere });

  // ── CallKit (iOS): reacts to the native call UI a VoIP push already put on
  // screen — see the module-level comment for how this and the SignalR path
  // above divide ownership of a given call.
  useEffect(() => {
    if (!RNCallKeep || !Voip) return undefined;

    // Fired once CallKit displays the native call screen (the completion of
    // hitchlink-voip's reportNewIncomingCall) — `handle` is the serverCallId
    // we passed natively, so this is enough to mark the call CallKit-owned.
    const onDisplayed = ({ handle }) => {
      console.info(`[Call] CallKit onDisplayed fired, handle=${handle}.`);
      if (!handle) return;
      callKitCallIdsRef.current.add(String(handle));
      // CallKit made it in time — cancel the in-app-overlay fallback so we
      // don't show a redundant second call UI a moment later.
      if (pendingSignalRIncomingRef.current?.callId === String(handle)) {
        clearTimeout(pendingSignalRIncomingRef.current.timer);
        pendingSignalRIncomingRef.current = null;
        console.info(`[Call] CallKit displayed ${handle} — in-app overlay fallback cancelled.`);
      }
    };

    // Fired when the user taps Accept on CallKit's native screen — including
    // from the lock screen. hitchlink-voip cached the call's metadata
    // natively, keyed by this same callUUID, when the push first arrived.
    // Joins Daily the same way acceptCall() does, then marks the call active
    // for CallKit once Daily's media actually connects.
    const onAnswered = ({ callUUID }) => {
      console.info(`[Call] CallKit onAnswered fired, callUUID=${callUUID}.`);
      const meta = Voip.getPendingCallMetadata(callUUID);
      if (!meta?.serverCallId || !meta.roomUrl) {
        // getPendingCallMetadata is one-shot (native side removes the entry
        // on read — see HitchlinkVoipCoordinator.takeMetadata), so this is
        // either: called twice for the same callUUID (a re-fire we can't do
        // anything about, the data is genuinely gone), or the native push
        // handler never stored roomUrl/token for it in the first place
        // (HitchlinkVoipPushDelegate.m only sets those keys if
        // metadata.roomUrl/metadata.token are present in the APNs payload —
        // if ApnsVoipPushService.cs's shape ever drifts from what that file
        // parses, this is where it silently breaks). Logging the raw object
        // itself is what actually tells us which of those it is.
        console.error(`[Call] CallKit answered ${callUUID} but had no usable call metadata — cannot accept. meta=`, JSON.stringify(meta));
        return;
      }
      // Record the mapping up front (before the accept/join chain below even
      // starts) so that however this call ends — success, failure, or a
      // remote hangup arriving mid-join — reset()'s endCallKitSession can
      // find this UUID and retire CallKit's native session with it.
      callKitUuidBySrvIdRef.current.set(String(meta.serverCallId), callUUID);
      // Same synchronous re-entrancy guard as acceptCall(). If the JS overlay's
      // Accept and this CallKit answer both resolve for the same call (possible
      // when the SignalR IncomingCall raced ahead of CallKit's didDisplay, so
      // both surfaces showed), the second /accept 409s and its catch below would
      // /end the very call the first invocation just connected. A ref closes the
      // race a React-state guard can't.
      if (acceptInFlightRef.current) {
        console.warn(`[Call] onAnswered for ${callUUID} skipped — another accept is already in flight.`);
        return;
      }
      acceptInFlightRef.current = true;
      setState({
        ...initialState,
        status: 'ringing-in',
        callId: meta.serverCallId,
        peerName: meta.callerName,
        roomUrl: meta.roomUrl,
        token: meta.token,
      });
      console.info(`[Call] Accepting ${meta.serverCallId} via CallKit — calling /accept then joining Daily.`);
      apiAcceptCall(meta.serverCallId)
        .then(() => { console.info(`[Call] /accept succeeded for ${meta.serverCallId} — dispatcher should now see CallAccepted.`); return joinDailyRoom(meta.roomUrl, meta.token); })
        .then(() => RNCallKeep.setCurrentCallActive(callUUID))
        .catch((err) => {
          console.error('[Call] CallKit accept failed:', err);
          reset();
          // Same reasoning as acceptCall() above — accept may have already
          // landed server-side, so /end (not /decline) is what actually
          // clears it instead of leaving a stuck Accepted call.
          apiEndCall(meta.serverCallId).catch(() => {});
        })
        .finally(() => { acceptInFlightRef.current = false; });
    };

    // Fired when the call ends for any reason — user hit CallKit's decline/
    // end button, or it timed out. If the call was never answered,
    // getPendingCallMetadata still has it (onAnswered never consumed it); if
    // it was answered, that already happened and stateRef carries the
    // serverCallId instead.
    const onEndedCall = ({ callUUID }) => {
      const meta = Voip.getPendingCallMetadata(callUUID);
      const serverCallId = meta?.serverCallId ?? stateRef.current.callId;
      if (serverCallId) {
        callKitCallIdsRef.current.delete(String(serverCallId));
        // CallKit is already tearing this session down natively (this event
        // IS that teardown) — drop the mapping without calling
        // RNCallKeep.endCall again via reset()'s endCallKitSession below.
        callKitUuidBySrvIdRef.current.delete(String(serverCallId));
      }
      const wasActive = stateRef.current.status === 'active' && String(stateRef.current.callId) === String(serverCallId);
      reset();
      if (!serverCallId) return;
      if (wasActive) apiEndCall(serverCallId).catch(() => {});
      else apiDeclineCall(serverCallId).catch(() => {});
    };

    // Cold-start reliability: react-native-callkeep buffers any of the above
    // events that fire before JS attaches listeners (e.g. the call was
    // answered from the lock screen while the app was fully killed) and
    // replays them once here via "didLoadWithEvents".
    const onLoadWithEvents = (events) => {
      (events || []).forEach(({ name, data }) => {
        if (name === RAW_EVENT.didDisplayIncomingCall) onDisplayed(data);
        else if (name === RAW_EVENT.answerCall) onAnswered(data);
        else if (name === RAW_EVENT.endCall) onEndedCall(data);
      });
    };

    const subs = [
      RNCallKeep.addEventListener('didDisplayIncomingCall', onDisplayed),
      RNCallKeep.addEventListener('answerCall', onAnswered),
      RNCallKeep.addEventListener('endCall', onEndedCall),
      RNCallKeep.addEventListener('didLoadWithEvents', onLoadWithEvents),
    ];
    RNCallKeep.setup({
      ios: { appName: 'HitchLink', supportsVideo: false, includesCallsInRecents: true },
      android: {},
    }).catch((err) => console.error('[Call] RNCallKeep.setup failed:', err));

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
      endCallKitSession(callId);
      teardownCallObject();
      if (status === 'ringing-out') {
        setState({ ...initialState, status: 'ended', error: t('call.noAnswer') });
        setTimeout(() => setState((cur) => (cur.status === 'ended' ? initialState : cur)), 2500);
      } else {
        setState(initialState);
      }
      if (callId) apiEndCall(callId, 'timeout').catch(() => {});
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.status, state.callId, teardownCallObject, endCallKitSession]);

  useEffect(() => () => {
    teardownCallObject();
    stopRinging();
    if (pendingSignalRIncomingRef.current) clearTimeout(pendingSignalRIncomingRef.current.timer);
  }, [teardownCallObject]);

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
