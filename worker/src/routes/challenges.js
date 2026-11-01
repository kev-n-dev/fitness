// Friend challenges: beat PR, workout count, time-limited competitions.
import { Hono } from 'hono';
import { getSession } from './auth.js';
import { createLogger } from '../lib/logger.js';
import {
  getUserById,
  getFriendship,
  createChallenge,
  getChallengeById,
  getChallengesByUser,
  updateChallengeStatus,
  getChallengeProgress,
  updateChallengeProgress,
  getActiveChallenges,
  getPendingChallenges,
  createNotification, isNotificationTypeEnabled,
} from '../db/queries.js';

const log = createLogger('challenges');

// Generate a random id (base64url)
function genId(n = 12) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Valid challenge types
const CHALLENGE_TYPES = ['beat_pr', 'workout_count', 'timed'];
const METRICS = ['weight', 'reps', 'both', 'count'];

const app = new Hono();

// ── POST /api/challenges — create a new challenge ─────────────────────────────

app.post('/api/challenges', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const body = await c.req.json().catch(() => ({}));
  const { opponentId, type, exerciseId, targetValue, metric, endDate } = body;

  // Validation
  if (!opponentId) {
    return c.json({ error: 'opponentId required' }, 400);
  }
  if (!type || !CHALLENGE_TYPES.includes(type)) {
    return c.json({ error: 'type must be beat_pr, workout_count, or timed' }, 400);
  }
  if (type === 'beat_pr' && !exerciseId) {
    return c.json({ error: 'exerciseId required for beat_pr challenges' }, 400);
  }
  if (targetValue == null || typeof targetValue !== 'number' || targetValue <= 0) {
    return c.json({ error: 'targetValue must be a positive number' }, 400);
  }
  if (metric && !METRICS.includes(metric)) {
    return c.json({ error: 'metric must be weight, reps, both, or count' }, 400);
  }

  if (opponentId === session.user.id) {
    return c.json({ error: 'cannot challenge yourself' }, 400);
  }

  // Check opponent exists
  const opponent = await getUserById(c.env.DB, opponentId);
  if (!opponent) {
    return c.json({ error: 'opponent not found' }, 404);
  }

  // Check friendship exists
  const friendship = await getFriendship(c.env.DB, session.user.id, opponentId);
  if (!friendship) {
    return c.json({ error: 'you can only challenge friends' }, 403);
  }

  const now = new Date().toISOString();
  const challenge = {
    id: genId(),
    creator_id: session.user.id,
    opponent_id: opponentId,
    type,
    exercise_id: exerciseId || null,
    target_value: targetValue,
    metric: metric || (type === 'workout_count' ? 'count' : 'weight'),
    start_date: now,
    end_date: endDate || null,
    status: 'pending',
    winner_id: null,
    created: now,
    updated: now,
  };

  await createChallenge(c.env.DB, challenge);

  // Initialize progress for both participants at 0
  await updateChallengeProgress(c.env.DB, challenge.id, session.user.id, 0);
  await updateChallengeProgress(c.env.DB, challenge.id, opponentId, 0);

  log.info(c.env, 'challenge created', { 
    id: challenge.id, 
    creator: session.user.id, 
    opponent: opponentId, 
    type 
  });

  // Notify the opponent about the challenge
  const enabled = await isNotificationTypeEnabled(c.env.DB, opponentId, 'challenge_received');
  if (enabled) {
    await createNotification(c.env.DB, {
      user_id: opponentId,
      type: 'challenge_received',
      title: 'New Challenge',
      body: `${session.user.name} challenged you!`,
      data: JSON.stringify({ challengeId: challenge.id, creatorId: session.user.id, creatorName: session.user.name, type }),
      created: now,
    });
  }

  return c.json({
    id: challenge.id,
    creator: { id: session.user.id, name: session.user.name },
    opponent: { id: opponent.id, name: opponent.name },
    type: challenge.type,
    exerciseId: challenge.exercise_id,
    targetValue: challenge.target_value,
    metric: challenge.metric,
    startDate: challenge.start_date,
    endDate: challenge.end_date,
    status: challenge.status,
    created: challenge.created,
  });
});

// ── GET /api/challenges — list challenges by status ───────────────────────────

app.get('/api/challenges', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const status = c.req.query('status') || null;
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));

  const challenges = await getChallengesByUser(c.env.DB, session.user.id, { status, limit });

  const items = challenges.map(ch => ({
    id: ch.id,
    creator: { id: ch.creator_id, name: ch.creator_name },
    opponent: { id: ch.opponent_id, name: ch.opponent_name },
    type: ch.type,
    exerciseId: ch.exercise_id,
    targetValue: ch.target_value,
    metric: ch.metric,
    startDate: ch.start_date,
    endDate: ch.end_date,
    status: ch.status,
    winner: ch.winner_id ? { id: ch.winner_id, name: ch.winner_name } : null,
    created: ch.created,
  }));

  return c.json({ challenges: items });
});

// ── GET /api/challenges/pending — challenges awaiting user's acceptance ───────

