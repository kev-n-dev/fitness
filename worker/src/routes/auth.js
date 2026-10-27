// WebAuthn register/login, password sign-in, logout, and session helpers.
// Exported helpers (putChallenge, takeChallenge, storeSession, getSession) are
// used by health.js, pair.js and account.js.
import { Hono } from 'hono';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import {
  makeSession, verifySession,
  sessionCookieHeader, clearCookieHeaders,
} from '../lib/session.js';
import {
  hashPassword, verifyPassword, passwordProblem, nameKey,
  normalizeEmail, makeResetCode, hashResetCode, resetCodeMatches,
  RESET_TTL_MS, MIN_LENGTH, MAX_LENGTH,
} from '../lib/password.js';
import { checkBackoff, failBackoff, clearBackoff } from '../lib/rate-limit.js';
import { verifyError } from '../lib/verify-error.js';
import { audit } from '../lib/audit.js';
import {
  getUserById, getUserByName, getUserByEmail, countUsers, createUser, updateUser,
  getPasskeyById, updatePasskeyCounter, createPasskey,
  getInvite, updateInvite,
  deleteDeviceLinksByUser,
} from '../db/queries.js';
import { MAX_PASSKEYS } from '../lib/passkeys.js';

// ── Encoding helpers (no Node.js) ─────────────────────────────────────────────

function uint8ArrayToBase64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function base64urlToUint8Array(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

function genId(n = 16) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return uint8ArrayToBase64url(b);
}

const text = v => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

// ── Challenge store (KV SESSIONS namespace, key: challenge:{cid}) ──────────────

export async function putChallenge(kv, data) {
  const cid = genId(16);
  await kv.put(
    'challenge:' + cid,
    JSON.stringify({ ...data, _exp: Date.now() + 300000 }),
    { expirationTtl: 300 },
  );
  return cid;
}

export async function takeChallenge(kv, cid) {
  if (!cid || typeof cid !== 'string') return null;
  const key = 'challenge:' + cid;
  const raw = await kv.get(key);
  if (!raw) return null;
  await kv.delete(key);
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (data._exp < Date.now()) return null;
  return data;
}

// ── Session store (KV SESSIONS namespace, key: session:{userId}:{sha256(token)}) ───────

export async function storeSession(kv, token, userId, sv, sessionDays) {
  const h = await sha256hex(token);
  const ttl = Math.max(60, sessionDays * 86400);
  await kv.put(
    `session:${userId}:${h}`,
    JSON.stringify({ userId, sv: sv || 0 }),
    { expirationTtl: ttl },
  );
}

function parseCookieToken(req, isSecure) {
  const COOKIE_NAME = isSecure ? '__Host-gymsid' : 'gymsid';
  const LEGACY_COOKIE = 'gymsid';
  const cookieStr = req.header('Cookie') || '';

  const cookieValues = (name) => {
    const out = [];
    for (const part of cookieStr.split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      if (part.slice(0, i).trim() === name) out.push(part.slice(i + 1).trim());
    }
    return out;
  };

  const names = COOKIE_NAME === LEGACY_COOKIE ? [COOKIE_NAME] : [COOKIE_NAME, LEGACY_COOKIE];
  for (const name of names) {
    const vals = cookieValues(name);
    if (!vals.length) continue;
    // Two different values under the same name means a shadowing attempt — refuse both.
    if (vals.some(v => v !== vals[0])) return null;
    return vals[0];
  }
  return null;
}

export async function getSession(c) {
  const env = c.env;
  const isSecure = /^https:/i.test(env.ORIGIN || '');
  const cookieTok = parseCookieToken(c.req, isSecure);
  const authHeader = c.req.header('Authorization') || '';
  const bearerTok = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const tok = cookieTok || bearerTok;
  if (!tok) return null;

  // Verify HMAC signature
  const parsed = await verifySession(tok, env.SECRET);
  if (!parsed) return null;

  // Check KV entry (per-token revocation via logout)
  const h = await sha256hex(tok);
  const raw = await env.SESSIONS.get(`session:${parsed.userId}:${h}`);
  if (!raw) return null;

  let entry;
  try { entry = JSON.parse(raw); } catch { return null; }

  // Fetch user from D1
  const user = await getUserById(env.DB, parsed.userId);
  if (!user || user.disabled) return null;

  // Validate session version (catches logout/all)
  if ((user.sv || 0) !== (entry.sv || 0)) return null;

  return { user, exp: parsed.exp, bearer: !cookieTok, token: tok };
}

