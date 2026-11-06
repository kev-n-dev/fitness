// Converting a profile between kg and lb. Until now the unit switch only relabelled the numbers
// (60 kg became "60 lb", issue #22); this walks every stored weight once. Rounded to what a gym
// can load: lb to the nearest 0.5, kg to the nearest 0.25 — enough that a value converted there
// and back lands where it started for any plate-loadable number.
import { isSideSet, syncSideAggregate } from './workout-model.js'
import { workoutVolume } from './history.js'
import { EXIDX } from './exercises.js'
import { defaultBarWeight } from './bar.js'

const LB_PER_KG = 2.2046226218

/* ====== Per-exercise unit overrides ====== */
// S.exUnits stores per-exercise unit overrides: { [exerciseId]: 'kg' | 'lb' }
// When set, the exercise uses that unit for display and input, regardless of the global S.unit.

/** Get the effective unit for an exercise: its override if set, otherwise the global unit. */
export function unitFor(S, exId) {
  return S?.exUnits?.[exId] || S?.unit || 'kg'
}

/** Set or clear a per-exercise unit override. Optionally converts existing values. */
export function withExUnit(S, exId, newUnit, convert = false) {
  const out = { ...S }
  const currentUnit = unitFor(S, exId)
  const globalUnit = S.unit || 'kg'
  
  out.exUnits = { ...(S.exUnits || {}) }
  
  // If newUnit matches global, remove the override
  if (newUnit === globalUnit) {
    delete out.exUnits[exId]
    if (Object.keys(out.exUnits).length === 0) delete out.exUnits
  } else {
    out.exUnits[exId] = newUnit
  }
  
  // Convert existing values if requested and unit is changing
  if (convert && newUnit !== currentUnit) {
    out.exWeights = { ...(S.exWeights || {}) }
    const ew = out.exWeights[exId]
    if (ew && typeof ew === 'object' && ew.w != null) {
      out.exWeights[exId] = { ...ew, w: convertWeight(ew.w, currentUnit, newUnit) }
    }
    
    // Convert bar weights for this exercise
    if (S.barWeights?.[exId] > 0) {
      out.barWeights = { ...(S.barWeights || {}) }
      out.barWeights[exId] = convertWeight(S.barWeights[exId], currentUnit, newUnit)
    }
    
    // Convert routine weights for this exercise
    if (Array.isArray(S.routines)) {
      out.routines = S.routines.map(r => ({
        ...r,
        ex: (r.ex || []).map(cfg => {
          if (cfg.id !== exId) return cfg
          const c = { ...cfg }
          if (c.weight != null) c.weight = convertWeight(c.weight, currentUnit, newUnit)
          if (c.inc > 0 && (c.mode == null || c.mode === 'reps')) c.inc = convertWeight(c.inc, currentUnit, newUnit)
          if (Array.isArray(c.warmup)) c.warmup = c.warmup.map(w => (w && w.weight != null ? { ...w, weight: convertWeight(w.weight, currentUnit, newUnit) } : w))
          if (Array.isArray(c.pyramidWeight)) c.pyramidWeight = c.pyramidWeight.map(w => (w > 0 ? convertWeight(w, currentUnit, newUnit) : w))
          return c
        }),
      }))
    }
    
    // Convert workout history for this exercise
    if (Array.isArray(S.workouts)) {
      out.workouts = S.workouts.map(w => ({
        ...w,
        entries: (w.entries || []).map(e => {
          if (e.id !== exId) return e
          return convEntry(e, currentUnit, newUnit)
        }),
      }))
    }
    
    // Convert active session if present
    if (S.active?.entries) {
      out.active = {
        ...S.active,
        entries: S.active.entries.map(e => {
          if (e.id !== exId) return e
          return convEntry(e, currentUnit, newUnit)
        }),
      }
    }
  }
  
  return out
}

export function convertWeight(value, from, to) {
  if (from === to || value == null || value === '' || !Number.isFinite(Number(value))) return value
  const v = Number(value)
  if (to === 'lb') return Math.round(v * LB_PER_KG * 2) / 2
  return Math.round(v / LB_PER_KG * 4) / 4
}

// Body weight is not loaded on a bar: the weigh-in sheet steps and stores it at 0.1, so plate
// rounding would move most weigh-ins on a kg → lb → kg round trip (78.6 → 173.5 → 78.75; QA C15).
// A tenth in either unit is fine enough that kg → lb → kg comes home for every 0.1-kg value.
export function convertBodyWeight(value, from, to) {
  if (from === to || value == null || value === '' || !Number.isFinite(Number(value))) return value
  const v = Number(value)
  return Math.round((to === 'lb' ? v * LB_PER_KG : v / LB_PER_KG) * 10) / 10
}

