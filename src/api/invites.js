import { MAIN_BASE, USE_MOCK } from './config';

// Deliberately NOT routed through src/api/client.js. apiFetch always tries to
// attach a bearer token and turns any 401 into a refresh attempt, which ends at
// emitSessionExpired() — a "session expired" notice on a screen where nobody has
// ever been signed in. This mirrors src/api/auth.js instead: raw fetch, throw on
// failure, and a `transient` flag so a Railway cold start reads differently from
// "this invite is used".

function transientError(message) {
  const err = new Error(message);
  err.transient = true;
  return err;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw transientError('The server returned an unreadable response.');
  }
}

const MOCK_PREVIEW = {
  status: 'Valid',
  name: 'Sam Rivera',
  email: null,
  phoneNumber: null,
  companyName: 'Blue Ridge Freight',
  dispatcherName: 'Nika K.',
  expiresAt: new Date(Date.now() + 14 * 864e5).toISOString(),
};

/**
 * Looks up an invite before the driver fills anything in. Accepts the long link
 * token or the short typed code — the driver doesn't know which one they hold.
 *
 * Expired / used / not-found are DATA, not errors: they come back as a status and
 * each one needs its own message. Only transport failures throw.
 */
export async function getInvitePreview(tokenOrCode) {
  if (USE_MOCK) return MOCK_PREVIEW;

  let res;
  try {
    res = await fetch(`${MAIN_BASE}/drivers/invite/${encodeURIComponent(tokenOrCode)}`);
  } catch (e) {
    throw transientError(`Could not reach the server: ${e?.message || e}`);
  }

  if (res.status === 429) throw transientError('Too many attempts. Wait a moment and try again.');
  if (!res.ok) throw transientError(`Could not check the invite (HTTP ${res.status})`);

  const data = await readJson(res);
  if (!data?.status) throw transientError('The server returned an unexpected response.');
  return data;
}

/**
 * Creates the driver's account. Resolves to { id }.
 *
 * A 400 carrying `field` means that specific input was rejected (a taken
 * username, almost always) — the thrown error carries `.field` so the screen can
 * attach the message to that input instead of showing a toast the driver has to
 * map back to a form they've already filled in.
 */
export async function completeDriverRegistration({
  token, firstName, lastName, phoneNumber, email, username, password,
}) {
  if (USE_MOCK) return { id: 'mock-driver-id' };

  let res;
  try {
    res = await fetch(`${MAIN_BASE}/drivers/complete-registration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        firstName,
        lastName,
        phoneNumber: phoneNumber || '',
        email: email || null,
        username,
        password,
      }),
    });
  } catch (e) {
    throw transientError(`Could not reach the server: ${e?.message || e}`);
  }

  const data = await readJson(res);

  if (!res.ok) {
    const err = new Error(data?.error || data?.message || 'Could not create your account.');
    if (data?.field) err.field = data.field;
    // 503 is the backend saying "nothing you typed is wrong, try again".
    if (res.status >= 500) err.transient = true;
    throw err;
  }

  return data;
}
