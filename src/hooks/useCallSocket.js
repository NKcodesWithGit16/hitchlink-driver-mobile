// Call signaling: joins the same driver_{driverId} SignalR group as chat (see
// useChatSocket.js) but on its own connection, mounted once at the root
// layout (via CallProvider) so a call rings no matter which screen is open —
// not just while the Messages tab happens to be mounted.
//
// Loaded defensively like useChatSocket: in mock mode, on builds without
// @microsoft/signalr, or with no API URL configured, it no-ops.
//
// Two independent delivery paths, because one is not enough:
//
//   1. The live "IncomingCall" event.
//   2. A GET /calls/pending sweep, on every (re)connection and every return to
//      the foreground. SignalR does not replay events, and a phone drops its
//      socket constantly — backgrounded, tunnel, dead zone, doze. Without this,
//      a call placed in any of those moments is simply never seen, and the
//      dispatcher just hears it ring out.
//
// (On iOS the VoIP push covers the backgrounded case natively via CallKit; this
// covers Android, and iOS whenever APNs is unavailable or the push is dropped.)

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { MAIN_BASE, USE_MOCK } from '../api/config';
import { getValidToken } from '../lib/session';
import { getPendingCall } from '../api/calls';

let signalR = null;
try {
  signalR = require('@microsoft/signalr');
} catch {
  signalR = null;
}

// Retry forever, settling at one attempt every ~10s. The bare
// withAutomaticReconnect() default gives up after 4 tries over ~30 seconds and
// never reconnects again — on a phone, which loses its socket every time it is
// pocketed, that means a driver who stops receiving calls until they restart
// the app, with nothing on screen to say so.
const RETRY_DELAYS_MS = [0, 2000, 5000, 10000];
const retryPolicy = {
  nextRetryDelayInMilliseconds: (ctx) =>
    RETRY_DELAYS_MS[Math.min(ctx.previousRetryCount, RETRY_DELAYS_MS.length - 1)] +
    Math.floor(Math.random() * 1000),
};

/**
 * @param {string} driverId
 * @param {{
 *   onIncomingCall: (payload) => void,
 *   onCallAccepted: (payload) => void,
 *   onCallDeclined: (payload) => void,
 *   onCallEnded: (payload) => void,
 *   onCallCancelled: (payload) => void,
 *   onCallHandledElsewhere: (payload) => void,
 *   onCallRingPath: (payload) => void,
 * }} handlers
 */
export function useCallSocket(driverId, handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!driverId || USE_MOCK || !signalR || !MAIN_BASE) return undefined;

    let cancelled = false;
    let restartTimer = null;
    let restartAttempt = 0;
    let sweeping = false;

    const conn = new signalR.HubConnectionBuilder()
      .withUrl(`${MAIN_BASE}/hubs/chat`, {
        accessTokenFactory: async () => (await getValidToken()) || '',
      })
      .withAutomaticReconnect(retryPolicy)
      .build();

    const onIncoming  = (p) => handlersRef.current.onIncomingCall?.(p);
    const onAccepted  = (p) => handlersRef.current.onCallAccepted?.(p);
    const onDeclined  = (p) => handlersRef.current.onCallDeclined?.(p);
    const onEnded     = (p) => handlersRef.current.onCallEnded?.(p);
    const onCancelled = (p) => handlersRef.current.onCallCancelled?.(p);
    // Sent to every one of this driver's own connections once any ONE of them
    // has accepted/declined a call — lets a sibling session (e.g. the app
    // reconnecting on a second device) stand down instead of ringing forever.
    const onHandledElsewhere = (p) => handlersRef.current.onCallHandledElsewhere?.(p);
    // Follows IncomingCall by milliseconds and says which UI should ring:
    // { callId, native } — native true when APNs accepted a VoIP push, so
    // CallKit is about to present the call itself and the app must not show
    // its own screen on top. See CallsController's StartCall.
    const onRingPath = (p) => handlersRef.current.onCallRingPath?.(p);

    conn.on('IncomingCall', onIncoming);
    conn.on('CallAccepted', onAccepted);
    conn.on('CallDeclined', onDeclined);
    conn.on('CallEnded', onEnded);
    conn.on('CallCancelled', onCancelled);
    conn.on('CallHandledElsewhere', onHandledElsewhere);
    conn.on('CallRingPath', onRingPath);

    const joinRoom = () => conn.invoke('JoinDriverRoom', String(driverId)).catch(() => {});

    // Catches a call that started ringing while this socket was down. Fed
    // through the ordinary incoming-call handler, which already ignores
    // anything arriving while a call is in progress or already handled.
    const sweepPendingCall = () => {
      if (cancelled || sweeping) return;
      sweeping = true;
      getPendingCall()
        .then((res) => {
          if (cancelled || !res?.call) return;
          console.info(`[Call] Recovered a ringing call (${res.call.callId}) missed while the socket was down.`);
          // `recovered` tells CallContext this did NOT come from the live
          // event, so it must not wait for the CallRingPath that only ever
          // follows a live one. See onIncomingCall.
          handlersRef.current.onIncomingCall?.({ ...res.call, recovered: true });
        })
        .catch(() => { /* offline — the next sweep retries */ })
        .finally(() => { sweeping = false; });
    };

    const onConnected = () => {
      if (cancelled) return;
      restartAttempt = 0;
      joinRoom();
      sweepPendingCall();
    };

    const scheduleRestart = () => {
      if (cancelled || restartTimer) return;
      const delay = Math.min(1000 * 2 ** restartAttempt, 10000) + Math.floor(Math.random() * 500);
      restartAttempt += 1;
      restartTimer = setTimeout(() => {
        restartTimer = null;
        start();
      }, delay);
    };

    const start = () => {
      if (cancelled) return;
      if (conn.state !== signalR.HubConnectionState.Disconnected) return;
      conn.start().then(onConnected, (err) => {
        console.warn('[Call] hub connect failed — retrying.', err?.message ?? err);
        scheduleRestart();
      });
    };

    conn.onreconnected(onConnected);
    // SignalR never restarts itself once it reaches onclose, whether the
    // reconnect policy ran out or the server closed the connection. Without
    // this the app stays silently unreachable for calls until it is restarted.
    conn.onclose(() => {
      if (cancelled) return;
      console.warn('[Call] hub connection closed — will restart.');
      scheduleRestart();
    });

    // Returning to the foreground is both the most likely moment for the socket
    // to be dead and the moment a driver most expects to be reachable, so skip
    // the backoff and check immediately — connection first, then any call that
    // came in while the phone was away.
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || cancelled) return;
      if (conn.state === signalR.HubConnectionState.Disconnected) {
        if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
        restartAttempt = 0;
        start();
      } else if (conn.state === signalR.HubConnectionState.Connected) {
        sweepPendingCall();
      }
    });

    start();

    return () => {
      cancelled = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      appStateSub?.remove?.();
      conn.stop().catch(() => {});
    };
  }, [driverId]);
}
