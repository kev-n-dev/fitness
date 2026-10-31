import { useCallback, useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { 
  MEASUREMENT_FIELDS, measurementUnit, toMeasurementDisplay, latestMeasurement,
  measurementSeries, measurementValue 
} from '../lib/measurements.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { workoutMediaOf } from '../lib/media-refs.js'
import { CustomThumb, useMediaUrl } from './CustomMedia.jsx'
import LineChart from './LineChart.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Character creation style avatar builder for body measurements.
// Muscle/body part sizes visually scale based on measurement values.
// Graph shows progress over time with photo thumbnails on hover.

// Baseline measurements in cm for "average" starting point
// These are used to calculate scale factors for the avatar
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
  wristLeft: 17,
  wristRight: 17,
  thighLeft: 55,
  thighRight: 55,
  calfLeft: 38,
  calfRight: 38,
  ankleLeft: 22,
  ankleRight: 22,
}

// Body part definitions with SVG paths that can be scaled
// Each part has: key, paths (array of SVG path data), anchor point, scale axis
const BODY_PARTS = {
  // Head (static, no scaling)
  head: {
    paths: ['M100,25 C115,25 125,40 125,55 C125,75 115,85 100,85 C85,85 75,75 75,55 C75,40 85,25 100,25'],
    anchor: { x: 100, y: 55 },
    static: true,
  },
  neck: {
    key: 'neck',
    paths: ['M90,85 L90,105 L110,105 L110,85'],
    anchor: { x: 100, y: 95 },
    scaleX: true,
  },
  // Torso
  shoulders: {
    key: 'shoulders',
    paths: ['M55,110 C45,115 40,125 42,135 L60,130 L90,115 L110,115 L140,130 L158,135 C160,125 155,115 145,110 L100,105 Z'],
    anchor: { x: 100, y: 120 },
    scaleX: true,
  },
  chest: {
    key: 'chest',
    paths: [
      // Left pec
      'M60,130 C55,145 55,160 65,165 C75,170 85,165 90,155 L90,130 Z',
      // Right pec  
      'M140,130 C145,145 145,160 135,165 C125,170 115,165 110,155 L110,130 Z',
    ],
    anchor: { x: 100, y: 145 },
    scaleX: true,
    scaleY: true,
  },
  waist: {
    key: 'waist',
    paths: ['M70,175 C65,190 65,205 70,215 L130,215 C135,205 135,190 130,175 L110,170 L90,170 Z'],
    anchor: { x: 100, y: 195 },
    scaleX: true,
  },
  abdomen: {
    key: 'abdomen',
    paths: [
      // Abs definition
      'M85,175 L85,210 L95,210 L95,175 Z',
      'M105,175 L105,210 L115,210 L115,175 Z',
    ],
    anchor: { x: 100, y: 192 },
    scaleX: true,
  },
  hips: {
    key: 'hips',
    paths: ['M70,215 C60,235 58,250 65,260 L135,260 C142,250 140,235 130,215 Z'],
    anchor: { x: 100, y: 238 },
    scaleX: true,
  },
  // Arms
  upperArmLeft: {
    key: 'upperArmLeft',
    paths: ['M42,135 C30,145 25,165 30,185 L50,180 C48,165 50,150 55,140 Z'],
    anchor: { x: 40, y: 160 },
    scaleX: true,
    scaleY: true,
  },
  upperArmRight: {
    key: 'upperArmRight',
    paths: ['M158,135 C170,145 175,165 170,185 L150,180 C152,165 150,150 145,140 Z'],
    anchor: { x: 160, y: 160 },
    scaleX: true,
    scaleY: true,
  },
  forearmLeft: {
    key: 'forearmLeft',
    paths: ['M30,185 C25,210 22,235 25,255 L42,252 C45,235 48,215 50,195 Z'],
    anchor: { x: 35, y: 220 },
    scaleX: true,
  },
  forearmRight: {
    key: 'forearmRight',
    paths: ['M170,185 C175,210 178,235 175,255 L158,252 C155,235 152,215 150,195 Z'],
    anchor: { x: 165, y: 220 },
    scaleX: true,
  },
  // Hands (static)
  handLeft: {
    paths: ['M25,255 C20,265 18,280 22,290 C28,295 38,292 42,285 L42,252 Z'],
    anchor: { x: 30, y: 272 },
    static: true,
  },
  handRight: {
    paths: ['M175,255 C180,265 182,280 178,290 C172,295 162,292 158,285 L158,252 Z'],
    anchor: { x: 170, y: 272 },
    static: true,
  },
  // Legs
  thighLeft: {
    key: 'thighLeft',
    paths: ['M65,260 C55,290 52,320 55,350 L80,348 C85,320 82,295 80,270 Z'],
    anchor: { x: 68, y: 305 },
    scaleX: true,
    scaleY: true,
  },
  thighRight: {
    key: 'thighRight',
    paths: ['M135,260 C145,290 148,320 145,350 L120,348 C115,320 118,295 120,270 Z'],
    anchor: { x: 132, y: 305 },
    scaleX: true,
    scaleY: true,
  },
  calfLeft: {
    key: 'calfLeft',
    paths: ['M55,350 C48,380 45,410 50,435 L72,432 C78,408 80,380 80,355 Z'],
    anchor: { x: 62, y: 392 },
    scaleX: true,
  },
  calfRight: {
    key: 'calfRight',
    paths: ['M145,350 C152,380 155,410 150,435 L128,432 C122,408 120,380 120,355 Z'],
    anchor: { x: 138, y: 392 },
    scaleX: true,
  },
  // Feet (static)
  footLeft: {
    paths: ['M50,435 L45,460 L75,460 L72,435 Z'],
    anchor: { x: 60, y: 447 },
    static: true,
  },
  footRight: {
    paths: ['M150,435 L155,460 L125,460 L128,435 Z'],
    anchor: { x: 140, y: 447 },
    static: true,
  },
}

