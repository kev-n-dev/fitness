// Admin dashboard routes and the scheduled cron handler (reminderTick).
// All admin routes are guarded by requireAdmin which checks user.admin or ADMIN_UIDS env var.
import { Hono } from 'hono';
import { getSession } from './auth.js';
import { audit } from '../lib/audit.js';
import { createLogger } from '../lib/logger.js';
import { sendPushToUser } from './push.js';
import {
  listUsers, getUserById, updateUser, deleteUser,
  deleteDeviceLinksByUser,
  getUserState,
} from '../db/queries.js';
import {
  nudgeWindowOpen, nudgeFor, toneOf, excusedOn, effectiveRoutineId,
  dayReminderPush, nudgePush,
} from '../lib/nudge.js';

const log = createLogger('admin');

// ── Shared helpers ────────────────────────────────────────────────────────────

const record  = x => !!x && typeof x === 'object' && !Array.isArray(x);
const records = v => (Array.isArray(v) ? v.filter(record) : []);
const text    = v => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

function adminUids(env) {
  return (env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

function isAdmin(user, env) {
  return !!user && (user.admin === 1 || adminUids(env).includes(user.id));
}

function doAudit(c, ev, fields) {
  const ctx = c.executionCtx ?? { waitUntil: () => {} };
  audit(c.env, ctx, c.req.raw, ev, fields);
}

/**
 * Requires the caller to be an admin; returns [user, null] or [null, errorResponse].
 * Only the 403 is audited — a 401 is any bot probing the endpoint.
 */
async function requireAdmin(c) {
  const session = await getSession(c);
  if (!session) return [null, c.json({ error: 'not signed in' }, 401)];
  const user = session.user;
  if (!isAdmin(user, c.env)) {
    doAudit(c, 'admin.denied', { ok: false, uid: user.id, name: user.name });
    return [null, c.json({ error: 'forbidden' }, 403)];
  }
  return [user, null];
}

// Read KV presence; returns the row (sans hiddenAt) or null.
async function getLivePresence(kv, uid) {
  const raw = await kv.get('presence:' + uid);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    const { hiddenAt: _away, ...live } = p;
    return live;
  } catch { return null; }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const app = new Hono();

// GET /api/admin/users
// One row per user with workout counts, last-sync, push status, and live presence.
app.get('/api/admin/users', async (c) => {
  const [, resp] = await requireAdmin(c);
  if (resp) return resp;

  const env = c.env;
  const PASSWORD_LOGIN = /^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '');
  const INVITE_ONLY    = /^(1|true|yes|on)$/i.test(env.INVITE_ONLY || '');

  const users = await listUsers(env.DB);

  // Batch: all states and all sub user-ids in two queries.
  const { results: stateRows } = await env.DB.prepare('SELECT user_id, state FROM user_state').all();
  const stateByUser = Object.fromEntries(
    stateRows.map(s => {
      try { return [s.user_id, JSON.parse(s.state || '{}')]; }
      catch { return [s.user_id, {}]; }
    })
  );

  const { results: subRows } = await env.DB.prepare('SELECT user_id FROM push_subscriptions').all();
  const subUserIds = new Set(subRows.map(s => s.user_id));

  const result = [];
  for (const u of users) {
    const S = stateByUser[u.id] || {};
    const wks = records(S.workouts);
    const last = wks[wks.length - 1];
    const live = await getLivePresence(env.SESSIONS, u.id);
    result.push({
      id: u.id, name: u.name, created: u.created || null,
      disabled:    !!u.disabled,
      admin:       isAdmin(u, env),
      invitedBy:   u.invited_by || null,
      workouts:    wks.length,
      lastWorkout: last ? last.d : null,
      lastSync:    Math.max(S._ts || 0, u.last_pull || 0) || null,
      hasPush:     subUserIds.has(u.id),
      live,
      ...(PASSWORD_LOGIN ? { password: !!u.pw_hash, email: u.email || null } : {}),
    });
  }

  return c.json({
    users: result,
    invite_only: INVITE_ONLY,
    ...(PASSWORD_LOGIN ? { password_login: true } : {}),
    now: Date.now(),
  });
});

// GET /api/admin/user?id=
// Drill-down: full workout history, body-weight log, routines for one user.
app.get('/api/admin/user', async (c) => {
  const [, resp] = await requireAdmin(c);
  if (resp) return resp;

  const env = c.env;
  const id = new URL(c.req.url).searchParams.get('id') || '';
  const u = await getUserById(env.DB, id);
  if (!u) return c.json({ error: 'no such user' }, 404);

  const stateRow = await getUserState(env.DB, u.id);
  const S = stateRow ? (() => { try { return JSON.parse(stateRow.state || '{}'); } catch { return {}; } })() : {};

  const PASSWORD_LOGIN = /^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || '');

  return c.json({
    user: {
      id: u.id, name: u.name, created: u.created || null,
      disabled:  !!u.disabled,
      admin:     isAdmin(u, env),
      invitedBy: u.invited_by || null,
      ...(PASSWORD_LOGIN ? {
        password:   !!u.pw_hash,
        email:      u.email || null,
        resetUntil: u.pw_reset_exp > Date.now() ? u.pw_reset_exp : null,
      } : {}),
    },
    unit:      S.unit || 'kg',
    lastSync:  Math.max(S._ts || 0, u.last_pull || 0) || null,
    routines:  records(S.routines).map(r => ({
      id: r.id, name: r.name, emoji: r.emoji,
      count: records(r.ex).length,
    })),
    bodyweight: records(S.bodyweight),
    // Newest first; strip media refs (owner data only).
    workouts: records(S.workouts).reverse().map(({ media: _m, ...w }) => w),
  });
});

