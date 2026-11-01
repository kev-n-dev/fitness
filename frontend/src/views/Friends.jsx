import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button, TextField, SearchField } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  const d = typeof ts === 'string' ? new Date(ts).getTime() : ts
  const diff = Date.now() - d
  if (diff < 60000)     return 'just now'
  if (diff < 3600000)   return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000)  return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return new Date(d).toLocaleDateString()
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

// ── Tab selector ──────────────────────────────────────────────────────────────

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

// ── Friends List Tab ──────────────────────────────────────────────────────────

function FriendsListTab({ friends, onRemove, loading }) {
  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <Icon name="hourglass" style={{ fontSize: 32, color: 'var(--label-3)' }} />
        <div className="muted small" style={{ marginTop: 12 }}>Loading friends…</div>
      </div>
    )
  }

  if (!friends?.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <div style={{ fontSize: 40 }}>👥</div>
        <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>No friends yet</div>
        <div className="muted small">
          Search for users or share your invite link to connect with friends.
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      {friends.map((friend, i) => (
        <div
          key={friend.id}
          className="row"
          style={{
            padding: '12px 14px', gap: 12,
            borderBottom: i < friends.length - 1 ? '0.5px solid var(--sep)' : undefined,
          }}
        >
          <Avatar name={friend.name} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 15 }}>{friend.name}</div>
            <div className="dim small">Friends since {timeAgo(friend.friendship_created)}</div>
          </div>
          <button
            className="iconbtn"
            onClick={() => onRemove(friend)}
            aria-label={`Remove ${friend.name}`}
            style={{ color: 'var(--red)' }}
          >
            <Icon name="xmark" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Requests Tab ──────────────────────────────────────────────────────────────

function RequestsTab({ incoming, outgoing, onAccept, onDecline, onCancel, loading }) {
  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <Icon name="hourglass" style={{ fontSize: 32, color: 'var(--label-3)' }} />
        <div className="muted small" style={{ marginTop: 12 }}>Loading requests…</div>
      </div>
    )
  }

  const hasRequests = incoming?.length > 0 || outgoing?.length > 0

  if (!hasRequests) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <div style={{ fontSize: 40 }}>📬</div>
        <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>No pending requests</div>
        <div className="muted small">
          Friend requests you send or receive will appear here.
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Incoming requests */}
      {incoming?.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--sep)' }}>
            <div className="small" style={{ fontWeight: 600, color: 'var(--label-2)' }}>
              Incoming requests
            </div>
          </div>
          {incoming.map((req, i) => (
            <div
              key={req.id}
              className="row"
              style={{
                padding: '12px 14px', gap: 12,
                borderBottom: i < incoming.length - 1 ? '0.5px solid var(--sep)' : undefined,
              }}
            >
              <Avatar name={req.from.name} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>{req.from.name}</div>
                <div className="dim small">{timeAgo(req.created)}</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="iconbtn"
                  onClick={() => onAccept(req)}
                  aria-label={`Accept ${req.from.name}`}
                  style={{ color: 'var(--green)' }}
                >
                  <Icon name="check" />
                </button>
                <button
                  className="iconbtn"
                  onClick={() => onDecline(req)}
                  aria-label={`Decline ${req.from.name}`}
                  style={{ color: 'var(--red)' }}
                >
                  <Icon name="xmark" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Outgoing requests */}
      {outgoing?.length > 0 && (
        <div className="card" style={{ padding: 0, marginTop: incoming?.length ? 16 : 0 }}>
          <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--sep)' }}>
            <div className="small" style={{ fontWeight: 600, color: 'var(--label-2)' }}>
              Sent requests
            </div>
          </div>
          {outgoing.map((req, i) => (
            <div
              key={req.id}
              className="row"
              style={{
                padding: '12px 14px', gap: 12,
                borderBottom: i < outgoing.length - 1 ? '0.5px solid var(--sep)' : undefined,
              }}
            >
              <Avatar name={req.to.name} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>{req.to.name}</div>
                <div className="dim small">Pending · {timeAgo(req.created)}</div>
              </div>
              <button
                className="iconbtn"
                onClick={() => onCancel(req)}
                aria-label={`Cancel request to ${req.to.name}`}
                style={{ color: 'var(--label-3)' }}
              >
                <Icon name="xmark" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── Find Friends Tab ──────────────────────────────────────────────────────────

function FindFriendsTab({ onSendRequest, existingFriendIds, pendingRequestIds }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [inviteCode, setInviteCode] = useState(null)
  const [generatingCode, setGeneratingCode] = useState(false)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemResult, setRedeemResult] = useState(null)

  // Search users
  const search = useCallback(async (q) => {
    if (q.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`)
      setResults(data.users || [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const timeout = setTimeout(() => search(query), 300)
    return () => clearTimeout(timeout)
  }, [query, search])

  // Generate invite code
  const generateInvite = async () => {
    setGeneratingCode(true)
    try {
      const data = await api('/api/friends/invite', { method: 'POST' })
      setInviteCode(data)
    } catch (e) {
      console.error('Failed to generate invite:', e)
    } finally {
      setGeneratingCode(false)
    }
  }

  // Redeem invite code
  const redeemInvite = async () => {
    if (!redeemCode.trim()) return
    setRedeeming(true)
    setRedeemResult(null)
    try {
      const data = await api('/api/friends/invite/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: redeemCode.trim() }),
      })
      setRedeemResult({ success: true, friend: data.friend })
      setRedeemCode('')
    } catch (e) {
      setRedeemResult({ success: false, error: e.message || 'Failed to redeem code' })
    } finally {
      setRedeeming(false)
    }
  }

  // Copy invite link
  const copyInviteLink = () => {
    if (!inviteCode) return
    const link = `${window.location.origin}${window.location.pathname}#/friends?invite=${inviteCode.code}`
    navigator.clipboard?.writeText(link)
  }

  // Filter out existing friends and pending requests
  const filteredResults = results.filter(u =>
    !existingFriendIds.includes(u.id) && !pendingRequestIds.includes(u.id)
  )

  return (
    <>
      {/* Search section */}
      <div className="card" style={{ padding: '14px' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>
          Search by username
        </div>
        <SearchField
          value={query}
          onChange={e => setQuery(e.target.value)}
          onClear={() => setQuery('')}
          placeholder="Search users…"
        />
        
        {searching && (
          <div className="muted small" style={{ marginTop: 12, textAlign: 'center' }}>
            Searching…
          </div>
        )}
        
        {!searching && query.length >= 2 && filteredResults.length === 0 && (
          <div className="muted small" style={{ marginTop: 12, textAlign: 'center' }}>
            No users found
          </div>
        )}
        
        {filteredResults.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {filteredResults.map(user => (
              <div
                key={user.id}
                className="row"
                style={{ padding: '10px 0', gap: 12, borderTop: '0.5px solid var(--sep)' }}
              >
                <Avatar name={user.name} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{user.name}</div>
                </div>
                <Button
                  size="sm"
                  onClick={() => onSendRequest(user.id)}
                >
                  Add
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite link section */}
      <div className="card" style={{ padding: '14px', marginTop: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>
          Share invite link
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>
          Generate a link to share with friends. Links expire after 7 days.
        </div>
        
        {!inviteCode ? (
          <Button
            icon="link"
            onClick={generateInvite}
            disabled={generatingCode}
          >
            {generatingCode ? 'Generating…' : 'Generate invite link'}
          </Button>
        ) : (
          <div>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <TextField
                value={`${window.location.origin}${window.location.pathname}#/friends?invite=${inviteCode.code}`}
                readOnly
                style={{ flex: 1, fontSize: 12 }}
              />
              <Button size="sm" icon="copy" onClick={copyInviteLink}>
                Copy
              </Button>
            </div>
            <div className="muted small">
              Expires {new Date(inviteCode.expires).toLocaleDateString()}
            </div>
          </div>
        )}
      </div>

      {/* Redeem code section */}
      <div className="card" style={{ padding: '14px', marginTop: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>
          Have an invite code?
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>
          Enter a friend's invite code to connect instantly.
        </div>
        
        <div className="row" style={{ gap: 8 }}>
          <TextField
            value={redeemCode}
            onChange={e => setRedeemCode(e.target.value)}
            placeholder="Enter code…"
            style={{ flex: 1 }}
          />
          <Button
            onClick={redeemInvite}
            disabled={redeeming || !redeemCode.trim()}
          >
            {redeeming ? 'Adding…' : 'Add'}
          </Button>
        </div>
        
        {redeemResult && (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 8,
            background: redeemResult.success ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'color-mix(in srgb, var(--red) 15%, transparent)',
            color: redeemResult.success ? 'var(--green)' : 'var(--red)',
            fontSize: 14,
          }}>
            {redeemResult.success
              ? `You're now friends with ${redeemResult.friend.name}!`
              : redeemResult.error
            }
          </div>
        )}
      </div>
    </>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function Friends() {
  const nav = useNavigate()
  const user = useStore(s => s.user)

  const [tab, setTab] = useState('list')
  const [friends, setFriends] = useState([])
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Check for invite code in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const invite = params.get('invite')
    if (invite) {
      setTab('find')
      // Clear the URL parameter
      window.history.replaceState(null, '', window.location.pathname + '#/friends')
    }
  }, [])

  // Load friends and requests
  const load = useCallback(async () => {
    if (!user) return
    try {
      const [friendsData, requestsData] = await Promise.all([
        api('/api/friends'),
        api('/api/friends/requests'),
      ])
      setFriends(friendsData.friends || [])
      setRequests(requestsData)
    } catch (e) {
      console.error('Failed to load friends:', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  // Refresh
  const refresh = () => {
    setRefreshing(true)
    load()
  }

  // Actions
  const handleRemoveFriend = async (friend) => {
    if (!confirm(`Remove ${friend.name} from your friends?`)) return
    try {
      await api(`/api/friends/${friend.id}`, { method: 'DELETE' })
      setFriends(f => f.filter(x => x.id !== friend.id))
    } catch (e) {
      console.error('Failed to remove friend:', e)
    }
  }

  const handleAcceptRequest = async (req) => {
    try {
      await api(`/api/friends/request/${req.id}/accept`, { method: 'POST' })
      // Refresh to get updated lists
      load()
    } catch (e) {
      console.error('Failed to accept request:', e)
    }
  }

  const handleDeclineRequest = async (req) => {
    try {
      await api(`/api/friends/request/${req.id}/decline`, { method: 'POST' })
      setRequests(r => ({
        ...r,
        incoming: r.incoming.filter(x => x.id !== req.id),
      }))
    } catch (e) {
      console.error('Failed to decline request:', e)
    }
  }

  const handleCancelRequest = async (req) => {
    try {
      await api(`/api/friends/request/${req.id}`, { method: 'DELETE' })
      setRequests(r => ({
        ...r,
        outgoing: r.outgoing.filter(x => x.id !== req.id),
      }))
    } catch (e) {
      console.error('Failed to cancel request:', e)
    }
  }

  const handleSendRequest = async (toUserId) => {
    try {
      const data = await api('/api/friends/request', {
        method: 'POST',
        body: JSON.stringify({ toUserId }),
      })
      setRequests(r => ({
        ...r,
        outgoing: [data, ...r.outgoing],
      }))
    } catch (e) {
      console.error('Failed to send request:', e)
      alert(e.message || 'Failed to send friend request')
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
            <h1>Friends</h1>
            <div className="sub">Connect with others</div>
          </div>
          <div style={{ width: 36 }} />
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
          <div style={{ fontSize: 40 }}>👥</div>
          <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>Sign in required</div>
          <div className="muted small">
            Sign in to add friends, see their activity, and challenge them to workouts.
          </div>
        </div>
      </div>
    )
  }

  const incomingCount = requests.incoming?.length || 0
  const existingFriendIds = friends.map(f => f.id)
  const pendingRequestIds = [
    ...(requests.incoming || []).map(r => r.from.id),
    ...(requests.outgoing || []).map(r => r.to.id),
  ]

  return (
    <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}>
          <Icon name="chevronLeft" />
        </button>
        <div style={{ flex: 1 }}>
          <h1>Friends</h1>
          <div className="sub">{friends.length} friend{friends.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {incomingCount > 0 && (
            <div style={{
              position: 'relative',
              width: 36, height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="bell" style={{ fontSize: 20, color: 'var(--acc)' }} />
              <span style={{
                position: 'absolute', top: 2, right: 2,
                minWidth: 16, height: 16, borderRadius: 8,
                background: 'var(--red)', color: 'white',
                fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 4px',
              }}>
                {incomingCount}
              </span>
            </div>
          )}
          {refreshing ? (
            <Icon name="hourglass" style={{ color: 'var(--label-3)', fontSize: 18 }} />
          ) : (
            <button className="iconbtn" onClick={refresh} aria-label={t('Refresh')}>
              <Icon name="reset" />
            </button>
          )}
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'list', label: 'Friends', count: 0 },
          { id: 'requests', label: 'Requests', count: incomingCount },
          { id: 'find', label: 'Find', count: 0 },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'list' && (
        <FriendsListTab
          friends={friends}
          onRemove={handleRemoveFriend}
          loading={loading}
        />
      )}

      {tab === 'requests' && (
        <RequestsTab
          incoming={requests.incoming}
          outgoing={requests.outgoing}
          onAccept={handleAcceptRequest}
          onDecline={handleDeclineRequest}
          onCancel={handleCancelRequest}
          loading={loading}
        />
      )}

      {tab === 'find' && (
        <FindFriendsTab
          onSendRequest={handleSendRequest}
          existingFriendIds={existingFriendIds}
          pendingRequestIds={pendingRequestIds}
        />
      )}
    </div>
  )
}
