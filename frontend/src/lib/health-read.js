// health-read.js — reads vitals, steps, distance, calories and exercise sessions
// from Health Connect on Android and pipes them into the app's state and rank scoring.
//
// ── What this reads ───────────────────────────────────────────────────────────
//
//  steps        Daily step count (from phone, watch, or any paired app)
//  distanceM    Daily distance in metres
//  calories     Active (exercise) calories burned — not BMR
//  avgBpm       Average heart rate across all HR samples for the day
//  minBpm/maxBpm Daily HR range
//
//  sessions     Exercise sessions logged in any app for the last 90 days.
//               Used to auto-import runs into S.runs so they contribute to
//               RUN Rank without the user having to start a run in this app.
//               openGym's own sessions are excluded to avoid duplicates.
//
// ── Privacy ───────────────────────────────────────────────────────────────────
//  Off by default. The user must explicitly enable "Read from Health Connect"
//  in Settings. Nothing is sent to the server — vitals are cached locally in
//  opengym-health-read.json, same as the write side uses opengym-health.json.
//
// ── Source apps ───────────────────────────────────────────────────────────────
//  Any app that writes to Health Connect contributes: Google Fit, Strava,
//  Garmin Connect, Samsung Health, Fitbit, Apple Health (via HC bridge), etc.
//  The source package name is stored on imported sessions so it can be shown
//  in the UI ("Imported from Strava").

import { MOBILE, isAndroid, readJsonFile, writeJsonFile } from './mobile.js'

export const HEALTH_READ_FILE = 'opengym-health-read.json'

const INITIAL = { on: false, grantedAt: null, lastReadAt: 0, vitals: {}, error: null }

// Cached state — same pattern as health-sync.js
let cached = null
async function loadRead() {
  if (cached) return cached
  const f = await readJsonFile(HEALTH_READ_FILE)
  cached = f && typeof f === 'object' ? { ...INITIAL, ...f } : { ...INITIAL }
  return cached
}
const saveRead = r => { cached = r; return writeJsonFile(HEALTH_READ_FILE, r) }

// Plugin proxy — same lazy-load pattern as health-sync.js
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  if (!(await isAndroid())) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { HC: registerPlugin('HealthConnect') }
})().catch(() => null))

// ── Status ────────────────────────────────────────────────────────────────────

/** Whether the read side is enabled and permissions are held. */
export async function healthReadStatus() {
  if (!MOBILE) return { supported: false, granted: false, on: false }
  const p = await plugin()
  if (!p) return { supported: false, granted: false, on: false }
  try {
    const st = await p.HC.statusRead()
    const h = await loadRead()
    return { supported: true, granted: !!st.granted, on: h.on && !!st.granted }
  } catch {
    return { supported: true, granted: false, on: false }
  }
}

// ── Enable / disable ──────────────────────────────────────────────────────────

/**
 * Prompts the user for the five read permissions, then does an initial read.
 * Returns { ok, reason }.
 */
export async function enableHealthRead(onVitalsReady) {
  const p = await plugin()
  if (!p) return { ok: false, reason: 'unsupported' }
  try {
    const st = await p.HC.statusRead()
    const granted = st.granted || (await p.HC.requestReadPermissions().catch(() => ({ granted: false }))).granted
    if (!granted) return { ok: false, reason: 'denied' }
    const h = await loadRead()
    await saveRead({ ...h, on: true, grantedAt: Date.now(), error: null })
    await refreshVitals(onVitalsReady)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e?.code || 'failed' }
  }
}