// POST /api/admin/user/disable
app.post('/api/admin/user/disable', async (c) => {
  const [admin, resp] = await requireAdmin(c);
  if (resp) return resp;

  const env = c.env;
  const body = await c.req.json().catch(() => ({}));
  const u = await getUserById(env.DB, text(body.id));
  if (!u) return c.json({ error: 'no such user' }, 404);
  if (isAdmin(u, env)) return c.json({ error: 'cannot disable an admin' }, 400);

  const disabled = !!body.disabled ? 1 : 0;
  await updateUser(env.DB, u.id, { disabled });

  if (disabled) {
    // Drop live presence and pending device links.
    await env.SESSIONS.delete('presence:' + u.id);
    await deleteDeviceLinksByUser(env.DB, u.id);
  }

  doAudit(c, disabled ? 'admin.user.disable' : 'admin.user.enable', {
    uid: admin.id, name: admin.name,
    tgt: u.id, tname: u.name,
  });

  return c.json({ ok: true, id: u.id, disabled: !!disabled });
});

// POST /api/admin/user/delete
// Removes the user, cascades D1 (passkeys/subs/etc.), and deletes R2 media.
app.post('/api/admin/user/delete', async (c) => {
  const [admin, resp] = await requireAdmin(c);
  if (resp) return resp;

  const env = c.env;
  const body = await c.req.json().catch(() => ({}));
  const u = await getUserById(env.DB, text(body.id));
  if (!u) return c.json({ error: 'no such user' }, 404);
  if (u.id === admin.id) return c.json({ error: 'you cannot delete your own account' }, 400);

  // Guard: never leave the instance without an admin.
  const allUsers = await listUsers(env.DB);
  const adminUidsList = adminUids(env);
  const adminList = allUsers.filter(x => x.admin === 1 || adminUidsList.includes(x.id));
  if ((u.admin === 1 || adminUidsList.includes(u.id)) && adminList.length <= 1) {
    return c.json({ error: 'cannot delete the last admin' }, 400);
  }

  const name = u.name; // capture before deletion

  // D1 ON DELETE CASCADE handles passkeys, push_subscriptions, device_links, user_state.
  await deleteUser(env.DB, u.id);
  // Drop KV presence.
  await env.SESSIONS.delete('presence:' + u.id);

  // Remove all R2 media objects with prefix '{uid}/'.
  if (env.FITNESS_MEDIA) {
    try {
      let cursor;
      do {
        const listed = await env.FITNESS_MEDIA.list({
          prefix: u.id + '/',
          ...(cursor ? { cursor } : {}),
        });
        for (const obj of listed.objects) {
          await env.FITNESS_MEDIA.delete(obj.key);
        }
        cursor = listed.truncated ? listed.cursor : null;
      } while (cursor);
    } catch (e) {
      log.error(env, 'could not remove R2 media', { userId: u.id, error: e.message });
    }
  }

  // Log with the name — the id means nothing once the row is gone.
  doAudit(c, 'admin.user.delete', { uid: admin.id, name: admin.name, msg: name });

  return c.json({ ok: true, id: u.id });
});

