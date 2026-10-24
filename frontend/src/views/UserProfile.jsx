import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'
import { Button, TextField } from '../components/ui.jsx'
import { repRankScore, repRankTier } from '../lib/ranks/repRank.js'
import { runRankScore, runRankTier } from '../lib/ranks/runRank.js'
import { recipeRankScore, recipeRankTier } from '../lib/ranks/recipeRank.js'
import { territoryRankScore, territoryRankTier } from '../lib/ranks/territoryRank.js'
import { RANK_TIERS, tierForScore } from '../lib/ranks/tiers.js'
import { AccoladeBadge } from './Challenges.jsx'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'

// ── Profile photo helpers ─────────────────────────────────────────────────────

/**
 * Resize an image File to a square JPEG data-URL, max `size` px on each side.
 * Returns a Promise<string> (data URL).
 */
function resizePhoto(file, size = 200) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = e => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const canvas = document.createElement('canvas')
        // Crop to square from the centre, then scale to `size`.
        const side = Math.min(img.width, img.height)
        const sx   = (img.width  - side) / 2
        const sy   = (img.height - side) / 2
        canvas.width  = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

// ── Mini rank badge ───────────────────────────────────────────────────────────

function MiniRankBadge({ label, icon, color, tier }) {
  const tierInfo = RANK_TIERS[tier] || RANK_TIERS.unranked
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: `color-mix(in srgb, ${color} 15%, var(--surface-2))`,
        border: `2px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto', fontSize: 18,
      }}>
        <Icon name={icon} style={{ color }} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: tierInfo.color }}>{tierInfo.label}</div>
      <div style={{ fontSize: 10, color: 'var(--label-3)' }}>{label}</div>
    </div>
  )
}

// ── Stat cell ─────────────────────────────────────────────────────────────────

function StatCell({ value, label }) {
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div className="dim small">{label}</div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function UserProfile() {
  const nav        = useNavigate()
  const S          = useStore(s => s.S)
  const user       = useStore(s => s.user)
  const updateS    = useStore(s => s.update)
  const setUser    = useStore(s => s.setUser)
  const isGuest    = useStore(s => s.isGuest())
  const toast      = useUI(s => s.toast)

  const [editingName, setEditingName]   = useState(false)
  const [nameInput,   setNameInput]     = useState('')
  const [nameBusy,    setNameBusy]      = useState(false)
  const [photoLoading, setPhotoLoading] = useState(false)
  const fileRef = useRef(null)

  const repScore       = repRankScore(S)
  const runScore       = runRankScore(S)
  const recipeScore    = recipeRankScore(S)
  const territoryScore = territoryRankScore(S)
  const totalScore     = repScore + runScore + recipeScore + territoryScore
  const overallTier    = tierForScore(totalScore)
  const overallTierInfo = RANK_TIERS[overallTier]

  const workoutCount = (S.workouts   || []).length
  const runCount     = (S.runs       || []).length
  const recipeCount  = (S.recipes    || []).length
  const accolades    = S.accolades   || []

  const displayName = isGuest ? t('Guest') : (user?.name || t('Athlete'))

  // ── Name editing ─────────────────────────────────────────────────────────

  const startEditing = () => { setNameInput(displayName); setEditingName(true) }
  const cancelEdit   = () => { setEditingName(false) }

  const saveName = async () => {
    const name = nameInput.trim().slice(0, 40)
    if (!name || name === displayName) { setEditingName(false); return }
    setNameBusy(true)
    try {
      if (!isGuest && user) {
        // Persist on the server first; only update local state on success.
        const res = await api('/api/account/name', { method: 'PATCH', body: JSON.stringify({ name }) })
        if (!res.ok) throw new Error(res.error || 'failed')
        setUser({ ...user, name: res.name || name })
      } else {
        // Guest or offline: store locally in S.profileName
        updateS(s => { s.profileName = name })
      }
      toast(t('Name updated'))
      setEditingName(false)
    } catch (e) {
      if (e.code === 'name-taken') toast(t('That name is already taken'))
      else toast(t('Something went wrong'))
    } finally {
      setNameBusy(false)
    }
  }

  // ── Photo upload ─────────────────────────────────────────────────────────

  const pickPhoto = () => fileRef.current?.click()

  const onFileChange = async e => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast(t('Please pick an image file')); return }
    setPhotoLoading(true)
    try {
      const dataUrl = await resizePhoto(file, 200)
      updateS(s => { s.profilePhoto = dataUrl })
      toast(t('Photo updated'))
    } catch {
      toast(t('Something went wrong'))
    } finally {
      setPhotoLoading(false)
      // Clear the input so picking the same file again fires onChange
      e.target.value = ''
    }
  }

  const removePhoto = () => {
    updateS(s => { delete s.profilePhoto })
    toast(t('Photo removed'))
  }

  // ── Derived display name (guest may have S.profileName) ──────────────────
  const finalName = isGuest
    ? (S.profileName || t('Guest'))
    : (user?.name || t('Athlete'))

  return (
    <div className="narrow">
      <div className="hdr">
        <div style={{ width: 36 }} />
        <h1>{t('Profile')}</h1>
        <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}>
          <Icon name="gear" />
        </button>
      </div>

      {/* Hidden file input for photo picking */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onFileChange}
        aria-label={t('Pick profile photo')}
      />

      {/* Profile card */}
      <div className="card" style={{ textAlign: 'center', padding: '28px 20px 20px' }}>

        {/* Avatar / photo */}
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 14 }}>
          <button
            className="profile-avatar-btn"
            onClick={pickPhoto}
            aria-label={S.profilePhoto ? t('Change profile photo') : t('Add profile photo')}
            disabled={photoLoading}
            style={{
              width: 80, height: 80, borderRadius: '50%',
              border: `3px solid ${overallTierInfo.color}`,
              background: S.profilePhoto
                ? 'none'
                : `color-mix(in srgb, ${overallTierInfo.color} 20%, var(--surface-2))`,
              overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, cursor: 'pointer', padding: 0,
              position: 'relative',
            }}>
            {S.profilePhoto
              ? <img src={S.profilePhoto} alt={finalName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : photoLoading
                ? <Icon name="hourglass" style={{ fontSize: 24, color: overallTierInfo.color }} />
                : <span style={{ color: overallTierInfo.color, fontWeight: 700 }}>{finalName[0]?.toUpperCase() || '?'}</span>
            }
            {/* Camera overlay hint */}
            <span className="profile-avatar-overlay" aria-hidden="true">
              <Icon name="camera" style={{ fontSize: 16, color: '#fff' }} />
            </span>
          </button>

          {/* Remove photo button */}
          {S.profilePhoto && (
            <button
              className="iconbtn profile-photo-remove"
              onClick={removePhoto}
              aria-label={t('Remove photo')}
              style={{
                position: 'absolute', top: -2, right: -2,
                width: 22, height: 22, borderRadius: '50%',
                background: 'var(--surface-3)', fontSize: 11,
                border: '2px solid var(--bg)',
              }}>
              <Icon name="xmark" />
            </button>
          )}
        </div>

        {/* Name — tap to edit */}
        {editingName ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', maxWidth: 280, margin: '0 auto' }}>
            <TextField
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              maxLength={40}
              placeholder={t('Your name')}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') cancelEdit() }}
              autoFocus
              style={{ flex: 1 }}
              aria-label={t('Edit name')}
            />
            <Button size="sm" variant="primary" onClick={saveName} disabled={nameBusy || !nameInput.trim()}>
              {t('Save')}
            </Button>
            <button className="iconbtn" onClick={cancelEdit} aria-label={t('Cancel')}>
              <Icon name="xmark" />
            </button>
          </div>
        ) : (
          <button
            className="profile-name-btn"
            onClick={startEditing}
            aria-label={t('Edit name')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{finalName}</span>
            <Icon name="pencil" style={{ fontSize: 14, color: 'var(--label-3)', marginLeft: 6, verticalAlign: 'middle' }} />
          </button>
        )}

        {S.gym?.name && (
          <div className="muted small" style={{ marginTop: 6 }}>
            <Icon name="dumbbell" style={{ fontSize: 12, marginRight: 4 }} />
            {S.gym.name}
          </div>
        )}

        {/* Overall rank */}
        <div style={{ marginTop: 12 }}>
          <span className="tag" style={{
            background: `color-mix(in srgb, ${overallTierInfo.color} 15%, var(--surface-2))`,
            color: overallTierInfo.color,
            fontSize: 14, fontWeight: 700, padding: '4px 14px',
          }}>
            {overallTierInfo.label} · {totalScore.toLocaleString()} pts
          </span>
        </div>
      </div>

      {/* Sub-rank badges */}
      <div className="card">
        <div style={{ display: 'flex', gap: 8 }}>
          <MiniRankBadge label="REP"       icon="dumbbell" color="var(--blue)"   tier={repRankTier(repScore)} />
          <MiniRankBadge label="RUN"       icon="bolt"     color="var(--green)"  tier={runRankTier(runScore)} />
          <MiniRankBadge label="RECIPE"    icon="leaf"     color="var(--orange)" tier={recipeRankTier(recipeScore)} />
          <MiniRankBadge label="TERRITORY" icon="map"      color="var(--purple)" tier={territoryRankTier(territoryScore)} />
        </div>
      </div>

      {/* Stats */}
      <div className="card">
        <div style={{ display: 'flex', gap: 8 }}>
          <StatCell value={workoutCount} label={t('workouts')} />
          <StatCell value={runCount}     label={t('runs')}     />
          <StatCell value={recipeCount}  label={t('recipes')}  />
          <StatCell value={(S.territory?.capturedCells || []).length} label={t('cells')} />
        </div>
      </div>

      {/* Accolades */}
      <div className="card">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{t('Accolades')}</h3>
          <Button size="sm" variant="ghost" onClick={() => nav('/challenges')}>{t('View all')}</Button>
        </div>
        {accolades.length > 0
          ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {accolades.slice(0, 12).map(a => <AccoladeBadge key={a.id} accolade={a} size="sm" />)}
            </div>
          : <div className="muted small">{t('Complete challenges to earn accolades.')}</div>
        }
      </div>

      {/* Actions */}
      <Button icon="chart" onClick={() => nav('/ranks')}>{t('View my ranks')}</Button>
      <div style={{ height: 8 }} />
      <Button icon="gear"  onClick={() => nav('/settings')}>{t('Settings')}</Button>
    </div>
  )
}
