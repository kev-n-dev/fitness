import { Hono } from 'hono';
import { cors } from 'hono/cors';
export { RestTimerDO } from './durable/rest-timer.js';

const APP_ORIGINS = [
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
];

const app = new Hono();

// ── CORS middleware ───────────────────────────────────────────────────────────
// Reflect Origin for requests from the app's known origins (mobile + local dev)
// plus whatever ORIGIN is set in env.
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';
  const envOrigin = c.env?.ORIGIN || '';
  const allowed = [...APP_ORIGINS, envOrigin].filter(Boolean);
  if (allowed.includes(origin)) {
    // Manual CORS headers so we can reflect the exact origin and allow credentials
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    c.header('Vary', 'Origin');
  }
  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: c.res.headers });
  }
  return next();
});

// ── Health stub ───────────────────────────────────────────────────────────────
app.get('/api/health', c => c.json({ ok: true }));

// ── Default export ────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,

  async scheduled(event, env, ctx) {
    // reminderTick stub — full implementation in a later FEAT.
  },
};
