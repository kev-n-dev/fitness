// TERRITORY Rank — scoring engine for GPS-based area capture.
//
// Points are awarded for:
//   • Unique grid cells captured (H3 hex grid, resolution 8 ≈ 0.46 km²)
//   • Cells currently held (defended)
//   • Exploration diversity (different cities / regions visited)
//   • Territory challenges completed
//
// Anti-cheat principles (enforced server-side, reflected here):
//   • Routes must have a minimum number of GPS points at natural intervals
//   • Speed checks: cells gained at > 30 km/h are flagged for review
//   • Each cell capture is stamped with a run or workout activity ID
//   • Disputed cells (gained via flagged activities) are held in escrow
import { tierForScore } from './tiers.js'
import { challengeBonusFor } from './challengeBonus.js'

export function territoryRankScore(S) {
  if (!S) return 0
  const territory = S.territory || {}
  return (
    capturedCellScore(territory) +
    heldCellBonus(territory) +
    diversityScore(territory) +
    challengeBonusFor(S, 'territory')
  )
}

export function territoryRankTier(score) {
  return tierForScore(score)
}

// ── Sub-scores ───────────────────────────────────────────────────────────────

/** 10 pts per unique cell ever captured, capped at 10 000. */
function capturedCellScore(territory) {
  const total = (territory.capturedCells || []).length
  return Math.min(10000, total * 10)
}

/** 5 pts per cell currently held (not lost to another user), capped at 5000. */
function heldCellBonus(territory) {
  const held = (territory.capturedCells || []).filter(c => !c.lostAt).length
  return Math.min(5000, held * 5)
}

/**
 * Diversity score: 200 pts per unique region (city-level cluster) visited.
 * Capped at 2000 pts (10 regions).
 */
function diversityScore(territory) {
  const regions = new Set((territory.capturedCells || []).map(c => c.regionId).filter(Boolean))
  return Math.min(2000, regions.size * 200)
}

// ── Breakdown ────────────────────────────────────────────────────────────────

export function territoryRankBreakdown(S) {
  const territory = S.territory || {}
  return {
    captured:   { label: 'Cells captured',    score: capturedCellScore(territory),         max: 10000 },
    held:       { label: 'Territory held',    score: heldCellBonus(territory),             max: 5000  },
    diversity:  { label: 'Regions explored',  score: diversityScore(territory),            max: 2000  },
    challenges: { label: 'Challenge bonuses', score: challengeBonusFor(S, 'territory'),    max: null  },
  }
}

// ── Territory model helpers ──────────────────────────────────────────────────

/**
 * Creates a cell capture record.
 * cellId: H3 index string (hex cell identifier)
 * activityId: the run/workout that produced this capture
 */
export function newCellCapture({ cellId, activityId, lat, lng, regionId }) {
  return {
    cellId,
    activityId,
    lat,
    lng,
    regionId: regionId || null,
    capturedAt: Date.now(),
    lostAt: null,   // set when another user claims the cell
    disputed: false,
  }
}

/**
 * Returns a bounding box for a set of captured cells,
 * used to centre the territory map.
 */
export function cellBounds(cells) {
  if (!cells?.length) return null
  const lats = cells.map(c => c.lat).filter(Boolean)
  const lngs = cells.map(c => c.lng).filter(Boolean)
  if (!lats.length) return null
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  }
}
