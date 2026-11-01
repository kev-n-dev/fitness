// Activity feed: friend workout completions with privacy controls.
import { Hono } from 'hono';
import { getSession } from './auth.js';
import { createLogger } from '../lib/logger.js';
import {
  getActivityFeedSettings,
  updateActivityFeedSettings,
  getWorkoutVisibility,
  setWorkoutVisibility,
  getFriendActivity,
  createFriendActivity,
  activityExistsForWorkout,
  getFriendsByUser,
  createNotification, isNotificationTypeEnabled,
} from '../db/queries.js';

const log = createLogger('activity');

const app = new Hono();

// Valid visibility values
const VISIBILITIES = ['summary', 'full', 'hidden'];

// ── GET /api/activity/feed — paginated friend activity ────────────────────────

app.get('/api/activity/feed', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
  const before = c.req.query('before') ? parseInt(c.req.query('before'), 10) : null;

  const activity = await getFriendActivity(c.env.DB, session.user.id, { limit, before });

  // Format the response
  const items = activity.map(a => ({
    id: a.id,
    friendId: a.user_id,
    friendName: a.user_name,
    workoutId: a.workout_id,
    workoutName: a.workout_name,
    completedAt: a.completed_at,
    durationMs: a.duration_ms,
    exerciseCount: a.exercise_count,
    setCount: a.set_count,
    visibility: a.visibility,
  }));

  const hasMore = items.length === limit;
  const nextBefore = items.length > 0 ? items[items.length - 1].id : null;

  return c.json({ items, hasMore, nextBefore });
});

// ── GET /api/activity/settings — get user's feed settings ─────────────────────

app.get('/api/activity/settings', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const settings = await getActivityFeedSettings(c.env.DB, session.user.id);
  
  return c.json({
    defaultVisibility: settings?.default_visibility || 'summary',
  });
});

// ── PUT /api/activity/settings — update default visibility ────────────────────

app.put('/api/activity/settings', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const body = await c.req.json().catch(() => ({}));
  const { defaultVisibility } = body;

  if (!defaultVisibility || !VISIBILITIES.includes(defaultVisibility)) {
    return c.json({ error: 'defaultVisibility must be summary, full, or hidden' }, 400);
  }

  await updateActivityFeedSettings(c.env.DB, session.user.id, defaultVisibility);
  log.info(c.env, 'activity settings updated', { userId: session.user.id, defaultVisibility });

  return c.json({ ok: true, defaultVisibility });
});

// ── GET /api/activity/workout/:workoutId/visibility — get workout visibility ──

app.get('/api/activity/workout/:workoutId/visibility', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const workoutId = c.req.param('workoutId');
  const vis = await getWorkoutVisibility(c.env.DB, session.user.id, workoutId);
  const settings = await getActivityFeedSettings(c.env.DB, session.user.id);

  return c.json({
    visibility: vis?.visibility || settings?.default_visibility || 'summary',
    isOverride: !!vis,
  });
});

// ── PUT /api/activity/workout/:workoutId/visibility — set workout visibility ──

app.put('/api/activity/workout/:workoutId/visibility', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const workoutId = c.req.param('workoutId');
  const body = await c.req.json().catch(() => ({}));
  const { visibility } = body;

  if (!visibility || !VISIBILITIES.includes(visibility)) {
    return c.json({ error: 'visibility must be summary, full, or hidden' }, 400);
  }

  await setWorkoutVisibility(c.env.DB, session.user.id, workoutId, visibility);
  log.info(c.env, 'workout visibility set', { userId: session.user.id, workoutId, visibility });

  return c.json({ ok: true, visibility });
});

// ── POST /api/activity/record — record a completed workout for activity feed ──
// Called when a workout is finished to add it to the activity feed

app.post('/api/activity/record', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const body = await c.req.json().catch(() => ({}));
  const { workoutId, workoutName, completedAt, durationMs, exerciseCount, setCount } = body;

  if (!workoutId || !completedAt) {
    return c.json({ error: 'workoutId and completedAt required' }, 400);
  }

  // Check if this workout was already recorded
  const exists = await activityExistsForWorkout(c.env.DB, session.user.id, workoutId);
  if (exists) {
    return c.json({ ok: true, message: 'already recorded' });
  }

  // Check user's visibility settings - don't record if hidden
  const settings = await getActivityFeedSettings(c.env.DB, session.user.id);
  const vis = await getWorkoutVisibility(c.env.DB, session.user.id, workoutId);
  const effectiveVisibility = vis?.visibility || settings?.default_visibility || 'summary';

  if (effectiveVisibility === 'hidden') {
    return c.json({ ok: true, message: 'not recorded (hidden)' });
  }

  const now = new Date().toISOString();
  await createFriendActivity(c.env.DB, {
    user_id: session.user.id,
    workout_id: workoutId,
    workout_name: workoutName || null,
    completed_at: completedAt,
    duration_ms: durationMs || null,
    exercise_count: exerciseCount || null,
    set_count: setCount || null,
    created: now,
  });

  // Notify friends who have friend_activity enabled
  const friends = await getFriendsByUser(c.env.DB, session.user.id);
  for (const friend of friends) {
    const enabled = await isNotificationTypeEnabled(c.env.DB, friend.id, 'friend_workout');
    if (enabled) {
      await createNotification(c.env.DB, {
        user_id: friend.id,
        type: 'friend_workout',
        title: 'Friend Workout',
        body: `${session.user.name} completed ${workoutName || 'a workout'}`,
        data: JSON.stringify({ userId: session.user.id, userName: session.user.name, workoutId, workoutName }),
        created: now,
      });
    }
  }

  log.info(c.env, 'activity recorded', { userId: session.user.id, workoutId });
  return c.json({ ok: true });
});

export default app;
