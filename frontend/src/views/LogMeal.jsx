import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import FoodScanner from '../components/FoodScanner.jsx'
import { t } from '../lib/i18n.js'

// ── Photo capture area ────────────────────────────────────────────────────────

function PhotoArea({ photo, onCapture }) {
  const inputRef = useRef(null)

  const handleFileChange = e => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      onCapture(ev.target.result)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      style={{
        width: '100%',
        aspectRatio: '4/3',
        borderRadius: 12,
        background: photo ? `url(${photo}) center/cover no-repeat` : 'var(--surface-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: '2px dashed var(--sep)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {!photo && (
        <div style={{ textAlign: 'center', color: 'var(--label-3)' }}>
          <Icon name="camera" style={{ fontSize: 40, marginBottom: 8 }} />
          <div className="small">{t('Tap to add photo')}</div>
        </div>
      )}
      {photo && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            background: 'rgba(0,0,0,0.6)',
            borderRadius: 8,
            padding: '4px 8px',
            color: '#fff',
            fontSize: 12,
          }}
        >
          {t('Tap to change')}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  )
}

// ── Main LogMeal view ─────────────────────────────────────────────────────────

export default function LogMeal() {
  const nav = useNavigate()
  const updateS = useStore(s => s.update)

  const [photo, setPhoto] = useState(null)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [nutrition, setNutrition] = useState(null)
  const [scanning, setScanning] = useState(false)

  const handleScanAdd = meal => {
    // Fill fields from scanned product
    setName(meal.name || '')
    setNutrition(meal.nutrition || null)
    setScanning(false)
  }

  const handleSave = () => {
    const meal = {
      id: crypto.randomUUID(),
      name: name.trim() || '',
      time: new Date().toISOString(),
      photo: photo || null,
      notes: notes.trim() || '',
      nutrition: nutrition || null,
    }
    updateS(s => {
      s.meals = [...(s.meals || []), meal]
    })
    nav(-1)
  }

  // At least one piece of info required
  const canSave = photo || name.trim() || nutrition

  return (
    <div className="narrow">
      <div className="hdr">
        <div className="row" style={{ gap: 12 }}>
          <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}>
            <Icon name="chevronLeft" />
          </button>
          <h1>{t('Log Meal')}</h1>
        </div>
      </div>

      {scanning ? (
        <FoodScanner mode="meal" onAdd={handleScanAdd} onCancel={() => setScanning(false)} />
      ) : (
        <>
          {/* Photo capture */}
          <div className="card">
            <div className="muted small" style={{ marginBottom: 8 }}>{t('Photo')}</div>
            <PhotoArea photo={photo} onCapture={setPhoto} />
            {photo && (
              <Button
                size="sm"
                variant="ghost"
                icon="trash"
                onClick={() => setPhoto(null)}
                style={{ marginTop: 8, color: 'var(--red)' }}
              >
                {t('Remove photo')}
              </Button>
            )}
          </div>

          {/* Barcode scanner */}
          <div className="card">
            <Button variant="tinted" icon="barcode" onClick={() => setScanning(true)} style={{ width: '100%' }}>
              {t('Scan Barcode')}
            </Button>
            {nutrition && (
              <div style={{ marginTop: 12 }}>
                <div className="muted small" style={{ marginBottom: 6 }}>{t('Scanned nutrition')}</div>
                <div className="small" style={{ lineHeight: 1.6 }}>
                  {[
                    nutrition.calories != null && `${nutrition.calories} kcal`,
                    nutrition.protein != null && `${nutrition.protein}g protein`,
                    nutrition.carbs != null && `${nutrition.carbs}g carbs`,
                    nutrition.fat != null && `${nutrition.fat}g fat`,
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
            )}
          </div>

          {/* Name / notes */}
          <div className="card">
            <div className="muted small" style={{ marginBottom: 6 }}>{t('Name (optional)')}</div>
            <input
              className="input"
              placeholder={t('e.g. Lunch, Protein shake')}
              value={name}
              onChange={e => setName(e.target.value)}
            />

            <div className="muted small" style={{ marginTop: 14, marginBottom: 6 }}>{t('Notes (optional)')}</div>
            <textarea
              className="input"
              placeholder={t('Add any details...')}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </div>

          {/* Save button */}
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!canSave}
            style={{ width: '100%', marginTop: 8 }}
          >
            {t('Save')}
          </Button>
          <div className="muted small" style={{ textAlign: 'center', marginTop: 8 }}>
            {t('Add a photo, name, or scan a barcode to save')}
          </div>
        </>
      )}
    </div>
  )
}
