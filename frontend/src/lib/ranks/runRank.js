// RUN Rank — scoring engine for running and cardio performance.
//
// Points are awarded for:
//   • Total distance run (km or miles, normalised to km)
//   • Run consistency   (number of runs logged)
//   • Personal records  (fastest pace per distance bracket)
//   • Challenges        (completed run challenges)
//   • Territory         (GPS areas covered — shared with TerritoryRank)
import { tierForScore } from './tiers.js'

export function runRankScore(S) {
  if (!S) return 0
  const runs = S.runs || []
  return (
    distanceScore(runs) +
    runConsistencyScore(runs) +
    pacePrScore(runs)
  )
}

export function runRankTier(score) {
  return tierForScore(score)
}

// ── Sub-scores ───────────────────────────────────────────────────────────────

/** 1 pt per km run, capped at 5000 pts. */
function distanceScore(runs) {
  const totalKm = runs.reduce((sum, r) => sum + (r.distanceKm || 0), 0)
  return Math.min(5000, Math.floor(totalKm))
}

/** 10 pts per run logged, capped at 2000 pts. */
function runConsistencyScore(runs) {
  return Math.min(2000, runs.length * 10)
}

/**
 * Pace PR score: 100 pts for each distance bracket where the user has run
 * at least once. Brackets: 1K, 5K, 10K, half-marathon, marathon.
 */
function pacePrScore(runs) {
  const brackets = [1, 5, 10, 21.1, 42.2]
  let score = 0
  for (const bracket of brackets) {
    if (runs.some(r => (r.distanceKm || 0) >= bracket)) score += 100
  }
  return score
}

// ── Breakdown ────────────────────────────────────────────────────────────────

export function runRankBreakdown(S) {
  const runs = S.runs || []
  return {
    distance:    { label: 'Total distance',   score: distanceScore(runs),        max: 5000 },
    consistency: { label: 'Run consistency',  score: runConsistencyScore(runs),  max: 2000 },
    prs:         { label: 'Distance PRs',     score: pacePrScore(runs),          max: 500  },
  }
}

// ── Run model helpers ────────────────────────────────────────────────────────

/** Creates a new run activity object ready for state. */
export function newRun({ distanceKm, durationSec, routePoints = [], date }) {
  return {
    id: crypto.randomUUID(),
    date: date || new Date().toISOString().slice(0, 10),
    distanceKm,
    durationSec,
    paceSecPerKm: distanceKm > 0 ? Math.round(durationSec / distanceKm) : 0,
    routePoints, // [{lat, lng, t}]
    createdAt: Date.now(),
  }
}

/** Formats pace as mm:ss /km. */
export function formatPace(secPerKm) {
  if (!secPerKm || secPerKm <= 0) return '—'
  const mins = Math.floor(secPerKm / 60)
  const secs = secPerKm % 60
  return `${mins}:${String(secs).padStart(2, '0')} /km`
}

/** Formats a duration in seconds as h:mm:ss or mm:ss. */
export function formatDuration(sec) {
  if (!sec) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
