import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// ── Accolade badge ───────────────────────────────────────────────────────────

export function AccoladeBadge({ accolade, size = 'md' }) {
  const sizePx = size === 'sm' ? 36 : size === 'lg' ? 64 : 48
  const fontPx = size === 'sm' ? 18 : size === 'lg' ? 30 : 22
  return (
    <div title={accolade.name} style={{
      width: sizePx,
      height: sizePx,
      borderRadius: '50%',
      background: `color-mix(in srgb, ${accolade.color || 'var(--acc)'} 20%, var(--surface-2))`,
      border: `2px solid ${accolade.color || 'var(--acc)'}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: fontPx,
      flexShrink: 0,
    }}>
      {accolade.emoji || '🏆'}
    </div>
  )
}

// ── Challenge card ───────────────────────────────────────────────────────────

function ChallengeCard({ challenge }) {
  const pct = Math.min(100, ((challenge.progress || 0) / (challenge.goal || 1)) * 100)
  const statusColor = challenge.completed ? 'var(--green)' : challenge.expired ? 'var(--grey)' : 'var(--orange)'
  const statusLabel = challenge.completed ? 'Completed' : challenge.expired ? 'Expired' : 'Active'
  const daysLeft = challenge.endsAt ? Math.max(0, Math.ceil((challenge.endsAt - Date.now()) / 86400000)) : null

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 10 }}>
          <span style={{ fontSize: 28 }}>{challenge.emoji || '🏆'}</span>
          <div>
            <div style={{ fontWeight: 600 }}>{challenge.name}</div>
            <div className="muted small">{challenge.description}</div>
          </div>
        </div>
        <span className="tag" style={{ color: statusColor, background: `color-mix(in srgb, ${statusColor} 15%, transparent)` }}>
          {statusLabel}
        </span>
      </div>

      {/* Progress bar */}
      {!challenge.completed && !challenge.expired && (
        <>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--orange)', borderRadius: 3 }} />
          </div>
          <div className="row between">
            <span className="dim small">{challenge.progress || 0} / {challenge.goal} {challenge.unit}</span>
            {daysLeft != null && <span className="dim small">{daysLeft}d left</span>}
          </div>
        </>
      )}

      {challenge.completed && challenge.accolade && (
        <div className="row" style={{ gap: 10, marginTop: 8, padding: '8px 0', borderTop: '0.5px solid var(--sep)' }}>
          <AccoladeBadge accolade={challenge.accolade} />
          <div>
            <div className="small" style={{ fontWeight: 600 }}>Accolade earned</div>
            <div className="dim small">{challenge.accolade.name}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Accolades shelf ──────────────────────────────────────────────────────────

function AccoladesShelf({ accolades }) {
  if (!accolades?.length) return (
    <div className="card" style={{ textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 36 }}>🏅</div>
      <div className="muted small" style={{ marginTop: 8 }}>
        Complete challenges to earn accolades. They'll live on your profile permanently.
      </div>
    </div>
  )
  return (
    <div className="card">
      <h3 style={{ margin: '0 0 14px' }}>Your accolades</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {accolades.map(a => (
          <div key={a.id} style={{ textAlign: 'center', width: 60 }}>
            <AccoladeBadge accolade={a} size="md" />
            <div style={{ fontSize: 10, marginTop: 4, color: 'var(--label-3)', lineHeight: 1.2 }}>{a.name}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Placeholder challenges (seeded until API loads) ──────────────────────────

function seedChallenges(S) {
  const workoutCount = (S.workouts || []).length
  const runCount = (S.runs || []).length
  const recipeCount = (S.recipes || []).length

  return [
    {
      id: 'first-workout',
      name: 'First Rep',
      description: 'Complete your first workout',
      emoji: '🏋️',
      goal: 1,
      unit: 'workout',
      progress: Math.min(1, workoutCount),
      completed: workoutCount >= 1,
      accolade: { id: 'first-workout', name: 'First Rep', emoji: '🏋️', color: 'var(--blue)' },
    },
    {
      id: 'ten-workouts',
      name: 'Getting Consistent',
      description: 'Log 10 workouts',
      emoji: '🔥',
      goal: 10,
      unit: 'workouts',
      progress: Math.min(10, workoutCount),
      completed: workoutCount >= 10,
      accolade: { id: 'ten-workouts', name: 'Getting Consistent', emoji: '🔥', color: 'var(--orange)' },
    },
    {
      id: 'first-run',
      name: 'First Mile',
      description: 'Log your first run',
      emoji: '🏃',
      goal: 1,
      unit: 'run',
      progress: Math.min(1, runCount),
      completed: runCount >= 1,
      accolade: { id: 'first-run', name: 'First Mile', emoji: '🏃', color: 'var(--green)' },
    },
    {
      id: 'first-recipe',
      name: 'Chef',
      description: 'Create your first recipe',
      emoji: '🍴',
      goal: 1,
      unit: 'recipe',
      progress: Math.min(1, recipeCount),
      completed: recipeCount >= 1,
      accolade: { id: 'first-recipe', name: 'Chef', emoji: '🍴', color: 'var(--orange)' },
    },
    {
      id: 'fifty-workouts',
      name: 'Dedicated',
      description: 'Log 50 workouts',
      emoji: '💪',
      goal: 50,
      unit: 'workouts',
      progress: Math.min(50, workoutCount),
      completed: workoutCount >= 50,
      accolade: { id: 'fifty-workouts', name: 'Dedicated', emoji: '💪', color: 'var(--acc)' },
    },
  ]
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function Challenges() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const challenges = seedChallenges(S)
  // Merge with any server challenges stored in S.challenges
  const allChallenges = [...challenges, ...(S.challenges || [])]
  const earned = allChallenges.filter(c => c.completed).map(c => c.accolade).filter(Boolean)
  const active = allChallenges.filter(c => !c.completed && !c.expired)
  const completed = allChallenges.filter(c => c.completed)

  return (
    <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/ranks')} aria-label="Back">
          <Icon name="chevronLeft" />
        </button>
        <div>
          <h1>Challenges</h1>
          <div className="sub">{earned.length} accolade{earned.length !== 1 ? 's' : ''} earned</div>
        </div>
        <div style={{ width: 36 }} />
      </div>

      <AccoladesShelf accolades={earned} />

      {active.length > 0 && (
        <>
          <div style={{ margin: '20px 0 10px' }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Active challenges</h2>
          </div>
          {active.map(c => <ChallengeCard key={c.id} challenge={c} />)}
        </>
      )}

      {completed.length > 0 && (
        <>
          <div style={{ margin: '20px 0 10px' }}>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--label-2)' }}>Completed</h2>
          </div>
          {completed.map(c => <ChallengeCard key={c.id} challenge={c} />)}
        </>
      )}
    </div>
  )
}
