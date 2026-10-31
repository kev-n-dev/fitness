import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { t } from '../lib/i18n.js'
import { 
  MEASUREMENT_FIELDS, measurementUnit, toMeasurementDisplay, latestMeasurement,
  measurementSeries 
} from '../lib/measurements.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { CustomThumb, useMediaUrl } from './CustomMedia.jsx'
import LineChart from './LineChart.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Lazy load the 3D visualizer to avoid blocking initial render
const BodyVisualizer3D = lazy(() => import('./BodyVisualizer3D.jsx'))

// Fallback 2D silhouette while 3D loads or if WebGL unavailable
function BodySilhouette({ measurements }) {
  return (
    <div className="body-silhouette">
      <svg viewBox="0 0 100 200" className="body-silhouette-svg">
        {/* Simple human silhouette */}
        <ellipse cx="50" cy="20" rx="12" ry="15" fill="var(--surface-3)" />
        <path
          d="M50 35 L50 90 M30 50 L70 50 M50 90 L35 150 M50 90 L65 150 M35 150 L30 190 M65 150 L70 190"
          stroke="var(--surface-3)"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <div className="body-silhouette-loading">
        <div className="body-3d-spinner" />
        <span>{t('Loading 3D model...')}</span>
      </div>
    </div>
  )
}

function PhotoTooltip({ photo, x, y }) {
  const url = useMediaUrl(photo.m)
  if (!url.url) return null
  
  return (
    <div 
      className="avatar-photo-tooltip"
      style={{ left: x, top: y }}
    >
      <img src={url.url} alt="" />
      <div className="avatar-photo-date">{fmtDate(photo.d, true)}</div>
    </div>
  )
}

function ProgressGraph({ S, selectedPart, range, onHoverPoint, photos }) {
  const chartRef = useRef(null)
  const points = selectedPart ? measurementSeries(S, selectedPart, range) : []
  const unit = selectedPart === 'bodyFat' ? '%' : measurementUnit(S.unit)
  
  // Find photos that match the data points
  const photosAtPoints = useMemo(() => {
    if (!photos.length || !points.length) return {}
    const map = {}
    for (const point of points) {
      const matching = photos.filter(p => p.d === point.d)
      if (matching.length) map[point.d] = matching[0]
    }
    return map
  }, [photos, points])
  
  const handleMouseMove = useCallback((e) => {
    if (!chartRef.current || !points.length) return
    const rect = chartRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pct = x / rect.width
    const idx = Math.round(pct * (points.length - 1))
    const point = points[idx]
    if (point && photosAtPoints[point.d]) {
      onHoverPoint({ photo: photosAtPoints[point.d], x: e.clientX, y: rect.top - 10 })
    } else {
      onHoverPoint(null)
    }
  }, [points, photosAtPoints, onHoverPoint])
  
  const handleMouseLeave = useCallback(() => {
    onHoverPoint(null)
  }, [onHoverPoint])
  
  if (!selectedPart || !points.length) {
    return (
      <div className="avatar-graph-empty">
        <Icon name="chart" />
        <span>{selectedPart ? t('No data yet') : t('Select a body part')}</span>
      </div>
    )
  }
  
  // Mark points that have photos
  const enhancedPoints = points.map(p => ({
    ...p,
    hasPhoto: !!photosAtPoints[p.d],
  }))
  
  return (
    <div 
      ref={chartRef}
      className="avatar-graph"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <LineChart 
        points={enhancedPoints} 
        h={140} 
        unit={unit} 
        color="var(--acc)"
      />
      {Object.keys(photosAtPoints).length > 0 && (
        <div className="avatar-graph-hint">
          <Icon name="image" /> {t('Hover points with photos')}
        </div>
      )}
    </div>
  )
}

