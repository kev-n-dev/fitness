// Push-notification routes: VAPID public key, subscription management, rest-timer DO,
// live-activity heartbeat.
// No Node.js built-ins — Web Crypto only, via lib/push.js.
import { Hono } from 'hono';
import { getSession } from './auth.js';
import { sendPush, VapidError } from '../lib/push.js';
import { restTimerPush, testPush } from '../lib/nudge.js';
import {
  getSubs, createSub, deleteSub, getVapidKeys, getUserState,
} from '../db/queries.js';

const MAX_SUBS_PER_USER = 20;
const PRESENCE_TTL         = 70;  // KV expirationTtl (s) for active presence (~3.5× 20 s heartbeat)
const PRESENCE_HIDDEN_GRACE = 45; // KV expirationTtl (s) after 'hidden' signal

// A device id is 8–64 URL-safe chars (lib/push.js in the frontend).
const deviceIdOf = v =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : undefined;

const text = v => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

// ── Endpoint validation ───────────────────────────────────────────────────────

function isPrivateAddrLiteral(ip) {
  // IPv4 private/loopback/link-local ranges
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (m4) {
    const a = +m4[1], b = +m4[2];
    if (a === 0 || a === 10 || a === 127)           return true; // this-network, private, loopback
    if (a === 169 && b === 254)                      return true; // link-local
    if (a === 172 && b >= 16 && b <= 31)             return true; // private
    if (a === 192 && b === 168)                      return true; // private
    if (a === 192 && b === 0)                        return true; // 192.0.0.0/24
    if (a === 100 && b >= 64 && b <= 127)            return true; // CGNAT
    if (a >= 224)                                    return true; // multicast + reserved
    return false;
  }
  // IPv6 loopback and link-local
  const lower = ip.toLowerCase().replace(/%.*$/, '');
  if (lower === '::1' || lower === '::')  return true;
  if (lower.startsWith('fe80:'))          return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  return false;
}

/**
 * Returns an error string if `raw` is not a safe push endpoint URL, or null if OK.
 * Literal IP addresses are rejected here; hostname-based endpoints are controlled
 * by the managed Workers network.
 */
function pushEndpointError(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'endpoint is not a valid URL'; }
  if (u.protocol !== 'https:') return 'endpoint must be an https:// URL';
  if (u.username || u.password) return 'endpoint must not carry credentials';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^[0-9.]+$/.test(host) || host.includes(':')) {
    if (isPrivateAddrLiteral(host)) return 'endpoint must not point at a private address';
  }
  return null;
}

// ── sendPushToUser ────────────────────────────────────────────────────────────

/**
 * Send `payload` to all push subscriptions for `userId`.
 * If `deviceId` is given, sends only to subscriptions for that device
 * (or to subscriptions stored without a device id, for backwards compatibility).
 * Dead subscriptions (404/410/403 from the push service) are removed from D1.
 *
 * @param {object} env - Worker env bindings
 * @param {string} userId
 * @param {object} payload - JSON-serializable push payload
 * @param {string|undefined} deviceId
 */
export async function sendPushToUser(env, userId, payload, deviceId) {
  const subs = await getSubs(env.DB, userId);
  const filtered = deviceId
    ? subs.filter(s => !s.device_id || s.device_id === deviceId)
    : subs;
  if (!filtered.length) return;

  const vapidRow = await getVapidKeys(env.DB);
  if (!vapidRow) return;
  const vapidKeys = { publicKey: vapidRow.public_key, privateKey: vapidRow.private_key };
  const subject = env.VAPID_SUBJECT || 'mailto:admin@localhost';

  for (const sub of filtered) {
    try {
      await sendPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload,
        vapidKeys,
        subject
      );
    } catch (e) {
      if (e instanceof VapidError && e.code === 'dead') {
        await deleteSub(env.DB, sub.endpoint).catch(() => {});
      } else {
        console.error('push send failed', userId, e.message);
      }
    }
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const app = new Hono();

// GET /api/push/public-key
// Returns the VAPID public key so the browser can subscribe.
app.get('/api/push/public-key', async (c) => {
  const row = await getVapidKeys(c.env.DB);
  if (!row) return c.json({ error: 'VAPID keys not configured' }, 503);
  return c.json({ key: row.public_key });
});

// POST /api/push/subscribe
// Upsert a push subscription for the signed-in user; enforces MAX_SUBS_PER_USER.
app.post('/api/push/subscribe', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const user = session.user;

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid json' }, 400);

  const sub = body.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return c.json({ error: 'invalid subscription' }, 400);
  }
  const bad = pushEndpointError(sub.endpoint);
  if (bad) return c.json({ error: bad }, 400);

  const deviceId = deviceIdOf(body.deviceId);
  const existingSubs = await getSubs(c.env.DB, user.id);
  const prevSub = existingSubs.find(s => s.endpoint === sub.endpoint);
  // Keep the original deviceId if the new request doesn't include one.
  const storedDevice = deviceId || prevSub?.device_id || null;
  const prevCreated  = prevSub?.created;

  // Enforce the per-user cap: delete oldest subscriptions beyond the limit.
  const subsWithout = existingSubs.filter(s => s.endpoint !== sub.endpoint);
  if (subsWithout.length >= MAX_SUBS_PER_USER) {
    const overflow = subsWithout.length - MAX_SUBS_PER_USER + 1;
    for (const s of subsWithout.slice(0, overflow)) {
      await deleteSub(c.env.DB, s.endpoint);
    }
  }

  await createSub(c.env.DB, {
    endpoint:  sub.endpoint,
    user_id:   user.id,
    p256dh:    String(sub.keys.p256dh),
    auth:      String(sub.keys.auth),
    device_id: storedDevice,
    created:   prevCreated || new Date().toISOString(),
  });

  return c.json({ ok: true });
});

