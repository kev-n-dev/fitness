import { t } from '../lib/i18n.js'
import { MEASUREMENT_FIELDS, measurementUnit, toMeasurementDisplay, latestMeasurement } from '../lib/measurements.js'
import { fmtNum } from '../lib/format.js'

// Interactive body silhouette for measurements. Each measurement point is a tappable
// region that shows the current value and change indicator. Tapping opens the input.
//
// This is distinct from BodyMap.jsx which visualizes training load on muscles.

// Map measurement keys to body regions with coordinates for front/back views
// Coordinates are in viewBox units (0-200 width, 0-400 height)
const MEASUREMENT_POINTS = {
  // Front view measurements
  front: [
    { key: 'neck', x: 100, y: 52, label: 'Neck' },
    { key: 'shoulders', x: 100, y: 72, label: 'Shoulders' },
    { key: 'chest', x: 100, y: 100, label: 'Chest' },
    { key: 'waist', x: 100, y: 145, label: 'Waist' },
    { key: 'abdomen', x: 100, y: 162, label: 'Abdomen' },
    { key: 'hips', x: 100, y: 182, label: 'Hips' },
    { key: 'upperArmLeft', x: 48, y: 115, label: 'L Arm' },
    { key: 'upperArmRight', x: 152, y: 115, label: 'R Arm' },
    { key: 'forearmLeft', x: 38, y: 155, label: 'L Forearm' },
    { key: 'forearmRight', x: 162, y: 155, label: 'R Forearm' },
    { key: 'wristLeft', x: 28, y: 185, label: 'L Wrist' },
    { key: 'wristRight', x: 172, y: 185, label: 'R Wrist' },
    { key: 'thighLeft', x: 72, y: 245, label: 'L Thigh' },
    { key: 'thighRight', x: 128, y: 245, label: 'R Thigh' },
    { key: 'calfLeft', x: 68, y: 325, label: 'L Calf' },
    { key: 'calfRight', x: 132, y: 325, label: 'R Calf' },
    { key: 'ankleLeft', x: 65, y: 375, label: 'L Ankle' },
    { key: 'ankleRight', x: 135, y: 375, label: 'R Ankle' },
  ],
  // Back view shows body fat percentage in center
  back: [
    { key: 'bodyFat', x: 100, y: 130, label: 'Body Fat', isPercent: true },
  ],
}

// Simple body silhouette paths
const BODY_SILHOUETTE = {
  front: `
    M100,20 
    C120,20 130,35 130,50
    C130,60 125,65 120,68
    L140,75 C160,80 175,95 178,130
    L180,170 C180,175 175,180 168,182
    L155,185 L140,182 L135,175
    L130,145 L125,130
    C125,140 130,155 130,175
    L135,190 L135,195 C135,200 130,205 125,210
    L122,280 C120,310 118,340 115,370
    C112,385 108,395 100,398
    C92,395 88,385 85,370
    L78,280 C75,205 70,200 65,195
    L65,190 L70,175
    C70,155 75,140 75,130
    L70,145 L65,175
    L60,182 L45,185 L32,182
    C25,180 20,175 20,170
    L22,130 C25,95 40,80 60,75
    L80,68 C75,65 70,60 70,50
    C70,35 80,20 100,20 Z
  `,
  back: `
    M100,20 
    C120,20 130,35 130,50
    C130,60 125,65 120,68
    L140,75 C160,80 175,95 178,130
    L180,170 C180,175 175,180 168,182
    L155,185 L140,182 L135,175
    L130,145 L125,130
    C125,140 130,155 130,175
    L135,190 L135,195 C135,200 130,205 125,210
    L122,280 C120,310 118,340 115,370
    C112,385 108,395 100,398
    C92,395 88,385 85,370
    L78,280 C75,205 70,200 65,195
    L65,190 L70,175
    C70,155 75,140 75,130
    L70,145 L65,175
    L60,182 L45,185 L32,182
    C25,180 20,175 20,170
    L22,130 C25,95 40,80 60,75
    L80,68 C75,65 70,60 70,50
    C70,35 80,20 100,20 Z
  `,
}

// Measurement guide lines showing where to measure
const GUIDE_LINES = {
  front: [
    { key: 'neck', y: 52, width: 30 },
    { key: 'shoulders', y: 72, width: 90 },
    { key: 'chest', y: 100, width: 70 },
    { key: 'waist', y: 145, width: 50 },
    { key: 'abdomen', y: 162, width: 45 },
    { key: 'hips', y: 182, width: 55 },
  ],
}

function getChangeIndicator(current, previous) {
  if (current == null || previous == null) return null
  const delta = current - previous
  if (Math.abs(delta) < 0.1) return null
  return { delta, direction: delta > 0 ? 'up' : 'down' }
}

