// Parse Hevy routines from pasted HTML (from shared routine URLs like hevy.com/routine/...)
//
// This is a simpler alternative to the API import: copy the page source or use
// browser dev tools to grab the HTML, then paste it here. The parser extracts
// the routine name and exercises with their sets/reps/notes configuration.

import { EXIDX, canonicalExId } from './exercises.js'
import { uid } from './format.js'
import { HEVY_TITLE_MAP } from './hevy-id-map.js'
import { matchExercise } from './import-csv.js'

/**
 * Match an exercise name from Hevy HTML to a catalogue id.
 * Uses the same HEVY_TITLE_MAP as the API/CSV imports for consistency.
 */
function matchHevyExerciseName(name) {
  const normalized = String(name || '').trim().toLowerCase()
  if (!normalized) return null
  
  // Try exact match from the generated Hevy title map first
  const mapped = HEVY_TITLE_MAP[normalized]
  if (mapped && EXIDX[mapped]) return canonicalExId(mapped)
  
  // Fall back to fuzzy word-bag matching from CSV import
  const fuzzy = matchExercise(name)
  if (fuzzy && EXIDX[fuzzy]) return canonicalExId(fuzzy)
  
  return null
}

/**
 * Parse sets/reps text like "3 sets · 10-12 reps" or "4 sets · 8 reps"
 * Returns { sets, reps, repsMin } where repsMin is set for rep ranges
 */
function parseSetsReps(text) {
  const s = String(text || '').toLowerCase()
  
  // Extract sets count
  const setsMatch = s.match(/(\d+)\s*sets?/)
  const sets = setsMatch ? parseInt(setsMatch[1], 10) : 3
  
  // Extract reps - could be "10 reps", "10-12 reps", "8-10 reps"
  const repsMatch = s.match(/(\d+)(?:\s*-\s*(\d+))?\s*reps?/)
  let reps = 10
  let repsMin = null
  
  if (repsMatch) {
    if (repsMatch[2]) {
      // Rep range like "10-12"
      repsMin = parseInt(repsMatch[1], 10)
      reps = parseInt(repsMatch[2], 10)
    } else {
      reps = parseInt(repsMatch[1], 10)
    }
  }
  
  // Check for time-based sets like "30 sec" or "1 min"
  const secMatch = s.match(/(\d+)\s*sec/)
  const minMatch = s.match(/(\d+)\s*min/)
  
  if (secMatch || minMatch) {
    const secs = (minMatch ? parseInt(minMatch[1], 10) * 60 : 0) + 
                 (secMatch ? parseInt(secMatch[1], 10) : 0)
    return { sets, sec: secs, mode: 'time' }
  }
  
  return { sets, reps, ...(repsMin ? { repsMin } : {}) }
}

/**
 * Parse Hevy routine HTML and extract routine data.
 * 
 * Expected HTML structure (from hevy.com/routine/...):
 * - Routine name in <h2> or <title>
 * - Exercises in containers with exercise name in <h5>
 * - Sets/reps info like "3 sets · 10-12 reps"
 * - Optional notes in <p> with white-space: pre-wrap
 * 
 * @param {string} html - Raw HTML string from the Hevy routine page
 * @returns {Object} Parsed result with routine data and stats
 */
