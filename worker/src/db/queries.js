// D1 query helpers. All functions accept a D1Database binding (env.DB) as their first argument.
// Use prepare().bind().run() / .first() / .all() — no ORM.

// ── users ─────────────────────────────────────────────────────────────────────

export async function getUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function getUserByName(db, name) {
  return db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').bind(name).first();
}

export async function getUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

export async function listUsers(db) {
  const { results } = await db.prepare('SELECT * FROM users ORDER BY created ASC').all();
  return results;
}

export async function countUsers(db) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
  return row ? row.n : 0;
}

export async function createUser(db, user) {
  return db.prepare(
    `INSERT INTO users (id, name, created, disabled, admin, invited_by, sv, email, pw_hash, pw_set)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id,
    user.name,
    user.created,
    user.disabled ?? 0,
    user.admin ?? 0,
    user.invited_by ?? null,
    user.sv ?? 0,
    user.email ?? null,
    user.pw_hash ?? null,
    user.pw_set ?? null
  ).run();
}

export async function updateUser(db, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const vals = keys.map(k => fields[k]);
  return db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).bind(...vals, id).run();
}

export async function deleteUser(db, id) {
  return db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
}

// ── passkeys ──────────────────────────────────────────────────────────────────

export async function getPasskeyById(db, id) {
  return db.prepare('SELECT * FROM passkeys WHERE id = ?').bind(id).first();
}

export async function getPasskeysByUser(db, userId) {
  const { results } = await db.prepare('SELECT * FROM passkeys WHERE user_id = ?').bind(userId).all();
  return results;
}

export async function createPasskey(db, row) {
  return db.prepare(
    `INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created, last_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.id,
    row.user_id,
    row.public_key,
    row.counter ?? 0,
    row.transports ?? '[]',
    row.name ?? null,
    row.created,
    row.last_used ?? null
  ).run();
}

export async function updatePasskeyCounter(db, id, counter, lastUsed) {
  return db.prepare('UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?')
    .bind(counter, lastUsed, id).run();
}

export async function renamePasskey(db, id, userId, name) {
  return db.prepare('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?')
    .bind(name || null, id, userId).run();
}

export async function deletePasskey(db, id, userId) {
  return db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').bind(id, userId).run();
}

// ── push subscriptions ────────────────────────────────────────────────────────

export async function getSubs(db, userId) {
  const { results } = await db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').bind(userId).all();
  return results;
}

export async function createSub(db, row) {
  return db.prepare(
    `INSERT OR REPLACE INTO push_subscriptions (endpoint, user_id, p256dh, auth, device_id, created)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    row.endpoint,
    row.user_id,
    row.p256dh,
    row.auth,
    row.device_id ?? null,
    row.created
  ).run();
}

export async function deleteSub(db, endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
}

// ── invites ───────────────────────────────────────────────────────────────────

export async function getInvite(db, code) {
  return db.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first();
}

export async function createInvite(db, row) {
  return db.prepare(
    `INSERT INTO invites (code, note, created_by, created, used_by, used_at, revoked)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.code,
    row.note ?? '',
    row.created_by,
    row.created,
    row.used_by ?? null,
    row.used_at ?? null,
    row.revoked ?? 0
  ).run();
}

export async function updateInvite(db, code, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const vals = keys.map(k => fields[k]);
  return db.prepare(`UPDATE invites SET ${sets} WHERE code = ?`).bind(...vals, code).run();
}

// ── device links ──────────────────────────────────────────────────────────────

export async function getDeviceLink(db, h) {
  return db.prepare('SELECT * FROM device_links WHERE h = ?').bind(h).first();
}

export async function createDeviceLink(db, row) {
  return db.prepare(
    'INSERT OR REPLACE INTO device_links (h, user_id, exp, created) VALUES (?, ?, ?, ?)'
  ).bind(row.h, row.user_id, row.exp, row.created).run();
}

export async function deleteDeviceLink(db, h) {
  return db.prepare('DELETE FROM device_links WHERE h = ?').bind(h).run();
}

export async function deleteDeviceLinksByUser(db, userId) {
  return db.prepare('DELETE FROM device_links WHERE user_id = ?').bind(userId).run();
}

// ── user state ────────────────────────────────────────────────────────────────

export async function getUserState(db, userId) {
  return db.prepare('SELECT * FROM user_state WHERE user_id = ?').bind(userId).first();
}

export async function putUserState(db, userId, stateJson, rev) {
  return db.prepare(
    `INSERT INTO user_state (user_id, state, rev) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, rev = excluded.rev`
  ).bind(userId, stateJson, rev).run();
}

// ── audit events ──────────────────────────────────────────────────────────────

export async function insertAuditEvent(db, row) {
  return db.prepare(
    `INSERT INTO audit_events (ts, ev, ok, uid, name, tgt, tname, msg, act, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.ts,
    row.ev,
    row.ok ?? 1,
    row.uid ?? null,
    row.name ?? null,
    row.tgt ?? null,
    row.tname ?? null,
    row.msg ?? null,
    row.act ?? null,
    row.ip ?? null
  ).run();
}

export async function getAuditEvents(db, { limit = 100, before = null } = {}) {
  if (before != null) {
    const { results } = await db.prepare(
      'SELECT * FROM audit_events WHERE id < ? ORDER BY id DESC LIMIT ?'
    ).bind(before, limit).all();
    return results;
  }
  const { results } = await db.prepare(
    'SELECT * FROM audit_events ORDER BY id DESC LIMIT ?'
  ).bind(limit).all();
  return results;
}

// ── VAPID keys ────────────────────────────────────────────────────────────────

export async function getVapidKeys(db) {
  return db.prepare('SELECT * FROM vapid_keys WHERE id = 1').first();
}

export async function putVapidKeys(db, publicKey, privateKey) {
  return db.prepare(
    `INSERT INTO vapid_keys (id, public_key, private_key) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET public_key = excluded.public_key, private_key = excluded.private_key`
  ).bind(publicKey, privateKey).run();
}
