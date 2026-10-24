import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import FoodScanner from '../components/FoodScanner.jsx'
import { getCachedVitals, healthReadStatus, enableHealthRead } from '../lib/health-read.js'
import { MOBILE } from '../lib/mobile.js'

// ── Default goals ─────────────────────────────────────────────────────────────
// Based on general dietary reference values. Users set their own in Settings.

export const DEFAULT_GOALS = {
  calories:   2000,
  protein:    150,   // g — higher end, suits active people
  carbs:      200,   // g
  fat:        70,    // g
  fiber:      30,    // g  — 25–38 g/day recommended
  sugar:      50,    // g  — max; WHO recommends < 50 g free sugar
  saturatedFat: 20,  // g  — max; ~10% of 2000 kcal diet
  sodium:     2300,  // mg — max; US dietary guidelines
  water:      2500,  // ml — ~2.5 L
}

// ── Macro definitions (drives rendering everywhere) ───────────────────────────

const MACROS = [
  { key: 'protein',      label: 'Protein',       unit: 'g',  color: 'var(--blue)',   ring: true  },
  { key: 'carbs',        label: 'Carbs',          unit: 'g',  color: 'var(--orange)', ring: true  },
  { key: 'fat',          label: 'Fat',            unit: 'g',  color: 'var(--yellow)', ring: true  },
  { key: 'fiber',        label: 'Fiber',          unit: 'g',  color: 'var(--green)',  ring: true  },
  { key: 'sugar',        label: 'Sugar',          unit: 'g',  color: 'var(--pink)',   ring: true  },
  { key: 'saturatedFat', label: 'Sat. fat',       unit: 'g',  color: 'var(--red)',    ring: true  },
  { key: 'sodium',       label: 'Sodium',         unit: 'mg', color: 'var(--teal)',   ring: false },
  { key: 'water',        label: 'Water',          unit: 'ml', color: 'var(--blue)',   ring: false },
]

const ZERO_TOTALS = Object.fromEntries([['calories', 0], ...MACROS.map(m => [m.key, 0])])

// ── Health Connect activity strip ─────────────────────────────────────────────

function ActivityStrip({ vitals }) {
  if (!vitals) return null
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="muted small">Activity today</span>
        <span className="dim small">via Health Connect</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-around' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{(vitals.steps || 0).toLocaleString()}</div>
          <div className="dim small">steps</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{((vitals.distanceM || 0) / 1000).toFixed(1)}</div>
          <div className="dim small">km</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--orange)' }}>{vitals.calories || 0}</div>
          <div className="dim small">kcal burned</div>
        </div>
        {vitals.avgBpm > 0 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--red)' }}>{vitals.avgBpm}</div>
            <div className="dim small">avg bpm</div>
          </div>
        )}
      </div>
    </div>
  )
}

function HealthConnectCard({ onConnect }) {
  if (!MOBILE) return null
  return (
    <div className="card">
      <div className="row" style={{ gap: 12, marginBottom: 10 }}>
        <span className="lrow-i" style={{ background: 'var(--green)' }}><Icon name="heart" /></span>
        <div>
          <div style={{ fontWeight: 600 }}>Read from Health Connect</div>
          <div className="muted small">Import steps, calories and runs from Google Fit, Strava, Garmin &amp; more</div>
        </div>
      </div>
      <Button variant="tinted" onClick={onConnect}>Connect</Button>
    </div>
  )
}

// ── Meal log entry ────────────────────────────────────────────────────────────

function MealRow({ meal, onDelete }) {
  const n = meal.nutrition || {}
  const parts = [
    n.calories   != null ? `${n.calories} kcal`      : null,
    n.protein    != null ? `${n.protein}g protein`    : null,
    n.carbs      != null ? `${n.carbs}g carbs`        : null,
    n.fat        != null ? `${n.fat}g fat`            : null,
    n.fiber      != null ? `${n.fiber}g fiber`        : null,
    n.sugar      != null ? `${n.sugar}g sugar`        : null,
    n.saturatedFat != null ? `${n.saturatedFat}g sat` : null,
    n.sodium     != null ? `${n.sodium}mg sodium`     : null,
    n.water      != null ? `${n.water}ml water`       : null,
  ].filter(Boolean)

  return (
    <div style={{ padding: '10px 0', borderBottom: '0.5px solid var(--sep)' }}>
      <div className="row between">
        <div style={{ fontWeight: 500 }}>{meal.name}</div>
        <button className="iconbtn" onClick={() => onDelete(meal.id)} aria-label="Remove" style={{ fontSize: 16 }}>
          <Icon name="trash" />
        </button>
      </div>
      {parts.length > 0 && (
        <div className="muted small" style={{ marginTop: 2, lineHeight: 1.6 }}>
          {parts.join(' · ')}
        </div>
      )}
    </div>
  )
}

