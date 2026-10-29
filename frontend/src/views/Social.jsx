import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { AccoladeBadge } from './Challenges.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDurationShort(ms) {
  if (!ms || ms <= 0) return null
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60000)     return 'just now'
  if (diff < 3600000)   return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000)  return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return fmtDate(new Date(ts).toISOString().slice(0, 10), true)
}

// Avatar circle — initial letter styled with a stable colour per name
function Avatar({ name, size = 36 }) {
  const colors = ['var(--blue)', 'var(--green)', 'var(--orange)', 'var(--purple)', 'var(--teal)', 'var(--pink)', 'var(--red)', 'var(--indigo)']
  // Hash the name to pick a consistent colour
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

// ── Live now banner ───────────────────────────────────────────────────────────

function LiveNowBanner({ liveNow }) {
  if (!liveNow?.length) return null
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="row" style={{ gap: 7, marginBottom: 10 }}>
        <span className="live-dot" aria-hidden="true" />
        <span style={{ fontWeight: 600, fontSize: 14 }}>Training now</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {liveNow.map(p => (
          <div key={p.uid} className="row" style={{ gap: 10 }}>
            <Avatar name={p.name} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>
                {p.name}{p.isMe ? ' (you)' : ''}
              </div>
              <div className="dim small">
                {p.workoutName || 'Workout'}
                {p.setsTotal > 0 && ` · ${p.setsDone}/${p.setsTotal} sets`}
                {p.startedAt > 0 && ` · ${fmtDurationShort(Date.now() - p.startedAt) || '< 1m'}`}
              </div>
            </div>
            <span className="tag" style={{ color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 15%,transparent)', whiteSpace: 'nowrap' }}>
              Active
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Single feed item ──────────────────────────────────────────────────────────

function FeedItem({ item }) {
  const { type, name, at, data, isMe } = item

  const icon    = type === 'workout'  ? 'dumbbell'
                : type === 'accolade' ? 'trophy'
                : type === 'recipe'   ? 'sparkles'
                : 'bolt'

  const color   = type === 'workout'  ? 'var(--blue)'
                : type === 'accolade' ? 'var(--yellow)'
                : type === 'recipe'   ? 'var(--orange)'
                : 'var(--green)'

  const headline = type === 'workout'
    ? <><b>{isMe ? 'You' : name}</b> completed <b>{data.label}</b>{data.durationMs ? ` in ${fmtDurationShort(data.durationMs)}` : ''}</>
    : type === 'accolade'
    ? <><b>{isMe ? 'You' : name}</b> earned the <b>{data.label}</b> accolade {data.emoji}</>
    : type === 'recipe'
    ? <><b>{isMe ? 'You' : name}</b> added a new recipe: <b>{data.label}</b> {data.emoji}</>
    : <><b>{isMe ? 'You' : name}</b> set a new record</>

  return (
    <div className="feed-item">
      <Avatar name={name} size={36} />
      <div className="feed-item-body">
        <div className="feed-item-text">{headline}</div>
        <div className="feed-item-meta">
          <span className="lrow-i" style={{ width: 18, height: 18, borderRadius: 5, background: color + '22', color, fontSize: 11 }}>
            <Icon name={icon} />
          </span>
          <span>{timeAgo(at)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Empty states ──────────────────────────────────────────────────────────────

function GuestPrompt() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
      <div style={{ fontSize: 40 }}>👥</div>
      <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>Team Feed</div>
      <div className="muted small" style={{ marginBottom: 20 }}>
        Sign in to see workouts, accolades and recipes from others on this server.
      </div>
    </div>
  )
}

function EmptyFeed({ serverConnected }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
      <div style={{ fontSize: 36 }}>🏋️</div>
      <div style={{ fontWeight: 500, marginTop: 10 }}>
        {serverConnected ? 'No activity yet' : 'Not connected to a server'}
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>
        {serverConnected
          ? 'Activity appears here as people on this server log workouts, earn accolades and add recipes.'
          : 'The team feed needs a server connection. Pair this device in Settings.'}
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function Social() {
  const nav         = useNavigate()
  const user        = useStore(s => s.user)
  const isGuest     = useStore(s => s.isGuest())
  const S           = useStore(s => s.S)
  const config      = useStore(s => s.config)
  const serverPaired = !!useStore(s => s.sync)

  const [feed,    setFeed]    = useState(null)   // null = loading, { items, liveNow } | 'error'
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const data = await api('/api/feed')
      setFeed(data)
    } catch {
      setFeed('error')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  // Refresh every 60 s while the view is open
  useEffect(() => {
    if (!user) return
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [load, user])

  const items   = Array.isArray(feed?.items)   ? feed.items   : []
  const liveNow = Array.isArray(feed?.liveNow) ? feed.liveNow : []

  return (
    <div className="narrow">
      <div className="hdr">
        <div style={{ flex: 1 }}>
          <h1>Team Feed</h1>
          <div className="sub">
            {user ? `What's happening on this server` : 'Sign in to join'}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {loading && <Icon name="hourglass" style={{ color: 'var(--label-3)', fontSize: 18 }} />}
          <button className="iconbtn" onClick={() => nav('/profile')} aria-label={t('Profile')}>
            <Icon name="person" />
          </button>
          <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}>
            <Icon name="gear" />
          </button>
        </div>
      </div>

      {/* Guest / not signed in */}
      {!user && !isGuest && <GuestPrompt />}

      {/* No server connection */}
      {user && feed === 'error' && <EmptyFeed serverConnected={false} />}

      {/* Feed loaded */}
      {user && feed && feed !== 'error' && (
        <>
          {/* Who's training right now */}
          <LiveNowBanner liveNow={liveNow} />

          {items.length === 0
            ? <EmptyFeed serverConnected />
            : (
              <div className="card" style={{ padding: 0 }}>
                {items.map((item, i) => (
                  <div
                    key={`${item.uid}-${item.at}-${item.type}`}
                    style={i < items.length - 1 ? { borderBottom: '0.5px solid var(--sep)' } : undefined}
                  >
                    <FeedItem item={item} />
                  </div>
                ))}
              </div>
            )
          }

          {/* Privacy opt-out notice */}
          {S.socialPrivate && (
            <div className="card" style={{ padding: '12px 14px' }}>
              <div className="row" style={{ gap: 8 }}>
                <Icon name="lock" style={{ color: 'var(--label-3)', fontSize: 18 }} />
                <div className="muted small">Your activity is hidden from this feed. Change this in Settings → Privacy.</div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Guest: show the feed empty state */}
      {isGuest && <EmptyFeed serverConnected={false} />}

      {/* Refresh button */}
      {user && feed && feed !== 'error' && (
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}>
          <Button size="sm" variant="ghost" icon="reset" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      )}
    </div>
  )
}
