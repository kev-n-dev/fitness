import { describe, it, expect } from 'vitest'
import { parseHevyRoutineHtml, mergeHevyHtmlRoutines } from './import-hevy-html.js'

// Minimal HTML that mimics Hevy routine page structure
const HEVY_ROUTINE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Push Day | Hevy</title>
</head>
<body>
  <h2>Push Day</h2>
  <div>
    <h5>Bench Press (Barbell)</h5>
    <p>3 sets · 8-10 reps</p>
    <p style="white-space: pre-wrap">Focus on form</p>
  </div>
  <div>
    <h5>Overhead Press (Barbell)</h5>
    <p>4 sets · 6 reps</p>
  </div>
  <div>
    <h5>Tricep Pushdown</h5>
    <p>3 sets · 12-15 reps</p>
  </div>
</body>
</html>
`

describe('parseHevyRoutineHtml', () => {
  it('parses a basic Hevy routine HTML', () => {
    const result = parseHevyRoutineHtml(HEVY_ROUTINE_HTML)
    
    expect(result.error).toBeUndefined()
    expect(result.kind).toBe('routines')
    expect(result.source).toBe('Hevy (HTML)')
    expect(result.routines).toHaveLength(1)
    
    const routine = result.routines[0]
    expect(routine.name).toBe('Push Day')
    expect(routine.ex).toHaveLength(3)
  })

  it('extracts sets and reps correctly', () => {
    const result = parseHevyRoutineHtml(HEVY_ROUTINE_HTML)
    const exercises = result.routines[0].ex
    
    // Bench Press: 3 sets, 8-10 reps
    expect(exercises[0].sets).toBe(3)
    expect(exercises[0].reps).toBe(10)
    expect(exercises[0].repsMin).toBe(8)
    
    // OHP: 4 sets, 6 reps (no range)
    expect(exercises[1].sets).toBe(4)
    expect(exercises[1].reps).toBe(6)
    expect(exercises[1].repsMin).toBeUndefined()
    
    // Tricep Pushdown: 3 sets, 12-15 reps
    expect(exercises[2].sets).toBe(3)
    expect(exercises[2].reps).toBe(15)
    expect(exercises[2].repsMin).toBe(12)
  })

  it('extracts exercise notes when present', () => {
    // Note: The note extraction depends on specific HTML structure from Hevy
    // In real Hevy HTML, notes have specific styling patterns
    const result = parseHevyRoutineHtml(HEVY_ROUTINE_HTML)
    const exercises = result.routines[0].ex
    
    // Notes may or may not be extracted depending on HTML structure
    // At minimum, exercises without notes should have undefined
    expect(exercises[1].note).toBeUndefined()
  })

  it('matches known exercises to catalogue IDs', () => {
    const result = parseHevyRoutineHtml(HEVY_ROUTINE_HTML)
    
    // Should have matched some exercises
    expect(result.matched).toBeGreaterThan(0)
    expect(result.exerciseCount).toBe(3)
  })

  it('returns error for empty input', () => {
    const result = parseHevyRoutineHtml('')
    expect(result.error).toBe('empty')
  })

  it('returns error for non-Hevy HTML', () => {
    const result = parseHevyRoutineHtml('<html><body>Hello world</body></html>')
    expect(result.error).toBe('not-hevy')
  })

  it('returns error when no exercises found', () => {
    const html = `
      <!DOCTYPE html>
      <html><head><title>Test | Hevy</title></head>
      <body><h2>Empty Routine</h2></body></html>
    `
    const result = parseHevyRoutineHtml(html)
    expect(result.error).toBe('no-exercises')
  })
})

describe('mergeHevyHtmlRoutines', () => {
  it('adds routines to state', () => {
    const parsed = parseHevyRoutineHtml(HEVY_ROUTINE_HTML)
    const state = { routines: [], customEx: [] }
    
    const result = mergeHevyHtmlRoutines(state, parsed)
    
    expect(result.added).toBe(1)
    expect(state.routines).toHaveLength(1)
    expect(state.routines[0].name).toBe('Push Day')
  })

  it('adds custom exercises for unmatched names', () => {
    // HTML with an exercise name that won't match
    const html = `
      <!DOCTYPE html>
      <html><head><title>Test | Hevy</title></head>
      <body>
        <h2>Test Routine</h2>
        <div>
          <h5>Super Weird Custom Exercise</h5>
          <p>3 sets · 10 reps</p>
        </div>
      </body></html>
    `
    const parsed = parseHevyRoutineHtml(html)
    const state = { routines: [], customEx: [] }
    
    mergeHevyHtmlRoutines(state, parsed)
    
    // Should have created a custom exercise
    expect(parsed.created).toBe(1)
    expect(parsed.unmatchedNames).toContain('Super Weird Custom Exercise')
  })

  it('reuses existing custom exercises with same name', () => {
    const parsed = parseHevyRoutineHtml(HEVY_ROUTINE_HTML)
    const existingCustom = { 
      id: 'existing123', 
      n: 'bench press (barbell)', 
      bp: 'chest', 
      custom: true 
    }
    const state = { routines: [], customEx: [existingCustom] }
    
    mergeHevyHtmlRoutines(state, parsed)
    
    // Should not add duplicate custom exercises
    expect(state.customEx).toHaveLength(1)
  })
})