export function parseHevyRoutineHtml(html) {
  if (!html || typeof html !== 'string') {
    return { error: 'empty', message: 'No HTML content provided' }
  }
  
  // Check if this looks like Hevy HTML
  const isHevy = html.includes('hevy.com') || 
                 html.includes('Hevy') || 
                 html.includes('hevyapp') ||
                 html.includes('routine') && html.includes('sets')
  
  if (!isHevy) {
    return { error: 'not-hevy', message: 'This doesn\'t look like Hevy routine HTML' }
  }
  
  // Parse HTML using DOMParser (browser) or regex fallback
  let routineName = 'Imported Routine'
  const exercises = []
  
  if (typeof DOMParser !== 'undefined') {
    // Browser environment - use DOM parsing
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    
    // Extract routine name from various possible locations
    // Try <title> first, then <h2>, then <h1>
    const title = doc.querySelector('title')?.textContent || ''
    const h2 = doc.querySelector('h2')?.textContent || ''
    const h1 = doc.querySelector('h1')?.textContent || ''
    
    // Clean up title - remove " | Hevy" suffix if present
    routineName = (h2 || h1 || title)
      .replace(/\s*[|–-]\s*Hevy.*$/i, '')
      .replace(/Routine:\s*/i, '')
      .trim() || 'Imported Routine'
    
    // Find exercise containers - Hevy uses various class patterns
    // Look for h5 elements (exercise names) and their parent containers
    const exerciseHeaders = doc.querySelectorAll('h5')
    
    for (const h5 of exerciseHeaders) {
      const exerciseName = h5.textContent?.trim()
      if (!exerciseName) continue
      
      // Look for sets/reps info near this exercise
      // Usually in a sibling or nearby element containing "sets" and "reps"
      const container = h5.closest('div') || h5.parentElement
      if (!container) continue
      
      let setsRepsText = ''
      let noteText = ''
      
      // Search for sets/reps pattern in container text
      const containerText = container.textContent || ''
      const setsRepsMatch = containerText.match(/\d+\s*sets?\s*[·•]\s*\d+(?:-\d+)?\s*reps?/i)
      if (setsRepsMatch) {
        setsRepsText = setsRepsMatch[0]
      }
      
      // Look for notes - usually in a <p> with pre-wrap style
      const noteParagraphs = container.querySelectorAll('p')
      for (const p of noteParagraphs) {
        const style = p.getAttribute('style') || ''
        const text = p.textContent?.trim() || ''
        // Notes often have white-space: pre-wrap or are after the sets/reps
        if ((style.includes('pre-wrap') || style.includes('white-space')) && text) {
          noteText = text
          break
        }
        // Also check if it's a note-like text (not the sets/reps line)
        if (text && !text.match(/\d+\s*sets?/i) && text.length < 500) {
          noteText = text
        }
      }
      
      const parsed = parseSetsReps(setsRepsText)
      
      exercises.push({
        name: exerciseName,
        ...parsed,
        ...(noteText ? { note: noteText.slice(0, 280) } : {}),
      })
    }
    
    // Alternative parsing: look for the Hevy-specific class patterns
    if (exercises.length === 0) {
      // Try finding exercise data in script tags (Next.js hydration data)
      const scripts = doc.querySelectorAll('script')
      for (const script of scripts) {
        const content = script.textContent || ''
        if (content.includes('exercises') && content.includes('sets')) {
          // Try to extract JSON data
          const jsonMatch = content.match(/"exercises"\s*:\s*(\[[\s\S]*?\])/);
          if (jsonMatch) {
            try {
              // This is a simplified extraction - real data may need more parsing
              const match = content.match(/"title"\s*:\s*"([^"]+)"/)
              if (match) routineName = match[1]
            } catch (e) {
              // JSON parsing failed, continue with regex approach
            }
          }
        }
      }
    }
  }
  
  // Regex fallback for non-browser or if DOM parsing found nothing
  if (exercises.length === 0) {
    // Extract routine name from title tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (titleMatch) {
      routineName = titleMatch[1]
        .replace(/\s*[|–-]\s*Hevy.*$/i, '')
        .replace(/Routine:\s*/i, '')
        .trim() || 'Imported Routine'
    }
    
    // Try h2 as well
    const h2Match = html.match(/<h2[^>]*>([^<]+)<\/h2>/i)
    if (h2Match) {
      routineName = h2Match[1].trim() || routineName
    }
    
    // Find exercise names in h5 tags
    const h5Pattern = /<h5[^>]*>([^<]+)<\/h5>/gi
    let h5Match
    while ((h5Match = h5Pattern.exec(html)) !== null) {
      const exerciseName = h5Match[1].trim()
      if (!exerciseName) continue
      
      // Look for sets/reps after this h5
      const afterH5 = html.slice(h5Match.index)
      const setsRepsMatch = afterH5.match(/(\d+)\s*sets?\s*[·•]\s*(\d+)(?:-(\d+))?\s*reps?/i)
      
      let parsed = { sets: 3, reps: 10 }
      if (setsRepsMatch) {
        parsed.sets = parseInt(setsRepsMatch[1], 10)
        if (setsRepsMatch[3]) {
          parsed.repsMin = parseInt(setsRepsMatch[2], 10)
          parsed.reps = parseInt(setsRepsMatch[3], 10)
        } else {
          parsed.reps = parseInt(setsRepsMatch[2], 10)
        }
      }
      
      exercises.push({
        name: exerciseName,
        ...parsed,
      })
    }
  }
  
  if (exercises.length === 0) {
    return { 
      error: 'no-exercises', 
      message: 'Could not find any exercises in the HTML. Make sure you copied the full page source.' 
    }
  }
  
  // Convert to openGym routine format
  const customExercises = []
  const unmatchedNames = []
  let matched = 0
  
  const routineExercises = exercises.map(ex => {
    let id = matchHevyExerciseName(ex.name)
    
    if (id) {
      matched++
    } else {
      // Create a custom exercise for unmatched names
      const customId = 'im' + uid()
      id = customId
      unmatchedNames.push(ex.name)
      
      // Guess body part from exercise name
      const bp = guessBodyPart(ex.name)
      
      customExercises.push({
        id: customId,
        n: ex.name.toLowerCase(),
        custom: true,
        eq: 'custom',
        tg: '',
        desc: '',
        bp,
      })
    }
    
    const config = {
      id,
      sets: ex.sets || 3,
      reps: ex.reps || 10,
      weight: 0,
      mode: ex.mode || 'reps',
    }
    
    if (ex.repsMin) config.repsMin = ex.repsMin
    if (ex.sec) config.sec = ex.sec
    if (ex.note) config.note = ex.note
    
    return config
  })
  
  const routine = {
    id: 'hr' + uid(),
    name: routineName,
    emoji: 'figureStrength',
    ex: routineExercises,
  }
  
  return {
    kind: 'routines',
    source: 'Hevy (HTML)',
    routines: [routine],
    customEx: customExercises,
    matched,
    created: customExercises.length,
    unmatchedNames: [...new Set(unmatchedNames)].sort(),
    exerciseCount: routineExercises.length,
  }
}