// ── Shared route helpers ──────────────────────────────────────────────────────

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

function limitAddress(req) {
  const ip = req.header('CF-Connecting-IP') ||
    (req.header('X-Forwarded-For') || '').split(',').pop().trim() ||
    req.header('X-Real-IP') ||
    'unknown';
  return ip.slice(0, 45);
}

function doAudit(c, ev, fields) {
  const ctx = c.executionCtx ?? { waitUntil: () => {} };
  audit(c.env, ctx, c.req.raw, ev, fields);
}

const POLICY_MSGS = {
  'too-short': `the password needs at least ${MIN_LENGTH} characters`,
  'too-long': `the password can have at most ${MAX_LENGTH} characters`,
  'too-common': 'this password is too easy to guess',
};

async function setCookieAndJson(c, body, token, days, secure) {
  const [cookie] = sessionCookieHeader(token, days, secure);
  return c.json(body, 200, { 'Set-Cookie': cookie });
}

async function clearSession(kv, tok, userId) {
  const h = await sha256hex(tok);
  await kv.delete(`session:${userId}:${h}`);
}

// Scan and delete all KV session entries for a user (best-effort, uses waitUntil).
// Uses per-user prefix session:{userId}: for O(1) list — no per-key reads.
async function deleteUserSessions(kv, userId) {
  let cursor;
  for (;;) {
    const opts = { prefix: `session:${userId}:`, limit: 1000 };
    if (cursor) opts.cursor = cursor;
    const result = await kv.list(opts);
    await Promise.all(result.keys.map(key => kv.delete(key.name)));
    if (result.list_complete) break;
    cursor = result.cursor;
  }
}

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono();

// POST /api/register/options
// Step 1 of passkey registration: generate WebAuthn options and store challenge.
app.post('/api/register/options', async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));

  const name = text(body.name).trim().slice(0, 40);
  if (!name) return c.json({ error: 'name required' }, 400);

  const INVITE_ONLY = /^(1|true|yes|on)$/i.test(env.INVITE_ONLY || '');
  const code = text(body.code).trim().toUpperCase();
  if (INVITE_ONLY) {
    const inv = await getInvite(env.DB, code);
    if (!inv || inv.used_by || inv.revoked) {
      doAudit(c, 'auth.register.denied', { ok: false, msg: 'invite-rejected' });
      return c.json({ error: 'a valid invite code is required', code: 'invite' }, 403);
    }
  }

  const uid = genId(12);
  const options = await generateRegistrationOptions({
    rpName: env.RP_NAME || 'openGym',
    rpID: env.RP_ID || 'localhost',
    userID: enc.encode(uid),
    userName: name,
    userDisplayName: name,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    excludeCredentials: [],
  });

  const cid = await putChallenge(env.SESSIONS, {
    kind: 'register', challenge: options.challenge, name, uid, code,
  });
  return c.json({ cid, options });
});