// ── Quick-add meal form ───────────────────────────────────────────────────────

function num(v) { return v !== '' ? Number(v) : null }

function QuickAddForm({ onAdd, onCancel }) {
  const [name, setName] = useState('')
  const [vals, setVals] = useState({
    calories: '', protein: '', carbs: '', fat: '',
    fiber: '', sugar: '', saturatedFat: '', sodium: '', water: '',
  })
  const set = key => e => setVals(v => ({ ...v, [key]: e.target.value }))

  const submit = () => {
    if (!name.trim()) return
    onAdd({
      id: crypto.randomUUID(),
      name: name.trim(),
      time: new Date().toISOString(),
      nutrition: {
        calories:     num(vals.calories),
        protein:      num(vals.protein),
        carbs:        num(vals.carbs),
        fat:          num(vals.fat),
        fiber:        num(vals.fiber),
        sugar:        num(vals.sugar),
        saturatedFat: num(vals.saturatedFat),
        sodium:       num(vals.sodium),
        water:        num(vals.water),
      },
    })
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ margin: 0 }}>Log meal</h3>
      <input className="input" placeholder="Food name" value={name} onChange={e => setName(e.target.value)} autoFocus />

      <div className="muted small">Primary macros</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="input" placeholder="Calories (kcal)" type="number" value={vals.calories}     onChange={set('calories')} />
        <input className="input" placeholder="Protein (g)"     type="number" value={vals.protein}      onChange={set('protein')} />
        <input className="input" placeholder="Carbs (g)"       type="number" value={vals.carbs}        onChange={set('carbs')} />
        <input className="input" placeholder="Fat (g)"         type="number" value={vals.fat}          onChange={set('fat')} />
      </div>

      <div className="muted small">Additional macros</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="input" placeholder="Fiber (g)"         type="number" value={vals.fiber}        onChange={set('fiber')} />
        <input className="input" placeholder="Sugar (g)"         type="number" value={vals.sugar}        onChange={set('sugar')} />
        <input className="input" placeholder="Saturated fat (g)" type="number" value={vals.saturatedFat} onChange={set('saturatedFat')} />
        <input className="input" placeholder="Sodium (mg)"       type="number" value={vals.sodium}       onChange={set('sodium')} />
        <input className="input" placeholder="Water (ml)"        type="number" value={vals.water}        onChange={set('water')} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" onClick={submit} style={{ flex: 1 }}>Add</Button>
        <Button onClick={onCancel} style={{ flex: 1 }}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Goals form ────────────────────────────────────────────────────────────────

function GoalInput({ label, value, onChange, unit }) {
  return (
    <div>
      <div className="dim small" style={{ marginBottom: 4 }}>{label} ({unit})</div>
      <input className="input" type="number" value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  )
}

