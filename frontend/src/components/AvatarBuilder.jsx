import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BodyChart, ViewSide, MUSCLE_MAP } from 'body-muscles'
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

// Character creation style body measurement visualizer using body-muscles library.
// Maps measurement values to muscle intensity for a visually appealing representation.

// Map measurement keys to body-muscles muscle IDs
// body-muscles has 70+ muscle regions - we map our measurements to relevant muscle groups
// Front view IDs from muscles.front.js, Back view IDs from muscles.back.js
const MEASUREMENT_TO_MUSCLES = {
  neck: ['neck-left', 'neck-right', 'nape'],
  shoulders: [
    // Front
    'shoulder-front-left', 'shoulder-front-right', 'shoulder-side-left', 'shoulder-side-right',
    // Back
    'deltoid-rear-left', 'deltoid-rear-right',
    'traps-upper-left', 'traps-upper-right',
  ],
  chest: ['chest-upper-left', 'chest-upper-right', 'chest-lower-left', 'chest-lower-right'],
  waist: ['obliques-left', 'obliques-right', 'serratus-anterior-left', 'serratus-anterior-right'],
  abdomen: ['abs-upper-left', 'abs-upper-right', 'abs-lower-left', 'abs-lower-right'],
  hips: [
    // Front
    'hip-flexor-left', 'hip-flexor-right',
    // Back (glutes)
    'gluteus-maximus-left', 'gluteus-maximus-right',
    'gluteus-medius-left', 'gluteus-medius-right',
  ],
  upperArmLeft: ['biceps-left', 'triceps-long-left', 'triceps-lateral-left'],
  upperArmRight: ['biceps-right', 'triceps-long-right', 'triceps-lateral-right'],
  forearmLeft: ['forearm-left', 'forearm-flexors-left', 'forearm-extensors-left'],
  forearmRight: ['forearm-right', 'forearm-flexors-right', 'forearm-extensors-right'],
  thighLeft: [
    'quads-left', 'adductors-left',
    'hamstrings-medial-left', 'hamstrings-lateral-left',
  ],
  thighRight: [
    'quads-right', 'adductors-right',
    'hamstrings-medial-right', 'hamstrings-lateral-right',
  ],
  calfLeft: [
    'tibialis-anterior-left',
    'calves-gastroc-medial-left', 'calves-gastroc-lateral-left', 'calves-soleus-left',
  ],
  calfRight: [
    'tibialis-anterior-right',
    'calves-gastroc-medial-right', 'calves-gastroc-lateral-right', 'calves-soleus-right',
  ],
}

// Reverse map: muscle ID to measurement key
const MUSCLE_TO_MEASUREMENT = {}
for (const [measureKey, muscleIds] of Object.entries(MEASUREMENT_TO_MUSCLES)) {
  for (const muscleId of muscleIds) {
    MUSCLE_TO_MEASUREMENT[muscleId] = measureKey
  }
}

// Baseline measurements in cm for intensity calculation
const BASELINE_MEASUREMENTS = {
  neck: 38,
  shoulders: 115,
  chest: 100,
  waist: 85,
  abdomen: 88,
  hips: 100,
  upperArmLeft: 32,
  upperArmRight: 32,
  forearmLeft: 28,
  forearmRight: 28,
  thighLeft: 55,
  thighRight: 55,
  calfLeft: 38,
  calfRight: 38,
}

// Convert measurement value to intensity (0-10)
// Higher intensity = bigger muscles = more developed
function measurementToIntensity(value, baseline) {
  if (value == null || baseline == null) return 0
  // Scale: at baseline = 5, below = lower, above = higher
  const ratio = value / baseline
  return Math.max(0, Math.min(10, Math.round(ratio * 5)))
}

// Build body state for the chart based on measurements
function buildBodyState(measurements, selected) {
  const bodyState = {}
  
  for (const [measureKey, muscleIds] of Object.entries(MEASUREMENT_TO_MUSCLES)) {
    const value = measurements.raw[measureKey]
    const baseline = BASELINE_MEASUREMENTS[measureKey]
    const intensity = measurementToIntensity(value, baseline)
    const isSelected = selected === measureKey
    
    for (const muscleId of muscleIds) {
      bodyState[muscleId] = {
        intensity: value != null ? intensity : 0,
        selected: isSelected,
      }
    }
  }
  
  return bodyState
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
        <p>{t('Tap any muscle group to see measurements and track progress.')}</p>
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

function BodyMapView({ measurements, selected, onSelect, view }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  
  const bodyState = useMemo(() => 
    buildBodyState(measurements, selected), 
    [measurements, selected]
  )
  
  useEffect(() => {
    if (!containerRef.current) return
    
    // Destroy previous chart if exists
    if (chartRef.current) {
      chartRef.current.destroy()
    }
    
    // Create new chart
    chartRef.current = new BodyChart(containerRef.current, {
      view: view === 'back' ? ViewSide.BACK : ViewSide.FRONT,
      bodyState,
      showViewLabel: false,
      enableTransitions: true,
      className: 'body-muscles-chart',
      onMuscleClick: (muscleId, muscleName) => {
        const measureKey = MUSCLE_TO_MEASUREMENT[muscleId]
        if (measureKey) {
          onSelect(measureKey)
        }
      },
      onMuscleHover: (muscleId) => {
        // Could add hover effects here
      },
    })
    
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [view])
  
  // Update body state when measurements or selection changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.update({ bodyState })
    }
  }, [bodyState])
  
  return (
    <div ref={containerRef} className="body-map-container" />
  )
}

/**
 * Character creation-style avatar for body measurements.
 * Uses body-muscles library for professional anatomical visualization.
 */
export default function AvatarBuilder({ S, selected, onSelect, onLog, onAddPhoto, photos = [] }) {
  const [hoverPhoto, setHoverPhoto] = useState(null)
  const [range, setRange] = useState(90)
  const [view, setView] = useState('front') // 'front' or 'back'
  
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
        raw[field.key] = latest.value // Keep raw cm value for intensity calculation
      }
    }
    
    return { values, raw }
  }, [S])
  
  const handleClearSelection = useCallback(() => {
    onSelect(null)
  }, [onSelect])
  
  return (
    <div className="avatar-builder">
      <div className="avatar-main">
        {/* Body visualization */}
        <div className="avatar-body-section">
          {/* View toggle */}
          <div className="avatar-view-toggle">
            <button 
              className={`avatar-view-btn${view === 'front' ? ' active' : ''}`}
              onClick={() => setView('front')}
            >
              {t('Front')}
            </button>
            <button 
              className={`avatar-view-btn${view === 'back' ? ' active' : ''}`}
              onClick={() => setView('back')}
            >
              {t('Back')}
            </button>
          </div>
          
          <BodyMapView
            measurements={measurements}
            selected={selected}
            onSelect={onSelect}
            view={view}
          />
          
          {/* Intensity legend */}
          <div className="avatar-legend">
            <span className="avatar-legend-label">{t('Less developed')}</span>
            <div className="avatar-legend-gradient" />
            <span className="avatar-legend-label">{t('More developed')}</span>
          </div>
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
