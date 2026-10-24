import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'

// ── Macro ring ───────────────────────────────────────────────────────────────

function MacroRing({ value, goal, color, label, unit = 'g' }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0
  const r = 26, stroke = 5
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={70} height={70} viewBox="0 0 70 70">
        <circle cx={35} cy={35} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle cx={35} cy={35} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '35px 35px' }} />
        <text x={35} y={39} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--label)">{value}</text>
      </svg>
      <div className="dim small">{label}</div>
      <div style={{ fontSize: 10, color: 'var(--label-3)' }}>{goal}{unit} goal</div>
    </div>
  )
}

// ── Meal log entry ───────────────────────────────────────────────────────────

function MealRow({ meal, onDelete }) {
  return (
    <div className="row between" style={{ padding: '10px 0', borderBottom: '0.5px solid var(--sep)' }}>
      <div>
        <div style={{ fontWeight: 500 }}>{meal.name}</div>
        <div className="muted small">
          {meal.nutrition?.calories != null ? `${meal.nutrition.calories} kcal` : ''}
          {meal.nutrition?.protein != null ? ` · ${meal.nutrition.protein}g protein` : ''}
        </div>
      </div>
      <button className="iconbtn" onClick={() => onDelete(meal.id)} aria-label="Remove meal" style={{ fontSize: 16 }}>
        <Icon name="trash" />
      </button>
    </div>
  )
}

// ── Quick-add meal form ──────────────────────────────────────────────────────

function QuickAddForm({ onAdd, onCancel }) {
  const [name, setName] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')

  const submit = () => {
    if (!name.trim()) return
    onAdd({
      id: crypto.randomUUID(),
      name: name.trim(),
      time: new Date().toISOString(),
      nutrition: {
        calories: calories !== '' ? Number(calories) : null,
        protein:  protein  !== '' ? Number(protein)  : null,
        carbs:    carbs    !== '' ? Number(carbs)     : null,
        fat:      fat      !== '' ? Number(fat)       : null,
      },
    })
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ margin: 0 }}>Log meal</h3>
      <input className="input" placeholder="Food name" value={name} onChange={e => setName(e.target.value)} autoFocus />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="input" placeholder="Calories" type="number" value={calories} onChange={e => setCalories(e.target.value)} />
        <input className="input" placeholder="Protein (g)" type="number" value={protein} onChange={e => setProtein(e.target.value)} />
        <input className="input" placeholder="Carbs (g)" type="number" value={carbs} onChange={e => setCarbs(e.target.value)} />
        <input className="input" placeholder="Fat (g)" type="number" value={fat} onChange={e => setFat(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" onClick={submit} style={{ flex: 1 }}>Add</Button>
        <Button onClick={onCancel} style={{ flex: 1 }}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Goals form ───────────────────────────────────────────────────────────────

function GoalsForm({ goals, onSave, onCancel }) {
  const [calories, setCalories] = useState(goals?.calories ?? 2000)
  const [protein, setProtein] = useState(goals?.protein ?? 150)
  const [carbs, setCarbs] = useState(goals?.carbs ?? 200)
  const [fat, setFat] = useState(goals?.fat ?? 70)

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ margin: 0 }}>Daily nutrition goals</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="input" placeholder="Calories" type="number" value={calories} onChange={e => setCalories(Number(e.target.value))} />
        <input className="input" placeholder="Protein (g)" type="number" value={protein} onChange={e => setProtein(Number(e.target.value))} />
        <input className="input" placeholder="Carbs (g)" type="number" value={carbs} onChange={e => setCarbs(Number(e.target.value))} />
        <input className="input" placeholder="Fat (g)" type="number" value={fat} onChange={e => setFat(Number(e.target.value))} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" onClick={() => onSave({ calories, protein, carbs, fat })} style={{ flex: 1 }}>Save goals</Button>
        <Button onClick={onCancel} style={{ flex: 1 }}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────

const todayKey = () => new Date().toISOString().slice(0, 10)

export default function Nutrition() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const updateS = useStore(s => s.update)
  const [adding, setAdding] = useState(false)
  const [editingGoals, setEditingGoals] = useState(false)
  const [tab, setTab] = useState('today') // 'today' | 'planner'

  const goals = S.nutritionGoals || { calories: 2000, protein: 150, carbs: 200, fat: 70 }
  const today = todayKey()
  const meals = (S.meals || []).filter(m => m.time?.startsWith(today))

  // Totals for today
  const totals = meals.reduce((acc, m) => {
    if (m.nutrition?.calories) acc.calories += m.nutrition.calories
    if (m.nutrition?.protein)  acc.protein  += m.nutrition.protein
    if (m.nutrition?.carbs)    acc.carbs    += m.nutrition.carbs
    if (m.nutrition?.fat)      acc.fat      += m.nutrition.fat
    return acc
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 })

  const addMeal = meal => {
    updateS(s => { s.meals = [...(s.meals || []), meal] })
    setAdding(false)
  }

  const deleteMeal = id => {
    updateS(s => { s.meals = (s.meals || []).filter(m => m.id !== id) })
  }

  const saveGoals = newGoals => {
    updateS(s => { s.nutritionGoals = newGoals })
    setEditingGoals(false)
  }

  const caloriesPct = goals.calories > 0 ? Math.min(100, (totals.calories / goals.calories) * 100) : 0
  const caloriesColor = caloriesPct >= 100 ? 'var(--red)' : caloriesPct >= 80 ? 'var(--orange)' : 'var(--green)'

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
          <button className="iconbtn" onClick={() => setAdding(true)} aria-label="Log meal">
            <Icon name="plus" />
          </button>
        </div>
      </div>

      {/* Tab switcher */}
      <Segmented
        options={[{ value: 'today', label: 'Today' }, { value: 'planner', label: 'Meal planner' }]}
        value={tab}
        onChange={setTab}
      />

      {editingGoals && (
        <GoalsForm goals={goals} onSave={saveGoals} onCancel={() => setEditingGoals(false)} />
      )}

      {adding && <QuickAddForm onAdd={addMeal} onCancel={() => setAdding(false)} />}

      {tab === 'today' && !adding && !editingGoals && (
        <>
          {/* Calorie bar */}
          <div className="card">
            <div className="row between" style={{ marginBottom: 10 }}>
              <div>
                <div className="muted small">Calories today</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: caloriesColor }}>
                  {totals.calories}
                  <span className="muted" style={{ fontSize: 16, fontWeight: 400 }}> / {goals.calories}</span>
                </div>
              </div>
              <div className="muted small" style={{ textAlign: 'right' }}>
                {Math.max(0, goals.calories - totals.calories)} kcal remaining
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${caloriesPct}%`, background: caloriesColor, borderRadius: 4, transition: 'width 0.5s var(--ease)' }} />
            </div>
          </div>

          {/* Macro rings */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-around' }}>
              <MacroRing value={totals.protein} goal={goals.protein} color="var(--blue)"   label="Protein" />
              <MacroRing value={totals.carbs}   goal={goals.carbs}   color="var(--orange)" label="Carbs"   />
              <MacroRing value={totals.fat}      goal={goals.fat}     color="var(--yellow)" label="Fat"     />
            </div>
          </div>

          {/* Meal log */}
          <div className="card">
            <div className="row between" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Today's meals</h3>
              <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add</Button>
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
              <Button variant="primary" onClick={() => nav('/ranks/recipe')}>
                Browse recipes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
