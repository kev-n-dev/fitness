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

// ── friendships ───────────────────────────────────────────────────────────────

export async function getFriendship(db, userId, friendId) {
  // Check both directions since friendship is bidirectional
  return db.prepare(
    `SELECT * FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`
  ).bind(userId, friendId, friendId, userId).first();
}

export async function createFriendship(db, userId, friendId, created) {
  // Store friendship in both directions for easy lookup
  const batch = [
    db.prepare('INSERT INTO friendships (user_id, friend_id, created, status) VALUES (?, ?, ?, ?)').bind(userId, friendId, created, 'accepted'),
    db.prepare('INSERT INTO friendships (user_id, friend_id, created, status) VALUES (?, ?, ?, ?)').bind(friendId, userId, created, 'accepted'),
  ];
  return db.batch(batch);
}

export async function deleteFriendship(db, userId, friendId) {
  // Delete both directions
  const batch = [
    db.prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?').bind(userId, friendId),
    db.prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?').bind(friendId, userId),
  ];
  return db.batch(batch);
}

export async function getFriendsByUser(db, userId) {
  const { results } = await db.prepare(
    `SELECT u.id, u.name, u.created, f.created AS friendship_created
     FROM friendships f
     JOIN users u ON f.friend_id = u.id
     WHERE f.user_id = ?
     ORDER BY f.created DESC`
  ).bind(userId).all();
  return results;
}

// ── friend_requests ───────────────────────────────────────────────────────────