// GET /api/admin/invites
app.get('/api/admin/invites', async (c) => {
  const [, resp] = await requireAdmin(c);
  if (resp) return resp;

  const INVITE_ONLY = /^(1|true|yes|on)$/i.test(c.env.INVITE_ONLY || '');

  // Join to resolve usedBy uid → name in one query.
  const { results: invites } = await c.env.DB.prepare(`
    SELECT i.*, u.name AS used_by_name
    FROM invites i
    LEFT JOIN users u ON u.id = i.used_by
    ORDER BY i.created ASC
  `).all();

  return c.json({ invites, invite_only: INVITE_ONLY });
});

// POST /api/admin/invites/new
app.post('/api/admin/invites/new', async (c) => {
  const [admin, resp] = await requireAdmin(c);
  if (resp) return resp;

  const body = await c.req.json().catch(() => ({}));

  // 16 hex chars = 64 bits entropy (same as server.js).
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  const code = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO invites (code, note, created_by, created, used_by, used_at, revoked)
     VALUES (?, ?, ?, ?, NULL, NULL, 0)`
  ).bind(code, text(body.note).slice(0, 60), admin.id, now).run();

  doAudit(c, 'admin.invite.create', { uid: admin.id, name: admin.name, msg: code });

  return c.json({ invite: { code, note: text(body.note).slice(0, 60), created_by: admin.id, created: now } });
});

// POST /api/admin/invites/revoke
app.post('/api/admin/invites/revoke', async (c) => {
  const [admin, resp] = await requireAdmin(c);
  if (resp) return resp;

  const body = await c.req.json().catch(() => ({}));
  const code = text(body.code).toUpperCase();
  const inv = await c.env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first();
  if (!inv) return c.json({ error: 'no such code' }, 404);
  if (inv.used_by) return c.json({ error: 'already used, cannot revoke' }, 400);

  await c.env.DB.prepare('DELETE FROM invites WHERE code = ?').bind(code).run();
  doAudit(c, 'admin.invite.revoke', { uid: admin.id, name: admin.name, msg: inv.code });

  return c.json({ ok: true });
});

// GET /api/admin/audit
// Newest-first, paged by id. Supports ?limit=, ?before=, ?cat= (dot prefix or 'fail').
app.get('/api/admin/audit', async (c) => {
  const [, resp] = await requireAdmin(c);
  if (resp) return resp;

  const env = c.env;
  const q = new URL(c.req.url).searchParams;
  const limit  = Math.max(1, Math.min(200, +q.get('limit') || 100));
  const before = q.get('before') ? +q.get('before') : null;
  const cat    = q.get('cat') || '';

  // Build filter fragments (same for events and total count, minus the `before` cursor).
  const catWhere = cat === 'fail' ? 'ok = 0'
    : cat ? "ev LIKE ?"
    : null;
  const catParam = cat && cat !== 'fail' ? [cat + '.%'] : [];

  // Total matching events (without pagination).
  const totalWhere = catWhere ? `WHERE ${catWhere}` : '';
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM audit_events ${totalWhere}`
  ).bind(...catParam).first();
  const total = totalRow?.n ?? 0;

  // Paged events.
  const conditions = [];
  const params = [...catParam];
  if (catWhere) conditions.push(catWhere);
  if (before != null) { conditions.push('id < ?'); params.push(before); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const { results: events } = await env.DB.prepare(
    `SELECT * FROM audit_events ${where} ORDER BY id DESC LIMIT ?`
  ).bind(...params).all();

  const nextBefore = events.length === limit ? events[events.length - 1]?.id ?? null : null;

  return c.json({
    events,
    total,
    nextBefore,
    enabled:   env.AUDIT_LOG !== '0' && env.AUDIT_LOG !== 'false',
    ip_mode:   env.AUDIT_IP || 'off',
    retention: { max: +(env.AUDIT_MAX || 5000), days: +(env.AUDIT_DAYS || 90) },
    now:       Date.now(),
  });
});

// POST /api/admin/audit/clear
// Deletes all audit rows; the deletion itself is logged (always leaves a visible gap in ids).
app.post('/api/admin/audit/clear', async (c) => {
  const [admin, resp] = await requireAdmin(c);
  if (resp) return resp;

  await c.env.DB.prepare('DELETE FROM audit_events').run();
  doAudit(c, 'admin.audit.clear', { uid: admin.id, name: admin.name });

  return c.json({ ok: true });
});

