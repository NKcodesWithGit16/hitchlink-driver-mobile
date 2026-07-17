// Calls always hit the real backend — there's no meaningful mock for a live
// audio call (same reasoning as auth.js never having a mock branch). In mock
// mode (no EXPO_PUBLIC_API_MAIN_URL) these calls simply fail, and the call UI
// surfaces that as "calling is unavailable" rather than pretending to connect.
import { apiFetch } from './client';

export function startCall(driverId) {
  return apiFetch(`/calls/${driverId}/start`, { method: 'POST' });
}

export function getCall(callId) {
  return apiFetch(`/calls/${callId}`, { allow404: true });
}

export function acceptCall(callId) {
  return apiFetch(`/calls/${callId}/accept`, { method: 'POST' });
}

export function declineCall(callId) {
  return apiFetch(`/calls/${callId}/decline`, { method: 'POST' });
}

export function endCall(callId, reason) {
  return apiFetch(`/calls/${callId}/end`, { method: 'POST', body: JSON.stringify({ reason }) });
}