// Calculate scale factor based on measurement vs baseline
function getScaleFactor(measurement, baseline) {
  if (!measurement || !baseline) return 1
  // Scale between 0.7 and 1.5 based on how far from baseline
  const ratio = measurement / baseline
  return Math.max(0.7, Math.min(1.5, 0.5 + ratio * 0.5))
}

// Get color based on muscle group
function getPartColor(key, selected) {
  if (selected) return 'var(--acc)'
  // Color by body region
  if (['chest', 'upperArmLeft', 'upperArmRight'].includes(key)) return 'var(--teal)'
  if (['shoulders', 'forearmLeft', 'forearmRight'].includes(key)) return 'color-mix(in srgb, var(--teal) 80%, var(--surface))'
  if (['thighLeft', 'thighRight', 'calfLeft', 'calfRight'].includes(key)) return 'var(--blue)'
  if (['waist', 'abdomen', 'hips'].includes(key)) return 'color-mix(in srgb, var(--orange) 60%, var(--surface))'
  if (key === 'neck') return 'color-mix(in srgb, var(--label) 30%, var(--surface))'
  return 'var(--surface-2)'
}

function BodyPart({ partKey, part, scale, selected, onSelect, measurements }) {
  const scaleX = part.scaleX ? scale : 1
  const scaleY = part.scaleY ? scale : 1
  const transform = part.static ? '' : `translate(${part.anchor.x}px, ${part.anchor.y}px) scale(${scaleX}, ${scaleY}) translate(${-part.anchor.x}px, ${-part.anchor.y}px)`
  
  const value = part.key && measurements[part.key]
  const hasValue = value != null
  
  return (
    <g
      className={`avatar-part${selected ? ' selected' : ''}${hasValue ? ' has-value' : ''}`}
      style={{ transform, transformOrigin: `${part.anchor.x}px ${part.anchor.y}px` }}
      onClick={part.key ? () => onSelect(part.key) : undefined}
      role={part.key ? 'button' : undefined}
      tabIndex={part.key ? 0 : undefined}
      onKeyDown={part.key ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(part.key) } } : undefined}
      aria-label={part.key ? t(MEASUREMENT_FIELDS.find(f => f.key === part.key)?.label || part.key) : undefined}
    >
      {part.paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill={getPartColor(partKey, selected)}
          stroke="var(--surface)"
          strokeWidth="1.5"
          className="avatar-path"
        />
      ))}
    </g>
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
        dotRadius={p => p.hasPhoto ? 6 : 3}
        dotColor={p => p.hasPhoto ? 'var(--yellow)' : undefined}
      />
      {Object.keys(photosAtPoints).length > 0 && (
        <div className="avatar-graph-hint">
          <Icon name="image" /> {t('Hover points with photos')}
        </div>
      )}
    </div>
  )
}