// POST /api/register/verify (CSRF-exempt)
// Step 2: verify the credential, create user + passkey, issue session.
app.post('/api/register/verify', async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));
  const RP_ID = env.RP_ID || 'localhost';
  const ORIGIN = env.ORIGIN || 'http://localhost:8080';

  const ch = await takeChallenge(env.SESSIONS, text(body.cid));
  if (!ch || ch.kind !== 'register' || !ch.uid) {
    doAudit(c, 'auth.register.fail', { ok: false, msg: 'challenge-expired' });
    return c.json({ error: 'challenge expired, try again', code: 'challenge-expired' }, 400);
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge: ch.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });
  } catch (e) {
    doAudit(c, 'auth.register.fail', { ok: false, msg: 'verify-error' });
    return c.json({ error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) }, 400);
  }

  if (!verification.verified) {
    doAudit(c, 'auth.register.fail', { ok: false, msg: 'not-verified' });
    return c.json({ error: 'not verified' }, 400);
  }

  const { credential } = verification.registrationInfo;

  // Reject if credential already registered
  const existing = await getPasskeyById(env.DB, credential.id);
  if (existing) {
    doAudit(c, 'auth.register.fail', { ok: false, msg: 'credential-exists' });
    return c.json({ error: 'credential already registered' }, 409);
  }

  // Re-check invite at the last moment
  const INVITE_ONLY = /^(1|true|yes|on)$/i.test(env.INVITE_ONLY || '');
  let invite = null;
  if (INVITE_ONLY) {
    invite = await getInvite(env.DB, ch.code);
    if (!invite || invite.used_by || invite.revoked) {
      doAudit(c, 'auth.register.fail', { ok: false, msg: 'invite-invalid' });
      return c.json({ error: 'invite code is no longer valid, ask for a new one', code: 'invite' }, 403);
    }
  }

  const now = new Date().toISOString();
  const FIRST_USER_ADMIN = /^(1|true|yes|on)$/i.test(env.FIRST_USER_ADMIN || '');
  const userCount = await countUsers(env.DB);
  const grantAdmin = FIRST_USER_ADMIN && userCount === 0 ? 1 : 0;

  const user = {
    id: ch.uid, name: ch.name, created: now,
    sv: 0, disabled: 0, admin: grantAdmin,
    invited_by: invite ? invite.code : null,
  };
  await createUser(env.DB, user);

  await createPasskey(env.DB, {
    id: credential.id,
    user_id: ch.uid,
    public_key: uint8ArrayToBase64url(credential.publicKey),
    counter: credential.counter || 0,
    transports: JSON.stringify(body.credential?.response?.transports || []),
    name: null,
    created: now,
    last_used: now,
  });

  if (invite) {
    await updateInvite(env.DB, invite.code, { used_by: user.id, used_at: now });
  }

  const days = sessionDays(env);
  const secure = isSecure(env);
  const token = await makeSession(user.id, 0, days, env.SECRET);
  await storeSession(env.SESSIONS, token, user.id, 0, days);

  doAudit(c, 'auth.register.ok', { ok: true, uid: user.id, name: user.name, msg: invite ? invite.code : null });

  const [cookie] = sessionCookieHeader(token, days, secure);
  return c.json({ user: publicUser(user, env) }, 200, { 'Set-Cookie': cookie });
});

// POST /api/login/options
// Step 1 of passkey authentication: generate challenge.
app.post('/api/login/options', async (c) => {
  const env = c.env;
  const options = await generateAuthenticationOptions({
    rpID: env.RP_ID || 'localhost',
    userVerification: 'preferred',
    allowCredentials: [],
  });
  const cid = await putChallenge(env.SESSIONS, { kind: 'login', challenge: options.challenge });
  return c.json({ cid, options });
});

// POST /api/login/verify (CSRF-exempt)
// Step 2: verify the assertion, issue session.
app.post('/api/login/verify', async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));
  const RP_ID = env.RP_ID || 'localhost';
  const ORIGIN = env.ORIGIN || 'http://localhost:8080';

  const ch = await takeChallenge(env.SESSIONS, text(body.cid));
  if (ch?.kind !== 'login') {
    doAudit(c, 'auth.login.fail', { ok: false, msg: 'challenge-expired' });
    return c.json({ error: 'challenge expired, try again', code: 'challenge-expired' }, 400);
  }

  const cred = await getPasskeyById(env.DB, body.credential?.id);
  if (!cred) {
    doAudit(c, 'auth.login.fail', { ok: false, msg: 'unknown-credential' });
    return c.json({ error: 'unknown passkey, create a profile first', code: 'unknown-credential' }, 404);
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.credential,
      expectedChallenge: ch.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
      credential: {
        id: cred.id,
        publicKey: base64urlToUint8Array(cred.public_key),
        counter: cred.counter,
        transports: JSON.parse(cred.transports || '[]'),
      },
    });
  } catch (e) {
    doAudit(c, 'auth.login.fail', { ok: false, uid: cred.user_id, msg: 'verify-error' });
    return c.json({ error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) }, 400);
  }

  if (!verification.verified) {
    doAudit(c, 'auth.login.fail', { ok: false, uid: cred.user_id, msg: 'not-verified' });
    return c.json({ error: 'not verified' }, 400);
  }

  await updatePasskeyCounter(
    env.DB, cred.id,
    verification.authenticationInfo.newCounter,
    new Date().toISOString(),
  );

  const user = await getUserById(env.DB, cred.user_id);
  if (!user) return c.json({ error: 'user missing' }, 500);
  if (user.disabled) {
    doAudit(c, 'auth.login.fail', { ok: false, uid: user.id, name: user.name, msg: 'account-disabled' });
    return c.json({ error: 'this account has been disabled', code: 'disabled' }, 403);
  }

  const days = sessionDays(env);
  const secure = isSecure(env);
  const sv = user.sv || 0;
  const token = await makeSession(user.id, sv, days, env.SECRET);
  await storeSession(env.SESSIONS, token, user.id, sv, days);

  doAudit(c, 'auth.login.ok', { ok: true, uid: user.id, name: user.name });

  const [cookie] = sessionCookieHeader(token, days, secure);
  return c.json({ user: publicUser(user, env) }, 200, { 'Set-Cookie': cookie });
});

