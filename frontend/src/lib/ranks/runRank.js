// RUN Rank — scoring engine for running performance.
//
// Score = distanceScore + milestoneScore + challengeBonus
//
// ── distanceScore ────────────────────────────────────────────────────────────
//   The primary driver. 2 pts per km run, no cap — every km you've ever run
//   accumulates. 100 km = 200 pts, 1 000 km = 2 000 pts.
//
// ── milestoneScore ───────────────────────────────────────────────────────────
//   Points for your personal best time at five canonical distances:
//   1K, 5K, 10K, Half Marathon, Marathon.
//   Faster = more points. Each distance has timed brackets; your best time
//   across all eligible runs determines which bracket you're in.
//   A run "covers" a distance if it is at least that long. The milestone time
//   is extrapolated from your average pace for that run:
//       time_at_dist = (durationSec / distanceKm) * distanceKm_milestone
//   This is a conservative approximation (assumes even pacing).
//
// ── challengeBonus ───────────────────────────────────────────────────────────
//   Flat bonus pts from completed challenges that apply to 'run' or 'all'.
import { tierForScore } from './tiers.js'
import { challengeBonusFor } from './challengeBonus.js'

// ── Milestone definitions ─────────────────────────────────────────────────────

export const RUN_MILESTONES = [
  {
    key: '1k',
    label: '1 K',
    distKm: 1,
    brackets: [
      { maxSec: 210,  pts: 300, label: 'Sub 3:30' },
      { maxSec: 240,  pts: 250, label: 'Sub 4:00' },
      { maxSec: 270,  pts: 200, label: 'Sub 4:30' },
      { maxSec: 300,  pts: 150, label: 'Sub 5:00' },
      { maxSec: 360,  pts: 100, label: 'Sub 6:00' },
      { maxSec: Infinity, pts: 50, label: 'Finished' },
    ],
  },
  {
    key: '5k',
    label: '5 K',
    distKm: 5,
    brackets: [
      { maxSec: 1050, pts: 500, label: 'Sub 17:30' },
      { maxSec: 1200, pts: 400, label: 'Sub 20:00' },
      { maxSec: 1350, pts: 300, label: 'Sub 22:30' },
      { maxSec: 1500, pts: 200, label: 'Sub 25:00' },
      { maxSec: 1800, pts: 150, label: 'Sub 30:00' },
      { maxSec: Infinity, pts: 100, label: 'Finished' },
    ],
  },
  {
    key: '10k',
    label: '10 K',
    distKm: 10,
    brackets: [
      { maxSec: 2250, pts: 600, label: 'Sub 37:30' },
      { maxSec: 2550, pts: 500, label: 'Sub 42:30' },
      { maxSec: 2850, pts: 400, label: 'Sub 47:30' },
      { maxSec: 3300, pts: 300, label: 'Sub 55:00' },
      { maxSec: 3900, pts: 200, label: 'Sub 65:00' },
      { maxSec: Infinity, pts: 150, label: 'Finished' },
    ],
  },
  {
    key: 'half',
    label: 'Half Marathon',
    distKm: 21.097,
    brackets: [
      { maxSec: 5400,  pts: 800, label: 'Sub 1:30' },
      { maxSec: 6300,  pts: 650, label: 'Sub 1:45' },
      { maxSec: 7200,  pts: 500, label: 'Sub 2:00' },
      { maxSec: 8100,  pts: 350, label: 'Sub 2:15' },
      { maxSec: 9000,  pts: 200, label: 'Sub 2:30' },
      { maxSec: Infinity, pts: 150, label: 'Finished' },
    ],
  },
  {
    key: 'marathon',
    label: 'Marathon',
    distKm: 42.195,
    brackets: [
      { maxSec: 10800, pts: 1200, label: 'Sub 3:00' },
      { maxSec: 12600, pts: 1000, label: 'Sub 3:30' },
      { maxSec: 14400, pts: 800,  label: 'Sub 4:00' },
      { maxSec: 16200, pts: 600,  label: 'Sub 4:30' },
      { maxSec: 18000, pts: 400,  label: 'Sub 5:00' },
      { maxSec: Infinity, pts: 300, label: 'Finished' },
    ],
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the best (fastest) extrapolated time in seconds for a given
 * milestone distance, across all runs that covered at least that distance.
 * Returns null if no qualifying run exists.
 */
export function bestTimeForDistance(runs, distKm) {
  let best = null
  for (const run of runs) {
    if ((run.distanceKm || 0) < distKm) continue
    const pace = run.durationSec / run.distanceKm           // sec/km
    const projected = Math.round(pace * distKm)
    if (best === null || projected < best) best = projected
  }
  return best
}

/**
 * Returns the bracket object (with pts and label) for a given time,
 * or null if the time is null (milestone not yet attempted).
 */
function bracketFor(brackets, timeSec) {
  if (timeSec === null) return null
  return brackets.find(b => timeSec <= b.maxSec) || brackets[brackets.length - 1]
}

// ── Score components ──────────────────────────────────────────────────────────

/** 2 pts per km of total lifetime distance. No cap — keeps every km meaningful. */
function distanceScore(runs) {
  const totalKm = runs.reduce((sum, r) => sum + (r.distanceKm || 0), 0)
  return Math.floor(totalKm * 2)
}

/**
 * Points for personal best times at each milestone distance.
 * Each milestone is independent — you can have a great 5K but never
 * run a half-marathon (those pts are simply not earned yet).
 */
function milestoneScore(runs) {
  let total = 0
  for (const milestone of RUN_MILESTONES) {
    const best = bestTimeForDistance(runs, milestone.distKm)
    const bracket = bracketFor(milestone.brackets, best)
    if (bracket) total += bracket.pts
  }
  return total
}

// ── Public API ────────────────────────────────────────────────────────────────

export function runRankScore(S) {
  if (!S) return 0
  const runs = S.runs || []
  return (
    distanceScore(runs) +
    milestoneScore(runs) +
    challengeBonusFor(S, 'run')
  )
}

export function runRankTier(score) {
  return tierForScore(score)
}

export function runRankBreakdown(S) {
  const runs = S.runs || []
  const totalKm = runs.reduce((sum, r) => sum + (r.distanceKm || 0), 0)
  const bonus = challengeBonusFor(S, 'run')

  const milestones = RUN_MILESTONES.map(m => {
    const best = bestTimeForDistance(runs, m.distKm)
    const bracket = bracketFor(m.brackets, best)
    return {
      key: m.key,
      label: m.label,
      distKm: m.distKm,
      bestSec: best,
      bracketLabel: bracket?.label || 'Not yet run',
      pts: bracket?.pts || 0,
      maxPts: m.brackets[0].pts,
    }
  })

  return {
    distance: {
      label: 'Total distance',
      score: distanceScore(runs),
      max: null,             // uncapped
      detail: `${totalKm.toFixed(1)} km`,
    },
    milestones: {
      label: 'Milestone times',
      score: milestoneScore(runs),
      max: RUN_MILESTONES.reduce((s, m) => s + m.brackets[0].pts, 0),
      items: milestones,
    },
    challenges: {
      label: 'Challenge bonuses',
      score: bonus,
      max: null,
    },
  }
}

// ── Run model helpers ─────────────────────────────────────────────────────────

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
  if (!secPerKm || secPerKm <= 0) return '--'
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
