// food-lookup.js — barcode → nutrition data via Open Food Facts.
//
// Open Food Facts is a free, open collaborative food database (openfoodfacts.org).
// No API key required. Covers 2.6M+ products worldwide.
//
// API used: https://world.openfoodfacts.org/api/v3/product/{barcode}.json
//
// We normalise the response into a flat `FoodProduct` object, always expressed
// per 100g, plus optional serving size. The caller multiplies by (grams / 100).

// ── Types (JSDoc) ─────────────────────────────────────────────────────────────
//
// FoodProduct {
//   barcode:       string
//   name:          string
//   brand:         string
//   servingGrams:  number | null   — grams per labelled serving, if known
//   per100g: {
//     calories:     number
//     protein:      number   g
//     carbs:        number   g
//     fat:          number   g
//     fiber:        number | null  g
//     sugar:        number | null  g
//     saturatedFat: number | null  g
//     sodium:       number | null  mg  (OFF stores g, we convert)
//   }
//   image:         string | null   — product image URL for display
// }

const OFF_BASE = 'https://world.openfoodfacts.org/api/v3/product'

/**
 * Look up a product by EAN/UPC barcode.
 * Returns a FoodProduct or throws with { code: 'not-found' | 'network' | 'parse' }.
 */
export async function lookupBarcode(barcode) {
  const clean = String(barcode).replace(/\D/g, '')
  if (!clean) throw Object.assign(new Error('Empty barcode'), { code: 'not-found' })

  let resp
  try {
    resp = await fetch(`${OFF_BASE}/${clean}.json`, {
      headers: { 'User-Agent': 'FitnessApp/1.0 (contact@example.com)' },
    })
  } catch (e) {
    throw Object.assign(new Error('Network error'), { code: 'network' })
  }

  if (!resp.ok) throw Object.assign(new Error('Not found'), { code: 'not-found' })

  let data
  try { data = await resp.json() }
  catch { throw Object.assign(new Error('Parse error'), { code: 'parse' }) }

  if (data.status === 0 || !data.product) {
    throw Object.assign(new Error('Product not found'), { code: 'not-found' })
  }

  return normalise(clean, data.product)
}

function normalise(barcode, p) {
  const n = p.nutriments || {}

  // Serving size — prefer numeric quantity, fall back to parsing the label string
  let servingGrams = null
  if (p.serving_quantity && Number(p.serving_quantity) > 0) {
    servingGrams = Number(p.serving_quantity)
  } else if (p.serving_size) {
    const m = String(p.serving_size).match(/(\d+(?:\.\d+)?)\s*g/i)
    if (m) servingGrams = Number(m[1])
  }

  // Product name: prefer language-neutral, fall back to generic
  const name = p.product_name_en || p.product_name || p.generic_name_en || p.generic_name || ''
  const brand = p.brands?.split(',')[0]?.trim() || ''

  return {
    barcode,
    name:         name.trim() || 'Unknown product',
    brand,
    servingGrams,
    per100g: {
      calories:     round(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0),
      protein:      round(n['proteins_100g']    ?? 0),
      carbs:        round(n['carbohydrates_100g'] ?? 0),
      fat:          round(n['fat_100g']          ?? 0),
      fiber:        roundOrNull(n['fiber_100g']),
      sugar:        roundOrNull(n['sugars_100g']),
      saturatedFat: roundOrNull(n['saturated-fat_100g']),
      // OFF stores sodium in grams per 100g; we display mg
      sodium:       n['sodium_100g'] != null ? Math.round(n['sodium_100g'] * 1000) : null,
    },
    image: p.image_front_small_url || p.image_front_url || p.image_url || null,
  }
}

function round(v) { return Math.round((Number(v) || 0) * 10) / 10 }
function roundOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 10) / 10
}

/**
 * Scale per-100g values to a specific gram amount.
 * Returns a nutrition object ready to store in a meal or ingredient.
 */
export function nutritionForGrams(product, grams) {
  const ratio = grams / 100
  const p = product.per100g
  const maybe = v => v != null ? Math.round(v * ratio * 10) / 10 : null
  return {
    calories:     Math.round((p.calories     || 0) * ratio),
    protein:      Math.round((p.protein      || 0) * ratio * 10) / 10,
    carbs:        Math.round((p.carbs        || 0) * ratio * 10) / 10,
    fat:          Math.round((p.fat          || 0) * ratio * 10) / 10,
    fiber:        maybe(p.fiber),
    sugar:        maybe(p.sugar),
    saturatedFat: maybe(p.saturatedFat),
    sodium:       p.sodium != null ? Math.round(p.sodium * ratio) : null,
  }
}

/**
 * Convert a FoodProduct into a ready-to-log meal entry.
 * grams: how much the user ate.
 */
export function productToMeal(product, grams) {
  const label = product.brand ? `${product.name} (${product.brand})` : product.name
  return {
    id: crypto.randomUUID(),
    name: label,
    time: new Date().toISOString(),
    barcode: product.barcode,
    grams,
    nutrition: nutritionForGrams(product, grams),
  }
}

/**
 * Convert a FoodProduct into a recipe ingredient entry.
 */
export function productToIngredient(product, grams) {
  return {
    id:      crypto.randomUUID(),
    name:    product.barcode ? `${product.name}${product.brand ? ` (${product.brand})` : ''}` : product.name,
    amount:  grams,
    unit:    'g',
    barcode: product.barcode || null,
    per100g: product.per100g,
  }
}
