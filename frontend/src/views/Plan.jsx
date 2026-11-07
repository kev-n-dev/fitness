import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, DAYS, weekOrder, weekStartOf, uid, exCount, routineCount, todayISO, fmtDate, fmtNum, MONTHS_LONG } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import {
  dayAssignSheet, starterPlanSheet, confirmSheet, menuSheet,
  planHasRoutines, exportPlanFile, printWholePlan, importPlanFile,
} from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Row, Section, Segmented } from '../components/ui.jsx'
import SwipeRow from '../components/SwipeRow.jsx'
import { copyRoutine, deleteRoutine, restoreRoutine, routineSnapshot } from '../lib/routines.js'
import { workoutControls } from '../lib/workout-controls.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { useListReorder, moved } from '../lib/use-list-reorder.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable } from '../lib/coach.js'
import { queueOf, queueView } from '../lib/queue.js'
import { deriveSessionName } from '../lib/session-merge.js'
import { markUndone, undoMarks } from '../lib/sync-merge.js'
import {
  scheduleModeOf, queueRecovery, rotationIds, saveRotation, startNewPass, startPass, stopPass,
  chooseRotation, chooseFixedWeek,
} from '../lib/rotation.js'
import { DEFAULT_GOALS } from './Nutrition.jsx'

// Plan view mode: routines or meals (for the calendar)
export const PLAN_VIEW_KEY = 'gym_plan_view'
const readView = () => {
  try { 
    const v = localStorage.getItem(PLAN_VIEW_KEY)
    return ['routines', 'meals'].includes(v) ? v : 'routines'
  } catch { return 'routines' }
}

/* Undo for Plan's two removals (v1.3.11). Both go through the store's normal update, so sync
   sees an ordinary edit (a routine put back clears its own removal stamp, lib/sync-merge.js). */

/** Deletes a routine with an Undo toast in place of a confirm: the toast puts it back exactly,
 *  list place, weekdays, reschedules and loop included (lib/routines.js routineSnapshot). */
export function deleteRoutineWithUndo(id) {
  const st = useStore.getState()
  const snap = routineSnapshot(st.S, id)
  if (!snap) return false
  const before = st.S
  st.update(s => { deleteRoutine(s, id) })
  snap.marks = undoMarks(before, useStore.getState().S)
  useUI.getState().toast(t('"{0}" gone.', snap.routine.name), { action: t('Undo'), onAction: () => undoDeleteRoutine(snap) })
  return true
}
export function undoDeleteRoutine(snap) {
  let ok = false
  useStore.getState().update(s => { ok = restoreRoutine(s, snap); if (ok && snap.marks) markUndone(s, snap.marks) })
  if (!ok) useUI.getState().toast(t('It\'s already back.'))
  return ok
}

/** Takes a routine out of the loop (the swipe and the edit-mode minus), with an Undo. */
export function takeOutOfLoop(id, setSeq, seq, label) {
  const at = seq.indexOf(id)
  if (at < 0) return false
  const before = useStore.getState().S
  const snap = structuredClone({ rotation: before.rotation ?? null, queue: before.queue ?? null, dayPlan: before.dayPlan ?? {} })
  setSeq(seq.filter(x => x !== id))
  const after = useStore.getState().S
  const mark = loopMark(after)
  const marks = undoMarks(before, after)
  const name = before.routines.find(r => r.id === id)?.name ?? id
  useUI.getState().toast(t('"{0}" is out of the loop.', name), { action: t('Undo'), onAction: () => undoTakeOut({ id, at, label, snap, mark, marks }) })
  return true
}
const loopMark = S => JSON.stringify([S.rotation ?? null, S.queue ?? null, S.scheduleMode ?? null])
export function undoTakeOut({ id, at, label, snap, mark, marks }) {
  if (!useStore.getState().S.routines.some(r => r.id === id)) {
    useUI.getState().toast(t('Too late, that one\'s gone'))
    return false
  }
  useStore.getState().update(s => {
    if (loopMark(s) === mark) {
      s.rotation = snap.rotation
      s.queue = snap.queue
      const pins = Object.entries(snap.dayPlan).filter(([iso]) => s.dayPlan?.[iso] == null)
      if (pins.length) s.dayPlan = { ...(s.dayPlan || {}), ...Object.fromEntries(pins) }
      if (marks) markUndone(s, marks)
      return
    }
    const q = queueOf(s)
    const ours = scheduleModeOf(s) === 'rotation' && (!s.queue || (!!q && !!s.rotation && q.rotationId === s.rotation.id))
    if (!ours) {
      const seq = Array.isArray(s.rotation?.sequence) ? s.rotation.sequence : null
      if (seq && !seq.includes(id)) {
        const next = seq.slice()
        next.splice(Math.min(at, next.length), 0, id)
        s.rotation = { ...s.rotation, sequence: next }
      }
      return
    }
    const ids = q?.ids ?? rotationIds(s)
    if (ids.includes(id)) return
    const next = ids.slice()
    next.splice(Math.min(at, next.length), 0, id)
    saveRotation(s, next, s.queue?.label || s.rotation?.label || label)
  })
  return true
}

