// Call signaling: joins the same driver_{driverId} SignalR group as chat (see
// useChatSocket.js) but on its own connection, mounted once at the root
// layout (via CallProvider) so a call rings no matter which screen is open —
// not just while the Messages tab happens to be mounted.
//
// Loaded defensively like useChatSocket: in mock mode, on builds without
// @microsoft/signalr, or with no API URL configured, it no-ops.

import { useEffect, useRef } from 'react';
import { MAIN_BASE, USE_MOCK } from '../api/config';
import { getValidToken } from '../lib/session';

let signalR = null;
try {
  signalR = require('@microsoft/signalr');
} catch {
  signalR = null;
}

/**
 * @param {string} driverId
 * @param {{
 *   onIncomingCall: (payload) => void,
 *   onCallAccepted: (payload) => void,
 *   onCallDeclined: (payload) => void,
 *   onCallEnded: (payload) => void,
 *   onCallCancelled: (payload) => void,
 *   onCallHandledElsewhere: (payload) => void,
 * }} handlers
 */
export function useCallSocket(driverId, handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!driverId || USE_MOCK || !signalR || !MAIN_BASE) return undefined;

    let cancelled = false;
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(`${MAIN_BASE}/hubs/chat`, {
        accessTokenFactory: async () => (await getValidToken()) || '',
      })
      .withAutomaticReconnect()
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

    conn.on('IncomingCall', onIncoming);
    conn.on('CallAccepted', onAccepted);
    conn.on('CallDeclined', onDeclined);
    conn.on('CallEnded', onEnded);
    conn.on('CallCancelled', onCancelled);
    conn.on('CallHandledElsewhere', onHandledElsewhere);

    const joinRoom = () => conn.invoke('JoinDriverRoom', String(driverId)).catch(() => {});
    conn.onreconnected(joinRoom);

    conn.start().then(() => { if (!cancelled) joinRoom(); }).catch(() => {});

    return () => {
      cancelled = true;
      conn.stop().catch(() => {});
    };
  }, [driverId]);
}
