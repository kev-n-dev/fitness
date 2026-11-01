// Google Fit connection UI component.
// Shows connection status, sync button, and disconnect option.
import { useState, useEffect } from 'react'
import { Section, Row, Button } from './ui.jsx'
import { GoogleLogo } from './GoogleLoginButton.jsx'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import {
  googleFitStatus,
  googleFitSync,
  googleFitDisconnect,
  googleFitEnable,
} from '../lib/api.js'
import { appBase } from '../lib/app-base.js'
import Icon from './Icon.jsx'

/**
 * GoogleFitConnect - UI for managing Google Fit connection.
 *
 * @param {Object} props
 * @param {Function} [props.onStatusChange] - Called when connection status changes
 */
export default function GoogleFitConnect({ onStatusChange }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncData, setLastSyncData] = useState(null)
  const toast = useUI(s => s.toast)

  // Load status on mount
  useEffect(() => {
    loadStatus()
  }, [])

  const loadStatus = async () => {
    setLoading(true)
    try {
      const s = await googleFitStatus()
      setStatus(s)
      onStatusChange?.(s)
    } catch (e) {
      console.error('Failed to load Google Fit status:', e)
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = () => {
    // Redirect to Google OAuth with fit=1 to request fitness scopes
    const base = appBase().replace(/\/$/, '')
    const url = new URL(`${base}/api/auth/google`)
    url.searchParams.set('fit', '1')
    url.searchParams.set('return_to', '/settings/data')
    window.location.href = url.toString()
  }

  const handleEnable = async () => {
    try {
      await googleFitEnable()
      toast(t('Google Fit enabled'))
      await loadStatus()
    } catch (e) {
      toast(t('Failed to enable Google Fit'))
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const result = await googleFitSync()
      setLastSyncData(result.data)
      toast(t('Google Fit synced'))
      await loadStatus()
    } catch (e) {
      console.error('Sync failed:', e)
      if (e.code === 'not-enabled') {
        toast(t('Google Fit is not enabled'))
      } else if (e.code === 'not-connected') {
        toast(t('Google account not connected'))
      } else {
        toast(t('Sync failed'))
      }
    } finally {
      setSyncing(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      await googleFitDisconnect()
      toast(t('Google account disconnected'))
      setStatus(null)
      setLastSyncData(null)
      onStatusChange?.(null)
    } catch (e) {
      toast(t('Failed to disconnect'))
    }
  }

  const formatLastSync = (isoDate) => {
    if (!isoDate) return t('Never')
    try {
      const date = new Date(isoDate)
      return date.toLocaleString()
    } catch {
      return isoDate
    }
  }

  if (loading) {
    return (
      <Section title={t('Google Fit')}>
        <Row icon="cloud" iconTint="var(--grey)" title={t('Loading...')} />
      </Section>
    )
  }

  // Not connected to Google at all
  if (!status?.connected) {
    return (
      <Section title={t('Google Fit')} footer={t('Connect your Google account to sync fitness data.')}>
        <div style={{ padding: '0 16px 16px' }}>
          <Button variant="outline" onClick={handleConnect} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GoogleLogo size={18} />
            <span style={{ marginLeft: 8 }}>{t('Connect Google Account')}</span>
          </Button>
        </div>
      </Section>
    )
  }

  // Connected to Google but Fit not enabled
  if (!status.fit_enabled) {
    return (
      <Section title={t('Google Fit')} footer={t('Your Google account is connected. Enable Google Fit to sync fitness data.')}>
        {!status.has_refresh_token ? (
          <div style={{ padding: '0 16px 16px' }}>
            <div className="small muted" style={{ marginBottom: 12 }}>
              {t('Google Fit permissions needed. Reconnect with fitness access.')}
            </div>
            <Button variant="outline" onClick={handleConnect} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <GoogleLogo size={18} />
              <span style={{ marginLeft: 8 }}>{t('Reconnect with Fit access')}</span>
            </Button>
          </div>
        ) : (
          <>
            <Row
              icon="check"
              iconTint="var(--green)"
              title={t('Google account connected')}
            />
            <div style={{ padding: '0 16px 16px' }}>
              <Button variant="primary" onClick={handleEnable} style={{ width: '100%' }}>
                {t('Enable Google Fit')}
              </Button>
            </div>
          </>
        )}
        <Row
          icon="signOut"
          iconTint="var(--red)"
          title={t('Disconnect Google')}
          accessory="chevron"
          onClick={handleDisconnect}
          danger
        />
      </Section>
    )
  }

  // Fully connected and enabled
  return (
    <Section title={t('Google Fit')}>
      <Row
        icon="check"
        iconTint="var(--green)"
        title={t('Connected')}
        value={formatLastSync(status.last_sync)}
        subtitle={status.last_sync ? t('Last synced') : t('Never synced')}
      />

      {lastSyncData && (
        <div style={{ padding: '0 16px' }}>
          <div className="card small" style={{ marginBottom: 12 }}>
            <div className="small muted" style={{ marginBottom: 8 }}>{t('Recent sync data')}</div>
            {lastSyncData.steps?.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>{t('Steps today')}</span>
                <strong>{lastSyncData.steps[lastSyncData.steps.length - 1]?.value?.toLocaleString() || 0}</strong>
              </div>
            )}
            {lastSyncData.calories?.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>{t('Calories today')}</span>
                <strong>{Math.round(lastSyncData.calories[lastSyncData.calories.length - 1]?.value || 0)}</strong>
              </div>
            )}
            {lastSyncData.distance?.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{t('Distance today')}</span>
                <strong>{((lastSyncData.distance[lastSyncData.distance.length - 1]?.value || 0) / 1000).toFixed(2)} km</strong>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: '0 16px 16px', display: 'flex', gap: 8 }}>
        <Button
          variant="primary"
          onClick={handleSync}
          disabled={syncing}
          style={{ flex: 1 }}
        >
          {syncing ? t('Syncing...') : t('Sync now')}
        </Button>
      </div>

      <Row
        icon="signOut"
        iconTint="var(--red)"
        title={t('Disconnect Google Fit')}
        accessory="chevron"
        onClick={handleDisconnect}
        danger
      />
    </Section>
  )
}