// POST /api/logout
// Delete this session's KV entry and clear the cookie.
app.post('/api/logout', async (c) => {
  const env = c.env;
  const session = await getSession(c);
  if (session) {
    await clearSession(env.SESSIONS, session.token, session.user.id);
    doAudit(c, 'auth.logout', { ok: true, uid: session.user.id, name: session.user.name });
  }
  const [cookie] = clearCookieHeaders(isSecure(env));
  return c.json({ ok: true }, 200, { 'Set-Cookie': cookie });
});

// POST /api/logout/all
// Bump sv (invalidates every existing token), delete KV sessions, drop device links.
app.post('/api/logout/all', async (c) => {
  const env = c.env;
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const newSv = (user.sv || 0) + 1;

  await updateUser(env.DB, user.id, { sv: newSv });
  await deleteDeviceLinksByUser(env.DB, user.id);

  // Best-effort KV cleanup; don't block the response.
  const ctx = c.executionCtx ?? { waitUntil: () => {} };
  ctx.waitUntil(
    deleteUserSessions(env.SESSIONS, user.id).catch(e =>
      console.error('logout/all kv cleanup:', e?.message)),
  );

  doAudit(c, 'auth.logout.all', { ok: true, uid: user.id, name: user.name });

  const [cookie] = clearCookieHeaders(isSecure(env));
  return c.json({ ok: true }, 200, { 'Set-Cookie': cookie });
});

// POST /api/login/password (PASSWORD_LOGIN guard)
app.post('/api/login/password', async (c) => {
  const env = c.env;
  if (!/^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '')) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const pw = typeof body.password === 'string' ? body.password : '';
  const k = nameKey(text(body.identifier ?? body.name ?? body.email).slice(0, 300));
  if (!k || !pw) return c.json({ error: 'name and password required', code: 'missing' }, 400);

  const addr = limitAddress(c.req);
  const addrKey = 'password|' + addr;
  const addrOpts = { free: 20, baseMs: 30000, maxMs: 15 * 60000, forgetMs: 3600000 };

  const addrState = await checkBackoff(env.RATE_LIMITS, addrKey, addrOpts);
  if (addrState.locked) {
    return c.json({ error: 'too many attempts, try again later', code: 'locked', retryAfter: addrState.retryAfter }, 429, { 'Retry-After': String(addrState.retryAfter) });
  }

  // Resolve the login target (email or name)
  let user = k.includes('@') ? await getUserByEmail(env.DB, k) : null;
  if (!user) user = await getUserByName(env.DB, k);

  if (!user || !user.pw_hash) {
    await failBackoff(env.RATE_LIMITS, addrKey, addrOpts);
    doAudit(c, 'auth.password.fail', { ok: false, msg: 'unknown-name' });
    return c.json({ error: 'wrong name or password', code: 'bad-credentials' }, 401);
  }

  const acctKey = 'acct:' + user.id;
  const acctOpts = { free: 5, baseMs: 60000, maxMs: 3600000, forgetMs: 24 * 3600000 };

  const acctState = await checkBackoff(env.RATE_LIMITS, acctKey, acctOpts);
  if (acctState.locked) {
    return c.json({ error: 'too many attempts, try again later', code: 'locked', retryAfter: acctState.retryAfter }, 429, { 'Retry-After': String(acctState.retryAfter) });
  }

  const result = await verifyPassword(pw, user.pw_hash);
  if (!result.ok) {
    await Promise.all([
      failBackoff(env.RATE_LIMITS, acctKey, acctOpts),
      failBackoff(env.RATE_LIMITS, addrKey, addrOpts),
    ]);
    doAudit(c, 'auth.password.fail', { ok: false, uid: user.id, name: user.name, msg: result.needsReset ? 'needs-reset' : 'bad-password' });
    return c.json({ error: 'wrong name or password', code: 'bad-credentials' }, 401);
  }

  await clearBackoff(env.RATE_LIMITS, acctKey);

  if (user.disabled) {
    doAudit(c, 'auth.password.fail', { ok: false, uid: user.id, name: user.name, msg: 'account-disabled' });
    return c.json({ error: 'this account has been disabled', code: 'disabled' }, 403);
  }

  const days = sessionDays(env);
  const secure = isSecure(env);
  const sv = user.sv || 0;
  const token = await makeSession(user.id, sv, days, env.SECRET);
  await storeSession(env.SESSIONS, token, user.id, sv, days);

  doAudit(c, 'auth.password.ok', { ok: true, uid: user.id, name: user.name });

  const [cookie] = sessionCookieHeader(token, days, secure);
  return c.json({ user: publicUser(user, env) }, 200, { 'Set-Cookie': cookie });
});

