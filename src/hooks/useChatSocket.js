// Real-time chat: joins the backend's SignalR chat hub so dispatcher messages
// appear instantly instead of waiting for the next poll. The hub broadcasts
// "ReceiveMessage" to the driver_{driverId} room on every send (text, photo,
// voice), from both the dispatcher web app and the REST endpoints.
//
// Deliberately thin: on any incoming event we just nudge the screen's existing
// `load()` reconciliation instead of merging payloads client-side — one code
// path for message shapes, and edits/deletes/reactions stay consistent.
//
// Loaded defensively like the other optional modules: in mock mode, on builds
// without @microsoft/signalr, or with no API URL configured, it no-ops and the
// chat screen's polling keeps working exactly as before.

import { useEffect, useRef, useState } from 'react';
import { MAIN_BASE, USE_MOCK } from '../api/config';
import { getValidToken } from '../lib/session';

let signalR = null;
try {
  signalR = require('@microsoft/signalr');
} catch {
  signalR = null;
}

/**
 * @param {string} driverId  joins this driver's chat room while mounted
 * @param {() => void} onMessage  called on every incoming message (and on
 *   reconnect, to catch anything missed while the socket was down)
 * @returns {boolean} true while the socket is connected — callers can relax
 *   their polling cadence when it is.
 */
export function useChatSocket(driverId, onMessage) {
  const [connected, setConnected] = useState(false);
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    if (!driverId || USE_MOCK || !signalR || !MAIN_BASE) return undefined;

    let cancelled = false;
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(`${MAIN_BASE}/hubs/chat`, {
        // The hub requires a JWT; SignalR passes it as ?access_token= on the
        // websocket and the backend reads it in OnMessageReceived. Resolved at
        // call time via the session layer, so reconnects auto-refresh an
        // expired token instead of failing auth.
        accessTokenFactory: async () => (await getValidToken()) || '',
      })
      .withAutomaticReconnect()
      .build();

    const nudge = () => { if (!cancelled) cbRef.current?.(); };

    conn.on('ReceiveMessage', nudge);
    conn.onreconnecting(() => { if (!cancelled) setConnected(false); });
    conn.onclose(() => { if (!cancelled) setConnected(false); });
    conn.onreconnected(() => {
      if (cancelled) return;
      setConnected(true);
      conn.invoke('JoinDriverRoom', String(driverId)).catch(() => {});
      nudge(); // catch anything that arrived while the socket was down
    });

    conn.start()
      .then(() => {
        if (cancelled) return;
        setConnected(true);
        return conn.invoke('JoinDriverRoom', String(driverId));
      })
      .catch(() => {
        // Server unreachable / hub rejected — polling fallback covers it.
      });

    return () => {
      cancelled = true;
      setConnected(false);
      conn.stop().catch(() => {});
    };
  }, [driverId]);

  return connected;
}
