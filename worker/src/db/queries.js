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
    `INSERT INTO users (id, name, created, disabled, admin, invited_by, sv, email, pw_hash, pw_set,
       google_id, google_access_token, google_refresh_token, google_token_expires, google_fit_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    user.pw_set ?? null,
    user.google_id ?? null,
    user.google_access_token ?? null,
    user.google_refresh_token ?? null,
    user.google_token_expires ?? null,
    user.google_fit_enabled ?? 0
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

// ── Google OAuth ──────────────────────────────────────────────────────────────

export async function getUserByGoogleId(db, googleId) {
  return db.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleId).first();
}

export async function updateGoogleTokens(db, userId, tokens) {
  return db.prepare(
    `UPDATE users SET
       google_access_token = ?,
       google_refresh_token = COALESCE(?, google_refresh_token),
       google_token_expires = ?
     WHERE id = ?`
  ).bind(
    tokens.access_token,
    tokens.refresh_token ?? null,
    tokens.expires_at,
    userId
  ).run();
}

export async function linkGoogleAccount(db, userId, googleData) {
  return db.prepare(
    `UPDATE users SET
       google_id = ?,
       google_access_token = ?,
       google_refresh_token = ?,
       google_token_expires = ?,
       google_fit_enabled = ?
     WHERE id = ?`
  ).bind(
    googleData.google_id,
    googleData.access_token,
    googleData.refresh_token ?? null,
    googleData.expires_at,
    googleData.fit_enabled ? 1 : 0,
    userId
  ).run();
}

export async function setGoogleFitEnabled(db, userId, enabled) {
  return db.prepare('UPDATE users SET google_fit_enabled = ? WHERE id = ?')
    .bind(enabled ? 1 : 0, userId).run();
}

export async function updateGoogleFitLastSync(db, userId, timestamp) {
  return db.prepare('UPDATE users SET google_fit_last_sync = ? WHERE id = ?')
    .bind(timestamp, userId).run();
}

export async function unlinkGoogleAccount(db, userId) {
  return db.prepare(
    `UPDATE users SET
       google_id = NULL,
       google_access_token = NULL,
       google_refresh_token = NULL,
       google_token_expires = NULL,
       google_fit_enabled = 0,
       google_fit_last_sync = NULL
     WHERE id = ?`
  ).bind(userId).run();
}

// ── auth_providers ────────────────────────────────────────────────────────────

export async function getAuthProvidersByUser(db, userId) {
  const { results } = await db.prepare(
    'SELECT * FROM auth_providers WHERE user_id = ? ORDER BY created ASC'
  ).bind(userId).all();
  return results;
}

export async function getAuthProviderByProviderAndId(db, provider, providerId) {
  return db.prepare(
    'SELECT * FROM auth_providers WHERE provider = ? AND provider_id = ?'
  ).bind(provider, providerId).first();
}

export async function createAuthProvider(db, row) {
  return db.prepare(
    `INSERT INTO auth_providers (user_id, provider, provider_id, email, created, last_used)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    row.user_id,
    row.provider,
    row.provider_id ?? null,
    row.email ?? null,
    row.created,
    row.last_used ?? null
  ).run();
}

export async function updateAuthProviderLastUsed(db, id, lastUsed) {
  return db.prepare(
    'UPDATE auth_providers SET last_used = ? WHERE id = ?'
  ).bind(lastUsed, id).run();
}

export async function deleteAuthProvider(db, id) {
  return db.prepare('DELETE FROM auth_providers WHERE id = ?').bind(id).run();
}

export async function countAuthProvidersByUser(db, userId) {
  const row = await db.prepare(
    'SELECT COUNT(*) AS n FROM auth_providers WHERE user_id = ?'
  ).bind(userId).first();
  return row ? row.n : 0;
}

// Transfer all data from one user to another (for account merge).
// Transfers: passkeys, user_state (merged), push_subscriptions, auth_providers, device_links.
export async function transferUserData(db, fromUserId, toUserId) {
  // Transfer passkeys
  await db.prepare(
    'UPDATE passkeys SET user_id = ? WHERE user_id = ?'
  ).bind(toUserId, fromUserId).run();

  // Transfer push subscriptions
  await db.prepare(
    'UPDATE push_subscriptions SET user_id = ? WHERE user_id = ?'
  ).bind(toUserId, fromUserId).run();

  // Transfer auth providers
  await db.prepare(
    'UPDATE auth_providers SET user_id = ? WHERE user_id = ?'
  ).bind(toUserId, fromUserId).run();

  // Transfer device links
  await db.prepare(
    'UPDATE device_links SET user_id = ? WHERE user_id = ?'
  ).bind(toUserId, fromUserId).run();

  // Merge user_state: combine workouts, routines, bodyweight, etc. from both accounts
  const fromState = await db.prepare('SELECT state, rev FROM user_state WHERE user_id = ?').bind(fromUserId).first();
  const toState = await db.prepare('SELECT state, rev FROM user_state WHERE user_id = ?').bind(toUserId).first();

  if (fromState?.state) {
    const fromData = JSON.parse(fromState.state);
    const toData = toState?.state ? JSON.parse(toState.state) : {};
    const merged = mergeUserStates(toData, fromData);
    const newRev = Math.max(toState?.rev || 0, fromState?.rev || 0) + 1;

    await db.prepare(
      `INSERT INTO user_state (user_id, state, rev) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, rev = excluded.rev`
    ).bind(toUserId, JSON.stringify(merged), newRev).run();
  }
}