app.get('/api/challenges/pending', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const challenges = await getPendingChallenges(c.env.DB, session.user.id);

  const items = challenges.map(ch => ({
    id: ch.id,
    creator: { id: ch.creator_id, name: ch.creator_name },
    type: ch.type,
    exerciseId: ch.exercise_id,
    targetValue: ch.target_value,
    metric: ch.metric,
    endDate: ch.end_date,
    created: ch.created,
  }));

  return c.json({ challenges: items });
});

// ── GET /api/challenges/active — currently running challenges ─────────────────

app.get('/api/challenges/active', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const challenges = await getActiveChallenges(c.env.DB, session.user.id);

  // Get progress for each challenge
  const items = await Promise.all(challenges.map(async (ch) => {
    const progress = await getChallengeProgress(c.env.DB, ch.id);
    const progressMap = {};
    for (const p of progress) {
      progressMap[p.user_id] = {
        userId: p.user_id,
        userName: p.user_name,
        currentValue: p.current_value,
        bestAttemptDate: p.best_attempt_date,
      };
    }
    return {
      id: ch.id,
      creator: { id: ch.creator_id, name: ch.creator_name },
      opponent: { id: ch.opponent_id, name: ch.opponent_name },
      type: ch.type,
      exerciseId: ch.exercise_id,
      targetValue: ch.target_value,
      metric: ch.metric,
      startDate: ch.start_date,
      endDate: ch.end_date,
      status: ch.status,
      progress: progressMap,
      created: ch.created,
    };
  }));

  return c.json({ challenges: items });
});

// ── GET /api/challenges/:id — get a single challenge ──────────────────────────

app.get('/api/challenges/:id', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const challengeId = c.req.param('id');
  const challenge = await getChallengeById(c.env.DB, challengeId);

  if (!challenge) {
    return c.json({ error: 'challenge not found' }, 404);
  }

  // Only participants can view
  if (challenge.creator_id !== session.user.id && challenge.opponent_id !== session.user.id) {
    return c.json({ error: 'not authorized' }, 403);
  }

  const creator = await getUserById(c.env.DB, challenge.creator_id);
  const opponent = await getUserById(c.env.DB, challenge.opponent_id);
  const progress = await getChallengeProgress(c.env.DB, challengeId);

  const progressMap = {};
  for (const p of progress) {
    progressMap[p.user_id] = {
      userId: p.user_id,
      userName: p.user_name,
      currentValue: p.current_value,
      bestAttemptDate: p.best_attempt_date,
    };
  }

  return c.json({
    id: challenge.id,
    creator: { id: creator.id, name: creator.name },
    opponent: { id: opponent.id, name: opponent.name },
    type: challenge.type,
    exerciseId: challenge.exercise_id,
    targetValue: challenge.target_value,
    metric: challenge.metric,
    startDate: challenge.start_date,
    endDate: challenge.end_date,
    status: challenge.status,
    winner: challenge.winner_id ? { id: challenge.winner_id } : null,
    progress: progressMap,
    created: challenge.created,
    updated: challenge.updated,
  });
});

// ── POST /api/challenges/:id/accept — accept a challenge ──────────────────────

app.post('/api/challenges/:id/accept', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const challengeId = c.req.param('id');
  const challenge = await getChallengeById(c.env.DB, challengeId);

  if (!challenge) {
    return c.json({ error: 'challenge not found' }, 404);
  }

  if (challenge.opponent_id !== session.user.id) {
    return c.json({ error: 'only the challenged user can accept' }, 403);
  }

  if (challenge.status !== 'pending') {
    return c.json({ error: 'challenge is not pending' }, 400);
  }

  await updateChallengeStatus(c.env.DB, challengeId, 'active');

  log.info(c.env, 'challenge accepted', { id: challengeId, userId: session.user.id });

  // Notify the creator that their challenge was accepted
  const enabled = await isNotificationTypeEnabled(c.env.DB, challenge.creator_id, 'challenge_accepted');
  if (enabled) {
    await createNotification(c.env.DB, {
      user_id: challenge.creator_id,
      type: 'challenge_accepted',
      title: 'Challenge Accepted',
      body: `${session.user.name} accepted your challenge!`,
      data: JSON.stringify({ challengeId, opponentId: session.user.id, opponentName: session.user.name }),
      created: new Date().toISOString(),
    });
  }

  return c.json({ ok: true, status: 'active' });
});

// ── POST /api/challenges/:id/decline — decline a challenge ────────────────────

