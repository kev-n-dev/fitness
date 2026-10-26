import { Hono } from 'hono';
import { cors } from 'hono/cors';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import pairRoutes from './routes/pair.js';
import accountRoutes from './routes/account.js';
import syncRoutes from './routes/sync.js';
import pushRoutes from './routes/push.js';
import adminRoutes, { reminderTick } from './routes/admin.js';
import mediaRoutes from './routes/media.js';
export { RestTimerDO } from './durable/rest-timer.js';

const APP_ORIGINS = [
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
];

// Routes exempt from CSRF checks. These routes carry their own one-shot
// credential in the body (a WebAuthn challenge id, a pairing/link code) so
// they can be called from mobile WebViews whose origin never matches ORIGIN.
const CSRF_EXEMPT = new Set([
  '/api/register/verify',
  '/api/login/verify',
  '/api/pair/redeem',
  '/api/device-link/verify',
  '/api/login/password-reset',
]);

const app = new Hono();

// ── CORS middleware ───────────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';
  const envOrigin = c.env?.ORIGIN || '';
  const allowed = [...APP_ORIGINS, envOrigin].filter(Boolean);
  if (allowed.includes(origin)) {
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

// ── CSRF middleware ───────────────────────────────────────────────────────────
// State-changing requests from a browser must come from ORIGIN.
// Exemptions carry their own credential (WebAuthn cid / pair code / reset code).
// Bearer-authenticated requests (mobile app) are never subject to CSRF.
app.use('*', async (c, next) => {
  const method = c.req.method;
  // Idempotent methods are safe.
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const path = new URL(c.req.url).pathname;
  if (CSRF_EXEMPT.has(path)) return next();

  // Bearer token = mobile app; no ambient session to steal.
  const auth = c.req.header('Authorization') || '';
  if (auth.startsWith('Bearer ')) return next();

  // Sec-Fetch-Site is set by browsers and cannot be forged by a page.
  const site = c.req.header('Sec-Fetch-Site');
  if (site) {
    if (site === 'same-origin' || site === 'none') return next();
    return c.json({ error: 'CSRF check failed', code: 'csrf' }, 403);
  }

  // Fallback: compare Origin header to the configured ORIGIN.
  const origin = c.req.header('Origin');
  if (!origin) return next(); // curl / monitoring — not a browser
  const ORIGIN = (c.env?.ORIGIN || '').replace(/\/+$/, '');
  if (origin.replace(/\/+$/, '') === ORIGIN) return next();
  return c.json({ error: 'CSRF check failed', code: 'csrf' }, 403);
});

// ── Route modules ─────────────────────────────────────────────────────────────
app.route('/', healthRoutes);
app.route('/', authRoutes);
app.route('/', pairRoutes);
app.route('/', accountRoutes);
app.route('/', syncRoutes);
app.route('/', pushRoutes);
app.route('/', adminRoutes);
app.route('/', mediaRoutes);

// ── Default export ────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,

  async scheduled(event, env, ctx) {
    ctx.waitUntil(reminderTick(env, ctx));
  },
};
