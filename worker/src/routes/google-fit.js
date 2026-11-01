// Google Fit API integration routes.
// Fetches fitness data from Google Fit API and handles token refresh.
import { Hono } from 'hono';
import { getSession } from './auth.js';
import { createLogger } from '../lib/logger.js';
import {
  getUserById, updateGoogleTokens, setGoogleFitEnabled,
  updateGoogleFitLastSync, unlinkGoogleAccount,
} from '../db/queries.js';

const log = createLogger('google-fit');

// ── Google API constants ──────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_FIT_BASE = 'https://www.googleapis.com/fitness/v1/users/me';

// Data source IDs for common fitness data
const DATA_SOURCES = {
  steps: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps',
  calories: 'derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended',
  distance: 'derived:com.google.distance.delta:com.google.android.gms:merge_distance_delta',
  heartRate: 'derived:com.google.heart_rate.bpm:com.google.android.gms:merge_heart_rate_bpm',
  weight: 'derived:com.google.weight:com.google.android.gms:merge_weight',
};

// ── Helper functions ──────────────────────────────────────────────────────────

async function refreshAccessToken(env, user) {
  if (!user.google_refresh_token) {
    return null;
  }

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: user.google_refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log.warn(env, 'token refresh failed', { status: res.status, error: err });
      return null;
    }

    const tokens = await res.json();
    const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;

    await updateGoogleTokens(env.DB, user.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token, // May be null if not returned
      expires_at: expiresAt,
    });

    log.debug(env, 'token refreshed', { userId: user.id });
    return tokens.access_token;
  } catch (e) {
    log.error(env, 'token refresh error', { error: e.message });
    return null;
  }
}

async function getValidAccessToken(env, user) {
  // Check if current token is still valid (with 5 min buffer)
  if (user.google_access_token && user.google_token_expires > Date.now() + 300000) {
    return user.google_access_token;
  }

  // Try to refresh
  return refreshAccessToken(env, user);
}