export async function createFriendRequest(db, row) {
  return db.prepare(
    `INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created, updated)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    row.id,
    row.from_user_id,
    row.to_user_id,
    row.status ?? 'pending',
    row.created,
    row.updated
  ).run();
}

export async function getFriendRequestById(db, id) {
  return db.prepare('SELECT * FROM friend_requests WHERE id = ?').bind(id).first();
}

export async function getPendingFriendRequests(db, userId) {
  // Get both incoming and outgoing pending requests
  const { results } = await db.prepare(
    `SELECT fr.*, 
            sender.id AS sender_id, sender.name AS sender_name,
            receiver.id AS receiver_id, receiver.name AS receiver_name
     FROM friend_requests fr
     JOIN users sender ON fr.from_user_id = sender.id
     JOIN users receiver ON fr.to_user_id = receiver.id
     WHERE (fr.to_user_id = ? OR fr.from_user_id = ?) AND fr.status = 'pending'
     ORDER BY fr.created DESC`
  ).bind(userId, userId).all();
  return results;
}

export async function updateFriendRequest(db, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const vals = keys.map(k => fields[k]);
  return db.prepare(`UPDATE friend_requests SET ${sets} WHERE id = ?`).bind(...vals, id).run();
}

export async function getExistingFriendRequest(db, fromUserId, toUserId) {
  return db.prepare(
    `SELECT * FROM friend_requests 
     WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
     AND status = 'pending'`
  ).bind(fromUserId, toUserId, toUserId, fromUserId).first();
}

// ── friend_invite_codes ───────────────────────────────────────────────────────

export async function createFriendInviteCode(db, row) {
  return db.prepare(
    `INSERT INTO friend_invite_codes (code, user_id, created, expires, used_by, used_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    row.code,
    row.user_id,
    row.created,
    row.expires,
    row.used_by ?? null,
    row.used_at ?? null
  ).run();
}

export async function getFriendInviteCode(db, code) {
  return db.prepare('SELECT * FROM friend_invite_codes WHERE code = ?').bind(code).first();
}

export async function useFriendInviteCode(db, code, usedBy, usedAt) {
  return db.prepare(
    'UPDATE friend_invite_codes SET used_by = ?, used_at = ? WHERE code = ?'
  ).bind(usedBy, usedAt, code).run();
}

// ── user search ───────────────────────────────────────────────────────────────

export async function searchUsersByName(db, query, limit = 20) {
  const { results } = await db.prepare(
    `SELECT id, name, created FROM users 
     WHERE name LIKE ? COLLATE NOCASE AND disabled = 0
     LIMIT ?`
  ).bind('%' + query + '%', limit).all();
  return results;
}

// ── activity_feed_settings ────────────────────────────────────────────────────

export async function getActivityFeedSettings(db, userId) {
  return db.prepare('SELECT * FROM activity_feed_settings WHERE user_id = ?').bind(userId).first();
}

export async function updateActivityFeedSettings(db, userId, defaultVisibility) {
  const now = new Date().toISOString();
  return db.prepare(
    `INSERT INTO activity_feed_settings (user_id, default_visibility, created, updated)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET default_visibility = excluded.default_visibility, updated = excluded.updated`
  ).bind(userId, defaultVisibility, now, now).run();
}

// ── workout_visibility ────────────────────────────────────────────────────────

export async function getWorkoutVisibility(db, userId, workoutId) {
  return db.prepare(
    'SELECT * FROM workout_visibility WHERE user_id = ? AND workout_id = ?'
  ).bind(userId, workoutId).first();
}

export async function setWorkoutVisibility(db, userId, workoutId, visibility) {
  const now = new Date().toISOString();
  return db.prepare(
    `INSERT INTO workout_visibility (user_id, workout_id, visibility, created)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(workout_id, user_id) DO UPDATE SET visibility = excluded.visibility`
  ).bind(userId, workoutId, visibility, now).run();
}

// ── friend_activity ───────────────────────────────────────────────────────────

export async function createFriendActivity(db, row) {
  return db.prepare(
    `INSERT INTO friend_activity (user_id, workout_id, workout_name, completed_at, duration_ms, exercise_count, set_count, created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.user_id,
    row.workout_id,
    row.workout_name ?? null,
    row.completed_at,
    row.duration_ms ?? null,
    row.exercise_count ?? null,
    row.set_count ?? null,
    row.created
  ).run();
}

export async function getFriendActivity(db, userId, { limit = 50, before = null } = {}) {
  // Get activity from friends only, respecting visibility settings
  // Join with friendships, activity_feed_settings, and optionally workout_visibility
  const query = before
    ? `SELECT fa.*, u.name AS user_name,
              COALESCE(wv.visibility, afs.default_visibility, 'summary') AS visibility
       FROM friend_activity fa
       JOIN friendships f ON fa.user_id = f.friend_id AND f.user_id = ?
       JOIN users u ON fa.user_id = u.id
       LEFT JOIN activity_feed_settings afs ON fa.user_id = afs.user_id
       LEFT JOIN workout_visibility wv ON fa.workout_id = wv.workout_id AND fa.user_id = wv.user_id
       WHERE COALESCE(wv.visibility, afs.default_visibility, 'summary') != 'hidden'
         AND fa.id < ?
       ORDER BY fa.completed_at DESC
       LIMIT ?`
    : `SELECT fa.*, u.name AS user_name,
              COALESCE(wv.visibility, afs.default_visibility, 'summary') AS visibility
       FROM friend_activity fa
       JOIN friendships f ON fa.user_id = f.friend_id AND f.user_id = ?
       JOIN users u ON fa.user_id = u.id
       LEFT JOIN activity_feed_settings afs ON fa.user_id = afs.user_id
       LEFT JOIN workout_visibility wv ON fa.workout_id = wv.workout_id AND fa.user_id = wv.user_id
       WHERE COALESCE(wv.visibility, afs.default_visibility, 'summary') != 'hidden'
       ORDER BY fa.completed_at DESC
       LIMIT ?`;

  const { results } = before
    ? await db.prepare(query).bind(userId, before, limit).all()
    : await db.prepare(query).bind(userId, limit).all();
  return results;
}

export async function getFriendActivityById(db, activityId) {
  return db.prepare('SELECT * FROM friend_activity WHERE id = ?').bind(activityId).first();
}

export async function activityExistsForWorkout(db, userId, workoutId) {
  const row = await db.prepare(
    'SELECT 1 FROM friend_activity WHERE user_id = ? AND workout_id = ? LIMIT 1'
  ).bind(userId, workoutId).first();
  return !!row;
}
