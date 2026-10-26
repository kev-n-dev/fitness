// Account management: passkeys CRUD, device links, name/password/email, admin reset.
import { Hono } from 'hono';
import {
  generateRegistrationOptions, verifyRegistrationResponse, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import {
  makeSession, sessionCookieHeader,
} from '../lib/session.js';
import {
  hashPassword, verifyPassword, passwordProblem, nameKey,
  normalizeEmail, maskEmail, makeResetCode, hashResetCode,
  RESET_TTL_MS, MIN_LENGTH, MAX_LENGTH,
} from '../lib/password.js';
import { checkBackoff, failBackoff, clearBackoff } from '../lib/rate-limit.js';
import { verifyError } from '../lib/verify-error.js';
import { audit } from '../lib/audit.js';
import { makeLinkCode, hashLinkCode } from '../lib/device-link.js';
import { passkeyName, MAX_PASSKEYS } from '../lib/passkeys.js';
import {
  getUserById, updateUser, countUsers,
  getPasskeyById, getPasskeysByUser, createPasskey, updatePasskeyCounter,
  renamePasskey, deletePasskey,
  createDeviceLink, getDeviceLink, deleteDeviceLink, deleteDeviceLinksByUser,
} from '../db/queries.js';
import {
  putChallenge, takeChallenge, storeSession, getSession,
  base64urlToUint8Array,
} from './auth.js';

// ── Encoding helpers ──────────────────────────────────────────────────────────

function uint8ArrayToBase64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

const enc = new TextEncoder();
const text = v => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

// ── Shared helpers ────────────────────────────────────────────────────────────

function adminUids(env) {
  return (env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
}
function isAdmin(user, env) {
  return !!user && (user.admin === 1 || adminUids(env).includes(user.id));
}
function publicUser(user, env) {
  return { id: user.id, name: user.name, admin: isAdmin(user, env) };
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

const LIMIT = { error: `a profile can have at most ${MAX_PASSKEYS} passkeys`, code: 'passkey-limit' };
const LINK_INVALID = { error: 'that code is wrong, used or expired', code: 'link-invalid' };

// getSessionOrFail: returns the session or sends 401 and returns null.
async function getSessionOrFail(c) {
  const session = await getSession(c);
  if (!session) {
    // The caller checks for null and returns the 401 response.
    return null;
  }
  return session;
}

// passkeyState: the shape returned by all passkey-management routes.
async function passkeyState(env, user) {
  const PASSWORD_LOGIN = /^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '');
  const passkeys = await getPasskeysByUser(env.DB, user.id);
  const passwordWayIn = PASSWORD_LOGIN && !!user.pw_hash;
  return {
    passkeys: passkeys.map(p => ({
      id: p.id,
      name: p.name || null,
      created: p.created || null,
      lastUsed: p.last_used || null,
      transports: JSON.parse(p.transports || '[]'),
    })),
    password: passwordWayIn,
    lastWayIn: passkeys.length + (passwordWayIn ? 1 : 0) <= 1,
  };
}

// passkeyRemovalRefused: returns an error object or null.
async function passkeyRemovalRefused(env, user, credId, otherWays = 0) {
  const cred = await getPasskeyById(env.DB, credId);
  if (!cred || cred.user_id !== user.id) return { error: 'passkey not found', code: 'not-found' };
  const all = await getPasskeysByUser(env.DB, user.id);
  if (all.length - 1 + otherWays < 1) {
    return { error: 'this passkey is the only way into this profile', code: 'last-way-in' };
  }
  return null;
}

// moreOptions: registration options excluding this user's existing passkeys.
async function moreOptions(env, user) {
  const passkeys = await getPasskeysByUser(env.DB, user.id);
  return generateRegistrationOptions({
    rpName: env.RP_NAME || 'openGym',
    rpID: env.RP_ID || 'localhost',
    userID: enc.encode(user.id),
    userName: user.name,
    userDisplayName: user.name,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    excludeCredentials: passkeys.map(p => ({
      id: p.id,
      transports: JSON.parse(p.transports || '[]'),
    })),
  });
}

// requireProof: proveOwner equivalent.
// Returns ['passkey'|'password', null] on success, [null, Response] on failure.
async function requireProof(c, user, body, act) {
  if (body.credential) {
    // Passkey step-up: same ceremony as login/verify, credential must belong to user.
    const env = c.env;
    const RP_ID = env.RP_ID || 'localhost';
    const ORIGIN = env.ORIGIN || 'http://localhost:8080';

    const ch = await takeChallenge(env.SESSIONS, text(body.cid));
    if (ch?.kind !== 'login') {
      doAudit(c, 'auth.proof.fail', { ok: false, uid: user.id, name: user.name, msg: 'challenge-expired', act });
      return [null, c.json({ error: 'the passkey could not be verified', code: 'passkey' }, 403)];
    }

    const cred = await getPasskeyById(env.DB, body.credential?.id);
    if (!cred || cred.user_id !== user.id) {
      doAudit(c, 'auth.proof.fail', { ok: false, uid: user.id, name: user.name, msg: 'step-up-failed', act });
      return [null, c.json({ error: 'the passkey could not be verified', code: 'passkey' }, 403)];
    }

    let v;
    try {
      v = await verifyAuthenticationResponse({
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
      doAudit(c, 'auth.proof.fail', { ok: false, uid: user.id, name: user.name, msg: 'verify-error', act });
      return [null, c.json({ error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) }, 403)];
    }

    if (!v.verified) {
      doAudit(c, 'auth.proof.fail', { ok: false, uid: user.id, name: user.name, msg: 'not-verified', act });
      return [null, c.json({ error: 'the passkey could not be verified', code: 'passkey' }, 403)];
    }

    await updatePasskeyCounter(
      env.DB, cred.id,
      v.authenticationInfo.newCounter,
      new Date().toISOString(),
    );
    return ['passkey', null];
  }

  // Password proof
  const env = c.env;
  const PASSWORD_LOGIN = /^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '');
  if (!PASSWORD_LOGIN || !user.pw_hash) {
    return [null, c.json({ error: 'confirm with your passkey first', code: 'passkey-required' }, 403)];
  }

  const current = typeof body.current === 'string' ? body.current : '';
  if (!current) {
    return [null, c.json({ error: 'enter your current password', code: 'current-required' }, 403)];
  }

  const addr = limitAddress(c.req);
  const acctKey = 'acct:' + user.id;
  const addrKey = 'password|' + addr;
  const acctOpts = { free: 5, baseMs: 60000, maxMs: 3600000, forgetMs: 24 * 3600000 };
  const addrOpts = { free: 20, baseMs: 30000, maxMs: 15 * 60000, forgetMs: 3600000 };

  const [acctState, addrState] = await Promise.all([
    checkBackoff(env.RATE_LIMITS, acctKey, acctOpts),
    checkBackoff(env.RATE_LIMITS, addrKey, addrOpts),
  ]);
  if (acctState.locked) return [null, c.json({ error: 'too many attempts', code: 'locked', retryAfter: acctState.retryAfter }, 429)];
  if (addrState.locked) return [null, c.json({ error: 'too many attempts', code: 'locked', retryAfter: addrState.retryAfter }, 429)];

  const result = await verifyPassword(current, user.pw_hash);
  if (!result.ok) {
    await Promise.all([
      failBackoff(env.RATE_LIMITS, acctKey, acctOpts),
      failBackoff(env.RATE_LIMITS, addrKey, addrOpts),
    ]);
    doAudit(c, 'auth.proof.fail', { ok: false, uid: user.id, name: user.name, msg: 'bad-current', act });
    return [null, c.json({ error: 'your current password is not right', code: 'current-wrong' }, 403)];
  }

  await clearBackoff(env.RATE_LIMITS, acctKey);
  return ['password', null];
}

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono();

// GET /api/account/passkeys
app.get('/api/account/passkeys', async (c) => {
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  return c.json(await passkeyState(c.env, session.user));
});

// POST /api/account/passkeys/options
// Proof first, then generate registration options for an additional passkey.
app.post('/api/account/passkeys/options', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const body = await c.req.json().catch(() => ({}));

  const passkeys = await getPasskeysByUser(env.DB, user.id);
  if (passkeys.length >= MAX_PASSKEYS) return c.json(LIMIT, 409);

  const [proof, failResp] = await requireProof(c, user, body, 'passkey-add');
  if (!failResp && !proof) return c.json({ error: 'not signed in' }, 401);
  if (failResp) return failResp;

  // Verify session is still valid after the await
  const fresh = await getSession(c);
  if (!fresh || fresh.user.id !== user.id) return c.json({ error: 'not signed in' }, 401);

  const options = await moreOptions(env, user);
  const cid = await putChallenge(env.SESSIONS, {
    kind: 'add',
    challenge: options.challenge,
    uid: user.id,
    sv: user.sv || 0,
    proof,
  });
  return c.json({ cid, options });
});

// POST /api/account/passkeys/verify
app.post('/api/account/passkeys/verify', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const body = await c.req.json().catch(() => ({}));
  const RP_ID = env.RP_ID || 'localhost';
  const ORIGIN = env.ORIGIN || 'http://localhost:8080';

  const ch = await takeChallenge(env.SESSIONS, text(body.cid));
  if (!ch || ch.kind !== 'add' || ch.uid !== user.id) {
    doAudit(c, 'auth.passkey.fail', { ok: false, uid: user.id, name: user.name, msg: 'challenge-expired' });
    return c.json({ error: 'challenge expired, try again', code: 'challenge-expired' }, 400);
  }

  // Re-check session version
  const fresh = await getSession(c);
  if (!fresh || fresh.user.id !== user.id || (fresh.user.sv || 0) !== ch.sv) {
    return c.json({ error: 'not signed in' }, 401);
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
    doAudit(c, 'auth.passkey.fail', { ok: false, uid: user.id, name: user.name, msg: 'verify-error' });
    return c.json({ error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) }, 400);
  }

  if (!verification.verified) {
    doAudit(c, 'auth.passkey.fail', { ok: false, uid: user.id, name: user.name, msg: 'not-verified' });
    return c.json({ error: 'not verified' }, 400);
  }

  const { credential } = verification.registrationInfo;

  // Check for duplicate + limit
  const existing = await getPasskeyById(env.DB, credential.id);
  if (existing) {
    doAudit(c, 'auth.passkey.fail', { ok: false, uid: user.id, name: user.name, msg: 'credential-exists' });
    return c.json({ error: 'credential already registered', code: 'credential-exists' }, 409);
  }
  const all = await getPasskeysByUser(env.DB, user.id);
  if (all.length >= MAX_PASSKEYS) return c.json(LIMIT, 409);

  const now = new Date().toISOString();
  await createPasskey(env.DB, {
    id: credential.id,
    user_id: user.id,
    public_key: uint8ArrayToBase64url(credential.publicKey),
    counter: credential.counter || 0,
    transports: JSON.stringify(body.credential?.response?.transports || []),
    name: passkeyName(body.name),
    created: now,
    last_used: now,
  });

  doAudit(c, 'auth.passkey.add', { ok: true, uid: user.id, name: user.name, msg: ch.proof });

  const updatedUser = await getUserById(env.DB, user.id);
  return c.json({ ok: true, ...(await passkeyState(env, updatedUser || user)) });
});

