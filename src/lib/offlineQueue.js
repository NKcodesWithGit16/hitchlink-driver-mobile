import AsyncStorage from '@react-native-async-storage/async-storage';

/* A tiny durable queue for actions taken while offline (e.g. load-status
   updates). Items persist across app restarts and replay when back online. */
const KEY = 'hl_status_queue';

async function read() {
  try { const raw = await AsyncStorage.getItem(KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
async function write(q) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(q)); } catch {}
}

export async function enqueue(item) {
  const q = await read();
  q.push({ ...item, queuedAt: Date.now() });
  await write(q);
  return q.length;
}

export async function queueCount() {
  return (await read()).length;
}

// Replay every queued item through `process`; keep any that still fail.
export async function flush(process) {
  const q = await read();
  if (!q.length) return 0;
  const remaining = [];
  let done = 0;
  for (const item of q) {
    try { await process(item); done++; }
    catch { remaining.push(item); }
  }
  await write(remaining);
  return done;
}
