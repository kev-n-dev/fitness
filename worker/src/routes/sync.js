// GET /api/data        — pull full state
// GET /api/data/rev    — cheap revision poll (KV-first)
// PUT /api/data        — push state delta
//
// Ported from api/server.js GET/PUT /api/data sections.
// referencedHashes() copied from api/media.js.
import { Hono } from 'hono';
import { getSession } from './auth.js';
import { getUserState, updateUser, getUserById } from '../db/queries.js';
import { getActiveChallenges, updateChallengeProgress, updateChallengeStatus, getChallengeProgress } from '../db/queries.js';
import { createFriendActivity, activityExistsForWorkout, getActivityFeedSettings, getWorkoutVisibility } from '../db/queries.js';
import { getFriendsByUser, createNotification, isNotificationTypeEnabled } from '../db/queries.js';
import { stampPut } from '../lib/sync-stamps.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('sync');

// ── constants ──────────────────────────────────────────────────────────────────

// How many earlier write ids a document keeps (`_wids`).
const WID_KEEP = 50;
// GET /api/data updates user.last_pull at most once per this interval.
const PULL_NOTE_MS = 600_000; // 10 minutes
// Media hash pattern — 64 hex chars.
const HASH_RE = /^[0-9a-f]{64}$/;

// ── helpers ────────────────────────────────────────────────────────────────────

// A stored document as a client gets it: strips server-private _unstamped and _prior.
// Copied from api/server.js forClient().
function forClient(S) {
  if (!S || typeof S !== 'object' || !('_unstamped' in S || '_prior' in S)) return S;
  const { _unstamped, _prior, ...rest } = S;
  return rest;
}

// Filters a list down to plain-object entries (non-null, non-array objects).
// Copied from api/server.js records().
const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
const records = v => (Array.isArray(v) ? v.filter(record) : []);

// Every blob hash a state references: customEx[].media(.poster) and workouts[].media[].
// Copied verbatim from api/media.js referencedHashes().
function referencedHashes(state) {
  const out = new Set();
  if (!state || typeof state !== 'object') return out;
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const add = r => {
    if (r && typeof r === 'object' && typeof r.hash === 'string' && HASH_RE.test(r.hash))
      out.add(r.hash);
  };
  const ref = m => { add(m); add(m.poster); };
  for (const c of Array.isArray(state.customEx) ? state.customEx : []) {
    if (isObj(c) && isObj(c.media)) ref(c.media);
  }
  for (const w of Array.isArray(state.workouts) ? state.workouts : []) {
    if (!isObj(w) || !Array.isArray(w.media)) continue;
    for (const m of w.media) if (isObj(m)) ref(m);
  }
  return out;
}

// Update KV GC marks after a PUT. Best-effort; never turns a success into an error.
// Referenced hashes: delete the GC key (cancel pending collection).
// Hashes that were referenced in the old state but absent from the new one: set the GC key
// to now (begin the grace period). Corresponds to media.js noteState + reconcile().
async function noteState(env, uid, curState, newState) {
  try {
    const newRefs = referencedHashes(newState);
    const oldRefs = curState ? referencedHashes(curState) : new Set();
    const ops = [];
    for (const h of newRefs) {
      ops.push(env.RATE_LIMITS.delete('gc:' + uid + ':' + h));
    }
    for (const h of oldRefs) {
      if (!newRefs.has(h)) {
        ops.push(
          env.RATE_LIMITS.put(
            'gc:' + uid + ':' + h,
            String(Date.now()),
            { expirationTtl: 86_400 * 30 }, // 30-day safety TTL
          ),
        );
      }
    }
    if (ops.length) {
      await Promise.all(ops);
      log.debug(env, 'noteState: GC marks updated', { userId: uid, newRefs: newRefs.size, orphaned: oldRefs.size - newRefs.size });
    }
  } catch (e) {
    log.warn(env, 'noteState failed', { userId: uid, error: e?.message });
  }
}

