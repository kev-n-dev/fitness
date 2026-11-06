// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { unitFor, withExUnit, convertWeight, convertStateUnit } from './units.js'

describe('per-exercise units', () => {
  it('unitFor returns global unit when no override', () => {
    expect(unitFor({ unit: 'kg' }, 'ex1')).toBe('kg')
    expect(unitFor({ unit: 'lb' }, 'ex1')).toBe('lb')
    expect(unitFor({}, 'ex1')).toBe('kg') // default
  })

  it('unitFor returns override when set', () => {
    expect(unitFor({ unit: 'kg', exUnits: { ex1: 'lb' } }, 'ex1')).toBe('lb')
    expect(unitFor({ unit: 'lb', exUnits: { ex1: 'kg' } }, 'ex1')).toBe('kg')
  })

  it('withExUnit sets override different from global', () => {
    const S = { unit: 'kg' }
    const result = withExUnit(S, 'ex1', 'lb', false)
    expect(result.exUnits).toEqual({ ex1: 'lb' })
  })

  it('withExUnit removes override when matching global', () => {
    const S = { unit: 'kg', exUnits: { ex1: 'lb' } }
    const result = withExUnit(S, 'ex1', 'kg', false)
    expect(result.exUnits).toBeUndefined()
  })

  it('withExUnit converts exWeights when requested', () => {
    const S = { 
      unit: 'kg', 
      exWeights: { ex1: { w: 60, d: '2026-01-01' } }
    }
    const result = withExUnit(S, 'ex1', 'lb', true)
    expect(result.exUnits).toEqual({ ex1: 'lb' })
    expect(result.exWeights.ex1.w).toBe(convertWeight(60, 'kg', 'lb'))
  })

  it('withExUnit converts routine weights when requested', () => {
    const S = { 
      unit: 'kg',
      routines: [{ id: 'r1', name: 'Test', ex: [{ id: 'ex1', weight: 50 }] }]
    }
    const result = withExUnit(S, 'ex1', 'lb', true)
    expect(result.routines[0].ex[0].weight).toBe(convertWeight(50, 'kg', 'lb'))
  })

  it('withExUnit converts workout history when requested', () => {
    const S = {
      unit: 'kg',
      workouts: [{ 
        id: 'w1', 
        d: '2026-01-01',
        entries: [{ id: 'ex1', sets: [{ w: 100, r: 5 }] }]
      }]
    }
    const result = withExUnit(S, 'ex1', 'lb', true)
    expect(result.workouts[0].entries[0].sets[0].w).toBe(convertWeight(100, 'kg', 'lb'))
  })

  it('withExUnit preserves other exercises when converting', () => {
    const S = {
      unit: 'kg',
      workouts: [{
        id: 'w1',
        d: '2026-01-01',
        entries: [
          { id: 'ex1', sets: [{ w: 100, r: 5 }] },
          { id: 'ex2', sets: [{ w: 80, r: 8 }] }
        ]
      }]
    }
    const result = withExUnit(S, 'ex1', 'lb', true)
    // ex1 converted
    expect(result.workouts[0].entries[0].sets[0].w).toBe(convertWeight(100, 'kg', 'lb'))
    // ex2 unchanged
    expect(result.workouts[0].entries[1].sets[0].w).toBe(80)
  })
})
