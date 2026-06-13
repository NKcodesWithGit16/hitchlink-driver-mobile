import { apiFetch, USE_MOCK } from './client';
import * as mock from '../data/mock';

const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));

export async function fetchDriver(driverId) {
  if (USE_MOCK) { await wait(); return mock.driver; }
  const data = await apiFetch(`/drivers/${driverId}`);
  return data ?? null;
}

export async function fetchActiveLoad(driverId) {
  if (USE_MOCK) { await wait(); return mock.activeLoad; }
  const data = await apiFetch(`/loads/driver/${driverId}`);
  return data ?? null;
}

export async function updateLoadStatus(loadId, status) {
  if (USE_MOCK) { await wait(150); return { ok: true, status }; }
  return apiFetch(`/loads/${loadId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function acceptLoad(loadId, driverId) {
  if (USE_MOCK) { await wait(150); return { ok: true }; }
  return apiFetch(`/loads/${loadId}/accept`, { method: 'POST', body: JSON.stringify({ driverId }) });
}

export async function declineLoad(loadId, driverId, reason) {
  if (USE_MOCK) { await wait(150); return { ok: true }; }
  return apiFetch(`/loads/${loadId}/decline`, { method: 'POST', body: JSON.stringify({ driverId, reason: reason ?? null }) });
}

export async function fetchMessages(driverId) {
  if (USE_MOCK) { await wait(); return mock.messages; }
  const params = new URLSearchParams({ as_: 'driver', actorId: String(driverId) });
  const data = await apiFetch(`/chat/${driverId}?${params}`);
  return data ?? [];
}

export async function sendMessage(driverId, text) {
  if (USE_MOCK) { await wait(120); return { ok: true }; }
  return apiFetch(`/chat/${driverId}`, {
    method: 'POST',
    body: JSON.stringify({ message: text, senderId: driverId, senderRole: 'driver' }),
  });
}

export async function fetchEarnings(driverId) {
  if (USE_MOCK) { await wait(); return mock.earnings; }
  // Real endpoint: GET /drivers/{id}/earnings (settlements aggregated into the
  // week/month + recent-loads shape). Falls back to mock if the backend hasn't
  // been redeployed with this endpoint yet, so the screen never sits empty.
  try {
    const data = await apiFetch(`/drivers/${driverId}/earnings`);
    return data ?? mock.earnings;
  } catch {
    return mock.earnings;
  }
}

export async function fetchDocuments(driverId) {
  if (USE_MOCK) { await wait(); return mock.documents; }
  const data = await apiFetch(`/documents?driverId=${driverId}`);
  return data ?? [];
}

export async function fetchHos(driverId) {
  if (USE_MOCK) { await wait(120); return mock.hos; }
  // Real endpoint: GET /drivers/{id}/hos (federal-limit defaults until an ELD /
  // the app reports clocks via PATCH). Falls back to mock until redeployed.
  try {
    const data = await apiFetch(`/drivers/${driverId}/hos`);
    return data ?? mock.hos;
  } catch {
    return mock.hos;
  }
}

export async function updateHos(driverId, clocks) {
  if (USE_MOCK) { await wait(120); return { ok: true }; }
  return apiFetch(`/drivers/${driverId}/hos`, {
    method: 'PATCH',
    body: JSON.stringify(clocks),
  });
}

export async function registerPushToken(driverId, pushToken) {
  if (USE_MOCK) return { ok: true };
  return apiFetch(`/drivers/${driverId}/push-token`, {
    method: 'PATCH',
    body: JSON.stringify({ pushToken }),
  });
}