// Check active challenges and update progress after a workout sync.
// For beat_pr challenges: check if the user beat a PR for the exercise.
// For workout_count challenges: increment the workout count.
async function updateChallengesAfterSync(env, userId, curState, newState) {
  try {
    const curWorkouts = curState?.workouts || [];
    const newWorkouts = newState?.workouts || [];
    
    // Find new workouts (ids not in old state)
    const curIds = new Set(curWorkouts.map(w => w.id));
    const addedWorkouts = newWorkouts.filter(w => w.id && !curIds.has(w.id));
    
    if (addedWorkouts.length === 0) return;
    
    // Get active challenges for this user
    const challenges = await getActiveChallenges(env.DB, userId);
    if (challenges.length === 0) return;
    
    for (const challenge of challenges) {
      const now = new Date().toISOString();
      
      if (challenge.type === 'workout_count') {
        // Increment workout count by the number of new workouts
        const progress = await getChallengeProgress(env.DB, challenge.id);
        const userProgress = progress.find(p => p.user_id === userId);
        const currentVal = userProgress?.current_value || 0;
        const newVal = currentVal + addedWorkouts.length;
        
        await updateChallengeProgress(env.DB, challenge.id, userId, newVal, now);
        log.debug(env, 'challenge progress updated (workout_count)', { 
          challengeId: challenge.id, userId, oldVal: currentVal, newVal 
        });
        
        // Check if target reached
        if (newVal >= challenge.target_value) {
          await updateChallengeStatus(env.DB, challenge.id, 'completed', userId);
          log.info(env, 'challenge completed', { challengeId: challenge.id, winnerId: userId });
        }
      } else if (challenge.type === 'beat_pr') {
        // Check if any added workout contains the challenge exercise with a better PR
        for (const workout of addedWorkouts) {
          const exercises = workout.ex || [];
          for (const ex of exercises) {
            if (ex.id !== challenge.exercise_id) continue;
            
            // Check sets for PR
            const sets = ex.sets || [];
            for (const set of sets) {
              let value = 0;
              if (challenge.metric === 'weight') {
                value = set.w || 0;
              } else if (challenge.metric === 'reps') {
                value = set.r || 0;
              } else if (challenge.metric === 'both') {
                // Volume = weight × reps
                value = (set.w || 0) * (set.r || 0);
              }
              
              if (value > 0) {
                const progress = await getChallengeProgress(env.DB, challenge.id);
                const userProgress = progress.find(p => p.user_id === userId);
                const currentVal = userProgress?.current_value || 0;
                
                if (value > currentVal) {
                  await updateChallengeProgress(env.DB, challenge.id, userId, value, now);
                  log.debug(env, 'challenge progress updated (beat_pr)', { 
                    challengeId: challenge.id, userId, oldVal: currentVal, newVal: value 
                  });
                  
                  // Check if target reached
                  if (value >= challenge.target_value) {
                    await updateChallengeStatus(env.DB, challenge.id, 'completed', userId);
                    log.info(env, 'challenge completed', { challengeId: challenge.id, winnerId: userId });
                  }
                }
              }
            }
          }
        }
      } else if (challenge.type === 'timed') {
        // Timed challenges are just workout_count but with a strict end date
        // Completion is checked by end date, not target
        const progress = await getChallengeProgress(env.DB, challenge.id);
        const userProgress = progress.find(p => p.user_id === userId);
        const currentVal = userProgress?.current_value || 0;
        const newVal = currentVal + addedWorkouts.length;
        
        await updateChallengeProgress(env.DB, challenge.id, userId, newVal, now);
        log.debug(env, 'challenge progress updated (timed)', { 
          challengeId: challenge.id, userId, oldVal: currentVal, newVal 
        });

        // Check if end date has passed — determine winner by highest progress
        if (challenge.end_date) {
          const endDate = new Date(challenge.end_date);
          if (new Date() > endDate) {
            const allProgress = await getChallengeProgress(env.DB, challenge.id);
            const sorted = [...allProgress].sort((a, b) => b.current_value - a.current_value);
            if (sorted.length >= 2 && sorted[0].current_value > sorted[1].current_value) {
              await updateChallengeStatus(env.DB, challenge.id, 'completed', sorted[0].user_id);
              log.info(env, 'timed challenge completed', { challengeId: challenge.id, winnerId: sorted[0].user_id });
            } else if (sorted.length >= 2) {
              // Tie — no winner
              await updateChallengeStatus(env.DB, challenge.id, 'completed', null);
              log.info(env, 'timed challenge completed (tie)', { challengeId: challenge.id });
            }
          }
        }
      }
    }
  } catch (e) {
    log.warn(env, 'updateChallengesAfterSync failed', { userId, error: e?.message });
  }
}

