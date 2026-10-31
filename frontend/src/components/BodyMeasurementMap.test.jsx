// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BodyMeasurementMap, { BodyMeasurementLegend } from './BodyMeasurementMap.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const mockState = (measurements = [], unit = 'kg') => ({
  measurements,
  unit,
  measurementEnabled: ['neck', 'waist', 'chest', 'hips'],
  customMeasurements: [],
})

describe('BodyMeasurementMap', () => {
  it('renders front and back views', () => {
    act(() => {
      root.render(<BodyMeasurementMap S={mockState()} onSelect={vi.fn()} />)
    })
    expect(container.querySelectorAll('.bmm-view')).toHaveLength(2)
    expect(container.querySelectorAll('.bmm-side')).toHaveLength(2)
    expect(container.querySelector('.bmm-label').textContent).toBe('Front')
  })

  it('displays measurement points as tappable buttons', () => {
    act(() => {
      root.render(<BodyMeasurementMap S={mockState()} onSelect={vi.fn()} />)
    })
    const points = container.querySelectorAll('.bmm-point')
    expect(points.length).toBeGreaterThan(0)
    expect(points[0].getAttribute('role')).toBe('button')
    expect(points[0].tabIndex).toBe(0)
  })

  it('shows values for measurements that have data', () => {
    const S = mockState([
      { d: '2024-01-01', t: 1704067200000, waist: 80, chest: 100, neck: null }
    ])
    act(() => {
      root.render(<BodyMeasurementMap S={S} onSelect={vi.fn()} />)
    })
    // Points with values should show the value
    const pointsWithValues = container.querySelectorAll('.bmm-point.has-value')
    expect(pointsWithValues.length).toBe(2) // waist and chest
  })

  it('calls onSelect when a point is clicked', () => {
    const onSelect = vi.fn()
    act(() => {
      root.render(<BodyMeasurementMap S={mockState()} onSelect={onSelect} />)
    })
    const point = container.querySelector('.bmm-point')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      point.dispatchEvent(event)
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('highlights the selected point', () => {
    act(() => {
      root.render(<BodyMeasurementMap S={mockState()} selected="waist" onSelect={vi.fn()} />)
    })
    const selectedPoint = container.querySelector('.bmm-point.selected')
    expect(selectedPoint).toBeTruthy()
    expect(selectedPoint.getAttribute('aria-label')).toContain('Waist')
  })

  it('activates point with Enter key', () => {
    const onSelect = vi.fn()
    act(() => {
      root.render(<BodyMeasurementMap S={mockState()} onSelect={onSelect} />)
    })
    const point = container.querySelector('.bmm-point')
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    
    act(() => {
      point.dispatchEvent(event)
    })
    
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('activates point with Space key and prevents default', () => {
    const onSelect = vi.fn()
    act(() => {
      root.render(<BodyMeasurementMap S={mockState()} onSelect={onSelect} />)
    })
    const point = container.querySelector('.bmm-point')
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    
    act(() => {
      point.dispatchEvent(event)
    })
    
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('BodyMeasurementLegend', () => {
  it('renders all legend items', () => {
    act(() => {
      root.render(<BodyMeasurementLegend />)
    })
    const items = container.querySelectorAll('.bmm-legend-item')
    expect(items).toHaveLength(4) // Has value, Not set, Increased, Decreased
  })
})