// Merge two user state objects: target (primary) settings win, but all data is combined.
function mergeUserStates(target, source) {
  const merged = { ...target };
  const now = Date.now();

  // Helper: merge arrays by id, preferring newer items on conflict
  const mergeById = (a, b, idKey = 'id') => {
    const map = new Map();
    for (const item of [...(a || []), ...(b || [])]) {
      if (!item || item[idKey] == null) continue;
      const key = item[idKey];
      const existing = map.get(key);
      if (!existing) {
        map.set(key, item);
      } else {
        // Keep the one with higher _ts (timestamp), or the newer one
        const existingTs = existing._ts || existing.t || 0;
        const itemTs = item._ts || item.t || 0;
        if (itemTs > existingTs) map.set(key, item);
      }
    }
    return [...map.values()];
  };

  // Helper: merge arrays by date key
  const mergeByDate = (a, b, dateKey = 'd') => {
    const map = new Map();
    for (const item of [...(a || []), ...(b || [])]) {
      if (!item || !item[dateKey]) continue;
      const key = item[dateKey];
      const existing = map.get(key);
      if (!existing) {
        map.set(key, item);
      } else {
        // Keep the one with higher timestamp
        const existingTs = existing.t || existing._ts || 0;
        const itemTs = item.t || item._ts || 0;
        if (itemTs > existingTs) map.set(key, item);
      }
    }
    return [...map.values()].sort((a, b) => (a[dateKey] || '').localeCompare(b[dateKey] || ''));
  };

  // Merge workouts (the main workout history)
  if (source.workouts?.length) {
    merged.workouts = mergeById(target.workouts, source.workouts);
    // Sort by date descending (most recent first)
    merged.workouts.sort((a, b) => {
      const da = a.d || '', db = b.d || '';
      if (da !== db) return db.localeCompare(da);
      return (b.start || 0) - (a.start || 0);
    });
  }

  // Merge routines (saved workout templates)
  if (source.routines?.length) {
    merged.routines = mergeById(target.routines, source.routines);
  }

  // Merge custom exercises
  if (source.customEx?.length) {
    merged.customEx = mergeById(target.customEx, source.customEx);
  }

  // Merge equipment profiles
  if (source.equipProfiles?.length) {
    merged.equipProfiles = mergeById(target.equipProfiles, source.equipProfiles);
  }

  // Merge gym cards
  if (source.gymCards?.length) {
    merged.gymCards = mergeById(target.gymCards, source.gymCards);
  }

  // Merge bodyweight entries (by date)
  if (source.bodyweight?.length) {
    merged.bodyweight = mergeByDate(target.bodyweight, source.bodyweight);
  }

  // Merge body measurements (by date)
  if (source.measurements?.length) {
    merged.measurements = mergeByDate(target.measurements, source.measurements);
  }

  // Merge day notes (object keyed by date)
  if (source.dayNotes && typeof source.dayNotes === 'object') {
    merged.dayNotes = { ...(target.dayNotes || {}), ...(source.dayNotes || {}) };
    // For conflicts, keep the one with higher _ts
    for (const [date, note] of Object.entries(source.dayNotes)) {
      const existing = target.dayNotes?.[date];
      if (existing && (existing._ts || 0) >= (note._ts || 0)) {
        merged.dayNotes[date] = existing;
      }
    }
  }

  // Merge favourite exercises (union)
  if (source.favEx?.length) {
    merged.favEx = [...new Set([...(target.favEx || []), ...source.favEx])];
  }

  // Merge exercise weights (per-exercise last used weight)
  if (source.exWeights && typeof source.exWeights === 'object') {
    merged.exWeights = { ...(target.exWeights || {}) };
    for (const [ex, data] of Object.entries(source.exWeights)) {
      const existing = target.exWeights?.[ex];
      if (!existing || (data.d || '') > (existing.d || '')) {
        merged.exWeights[ex] = data;
      }
    }
  }

  // Merge exercise notes (per-exercise notes)
  if (source.exNotes && typeof source.exNotes === 'object') {
    merged.exNotes = { ...(source.exNotes || {}), ...(target.exNotes || {}) };
  }

  // Merge bar weights (per-exercise bar weight settings)
  if (source.barWeights && typeof source.barWeights === 'object') {
    merged.barWeights = { ...(source.barWeights || {}), ...(target.barWeights || {}) };
  }

  // Update timestamp
  merged._ts = now;

  return merged;
}
