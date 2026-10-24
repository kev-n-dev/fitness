// Rank tier definitions — shared across REP, RUN, RECIPE, TERRITORY ranks.
// Each tier has a label, color, score threshold, and a progress function
// that returns 0–100 representing progress toward the next tier.

export const TIER_ORDER = ['unranked', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite']

export const RANK_TIERS = {
  unranked: {
    label: 'Unranked',
    color: 'var(--grey)',
    min: 0,
    max: 100,
    next: 'Bronze',
    progress: score => Math.min(100, (score / 100) * 100),
  },
  bronze: {
    label: 'Bronze',
    color: '#cd7f32',
    min: 100,
    max: 500,
    next: 'Silver',
    progress: score => Math.min(100, ((score - 100) / 400) * 100),
  },
  silver: {
    label: 'Silver',
    color: '#c0c0c0',
    min: 500,
    max: 1500,
    next: 'Gold',
    progress: score => Math.min(100, ((score - 500) / 1000) * 100),
  },
  gold: {
    label: 'Gold',
    color: 'var(--yellow)',
    min: 1500,
    max: 4000,
    next: 'Platinum',
    progress: score => Math.min(100, ((score - 1500) / 2500) * 100),
  },
  platinum: {
    label: 'Platinum',
    color: '#e5e4e2',
    min: 4000,
    max: 10000,
    next: 'Diamond',
    progress: score => Math.min(100, ((score - 4000) / 6000) * 100),
  },
  diamond: {
    label: 'Diamond',
    color: 'var(--blue)',
    min: 10000,
    max: 25000,
    next: 'Elite',
    progress: score => Math.min(100, ((score - 10000) / 15000) * 100),
  },
  elite: {
    label: 'Elite',
    color: 'var(--purple)',
    min: 25000,
    max: Infinity,
    next: 'Max',
    progress: () => 100,
  },
}

/** Returns the tier key for a given score. */
export function tierForScore(score) {
  if (score >= 25000) return 'elite'
  if (score >= 10000) return 'diamond'
  if (score >= 4000)  return 'platinum'
  if (score >= 1500)  return 'gold'
  if (score >= 500)   return 'silver'
  if (score >= 100)   return 'bronze'
  return 'unranked'
}
