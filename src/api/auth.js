const BASE = process.env.EXPO_PUBLIC_API_BASE_URL || '';

export async function login(usernameOrEmail, password) {
  const res = await fetch(`${BASE}/api/Auth/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameOrEmail, password }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || 'Login failed');
  if (data?.isAccepted === false) throw new Error(data?.message || 'Invalid username or password');
  return data; // { token, ... }
}
