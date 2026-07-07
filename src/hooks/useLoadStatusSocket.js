// Real-time inbound load-status sync for the driver. Joins the same SignalR
// chat hub the messages screen uses and listens for "LoadStatusChanged" on this
// driver's room — so a dispatcher correction, a GPS geofence auto-advance, or
// the driver's own tap echoed back all update the Load screen within ~1s,
// instead of only on pull-to-refresh.
//
// Deliberately its own thin connection (mirrors useChatSocket) so wiring it in
// can't disturb chat. Loaded defensively: in mock mode, on a build without
// @microsoft/signalr, or with no API URL, it no-ops and the screen's existing
// fetch/refresh path keeps working exactly as before.

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
 * @param {string} driverId  joins this driver's room while mounted
 * @param {(loadId: string, status: string, driverId: string) => void} onLoadStatus
 *   called on every load lifecycle change pushed to this driver
 */
export function useLoadStatusSocket(driverId, onLoadStatus) {
  const cbRef = useRef(onLoadStatus);
  cbRef.current = onLoadStatus;

  useEffect(() => {
    if (!driverId || USE_MOCK || !signalR || !MAIN_BASE) return undefined;

    let cancelled = false;
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(`${MAIN_BASE}/hubs/chat`, {
        // Same JWT-over-websocket auth as chat; resolved at call time so a
        // reconnect refreshes an expiring token instead of failing auth.
        accessTokenFactory: async () => (await getValidToken()) || '',
      })
      .withAutomaticReconnect()
      .build();

    const onEvent = (payload) => {
      if (cancelled || !payload) return;
      cbRef.current?.(payload.loadId, payload.status, payload.driverId);
    };

    conn.on('LoadStatusChanged', onEvent);
    conn.onreconnected(() => {
      if (!cancelled) conn.invoke('JoinDriverRoom', String(driverId)).catch(() => {});
    });

    conn.start()
      .then(() => {
        if (cancelled) return undefined;
        return conn.invoke('JoinDriverRoom', String(driverId));
      })
      .catch(() => {
        // Server unreachable / hub rejected — the poll + pull-to-refresh cover it.
      });

    return () => {
      cancelled = true;
      conn.stop().catch(() => {});
    };
  }, [driverId]);
}