app.post('/api/challenges/:id/decline', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const challengeId = c.req.param('id');
  const challenge = await getChallengeById(c.env.DB, challengeId);

  if (!challenge) {
    return c.json({ error: 'challenge not found' }, 404);
  }

  if (challenge.opponent_id !== session.user.id) {
    return c.json({ error: 'only the challenged user can decline' }, 403);
  }

  if (challenge.status !== 'pending') {
    return c.json({ error: 'challenge is not pending' }, 400);
  }

  await updateChallengeStatus(c.env.DB, challengeId, 'declined');

  log.info(c.env, 'challenge declined', { id: challengeId, userId: session.user.id });

  // Notify the creator that their challenge was declined
  const enabled = await isNotificationTypeEnabled(c.env.DB, challenge.creator_id, 'challenge_declined');
  if (enabled) {
    await createNotification(c.env.DB, {
      user_id: challenge.creator_id,
      type: 'challenge_declined',
      title: 'Challenge Declined',
      body: `${session.user.name} declined your challenge`,
      data: JSON.stringify({ challengeId, opponentId: session.user.id, opponentName: session.user.name }),
      created: new Date().toISOString(),
    });
  }

  return c.json({ ok: true, status: 'declined' });
});

// ── GET /api/challenges/:id/progress — get progress for a challenge ───────────

app.get('/api/challenges/:id/progress', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const challengeId = c.req.param('id');
  const challenge = await getChallengeById(c.env.DB, challengeId);

  if (!challenge) {
    return c.json({ error: 'challenge not found' }, 404);
  }

  // Only participants can view progress
  if (challenge.creator_id !== session.user.id && challenge.opponent_id !== session.user.id) {
    return c.json({ error: 'not authorized' }, 403);
  }

  const progress = await getChallengeProgress(c.env.DB, challengeId);

  const items = progress.map(p => ({
    userId: p.user_id,
    userName: p.user_name,
    currentValue: p.current_value,
    bestAttemptDate: p.best_attempt_date,
    updated: p.updated,
  }));

  // Check if challenge should be completed
  let winner = null;
  if (challenge.status === 'active') {
    // Check if end date passed
    const now = new Date();
    const endDate = challenge.end_date ? new Date(challenge.end_date) : null;

    if (endDate && now > endDate) {
      // Time's up - determine winner by highest progress
      const sorted = [...progress].sort((a, b) => b.current_value - a.current_value);
      if (sorted.length >= 2 && sorted[0].current_value > sorted[1].current_value) {
        winner = { id: sorted[0].user_id, name: sorted[0].user_name };
        await updateChallengeStatus(c.env.DB, challengeId, 'completed', sorted[0].user_id);
        // Notify winner and loser
        const loserId = sorted[1].user_id;
        const winnerEnabled = await isNotificationTypeEnabled(c.env.DB, sorted[0].user_id, 'challenge_won');
        if (winnerEnabled) {
          await createNotification(c.env.DB, {
            user_id: sorted[0].user_id,
            type: 'challenge_won',
            title: 'Challenge Won!',
            body: `You won the challenge against ${sorted[1].user_name}!`,
            data: JSON.stringify({ challengeId, opponentId: loserId, opponentName: sorted[1].user_name }),
            created: now.toISOString(),
          });
        }
        const loserEnabled = await isNotificationTypeEnabled(c.env.DB, loserId, 'challenge_lost');
        if (loserEnabled) {
          await createNotification(c.env.DB, {
            user_id: loserId,
            type: 'challenge_lost',
            title: 'Challenge Ended',
            body: `${sorted[0].user_name} won the challenge`,
            data: JSON.stringify({ challengeId, winnerId: sorted[0].user_id, winnerName: sorted[0].user_name }),
            created: now.toISOString(),
          });
        }
      } else if (sorted.length >= 2) {
        // Tie - no winner
        await updateChallengeStatus(c.env.DB, challengeId, 'completed', null);
      }
    } else {
      // Check if anyone reached target
      for (const p of progress) {
        if (p.current_value >= challenge.target_value) {
          winner = { id: p.user_id, name: p.user_name };
          await updateChallengeStatus(c.env.DB, challengeId, 'completed', p.user_id);
          // Notify winner and loser
          const loserId = p.user_id === challenge.creator_id ? challenge.opponent_id : challenge.creator_id;
          const loser = progress.find(pr => pr.user_id === loserId);
          const winnerEnabled = await isNotificationTypeEnabled(c.env.DB, p.user_id, 'challenge_won');
          if (winnerEnabled) {
            await createNotification(c.env.DB, {
              user_id: p.user_id,
              type: 'challenge_won',
              title: 'Challenge Won!',
              body: `You reached the target first!`,
              data: JSON.stringify({ challengeId, opponentId: loserId, opponentName: loser?.user_name }),
              created: new Date().toISOString(),
            });
          }
          const loserEnabled = await isNotificationTypeEnabled(c.env.DB, loserId, 'challenge_lost');
          if (loserEnabled) {
            await createNotification(c.env.DB, {
              user_id: loserId,
              type: 'challenge_lost',
              title: 'Challenge Ended',
              body: `${p.user_name} reached the target first`,
              data: JSON.stringify({ challengeId, winnerId: p.user_id, winnerName: p.user_name }),
              created: new Date().toISOString(),
            });
          }
          break;
        }
      }
    }
  }

  return c.json({
    challengeId,
    status: challenge.status,
    targetValue: challenge.target_value,
    progress: items,
    winner,
  });
});

export default app;
