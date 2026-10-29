// Health, config, and me routes.
import { Hono } from 'hono';
import { generateVAPIDKeys } from '../lib/push.js';
import { countUsers, getVapidKeys, putVapidKeys } from '../db/queries.js';
import { makeSession, sessionCookieHeader } from '../lib/session.js';
import { getSession, storeSession } from './auth.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('health');
const app = new Hono();

// ── GET /api/health ───────────────────────────────────────────────────────────
// 200 {ok,users,writable} or 503 {ok:false,writable:false}
app.get('/api/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1 AS ok').first();
    const users = await countUsers(c.env.DB);
    return c.json({ ok: true, users, writable: true });
  } catch (e) {
    log.error(c.env, 'health probe failed', { error: e?.message });
    return c.json({ ok: false, writable: false }, 503);
  }
});

// ── GET /api/config ───────────────────────────────────────────────────────────
// Reads env flags; boots VAPID on first call; returns public config.
app.get('/api/config', async (c) => {
  const env = c.env;
  const INVITE_ONLY = /^(1|true|yes|on)$/i.test(env.INVITE_ONLY || '');
  const ALLOW_GUEST = !/^(0|false|no|off)$/i.test(env.ALLOW_GUEST || '');
  const PASSWORD_LOGIN = /^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '');
  const DEFAULT_LANG = (() => {
    const v = String(env.DEFAULT_LANG || '').trim();
    if (!v) return '';
    if (/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(v)) return v;
    return '';
  })();

  // Load (or generate on first boot) the VAPID public key.
  // Check KV APP_CONFIG first for a fast cache hit; fall back to D1.
  let vapidPublicKey = null;
  try {
    vapidPublicKey = await env.APP_CONFIG.get('vapid_public_key');
    if (!vapidPublicKey) {
      const row = await getVapidKeys(env.DB);
      if (row) {
        vapidPublicKey = row.public_key;
      } else {
        // First boot — generate, persist, cache.
        log.info(env, 'generating VAPID keys (first boot)');
        const keys = await generateVAPIDKeys();
        await putVapidKeys(env.DB, keys.publicKey, keys.privateKey);
        vapidPublicKey = keys.publicKey;
      }
      await env.APP_CONFIG.put('vapid_public_key', vapidPublicKey);
    }
  } catch (e) {
    log.error(env, 'vapid error', { error: e?.message });
  }

  const resp = {
    invite_only: INVITE_ONLY,
    allow_guest: ALLOW_GUEST,
    ...(PASSWORD_LOGIN ? { password_login: true } : {}),
    ...(DEFAULT_LANG ? { default_lang: DEFAULT_LANG } : {}),
  };

  const MEDIA_ON = /^(1|true|yes|on)$/i.test(env.MEDIA_UPLOADS || '');
  if (MEDIA_ON) {
    resp.media = {
      quota_mb: +(env.MEDIA_QUOTA_MB || 200),
      image_max_mb: +(env.MEDIA_IMAGE_MAX_MB || 2),
      gif_max_mb: +(env.MEDIA_GIF_MAX_MB || 8),
      video_max_mb: +(env.MEDIA_VIDEO_MAX_MB || 40),
      video_max_sec: +(env.MEDIA_VIDEO_MAX_SEC || 60),
    };
  }

  return c.json(resp);
});

// ── GET /api/me ───────────────────────────────────────────────────────────────
// Returns {user}; renews bearer token when it is past half-life.
app.get('/api/me', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user, exp, bearer } = session;
  const env = c.env;
  const SESSION_DAYS = Math.max(1, +(env.SESSION_DAYS || 90) || 90);
  const ADMIN_UIDS = (env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const admin = user.admin === 1 || ADMIN_UIDS.includes(user.id);

  const resp = { user: { id: user.id, name: user.name, admin } };

  if (bearer && exp - Date.now() < SESSION_DAYS * 86400000 / 2) {
    const sv = user.sv || 0;
    const newToken = await makeSession(user.id, sv, SESSION_DAYS, env.SECRET);
    await storeSession(env.SESSIONS, newToken, user.id, sv, SESSION_DAYS);
    resp.token = newToken;
  }

  return c.json(resp);
});

export default app;