// POST /api/account/passkeys/rename
app.post('/api/account/passkeys/rename', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const body = await c.req.json().catch(() => ({}));
  const credId = text(body.id);
  const newName = passkeyName(body.name);

  const cred = await getPasskeyById(env.DB, credId);
  if (!cred || cred.user_id !== user.id) return c.json({ error: 'passkey not found', code: 'not-found' }, 404);

  await renamePasskey(env.DB, credId, user.id, newName || null);
  return c.json({ ok: true, ...(await passkeyState(env, user)) });
});

// DELETE /api/account/passkeys?id=
app.delete('/api/account/passkeys', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const credId = c.req.query('id') || '';
  const body = await c.req.json().catch(() => ({}));

  const PASSWORD_LOGIN = /^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '');
  const otherWays = PASSWORD_LOGIN && !!user.pw_hash ? 1 : 0;
  const refused = await passkeyRemovalRefused(env, user, credId, otherWays);
  if (refused) {
    return c.json(refused, refused.code === 'last-way-in' ? 409 : 404);
  }

  const [proof, failResp] = await requireProof(c, user, body, 'passkey-remove');
  if (failResp) return failResp;

  const fresh = await getSession(c);
  if (!fresh || fresh.user.id !== user.id) return c.json({ error: 'not signed in' }, 401);

  const refused2 = await passkeyRemovalRefused(env, user, credId, otherWays);
  if (refused2) return c.json(refused2, refused2.code === 'last-way-in' ? 409 : 404);

  const cred = await getPasskeyById(env.DB, credId);
  if (!cred) return c.json({ error: 'passkey not found', code: 'not-found' }, 404);

  await deletePasskey(env.DB, credId, user.id);
  await deleteDeviceLinksByUser(env.DB, user.id);

  doAudit(c, 'auth.passkey.remove', { ok: true, uid: user.id, name: user.name, msg: cred.name || null });

  const updatedUser = await getUserById(env.DB, user.id);
  return c.json({ ok: true, ...(await passkeyState(env, updatedUser || user)) });
});