// POST /api/register/password (PASSWORD_LOGIN guard)
app.post('/api/register/password', async (c) => {
  const env = c.env;
  if (!/^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '')) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const name = text(body.name).trim().slice(0, 40);
  if (!name) return c.json({ error: 'name required', code: 'missing' }, 400);

  const code = text(body.code).trim().toUpperCase();
  const addr = limitAddress(c.req);
  const INVITE_ONLY = /^(1|true|yes|on)$/i.test(env.INVITE_ONLY || '');
  const addrOpts = { free: 20, baseMs: 30000, maxMs: 15 * 60000, forgetMs: 3600000 };

  if (INVITE_ONLY) {
    const addrState = await checkBackoff(env.RATE_LIMITS, 'signup|' + addr, addrOpts);
    if (addrState.locked) return c.json({ error: 'too many attempts', code: 'locked' }, 429);
    const inv = await getInvite(env.DB, code);
    if (!inv || inv.used_by || inv.revoked) {
      await failBackoff(env.RATE_LIMITS, 'signup|' + addr, addrOpts);
      doAudit(c, 'auth.register.denied', { ok: false, msg: 'invite-rejected' });
      return c.json({ error: 'a valid invite code is required', code: 'invite' }, 403);
    }
  }

  const problem = passwordProblem(body.password, name);
  if (problem) return c.json({ error: POLICY_MSGS[problem] || problem, code: problem }, 400);

  // Name must be unique among password-holding users
  const nameUser = await getUserByName(env.DB, nameKey(name));
  if (nameUser && nameUser.pw_hash) {
    return c.json({ error: 'another profile already signs in with this name', code: 'name-taken' }, 409);
  }

  // Optional email
  const hasEmail = typeof body.email === 'string' && body.email.trim() !== '';
  const email = hasEmail ? normalizeEmail(body.email) : null;
  if (hasEmail && !email) return c.json({ error: 'that is not an e-mail address', code: 'email-invalid' }, 400);
  if (email) {
    const emailUser = await getUserByEmail(env.DB, email);
    if (emailUser) {
      await failBackoff(env.RATE_LIMITS, 'email|' + addr, addrOpts);
      return c.json({ error: 'another profile already uses this e-mail address', code: 'email-taken' }, 409);
    }
  }

  const h = await hashPassword(body.password);
  const now = new Date().toISOString();

  // Re-check invite after hash (races may have used/revoked it)
  let invite = null;
  if (INVITE_ONLY) {
    invite = await getInvite(env.DB, code);
    if (!invite || invite.used_by || invite.revoked) {
      return c.json({ error: 'invite code is no longer valid, ask for a new one', code: 'invite' }, 403);
    }
  }

  const FIRST_USER_ADMIN = /^(1|true|yes|on)$/i.test(env.FIRST_USER_ADMIN || '');
  const userCount = await countUsers(env.DB);
  const grantAdmin = FIRST_USER_ADMIN && userCount === 0 ? 1 : 0;

  const uid = genId(12);
  const user = {
    id: uid, name, created: now, sv: 0, disabled: 0,
    admin: grantAdmin,
    invited_by: invite ? invite.code : null,
    pw_hash: h, pw_set: now,
    email: email || null,
  };
  await createUser(env.DB, user);
  if (invite) await updateInvite(env.DB, invite.code, { used_by: uid, used_at: now });

  const days = sessionDays(env);
  const secure = isSecure(env);
  const token = await makeSession(uid, 0, days, env.SECRET);
  await storeSession(env.SESSIONS, token, uid, 0, days);

  doAudit(c, 'auth.register.ok', { ok: true, uid, name, msg: invite ? invite.code + ' · password' : 'password' });

  const [cookie] = sessionCookieHeader(token, days, secure);
  return c.json({ user: publicUser(user, env) }, 200, { 'Set-Cookie': cookie });
});