function GoalsForm({ goals, onSave, onCancel }) {
  const [g, setG] = useState({ ...DEFAULT_GOALS, ...goals })
  const set = key => val => setG(prev => ({ ...prev, [key]: val }))

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Daily nutrition goals</h3>

      <div>
        <div className="muted small" style={{ marginBottom: 8 }}>Calories</div>
        <input className="input" type="number" placeholder="Calories (kcal)" value={g.calories}
          onChange={e => setG(prev => ({ ...prev, calories: Number(e.target.value) }))} />
      </div>

      <div className="muted small" style={{ marginBottom: -4 }}>Macronutrients</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <GoalInput label="Protein"   unit="g"  value={g.protein}   onChange={set('protein')} />
        <GoalInput label="Carbs"     unit="g"  value={g.carbs}     onChange={set('carbs')} />
        <GoalInput label="Fat"       unit="g"  value={g.fat}       onChange={set('fat')} />
        <GoalInput label="Fiber"     unit="g"  value={g.fiber}     onChange={set('fiber')} />
      </div>

      <div className="muted small" style={{ marginBottom: -4 }}>Limits (max per day)</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <GoalInput label="Sugar"         unit="g"  value={g.sugar}        onChange={set('sugar')} />
        <GoalInput label="Saturated fat" unit="g"  value={g.saturatedFat} onChange={set('saturatedFat')} />
        <GoalInput label="Sodium"        unit="mg" value={g.sodium}       onChange={set('sodium')} />
        <GoalInput label="Water"         unit="ml" value={g.water}        onChange={set('water')} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" onClick={() => onSave(g)} style={{ flex: 1 }}>Save goals</Button>
        <Button onClick={onCancel} style={{ flex: 1 }}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Macro ring ────────────────────────────────────────────────────────────────

function MacroRing({ value, goal, color, label, unit = 'g' }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0
  const r = 26, stroke = 5
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  const displayVal = unit === 'mg' ? (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value)
                   : unit === 'ml' ? (value >= 1000 ? `${(value / 1000).toFixed(1)}L` : value)
                   : value
  return (
    <div style={{ textAlign: 'center', minWidth: 60 }}>
      <svg width={64} height={64} viewBox="0 0 70 70">
        <circle cx={35} cy={35} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle cx={35} cy={35} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '35px 35px' }} />
        <text x={35} y={39} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--label)">{displayVal}</text>
      </svg>
      <div className="dim small" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 10, color: 'var(--label-3)' }}>{goal}{unit}</div>
    </div>
  )
}

// ── Linear progress bar (for sodium + water) ──────────────────────────────────

