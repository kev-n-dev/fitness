// Google OAuth login routes.
// Uses existing session helpers from auth.js and native fetch for Google API calls.
import { Hono } from 'hono';
import {
  makeSession, sessionCookieHeader,
} from '../lib/session.js';
import { putChallenge, takeChallenge, storeSession } from './auth.js';
import { audit } from '../lib/audit.js';
import { createLogger } from '../lib/logger.js';
import {
  getUserById, getUserByEmail, getUserByGoogleId, countUsers,
  createUser, linkGoogleAccount, updateGoogleTokens,
} from '../db/queries.js';

const log = createLogger('google-auth');

// ── Encoding helpers ──────────────────────────────────────────────────────────

function uint8ArrayToBase64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function genId(n = 16) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return uint8ArrayToBase64url(b);
}

// ── Google OAuth constants ────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Scopes: basic profile + email + Google Fit read access
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.body.read',
].join(' ');

// Login-only scopes (no fitness)
const LOGIN_SCOPES = ['openid', 'email', 'profile'].join(' ');

// ── Helper functions ──────────────────────────────────────────────────────────

function adminUids(env) {
  return (env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

function isAdmin(user, uids) {
  return !!user && (user.admin === 1 || uids.includes(user.id));
}

function publicUser(user, env) {
  return { id: user.id, name: user.name, admin: isAdmin(user, adminUids(env)) };
}

function sessionDays(env) {
  return Math.max(1, +(env.SESSION_DAYS || 90) || 90);
}

function isSecure(env) {
  return /^https:/i.test(env.ORIGIN || '');
}

function doAudit(c, ev, fields) {
  const ctx = c.executionCtx ?? { waitUntil: () => {} };
  audit(c.env, ctx, c.req.raw, ev, fields);
}

function getRedirectUri(env) {
  const origin = env.ORIGIN || 'http://localhost:8080';
  return env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`;
}

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono();

// GET /api/auth/google
// Step 1: Redirect to Google OAuth consent screen.
// Query params:
//   - fit=1: request Google Fit scopes in addition to login
//   - return_to: URL to redirect to after successful login (default: /)
app.get('/api/auth/google', async (c) => {
  const env = c.env;

  if (!env.GOOGLE_CLIENT_ID) {
    log.warn(env, 'google/auth: GOOGLE_CLIENT_ID not configured');
    return c.json({ error: 'Google login is not configured' }, 503);
  }

  const url = new URL(c.req.url);
  const requestFit = url.searchParams.get('fit') === '1';
  const returnTo = url.searchParams.get('return_to') || '/';

  // Create a state parameter for CSRF protection
  const state = await putChallenge(env.SESSIONS, {
    kind: 'google-oauth',
    fit: requestFit,
    return_to: returnTo,
  });

  const redirectUri = getRedirectUri(env);
  const scopes = requestFit ? SCOPES : LOGIN_SCOPES;

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline'); // Get refresh token
  authUrl.searchParams.set('prompt', 'consent'); // Always show consent to get refresh token

  log.debug(env, 'google/auth: redirecting to Google', { state, fit: requestFit });
  return c.redirect(authUrl.toString());
});

// GET /api/auth/google/callback
// Step 2: Handle OAuth callback, exchange code for tokens, find/create user.
app.get('/api/auth/google/callback', async (c) => {
  const env = c.env;
  const url = new URL(c.req.url);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Handle OAuth errors
  if (error) {
    log.info(env, 'google/callback: OAuth error', { error });
    doAudit(c, 'auth.google.fail', { ok: false, msg: `oauth-error: ${error}` });
    return c.redirect('/?google=error&reason=' + encodeURIComponent(error));
  }

  if (!code || !state) {
    log.warn(env, 'google/callback: missing code or state');
    doAudit(c, 'auth.google.fail', { ok: false, msg: 'missing-params' });
    return c.redirect('/?google=error&reason=missing-params');
  }

  // Validate state (CSRF protection)
  const challenge = await takeChallenge(env.SESSIONS, state);
  if (!challenge || challenge.kind !== 'google-oauth') {
    log.warn(env, 'google/callback: invalid state', { state });
    doAudit(c, 'auth.google.fail', { ok: false, msg: 'invalid-state' });
    return c.redirect('/?google=error&reason=invalid-state');
  }

  const returnTo = challenge.return_to || '/';
  const requestedFit = challenge.fit;

  // Exchange code for tokens
  let tokens;
  try {
    const redirectUri = getRedirectUri(env);
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      log.warn(env, 'google/callback: token exchange failed', { status: tokenRes.status, error: err });
      doAudit(c, 'auth.google.fail', { ok: false, msg: 'token-exchange-failed' });
      return c.redirect('/?google=error&reason=token-exchange');
    }

    tokens = await tokenRes.json();
  } catch (e) {
    log.error(env, 'google/callback: token fetch error', { error: e.message });
    doAudit(c, 'auth.google.fail', { ok: false, msg: 'token-fetch-error' });
    return c.redirect('/?google=error&reason=token-error');
  }

  // Get user info from Google
  let googleUser;
  try {
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      log.warn(env, 'google/callback: userinfo fetch failed', { status: userRes.status });
      doAudit(c, 'auth.google.fail', { ok: false, msg: 'userinfo-failed' });
      return c.redirect('/?google=error&reason=userinfo');
    }

    googleUser = await userRes.json();
  } catch (e) {
    log.error(env, 'google/callback: userinfo fetch error', { error: e.message });
    doAudit(c, 'auth.google.fail', { ok: false, msg: 'userinfo-error' });
    return c.redirect('/?google=error&reason=userinfo-error');
  }

  const googleId = googleUser.id;
  const email = googleUser.email?.toLowerCase().trim();
  const name = googleUser.name || email?.split('@')[0] || 'User';

  if (!googleId) {
    log.warn(env, 'google/callback: no google id in response');
    doAudit(c, 'auth.google.fail', { ok: false, msg: 'no-google-id' });
    return c.redirect('/?google=error&reason=no-google-id');
  }

  // Calculate token expiry
  const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;

  // Check if fitness scopes were actually granted
  const grantedScopes = tokens.scope ? tokens.scope.split(' ') : [];
  const fitGranted = grantedScopes.some(s => s.includes('fitness'));

  // Find existing user by Google ID or email
  let user = await getUserByGoogleId(env.DB, googleId);
  let isNewUser = false;

  if (!user && email) {
    // Try to find by email and link the Google account
    user = await getUserByEmail(env.DB, email);
    if (user) {
      // Link Google account to existing user
      await linkGoogleAccount(env.DB, user.id, {
        google_id: googleId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        fit_enabled: requestedFit && fitGranted,
      });
      log.info(env, 'google/callback: linked Google to existing user', { userId: user.id, email });
    }
  }

  if (!user) {
    // Create new user
    const INVITE_ONLY = /^(1|true|yes|on)$/i.test(env.INVITE_ONLY || '');
    if (INVITE_ONLY) {
      log.info(env, 'google/callback: invite required but not provided');
      doAudit(c, 'auth.google.fail', { ok: false, msg: 'invite-required' });
      return c.redirect('/?google=error&reason=invite-required');
    }

    const FIRST_USER_ADMIN = /^(1|true|yes|on)$/i.test(env.FIRST_USER_ADMIN || '');
    const userCount = await countUsers(env.DB);
    const grantAdmin = FIRST_USER_ADMIN && userCount === 0 ? 1 : 0;

    const uid = genId(12);
    const now = new Date().toISOString();

    user = {
      id: uid,
      name: name.slice(0, 40),
      created: now,
      sv: 0,
      disabled: 0,
      admin: grantAdmin,
      invited_by: null,
      email: email || null,
      google_id: googleId,
      google_access_token: tokens.access_token,
      google_refresh_token: tokens.refresh_token || null,
      google_token_expires: expiresAt,
      google_fit_enabled: requestedFit && fitGranted ? 1 : 0,
    };

    await createUser(env.DB, user);
    isNewUser = true;
    log.info(env, 'google/callback: created new user via Google', { userId: uid, name: user.name });
  } else if (user.google_id === googleId) {
    // Existing Google-linked user - update tokens
    await updateGoogleTokens(env.DB, user.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
    });
  }

  // Check if user is disabled
  if (user.disabled) {
    log.info(env, 'google/callback: user disabled', { userId: user.id });
    doAudit(c, 'auth.google.fail', { ok: false, uid: user.id, msg: 'disabled' });
    return c.redirect('/?google=error&reason=disabled');
  }

  // Create session
  const days = sessionDays(env);
  const secure = isSecure(env);
  const sv = user.sv || 0;
  const token = await makeSession(user.id, sv, days, env.SECRET);
  await storeSession(env.SESSIONS, token, user.id, sv, days);

  doAudit(c, 'auth.google.ok', {
    ok: true,
    uid: user.id,
    name: user.name,
    msg: isNewUser ? 'new-user' : 'existing-user',
  });

  log.info(env, 'google/callback: login successful', { userId: user.id, isNewUser });

  // Set session cookie and redirect
  const [cookie] = sessionCookieHeader(token, days, secure);
  const redirectUrl = new URL(returnTo, env.ORIGIN || 'http://localhost:8080');
  redirectUrl.searchParams.set('google', 'success');
  if (requestedFit && !fitGranted) {
    redirectUrl.searchParams.set('fit', 'denied');
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl.pathname + redirectUrl.search,
      'Set-Cookie': cookie,
    },
  });
});

export default app;
