// health-read.js — reads vitals, steps, distance, calories, clinical metrics,
// sleep, nutrition and exercise sessions from Health Connect on Android.
//
// ── What this reads ───────────────────────────────────────────────────────────
//
// Basic vitals (existing)
//   steps        Daily step count
//   distanceM    Daily distance in metres
//   calories     Active (exercise) calories burned
//   avgBpm/minBpm/maxBpm   Heart rate range for the day
//
// Extended clinical vitals (new)
//   restingBpm   Daily resting heart rate
//   hrvMs        Heart rate variability (RMSSD in ms)
//   spo2         Blood oxygen saturation (%)
//   respiratoryRate  Breaths per minute
//   vo2Max       VO2 Max (ml/kg/min) — uses a 90-day window
//   irregularRhythmAlert  true if a Fitbit/Pixel Watch AFib alert exists today
//   mood         Latest mood rating 1–5 (0 = none)
//
// Sleep (new)
//   sleep.startMs / endMs / durationMs
//   sleep.stages.lightMs / deepMs / remMs / awakeMs
//
// Nutrition from other apps (new, read-only summary)
//   hcNutrition.calories / protein / carbs / fat / fiber / sugar / saturatedFat / sodium / water
//
// Exercise sessions (existing — for auto-import of runs)
//
// ── Privacy ───────────────────────────────────────────────────────────────────
//  Off by default. The user must explicitly enable "Read from Health Connect"
//  in Settings. The full vitals object is cached locally in
//  opengym-health-read.json and never sent to the server.

import { MOBILE, isAndroid, readJsonFile, writeJsonFile } from './mobile.js'

export const HEALTH_READ_FILE = 'opengym-health-read.json'

const INITIAL = { on: false, grantedAt: null, lastReadAt: 0, vitals: {}, error: null }

let cached = null
async function loadRead() {
  if (cached) return cached
  const f = await readJsonFile(HEALTH_READ_FILE)
  cached = f && typeof f === 'object' ? { ...INITIAL, ...f } : { ...INITIAL }
  return cached
}
const saveRead = r => { cached = r; return writeJsonFile(HEALTH_READ_FILE, r) }

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
 * Prompts the user for all read permissions (basic + extended), then does an
 * initial read. Returns { ok, reason }.
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
 * Reads all available health data for today and hands results to onReady.
 * Returns { vitals, importedRuns }.
 *
 * Gracefully handles missing permissions or unavailable plugin methods: any
 * field that cannot be read is omitted from vitals (defaults to 0 / null in UI).
 */
