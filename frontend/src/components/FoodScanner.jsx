// FoodScanner — scan a food barcode and confirm the product before adding it
// to a meal log or recipe ingredient list.
//
// Usage:
//   <FoodScanner mode="meal" | "ingredient" onAdd={item => ...} onCancel={() => ...} />
//
// Flow:
//   1. Scan (camera on app) or type a barcode (browser fallback)
//   2. Look up Open Food Facts → show product card
//   3. User sets serving size (defaults to labelled serving or 100g)
//   4. onAdd({ meal | ingredient object }) is called
//
// The scanner reuses lib/scan.js which already handles ML Kit permissions,
// module installation, and web fallback. Food lookup is in lib/food-lookup.js.

import { useState, useRef } from 'react'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { scanCode } from '../lib/scan.js'
import { lookupBarcode, nutritionForGrams, productToMeal, productToIngredient } from '../lib/food-lookup.js'
import { MOBILE } from '../lib/mobile.js'

// ── Macro pill ────────────────────────────────────────────────────────────────

function MacroPill({ label, value, unit, color }) {
  if (value == null) return null
  return (
    <div style={{ textAlign: 'center', padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)', flex: 1 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}{unit}</div>
      <div style={{ fontSize: 10, color: 'var(--label-3)', marginTop: 1 }}>{label}</div>
    </div>
  )
}

// ── Product card ──────────────────────────────────────────────────────────────

function ProductCard({ product, grams, onGramsChange }) {
  const n = nutritionForGrams(product, grams)
  return (
    <div>
      {/* Product header */}
      <div className="row" style={{ gap: 12, marginBottom: 14 }}>
        {product.image && (
          <img
            src={product.image}
            alt={product.name}
            style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 8, background: 'var(--surface-2)' }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{product.name}</div>
          {product.brand && <div className="muted small">{product.brand}</div>}
          <div className="dim small">Barcode: {product.barcode}</div>
        </div>
      </div>

      {/* Serving size */}
      <div style={{ marginBottom: 14 }}>
        <div className="muted small" style={{ marginBottom: 6 }}>Serving size (grams)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            type="number"
            min="1"
            value={grams}
            onChange={e => onGramsChange(Math.max(1, Number(e.target.value) || 100))}
            style={{ width: 90 }}
          />
          <span className="muted small">g</span>
          {product.servingGrams && (
            <button
              className="tag"
              onClick={() => onGramsChange(product.servingGrams)}
              style={{ cursor: 'pointer', border: 'none' }}
            >
              1 serving ({product.servingGrams}g)
            </button>
          )}
          <button className="tag" onClick={() => onGramsChange(100)} style={{ cursor: 'pointer', border: 'none' }}>
            100g
          </button>
        </div>
      </div>

      {/* Primary macros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <MacroPill label="kcal"    value={n.calories}     unit=""   color="var(--label)"   />
        <MacroPill label="protein" value={n.protein}      unit="g"  color="var(--blue)"    />
        <MacroPill label="carbs"   value={n.carbs}        unit="g"  color="var(--orange)"  />
        <MacroPill label="fat"     value={n.fat}          unit="g"  color="var(--yellow)"  />
      </div>

      {/* Secondary macros */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <MacroPill label="fiber"   value={n.fiber}        unit="g"  color="var(--green)"   />
        <MacroPill label="sugar"   value={n.sugar}        unit="g"  color="var(--pink)"    />
        <MacroPill label="sat.fat" value={n.saturatedFat} unit="g"  color="var(--red)"     />
        <MacroPill label="sodium"  value={n.sodium}       unit="mg" color="var(--teal)"    />
      </div>

      <div className="dim small" style={{ marginTop: 8 }}>
        Nutrition data sourced from Open Food Facts (openfoodfacts.org)
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FoodScanner({ mode = 'meal', onAdd, onCancel }) {
  const [step, setStep]       = useState('idle')    // idle | scanning | loading | confirm | error
  const [barcode, setBarcode] = useState('')
  const [product, setProduct] = useState(null)
  const [grams, setGrams]     = useState(100)
  const [error, setError]     = useState(null)
  const inputRef = useRef(null)

  const doLookup = async code => {
    setStep('loading')
    setError(null)
    try {
      const prod = await lookupBarcode(code)
      setProduct(prod)
      setGrams(prod.servingGrams || 100)
      setStep('confirm')
    } catch (e) {
      setError(
        e.code === 'not-found' ? 'Product not found in the database. Try entering the barcode manually.'
        : e.code === 'network' ? 'Network error. Check your connection and try again.'
        : 'Could not load product data.'
      )
      setStep('error')
    }
  }

  const handleScan = async () => {
    setStep('scanning')
    try {
      const result = await scanCode()
      if (!result) { setStep('idle'); return }
      setBarcode(result.value)
      await doLookup(result.value)
    } catch (e) {
      // Camera not available (browser) — fall through to manual entry
      setStep('manual')
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  const handleManual = async e => {
    e.preventDefault()
    if (!barcode.trim()) return
    await doLookup(barcode.trim())
  }

  const handleAdd = () => {
    if (!product) return
    if (mode === 'meal') {
      onAdd(productToMeal(product, grams))
    } else {
      onAdd(productToIngredient(product, grams))
    }
  }

  const reset = () => { setStep('idle'); setProduct(null); setBarcode(''); setError(null) }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row between">
        <h3 style={{ margin: 0 }}>
          {mode === 'meal' ? 'Scan food to log' : 'Scan ingredient'}
        </h3>
        <button className="iconbtn" onClick={onCancel} aria-label="Close">
          <Icon name="xmark" />
        </button>
      </div>

      {/* ── Idle — show scan button ── */}
      {step === 'idle' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MOBILE && (
            <Button variant="primary" icon="camera" onClick={handleScan}>
              Scan barcode
            </Button>
          )}
          <Button
            icon="barcode"
            variant={MOBILE ? 'default' : 'primary'}
            onClick={() => { setStep('manual'); setTimeout(() => inputRef.current?.focus(), 100) }}
          >
            Enter barcode manually
          </Button>
        </div>
      )}

      {/* ── Manual entry ── */}
      {(step === 'manual' || step === 'error') && (
        <form onSubmit={handleManual} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!MOBILE && (
            <div className="muted small">
              Type or paste the barcode number from the product packaging (EAN-13, EAN-8, UPC-A).
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              className="input"
              placeholder="e.g. 5000169080255"
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              type="tel"     /* numeric keyboard on mobile */
              style={{ flex: 1 }}
            />
            <Button variant="primary" onClick={handleManual} disabled={!barcode.trim()}>
              Look up
            </Button>
          </div>
          {error && <div className="small" style={{ color: 'var(--red)' }}>{error}</div>}
          {MOBILE && (
            <Button variant="ghost" icon="camera" onClick={handleScan}>Try camera again</Button>
          )}
        </form>
      )}

      {/* ── Scanning / loading spinner ── */}
      {(step === 'scanning' || step === 'loading') && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--label-3)' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>
            {step === 'scanning' ? '📷' : '🔍'}
          </div>
          <div className="muted small">
            {step === 'scanning' ? 'Opening scanner…' : 'Looking up product…'}
          </div>
        </div>
      )}

      {/* ── Confirm ── */}
      {step === 'confirm' && product && (
        <>
          <ProductCard product={product} grams={grams} onGramsChange={setGrams} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" onClick={handleAdd} style={{ flex: 1 }}>
              {mode === 'meal' ? 'Add to meal log' : 'Add to recipe'}
            </Button>
            <Button onClick={reset} style={{ flex: 1 }}>
              Scan another
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
