// Account linking & merging: link multiple auth methods to one account, merge accounts.
import { Hono } from 'hono';
import {
  hashPassword, verifyPassword, passwordProblem, normalizeEmail,
  MIN_LENGTH, MAX_LENGTH,
} from '../lib/password.js';
import { checkBackoff, failBackoff, clearBackoff } from '../lib/rate-limit.js';
import { audit } from '../lib/audit.js';
import {
  getUserById, getUserByEmail, updateUser, deleteUser,
  getPasskeysByUser,
  getAuthProvidersByUser, getAuthProviderByProviderAndId,
  createAuthProvider, updateAuthProviderLastUsed, deleteAuthProvider,
  countAuthProvidersByUser, transferUserData,
} from '../db/queries.js';
import { getSession } from './auth.js';

const text = v => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

const POLICY_MSGS = {
  'too-short': `the password needs at least ${MIN_LENGTH} characters`,
  'too-long': `the password can have at most ${MAX_LENGTH} characters`,
  'too-common': 'this password is too easy to guess',
};

// ── Shared helpers ────────────────────────────────────────────────────────────

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

async function getSessionOrFail(c) {
  const session = await getSession(c);
  if (!session) return null;
  return session;
}

// requireProof: verifies ownership via passkey assertion or password.
// Simplified version that only handles password proof for linking.
// Returns [true, null] on success, [false, Response] on failure.
async function requireProof(c, user, body, act) {
  const env = c.env;
  const PASSWORD_LOGIN = /^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '');

  // Password proof
  if (!PASSWORD_LOGIN || !user.pw_hash) {
    return [false, c.json({ error: 'confirm with your passkey first', code: 'passkey-required' }, 403)];
  }

  const current = typeof body.current === 'string' ? body.current : '';
  if (!current) {
    return [false, c.json({ error: 'enter your current password', code: 'current-required' }, 403)];
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
  if (acctState.locked) return [false, c.json({ error: 'too many attempts', code: 'locked', retryAfter: acctState.retryAfter }, 429)];
  if (addrState.locked) return [false, c.json({ error: 'too many attempts', code: 'locked', retryAfter: addrState.retryAfter }, 429)];

  const result = await verifyPassword(current, user.pw_hash);
  if (!result.ok) {
    await Promise.all([
      failBackoff(env.RATE_LIMITS, acctKey, acctOpts),
      failBackoff(env.RATE_LIMITS, addrKey, addrOpts),
    ]);
    doAudit(c, 'auth.proof.fail', { ok: false, uid: user.id, name: user.name, msg: 'bad-current', act });
    return [false, c.json({ error: 'your current password is not right', code: 'current-wrong' }, 403)];
  }

  await clearBackoff(env.RATE_LIMITS, acctKey);
  return [true, null];
}

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono();

// GET /api/account/providers - List linked auth providers for current user
app.get('/api/account/providers', async (c) => {
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const providers = await getAuthProvidersByUser(c.env.DB, session.user.id);

  return c.json({
    providers: providers.map(p => ({
      id: p.id,
      provider: p.provider,
      email: p.email || null,
      created: p.created,
      lastUsed: p.last_used || null,
    })),
  });
});

// POST /api/account/link/password - Link password auth to existing account
app.post('/api/account/link/password', async (c) => {
  const env = c.env;
  const PASSWORD_LOGIN = /^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '');
  if (!PASSWORD_LOGIN) return c.json({ error: 'password login not enabled', code: 'not-enabled' }, 400);

  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const body = await c.req.json().catch(() => ({}));

  // Check if user already has a password
  if (user.pw_hash) {
    return c.json({ error: 'this account already has a password linked', code: 'already-linked' }, 409);
  }

  // Must have at least one passkey to link a password (proof of ownership)
  const passkeys = await getPasskeysByUser(env.DB, user.id);
  if (passkeys.length === 0) {
    return c.json({ error: 'add a passkey first before linking a password', code: 'passkey-required' }, 403);
  }

  // Validate the password
  const password = text(body.password);
  const problem = passwordProblem(password, user.name);
  if (problem) return c.json({ error: POLICY_MSGS[problem] || problem, code: problem }, 400);

  // Optional email for this password link
  const hasEmail = typeof body.email === 'string' && body.email.trim() !== '';
  const email = hasEmail ? normalizeEmail(body.email) : null;
  if (hasEmail && !email) return c.json({ error: 'that is not an e-mail address', code: 'email-invalid' }, 400);

  // Check if email is already taken
  if (email) {
    const emailUser = await getUserByEmail(env.DB, email);
    if (emailUser && emailUser.id !== user.id) {
      return c.json({ error: 'another profile already uses this e-mail address', code: 'email-taken' }, 409);
    }
  }

  // Hash the password and update user
  const h = await hashPassword(password);
  const now = new Date().toISOString();

  await updateUser(env.DB, user.id, {
    pw_hash: h,
    pw_set: now,
    email: email || user.email,
  });

  // Create auth_provider entry for password
  await createAuthProvider(env.DB, {
    user_id: user.id,
    provider: 'password',
    provider_id: email || user.email || null,
    email: email || user.email || null,
    created: now,
    last_used: now,
  });

  doAudit(c, 'auth.link.password', { ok: true, uid: user.id, name: user.name });

  return c.json({ ok: true });
});