// Record friend activity and notify friends when workouts are synced.
// Uses batched operations to avoid serial N+1 queries for users with many friends.
async function recordFriendActivityAfterSync(env, userId, curState, newState) {
  try {
    const curWorkouts = curState?.workouts || [];
    const newWorkouts = newState?.workouts || [];
    
    // Find new workouts (ids not in old state)
    const curIds = new Set(curWorkouts.map(w => w.id));
    const addedWorkouts = newWorkouts.filter(w => w.id && !curIds.has(w.id));
    
    if (addedWorkouts.length === 0) return;

    // Get user info and friends list once, up front
    const [user, friends, settings] = await Promise.all([
      getUserById(env.DB, userId),
      getFriendsByUser(env.DB, userId),
      getActivityFeedSettings(env.DB, userId),
    ]);
    if (!user) return;

    const defaultVisibility = settings?.default_visibility || 'summary';
    const now = new Date().toISOString();

    // Collect all notifications to create, then batch-insert them
    const notificationsToCreate = [];

    // Pre-fetch notification preferences for all friends in parallel
    const friendPrefs = await Promise.all(
      friends.map(f => isNotificationTypeEnabled(env.DB, f.id, 'friend_workout').then(enabled => ({ id: f.id, enabled })))
    );
    const enabledFriendIds = new Set(friendPrefs.filter(p => p.enabled).map(p => p.id));

    for (const workout of addedWorkouts) {
      // Check per-workout visibility override
      const vis = await getWorkoutVisibility(env.DB, userId, workout.id);
      const effectiveVisibility = vis?.visibility || defaultVisibility;

      // Skip if user has hidden this workout
      if (effectiveVisibility === 'hidden') continue;

      // Check if already recorded
      const exists = await activityExistsForWorkout(env.DB, userId, workout.id);
      if (exists) continue;

      // Calculate workout stats
      const exercises = workout.ex || [];
      const exerciseCount = exercises.length;
      const setCount = exercises.reduce((acc, ex) => acc + (ex.sets?.length || 0), 0);
      const durationMs = workout.endedAt && workout.startedAt
        ? new Date(workout.endedAt).getTime() - new Date(workout.startedAt).getTime()
        : null;

      // Record the activity
      await createFriendActivity(env.DB, {
        user_id: userId,
        workout_id: workout.id,
        workout_name: workout.name || null,
        completed_at: workout.endedAt || now,
        duration_ms: durationMs,
        exercise_count: exerciseCount,
        set_count: setCount,
        created: now,
      });

      log.debug(env, 'friend activity recorded', { userId, workoutId: workout.id });

      // Queue notifications for friends who have friend_activity enabled
      for (const friend of friends) {
        if (enabledFriendIds.has(friend.id)) {
          notificationsToCreate.push({
            user_id: friend.id,
            type: 'friend_workout',
            title: 'Friend Workout',
            body: `${user.name} completed ${workout.name || 'a workout'}`,
            data: JSON.stringify({ userId, userName: user.name, workoutId: workout.id, workoutName: workout.name }),
            created: now,
          });
        }
      }
    }

    // Batch-create all notifications in parallel (limited concurrency)
    if (notificationsToCreate.length > 0) {
      const BATCH_SIZE = 10;
      for (let i = 0; i < notificationsToCreate.length; i += BATCH_SIZE) {
        const batch = notificationsToCreate.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(n => createNotification(env.DB, n)));
      }
    }
  } catch (e) {
    log.warn(env, 'recordFriendActivityAfterSync failed', { userId, error: e?.message });
  }
}

// ── routes ─────────────────────────────────────────────────────────────────────

const app = new Hono();