// POST /api/account/device-link
// Signed-in user generates a one-time device-link code.
app.post('/api/account/device-link', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const body = await c.req.json().catch(() => ({}));

  const passkeys = await getPasskeysByUser(env.DB, user.id);
  if (passkeys.length >= MAX_PASSKEYS) return c.json(LIMIT, 409);

  const [proof, failResp] = await requireProof(c, user, body, 'device-link');
  if (failResp) return failResp;

  const fresh = await getSession(c);
  if (!fresh || fresh.user.id !== user.id) return c.json({ error: 'not signed in' }, 401);

  const code = makeLinkCode();
  const h = await hashLinkCode(code);
  const now = Date.now();
  const exp = now + 10 * 60 * 1000; // 10 minutes

  await createDeviceLink(env.DB, { h, user_id: user.id, exp, created: now });

  doAudit(c, 'auth.link.create', { ok: true, uid: user.id, name: user.name, msg: proof });
  return c.json({ code, expires: exp });
});

// POST /api/device-link/options
// Other device checks the code and gets registration options.
app.post('/api/device-link/options', async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));
  const addr = limitAddress(c.req);
  const addrKey = 'link|' + addr;
  const addrOpts = { free: 20, baseMs: 30000, maxMs: 15 * 60000, forgetMs: 3600000 };

  const addrState = await checkBackoff(env.RATE_LIMITS, addrKey, addrOpts);
  if (addrState.locked) {
    return c.json({ error: 'too many attempts, try again later', code: 'locked', retryAfter: addrState.retryAfter }, 429, { 'Retry-After': String(addrState.retryAfter) });
  }

  const rawCode = text(body.code);
  const h = await hashLinkCode(rawCode);
  const link = await getDeviceLink(env.DB, h);

  if (!link || link.exp < Date.now()) {
    await failBackoff(env.RATE_LIMITS, addrKey, addrOpts);
    doAudit(c, 'auth.link.fail', { ok: false, msg: 'link-invalid' });
    return c.json(LINK_INVALID, 400);
  }

  const user = await getUserById(env.DB, link.user_id);
  if (!user || user.disabled) {
    doAudit(c, 'auth.link.fail', { ok: false, uid: link.user_id, msg: 'user-unavailable' });
    return c.json(LINK_INVALID, 400);
  }

  const passkeys = await getPasskeysByUser(env.DB, user.id);
  if (passkeys.length >= MAX_PASSKEYS) return c.json(LIMIT, 409);

  const options = await moreOptions(env, user);
  const cid = await putChallenge(env.SESSIONS, {
    kind: 'link', challenge: options.challenge, uid: user.id, lh: link.h,
  });

  return c.json({ cid, options, id: user.id, name: user.name });
});

