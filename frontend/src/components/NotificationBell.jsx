// Notification bell icon with unread count badge.
import { useEffect, useState, useRef } from 'react'
import { api } from '../lib/api.js'
import { useStore } from '../store/useStore.js'
import Icon from './Icon.jsx'
import NotificationPanel from './NotificationPanel.jsx'

const POLL_INTERVAL = 60000 // 60 seconds

export default function NotificationBell() {
  const user = useStore(s => s.user)
  const [unreadCount, setUnreadCount] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const pollRef = useRef(null)

  // Fetch unread count
  const fetchUnreadCount = async () => {
    if (!user) return
    try {
      const res = await api('/api/notifications/unread-count')
      setUnreadCount(res.count || 0)
    } catch {
      // Silently ignore errors during polling
    }
  }

  // Poll for unread count
  useEffect(() => {
    if (!user) {
      setUnreadCount(0)
      return
    }

    // Initial fetch
    fetchUnreadCount()

    // Set up polling
    pollRef.current = setInterval(fetchUnreadCount, POLL_INTERVAL)

    // Handle visibility changes - pause polling when hidden, resume when visible
    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(pollRef.current)
      } else {
        fetchUnreadCount()
        pollRef.current = setInterval(fetchUnreadCount, POLL_INTERVAL)
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(pollRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [user?.id])

  // Refresh count when panel closes
  const handlePanelClose = () => {
    setPanelOpen(false)
    fetchUnreadCount()
  }

  // Update count externally (called when notifications are marked as read)
  const updateCount = (delta) => {
    setUnreadCount(c => Math.max(0, c + delta))
  }

  if (!user) return null

  return (
    <>
      <button
        className="notif-bell"
        onClick={() => setPanelOpen(true)}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
      >
        <Icon name="bell" />
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {panelOpen && (
        <NotificationPanel
          onClose={handlePanelClose}
          updateCount={updateCount}
        />
      )}

      <style>{`
        .notif-bell {
          position: relative;
          background: none;
          border: none;
          padding: 8px;
          cursor: pointer;
          color: var(--label-1);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .notif-bell .icn {
          width: 22px;
          height: 22px;
        }
        .notif-badge {
          position: absolute;
          top: 2px;
          right: 2px;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          background: var(--red);
          color: white;
          font-size: 10px;
          font-weight: 600;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
      `}</style>
    </>
  )
}