// ── GET /api/data ──────────────────────────────────────────────────────────────
// Returns the full synced document for the signed-in user.
app.get('/api/data', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const { user } = session;
  const env = c.env;

  log.debug(env, 'GET /api/data: fetching state', { userId: user.id });
  const row = await getUserState(env.DB, user.id);
  if (!row) {
    log.debug(env, 'GET /api/data: no state found', { userId: user.id });
    return c.json({ state: null, rev: 0 });
  }

  let state;
  try {
    state = JSON.parse(row.state);
  } catch {
    log.error(env, 'GET /api/data: state unreadable', { userId: user.id });
    return c.json({ error: 'state unreadable' }, 503);
  }

  // Record the pull timestamp at most once per PULL_NOTE_MS — non-blocking.
  const now = Date.now();
  if (now - (user.last_pull || 0) >= PULL_NOTE_MS) {
    const ctx = c.executionCtx ?? { waitUntil: () => {} };
    ctx.waitUntil(
      updateUser(env.DB, user.id, { last_pull: now })
        .catch(e => log.warn(env, 'notePull failed', { userId: user.id, error: e?.message })),
    );
  }

  log.debug(env, 'GET /api/data: returning state', { userId: user.id, rev: row.rev });
  return c.json({ state: forClient(state), rev: row.rev });
});

// ── GET /api/data/rev ──────────────────────────────────────────────────────────
// Returns just the revision (and write id) — the client polls this every 30 s.
// KV is the cheap path; D1 is the fallback on a cache miss.
app.get('/api/data/rev', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const { user } = session;
  const env = c.env;

  // KV fast path — written on every successful PUT /api/data.
  const kvRaw = await env.SESSIONS.get('data:rev:' + user.id);
  if (kvRaw) {
    try {
      const cached = JSON.parse(kvRaw);
      return c.json({ rev: cached.rev, ...(cached.wid ? { wid: cached.wid } : {}) });
    } catch { /* fall through to D1 */ }
  }

  // D1 fallback — parse state to extract _rev and _wid.
  const row = await getUserState(env.DB, user.id);
  if (!row) return c.json({ rev: 0 });

  let rev = row.rev || 0;
  let wid;
  try {
    const state = JSON.parse(row.state);
    rev = state?._rev || row.rev || 0;
    wid = state?._wid;
  } catch { /* use row.rev, no wid */ }

  return c.json({ rev, ...(wid ? { wid } : {}) });
});