// POST /api/device-link/verify (CSRF-exempt)
// Completes the link: register passkey, burn code, issue session.
app.post('/api/device-link/verify', async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));
  const addr = limitAddress(c.req);
  const addrKey = 'link|' + addr;
  const addrOpts = { free: 20, baseMs: 30000, maxMs: 15 * 60000, forgetMs: 3600000 };

  const addrState = await checkBackoff(env.RATE_LIMITS, addrKey, addrOpts);
  if (addrState.locked) {
    return c.json({ error: 'too many attempts', code: 'locked', retryAfter: addrState.retryAfter }, 429, { 'Retry-After': String(addrState.retryAfter) });
  }

  const rawCode = text(body.code);
  const h = await hashLinkCode(rawCode);
  const RP_ID = env.RP_ID || 'localhost';
  const ORIGIN = env.ORIGIN || 'http://localhost:8080';

  const ch = await takeChallenge(env.SESSIONS, text(body.cid));
  const link = await getDeviceLink(env.DB, h);

  if (!link || link.exp < Date.now()) {
    await failBackoff(env.RATE_LIMITS, addrKey, addrOpts);
    doAudit(c, 'auth.link.fail', { ok: false, msg: 'link-invalid' });
    return c.json(LINK_INVALID, 400);
  }

  if (!ch || ch.kind !== 'link' || ch.lh !== link.h || ch.uid !== link.user_id) {
    doAudit(c, 'auth.link.fail', { ok: false, uid: link.user_id, msg: 'challenge-expired' });
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
    doAudit(c, 'auth.link.fail', { ok: false, uid: link.user_id, msg: 'verify-error' });
    return c.json({ error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) }, 400);
  }

  if (!verification.verified) {
    doAudit(c, 'auth.link.fail', { ok: false, uid: link.user_id, msg: 'not-verified' });
    return c.json({ error: 'not verified' }, 400);
  }

  const { credential } = verification.registrationInfo;

  // Re-verify the link is still valid and user is available after awaits
  const freshLink = await getDeviceLink(env.DB, h);
  const user = await getUserById(env.DB, link.user_id);
  if (!freshLink || freshLink.exp < Date.now() || !user || user.disabled) {
    await failBackoff(env.RATE_LIMITS, addrKey, addrOpts);
    doAudit(c, 'auth.link.fail', { ok: false, uid: link.user_id, msg: 'link-invalid' });
    return c.json(LINK_INVALID, 400);
  }

  const existing = await getPasskeyById(env.DB, credential.id);
  if (existing) {
    doAudit(c, 'auth.link.fail', { ok: false, uid: user.id, name: user.name, msg: 'credential-exists' });
    return c.json({ error: 'credential already registered', code: 'credential-exists' }, 409);
  }

  const allPasskeys = await getPasskeysByUser(env.DB, user.id);
  if (allPasskeys.length >= MAX_PASSKEYS) return c.json(LIMIT, 409);

  const now = new Date().toISOString();
  const credName = passkeyName(body.name);
  await createPasskey(env.DB, {
    id: credential.id,
    user_id: user.id,
    public_key: uint8ArrayToBase64url(credential.publicKey),
    counter: credential.counter || 0,
    transports: JSON.stringify(body.credential?.response?.transports || []),
    name: credName || null,
    created: now,
    last_used: now,
  });

  await deleteDeviceLink(env.DB, h);

  const days = sessionDays(env);
  const secure = isSecure(env);
  const sv = user.sv || 0;
  const token = await makeSession(user.id, sv, days, env.SECRET);
  await storeSession(env.SESSIONS, token, user.id, sv, days);

  doAudit(c, 'auth.link.ok', { ok: true, uid: user.id, name: user.name, msg: credName || null });

  const [cookie] = sessionCookieHeader(token, days, secure);
  return c.json({ user: publicUser(user, env) }, 200, { 'Set-Cookie': cookie });
});