function MeasurementPanel({ S, selectedPart, onLog, onAddPhoto, photos, onClear }) {
  const field = selectedPart ? MEASUREMENT_FIELDS.find(f => f.key === selectedPart) : null
  const latest = selectedPart ? latestMeasurement(S, selectedPart) : null
  const unit = selectedPart === 'bodyFat' ? '%' : measurementUnit(S.unit)
  
  // Get all measurements for this part
  const allValues = useMemo(() => {
    if (!selectedPart) return []
    return measurementSeries(S, selectedPart, 0) // 0 = all time
  }, [S, selectedPart])
  
  const first = allValues[0]
  const current = allValues[allValues.length - 1]
  const totalChange = first && current ? Math.round((current.y - first.y) * 10) / 10 : null
  
  // Photos for this measurement's dates
  const relevantPhotos = useMemo(() => {
    const dates = new Set(allValues.map(v => v.d))
    return photos.filter(p => dates.has(p.d))
  }, [allValues, photos])
  
  if (!selectedPart) {
    return (
      <div className="avatar-panel-empty">
        <div className="avatar-panel-icon"><Icon name="figureStrength" /></div>
        <h3>{t('Your Body')}</h3>
        <p>{t('Track your body measurements and see your progress visualized in 3D.')}</p>
        <Button icon="plus" onClick={() => onLog()}>{t('Log measurements')}</Button>
      </div>
    )
  }
  
  return (
    <div className="avatar-panel">
      <div className="avatar-panel-header">
        <h3>{field ? t(field.label) : selectedPart}</h3>
        <button className="iconbtn" onClick={onClear} aria-label={t('Close')}>
          <Icon name="xmark" />
        </button>
      </div>
      
      {latest ? (
        <>
          <div className="avatar-panel-value">
            <span className="avatar-value-big">
              {fmtNum(selectedPart === 'bodyFat' ? latest.value : toMeasurementDisplay(latest.value, S.unit))}
            </span>
            <span className="avatar-value-unit">{unit}</span>
          </div>
          
          {totalChange !== null && totalChange !== 0 && (
            <div className={`avatar-panel-change ${totalChange > 0 ? 'up' : 'down'}`}>
              {totalChange > 0 ? '↑' : '↓'} {Math.abs(totalChange)} {unit} {t('total change')}
            </div>
          )}
          
          <div className="avatar-panel-meta">
            {t('Last updated {0}', fmtDate(latest.entry.d, true))}
          </div>
        </>
      ) : (
        <div className="avatar-panel-empty-value">
          <p>{t('No measurements yet')}</p>
        </div>
      )}
      
      {relevantPhotos.length > 0 && (
        <div className="avatar-panel-photos">
          <div className="avatar-panel-photos-label">
            <Icon name="image" /> {t('Progress photos')}
          </div>
          <div className="avatar-panel-photos-grid">
            {relevantPhotos.slice(0, 4).map(p => (
              <div key={p.key} className="avatar-photo-thumb">
                <CustomThumb ex={{ custom: true, media: p.m }} />
              </div>
            ))}
            {relevantPhotos.length > 4 && (
              <div className="avatar-photo-more">+{relevantPhotos.length - 4}</div>
            )}
          </div>
        </div>
      )}
      
      <div className="avatar-panel-actions">
        <Button size="sm" icon="plus" onClick={() => onLog(selectedPart)}>{t('Update')}</Button>
        <Button size="sm" variant="ghost" icon="camera" onClick={() => onAddPhoto(selectedPart)}>
          {t('Photo')}
        </Button>
      </div>
    </div>
  )
}