// ── PUT /api/data ──────────────────────────────────────────────────────────────
// Receives a state push. Validates, stamps, and writes to D1.
app.put('/api/data', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const { user } = session;
  const env = c.env;

  const body = await c.req.json().catch(() => ({}));
  log.debug(env, 'PUT /api/data: received', { userId: user.id, baseRev: body.baseRev });

  // ── validate body.state ────────────────────────────────────────────────────
  if (!body.state || typeof body.state !== 'object') {
    log.debug(env, 'PUT /api/data: state required', { userId: user.id });
    return c.json({ error: 'state required' }, 400);
  }
  // Reject a document whose only keys are server-owned bookkeeping (_rev, _ts).
  if (
    !Array.isArray(body.state) &&
    !Object.keys(body.state).some(k => k !== '_rev' && k !== '_ts')
  ) {
    log.debug(env, 'PUT /api/data: state required (empty)', { userId: user.id });
    return c.json({ error: 'state required' }, 400);
  }
  const isList = v => v == null || Array.isArray(v);
  if (Array.isArray(body.state) || !isList(body.state.workouts) || !isList(body.state.routines)) {
    log.debug(env, 'PUT /api/data: invalid state structure', { userId: user.id });
    return c.json({ error: 'invalid state' }, 400);
  }
  // Drop non-object entries from the two lists the server iterates.
  for (const k of ['workouts', 'routines']) {
    if (Array.isArray(body.state[k])) body.state[k] = records(body.state[k]);
  }

  // ── read current state from D1 ─────────────────────────────────────────────
  const row = await getUserState(env.DB, user.id);
  let cur = null;
  if (row) {
    try {
      cur = JSON.parse(row.state);
    } catch {
      log.error(env, 'PUT /api/data: state unreadable', { userId: user.id });
      return c.json({ error: 'state unreadable' }, 503);
    }
  }
  const curRev = cur?._rev || 0;

  // ── conflict check ─────────────────────────────────────────────────────────
  // A baseRev that does not match the stored rev means another device wrote first.
  // A baseWid mismatch catches the same when rev counters went back in time (restore).
  if (
    (body.baseRev != null && body.baseRev !== curRev) ||
    (body.baseRev != null &&
      typeof body.baseWid === 'string' &&
      cur?._wid &&
      body.baseWid !== cur._wid)
  ) {
    log.info(env, 'PUT /api/data: conflict detected', { userId: user.id, baseRev: body.baseRev, curRev });
    return c.json({ error: 'conflict', rev: curRev, state: forClient(cur) }, 409);
  }

  // ── apply changes ──────────────────────────────────────────────────────────
  // Active workouts stay device-local, never stored.
  delete body.state.active;

  // resetAt only moves forward: keep the stored stamp if it is newer.
  const storedReset = Number(cur?.resetAt) || 0;
  if (storedReset > (Number(body.state.resetAt) || 0)) {
    body.state.resetAt = cur.resetAt;
    if (cur.resetIds && typeof cur.resetIds === 'object') body.state.resetIds = cur.resetIds;
    else delete body.state.resetIds;
  }

  // Run sync-stamps: merges deletion/edit records, restores unknown fields for older writers,
  // stamps changes made without stamps. report.changed is set when the stored document will
  // differ from what the writer sent (server put something back).
  const report = {};
  try {
    stampPut(cur, body.state, {
      overRead: body.baseRev != null && body.baseRev === curRev,
      stamped: body.stamped === true,
      report,
    });
  } catch (e) {
    if (e instanceof RangeError) {
      log.debug(env, 'PUT /api/data: stampPut RangeError', { userId: user.id });
      return c.json({ error: 'invalid state' }, 400);
    }
    throw e;
  }

  // Assign server-owned revision bookkeeping.
  body.state._rev = curRev + 1;
  // Step up an extra revision when the server modified the document so the writer's next
  // half-minute poll sees a change and re-fetches.
  if (report.changed) body.state._rev = curRev + 2;

  body.state._wids = [
    ...(Array.isArray(cur?._wids) ? cur._wids : []),
    ...(cur?._wid ? [cur._wid] : []),
  ].filter(x => typeof x === 'string').slice(-WID_KEEP);

  const widBytes = new Uint8Array(8);
  crypto.getRandomValues(widBytes);
  body.state._wid = Array.from(widBytes, b => b.toString(16).padStart(2, '0')).join('');

  const rev = body.state._rev;
  const wid = body.state._wid;

  // Serialize. JSON.stringify throws RangeError on documents nested thousands of levels deep.
  let text;
  try {
    text = JSON.stringify(body.state);
  } catch (e) {
    if (e instanceof RangeError) {
      log.debug(env, 'PUT /api/data: JSON.stringify RangeError', { userId: user.id });
      return c.json({ error: 'invalid state' }, 400);
    }
    throw e;
  }

  // ── atomic write to D1 ─────────────────────────────────────────────────────
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_state (user_id, state, rev) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, rev = excluded.rev`,
    ).bind(user.id, text, rev),
  ]);
  log.debug(env, 'PUT /api/data: state written', { userId: user.id, rev, wid: wid.slice(0, 8), size: text.length });

  // ── post-write KV bookkeeping (non-blocking) ───────────────────────────────
  // Cache the new rev so GET /api/data/rev answers from KV for the next 5 min.
  // Update media GC marks so unreferenced blobs age out correctly.
  // Update challenge progress when workouts are added.
  const ctx = c.executionCtx ?? { waitUntil: () => {} };
  ctx.waitUntil(
    (async () => {
      await env.SESSIONS.put(
        'data:rev:' + user.id,
        JSON.stringify({ rev, wid }),
        { expirationTtl: 300 },
      );
      await noteState(env, user.id, cur, body.state);
      await updateChallengesAfterSync(env, user.id, cur, body.state);
      await recordFriendActivityAfterSync(env, user.id, cur, body.state);
    })().catch(e => log.warn(env, 'sync post-write KV failed', { userId: user.id, error: e?.message })),
  );

  return c.json({ ok: true, ts: body.state._ts || null, rev, wid });
});

export default app;