async function fitFetch(env, user, path, options = {}) {
  const accessToken = await getValidAccessToken(env, user);
  if (!accessToken) {
    return { error: 'no-valid-token', status: 401 };
  }

  const url = `${GOOGLE_FIT_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown error');
    log.warn(env, 'Google Fit API error', { path, status: res.status, error: err });
    return { error: 'api-error', status: res.status, message: err };
  }

  return res.json();
}

// Aggregate data from Google Fit for a date range
async function aggregateData(env, user, dataTypeName, startMs, endMs) {
  const body = {
    aggregateBy: [{ dataTypeName }],
    bucketByTime: { durationMillis: 86400000 }, // Daily buckets
    startTimeMillis: startMs,
    endTimeMillis: endMs,
  };

  return fitFetch(env, user, '/dataset:aggregate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono();

// GET /api/fitness/google/status
// Returns Google Fit connection status for the current user.
app.get('/api/fitness/google/status', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;

  return c.json({
    connected: !!user.google_id,
    fit_enabled: !!user.google_fit_enabled,
    last_sync: user.google_fit_last_sync || null,
    has_refresh_token: !!user.google_refresh_token,
  });
});

// POST /api/fitness/google/sync
// Fetch and return fitness data from Google Fit.
app.post('/api/fitness/google/sync', async (c) => {
  const env = c.env;
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  // Re-fetch user to get latest tokens
  const user = await getUserById(env.DB, session.user.id);
  if (!user) return c.json({ error: 'user not found' }, 404);

  if (!user.google_fit_enabled) {
    return c.json({ error: 'Google Fit not enabled', code: 'not-enabled' }, 400);
  }

  if (!user.google_access_token) {
    return c.json({ error: 'Google account not connected', code: 'not-connected' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));

  // Default to last 7 days
  const now = Date.now();
  const startMs = body.start_ms || now - 7 * 86400000;
  const endMs = body.end_ms || now;

  log.debug(env, 'syncing Google Fit data', { userId: user.id, startMs, endMs });

  try {
    // Fetch steps data
    const stepsData = await aggregateData(env, user, 'com.google.step_count.delta', startMs, endMs);
    if (stepsData.error) {
      return c.json({ error: 'Failed to fetch steps', details: stepsData }, stepsData.status || 500);
    }

    // Fetch calories data
    const caloriesData = await aggregateData(env, user, 'com.google.calories.expended', startMs, endMs);

    // Fetch distance data
    const distanceData = await aggregateData(env, user, 'com.google.distance.delta', startMs, endMs);

    // Update last sync time
    const now_iso = new Date().toISOString();
    await updateGoogleFitLastSync(env.DB, user.id, now_iso);

    // Parse and format the response
    const steps = parseAggregateData(stepsData, 'intVal');
    const calories = parseAggregateData(caloriesData, 'fpVal');
    const distance = parseAggregateData(distanceData, 'fpVal');

    log.info(env, 'Google Fit sync completed', { userId: user.id, days: steps.length });

    return c.json({
      ok: true,
      last_sync: now_iso,
      data: {
        steps,
        calories,
        distance,
      },
    });
  } catch (e) {
    log.error(env, 'Google Fit sync error', { error: e.message });
    return c.json({ error: 'Sync failed', details: e.message }, 500);
  }
});

// GET /api/fitness/google/steps
// Get step count for a date range.
app.get('/api/fitness/google/steps', async (c) => {
  const env = c.env;
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const user = await getUserById(env.DB, session.user.id);
  if (!user) return c.json({ error: 'user not found' }, 404);

  if (!user.google_fit_enabled || !user.google_access_token) {
    return c.json({ error: 'Google Fit not enabled', code: 'not-enabled' }, 400);
  }

  const url = new URL(c.req.url);
  const now = Date.now();
  const startMs = parseInt(url.searchParams.get('start') || String(now - 7 * 86400000), 10);
  const endMs = parseInt(url.searchParams.get('end') || String(now), 10);

  const data = await aggregateData(env, user, 'com.google.step_count.delta', startMs, endMs);
  if (data.error) {
    return c.json({ error: 'Failed to fetch steps', details: data }, data.status || 500);
  }

  const steps = parseAggregateData(data, 'intVal');
  return c.json({ ok: true, steps });
});

// GET /api/fitness/google/workouts
// Get workout/activity sessions from Google Fit.
app.get('/api/fitness/google/workouts', async (c) => {
  const env = c.env;
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const user = await getUserById(env.DB, session.user.id);
  if (!user) return c.json({ error: 'user not found' }, 404);

  if (!user.google_fit_enabled || !user.google_access_token) {
    return c.json({ error: 'Google Fit not enabled', code: 'not-enabled' }, 400);
  }

  const url = new URL(c.req.url);
  const now = Date.now();
  const startMs = parseInt(url.searchParams.get('start') || String(now - 7 * 86400000), 10);
  const endMs = parseInt(url.searchParams.get('end') || String(now), 10);

  // Get sessions (workouts) from Google Fit
  const sessionsData = await fitFetch(env, user, `/sessions?startTime=${new Date(startMs).toISOString()}&endTime=${new Date(endMs).toISOString()}`);

  if (sessionsData.error) {
    return c.json({ error: 'Failed to fetch workouts', details: sessionsData }, sessionsData.status || 500);
  }

  const workouts = (sessionsData.session || []).map(s => ({
    id: s.id,
    name: s.name || 'Workout',
    description: s.description || null,
    activity_type: s.activityType,
    start_time: new Date(parseInt(s.startTimeMillis, 10)).toISOString(),
    end_time: new Date(parseInt(s.endTimeMillis, 10)).toISOString(),
    duration_ms: parseInt(s.endTimeMillis, 10) - parseInt(s.startTimeMillis, 10),
  }));

  return c.json({ ok: true, workouts });
});

// POST /api/fitness/google/enable
// Enable Google Fit sync (requires user to have Google account linked with fit scopes).
app.post('/api/fitness/google/enable', async (c) => {
  const env = c.env;
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const user = await getUserById(env.DB, session.user.id);
  if (!user) return c.json({ error: 'user not found' }, 404);

  if (!user.google_id) {
    return c.json({ error: 'Google account not linked', code: 'not-linked' }, 400);
  }

  await setGoogleFitEnabled(env.DB, user.id, true);
  log.info(env, 'Google Fit enabled', { userId: user.id });

  return c.json({ ok: true, fit_enabled: true });
});

// POST /api/fitness/google/disconnect
// Disconnect Google Fit (removes tokens and disables sync).
app.post('/api/fitness/google/disconnect', async (c) => {
  const env = c.env;
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const { user } = session;

  await unlinkGoogleAccount(env.DB, user.id);
  log.info(env, 'Google account disconnected', { userId: user.id });

  return c.json({ ok: true });
});

// ── Data parsing helpers ──────────────────────────────────────────────────────

function parseAggregateData(data, valueField) {
  if (!data.bucket) return [];

  return data.bucket.map(bucket => {
    const startMs = parseInt(bucket.startTimeMillis, 10);
    const date = new Date(startMs).toISOString().split('T')[0];

    let value = 0;
    if (bucket.dataset?.[0]?.point) {
      for (const point of bucket.dataset[0].point) {
        if (point.value?.[0]?.[valueField] !== undefined) {
          value += point.value[0][valueField];
        }
      }
    }

    return { date, value: Math.round(value * 100) / 100 };
  });
}

export default app;