/**
 * Guess body part from exercise name for custom exercises
 */
function guessBodyPart(name) {
  const n = String(name || '').toLowerCase()
  
  if (/bench|chest|pec|fly|push.?up|dip/i.test(n)) return 'chest'
  if (/row|pull|lat|back|deadlift|shrug/i.test(n)) return 'back'
  if (/shoulder|delt|press|lateral|raise|face.?pull/i.test(n)) return 'shoulders'
  if (/bicep|curl|tricep|arm|extension|pushdown|skull/i.test(n)) return 'upper arms'
  if (/forearm|wrist|grip/i.test(n)) return 'lower arms'
  if (/squat|leg|lunge|quad|hamstring|glute|hip/i.test(n)) return 'upper legs'
  if (/calf|calves/i.test(n)) return 'lower legs'
  if (/ab|core|plank|crunch|oblique/i.test(n)) return 'waist'
  if (/run|bike|cardio|row|elliptical|treadmill/i.test(n)) return 'cardio'
  if (/neck/i.test(n)) return 'neck'
  
  return 'upper legs' // default fallback
}

/**
 * Merge parsed Hevy HTML routines into state.
 * Uses the same merge logic as the API import.
 */
export function mergeHevyHtmlRoutines(S, parsed) {
  S.customEx = S.customEx || []
  S.routines = S.routines || []
  
  const exIdMap = {}
  
  // Add custom exercises, mapping duplicates
  for (const c of parsed.customEx || []) {
    const same = S.customEx.find(x => 
      (x.n || '').toLowerCase() === (c.n || '').toLowerCase() && x.bp === c.bp
    )
    if (same) {
      exIdMap[c.id] = same.id
    } else if (!S.customEx.some(x => x.id === c.id)) {
      S.customEx.push(c)
    }
  }
  
  // Add routines
  let added = 0
  for (const r of parsed.routines || []) {
    const ex = (r.ex || []).map(e => ({
      ...e,
      id: exIdMap[e.id] || e.id,
    }))
    
    S.routines.push({
      id: uid(),
      name: r.name,
      emoji: r.emoji || 'figureStrength',
      ex,
    })
    added++
  }
  
  return { added, updated: 0 }
}