// PATCH /api/account/name
app.patch('/api/account/name', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const body = await c.req.json().catch(() => ({}));
  const name = text(body.name).trim().slice(0, 40);
  if (!name) return c.json({ error: 'name required', code: 'missing' }, 400);
  if (name === user.name) return c.json({ ok: true, name });

  // Name must not be taken by another password-holding user
  const { getUserByName: gbn } = await import('../db/queries.js');
  const other = await gbn(env.DB, nameKey(name));
  if (other && other.id !== user.id && other.pw_hash) {
    return c.json({ error: 'another profile already signs in with this name', code: 'name-taken' }, 409);
  }

  await updateUser(env.DB, user.id, { name });
  doAudit(c, 'auth.name.change', { ok: true, uid: user.id, name: user.name });
  return c.json({ ok: true, name });
});

// GET /api/account/password
app.get('/api/account/password', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const passkeys = await getPasskeysByUser(env.DB, user.id);

  // Name taken = another password-holding user has this name
  const { getUserByName: gbn } = await import('../db/queries.js');
  const other = await gbn(env.DB, nameKey(user.name));
  const nameTaken = !!(other && other.id !== user.id && other.pw_hash);

  return c.json({
    set: !!user.pw_hash,
    setAt: user.pw_set || null,
    passkeys: passkeys.length,
    name: user.name,
    nameTaken,
    email: user.email || null,
  });
});

