// REP Rank — scoring engine for strength training performance.
//
// Points are awarded for:
//   • Workout consistency  (showing up regularly)
//   • Progressive overload (increasing weight/reps over time)
//   • Volume milestones    (total tonnage lifted)
//   • Personal records     (new 1RM / top-set bests)
//   • Workout streak       (consecutive weeks with sessions)
//
// Users are segmented into categories so beginners don't compete directly
// against advanced lifters. Category is derived from total workout count
// and estimated training age.
import { tierForScore } from './tiers.js'

// ── Category thresholds ──────────────────────────────────────────────────────

export const REP_CATEGORIES = {
  beginner:     { label: 'Beginner',     minWorkouts: 0,   maxWorkouts: 49 },
  intermediate: { label: 'Intermediate', minWorkouts: 50,  maxWorkouts: 199 },
  advanced:     { label: 'Advanced',     minWorkouts: 200, maxWorkouts: 499 },
  elite:        { label: 'Elite',        minWorkouts: 500, maxWorkouts: Infinity },
}

export function repCategoryOf(S) {
  const count = (S.workouts || []).length
  if (count >= 500) return 'elite'
  if (count >= 200) return 'advanced'
  if (count >= 50)  return 'intermediate'
  return 'beginner'
}

// ── Score calculation ────────────────────────────────────────────────────────

/**
 * Returns the total REP Rank score for a user's state.
 * All sub-scores are additive; each is capped to avoid runaway accumulation.
 */
export function repRankScore(S) {
  if (!S) return 0
  return (
    consistencyScore(S) +
    volumeScore(S) +
    prScore(S) +
    streakBonus(S)
  )
}

export function repRankTier(score) {
  return tierForScore(score)
}

// ── Sub-scores ───────────────────────────────────────────────────────────────

/** 5 pts per completed workout, capped at 2000 pts. */
function consistencyScore(S) {
  return Math.min(2000, (S.workouts || []).length * 5)
}

/**
 * Volume score: points for total sets logged across all workouts.
 * 1 pt per set, capped at 5000 pts.
 */
function volumeScore(S) {
  let totalSets = 0
  for (const workout of S.workouts || []) {
    for (const entry of workout.entries || []) {
      totalSets += (entry.sets || []).filter(s => s?.done).length
    }
  }
  return Math.min(5000, totalSets)
}

/**
 * PR score: 50 pts per unique exercise that has at least one logged set.
 * Proxy for breadth of training; capped at 3000 pts.
 */
function prScore(S) {
  const exercisesWithSets = new Set()
  for (const workout of S.workouts || []) {
    for (const entry of workout.entries || []) {
      if ((entry.sets || []).some(s => s?.done)) {
        exercisesWithSets.add(entry.id)
      }
    }
  }
  return Math.min(3000, exercisesWithSets.size * 50)
}

/**
 * Streak bonus: 20 pts per consecutive week with at least one workout.
 * Capped at 2000 pts (100 consecutive weeks).
 */
function streakBonus(S) {
  if (!(S.workouts || []).length) return 0
  // Build a set of ISO week strings that had a workout
  const weeksWithWorkouts = new Set()
  for (const w of S.workouts) {
    const d = new Date(w.d)
    const monday = new Date(d)
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    weeksWithWorkouts.add(monday.toISOString().slice(0, 10))
  }
  // Count consecutive weeks ending today
  let streak = 0
  const today = new Date()
  const cursor = new Date(today)
  cursor.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  while (weeksWithWorkouts.has(cursor.toISOString().slice(0, 10))) {
    streak++
    cursor.setDate(cursor.getDate() - 7)
  }
  return Math.min(2000, streak * 20)
}

// ── Score breakdown (for the detail view) ───────────────────────────────────

export function repRankBreakdown(S) {
  return {
    consistency: { label: 'Workout consistency', score: consistencyScore(S), max: 2000 },
    volume:      { label: 'Training volume',      score: volumeScore(S),      max: 5000 },
    prs:         { label: 'Exercise breadth',     score: prScore(S),          max: 3000 },
    streak:      { label: 'Weekly streak',        score: streakBonus(S),      max: 2000 },
  }
}