// POST /api/account/link/google - Placeholder for Google OAuth linking
app.post('/api/account/link/google', async (c) => {
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  return c.json({ error: 'Google OAuth not yet implemented', code: 'not-implemented' }, 501);
});

// POST /api/account/merge - Merge another account into current account
app.post('/api/account/merge', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user: targetUser } = session;
  const body = await c.req.json().catch(() => ({}));

  // sourceProof: proves ownership of the account to be merged IN
  // The user must be logged into the target account
  const sourceProof = body.sourceProof;
  if (!sourceProof) {
    return c.json({ error: 'source account proof required', code: 'proof-required' }, 400);
  }

  // For now, sourceProof must contain password credentials for the source account
  // { identifier, password } - identifier is name or email of source account
  const identifier = text(sourceProof.identifier || sourceProof.name || sourceProof.email);
  const password = text(sourceProof.password);

  if (!identifier || !password) {
    return c.json({ error: 'source account name/email and password required', code: 'missing' }, 400);
  }

  // Rate limiting
  const addr = limitAddress(c.req);
  const addrKey = 'merge|' + addr;
  const addrOpts = { free: 10, baseMs: 60000, maxMs: 3600000, forgetMs: 24 * 3600000 };

  const addrState = await checkBackoff(env.RATE_LIMITS, addrKey, addrOpts);
  if (addrState.locked) {
    return c.json({ error: 'too many attempts, try again later', code: 'locked', retryAfter: addrState.retryAfter }, 429);
  }

  // Find the source user
  const { getUserByName } = await import('../db/queries.js');
  const { nameKey } = await import('../lib/password.js');
  const k = nameKey(identifier);

  let sourceUser = k.includes('@') ? await getUserByEmail(env.DB, k) : null;
  if (!sourceUser) sourceUser = await getUserByName(env.DB, k);

  if (!sourceUser || !sourceUser.pw_hash) {
    await failBackoff(env.RATE_LIMITS, addrKey, addrOpts);
    doAudit(c, 'auth.merge.fail', { ok: false, uid: targetUser.id, name: targetUser.name, msg: 'source-not-found' });
    return c.json({ error: 'source account not found or has no password', code: 'source-not-found' }, 404);
  }

  // Cannot merge account into itself
  if (sourceUser.id === targetUser.id) {
    return c.json({ error: 'cannot merge an account into itself', code: 'same-account' }, 400);
  }

  // Verify source account password
  const result = await verifyPassword(password, sourceUser.pw_hash);
  if (!result.ok) {
    await failBackoff(env.RATE_LIMITS, addrKey, addrOpts);
    doAudit(c, 'auth.merge.fail', { ok: false, uid: targetUser.id, name: targetUser.name, tgt: sourceUser.id, tname: sourceUser.name, msg: 'bad-password' });
    return c.json({ error: 'wrong password for source account', code: 'bad-credentials' }, 401);
  }

  // Perform the merge: transfer all data from source to target
  await transferUserData(env.DB, sourceUser.id, targetUser.id);

  // Delete the source user (CASCADE will clean up remaining references)
  await deleteUser(env.DB, sourceUser.id);

  doAudit(c, 'auth.merge.ok', {
    ok: true,
    uid: targetUser.id,
    name: targetUser.name,
    tgt: sourceUser.id,
    tname: sourceUser.name,
    msg: 'merged',
  });

  return c.json({
    ok: true,
    merged: { id: sourceUser.id, name: sourceUser.name },
  });
});

// DELETE /api/account/providers/:id - Unlink an auth provider
app.delete('/api/account/providers/:id', async (c) => {
  const env = c.env;
  const session = await getSessionOrFail(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;
  const providerId = parseInt(c.req.param('id'), 10);
  if (isNaN(providerId)) return c.json({ error: 'invalid provider id', code: 'invalid' }, 400);

  const body = await c.req.json().catch(() => ({}));

  // Get the provider to remove
  const providers = await getAuthProvidersByUser(env.DB, user.id);
  const provider = providers.find(p => p.id === providerId);

  if (!provider) {
    return c.json({ error: 'provider not found', code: 'not-found' }, 404);
  }

  // Check if this would leave the user with no way to sign in
  const passkeys = await getPasskeysByUser(env.DB, user.id);
  const PASSWORD_LOGIN = /^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '');
  const hasPassword = PASSWORD_LOGIN && !!user.pw_hash;
  const otherProviders = providers.filter(p => p.id !== providerId).length;

  // Total ways in: passkeys + password (if enabled) + other providers
  // We need at least one way to sign in after removal
  const waysIn = passkeys.length + (hasPassword && provider.provider !== 'password' ? 1 : 0) + otherProviders;

  if (waysIn < 1) {
    return c.json({ error: 'cannot remove the last way to sign in', code: 'last-way-in' }, 409);
  }

  // If removing password provider, also need to verify with proof
  if (provider.provider === 'password') {
    // Must have passkey to remove password
    if (passkeys.length === 0) {
      return c.json({ error: 'add a passkey before removing password', code: 'passkey-required' }, 403);
    }
  }

  // Delete the provider
  await deleteAuthProvider(env.DB, providerId);

  // If removing password provider, also clear pw_hash on user
  if (provider.provider === 'password') {
    await updateUser(env.DB, user.id, { pw_hash: null, pw_set: null });
  }

  doAudit(c, 'auth.unlink.' + provider.provider, { ok: true, uid: user.id, name: user.name });

  return c.json({ ok: true });
});

export default app;