// POST /api/login/password-reset (PASSWORD_LOGIN guard, CSRF-exempt)
app.post('/api/login/password-reset', async (c) => {
  const env = c.env;
  if (!/^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '')) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const k = nameKey(text(body.identifier ?? body.name ?? body.email).slice(0, 300));
  const code = text(body.code).slice(0, 64);
  if (!k || !code) return c.json({ error: 'name and code required', code: 'missing' }, 400);

  const addr = limitAddress(c.req);
  const addrKey = 'password|' + addr;
  const addrOpts = { free: 20, baseMs: 30000, maxMs: 15 * 60000, forgetMs: 3600000 };

  const addrState = await checkBackoff(env.RATE_LIMITS, addrKey, addrOpts);
  if (addrState.locked) {
    return c.json({ error: 'too many attempts, try again later', code: 'locked', retryAfter: addrState.retryAfter }, 429, { 'Retry-After': String(addrState.retryAfter) });
  }

  let user = k.includes('@') ? await getUserByEmail(env.DB, k) : null;
  if (!user) user = await getUserByName(env.DB, k);

  const invalid = () => c.json({ error: 'that reset code is wrong or has expired', code: 'reset-invalid' }, 400);

  if (!user || !user.pw_reset_hash || !(user.pw_reset_exp > Date.now())) {
    await failBackoff(env.RATE_LIMITS, addrKey, addrOpts);
    doAudit(c, 'auth.password.reset', { ok: false, msg: 'reset-invalid' });
    return invalid();
  }

  const codeMatches = await resetCodeMatches(code, { h: user.pw_reset_hash, exp: user.pw_reset_exp });
  if (!codeMatches) {
    await failBackoff(env.RATE_LIMITS, addrKey, addrOpts);
    doAudit(c, 'auth.password.reset', { ok: false, msg: 'reset-invalid' });
    return invalid();
  }

  if (user.disabled) return c.json({ error: 'this account has been disabled', code: 'disabled' }, 403);

  const problem = passwordProblem(body.next, user.name);
  if (problem) return c.json({ error: POLICY_MSGS[problem] || problem, code: problem }, 400);

  const h = await hashPassword(body.next);
  const now = new Date().toISOString();
  const newSv = (user.sv || 0) + 1;

  await updateUser(env.DB, user.id, {
    pw_hash: h, pw_set: now,
    pw_reset_hash: null, pw_reset_exp: null, pw_reset_by: null,
    sv: newSv,
  });
  await deleteDeviceLinksByUser(env.DB, user.id);
  await clearBackoff(env.RATE_LIMITS, 'acct:' + user.id);

  const days = sessionDays(env);
  const secure = isSecure(env);
  const token = await makeSession(user.id, newSv, days, env.SECRET);
  await storeSession(env.SESSIONS, token, user.id, newSv, days);

  doAudit(c, 'auth.password.reset', { ok: true, uid: user.id, name: user.name });

  const updatedUser = { ...user, sv: newSv, pw_hash: h };
  const [cookie] = sessionCookieHeader(token, days, secure);
  return c.json({ user: publicUser(updatedUser, env) }, 200, { 'Set-Cookie': cookie });
});

export default app;