// Quick measurement buttons for selecting body parts
function MeasurementQuickSelect({ selected, onSelect, measurements }) {
  const groups = useMemo(() => {
    const torso = ['chest', 'waist', 'hips', 'shoulders', 'neck', 'abdomen']
    const arms = ['upperArmLeft', 'upperArmRight', 'forearmLeft', 'forearmRight']
    const legs = ['thighLeft', 'thighRight', 'calfLeft', 'calfRight']
    
    return { torso, arms, legs }
  }, [])
  
  return (
    <div className="avatar-quick-select">
      <div className="avatar-quick-group">
        <span className="avatar-quick-label">{t('Torso')}</span>
        <div className="avatar-quick-btns">
          {groups.torso.map(key => {
            const field = MEASUREMENT_FIELDS.find(f => f.key === key)
            if (!field) return null
            const hasValue = measurements.raw[key] != null
            return (
              <button
                key={key}
                className={`avatar-quick-btn${selected === key ? ' active' : ''}${hasValue ? ' has-value' : ''}`}
                onClick={() => onSelect(selected === key ? null : key)}
              >
                {t(field.label)}
              </button>
            )
          })}
        </div>
      </div>
      <div className="avatar-quick-group">
        <span className="avatar-quick-label">{t('Arms')}</span>
        <div className="avatar-quick-btns">
          {groups.arms.map(key => {
            const field = MEASUREMENT_FIELDS.find(f => f.key === key)
            if (!field) return null
            const hasValue = measurements.raw[key] != null
            return (
              <button
                key={key}
                className={`avatar-quick-btn${selected === key ? ' active' : ''}${hasValue ? ' has-value' : ''}`}
                onClick={() => onSelect(selected === key ? null : key)}
              >
                {t(field.label)}
              </button>
            )
          })}
        </div>
      </div>
      <div className="avatar-quick-group">
        <span className="avatar-quick-label">{t('Legs')}</span>
        <div className="avatar-quick-btns">
          {groups.legs.map(key => {
            const field = MEASUREMENT_FIELDS.find(f => f.key === key)
            if (!field) return null
            const hasValue = measurements.raw[key] != null
            return (
              <button
                key={key}
                className={`avatar-quick-btn${selected === key ? ' active' : ''}${hasValue ? ' has-value' : ''}`}
                onClick={() => onSelect(selected === key ? null : key)}
              >
                {t(field.label)}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Character creation-style avatar for body measurements.
 * Uses OxiHuman 3D body visualizer for realistic body representation.
 */
export default function AvatarBuilder({ S, selected, onSelect, onLog, onAddPhoto, photos = [] }) {
  const [hoverPhoto, setHoverPhoto] = useState(null)
  const [range, setRange] = useState(90)
  const [modelReady, setModelReady] = useState(false)
  
  // Calculate current measurement values
  const measurements = useMemo(() => {
    const values = {}
    const raw = {}
    
    for (const field of MEASUREMENT_FIELDS) {
      const latest = latestMeasurement(S, field.key)
      if (latest?.value != null) {
        const displayValue = field.key === 'bodyFat' 
          ? latest.value 
          : toMeasurementDisplay(latest.value, S.unit)
        values[field.key] = displayValue
        raw[field.key] = latest.value // Keep raw cm value for 3D model
      }
    }
    
    // Also get height and weight from profile for 3D model
    if (S.height) raw.height = S.height
    if (S.weight) raw.weight = S.weight
    
    return { values, raw }
  }, [S])
  
  const handleClearSelection = useCallback(() => {
    onSelect(null)
  }, [onSelect])
  
  const handleModelReady = useCallback(() => {
    setModelReady(true)
  }, [])
  
  return (
    <div className="avatar-builder">
      <div className="avatar-main">
        {/* 3D Body visualization */}
        <div className="avatar-body-section avatar-body-3d">
          <Suspense fallback={<BodySilhouette measurements={measurements} />}>
            <BodyVisualizer3D 
              measurements={measurements.raw} 
              onReady={handleModelReady}
            />
          </Suspense>
          
          {/* Measurement quick select buttons */}
          <MeasurementQuickSelect
            selected={selected}
            onSelect={onSelect}
            measurements={measurements}
          />
        </div>
        
        {/* Measurement panel */}
        <MeasurementPanel
          S={S}
          selectedPart={selected}
          onLog={onLog}
          onAddPhoto={onAddPhoto}
          photos={photos}
          onClear={handleClearSelection}
        />
      </div>
      
      {/* Progress graph */}
      <div className="avatar-graph-section">
        <div className="avatar-graph-header">
          <h4>{t('Progress over time')}</h4>
          <div className="avatar-range-btns">
            {[
              { value: 30, label: '1M' },
              { value: 90, label: '3M' },
              { value: 365, label: '1Y' },
              { value: 0, label: t('All') },
            ].map(opt => (
              <button
                key={opt.value}
                className={`avatar-range-btn${range === opt.value ? ' active' : ''}`}
                onClick={() => setRange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <ProgressGraph
          S={S}
          selectedPart={selected}
          range={range}
          onHoverPoint={setHoverPhoto}
          photos={photos}
        />
      </div>
      
      {/* Photo tooltip on hover */}
      {hoverPhoto && (
        <PhotoTooltip
          photo={hoverPhoto.photo}
          x={hoverPhoto.x}
          y={hoverPhoto.y}
        />
      )}
    </div>
  )
}
