// Mobile-app pairing: create (browser) and redeem (mobile) one-time codes.
// Codes live in KV SESSIONS as 'pair:{code}', TTL 300 s.
import { Hono } from 'hono';
import { makeSession, sessionCookieHeader } from '../lib/session.js';
import { getUserById } from '../db/queries.js';
import { audit } from '../lib/audit.js';
import { getSession, storeSession } from './auth.js';

const PAIR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makePairCode() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, byte => PAIR_CODE_ALPHABET[byte % PAIR_CODE_ALPHABET.length]).join('');
}

function doAudit(c, ev, fields) {
  const ctx = c.executionCtx ?? { waitUntil: () => {} };
  audit(c.env, ctx, c.req.raw, ev, fields);
}

function adminUids(env) {
  return (env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

const app = new Hono();

// POST /api/pair/create
// Signed-in browser mints a short code the mobile app redeems.
app.post('/api/pair/create', async (c) => {
  const env = c.env;
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const code = makePairCode();

  await env.SESSIONS.put(
    'pair:' + code,
    JSON.stringify({ uid: user.id, exp: Date.now() + 300000 }),
    { expirationTtl: 300 },
  );

  doAudit(c, 'auth.pair.create', { ok: true, uid: user.id, name: user.name });
  return c.json({ code });
});

// POST /api/pair/redeem (CSRF-exempt)
// Mobile app redeems the code; receives a bearer token (no cookie).
app.post('/api/pair/redeem', async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));

  const rawCode = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const key = 'pair:' + rawCode;

  const raw = await env.SESSIONS.get(key);
  if (raw) await env.SESSIONS.delete(key);

  if (!raw) {
    doAudit(c, 'auth.pair.fail', { ok: false, msg: 'code-invalid' });
    return c.json({ error: 'invalid or expired code', code: 'pair-invalid' }, 400);
  }

  let entry;
  try { entry = JSON.parse(raw); } catch { entry = null; }

  if (!entry || entry.exp < Date.now()) {
    doAudit(c, 'auth.pair.fail', { ok: false, msg: 'code-expired' });
    return c.json({ error: 'invalid or expired code', code: 'pair-invalid' }, 400);
  }

  const user = await getUserById(env.DB, entry.uid);
  if (!user || user.disabled) {
    doAudit(c, 'auth.pair.fail', { ok: false, uid: entry.uid, msg: 'user-unavailable' });
    return c.json({ error: 'invalid or expired code', code: 'pair-invalid' }, 400);
  }

  const SESSION_DAYS = Math.max(1, +(env.SESSION_DAYS || 90) || 90);
  const sv = user.sv || 0;
  const token = await makeSession(user.id, sv, SESSION_DAYS, env.SECRET);
  await storeSession(env.SESSIONS, token, user.id, sv, SESSION_DAYS);

  const uids = adminUids(env);
  const admin = user.admin === 1 || uids.includes(user.id);

  doAudit(c, 'auth.pair.ok', { ok: true, uid: user.id, name: user.name });

  // Mobile app gets a bearer token; no cookie needed.
  return c.json({ token, user: { id: user.id, name: user.name, admin } });
});

export default app;