function MeasurementPoint({ point, value, previousValue, unit, isPercent, selected, onSelect }) {
  const change = getChangeIndicator(value, previousValue)
  const hasValue = value != null
  
  // Determine color based on measurement type and change direction
  // For waist/abdomen: decrease is good (green), increase is caution (red)
  // For arms/chest/etc: increase is good (green), decrease is caution (red)
  const isReductionGood = ['waist', 'abdomen', 'hips', 'bodyFat'].includes(point.key)
  const changeColor = change
    ? (isReductionGood
        ? (change.direction === 'down' ? 'var(--green)' : 'var(--orange)')
        : (change.direction === 'up' ? 'var(--green)' : 'var(--orange)'))
    : null

  return (
    <g
      className={`bmm-point${selected ? ' selected' : ''}${hasValue ? ' has-value' : ''}`}
      onClick={() => onSelect(point.key)}
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      aria-label={`${t(point.label)}: ${hasValue ? `${fmtNum(value)} ${isPercent ? '%' : unit}` : t('Not set')}`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(point.key) } }}
    >
      {/* Tap target circle */}
      <circle
        cx={point.x}
        cy={point.y}
        r={selected ? 14 : 12}
        className="bmm-target"
        fill={hasValue ? 'var(--acc)' : 'var(--surface-2)'}
        stroke={selected ? 'var(--label)' : hasValue ? 'var(--acc)' : 'var(--sep)'}
        strokeWidth={selected ? 3 : 2}
      />
      
      {/* Value or plus icon */}
      {hasValue ? (
        <text
          x={point.x}
          y={point.y + 4}
          textAnchor="middle"
          className="bmm-value"
          fill="var(--surface)"
          fontSize="9"
          fontWeight="600"
        >
          {fmtNum(value)}
        </text>
      ) : (
        <text
          x={point.x}
          y={point.y + 5}
          textAnchor="middle"
          fill="var(--label-2)"
          fontSize="14"
          fontWeight="300"
        >
          +
        </text>
      )}
      
      {/* Change indicator */}
      {change && (
        <g transform={`translate(${point.x + 10}, ${point.y - 10})`}>
          <circle r="6" fill={changeColor} />
          <text
            y="3"
            textAnchor="middle"
            fill="var(--surface)"
            fontSize="8"
            fontWeight="bold"
          >
            {change.direction === 'up' ? '↑' : '↓'}
          </text>
        </g>
      )}
    </g>
  )
}

function BodyView({ view, points, measurements, previousMeasurements, unit, selected, onSelect }) {
  return (
    <svg viewBox="0 0 200 420" className="bmm-view">
      {/* Body silhouette */}
      <path
        d={BODY_SILHOUETTE[view]}
        className="bmm-silhouette"
        fill="var(--surface-2)"
        stroke="var(--sep)"
        strokeWidth="2"
      />
      
      {/* Guide lines for torso measurements */}
      {GUIDE_LINES[view]?.map(line => (
        <line
          key={line.key}
          x1={100 - line.width / 2}
          y1={line.y}
          x2={100 + line.width / 2}
          y2={line.y}
          className="bmm-guide"
          stroke="var(--sep)"
          strokeWidth="1"
          strokeDasharray="4,4"
          opacity="0.5"
        />
      ))}
      
      {/* Measurement points */}
      {points.map(point => {
        const field = MEASUREMENT_FIELDS.find(f => f.key === point.key)
        const isEnabled = field && measurements.enabled?.includes(point.key)
        // Show all points, but dim disabled ones
        const value = measurements.values?.[point.key]
        const previousValue = previousMeasurements?.values?.[point.key]
        
        return (
          <MeasurementPoint
            key={point.key}
            point={point}
            value={value}
            previousValue={previousValue}
            unit={unit}
            isPercent={point.isPercent}
            selected={selected === point.key}
            onSelect={onSelect}
          />
        )
      })}
    </svg>
  )
}

/**
 * Interactive body measurement map.
 * 
 * @param {Object} props
 * @param {Object} props.S - Store state containing measurements array and unit
 * @param {string} [props.selected] - Currently selected measurement key
 * @param {Function} props.onSelect - Called when a measurement point is tapped
 * @param {string} [props.className] - Additional CSS classes
 */
export default function BodyMeasurementMap({ S, selected, onSelect, className = '' }) {
  const unit = measurementUnit(S.unit)
  
  // Get the latest and previous measurements for each field
  const measurements = {
    enabled: S.measurementEnabled || [],
    values: {},
  }
  const previousMeasurements = {
    values: {},
  }
  
  // Build current and previous values from measurement history
  for (const field of MEASUREMENT_FIELDS) {
    const latest = latestMeasurement(S, field.key)
    if (latest?.value != null) {
      measurements.values[field.key] = field.key === 'bodyFat' 
        ? latest.value 
        : toMeasurementDisplay(latest.value, S.unit)
      
      // Find previous measurement (second to last)
      const entries = S.measurements || []
      for (let i = entries.length - 2; i >= 0; i--) {
        const prevValue = entries[i][field.key]
        if (prevValue != null) {
          previousMeasurements.values[field.key] = field.key === 'bodyFat'
            ? prevValue
            : toMeasurementDisplay(prevValue, S.unit)
          break
        }
      }
    }
  }

  return (
    <div className={`body-measurement-map ${className}`}>
      <div className="bmm-container">
        <div className="bmm-side">
          <div className="bmm-label">{t('Front')}</div>
          <BodyView
            view="front"
            points={MEASUREMENT_POINTS.front}
            measurements={measurements}
            previousMeasurements={previousMeasurements}
            unit={unit}
            selected={selected}
            onSelect={onSelect}
          />
        </div>
        <div className="bmm-side">
          <div className="bmm-label">{t('Back')}</div>
          <BodyView
            view="back"
            points={MEASUREMENT_POINTS.back}
            measurements={measurements}
            previousMeasurements={previousMeasurements}
            unit={unit}
            selected={selected}
            onSelect={onSelect}
          />
        </div>
      </div>
      <BodyMeasurementLegend />
    </div>
  )
}

export function BodyMeasurementLegend() {
  return (
    <div className="bmm-legend">
      <span className="bmm-legend-item">
        <span className="bmm-dot has-value" />
        {t('Has value')}
      </span>
      <span className="bmm-legend-item">
        <span className="bmm-dot" />
        {t('Not set')}
      </span>
      <span className="bmm-legend-item">
        <span className="bmm-dot change-up" />
        {t('Increased')}
      </span>
      <span className="bmm-legend-item">
        <span className="bmm-dot change-down" />
        {t('Decreased')}
      </span>
    </div>
  )
}