let flashSeq = 0

// Generate calendar days for the current month plus overflow weeks
function getCalendarDays(year, month, weekStart) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const days = []
  
  // Find the start of the calendar (first day of the week containing the 1st)
  const startOffset = (firstDay.getDay() - weekStart + 7) % 7
  const calStart = new Date(year, month, 1 - startOffset)
  
  // Generate 6 weeks (42 days) to ensure we cover the full month view
  for (let i = 0; i < 42; i++) {
    const d = new Date(calStart)
    d.setDate(calStart.getDate() + i)
    days.push(d.toISOString().slice(0, 10))
  }
  
  return days
}

// Get week days for a specific week starting from a date
function getWeekDays(startDate, weekStart) {
  const days = []
  // Parse as local date to avoid timezone issues
  const [y, m, dd] = startDate.split('-').map(Number)
  const d = new Date(y, m - 1, dd)
  // Adjust to week start
  const currentDay = d.getDay()
  const diff = (currentDay - weekStart + 7) % 7
  d.setDate(d.getDate() - diff)
  
  for (let i = 0; i < 7; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)
    // Format as YYYY-MM-DD without timezone conversion
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    days.push(iso)
  }
  return days
}

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  const [view, setViewState] = useState(readView)
  const [selectedDay, setSelectedDay] = useState(todayISO())
  const [calendarView, setCalendarView] = useState('week') // 'week' or 'month'
  const [showRoutineManager, setShowRoutineManager] = useState(false)
  
  const setView = v => {
    setViewState(v)
    try { localStorage.setItem(PLAN_VIEW_KEY, v) } catch {}
  }

  const showCoach = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })
  const mode = scheduleModeOf(S)
  const ws = weekStartOf(S)
  const today = todayISO()
  
  // Calendar navigation
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  
  const calendarDays = useMemo(() => {
    if (calendarView === 'week') {
      return getWeekDays(selectedDay, ws)
    }
    return getCalendarDays(calMonth.year, calMonth.month, ws)
  }, [calendarView, calMonth, selectedDay, ws])
  
  const prevPeriod = () => {
    if (calendarView === 'week') {
      const d = new Date(selectedDay)
      d.setDate(d.getDate() - 7)
      setSelectedDay(d.toISOString().slice(0, 10))
    } else {
      setCalMonth(m => {
        const newMonth = m.month - 1
        return newMonth < 0 
          ? { year: m.year - 1, month: 11 }
          : { year: m.year, month: newMonth }
      })
    }
  }
  
  const nextPeriod = () => {
    if (calendarView === 'week') {
      const d = new Date(selectedDay)
      d.setDate(d.getDate() + 7)
      setSelectedDay(d.toISOString().slice(0, 10))
    } else {
      setCalMonth(m => {
        const newMonth = m.month + 1
        return newMonth > 11 
          ? { year: m.year + 1, month: 0 }
          : { year: m.year, month: newMonth }
      })
    }
  }
  
  const goToToday = () => {
    setSelectedDay(todayISO())
    const d = new Date()
    setCalMonth({ year: d.getFullYear(), month: d.getMonth() })
  }

  // Share/import menu
  const openMenu = () => {
    const has = planHasRoutines(S)
    menuSheet({
      title: t('Plan'),
      subtitle: has ? null : t('Add an exercise to a routine first. An empty plan has nothing to share.'),
      items: [
        { icon: 'share', label: t('Export plan file'), sub: t('A small file a friend can import into their own openGym.'), disabled: !has, onClick: exportPlanFile },
        { icon: 'note', label: t('Print / Save as PDF'), disabled: !has, onClick: printWholePlan },
        { icon: 'download', label: t('Import a plan file'), onClick: () => fileRef.current?.click() },
        { icon: 'clipboard', label: t('Load starter plan'), onClick: starterPlanSheet },
      ],
    })
  }
  const pickFile = ev => { const f = ev.target.files[0]; ev.target.value = ''; importPlanFile(f) }

  // Workout data helpers
  const routineOf = id => S.routines.find(x => x.id === id)
  const dayRoutines = d => {
    const dow = new Date(d).getDay()
    return [].concat(S.week[dow] || []).map(routineOf).filter(Boolean)
  }
  
  // Meal data helpers
  const recipes = S.recipes || []
  const plannedMeals = S.plannedMeals || {}
  const goals = { ...DEFAULT_GOALS, ...(S.nutritionGoals || {}) }
  
  const mealsForDay = (day) => (plannedMeals[day] || []).map(pm => ({
    ...pm,
    recipe: recipes.find(r => r.id === pm.recipeId)
  })).filter(pm => pm.recipe)
  
  const dayMacros = (day) => {
    const meals = mealsForDay(day)
    return meals.reduce((acc, pm) => {
      const n = pm.recipe.nutrition || {}
      const servings = pm.servings || 1
      return {
        calories: acc.calories + ((n.calories || 0) * servings),
        protein: acc.protein + ((n.protein || 0) * servings),
        carbs: acc.carbs + ((n.carbs || 0) * servings),
        fat: acc.fat + ((n.fat || 0) * servings),
      }
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
  }

  // Day click handler
  const handleDayClick = (day) => {
    setSelectedDay(day)
    if (view === 'routines') {
      // Open workout planning for that day
      const dow = new Date(day).getDay()
      dayAssignSheet(dow)
    } else {
      // For meals, open add meal menu if there are recipes, otherwise go to recipes
      if (!recipes.length) {
        nav('/ranks/recipe')
        return
      }
      menuSheet({
        title: t('Add meal for {0}', fmtDate(day, true)),
        items: recipes.map(r => ({
          icon: 'leaf',
          label: r.name,
          sub: r.nutrition?.calories ? `${r.nutrition.calories} kcal` : undefined,
          onClick: () => {
            update(s => {
              if (!s.plannedMeals) s.plannedMeals = {}
              if (!s.plannedMeals[day]) s.plannedMeals[day] = []
              s.plannedMeals[day].push({ recipeId: r.id, servings: 1 })
            })
          }
        }))
      })
    }
  }

  // Period label
  const periodLabel = calendarView === 'week'
    ? (() => {
        const start = new Date(calendarDays[0])
        const end = new Date(calendarDays[6])
        if (start.getMonth() === end.getMonth()) {
          return `${t(MONTHS_LONG[start.getMonth()])} ${start.getFullYear()}`
        }
        return `${t(MONTHS_LONG[start.getMonth()]).slice(0, 3)} – ${t(MONTHS_LONG[end.getMonth()]).slice(0, 3)} ${end.getFullYear()}`
      })()
    : `${t(MONTHS_LONG[calMonth.month])} ${calMonth.year}`

  return <div className="narrow plan">
    <div className="hdr">
      <div>
        <h1>{t('Train')}</h1>
        <div className="sub">{view === 'routines' 
          ? (mode === 'rotation' ? t('Your routines in a loop') : t('Your weekly routine'))
          : t('Plan your meals')}</div>
      </div>
      <div className="hdr-actions">
        {showCoach && <Button size="sm" variant="tinted" icon="sparkles" onClick={() => nav('/coach')}>{t('Coach')}</Button>}
        <button className="iconbtn" onClick={openMenu} aria-label={t('Plan options')} title={t('Plan options')}><Icon name="share" /></button>
      </div>
    </div>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
    
    {/* Main toggle: Routines vs Meals */}
    <Segmented className="plan-views" value={view} onChange={setView}
      options={[{ value: 'routines', label: t('Workouts') }, { value: 'meals', label: t('Meals') }]} />
    
    {/* Calendar controls */}
    <div className="plan-cal-controls">
      <div className="row" style={{ gap: 8 }}>
        <button className="iconbtn" onClick={prevPeriod} aria-label={t('Previous')}>
          <Icon name="chevronLeft" />
        </button>
        <button className="plan-period-btn" onClick={goToToday}>
          <span className="plan-period-label">{periodLabel}</span>
        </button>
        <button className="iconbtn" onClick={nextPeriod} aria-label={t('Next')}>
          <Icon name="chevronRight" />
        </button>
      </div>
      <Segmented className="seg-inline" value={calendarView} onChange={setCalendarView}
        options={[{ value: 'week', label: t('Week') }, { value: 'month', label: t('Month') }]} />
    </div>
    
    {/* Calendar grid */}
    <div className={`plan-calendar ${calendarView}`}>
      {/* Day headers */}
      <div className="plan-cal-header">
        {weekOrder(ws).map(d => (
          <div key={d} className="plan-cal-dow">{t(DAYS[d])}</div>
        ))}
      </div>
      
      {/* Calendar days */}
      <div className="plan-cal-grid">
        {calendarDays.map(day => {
          const d = new Date(day)
          const isToday = day === today
          const isSelected = day === selectedDay
          const isCurrentMonth = calendarView === 'month' && d.getMonth() === calMonth.month
          const isPast = day < today
          
          // Get content for this day
          const routines = dayRoutines(day)
          const meals = mealsForDay(day)
          const macros = dayMacros(day)
          
          const hasWorkout = routines.length > 0
          const hasMeals = meals.length > 0
          
          return (
            <button
              key={day}
              className={[
                'plan-cal-day',
                isToday && 'is-today',
                isSelected && 'is-selected',
                calendarView === 'month' && !isCurrentMonth && 'is-other-month',
                isPast && 'is-past',
              ].filter(Boolean).join(' ')}
              onClick={() => handleDayClick(day)}
              aria-label={`${fmtDate(day, true)}${hasWorkout ? `, ${routines.length} workout${routines.length > 1 ? 's' : ''}` : ''}${hasMeals ? `, ${meals.length} meal${meals.length > 1 ? 's' : ''}` : ''}`}
              aria-pressed={isSelected}
            >
              <span className="plan-cal-num">{d.getDate()}</span>
              <div className="plan-cal-dots">
                {view === 'routines' ? (
                  hasWorkout && <span className="plan-cal-dot workout" title={routines.map(r => r.name).join(', ')} />
                ) : (
                  hasMeals && <span className="plan-cal-dot meal" title={`${meals.length} meals`} />
                )}
                {/* Show both indicators as secondary dots */}
                {view === 'routines' && hasMeals && <span className="plan-cal-dot meal secondary" />}
                {view === 'meals' && hasWorkout && <span className="plan-cal-dot workout secondary" />}
              </div>
              {calendarView === 'week' && (
                <div className="plan-cal-preview">
                  {view === 'routines' ? (
                    hasWorkout 
                      ? <span className="plan-cal-preview-text">{routines[0].name}{routines.length > 1 ? ` +${routines.length - 1}` : ''}</span>
                      : <span className="plan-cal-preview-text dim">{t('Rest')}</span>
                  ) : (
                    hasMeals
                      ? <span className="plan-cal-preview-text">{Math.round(macros.calories)} kcal</span>
                      : <span className="plan-cal-preview-text dim">{t('No meals')}</span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
    
    {/* Selected day detail panel */}
    <div className="plan-detail-panel">
      <div className="plan-detail-header">
        <div>
          <h3 style={{ margin: 0 }}>{fmtDate(selectedDay, true)}</h3>
          {selectedDay === today && <span className="tag acc">{t('Today')}</span>}
        </div>
        {view === 'routines' ? (
          <Button size="sm" variant="tinted" icon="pencil" onClick={() => {
            const dow = new Date(selectedDay).getDay()
            dayAssignSheet(dow)
          }}>{t('Edit')}</Button>
        ) : (
          <Button size="sm" variant="tinted" icon="plus" onClick={() => {
            if (!recipes.length) {
              nav('/ranks/recipe')
              return
            }
            menuSheet({
              title: t('Add meal'),
              items: recipes.map(r => ({
                icon: 'leaf',
                label: r.name,
                sub: r.nutrition?.calories ? `${r.nutrition.calories} kcal` : undefined,
                onClick: () => {
                  update(s => {
                    if (!s.plannedMeals) s.plannedMeals = {}
                    if (!s.plannedMeals[selectedDay]) s.plannedMeals[selectedDay] = []
                    s.plannedMeals[selectedDay].push({ recipeId: r.id, servings: 1 })
                  })
                }
              }))
            })
          }}>{t('Add')}</Button>
        )}
      </div>
      
      {view === 'routines' ? (
        <WorkoutDayDetail day={selectedDay} S={S} nav={nav} />
      ) : (
        <MealDayDetail day={selectedDay} S={S} update={update} nav={nav} goals={goals} />
      )}
    </div>
    
    {/* Quick actions */}
    <div className="plan-actions">
      <Button variant="ghost" icon="dumbbell" onClick={() => setShowRoutineManager(true)} style={{ flex: 1 }}>
        {t('Manage Routines')}
      </Button>
      <Button variant="ghost" icon="book" onClick={() => nav('/ranks/recipe')} style={{ flex: 1 }}>
        {t('Recipes')}
      </Button>
    </div>
    
    {/* Quick links - context-aware based on view */}
    <Section className="plan-links">
      {view === 'routines' ? (
        <>
          <Row icon="search" iconTint="var(--blue)" title={t('Exercise Library')} accessory="chevron" onClick={() => nav('/library')} />
          <Row icon="chart" iconTint="var(--indigo)" title={t('Stats & Progress')} accessory="chevron" onClick={() => nav('/stats')} />
        </>
      ) : (
        <>
          <Row icon="book" iconTint="var(--orange)" title={t('Recipes')} accessory="chevron" onClick={() => nav('/ranks/recipe')} />
          <Row icon="leaf" iconTint="var(--green)" title={t('Macros & Nutrition')} accessory="chevron" onClick={() => nav('/nutrition')} />
        </>
      )}
    </Section>
    
    {/* Routine manager modal */}
    {showRoutineManager && (
      <RoutineManager S={S} update={update} nav={nav} onClose={() => setShowRoutineManager(false)} />
    )}
  </div>
}

/* ================================ Workout Day Detail ================================ */

function WorkoutDayDetail({ day, S, nav }) {
  const dow = new Date(day).getDay()
  const routineOf = id => S.routines.find(x => x.id === id)
  const routines = [].concat(S.week[dow] || []).map(routineOf).filter(Boolean)
  const mode = scheduleModeOf(S)
  
  // For rotation mode, show what's next
  const liveQ = queueOf(S)
  const seq = liveQ?.ids ?? rotationIds(S)
  const qv = liveQ ? queueView(S, todayISO()) : null
  
  if (mode === 'rotation' && seq.length > 0) {
    const nextItem = qv?.items.find(i => i.state === 'next')
    const nextRoutine = nextItem ? routineOf(seq[qv.items.indexOf(nextItem)]) : null
    
    return (
      <div className="plan-detail-content">
        <div className="plan-detail-rotation-info">
          <div className="small dim">{t('Rotation mode active')}</div>
          {nextRoutine && (
            <div className="plan-next-workout">
              <Icon name={glyphOf(nextRoutine.emoji)} />
              <div>
                <div style={{ fontWeight: 500 }}>{t('Up next')}: {nextRoutine.name}</div>
                <div className="small dim">{exCount(nextRoutine.ex.length)}</div>
              </div>
            </div>
          )}
        </div>
        {routines.length > 0 && (
          <>
            <div className="small dim" style={{ marginTop: 12 }}>{t('Also scheduled on {0}:', t(DAYS[dow]))}</div>
            {routines.map(r => (
              <div key={r.id} className="plan-detail-routine" {...tappable(() => nav('/plan/r/' + r.id))}>
                <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
                <div className="grow">
                  <div className="tt">{r.name}</div>
                  <div className="ss">{exCount(r.ex.length)}</div>
                </div>
                <Icon name="chevronRight" className="chev" />
              </div>
            ))}
          </>
        )}
      </div>
    )
  }
  
  if (routines.length === 0) {
    return (
      <div className="plan-detail-empty">
        <Icon name="moon" style={{ fontSize: 24, opacity: 0.5, marginBottom: 8 }} />
        <div className="muted">{t('Rest day')}</div>
        <div className="small dim">{t('Tap Edit to schedule a workout')}</div>
      </div>
    )
  }
  
  return (
    <div className="plan-detail-content">
      {routines.map(r => (
        <div key={r.id} className="plan-detail-routine" {...tappable(() => nav('/plan/r/' + r.id))}>
          <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
          <div className="grow">
            <div className="tt">{r.name}</div>
            <div className="ss">{exCount(r.ex.length)}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
      ))}
    </div>
  )
}

/* ================================ Meal Day Detail ================================ */

function MealDayDetail({ day, S, update, nav, goals }) {
  const recipes = S.recipes || []
  const plannedMeals = S.plannedMeals || {}
  const isToday = day === todayISO()
  
  const meals = (plannedMeals[day] || []).map(pm => ({
    ...pm,
    recipe: recipes.find(r => r.id === pm.recipeId)
  })).filter(pm => pm.recipe)
  
  const macros = meals.reduce((acc, pm) => {
    const n = pm.recipe.nutrition || {}
    const servings = pm.servings || 1
    return {
      calories: acc.calories + ((n.calories || 0) * servings),
      protein: acc.protein + ((n.protein || 0) * servings),
      carbs: acc.carbs + ((n.carbs || 0) * servings),
      fat: acc.fat + ((n.fat || 0) * servings),
    }
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
  
  const updateServings = (index, servings) => {
    update(s => {
      if (s.plannedMeals?.[day]?.[index]) {
        s.plannedMeals[day][index].servings = Math.max(0.5, servings)
      }
    })
  }
  
  const removeFromDay = (index) => {
    update(s => {
      if (s.plannedMeals?.[day]) {
        s.plannedMeals[day].splice(index, 1)
        if (s.plannedMeals[day].length === 0) delete s.plannedMeals[day]
      }
    })
  }
  
  const logMeal = (meal) => {
    const recipe = meal.recipe
    if (!recipe) return
    const servings = meal.servings || 1
    const n = recipe.nutrition || {}
    update(s => {
      if (!s.meals) s.meals = []
      s.meals.push({
        id: uid(),
        name: recipe.name + (servings !== 1 ? ` (×${servings})` : ''),
        time: new Date().toISOString(),
        nutrition: {
          calories: Math.round((n.calories || 0) * servings),
          protein: Math.round((n.protein || 0) * servings),
          carbs: Math.round((n.carbs || 0) * servings),
          fat: Math.round((n.fat || 0) * servings),
          fiber: Math.round((n.fiber || 0) * servings),
          sugar: Math.round((n.sugar || 0) * servings),
          saturatedFat: Math.round((n.saturatedFat || 0) * servings),
          sodium: Math.round((n.sodium || 0) * servings),
          water: Math.round((n.water || 0) * servings),
        },
        recipeId: recipe.id,
      })
    })
    useUI.getState().toast(t('Logged {0}', recipe.name))
  }
  
  if (meals.length === 0) {
    return (
      <div className="plan-detail-empty">
        <span style={{ fontSize: 24, marginBottom: 8 }}>🥗</span>
        <div className="muted">{t('No meals planned')}</div>
        <div className="small dim">{t('Tap Add to plan meals')}</div>
        {!recipes.length && (
          <Button size="sm" variant="tinted" style={{ marginTop: 12 }} onClick={() => nav('/ranks/recipe')}>
            {t('Create your first recipe')}
          </Button>
        )}
      </div>
    )
  }
  
  return (
    <div className="plan-detail-content">
      {/* Macro summary */}
      <div className="plan-macros-grid">
        <div className="plan-macro">
          <div className="plan-macro-value" style={{ color: macros.calories > goals.calories ? 'var(--red)' : 'var(--green)' }}>
            {Math.round(macros.calories)}
          </div>
          <div className="plan-macro-label">/ {goals.calories} kcal</div>
        </div>
        <div className="plan-macro">
          <div className="plan-macro-value" style={{ color: 'var(--blue)' }}>{Math.round(macros.protein)}g</div>
          <div className="plan-macro-label">{t('Protein')}</div>
        </div>
        <div className="plan-macro">
          <div className="plan-macro-value" style={{ color: 'var(--orange)' }}>{Math.round(macros.carbs)}g</div>
          <div className="plan-macro-label">{t('Carbs')}</div>
        </div>
        <div className="plan-macro">
          <div className="plan-macro-value" style={{ color: 'var(--yellow)' }}>{Math.round(macros.fat)}g</div>
          <div className="plan-macro-label">{t('Fat')}</div>
        </div>
      </div>
      
      {/* Meal list */}
      {meals.map((pm, i) => (
        <div key={i} className="plan-meal-item">
          <div className="plan-meal-info">
            <div className="plan-meal-name">{pm.recipe.name}</div>
            <div className="plan-meal-macros">
              {pm.recipe.nutrition?.calories && `${Math.round(pm.recipe.nutrition.calories * pm.servings)} kcal`}
              {pm.recipe.nutrition?.protein && ` · ${Math.round(pm.recipe.nutrition.protein * pm.servings)}g P`}
            </div>
          </div>
          <div className="plan-meal-actions">
            <div className="plan-servings">
              <button className="iconbtn small" onClick={() => updateServings(i, pm.servings - 0.5)} aria-label={t('Decrease servings')}>
                <Icon name="minus" />
              </button>
              <span className="plan-servings-value">{pm.servings}×</span>
              <button className="iconbtn small" onClick={() => updateServings(i, pm.servings + 0.5)} aria-label={t('Increase servings')}>
                <Icon name="plus" />
              </button>
            </div>
            {isToday && (
              <Button size="sm" variant="tinted" onClick={() => logMeal(pm)}>{t('Log')}</Button>
            )}
            <button className="iconbtn small" onClick={() => removeFromDay(i)} aria-label={t('Remove')}>
              <Icon name="trash" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ================================ Routine Manager ================================ */

function RoutineManager({ S, update, nav, onClose }) {
  const [edit, setEdit] = useState(false)
  const [flash, setFlash] = useState(null)
  const swipe = workoutControls(S).swipeSets
  const routines = S.routines
  const mode = scheduleModeOf(S)
  
  const reorder = useListReorder(routines.length, (from, to) => update(s => {
    if (to < 0 || to >= s.routines.length) return
    const [m] = s.routines.splice(from, 1)
    s.routines.splice(to, 0, m)
  }))

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    onClose()
    nav('/plan/r/' + r.id)
  }
  
  const remove = r => {
    deleteRoutineWithUndo(r.id)
  }
  
  const duplicate = r => {
    const copy = copyRoutine(r, t('Copy'))
    update(s => {
      const at = s.routines.findIndex(x => x.id === r.id)
      s.routines.splice(at < 0 ? s.routines.length : at + 1, 0, copy)
    })
    setFlash({ id: copy.id, n: ++flashSeq })
    useUI.getState().toast(t('Copied as "{0}".', copy.name), { action: t('Undo'), onAction: () => {
      update(s => { if (s.routines.some(x => x.id === copy.id)) deleteRoutine(s, copy.id) })
    } })
  }
  
  const order = weekOrder(weekStartOf(S))
  const daysOf = id => order.filter(d => [].concat(S.week[d] || []).includes(id)).map(d => t(DAYS[d]))
  const sub = r => [exCount(r.ex.length), daysOf(r.id).join(', ')].filter(Boolean).join(' · ')

  // Schedule mode toggle
  const setMode = v => {
    if (v === mode) return
    const liveQ = queueOf(S)
    if (v === 'rotation') { update(s => { chooseRotation(s) }); return }
    if (!liveQ) { update(s => { chooseFixedWeek(s) }); return }
    confirmSheet({
      title: t('Back to a fixed week?'),
      message: t('The loop stops. Your weekdays stay as they are, and the loop is saved for later.'),
      confirmText: t('Use Fixed Week'),
      onConfirm: () => update(s => { chooseFixedWeek(s) }),
    })
  }

  return (
    <div className="plan-routine-manager-overlay" onClick={onClose}>
      <div className="plan-routine-manager" onClick={e => e.stopPropagation()}>
        <div className="plan-routine-manager-header">
          <h2>{t('Routines')}</h2>
          <button className="iconbtn" onClick={onClose} aria-label={t('Close')}>
            <Icon name="close" />
          </button>
        </div>
        
        {/* Schedule mode toggle */}
        <Section className="plan-mode-section" footer={mode === 'rotation'
          ? t('Routines in a loop. Whatever is next stays next until you train it.')
          : t('The same routines on the same weekdays, every week.')}>
          <Row icon="repeat" iconTint="var(--orange)" title={t('How you train')}>
            <Segmented className="seg-inline" value={mode} onChange={setMode}
              options={[{ value: 'week', label: t('Fixed Week') }, { value: 'rotation', label: t('Rotation') }]} />
          </Row>
        </Section>
        
        <div className="plan-routine-manager-actions">
          {routines.length > 0 && (
            <button className="plan-textbtn" aria-pressed={edit} onClick={() => setEdit(e => !e)}>
              {edit ? t('Done') : t('Edit')}
            </button>
          )}
          <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New routine')}</Button>
        </div>
        
        {routines.length === 0 ? (
          <div className="empty" style={{ padding: '40px 20px' }}>
            <div className="ico"><Icon name="clipboard" /></div>
            {t('No routines yet.')}<br />{t('Make one, or grab the starter plan to get going.')}
            <div style={{ marginTop: 12 }}>
              <Button icon="clipboard" onClick={() => { onClose(); starterPlanSheet() }}>{t('Load starter plan')}</Button>
            </div>
          </div>
        ) : (
          <div className="plan-routine-list">
            {edit ? (
              <div className="list routine-list" ref={reorder.listRef}>
                {routines.map((r, i) => (
                  <div key={r.id} data-reorder-row className="item plan-routine" style={reorder.rowStyle(i)}>
                    <button className="plan-minus" aria-label={t('Delete {0}', r.name)} onClick={() => remove(r)}>
                      <Icon name="minus" />
                    </button>
                    <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
                    <div className="grow">
                      <div className="tt">{r.name}</div>
                      <div className="ss">{sub(r)}</div>
                    </div>
                    {routines.length > 1 && (
                      <button className="plan-handle" {...reorder.handle(i)} aria-label={t('Move {0}', r.name)}>
                        <Icon name="chevronsUpDown" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="list routine-list">
                {routines.map(r => {
                  const row = (
                    <div key={r.id} className="item plan-routine" {...tappable(() => { onClose(); nav('/plan/r/' + r.id) })}>
                      <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
                      <div className="grow">
                        <div className="tt">{r.name}</div>
                        <div className="ss">{sub(r)}</div>
                      </div>
                      <Icon name="chevronRight" className="chev" />
                    </div>
                  )
                  return swipe ? (
                    <SwipeRow key={r.id} className="swrow-item" copyLabel={t('Duplicate')}
                      onDelete={() => remove(r)} onCopy={() => duplicate(r)}
                      flash={flash?.id === r.id ? flash.n : 0}>
                      {row}
                    </SwipeRow>
                  ) : row
                })}
              </div>
            )}
            <p className="sect-f" style={{ padding: '8px 16px' }}>
              {edit ? t('Drag to reorder. Tap the minus to delete.') : t('Tap a routine to edit it.')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
