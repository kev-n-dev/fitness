// RECIPE Rank — scoring engine for nutrition community contribution.
//
// Points are awarded for:
//   • Recipes created and published
//   • Community ratings received (average × count)
//   • Recipes saved by other users
//   • Completeness of nutritional information
//
// This rank is intentionally separate from personal nutrition adherence,
// which has its own scoring in nutritionScore.js.
import { tierForScore } from './tiers.js'

export function recipeRankScore(S) {
  if (!S) return 0
  const recipes = S.recipes || []
  return (
    creationScore(recipes) +
    ratingScore(recipes) +
    savesScore(recipes) +
    nutritionCompletenessScore(recipes)
  )
}

export function recipeRankTier(score) {
  return tierForScore(score)
}

// ── Sub-scores ───────────────────────────────────────────────────────────────

/** 50 pts per published recipe, capped at 2500. */
function creationScore(recipes) {
  const published = recipes.filter(r => r.published)
  return Math.min(2500, published.length * 50)
}

/**
 * Rating score: sum of (avgRating × ratingCount) across all recipes.
 * Scale: a 5-star recipe with 100 ratings = 500 pts. Capped at 5000.
 */
function ratingScore(recipes) {
  let score = 0
  for (const r of recipes) {
    if (r.published && r.avgRating && r.ratingCount) {
      score += r.avgRating * r.ratingCount
    }
  }
  return Math.min(5000, Math.floor(score))
}

/** 10 pts per save across all published recipes, capped at 3000. */
function savesScore(recipes) {
  const totalSaves = recipes.reduce((sum, r) => sum + (r.saves || 0), 0)
  return Math.min(3000, totalSaves * 10)
}

/**
 * Completeness bonus: 25 pts per recipe that has macros (calories, protein,
 * carbs, fat) fully filled in. Capped at 1000.
 */
function nutritionCompletenessScore(recipes) {
  const complete = recipes.filter(r =>
    r.published &&
    r.nutrition?.calories != null &&
    r.nutrition?.protein != null &&
    r.nutrition?.carbs != null &&
    r.nutrition?.fat != null
  )
  return Math.min(1000, complete.length * 25)
}

// ── Breakdown ────────────────────────────────────────────────────────────────

export function recipeRankBreakdown(S) {
  const recipes = S.recipes || []
  return {
    creation:    { label: 'Recipes published',    score: creationScore(recipes),              max: 2500 },
    ratings:     { label: 'Community ratings',    score: ratingScore(recipes),                max: 5000 },
    saves:       { label: 'Recipe saves',         score: savesScore(recipes),                 max: 3000 },
    completeness:{ label: 'Nutrition detail',     score: nutritionCompletenessScore(recipes), max: 1000 },
  }
}

// ── Recipe model helpers ─────────────────────────────────────────────────────

/** Creates a new recipe object ready for state. */
export function newRecipe({ name, ingredients = [], steps = [], nutrition = {}, tags = [] }) {
  return {
    id: crypto.randomUUID(),
    name,
    ingredients, // [{ name, amount, unit }]
    steps,       // ['Step text', ...]
    nutrition: {
      calories: nutrition.calories ?? null,
      protein:  nutrition.protein  ?? null,
      carbs:    nutrition.carbs    ?? null,
      fat:      nutrition.fat      ?? null,
      servings: nutrition.servings ?? 1,
    },
    tags,         // ['high-protein', 'vegan', ...]
    published: false,
    avgRating: 0,
    ratingCount: 0,
    saves: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}