const convSet = (set, from, to) => {
  if (!set || typeof set !== 'object') return set
  const out = { ...set }
  if (isSideSet(set)) return syncSideAggregate({ ...set, sides: {
    L: convSet(set.sides.L, from, to), R: convSet(set.sides.R, from, to),
  } })
  if (out.w != null) out.w = convertWeight(out.w, from, to)
  if (Array.isArray(out.drops)) out.drops = out.drops.map(d => ({ ...d, w: convertWeight(d.w, from, to) }))
  return out
}
const convTarget = (cfg, from, to) => {
  if (!cfg || typeof cfg !== 'object') return cfg
  const out = { ...cfg }
  if (out.weight != null) out.weight = convertWeight(out.weight, from, to)
  // A per-exercise increment is a load too — 2.5 kg is 5 lb, not 2.5 lb.
  if (out.inc > 0 && (out.mode == null || out.mode === 'reps')) out.inc = convertWeight(out.inc, from, to)
  if (Array.isArray(out.warmup)) out.warmup = out.warmup.map(w => (w && w.weight != null ? { ...w, weight: convertWeight(w.weight, from, to) } : w))
  // A pyramid's own weight per set; 0 ("no plan for this set") stays 0.
  if (Array.isArray(out.pyramidWeight)) out.pyramidWeight = out.pyramidWeight.map(w => (w > 0 ? convertWeight(w, from, to) : w))
  return out
}
// A bar is a stamped object, not a number: the 45 lb bar IS the 20 kg bar (44.1 lb), so an
// override that equals the old unit's default for that bar type drops out and the new unit's
// default takes over — 45 lb → 20 kg, not 20.5, which with a kg plate set would leave every row
// "1 kg short". An explicit 0 ("no bar", lib/bar.js) stays 0. A custom bar converts like any
// other weight (a 33 lb women's bar → 15 kg), and drops out too if it lands on the new default.
const convBarWeights = (bw, from, to) => {
  const out = {}
  for (const [id, v] of Object.entries(bw || {})) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
    if (v === 0) { out[id] = 0; continue }
    const eq = EXIDX[id]?.eq
    if (eq && v === defaultBarWeight(eq, from)) continue
    const c = convertWeight(v, from, to)
    if (eq && c === defaultBarWeight(eq, to)) continue
    out[id] = c
  }
  return out
}
const convEntry = (e, from, to) => {
  if (!e || typeof e !== 'object') return e
  return {
    ...e,
    ...(e.topW != null ? { topW: convertWeight(e.topW, from, to) } : {}),
    ...(e.target ? { target: convTarget(e.target, from, to) } : {}),
    // The plan the entry was built from (lib/session-start.js) carries the routine's weight too.
    ...(e.planned ? { planned: convTarget(e.planned, from, to) } : {}),
    ...(Array.isArray(e.sets) ? { sets: e.sets.map(s => convSet(s, from, to)) } : {}),
  }
}

/** A new state object with every weight expressed in `to`, and `unit` set to it. */
export function convertStateUnit(S, to) {
  const from = S.unit || 'kg'
  if (from === to) return S
  const c = v => convertWeight(v, from, to)
  const bw = v => convertBodyWeight(v, from, to)
  // A session carries its body weight of the day and a cached total volume; History rows, the
  // detail header, the month calendar and the heatmap tooltips read those rather than summing
  // sets, so they must move with the sets or show kg totals under an lb label (QA C11). The
  // volume is re-added from the converted sets, so it agrees with the set list to the number.
  const convSession = s => {
    const out = { ...s, entries: (s.entries || []).map(e => convEntry(e, from, to)) }
    if (out.bw != null) out.bw = bw(out.bw)
    if (Number.isFinite(out.vol)) out.vol = workoutVolume({ entries: out.entries.filter(e => Array.isArray(e?.sets)) })
    return out
  }
  const out = { ...S, unit: to }
  if (Array.isArray(S.bodyweight)) out.bodyweight = S.bodyweight.map(b => ({ ...b, w: bw(b.w) }))
  if (S.targetW != null) out.targetW = bw(S.targetW)
  if (S.exWeights) out.exWeights = Object.fromEntries(Object.entries(S.exWeights).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v, w: c(v.w) } : c(v)]))
  if (S.barWeights) out.barWeights = convBarWeights(S.barWeights, from, to)
  // The plate inventory (S.plates) is carried over as it is, not converted: it is kept per unit
  // (lib/plates.js), because a 45 lb plate does not become a 20.4 kg one. After the switch the
  // rows load from the new unit's own list, or the standard set until you count yours, and
  // switching back finds the old list as you left it. The dumbbell list (S.dumbbells) is kept per
  // unit the same way. The load kinds (S.loadKind) and what a dumbbell weight means (S.dbLoad)
  // hold no weight.
  if (Array.isArray(S.routines)) out.routines = S.routines.map(r => ({ ...r, ex: (r.ex || []).map(cfg => convTarget(cfg, from, to)) }))
  if (Array.isArray(S.workouts)) out.workouts = S.workouts.map(convSession)
  if (S.active) out.active = convSession(S.active)
  return out
}