/** Turns off reading. Does not remove any data from Health Connect. */
export async function disableHealthRead() {
  const h = await loadRead()
  await saveRead({ ...h, on: false })
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Reads today's vitals + the last 90 days of exercise sessions from Health Connect.
 * Returns { vitals, importedRuns } and calls onReady(result) when done.
 *
 * vitals:       { steps, distanceM, calories, avgBpm, minBpm, maxBpm, date }
 * importedRuns: Run objects ready to merge into S.runs
 */
export async function refreshVitals(onReady) {
  if (!MOBILE) return null
  const p = await plugin()
  if (!p) return null
  const h = await loadRead()
  if (!h.on) return null

  try {
    const today = todayBounds()

    // ── Today's vitals ────────────────────────────────────────────────────────
    const daily = await p.HC.readDaily({ startMs: today.start, endMs: today.end })
    const vitals = {
      date:       todayISO(),
      steps:      daily.steps     || 0,
      distanceM:  daily.distanceM || 0,
      calories:   Math.round(daily.calories || 0),
      avgBpm:     daily.avgBpm    || 0,
      minBpm:     daily.minBpm    || 0,
      maxBpm:     daily.maxBpm    || 0,
    }

    // ── Exercise sessions from other apps ─────────────────────────────────────
    const ninety = Date.now() - 90 * 86400000
    const sessResp = await p.HC.readExerciseSessions({ startMs: ninety, endMs: Date.now() })
    const importedRuns = (sessResp.sessions || [])
      .filter(s => RUNNING_TYPES.has(s.type))
      .map(s => hcSessionToRun(s))
      .filter(Boolean)

    const out = { vitals, importedRuns }
    const next = { ...h, lastReadAt: Date.now(), vitals, error: null }
    await saveRead(next)
    if (onReady) onReady(out)
    return out
  } catch (e) {
    const next = { ...h, error: e?.code === 'permission' ? 'permission' : 'failed' }
    await saveRead(next)
    return null
  }
}

/** Returns the cached vitals without hitting Health Connect. */
export async function getCachedVitals() {
  const h = await loadRead()
  return h.vitals || null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RUNNING_TYPES = new Set(['running', 'walking', 'hiking', 'biking'])

function todayBounds() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime()
  return { start, end: now.getTime() }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Converts a Health Connect exercise session to an S.runs entry.
 * Deduplication: the HC session id is stored so we never import the same run twice.
 */
function hcSessionToRun(s) {
  const durationSec = Math.round((s.endMs - s.startMs) / 1000)
  if (durationSec < 60) return null
  // distanceM may be 0 for sessions that didn't track GPS (e.g. a treadmill run)
  const distanceKm = s.distanceM > 0 ? s.distanceM / 1000 : 0
  return {
    id:          'hc-' + s.id,          // prefix to distinguish from GPS runs
    date:        new Date(s.startMs).toISOString().slice(0, 10),
    distanceKm,
    durationSec,
    paceSecPerKm: distanceKm > 0 ? Math.round(durationSec / distanceKm) : 0,
    routePoints: [],
    source:       s.source || 'health_connect',  // package name of origin app
    hcSessionId:  s.id,
    createdAt:    s.startMs,
  }
}

/**
 * Merges Health Connect imported runs into S.runs.
 * Existing runs with the same hcSessionId are not re-added.
 * Returns the updated runs array (or the original if nothing changed).
 */
export function mergeImportedRuns(existing, importedRuns) {
  if (!importedRuns?.length) return existing
  const knownIds = new Set(existing.map(r => r.hcSessionId).filter(Boolean))
  const fresh = importedRuns.filter(r => !knownIds.has(r.hcSessionId))
  if (!fresh.length) return existing
  return [...existing, ...fresh]
}

/**
 * Friendly display name for a source app package name.
 * Shown as "Imported from Strava" etc.
 */
export function sourceLabel(pkg) {
  const map = {
    'com.google.android.apps.fitness':   'Google Fit',
    'com.strava':                        'Strava',
    'com.garmin.android.apps.connectmobile': 'Garmin Connect',
    'com.samsung.android.shealth':       'Samsung Health',
    'com.fitbit.FitbitMobile':           'Fitbit',
    'com.nike.plusgps':                  'Nike Run Club',
    'com.adidas.runtastic':              'Runtastic',
    'com.mapmyrun.android2':             'MapMyRun',
    'com.under_armour.record':           'MapMyRun',
  }
  return map[pkg] || 'Health Connect'
}