export default app;

// ── Cron trigger handler ──────────────────────────────────────────────────────
// Called from the scheduled export in index.js every minute.
// Sends day-reminder and missed-workout nudge push notifications.

const hhmmToMin = v => {
  const m = /^(\d{2}):(\d{2})$/.exec(v || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const minutesLate = (time, now) => hhmmToMin(now.hhmm) - hhmmToMin(time);
const REMINDER_WINDOW_MIN = 15;

/**
 * Compute the current time in an arbitrary IANA timezone.
 * @param {string} tz - IANA timezone name (e.g. "Europe/Lisbon")
 * @returns {{ date: string, hhmm: string, weekday: number } | null}
 */
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    const date = `${g('year')}-${g('month')}-${g('day')}`;
    return { date, hhmm: `${g('hour')}:${g('minute')}`, weekday: new Date(date + 'T12:00:00Z').getUTCDay() };
  } catch { return null; } // unknown timezone — skip rather than guess
}

/**
 * Reminder and nudge tick — runs on every cron invocation.
 * Processes only users who have at least one push subscription and have reminders enabled.
 * Per-user errors are caught and logged so one bad profile cannot halt the rest.
 *
 * @param {object} env - Worker env bindings
 * @param {ExecutionContext} ctx
 */
export async function reminderTick(env, ctx) {
  const cronLog = createLogger('cron');
  
  // Only process users that have at least one push subscription.
  const { results: usersWithSubs } = await env.DB.prepare(`
    SELECT DISTINCT u.* FROM users u
    INNER JOIN push_subscriptions ps ON ps.user_id = u.id
    WHERE u.disabled = 0
  `).all();

  cronLog.debug(env, 'reminderTick: processing users', { count: usersWithSubs.length });

  let reminders = 0;
  let nudges = 0;

  for (const user of usersWithSubs) {
    try {
      const stateRow = await getUserState(env.DB, user.id);
      if (!stateRow) continue;
      let S;
      try { S = JSON.parse(stateRow.state || '{}'); } catch { continue; }
      if (!S?.reminder?.on) continue;

      const now = userNow(S.reminder.tz || 'UTC');
      if (!now) continue;

      // ── Nudge tick ──────────────────────────────────────────────────────────
      // Evening nudge (20:00–21:30 or 2 h after reminder) for a missed workout.
      if (S.reminder.nudge && user.last_nudge !== now.date) {
        if (nudgeWindowOpen(S.reminder.time, now.hhmm)) {
          // Skip if the user has an active session (they are already working out).
          const presenceRaw = await env.SESSIONS.get('presence:' + user.id);
          if (!presenceRaw) {
            const rid = nudgeFor(S, now.date);
            if (rid) {
              const routine = records(S.routines).find(r => r?.id === rid);
              cronLog.debug(env, 'reminderTick: sending nudge', { userId: user.id, routineId: rid });
              await sendPushToUser(
                env, user.id,
                nudgePush(S.lang, toneOf(S.reminder), routine, now.date)
              );
              await updateUser(env.DB, user.id, { last_nudge: now.date });
              nudges++;
            }
          }
        }
      }

      // ── Reminder tick ───────────────────────────────────────────────────────
      // Day reminder: once per local date, within REMINDER_WINDOW_MIN of the user's set time.
      const late = minutesLate(S.reminder.time, now);
      if (!(late >= 0 && late <= REMINDER_WINDOW_MIN)) continue;
      if (user.last_reminder === now.date) continue;
      if (records(S.workouts).some(w => w?.d === now.date)) continue;
      if (excusedOn(S, now.date)) continue;
      const rid = effectiveRoutineId(S, now.date);
      if (!rid) continue;
      const routine = records(S.routines).find(r => r?.id === rid);

      cronLog.debug(env, 'reminderTick: sending reminder', { userId: user.id, routineId: rid });
      await sendPushToUser(env, user.id, dayReminderPush(S.lang, routine));
      await updateUser(env.DB, user.id, { last_reminder: now.date });
      reminders++;
    } catch (e) {
      cronLog.error(env, 'reminderTick: user error', { userId: user.id, error: e?.message });
    }
  }

  cronLog.info(env, 'reminderTick: completed', { processed: usersWithSubs.length, reminders, nudges });
}
