// Slide-out notification panel showing all notifications.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Format relative time
function timeAgo(isoDate) {
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (mins < 1) return t('just now')
  if (mins < 60) return t('{0}m ago', mins)
  if (hours < 24) return t('{0}h ago', hours)
  if (days < 7) return t('{0}d ago', days)
  return new Date(isoDate).toLocaleDateString()
}

// Get icon and color for notification type
function typeStyle(type) {
  switch (type) {
    case 'friend_request':
      return { icon: 'person', color: 'var(--blue)' }
    case 'friend_accepted':
      return { icon: 'check', color: 'var(--green)' }
    case 'challenge_received':
      return { icon: 'trophy', color: 'var(--orange)' }
    case 'challenge_accepted':
      return { icon: 'check', color: 'var(--green)' }
    case 'challenge_declined':
      return { icon: 'xmark', color: 'var(--red)' }
    case 'challenge_won':
      return { icon: 'crown', color: 'var(--yellow)' }
    case 'challenge_lost':
      return { icon: 'trophy', color: 'var(--grey)' }
    case 'friend_workout':
      return { icon: 'dumbbell', color: 'var(--teal)' }
    default:
      return { icon: 'bell', color: 'var(--label-2)' }
  }
}

export default function NotificationPanel({ onClose, updateCount }) {
  const nav = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [nextBefore, setNextBefore] = useState(null)

  // Fetch notifications
  const fetchNotifications = async (before = null) => {
    try {
      const params = before ? `?before=${before}&limit=20` : '?limit=20'
      const res = await api('/api/notifications' + params)
      if (before) {
        setNotifications(prev => [...prev, ...res.items])
      } else {
        setNotifications(res.items)
      }
      setHasMore(res.hasMore)
      setNextBefore(res.nextBefore)
    } catch {
      // Error fetching
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
  }, [])

  // Mark a single notification as read
  const markRead = async (id) => {
    try {
      await api(`/api/notifications/${id}/read`, { method: 'POST' })
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, read: true } : n)
      )
      updateCount(-1)
    } catch {
      // Silently fail
    }
  }

  // Mark all as read
  const markAllRead = async () => {
    try {
      await api('/api/notifications/read-all', { method: 'POST' })
      const unreadCount = notifications.filter(n => !n.read).length
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      updateCount(-unreadCount)
    } catch {
      // Silently fail
    }
  }

  // Handle notification click
  const handleClick = (n) => {
    if (!n.read) markRead(n.id)

    // Navigate based on notification type
    switch (n.type) {
      case 'friend_request':
      case 'friend_accepted':
        onClose()
        nav('/friends')
        break
      case 'challenge_received':
      case 'challenge_accepted':
      case 'challenge_declined':
      case 'challenge_won':
      case 'challenge_lost':
        onClose()
        nav('/friend-challenges')
        break
      case 'friend_workout':
        onClose()
        nav('/activity')
        break
      default:
        break
    }
  }

  // Load more
  const loadMore = () => {
    if (hasMore && nextBefore) {
      fetchNotifications(nextBefore)
    }
  }

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div className="notif-overlay" onClick={onClose}>
      <div className="notif-panel" onClick={e => e.stopPropagation()}>
        <div className="notif-header">
          <h2>{t('Notifications')}</h2>
          <div className="notif-actions">
            {unreadCount > 0 && (
              <button className="notif-mark-all" onClick={markAllRead}>
                {t('Mark all read')}
              </button>
            )}
            <button className="notif-close" onClick={onClose} aria-label={t('Close')}>
              <Icon name="xmark" />
            </button>
          </div>
        </div>

        <div className="notif-list">
          {loading ? (
            <div className="notif-loading">{t('Loading…')}</div>
          ) : notifications.length === 0 ? (
            <div className="notif-empty">
              <Icon name="bell" />
              <p>{t('No notifications yet')}</p>
            </div>
          ) : (
            <>
              {notifications.map(n => {
                const style = typeStyle(n.type)
                return (
                  <button
                    key={n.id}
                    className={`notif-item ${n.read ? 'read' : 'unread'}`}
                    onClick={() => handleClick(n)}
                  >
                    <span className="notif-icon" style={{ color: style.color }}>
                      <Icon name={style.icon} />
                    </span>
                    <div className="notif-content">
                      <span className="notif-title">{n.title}</span>
                      {n.body && <span className="notif-body">{n.body}</span>}
                      <span className="notif-time">{timeAgo(n.created)}</span>
                    </div>
                    {!n.read && <span className="notif-dot" />}
                  </button>
                )
              })}
              {hasMore && (
                <button className="notif-load-more" onClick={loadMore}>
                  {t('Load more')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        .notif-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 1000;
          display: flex;
          justify-content: flex-end;
        }
        .notif-panel {
          width: 100%;
          max-width: 400px;
          height: 100%;
          background: var(--bg-1);
          display: flex;
          flex-direction: column;
          animation: slideIn 0.2s ease-out;
        }
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .notif-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid var(--sep);
        }
        .notif-header h2 {
          font-size: 18px;
          font-weight: 600;
          margin: 0;
        }
        .notif-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .notif-mark-all {
          background: none;
          border: none;
          color: var(--acc);
          font-size: 14px;
          cursor: pointer;
          padding: 4px 8px;
        }
        .notif-close {
          background: none;
          border: none;
          padding: 4px;
          cursor: pointer;
          color: var(--label-2);
        }
        .notif-close .icn {
          width: 20px;
          height: 20px;
        }
        .notif-list {
          flex: 1;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }
        .notif-loading,
        .notif-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 16px;
          color: var(--label-3);
          text-align: center;
        }
        .notif-empty .icn {
          width: 48px;
          height: 48px;
          margin-bottom: 12px;
          opacity: 0.5;
        }
        .notif-item {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 14px 16px;
          border: none;
          border-bottom: 1px solid var(--sep);
          background: none;
          width: 100%;
          text-align: left;
          cursor: pointer;
          transition: background 0.1s;
        }
        .notif-item:hover {
          background: var(--bg-2);
        }
        .notif-item.unread {
          background: var(--bg-2);
        }
        .notif-icon {
          flex-shrink: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--bg-3);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .notif-icon .icn {
          width: 18px;
          height: 18px;
        }
        .notif-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .notif-title {
          font-size: 14px;
          font-weight: 500;
          color: var(--label-1);
        }
        .notif-body {
          font-size: 13px;
          color: var(--label-2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .notif-time {
          font-size: 12px;
          color: var(--label-3);
        }
        .notif-dot {
          flex-shrink: 0;
          width: 8px;
          height: 8px;
          background: var(--acc);
          border-radius: 50%;
          margin-top: 6px;
        }
        .notif-load-more {
          display: block;
          width: 100%;
          padding: 14px;
          background: none;
          border: none;
          color: var(--acc);
          font-size: 14px;
          cursor: pointer;
          text-align: center;
        }
        .notif-load-more:hover {
          background: var(--bg-2);
        }
      `}</style>
    </div>
  )
}
