// In-app notifications: friend requests, challenges, friend activity.
import { Hono } from 'hono';
import { getSession } from './auth.js';
import { createLogger } from '../lib/logger.js';
import {
  getNotificationsByUser,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../db/queries.js';

const log = createLogger('notifications');

const app = new Hono();

// ── GET /api/notifications — paginated list of notifications ──────────────────

app.get('/api/notifications', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
  const before = c.req.query('before') ? parseInt(c.req.query('before'), 10) : null;

  const notifications = await getNotificationsByUser(c.env.DB, session.user.id, { limit, before });

  const items = notifications.map(n => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data ? JSON.parse(n.data) : null,
    read: n.read === 1,
    created: n.created,
  }));

  const hasMore = items.length === limit;
  const nextBefore = items.length > 0 ? items[items.length - 1].id : null;

  return c.json({ items, hasMore, nextBefore });
});

// ── GET /api/notifications/unread-count — count of unread notifications ───────

app.get('/api/notifications/unread-count', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const count = await getUnreadCount(c.env.DB, session.user.id);
  return c.json({ count });
});

// ── POST /api/notifications/:id/read — mark a single notification as read ─────

app.post('/api/notifications/:id/read', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) {
    return c.json({ error: 'invalid notification id' }, 400);
  }

  await markNotificationRead(c.env.DB, id, session.user.id);
  return c.json({ ok: true });
});

// ── POST /api/notifications/read-all — mark all notifications as read ─────────

app.post('/api/notifications/read-all', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  await markAllNotificationsRead(c.env.DB, session.user.id);
  log.info(c.env, 'all notifications marked read', { userId: session.user.id });
  return c.json({ ok: true });
});

// ── GET /api/notifications/preferences — get notification preferences ─────────

app.get('/api/notifications/preferences', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const prefs = await getNotificationPreferences(c.env.DB, session.user.id);
  
  return c.json({
    friendRequests: prefs?.friend_requests ?? 1,
    challengeUpdates: prefs?.challenge_updates ?? 1,
    friendActivity: prefs?.friend_activity ?? 1,
  });
});

// ── PUT /api/notifications/preferences — update notification preferences ──────

app.put('/api/notifications/preferences', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const body = await c.req.json().catch(() => ({}));
  const { friendRequests, challengeUpdates, friendActivity } = body;

  // Validate booleans (convert to 1/0)
  const prefs = {
    friend_requests: friendRequests === false ? 0 : 1,
    challenge_updates: challengeUpdates === false ? 0 : 1,
    friend_activity: friendActivity === false ? 0 : 1,
  };

  await updateNotificationPreferences(c.env.DB, session.user.id, prefs);
  log.info(c.env, 'notification preferences updated', { userId: session.user.id, prefs });

  return c.json({
    ok: true,
    friendRequests: prefs.friend_requests === 1,
    challengeUpdates: prefs.challenge_updates === 1,
    friendActivity: prefs.friend_activity === 1,
  });
});

export default app;
