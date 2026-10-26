/* KV-backed rate limiting for Cloudflare Workers.
 *
 * Replaces the in-memory Map-based api/rate-limit.js with a KV store.
 * All state lives in the RATE_LIMITS KV namespace under keys prefixed 'ratelimit:'.
 *
 * Two shapes:
 *
 *   backoff   Exponential back-off per key (e.g. per IP or per username).
 *             checkBackoff / failBackoff / clearBackoff.
 *
 *   window    Fixed-window request counter per key.
 *             checkWindow.
 *
 * Each KV write sets expirationTtl so entries auto-expire without a sweep. */

const PREFIX = 'ratelimit:';
const MINUTE = 60000;

// ── backoff ───────────────────────────────────────────────────────────────────

/**
 * Check whether a key is currently locked.
 * @param {KVNamespace} kv
 * @param {string} key
 * @param {{ free?: number, baseMs?: number, maxMs?: number, forgetMs?: number }} opts
 * @returns {Promise<{ locked: boolean, retryAfter: number, entry: object|null }>}
 */
export async function checkBackoff(kv, key, {
  free = 5,
  baseMs = MINUTE,
  maxMs = 60 * MINUTE,
  forgetMs = 24 * 60 * MINUTE,
} = {}) {
  const raw = await kv.get(PREFIX + key);
  if (!raw) return { locked: false, retryAfter: 0, entry: null };
  let entry;
  try { entry = JSON.parse(raw); } catch { return { locked: false, retryAfter: 0, entry: null }; }
  const now = Date.now();
  const locked = entry.until > now;
  const retryAfter = locked ? Math.ceil((entry.until - now) / 1000) : 0;
  return { locked, retryAfter, entry };
}

/**
 * Record a failure for a key, apply exponential back-off if over the free quota.
 * @param {KVNamespace} kv
 * @param {string} key
 * @param {{ free?, baseMs?, maxMs?, forgetMs? }} opts
 * @returns {Promise<{ locked: boolean, retryAfter: number }>}
 */
export async function failBackoff(kv, key, {
  free = 5,
  baseMs = MINUTE,
  maxMs = 60 * MINUTE,
  forgetMs = 24 * 60 * MINUTE,
} = {}) {
  const raw = await kv.get(PREFIX + key);
  const now = Date.now();
  let entry = { n: 0, until: 0, last: 0 };
  if (raw) {
    try {
      const prev = JSON.parse(raw);
      // Only keep if not forgotten
      if (now - Math.max(prev.last || 0, prev.until || 0) <= forgetMs) {
        entry = prev;
      }
    } catch { /* start fresh */ }
  }
  entry.n += 1;
  entry.last = now;
  let lockMs = 0;
  if (entry.n > free) {
    lockMs = Math.min(maxMs, baseMs * 2 ** Math.min(30, entry.n - free - 1));
    entry.until = now + lockMs;
  }
  const ttlSec = Math.ceil(Math.max(lockMs, forgetMs) / 1000);
  await kv.put(PREFIX + key, JSON.stringify(entry), { expirationTtl: ttlSec });
  const locked = entry.until > now;
  const retryAfter = locked ? Math.ceil((entry.until - now) / 1000) : 0;
  return { locked, retryAfter };
}

/**
 * Clear a backoff key on successful auth.
 * @param {KVNamespace} kv
 * @param {string} key
 */
export async function clearBackoff(kv, key) {
  await kv.delete(PREFIX + key);
}

// ── window ─────────────────────────────────────────────────────────────────────

/**
 * Fixed-window request counter. Returns 0 when within budget, else seconds to wait.
 * @param {KVNamespace} kv
 * @param {string} key
 * @param {{ max?: number, windowMs?: number }} opts
 * @returns {Promise<number>} seconds to wait, or 0
 */
export async function checkWindow(kv, key, {
  max = 60,
  windowMs = MINUTE,
} = {}) {
  const raw = await kv.get(PREFIX + 'w:' + key);
  const now = Date.now();
  let entry = { start: now, count: 0 };
  if (raw) {
    try {
      const prev = JSON.parse(raw);
      if (now - prev.start < windowMs) entry = prev;
    } catch { /* start fresh */ }
  }
  entry.count += 1;
  const ttlSec = Math.ceil(windowMs / 1000);
  await kv.put(PREFIX + 'w:' + key, JSON.stringify(entry), { expirationTtl: ttlSec });
  if (entry.count > max) {
    return Math.max(1, Math.ceil((entry.start + windowMs - now) / 1000));
  }
  return 0;
}
