// Calls always hit the real backend — there's no meaningful mock for a live
// audio call (same reasoning as auth.js never having a mock branch). In mock
// mode (no EXPO_PUBLIC_API_MAIN_URL) these calls simply fail, and the call UI
// surfaces that as "calling is unavailable" rather than pretending to connect.
import { apiFetch } from './client';

// `video` decides how the call is PLACED — what the dispatcher's ring screen
// says, and whether CallKit rings as a video call. Turning a camera on later
// (including upgrading an audio call) goes over Daily between the two clients
// and never comes back through here.
export function startCall(driverId, { video = false } = {}) {
  return apiFetch(`/calls/${driverId}/start`, { method: 'POST', body: JSON.stringify({ video }) });
}

export function getCall(callId) {
  return apiFetch(`/calls/${callId}`, { allow404: true });
}

// Any call still ringing FOR THIS DRIVER right now, or null. The "IncomingCall"
// SignalR event is not replayed, so a call placed while this phone's socket was
// down (backgrounded, tunnel, dead zone) would otherwise never be seen at all.
// The call socket asks for this on every (re)connection and whenever the app
// returns to the foreground; the payload is the same shape as the event, so it
// feeds the same handler. See CallsController.Pending.
export function getPendingCall() {
  return apiFetch('/calls/pending', { allow404: true });
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