export async function refreshVitals(onReady) {
  if (!MOBILE) return null
  const p = await plugin()
  if (!p) return null
  const h = await loadRead()
  if (!h.on) return null

  try {
    const today = todayBounds()
    // Sleep looks back 36 h to catch last night even if you wake after midnight.
    const sleepStart = today.start - 36 * 3600000

    // ── Basic daily vitals ────────────────────────────────────────────────────
    const daily = await p.HC.readDaily({ startMs: today.start, endMs: today.end })
    const vitals = {
      date:      todayISO(),
      steps:     daily.steps     || 0,
      distanceM: daily.distanceM || 0,
      calories:  Math.round(daily.calories || 0),
      avgBpm:    daily.avgBpm    || 0,
      minBpm:    daily.minBpm    || 0,
      maxBpm:    daily.maxBpm    || 0,
    }

    // ── Extended clinical vitals + sleep + nutrition (parallel, all optional) ─
    const [extR, sleepR, nutritionR] = await Promise.allSettled([
      p.HC.readExtendedVitals({ startMs: today.start, endMs: today.end }).catch(() => null),
      p.HC.readSleep({ startMs: sleepStart, endMs: today.end }).catch(() => null),
      p.HC.readNutrition({ startMs: today.start, endMs: today.end }).catch(() => null),
    ])

    const ext = extR.status === 'fulfilled' ? extR.value : null
    if (ext) {
      if (ext.restingBpm      > 0) vitals.restingBpm      = ext.restingBpm
      if (ext.hrvMs           > 0) vitals.hrvMs            = ext.hrvMs
      if (ext.spo2            > 0) vitals.spo2             = Math.round(ext.spo2 * 10) / 10
      if (ext.respiratoryRate > 0) vitals.respiratoryRate  = Math.round(ext.respiratoryRate * 10) / 10
      if (ext.vo2Max          > 0) vitals.vo2Max           = Math.round(ext.vo2Max * 10) / 10
      if (ext.irregularRhythmAlert) vitals.irregularRhythmAlert = true
      if (ext.mood            > 0) vitals.mood             = ext.mood
    }

    const sleepData = sleepR.status === 'fulfilled' ? sleepR.value : null
    if (sleepData?.sessions?.length) {
      // Use the longest session (usually the full night's sleep).
      const longest = sleepData.sessions.reduce((a, b) =>
        (b.endMs - b.startMs) > (a.endMs - a.startMs) ? b : a)
      vitals.sleep = {
        startMs:    longest.startMs,
        endMs:      longest.endMs,
        durationMs: longest.endMs - longest.startMs,
        stages:     longest.stages || {},
      }
    }

    const nutritionData = nutritionR.status === 'fulfilled' ? nutritionR.value : null
    if (nutritionData) vitals.hcNutrition = summarizeHCNutrition(nutritionData)

    // ── Exercise sessions from other apps (existing, for run import) ──────────
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

/** Returns cached sleep data without hitting Health Connect. */
export async function getCachedSleep() {
  const h = await loadRead()
  return h.vitals?.sleep || null
}

/** Returns cached extended clinical vitals (resting HR, HRV, SpO2, etc.). */
export async function getCachedExtendedVitals() {
  const h = await loadRead()
  const v = h.vitals || {}
  return {
    restingBpm:          v.restingBpm          || 0,
    hrvMs:               v.hrvMs               || 0,
    spo2:                v.spo2                || 0,
    respiratoryRate:     v.respiratoryRate      || 0,
    vo2Max:              v.vo2Max              || 0,
    irregularRhythmAlert: v.irregularRhythmAlert || false,
    mood:                v.mood                || 0,
  }
}

/** Returns nutrition data logged today by other HC apps. */
export async function getCachedHCNutrition() {
  const h = await loadRead()
  return h.vitals?.hcNutrition || null
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
 * Aggregates all nutrition records from other HC apps into a single daily summary.
 * The app's own meals (written back via health-sync.js) are excluded by clientRecordId
 * prefix on the native side; here we just sum what the plugin returns.
 */
function summarizeHCNutrition(data) {
  const keys = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'saturatedFat', 'sodium']
  const totals = Object.fromEntries([...keys, 'water'].map(k => [k, 0]))
  for (const n of data.nutrition || []) {
    for (const k of keys) if (n[k] > 0) totals[k] += n[k]
  }
  for (const h of data.hydration || []) {
    if (h.volumeMl > 0) totals.water += h.volumeMl
  }
  for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k])
  return totals
}

/**
 * Converts a Health Connect exercise session to an S.runs entry.
 * Deduplication: the HC session id is stored so we never import the same run twice.
 */
function hcSessionToRun(s) {
  const durationSec = Math.round((s.endMs - s.startMs) / 1000)
  if (durationSec < 60) return null
  const distanceKm = s.distanceM > 0 ? s.distanceM / 1000 : 0
  return {
    id:           'hc-' + s.id,
    date:         new Date(s.startMs).toISOString().slice(0, 10),
    distanceKm,
    durationSec,
    paceSecPerKm: distanceKm > 0 ? Math.round(durationSec / distanceKm) : 0,
    routePoints:  [],
    source:       s.source || 'health_connect',
    hcSessionId:  s.id,
    createdAt:    s.startMs,
  }
}

/**
 * Merges Health Connect imported runs into S.runs.
 * Existing runs with the same hcSessionId are not re-added.
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
 */
export function sourceLabel(pkg) {
  const map = {
    'com.google.android.apps.fitness':           'Google Fit',
    'com.strava':                                'Strava',
    'com.garmin.android.apps.connectmobile':     'Garmin Connect',
    'com.samsung.android.shealth':               'Samsung Health',
    'com.fitbit.FitbitMobile':                   'Fitbit',
    'com.nike.plusgps':                          'Nike Run Club',
    'com.adidas.runtastic':                      'Runtastic',
    'com.mapmyrun.android2':                     'MapMyRun',
    'com.under_armour.record':                   'MapMyRun',
    'com.polar.polarbeatapp':                    'Polar Beat',
    'com.withings.health':                       'Withings',
    'com.google.android.apps.wellbeing':         'Digital Wellbeing',
    'com.google.android.apps.healthdata':        'Health Connect',
  }
  return map[pkg] || 'Health Connect'
}