function MacroBar({ value, goal, color, label, unit, isLimit = false }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0
  const over = pct >= 100
  const barColor = isLimit && over ? 'var(--red)' : color
  const displayVal = unit === 'mg' ? `${value.toLocaleString()} mg` : `${value} ml`
  const displayGoal = unit === 'mg' ? `${goal.toLocaleString()} mg` : `${goal} ml`
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="row between" style={{ marginBottom: 5 }}>
        <span className="small" style={{ fontWeight: 500 }}>{label}</span>
        <span className="dim small">{displayVal} / {displayGoal}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.5s var(--ease)' }} />
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const todayKey = () => new Date().toISOString().slice(0, 10)

// ── Main view ─────────────────────────────────────────────────────────────────

export default function Nutrition() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const updateS = useStore(s => s.update)
  const [adding, setAdding] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [editingGoals, setEditingGoals] = useState(false)
  const [tab, setTab] = useState('today')
  const [vitals, setVitals] = useState(null)
  const [hcStatus, setHcStatus] = useState(null)

  useEffect(() => {
    getCachedVitals().then(v => {
      if (v?.date === new Date().toISOString().slice(0, 10)) setVitals(v)
    }).catch(() => {})
    healthReadStatus().then(setHcStatus).catch(() => {})
  }, [])

  const connectHealthRead = async () => {
    const result = await enableHealthRead(data => { if (data?.vitals) setVitals(data.vitals) })
    if (result.ok) setHcStatus(s => ({ ...s, on: true, granted: true }))
  }

  const goals = { ...DEFAULT_GOALS, ...(S.nutritionGoals || {}) }
  const today = todayKey()
  const meals = (S.meals || []).filter(m => m.time?.startsWith(today))

  // Sum every macro across today's meals
  const totals = meals.reduce((acc, m) => {
    const n = m.nutrition || {}
    for (const key of Object.keys(acc)) {
      if (n[key] != null) acc[key] += n[key]
    }
    return acc
  }, { ...ZERO_TOTALS })

  const addMeal  = meal => { updateS(s => { s.meals = [...(s.meals || []), meal] }); setAdding(false); setScanning(false) }
  const deleteMeal = id => { updateS(s => { s.meals = (s.meals || []).filter(m => m.id !== id) }) }
  const saveGoals = g => { updateS(s => { s.nutritionGoals = g }); setEditingGoals(false) }

  const caloriesPct   = goals.calories > 0 ? Math.min(100, (totals.calories / goals.calories) * 100) : 0
  const caloriesColor = caloriesPct >= 100 ? 'var(--red)' : caloriesPct >= 80 ? 'var(--orange)' : 'var(--green)'

  const ringMacros = MACROS.filter(m => m.ring)
  const barMacros  = MACROS.filter(m => !m.ring)

  return (
    <div className="narrow">
      <div className="hdr">
        <div>
          <h1>Nutrition</h1>
          <div className="sub">{today}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="iconbtn" onClick={() => setEditingGoals(true)} aria-label="Edit goals">
            <Icon name="target" />
          </button>
          <button className="iconbtn" onClick={() => setScanning(true)} aria-label="Scan food barcode">
            <Icon name="camera" />
          </button>
          <button className="iconbtn" onClick={() => setAdding(true)} aria-label="Log meal">
            <Icon name="plus" />
          </button>
        </div>
      </div>

      <Segmented
        options={[{ value: 'today', label: 'Today' }, { value: 'planner', label: 'Meal planner' }]}
        value={tab}
        onChange={setTab}
      />

      {editingGoals && <GoalsForm goals={goals} onSave={saveGoals} onCancel={() => setEditingGoals(false)} />}
      {scanning && <FoodScanner mode="meal" onAdd={addMeal} onCancel={() => setScanning(false)} />}
      {adding && <QuickAddForm onAdd={addMeal} onCancel={() => setAdding(false)} />}

      {tab === 'today' && !adding && !editingGoals && (
        <>
          {vitals && <ActivityStrip vitals={vitals} />}
          {MOBILE && hcStatus && !hcStatus.on && <HealthConnectCard onConnect={connectHealthRead} />}

          {/* Calorie bar */}
          <div className="card">
            <div className="row between" style={{ marginBottom: 8 }}>
              <div>
                <div className="muted small">Calories</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: caloriesColor, lineHeight: 1.1 }}>
                  {totals.calories}
                  <span className="muted" style={{ fontSize: 15, fontWeight: 400 }}> / {goals.calories} kcal</span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="dim small">remaining</div>
                <div style={{ fontWeight: 700 }}>{Math.max(0, goals.calories - totals.calories)}</div>
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${caloriesPct}%`, background: caloriesColor, borderRadius: 4, transition: 'width 0.5s var(--ease)' }} />
            </div>
          </div>

          {/* Macro rings — protein, carbs, fat, fiber, sugar, sat fat */}
          <div className="card">
            <div className="muted small" style={{ marginBottom: 12 }}>Macros</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-around', gap: 8 }}>
              {ringMacros.map(m => (
                <MacroRing
                  key={m.key}
                  value={Math.round(totals[m.key])}
                  goal={goals[m.key]}
                  color={m.color}
                  label={m.label}
                  unit={m.unit}
                />
              ))}
            </div>
          </div>

          {/* Linear bars — sodium, water */}
          <div className="card">
            <div className="muted small" style={{ marginBottom: 12 }}>Hydration & minerals</div>
            {barMacros.map(m => (
              <MacroBar
                key={m.key}
                value={Math.round(totals[m.key])}
                goal={goals[m.key]}
                color={m.color}
                label={m.label}
                unit={m.unit}
                isLimit={m.key === 'sodium'}
              />
            ))}
          </div>

          {/* Meal log */}
          <div className="card">
            <div className="row between" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Today's meals</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" icon="camera" onClick={() => setScanning(true)}>Scan</Button>
                <Button size="sm" icon="plus"   onClick={() => setAdding(true)}>Add</Button>
              </div>
            </div>
            {meals.length === 0
              ? <div className="muted small" style={{ textAlign: 'center', padding: '16px 0' }}>No meals logged yet today.</div>
              : meals.map(m => <MealRow key={m.id} meal={m} onDelete={deleteMeal} />)
            }
          </div>
        </>
      )}

      {tab === 'planner' && !adding && !editingGoals && (
        <div className="card">
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 36 }}>📅</div>
            <div className="muted small" style={{ marginTop: 8 }}>
              Meal planner lets you schedule meals from your recipe library.
            </div>
            <div style={{ marginTop: 16 }}>
              <Button variant="primary" onClick={() => nav('/ranks/recipe')}>Browse recipes</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
