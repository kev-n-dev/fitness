// RECIPE Rank — scoring engine for community recipe contribution.
//
// Score = ratingScore + savesScore + completenessBonus + challengeBonus
//
// ── ratingScore (primary driver) ─────────────────────────────────────────────
//   High ratings from the community are the main way to earn points.
//   Only ratings at or above 4 stars contribute meaningfully:
//
//     4.0 stars: 25 pts per rating received
//     4.5 stars: 37.5 pts per rating
//     5.0 stars: 50 pts per rating
//
//   Formula: pts_per_rating = max(0, (avgRating - 3.0) * 25)
//   A recipe rated below 3 stars earns nothing. Between 3 and 4 it earns
//   a small amount. 4+ is where the real gains are.
//   Cap: 10 000 pts (keeps the board meaningful as the community grows).
//
// ── savesScore ───────────────────────────────────────────────────────────────
//   5 pts per save. Community saves signal utility independent of rating.
//   Cap: 2 000 pts.
//
// ── completenessBonus ────────────────────────────────────────────────────────
//   50 pts per published recipe with all four macros filled in.
//   Rewards quality nutrition data, not just publishing. Cap: 500 pts.
//
// ── challengeBonus ───────────────────────────────────────────────────────────
//   Flat bonus pts from completed challenges that apply to 'recipe' or 'all'.
//
// Note: publishing a recipe alone earns no base points. You earn by the
// community engaging positively with what you create.
import { tierForScore } from './tiers.js'
import { challengeBonusFor } from './challengeBonus.js'

// ── Score components ──────────────────────────────────────────────────────────

/**
 * Community rating score — the primary driver.
 * pts_per_rating = max(0, (avgRating - 3.0) * 25)
 * Total = sum over all published recipes of (ptsPerRating × ratingCount)
 */
function ratingScore(recipes) {
  let score = 0
  for (const r of recipes) {
    if (!r.published || !r.ratingCount || r.ratingCount < 1) continue
    const avg = r.avgRating || 0
    const ptsPerRating = Math.max(0, (avg - 3.0) * 25)
    score += ptsPerRating * r.ratingCount
  }
  return Math.min(10000, Math.floor(score))
}

/** 5 pts per save across all published recipes. Cap: 2 000. */
function savesScore(recipes) {
  const total = recipes.reduce((sum, r) => sum + (r.saves || 0), 0)
  return Math.min(2000, total * 5)
}

/**
 * 50 pts per published recipe with all four primary macros (calories, protein, carbs, fat).
 * Bonus 25 pts if secondary macros are also filled (fiber, sugar, saturatedFat, sodium).
 * Cap: 500 pts.
 */
function completenessBonus(recipes) {
  let score = 0
  for (const r of recipes) {
    if (!r.published) continue
    const n = r.nutrition || {}
    const hasPrimary = n.calories != null && n.protein != null && n.carbs != null && n.fat != null
    if (!hasPrimary) continue
    score += 50
    const hasSecondary = n.fiber != null && n.sugar != null && n.saturatedFat != null && n.sodium != null
    if (hasSecondary) score += 25
  }
  return Math.min(500, score)
}

// ── Public API ────────────────────────────────────────────────────────────────

export function recipeRankScore(S) {
  if (!S) return 0
  const recipes = S.recipes || []
  return (
    ratingScore(recipes) +
    savesScore(recipes) +
    completenessBonus(recipes) +
    challengeBonusFor(S, 'recipe')
  )
}

export function recipeRankTier(score) {
  return tierForScore(score)
}

export function recipeRankBreakdown(S) {
  const recipes = S.recipes || []
  const published = recipes.filter(r => r.published)
  const totalRatings = published.reduce((s, r) => s + (r.ratingCount || 0), 0)
  const totalSaves   = published.reduce((s, r) => s + (r.saves || 0), 0)
  const bonus = challengeBonusFor(S, 'recipe')

  return {
    ratings: {
      label: 'Community ratings',
      score: ratingScore(recipes),
      max: 10000,
      detail: `${totalRatings} rating${totalRatings !== 1 ? 's' : ''} across ${published.length} recipe${published.length !== 1 ? 's' : ''}`,
    },
    saves: {
      label: 'Recipe saves',
      score: savesScore(recipes),
      max: 2000,
      detail: `${totalSaves} save${totalSaves !== 1 ? 's' : ''}`,
    },
    completeness: {
      label: 'Full nutrition info',
      score: completenessBonus(recipes),
      max: 500,
      detail: 'Recipes with all macros filled',
    },
    challenges: {
      label: 'Challenge bonuses',
      score: bonus,
      max: null,
    },
  }
}

// ── How-to guide (shown in the view) ─────────────────────────────────────────

export const RECIPE_RANK_HOW = [
  'Publish a recipe to make it rateable by the community',
  'Higher average ratings earn more points — 4+ stars is where it counts',
  'A 5-star recipe earns 50 pts per rating received',
  'A 4-star recipe earns 25 pts per rating',
  'Below 3 stars contributes nothing',
  'Additional pts for saves and complete macro information',
  'Complete challenges to earn bonus points',
]

// ── Recipe model helpers ──────────────────────────────────────────────────────

/** Creates a new recipe object ready for state. */
export function newRecipe({ name, ingredients = [], steps = [], nutrition = {}, tags = [] }) {
  return {
    id: crypto.randomUUID(),
    name,
    ingredients,
    steps,
    nutrition: {
      calories:     nutrition.calories     ?? null,
      protein:      nutrition.protein      ?? null,
      carbs:        nutrition.carbs        ?? null,
      fat:          nutrition.fat          ?? null,
      fiber:        nutrition.fiber        ?? null,
      sugar:        nutrition.sugar        ?? null,
      saturatedFat: nutrition.saturatedFat ?? null,
      sodium:       nutrition.sodium       ?? null,
      water:        nutrition.water        ?? null,
      servings:     nutrition.servings     ?? 1,
    },
    tags,
    published: false,
    avgRating: 0,
    ratingCount: 0,
    saves: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}
