// Team feed: shows recent activity from all users on the server
import { Hono } from 'hono';
import { getSession } from './auth.js';

const app = new Hono();

// GET /api/feed - Get team feed (recent workouts from all users)
app.get('/api/feed', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const env = c.env;
  const currentUserId = session.user.id;

  try {
    // Get all users
    const { results: users } = await env.DB.prepare(
      'SELECT id, name FROM users WHERE disabled = 0'
    ).all();

    const userMap = new Map(users.map(u => [u.id, u.name]));

    // Get all user states to extract workouts
    const { results: states } = await env.DB.prepare(
      'SELECT user_id, state FROM user_state'
    ).all();

    const feedItems = [];
    const liveNow = [];
    const now = Date.now();
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    for (const row of states) {
      const userName = userMap.get(row.user_id);
      if (!userName) continue;

      let state;
      try {
        state = JSON.parse(row.state || '{}');
      } catch {
        continue;
      }

      const isMe = row.user_id === currentUserId;

      // Check for active workout (live now)
      if (state.active && state.active.start) {
        const startedAt = state.active.start;
        // Only show if started within last 4 hours (likely still active)
        if (now - startedAt < 4 * 60 * 60 * 1000) {
          const entries = state.active.entries || [];
          const setsTotal = entries.reduce((sum, e) => sum + (e.sets?.length || 0), 0);
          const setsDone = entries.reduce((sum, e) => sum + (e.sets?.filter(s => s.done)?.length || 0), 0);
          
          liveNow.push({
            uid: row.user_id,
            name: userName,
            isMe,
            workoutName: state.active.label || state.active.routineName || 'Workout',
            startedAt,
            setsTotal,
            setsDone,
          });
        }
      }

      // Get completed workouts from the past week
      const workouts = state.workouts || [];
      for (const workout of workouts) {
        if (!workout.d || !workout.end) continue;

        // Parse workout date and end time
        const workoutEnd = workout.end;
        if (now - workoutEnd > ONE_WEEK_MS) continue;

        // Calculate duration
        const durationMs = workout.start && workout.end ? workout.end - workout.start : null;

        // Get workout label
        let label = workout.label || workout.routineName;
        if (!label) {
          // Generate label from exercises
          const entries = workout.entries || [];
          if (entries.length === 1) {
            label = entries[0].name || entries[0].id || 'Workout';
          } else if (entries.length > 1) {
            label = `${entries.length} exercises`;
          } else {
            label = 'Workout';
          }
        }

        feedItems.push({
          type: 'workout',
          name: userName,
          at: workoutEnd,
          isMe,
          data: {
            label,
            durationMs,
            exerciseCount: (workout.entries || []).length,
            setCount: (workout.entries || []).reduce((sum, e) => sum + (e.sets?.length || 0), 0),
          },
        });
      }

      // Check for PRs (personal records) in recent workouts
      for (const workout of workouts) {
        if (!workout.end || now - workout.end > ONE_WEEK_MS) continue;
        
        if (workout.prs && workout.prs.length > 0) {
          for (const prExerciseId of workout.prs) {
            feedItems.push({
              type: 'pr',
              name: userName,
              at: workout.end,
              isMe,
              data: {
                exerciseId: prExerciseId,
                label: prExerciseId, // Frontend can look up exercise name
              },
            });
          }
        }
      }
    }

    // Sort by timestamp descending (most recent first)
    feedItems.sort((a, b) => b.at - a.at);

    // Limit to 50 most recent items
    const items = feedItems.slice(0, 50);

    // Sort liveNow by start time (most recent first)
    liveNow.sort((a, b) => b.startedAt - a.startedAt);

    return c.json({ items, liveNow });
  } catch (err) {
    console.error('Feed error:', err);
    return c.json({ error: 'failed to load feed' }, 500);
  }
});

export default app;