// GET /api/push/status
// Whether this server still holds the subscription for ?endpoint=.
app.get('/api/push/status', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const user = session.user;
  const endpoint = new URL(c.req.url).searchParams.get('endpoint') || '';
  const subs = await getSubs(c.env.DB, user.id);
  const row = subs.find(s => s.endpoint === endpoint);
  return c.json(
    row ? { subscribed: true, deviceId: row.device_id || null } : { subscribed: false }
  );
});

// POST /api/push/unsubscribe
app.post('/api/push/unsubscribe', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const user = session.user;
  const body = await c.req.json().catch(() => ({}));
  const subs = await getSubs(c.env.DB, user.id);
  const row = subs.find(s => s.endpoint === body.endpoint);
  if (row) await deleteSub(c.env.DB, body.endpoint);
  return c.json({ ok: true });
});

// POST /api/push/test
// Sends a test notification to the signed-in user.
app.post('/api/push/test', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const user = session.user;
  const stateRow = await getUserState(c.env.DB, user.id);
  let lang;
  try { lang = stateRow ? JSON.parse(stateRow.state || '{}').lang : undefined; } catch { /* ignore */ }
  await sendPushToUser(c.env, user.id, testPush(lang));
  return c.json({ ok: true });
});

// POST /api/push/rest-timer
// Schedules a rest-timer push via a Durable Object (survives Worker restarts).
app.post('/api/push/rest-timer', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const user = session.user;
  const body = await c.req.json().catch(() => ({}));

  // Validated before clamping: a missing or non-numeric value must be a 400.
  const raw = body.seconds;
  const n = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  if (!(n >= 1)) return c.json({ error: 'seconds required' }, 400);
  const sec = Math.min(3600, Math.round(n));

  const deviceId = deviceIdOf(body.deviceId);

  // Build the subscription list the DO will use when the alarm fires.
  const allSubs = await getSubs(c.env.DB, user.id);
  const filteredSubs = deviceId
    ? allSubs.filter(s => !s.device_id || s.device_id === deviceId)
    : allSubs;

  const vapidRow = await getVapidKeys(c.env.DB);
  if (!vapidRow) return c.json({ error: 'VAPID keys not configured' }, 503);
  const vapidKeys = { publicKey: vapidRow.public_key, privateKey: vapidRow.private_key };

  // Read the user's language for the push copy.
  let lang;
  try {
    const stateRow = await getUserState(c.env.DB, user.id);
    lang = stateRow ? JSON.parse(stateRow.state || '{}').lang : undefined;
  } catch { /* ignore */ }

  const doId = c.env.REST_TIMERS.idFromName(user.id + ':' + (deviceId || ''));
  const stub = c.env.REST_TIMERS.get(doId);

  await stub.fetch('https://do/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sec,
      payload:       restTimerPush(lang),
      vapidKeysJson: JSON.stringify(vapidKeys),
      subJson:       JSON.stringify(
        filteredSubs.map(s => ({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }))
      ),
    }),
  });

  return c.json({ ok: true });
});

// POST /api/push/rest-timer/cancel
app.post('/api/push/rest-timer/cancel', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const user = session.user;
  const body = await c.req.json().catch(() => ({}));
  const deviceId = deviceIdOf(body.deviceId);

  const doId = c.env.REST_TIMERS.idFromName(user.id + ':' + (deviceId || ''));
  const stub = c.env.REST_TIMERS.get(doId);
  await stub.fetch('https://do/cancel', { method: 'POST' });

  return c.json({ ok: true });
});

// POST /api/activity
// Live-workout heartbeat. Stored in KV SESSIONS under 'presence:{uid}'.
// body.active=true → upsert with 70 s TTL (clears any hidden mark).
// body.active=false, reason='hidden' → set hiddenAt (first time only), re-store with 45 s TTL.
// body.active=false, other → delete.
app.post('/api/activity', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const user = session.user;
  const body = await c.req.json().catch(() => ({}));

  if (body.active) {
    const row = {
      name:       text(body.name).slice(0, 60),
      exIdx:      +body.exIdx    || 0,
      exTotal:    +body.exTotal  || 0,
      setsDone:   +body.setsDone  || 0,
      setsTotal:  +body.setsTotal || 0,
      startedAt:  +body.startedAt || Date.now(),
      updatedAt:  Date.now(),
    };
    await c.env.SESSIONS.put(
      'presence:' + user.id,
      JSON.stringify(row),
      { expirationTtl: PRESENCE_TTL }
    );
  } else if (body.reason === 'hidden') {
    // The first mark stands; a repeated hidden signal must not extend the grace period.
    const raw = await c.env.SESSIONS.get('presence:' + user.id);
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (p.hiddenAt === undefined) {
          p.hiddenAt = Date.now();
          await c.env.SESSIONS.put(
            'presence:' + user.id,
            JSON.stringify(p),
            { expirationTtl: PRESENCE_HIDDEN_GRACE }
          );
        }
      } catch { /* malformed entry — leave it to expire */ }
    }
  } else {
    await c.env.SESSIONS.delete('presence:' + user.id);
  }

  return c.json({ ok: true });
});

export default app;
