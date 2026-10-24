// Challenge bonus — shared across all four rank scoring engines.
//
// Completed challenges are stored in S.completedChallenges as an array:
//
//   S.completedChallenges = [
//     { id: 'run-50k',    appliesTo: 'run',     rewardPts: 200, completedAt: 1720000000000 },
//     { id: 'week-streak',appliesTo: 'rep',     rewardPts: 150, completedAt: 1720500000000 },
//     { id: 'first-recipe',appliesTo: 'recipe', rewardPts: 100, completedAt: 1721000000000 },
//     { id: 'explorer',   appliesTo: 'territory',rewardPts: 300,completedAt: 1721500000000 },
//     { id: 'all-rounder',appliesTo: 'all',     rewardPts: 500, completedAt: 1722000000000 },
//   ]
//
// appliesTo values:
//   'rep'       → counts toward REP Rank only
//   'run'       → counts toward RUN Rank only
//   'recipe'    → counts toward RECIPE Rank only
//   'territory' → counts toward TERRITORY Rank only
//   'all'       → counts toward ALL four ranks simultaneously

/**
 * Returns the total challenge bonus points for a given rank type.
 * @param {object} S - The user state object
 * @param {'rep'|'run'|'recipe'|'territory'} rankKey
 * @returns {number}
 */
export function challengeBonusFor(S, rankKey) {
  const completed = S.completedChallenges || []
  let total = 0
  for (const c of completed) {
    if (c.appliesTo === rankKey || c.appliesTo === 'all') {
      total += c.rewardPts || 0
    }
  }
  return total
}

/**
 * Returns all completed challenges for a given rank type, sorted newest first.
 * Useful for displaying challenge history in rank detail views.
 */
export function completedChallengesFor(S, rankKey) {
  const completed = S.completedChallenges || []
  return completed
    .filter(c => c.appliesTo === rankKey || c.appliesTo === 'all')
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
}

/**
 * Marks a challenge as completed and adds it to S.completedChallenges.
 * Call this from challenge completion logic (e.g. in Challenges.jsx).
 *
 * @param {object} S - mutable state object (inside an updateS call)
 * @param {object} challenge - { id, name, appliesTo, rewardPts }
 */
export function completeChallenge(S, challenge) {
  if (!S.completedChallenges) S.completedChallenges = []
  // Idempotent — don't add it twice
  if (S.completedChallenges.some(c => c.id === challenge.id)) return
  S.completedChallenges.push({
    id: challenge.id,
    name: challenge.name,
    appliesTo: challenge.appliesTo || 'all',
    rewardPts: challenge.rewardPts || 0,
    completedAt: Date.now(),
  })
}
