import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { t } from '../lib/i18n.js'
import { getCachedVitals } from '../lib/health-read.js'

// ── Accolade badge ────────────────────────────────────────────────────────────

export function AccoladeBadge({ accolade, size = 'md' }) {
  const px   = size === 'sm' ? 36 : size === 'lg' ? 64 : 48
  const font = size === 'sm' ? 18 : size === 'lg' ? 30 : 22
  return (
    <div title={accolade.name} aria-label={accolade.name} style={{
      width: px, height: px, borderRadius: '50%', flexShrink: 0,
      background: `color-mix(in srgb, ${accolade.color || 'var(--acc)'} 20%, var(--surface-2))`,
      border: `2px solid ${accolade.color || 'var(--acc)'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: font,
    }}>
      {accolade.emoji || '🏆'}
    </div>
  )
}

// ── Single challenge row ──────────────────────────────────────────────────────

function ChallengeRow({ c }) {
  const pct      = Math.min(100, ((c.progress || 0) / (c.goal || 1)) * 100)
  const done     = !!c.completed
  const expired  = !!c.expired
  const daysLeft = c.endsAt ? Math.max(0, Math.ceil((c.endsAt - Date.now()) / 86400000)) : null

  return (
    <div className="challenge-row">
      <div className="challenge-emoji" aria-hidden="true">{c.emoji || '🏆'}</div>

      <div className="challenge-body">
        <div className="challenge-title-row">
          <span className="challenge-name">{c.name}</span>
          {done
            ? <span className="tag challenge-tag" style={{ color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 15%,transparent)' }}>✓ Done</span>
            : expired
              ? <span className="tag challenge-tag" style={{ color: 'var(--grey)', background: 'color-mix(in srgb,var(--grey) 15%,transparent)' }}>Expired</span>
              : daysLeft != null
                ? <span className="tag challenge-tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 15%,transparent)' }}>{daysLeft}d</span>
                : null
          }
        </div>

        <div className="dim small" style={{ marginTop: 1 }}>{c.description}</div>

        {!done && !expired && (
          <>
            <div className="challenge-bar">
              <div className="challenge-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="dim small" style={{ marginTop: 3 }}>
              {c.progress || 0} / {c.goal} {c.unit}
            </div>
          </>
        )}

        {done && c.accolade && (
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <AccoladeBadge accolade={c.accolade} size="sm" />
            <span className="small" style={{ color: c.accolade.color || 'var(--acc)' }}>{c.accolade.name}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section with collapsible list ─────────────────────────────────────────────

function ChallengeSection({ icon, label, color, challenges }) {
  const [open, setOpen] = useState(true)
  const doneCount  = challenges.filter(c => c.completed).length
  const totalCount = challenges.length

  return (
    <div className="card challenge-section">
      {/* Section header — tap to collapse */}
      <button
        className="challenge-section-header"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span className="lrow-i" style={{ background: color + '22', color, fontSize: 18 }}>
          <Icon name={icon} />
        </span>
        <div className="challenge-section-title">
          <span style={{ fontWeight: 600 }}>{label}</span>
          <span className="dim small">{doneCount} / {totalCount} done</span>
        </div>
        {/* Mini progress pill */}
        <div className="challenge-section-pill">
          <div
            className="challenge-section-pill-fill"
            style={{ width: `${totalCount ? (doneCount / totalCount) * 100 : 0}%`, background: color }}
          />
        </div>
        <Icon
          name="chevronDown"
          style={{ fontSize: 14, color: 'var(--label-3)', transition: 'transform var(--fast)', transform: open ? 'none' : 'rotate(-90deg)' }}
        />
      </button>

      {/* Challenge list */}
      {open && (
        <div className="challenge-list">
          {challenges.map((c, i) => (
            <div key={c.id} className={i < challenges.length - 1 ? 'challenge-row-wrap challenge-row-sep' : 'challenge-row-wrap'}>
              <ChallengeRow c={c} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Accolades shelf ───────────────────────────────────────────────────────────

function AccoladesShelf({ accolades }) {
  if (!accolades?.length) return (
    <div className="card" style={{ textAlign: 'center', padding: '20px 16px' }}>
      <div style={{ fontSize: 32 }}>🏅</div>
      <div className="muted small" style={{ marginTop: 8 }}>
        Complete challenges to earn accolades.
      </div>
    </div>
  )
  return (
    <div className="card">
      <h3 style={{ margin: '0 0 12px' }}>Accolades</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {accolades.map(a => (
          <div key={a.id} style={{ textAlign: 'center', width: 56 }}>
            <AccoladeBadge accolade={a} size="md" />
            <div style={{ fontSize: 10, marginTop: 4, color: 'var(--label-3)', lineHeight: 1.2 }}>{a.name}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Seeded challenges grouped by category ─────────────────────────────────────

function buildChallenges(S, vitals) {
  const workouts  = (S.workouts || []).length
  const runs      = (S.runs     || []).length
  const recipes   = (S.recipes  || []).length
  const bwEntries = (S.bodyweight || []).length
  const streak    = S._streakWeeks || 0

  // Water logged today (ml) — sum from today's meals
  const todayKey  = new Date().toISOString().slice(0, 10)
  const waterToday = (S.meals || [])
    .filter(m => m.time?.startsWith(todayKey))
    .reduce((acc, m) => acc + (m.nutrition?.water || 0), 0)
  const waterTotal = (S.meals || [])
    .reduce((acc, m) => acc + (m.nutrition?.water || 0), 0)
  const mealsToday = (S.meals || []).filter(m => m.time?.startsWith(todayKey)).length
  const mealsTotal = (S.meals || []).length

  // Steps — today from HC vitals, cumulative from S.stepsTotal (accumulated by health-sync.js)
  const stepsToday = vitals?.date === todayKey ? (vitals.steps || 0) : 0
  const stepsTotal = S.stepsTotal || 0
  const stepGoal   = S.stepGoal  || 10000

  // Count days where the step goal was hit
  const stepGoalDays = (S.stepsLog || []).filter(e => e.steps >= stepGoal).length

  const sections = [
    {
      id:    'activity',
      icon:  'steps',
      label: 'Activity',
      color: 'var(--teal)',
      challenges: [
        {
          id: 'steps-daily',
          name: 'Daily Step Goal',
          description: `Walk ${stepGoal.toLocaleString()} steps today`,
          emoji: '👣',
          goal: stepGoal, unit: 'steps',
          progress: Math.min(stepGoal, stepsToday),
          completed: stepsToday >= stepGoal,
          accolade: { id: 'steps-daily', name: 'Step Starter', emoji: '👣', color: 'var(--teal)' },
        },
        {
          id: 'steps-goal-7',
          name: 'Weekly Walker',
          description: `Hit your step goal ${7} days in a row`,
          emoji: '🚶', goal: 7, unit: 'days',
          progress: Math.min(7, stepGoalDays),
          completed: stepGoalDays >= 7,
          accolade: { id: 'steps-goal-7', name: 'Weekly Walker', emoji: '🚶', color: 'var(--teal)' },
        },
        {
          id: 'steps-100k',
          name: '100K Steps',
          description: 'Accumulate 100,000 steps total',
          emoji: '🏙️', goal: 100000, unit: 'steps',
          progress: Math.min(100000, stepsTotal),
          completed: stepsTotal >= 100000,
          accolade: { id: 'steps-100k', name: '100K Steps', emoji: '🏙️', color: 'var(--blue)' },
        },
        {
          id: 'steps-1m',
          name: 'Million Steps',
          description: 'Accumulate 1,000,000 steps total',
          emoji: '🌍', goal: 1000000, unit: 'steps',
          progress: Math.min(1000000, stepsTotal),
          completed: stepsTotal >= 1000000,
          accolade: { id: 'steps-1m', name: 'Million Steps', emoji: '🌍', color: 'var(--purple)' },
        },
        {
          id: 'steps-goal-30',
          name: 'Month on Foot',
          description: `Hit your step goal ${30} days`,
          emoji: '🗺️', goal: 30, unit: 'days',
          progress: Math.min(30, stepGoalDays),
          completed: stepGoalDays >= 30,
          accolade: { id: 'steps-goal-30', name: 'Month on Foot', emoji: '🗺️', color: 'var(--green)' },
        },
      ],
    },
    {
      id:      'strength',
      icon:    'dumbbell',
      label:   'Strength',
      color:   'var(--blue)',
      challenges: [
        {
          id: 'first-workout',
          name: 'First Rep',
          description: 'Complete your first workout',
          emoji: '🏋️', goal: 1, unit: 'workout',
          progress: Math.min(1, workouts), completed: workouts >= 1,
          accolade: { id: 'first-workout', name: 'First Rep', emoji: '🏋️', color: 'var(--blue)' },
        },
        {
          id: 'ten-workouts',
          name: 'Getting Consistent',
          description: 'Log 10 workouts',
          emoji: '🔟', goal: 10, unit: 'workouts',
          progress: Math.min(10, workouts), completed: workouts >= 10,
          accolade: { id: 'ten-workouts', name: 'Getting Consistent', emoji: '🔟', color: 'var(--blue)' },
        },
        {
          id: 'fifty-workouts',
          name: 'Dedicated',
          description: 'Log 50 workouts',
          emoji: '💪', goal: 50, unit: 'workouts',
          progress: Math.min(50, workouts), completed: workouts >= 50,
          accolade: { id: 'fifty-workouts', name: 'Dedicated', emoji: '💪', color: 'var(--indigo)' },
        },
        {
          id: 'hundred-workouts',
          name: 'Century Club',
          description: 'Log 100 workouts',
          emoji: '🎯', goal: 100, unit: 'workouts',
          progress: Math.min(100, workouts), completed: workouts >= 100,
          accolade: { id: 'hundred-workouts', name: 'Century Club', emoji: '🎯', color: 'var(--purple)' },
        },
        {
          id: 'weigh-in',
          name: 'On The Scale',
          description: 'Log your first weigh-in',
          emoji: '⚖️', goal: 1, unit: 'weigh-in',
          progress: Math.min(1, bwEntries), completed: bwEntries >= 1,
          accolade: { id: 'weigh-in', name: 'On The Scale', emoji: '⚖️', color: 'var(--yellow)' },
        },
        {
          id: 'ten-weighins',
          name: 'Tracking Progress',
          description: 'Log 10 weigh-ins',
          emoji: '📊', goal: 10, unit: 'weigh-ins',
          progress: Math.min(10, bwEntries), completed: bwEntries >= 10,
          accolade: { id: 'ten-weighins', name: 'Tracking Progress', emoji: '📊', color: 'var(--teal)' },
        },
      ],
    },
    {
      id:      'consistency',
      icon:    'flame',
      label:   'Consistency',
      color:   'var(--orange)',
      challenges: [
        {
          id: 'streak-2',
          name: 'Two-Week Streak',
          description: 'Train consistently for 2 weeks in a row',
          emoji: '🔥', goal: 2, unit: 'weeks',
          progress: Math.min(2, streak), completed: streak >= 2,
          accolade: { id: 'streak-2', name: 'On Fire', emoji: '🔥', color: 'var(--orange)' },
        },
        {
          id: 'streak-4',
          name: 'One Month Strong',
          description: 'Maintain a 4-week training streak',
          emoji: '📅', goal: 4, unit: 'weeks',
          progress: Math.min(4, streak), completed: streak >= 4,
          accolade: { id: 'streak-4', name: 'One Month Strong', emoji: '📅', color: 'var(--orange)' },
        },
        {
          id: 'streak-12',
          name: 'Quarter Year',
          description: 'Train consistently for 12 weeks',
          emoji: '🗓️', goal: 12, unit: 'weeks',
          progress: Math.min(12, streak), completed: streak >= 12,
          accolade: { id: 'streak-12', name: 'Quarter Year', emoji: '🗓️', color: 'var(--yellow)' },
        },
        {
          id: 'streak-52',
          name: 'Full Year',
          description: 'Keep a 52-week training streak',
          emoji: '🌟', goal: 52, unit: 'weeks',
          progress: Math.min(52, streak), completed: streak >= 52,
          accolade: { id: 'streak-52', name: 'Full Year', emoji: '🌟', color: 'var(--yellow)' },
        },
      ],
    },
    {
      id:      'running',
      icon:    'figureRun',
      label:   'Running',
      color:   'var(--green)',
      challenges: [
        {
          id: 'first-run',
          name: 'First Stride',
          description: 'Log your first run',
          emoji: '🏃', goal: 1, unit: 'run',
          progress: Math.min(1, runs), completed: runs >= 1,
          accolade: { id: 'first-run', name: 'First Stride', emoji: '🏃', color: 'var(--green)' },
        },
        {
          id: 'five-runs',
          name: 'Regular Runner',
          description: 'Log 5 runs',
          emoji: '👟', goal: 5, unit: 'runs',
          progress: Math.min(5, runs), completed: runs >= 5,
          accolade: { id: 'five-runs', name: 'Regular Runner', emoji: '👟', color: 'var(--green)' },
        },
        {
          id: 'twenty-runs',
          name: 'Road Warrior',
          description: 'Log 20 runs',
          emoji: '🛣️', goal: 20, unit: 'runs',
          progress: Math.min(20, runs), completed: runs >= 20,
          accolade: { id: 'twenty-runs', name: 'Road Warrior', emoji: '🛣️', color: 'var(--teal)' },
        },
        {
          id: 'fifty-runs',
          name: 'Marathon Mind',
          description: 'Log 50 runs',
          emoji: '🏅', goal: 50, unit: 'runs',
          progress: Math.min(50, runs), completed: runs >= 50,
          accolade: { id: 'fifty-runs', name: 'Marathon Mind', emoji: '🏅', color: 'var(--teal)' },
        },
      ],
    },
    {
      id:      'nutrition',
      icon:    'leaf',
      label:   'Nutrition',
      color:   'var(--teal)',
      challenges: [
        {
          id: 'first-meal',
          name: 'Food Diary',
          description: 'Log your first meal',
          emoji: '🍽️', goal: 1, unit: 'meal',
          progress: Math.min(1, mealsTotal), completed: mealsTotal >= 1,
          accolade: { id: 'first-meal', name: 'Food Diary', emoji: '🍽️', color: 'var(--teal)' },
        },
        {
          id: 'log-today',
          name: 'Today\'s Meals',
          description: 'Log 3 meals in a single day',
          emoji: '📋', goal: 3, unit: 'meals today',
          progress: Math.min(3, mealsToday), completed: mealsToday >= 3,
          accolade: { id: 'log-today', name: 'Meal Planner', emoji: '📋', color: 'var(--teal)' },
        },
        {
          id: 'water-goal',
          name: 'Hydration Hero',
          description: 'Drink 2 L of water in a day',
          emoji: '💧', goal: 2000, unit: 'ml today',
          progress: Math.min(2000, waterToday), completed: waterToday >= 2000,
          accolade: { id: 'water-goal', name: 'Hydration Hero', emoji: '💧', color: 'var(--blue)' },
        },
        {
          id: 'water-50l',
          name: 'Well Hydrated',
          description: 'Log 50 litres of water total',
          emoji: '🌊', goal: 50000, unit: 'ml total',
          progress: Math.min(50000, waterTotal), completed: waterTotal >= 50000,
          accolade: { id: 'water-50l', name: 'Well Hydrated', emoji: '🌊', color: 'var(--blue)' },
        },
        {
          id: 'fifty-meals',
          name: 'Consistent Logger',
          description: 'Log 50 meals',
          emoji: '📒', goal: 50, unit: 'meals',
          progress: Math.min(50, mealsTotal), completed: mealsTotal >= 50,
          accolade: { id: 'fifty-meals', name: 'Consistent Logger', emoji: '📒', color: 'var(--green)' },
        },
      ],
    },
    {
      id:      'recipes',
      icon:    'sparkles',
      label:   'Recipes',
      color:   'var(--orange)',
      challenges: [
        {
          id: 'first-recipe',
          name: 'Chef\'s Debut',
          description: 'Create your first recipe',
          emoji: '🍴', goal: 1, unit: 'recipe',
          progress: Math.min(1, recipes), completed: recipes >= 1,
          accolade: { id: 'first-recipe', name: 'Chef\'s Debut', emoji: '🍴', color: 'var(--orange)' },
        },
        {
          id: 'five-recipes',
          name: 'Recipe Book',
          description: 'Create 5 recipes',
          emoji: '📖', goal: 5, unit: 'recipes',
          progress: Math.min(5, recipes), completed: recipes >= 5,
          accolade: { id: 'five-recipes', name: 'Recipe Book', emoji: '📖', color: 'var(--orange)' },
        },
        {
          id: 'twenty-recipes',
          name: 'Master Chef',
          description: 'Create 20 recipes',
          emoji: '👨‍🍳', goal: 20, unit: 'recipes',
          progress: Math.min(20, recipes), completed: recipes >= 20,
          accolade: { id: 'twenty-recipes', name: 'Master Chef', emoji: '👨‍🍳', color: 'var(--yellow)' },
        },
      ],
    },
  ]

  // Merge any server / custom challenges in S.challenges into the matching section
  for (const sc of S.challenges || []) {
    const sec = sections.find(s => s.id === sc.category) || sections[0]
    if (!sec.challenges.some(c => c.id === sc.id)) sec.challenges.push(sc)
  }

  return sections
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({ sections }) {
  const total = sections.reduce((n, s) => n + s.challenges.length, 0)
  const done  = sections.reduce((n, s) => n + s.challenges.filter(c => c.completed).length, 0)
  const pct   = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{done} / {total} challenges</span>
        <span className="dim small">{pct}% complete</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--acc)', borderRadius: 3, transition: 'width .5s var(--ease)' }} />
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function Challenges() {
  const nav      = useNavigate()
  const S        = useStore(s => s.S)
  const [vitals, setVitals] = useState(null)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    getCachedVitals().then(v => { if (v?.date === today) setVitals(v) }).catch(() => {})
  }, [])

  const sections = buildChallenges(S, vitals)
  const earned   = sections
    .flatMap(s => s.challenges)
    .filter(c => c.completed && c.accolade)
    .map(c => c.accolade)

  return (
    <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/ranks')} aria-label={t('Back')}>
          <Icon name="chevronLeft" />
        </button>
        <div>
          <h1>{t('Challenges')}</h1>
          <div className="sub">{earned.length} accolade{earned.length !== 1 ? 's' : ''} earned</div>
        </div>
        <div style={{ width: 36 }} />
      </div>

      <AccoladesShelf accolades={earned} />
      <SummaryBar sections={sections} />

      {sections.map(s => (
        <ChallengeSection
          key={s.id}
          icon={s.icon}
          label={s.label}
          color={s.color}
          challenges={s.challenges}
        />
      ))}
    </div>
  )
}