// POST /api/account/password
// Set or change password; requires proof of ownership.
app.post('/api/account/password', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const body = await c.req.json().catch(() => ({}));

  const problem = passwordProblem(body.next, user.name);
  if (problem) return c.json({ error: POLICY_MSGS[problem] || problem, code: problem }, 400);

  const { getUserByName: gbn } = await import('../db/queries.js');
  const other = await gbn(env.DB, nameKey(user.name));
  if (other && other.id !== user.id && other.pw_hash) {
    return c.json({ error: 'another profile already signs in with this name', code: 'name-taken' }, 409);
  }

  const [proof, failResp] = await requireProof(c, user, body, 'password');
  if (failResp) return failResp;

  const h = await hashPassword(body.next);

  // Verify session still valid after awaits
  const fresh = await getSession(c);
  if (!fresh || fresh.user.id !== user.id) return c.json({ error: 'not signed in' }, 401);

  const now = new Date().toISOString();
  const newSv = (user.sv || 0) + 1;
  await updateUser(env.DB, user.id, {
    pw_hash: h, pw_set: now,
    pw_reset_hash: null, pw_reset_exp: null,
    sv: newSv,
  });
  await deleteDeviceLinksByUser(env.DB, user.id);
  await clearBackoff(env.RATE_LIMITS, 'acct:' + user.id);

  const days = sessionDays(env);
  const secure = isSecure(env);
  const token = await makeSession(user.id, newSv, days, env.SECRET);
  await storeSession(env.SESSIONS, token, user.id, newSv, days);

  doAudit(c, user.pw_hash ? 'auth.password.change' : 'auth.password.set', { ok: true, uid: user.id, name: user.name, msg: proof });

  if (session.bearer) {
    return c.json({ ok: true, token });
  }
  const [cookie] = sessionCookieHeader(token, days, secure);
  return c.json({ ok: true }, 200, { 'Set-Cookie': cookie });
});

// DELETE /api/account/password
app.delete('/api/account/password', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  if (!user.pw_hash) return c.json({ ok: true });

  const body = await c.req.json().catch(() => ({}));
  const passkeys = await getPasskeysByUser(env.DB, user.id);
  if (!passkeys.length) {
    return c.json({ error: 'the password is the only way into this profile', code: 'last-way-in' }, 409);
  }

  const [, failResp] = await requireProof(c, user, body, 'password-remove');
  if (failResp) return failResp;

  const fresh = await getSession(c);
  if (!fresh || fresh.user.id !== user.id) return c.json({ error: 'not signed in' }, 401);

  // Re-check after awaits
  const freshUser = await getUserById(env.DB, user.id);
  if (!freshUser?.pw_hash) return c.json({ ok: true });
  const freshPasskeys = await getPasskeysByUser(env.DB, user.id);
  if (!freshPasskeys.length) {
    return c.json({ error: 'the password is the only way into this profile', code: 'last-way-in' }, 409);
  }

  await updateUser(env.DB, user.id, { pw_hash: null, pw_set: null });
  doAudit(c, 'auth.password.remove', { ok: true, uid: user.id, name: user.name });
  return c.json({ ok: true });
});

