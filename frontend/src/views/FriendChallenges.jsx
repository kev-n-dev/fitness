import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button, TextField, SelectRow, Section, Row } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  const d = typeof ts === 'string' ? new Date(ts).getTime() : ts
  const diff = Date.now() - d
  if (diff < 60000)     return 'just now'
  if (diff < 3600000)   return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000)  return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return fmtDate(new Date(d).toISOString().slice(0, 10), true)
}

function daysLeft(endDate) {
  if (!endDate) return null
  const diff = new Date(endDate).getTime() - Date.now()
  if (diff <= 0) return 0
  return Math.ceil(diff / 86400000)
}

// Avatar circle — initial letter styled with a stable colour per name
function Avatar({ name, size = 36 }) {
  const colors = ['var(--blue)', 'var(--green)', 'var(--orange)', 'var(--purple)', 'var(--teal)', 'var(--pink)', 'var(--red)', 'var(--indigo)']
  let hash = 0
  for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  const color = colors[Math.abs(hash) % colors.length]
  return (
    <div aria-hidden="true" style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `color-mix(in srgb, ${color} 22%, var(--surface-2))`,
      border: `2px solid ${color}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 700, color,
    }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
}

// ── Challenge Type Labels ─────────────────────────────────────────────────────

const TYPE_LABELS = {
  beat_pr: 'Beat PR',
  workout_count: 'Complete Workouts',
  timed: 'Timed Competition',
}

const TYPE_EMOJI = {
  beat_pr: '🏋️',
  workout_count: '📊',
  timed: '⏱️',
}

const METRIC_LABELS = {
  weight: 'Weight',
  reps: 'Reps',
  both: 'Volume (W×R)',
  count: 'Count',
}

// ── Challenge Card ────────────────────────────────────────────────────────────

function ChallengeCard({ challenge, userId, onAccept, onDecline, onRefresh }) {
  const nav = useNavigate()
  const isCreator = challenge.creator.id === userId
  const isPending = challenge.status === 'pending'
  const isActive = challenge.status === 'active'
  const isCompleted = challenge.status === 'completed'
  const isDeclined = challenge.status === 'declined'
  
  const opponent = isCreator ? challenge.opponent : challenge.creator
  const days = daysLeft(challenge.endDate)
  
  // Get progress for both participants
  const myProgress = challenge.progress?.[userId]?.currentValue || 0
  const opponentProgress = challenge.progress?.[opponent.id]?.currentValue || 0
  const targetPct = challenge.targetValue ? Math.min(100, (myProgress / challenge.targetValue) * 100) : 0
  const opponentPct = challenge.targetValue ? Math.min(100, (opponentProgress / challenge.targetValue) * 100) : 0

  return (
    <div className="card" style={{ marginBottom: 12, padding: '14px' }}>
      {/* Header */}
      <div className="row" style={{ gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 28 }}>{TYPE_EMOJI[challenge.type]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {TYPE_LABELS[challenge.type]}
          </div>
          <div className="dim small" style={{ marginTop: 2 }}>
            vs {opponent.name} · {timeAgo(challenge.created)}
          </div>
        </div>
        {isPending && !isCreator && (
          <div className="row" style={{ gap: 6 }}>
            <button
              className="iconbtn"
              onClick={() => onAccept(challenge.id)}
              style={{ color: 'var(--green)' }}
              aria-label="Accept"
            >
              <Icon name="check" />
            </button>
            <button
              className="iconbtn"
              onClick={() => onDecline(challenge.id)}
              style={{ color: 'var(--red)' }}
              aria-label="Decline"
            >
              <Icon name="xmark" />
            </button>
          </div>
        )}
        {isPending && isCreator && (
          <span className="tag" style={{ 
            background: 'color-mix(in srgb, var(--orange) 15%, transparent)', 
            color: 'var(--orange)' 
          }}>
            Pending
          </span>
        )}
        {isActive && days !== null && (
          <span className="tag" style={{ 
            background: days <= 1 ? 'color-mix(in srgb, var(--red) 15%, transparent)' : 'color-mix(in srgb, var(--blue) 15%, transparent)', 
            color: days <= 1 ? 'var(--red)' : 'var(--blue)' 
          }}>
            {days}d left
          </span>
        )}
        {isCompleted && (
          <span className="tag" style={{ 
            background: 'color-mix(in srgb, var(--green) 15%, transparent)', 
            color: 'var(--green)' 
          }}>
            ✓ Done
          </span>
        )}
        {isDeclined && (
          <span className="tag" style={{ 
            background: 'color-mix(in srgb, var(--grey) 15%, transparent)', 
            color: 'var(--grey)' 
          }}>
            Declined
          </span>
        )}
      </div>

      {/* Challenge Details */}
      <div style={{ 
        padding: '10px 12px', 
        background: 'var(--surface-2)', 
        borderRadius: 8,
        marginBottom: 12,
      }}>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
          <span className="dim">Target</span>
          <span style={{ fontWeight: 500 }}>
            {challenge.targetValue} {challenge.metric !== 'count' ? METRIC_LABELS[challenge.metric] : 'workouts'}
          </span>
        </div>
        {challenge.exerciseId && (
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, marginTop: 6 }}>
            <span className="dim">Exercise</span>
            <span style={{ fontWeight: 500 }}>{challenge.exerciseId}</span>
          </div>
        )}
        {challenge.endDate && (
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, marginTop: 6 }}>
            <span className="dim">Ends</span>
            <span style={{ fontWeight: 500 }}>
              {fmtDate(challenge.endDate.slice(0, 10), true)}
            </span>
          </div>
        )}
      </div>

      {/* Progress comparison (only for active/completed) */}
      {(isActive || isCompleted) && (
        <div>
          {/* Your progress */}
          <div style={{ marginBottom: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span style={{ fontWeight: 500 }}>You</span>
              <span className="dim">{myProgress} / {challenge.targetValue}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
              <div style={{ 
                height: '100%', 
                width: `${targetPct}%`, 
                background: 'var(--acc)', 
                borderRadius: 3,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>

          {/* Opponent progress */}
          <div>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span style={{ fontWeight: 500 }}>{opponent.name}</span>
              <span className="dim">{opponentProgress} / {challenge.targetValue}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
              <div style={{ 
                height: '100%', 
                width: `${opponentPct}%`, 
                background: 'var(--blue)', 
                borderRadius: 3,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        </div>
      )}

      {/* Winner announcement */}
      {isCompleted && challenge.winner && (
        <div style={{ 
          marginTop: 12, 
          padding: '10px 12px', 
          background: challenge.winner.id === userId 
            ? 'color-mix(in srgb, var(--green) 15%, transparent)' 
            : 'color-mix(in srgb, var(--blue) 15%, transparent)',
          borderRadius: 8,
          textAlign: 'center',
        }}>
          <span style={{ fontSize: 20, marginRight: 8 }}>🏆</span>
          <span style={{ fontWeight: 600, color: challenge.winner.id === userId ? 'var(--green)' : 'var(--blue)' }}>
            {challenge.winner.id === userId ? 'You won!' : `${challenge.winner.name} won`}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function Tabs({ tabs, active, onChange }) {
  return (
    <div className="row" style={{ gap: 6, marginBottom: 16 }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`chip ${active === tab.id ? 'on' : ''}`}
          onClick={() => onChange(tab.id)}
          style={{ flex: 1, justifyContent: 'center' }}
        >
          {tab.label}
          {tab.count > 0 && (
            <span style={{
              marginLeft: 6, padding: '1px 6px', borderRadius: 10,
              background: active === tab.id ? 'var(--surface)' : 'var(--acc)',
              color: active === tab.id ? 'var(--label)' : 'white',
              fontSize: 11, fontWeight: 600,
            }}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Create Challenge Form ─────────────────────────────────────────────────────

function CreateChallengeForm({ friends, exercises, onSubmit, onCancel }) {
  const [opponentId, setOpponentId] = useState('')
  const [type, setType] = useState('workout_count')
  const [exerciseId, setExerciseId] = useState('')
  const [targetValue, setTargetValue] = useState('10')
  const [metric, setMetric] = useState('count')
  const [endDate, setEndDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!opponentId || !targetValue) return
    setSubmitting(true)
    try {
      await onSubmit({
        opponentId,
        type,
        exerciseId: type === 'beat_pr' ? exerciseId : null,
        targetValue: parseFloat(targetValue),
        metric: type === 'beat_pr' ? metric : 'count',
        endDate: endDate || null,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const friendOptions = friends.map(f => ({ value: f.id, label: f.name }))
  const exerciseOptions = exercises.map(e => ({ value: e.id, label: e.name }))

  return (
    <div className="card" style={{ padding: '16px' }}>
      <h3 style={{ margin: '0 0 16px' }}>Create Challenge</h3>

      {/* Friend selection */}
      <div style={{ marginBottom: 16 }}>
        <label className="small dim" style={{ display: 'block', marginBottom: 6 }}>
          Challenge
        </label>
        <select
          className="field"
          value={opponentId}
          onChange={e => setOpponentId(e.target.value)}
          style={{ width: '100%' }}
        >
          <option value="">Select a friend…</option>
          {friendOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Challenge type */}
      <div style={{ marginBottom: 16 }}>
        <label className="small dim" style={{ display: 'block', marginBottom: 6 }}>
          Type
        </label>
        <select
          className="field"
          value={type}
          onChange={e => setType(e.target.value)}
          style={{ width: '100%' }}
        >
          <option value="workout_count">Complete X Workouts</option>
          <option value="beat_pr">Beat My PR</option>
          <option value="timed">Timed Competition</option>
        </select>
      </div>

      {/* Exercise (for beat_pr) */}
      {type === 'beat_pr' && (
        <>
          <div style={{ marginBottom: 16 }}>
            <label className="small dim" style={{ display: 'block', marginBottom: 6 }}>
              Exercise
            </label>
            <select
              className="field"
              value={exerciseId}
              onChange={e => setExerciseId(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">Select exercise…</option>
              {exerciseOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label className="small dim" style={{ display: 'block', marginBottom: 6 }}>
              Metric
            </label>
            <select
              className="field"
              value={metric}
              onChange={e => setMetric(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="weight">Weight</option>
              <option value="reps">Reps</option>
              <option value="both">Volume (Weight × Reps)</option>
            </select>
          </div>
        </>
      )}

      {/* Target value */}
      <div style={{ marginBottom: 16 }}>
        <label className="small dim" style={{ display: 'block', marginBottom: 6 }}>
          Target {type === 'workout_count' ? '(workouts)' : type === 'beat_pr' ? `(${METRIC_LABELS[metric]})` : '(workouts)'}
        </label>
        <TextField
          type="number"
          value={targetValue}
          onChange={e => setTargetValue(e.target.value)}
          placeholder="10"
          style={{ width: '100%' }}
        />
      </div>

      {/* End date (optional) */}
      <div style={{ marginBottom: 20 }}>
        <label className="small dim" style={{ display: 'block', marginBottom: 6 }}>
          End Date (optional)
        </label>
        <TextField
          type="date"
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          min={new Date().toISOString().slice(0, 10)}
          style={{ width: '100%' }}
        />
      </div>

      {/* Actions */}
      <div className="row" style={{ gap: 8 }}>
        <Button variant="ghost" onClick={onCancel} style={{ flex: 1 }}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={submitting || !opponentId || !targetValue || (type === 'beat_pr' && !exerciseId)}
          style={{ flex: 1 }}
        >
          {submitting ? 'Creating…' : 'Challenge'}
        </Button>
      </div>
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ type, hasFriends, onCreateClick }) {
  const messages = {
    active: {
      icon: '🎯',
      title: 'No active challenges',
      desc: 'Challenge a friend to a competition!',
    },
    pending: {
      icon: '📬',
      title: 'No pending challenges',
      desc: 'Challenges you receive will appear here.',
    },
    completed: {
      icon: '🏆',
      title: 'No completed challenges',
      desc: 'Your finished challenges will show up here.',
    },
  }

  const msg = messages[type] || messages.active

  return (
    <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
      <div style={{ fontSize: 40 }}>{msg.icon}</div>
      <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>{msg.title}</div>
      <div className="muted small" style={{ marginBottom: hasFriends ? 16 : 0 }}>
        {msg.desc}
      </div>
      {hasFriends && type === 'active' && (
        <Button onClick={onCreateClick}>Create Challenge</Button>
      )}
      {!hasFriends && (
        <div className="muted small" style={{ marginTop: 8 }}>
          Add friends first to start challenging them.
        </div>
      )}
    </div>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function FriendChallenges() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)

  const [tab, setTab] = useState('active')
  const [challenges, setChallenges] = useState([])
  const [friends, setFriends] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  // Get exercises from user state
  const exercises = [...(S.exercises || []), ...(S.customEx || [])]
    .filter(e => e && e.id)
    .map(e => ({ id: e.id, name: e.name || e.id }))

  // Load challenges and friends
  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [challengeData, friendsData] = await Promise.all([
        api('/api/challenges'),
        api('/api/friends'),
      ])
      setChallenges(challengeData.challenges || [])
      setFriends(friendsData.friends || [])
    } catch (e) {
      console.error('Failed to load challenges:', e)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  // Filter challenges by tab
  const filteredChallenges = challenges.filter(ch => {
    if (tab === 'active') return ch.status === 'active'
    if (tab === 'pending') return ch.status === 'pending'
    if (tab === 'completed') return ch.status === 'completed' || ch.status === 'declined'
    return true
  })

  // Pending count (challenges waiting for user to accept)
  const pendingCount = challenges.filter(
    ch => ch.status === 'pending' && ch.opponent.id === user?.id
  ).length

  // Actions
  const handleAccept = async (id) => {
    try {
      await api(`/api/challenges/${id}/accept`, { method: 'POST' })
      load()
    } catch (e) {
      console.error('Failed to accept challenge:', e)
    }
  }

  const handleDecline = async (id) => {
    try {
      await api(`/api/challenges/${id}/decline`, { method: 'POST' })
      load()
    } catch (e) {
      console.error('Failed to decline challenge:', e)
    }
  }

  const handleCreate = async (data) => {
    try {
      await api('/api/challenges', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      setShowCreate(false)
      load()
    } catch (e) {
      console.error('Failed to create challenge:', e)
      alert(e.message || 'Failed to create challenge')
    }
  }

  // Not signed in
  if (!user) {
    return (
      <div className="narrow">
        <div className="hdr">
          <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}>
            <Icon name="chevronLeft" />
          </button>
          <div>
            <h1>Friend Challenges</h1>
            <div className="sub">Compete with friends</div>
          </div>
          <div style={{ width: 36 }} />
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
          <div style={{ fontSize: 40 }}>🏆</div>
          <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>Sign in to compete</div>
          <div className="muted small">
            Challenge friends to beat PRs, complete workouts, and more.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}>
          <Icon name="chevronLeft" />
        </button>
        <div style={{ flex: 1 }}>
          <h1>Friend Challenges</h1>
          <div className="sub">Compete with friends</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {loading ? (
            <Icon name="hourglass" style={{ color: 'var(--label-3)', fontSize: 18 }} />
          ) : (
            <button className="iconbtn" onClick={load} aria-label={t('Refresh')}>
              <Icon name="reset" />
            </button>
          )}
          {friends.length > 0 && !showCreate && (
            <button className="iconbtn" onClick={() => setShowCreate(true)} aria-label="New challenge">
              <Icon name="plus" />
            </button>
          )}
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateChallengeForm
          friends={friends}
          exercises={exercises}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Tabs */}
      {!showCreate && (
        <Tabs
          tabs={[
            { id: 'active', label: 'Active', count: 0 },
            { id: 'pending', label: 'Pending', count: pendingCount },
            { id: 'completed', label: 'History', count: 0 },
          ]}
          active={tab}
          onChange={setTab}
        />
      )}

      {/* Loading */}
      {loading && !showCreate && (
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
          <Icon name="hourglass" style={{ fontSize: 32, color: 'var(--label-3)' }} />
          <div className="muted small" style={{ marginTop: 12 }}>Loading challenges…</div>
        </div>
      )}

      {/* Challenge list */}
      {!loading && !showCreate && filteredChallenges.length === 0 && (
        <EmptyState
          type={tab}
          hasFriends={friends.length > 0}
          onCreateClick={() => setShowCreate(true)}
        />
      )}

      {!loading && !showCreate && filteredChallenges.map(ch => (
        <ChallengeCard
          key={ch.id}
          challenge={ch}
          userId={user.id}
          onAccept={handleAccept}
          onDecline={handleDecline}
          onRefresh={load}
        />
      ))}

      {/* Info card */}
      {!showCreate && (
        <div className="card" style={{ marginTop: 16, padding: '12px 14px' }}>
          <div className="row" style={{ gap: 8 }}>
            <Icon name="info" style={{ color: 'var(--label-3)', fontSize: 16, flexShrink: 0 }} />
            <div className="muted small">
              Challenge progress updates automatically when you or your friend logs a workout.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