function MeasurementPanel({ S, selectedPart, onLog, onAddPhoto, photos }) {
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
        <h3>{t('Your Body Avatar')}</h3>
        <p>{t('Tap any body part to see measurements and track progress over time.')}</p>
        <Button icon="plus" onClick={() => onLog()}>{t('Log measurements')}</Button>
      </div>
    )
  }
  
  return (
    <div className="avatar-panel">
      <div className="avatar-panel-header">
        <h3>{field ? t(field.label) : selectedPart}</h3>
        <Button size="sm" icon="plus" onClick={() => onLog(selectedPart)}>{t('Update')}</Button>
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
        <Button size="sm" variant="ghost" icon="camera" onClick={() => onAddPhoto(selectedPart)}>
          {t('Add photo')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Character creator-style avatar that shows body measurements.
 * Muscle/body part sizes scale based on measurement values.
 */
export default function AvatarBuilder({ S, selected, onSelect, onLog, onAddPhoto, photos = [] }) {
  const [hoverPhoto, setHoverPhoto] = useState(null)
  const [range, setRange] = useState(90)
  
  // Calculate current measurement values and scale factors
  const measurements = useMemo(() => {
    const values = {}
    const scales = {}
    
    for (const field of MEASUREMENT_FIELDS) {
      const latest = latestMeasurement(S, field.key)
      if (latest?.value != null) {
        const displayValue = field.key === 'bodyFat' 
          ? latest.value 
          : toMeasurementDisplay(latest.value, S.unit)
        values[field.key] = displayValue
        
        // Calculate scale factor
        const baseline = BASELINE_MEASUREMENTS[field.key]
        if (baseline) {
          // Use raw cm value for scaling calculation
          scales[field.key] = getScaleFactor(latest.value, baseline)
        }
      }
    }
    
    return { values, scales }
  }, [S])
  
  return (
    <div className="avatar-builder">
      <div className="avatar-main">
        {/* Avatar view */}
        <div className="avatar-view">
          <svg viewBox="0 0 200 480" className="avatar-svg">
            {/* Background gradient for depth */}
            <defs>
              <radialGradient id="bodyGlow" cx="50%" cy="30%" r="70%">
                <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.1" />
                <stop offset="100%" stopColor="var(--surface)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse cx="100" cy="200" rx="80" ry="180" fill="url(#bodyGlow)" />
            
            {/* Body parts in layered order (back to front) */}
            {Object.entries(BODY_PARTS).map(([key, part]) => (
              <BodyPart
                key={key}
                partKey={key}
                part={part}
                scale={measurements.scales[part.key] || 1}
                selected={selected === part.key}
                onSelect={onSelect}
                measurements={measurements.values}
              />
            ))}
          </svg>
          
          {/* Stats overlay */}
          {selected && measurements.values[selected] && (
            <div className="avatar-stat-overlay">
              <span className="avatar-stat-value">{fmtNum(measurements.values[selected])}</span>
              <span className="avatar-stat-unit">
                {selected === 'bodyFat' ? '%' : measurementUnit(S.unit)}
              </span>
            </div>
          )}
        </div>
        
        {/* Measurement panel */}
        <MeasurementPanel
          S={S}
          selectedPart={selected}
          onLog={onLog}
          onAddPhoto={onAddPhoto}
          photos={photos}
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