// POST /api/account/email
app.post('/api/account/email', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const body = await c.req.json().catch(() => ({}));

  // Empty/null email = remove
  if (body.email == null || (typeof body.email === 'string' && body.email.trim() === '')) {
    if (!user.email) return c.json({ ok: true, email: null });
    const [, failResp] = await requireProof(c, user, body, 'email-remove');
    if (failResp) return failResp;
    const fresh = await getSession(c);
    if (!fresh || fresh.user.id !== user.id) return c.json({ error: 'not signed in' }, 401);
    await updateUser(env.DB, user.id, { email: null });
    doAudit(c, 'auth.email.remove', { ok: true, uid: user.id, name: user.name });
    return c.json({ ok: true, email: null });
  }

  const email = normalizeEmail(body.email);
  if (!email) return c.json({ error: 'that is not an e-mail address', code: 'email-invalid' }, 400);
  if (email === user.email) return c.json({ ok: true, email });

  const addr = limitAddress(c.req);
  const addrKey = 'email|' + addr;
  const addrOpts = { free: 20, baseMs: 30000, maxMs: 15 * 60000, forgetMs: 3600000 };

  const addrState = await checkBackoff(env.RATE_LIMITS, addrKey, addrOpts);
  if (addrState.locked) return c.json({ error: 'too many attempts', code: 'locked' }, 429);

  const [proof, failResp] = await requireProof(c, user, body, 'email');
  if (failResp) return failResp;

  const fresh = await getSession(c);
  if (!fresh || fresh.user.id !== user.id) return c.json({ error: 'not signed in' }, 401);

  const { getUserByEmail: gbe } = await import('../db/queries.js');
  const emailUser = await gbe(env.DB, email);
  if (emailUser && emailUser.id !== user.id) {
    await failBackoff(env.RATE_LIMITS, addrKey, addrOpts);
    doAudit(c, 'auth.email.fail', { ok: false, uid: user.id, name: user.name, msg: 'email-taken' });
    return c.json({ error: 'another profile already uses this e-mail address', code: 'email-taken' }, 409);
  }

  const first = !user.email;
  await updateUser(env.DB, user.id, { email });
  doAudit(c, first ? 'auth.email.set' : 'auth.email.change', { ok: true, uid: user.id, name: user.name, msg: proof + ' · ' + maskEmail(email) });
  return c.json({ ok: true, email });
});

// DELETE /api/account/email
app.delete('/api/account/email', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  if (!user.email) return c.json({ ok: true, email: null });

  const body = await c.req.json().catch(() => ({}));
  const [, failResp] = await requireProof(c, user, body, 'email-remove');
  if (failResp) return failResp;

  const fresh = await getSession(c);
  if (!fresh || fresh.user.id !== user.id) return c.json({ error: 'not signed in' }, 401);

  await updateUser(env.DB, user.id, { email: null });
  doAudit(c, 'auth.email.remove', { ok: true, uid: user.id, name: user.name });
  return c.json({ ok: true, email: null });
});

// POST /api/admin/user/password-reset (admin only)
// Issues a one-time reset code; clears the password and bumps sv.
app.post('/api/admin/user/password-reset', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user: admin } = session;
  if (!isAdmin(admin, env)) {
    doAudit(c, 'admin.denied', { ok: false, uid: admin.id, name: admin.name });
    return c.json({ error: 'forbidden' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const target = await getUserById(env.DB, text(body.id));
  if (!target) return c.json({ error: 'no such user' }, 404);
  if (isAdmin(target, env)) return c.json({ error: 'an admin sets their own password in Settings' }, 400);

  // Check name uniqueness for the reset (the name must remain unique post-reset)
  const { getUserByName: gbn } = await import('../db/queries.js');
  const other = await gbn(env.DB, nameKey(target.name));
  if (other && other.id !== target.id && other.pw_hash) {
    return c.json({ error: 'another profile already signs in with this name', code: 'name-taken' }, 409);
  }

  const code = makeResetCode();
  const resetHash = await hashResetCode(code);
  const exp = Date.now() + RESET_TTL_MS;
  const newSv = (target.sv || 0) + 1;

  await updateUser(env.DB, target.id, {
    pw_hash: null, pw_set: null,
    pw_reset_hash: resetHash, pw_reset_exp: exp, pw_reset_by: admin.id,
    sv: newSv,
  });
  await deleteDeviceLinksByUser(env.DB, target.id);

  doAudit(c, 'admin.password.reset', { ok: true, uid: admin.id, name: admin.name, tgt: target.id, tname: target.name });
  return c.json({ ok: true, name: target.name, code, expires: exp });
});

export default app;
