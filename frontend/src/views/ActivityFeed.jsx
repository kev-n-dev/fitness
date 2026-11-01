import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDurationShort(ms) {
  if (!ms || ms <= 0) return null
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function timeAgo(ts) {
  const d = typeof ts === 'string' ? new Date(ts).getTime() : ts
  const diff = Date.now() - d
  if (diff < 60000)     return 'just now'
  if (diff < 3600000)   return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000)  return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return fmtDate(new Date(d).toISOString().slice(0, 10), true)
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

// ── Activity Card ─────────────────────────────────────────────────────────────

function ActivityCard({ item, onViewDetails }) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = item.visibility === 'full'

  const toggleExpand = () => {
    if (canExpand) {
      setExpanded(!expanded)
      if (!expanded) {
        onViewDetails?.(item)
      }
    }
  }

  return (
    <div 
      className="card" 
      style={{ marginBottom: 12 }}
      onClick={toggleExpand}
      role={canExpand ? 'button' : undefined}
      tabIndex={canExpand ? 0 : undefined}
    >
      <div className="row" style={{ gap: 12 }}>
        <Avatar name={item.friendName} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{item.friendName}</span>
            <span className="dim" style={{ fontSize: 13 }}>completed</span>
          </div>
          <div style={{ fontWeight: 500, fontSize: 15, color: 'var(--acc)', marginTop: 2 }}>
            {item.workoutName || 'Workout'}
          </div>
          <div className="row" style={{ gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
            <span className="dim small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="clock" style={{ fontSize: 12 }} />
              {timeAgo(item.completedAt)}
            </span>
            {item.durationMs > 0 && (
              <span className="dim small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="timer" style={{ fontSize: 12 }} />
                {fmtDurationShort(item.durationMs)}
              </span>
            )}
            {item.exerciseCount > 0 && (
              <span className="dim small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="dumbbell" style={{ fontSize: 12 }} />
                {item.exerciseCount} exercise{item.exerciseCount !== 1 ? 's' : ''}
              </span>
            )}
            {item.setCount > 0 && (
              <span className="dim small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="list" style={{ fontSize: 12 }} />
                {item.setCount} set{item.setCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        {canExpand && (
          <Icon 
            name={expanded ? 'chevronUp' : 'chevronDown'} 
            style={{ color: 'var(--label-3)', fontSize: 18 }} 
          />
        )}
      </div>

      {/* Expanded details - shown when visibility is 'full' and card is expanded */}
      {expanded && canExpand && (
        <div style={{ 
          marginTop: 12, 
          paddingTop: 12, 
          borderTop: '0.5px solid var(--sep)',
        }}>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Full workout details available when {item.friendName} shares them.
          </div>
          {/* In a real implementation, we would fetch and show the full workout breakdown here */}
          <div style={{ 
            padding: '12px', 
            background: 'var(--surface-2)', 
            borderRadius: 8,
            fontSize: 13,
          }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="dim">Duration</span>
              <span>{fmtDurationShort(item.durationMs) || '–'}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="dim">Exercises</span>
              <span>{item.exerciseCount || '–'}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="dim">Total sets</span>
              <span>{item.setCount || '–'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Summary-only indicator */}
      {!canExpand && item.visibility === 'summary' && (
        <div className="dim small" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="lock" style={{ fontSize: 12 }} />
          Summary only
        </div>
      )}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyFeed({ hasFriends }) {
  const nav = useNavigate()

  if (!hasFriends) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <div style={{ fontSize: 40 }}>👥</div>
        <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>Add friends to see their activity</div>
        <div className="muted small" style={{ marginBottom: 20 }}>
          When your friends complete workouts, they'll appear here.
        </div>
        <Button onClick={() => nav('/friends')}>
          Find Friends
        </Button>
      </div>
    )
  }

  return (
    <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
      <div style={{ fontSize: 40 }}>🏋️</div>
      <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>No activity yet</div>
      <div className="muted small">
        When your friends complete workouts, their activity will show up here.
      </div>
    </div>
  )
}

// ── Guest Prompt ──────────────────────────────────────────────────────────────

function GuestPrompt() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
      <div style={{ fontSize: 40 }}>👥</div>
      <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>Friend Activity</div>
      <div className="muted small">
        Sign in to see what your friends are up to.
      </div>
    </div>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function ActivityFeed() {
  const nav = useNavigate()
  const user = useStore(s => s.user)

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextBefore, setNextBefore] = useState(null)
  const [hasFriends, setHasFriends] = useState(null)

  // Load activity feed
  const load = useCallback(async (before = null) => {
    if (!user) return
    
    if (before) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }

    try {
      const url = before 
        ? `/api/activity/feed?limit=20&before=${before}`
        : '/api/activity/feed?limit=20'
      const data = await api(url)
      
      if (before) {
        setItems(prev => [...prev, ...(data.items || [])])
      } else {
        setItems(data.items || [])
      }
      setHasMore(data.hasMore || false)
      setNextBefore(data.nextBefore || null)

      // Check if user has friends
      if (!before) {
        try {
          const friendsData = await api('/api/friends')
          setHasFriends((friendsData.friends || []).length > 0)
        } catch {
          setHasFriends(false)
        }
      }
    } catch (e) {
      console.error('Failed to load activity feed:', e)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  // Refresh
  const refresh = () => {
    setItems([])
    setNextBefore(null)
    load()
  }

  // Load more
  const loadMore = () => {
    if (hasMore && nextBefore && !loadingMore) {
      load(nextBefore)
    }
  }

  // View details callback (could be used for analytics or prefetching)
  const handleViewDetails = (item) => {
    // Could fetch full workout details here if needed
    console.log('Viewing details for:', item.workoutId)
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
            <h1>Activity</h1>
            <div className="sub">Friend workouts</div>
          </div>
          <div style={{ width: 36 }} />
        </div>
        <GuestPrompt />
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
          <h1>Activity</h1>
          <div className="sub">Friend workouts</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="iconbtn" onClick={() => nav('/friends')} aria-label={t('Friends')}>
            <Icon name="person" />
          </button>
          {loading ? (
            <Icon name="hourglass" style={{ color: 'var(--label-3)', fontSize: 18 }} />
          ) : (
            <button className="iconbtn" onClick={refresh} aria-label={t('Refresh')}>
              <Icon name="reset" />
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {loading && items.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
          <Icon name="hourglass" style={{ fontSize: 32, color: 'var(--label-3)' }} />
          <div className="muted small" style={{ marginTop: 12 }}>Loading activity…</div>
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <EmptyFeed hasFriends={hasFriends} />
      )}

      {/* Activity items */}
      {items.map(item => (
        <ActivityCard 
          key={item.id} 
          item={item} 
          onViewDetails={handleViewDetails}
        />
      ))}

      {/* Load more button */}
      {hasMore && items.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}>
          <Button
            size="sm"
            variant="ghost"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      {/* Privacy notice */}
      <div className="card" style={{ marginTop: 16, padding: '12px 14px' }}>
        <div className="row" style={{ gap: 8 }}>
          <Icon name="lock" style={{ color: 'var(--label-3)', fontSize: 16, flexShrink: 0 }} />
          <div className="muted small">
            Control what friends see about your workouts in{' '}
            <button 
              onClick={() => nav('/settings')}
              style={{ 
                color: 'var(--acc)', 
                background: 'none', 
                border: 'none', 
                padding: 0,
                font: 'inherit',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Settings → Social
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
