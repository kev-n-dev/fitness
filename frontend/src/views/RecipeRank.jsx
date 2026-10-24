import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import FoodScanner from '../components/FoodScanner.jsx'
import { recipeRankScore, recipeRankTier, recipeRankBreakdown, newRecipe, RECIPE_RANK_HOW } from '../lib/ranks/recipeRank.js'
import { RANK_TIERS } from '../lib/ranks/tiers.js'

// ── Recipe card ──────────────────────────────────────────────────────────────

function RecipeCard({ recipe, onSelect }) {
  return (
    <div className="card tappable" onClick={onSelect} style={{ cursor: 'pointer' }}>
      <div className="row between">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ttl">{recipe.name}</div>
          <div className="muted small">
            {recipe.nutrition?.calories != null ? `${recipe.nutrition.calories} kcal · ` : ''}
            {recipe.nutrition?.protein != null ? `${recipe.nutrition.protein}g protein · ` : ''}
            {recipe.ingredients?.length} ingredients
          </div>
          {recipe.tags?.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              {recipe.tags.map(t => (
                <span key={t} className="tag" style={{ fontSize: 11, padding: '2px 8px' }}>{t}</span>
              ))}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', marginLeft: 12 }}>
          {recipe.published && (
            <>
              <div className="small" style={{ fontWeight: 600 }}>★ {recipe.avgRating?.toFixed(1) || '—'}</div>
              <div className="dim small">{recipe.saves || 0} saves</div>
            </>
          )}
          {!recipe.published && <span className="tag" style={{ background: 'var(--surface-3)', color: 'var(--label-3)' }}>Draft</span>}
        </div>
      </div>
    </div>
  )
}

// ── Create / edit recipe sheet ───────────────────────────────────────────────

function RecipeForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '')
  const [ingredients, setIngredients] = useState(initial?.ingredients || [])
  const [scanningIngredient, setScanningIngredient] = useState(false)
  const [nutrition, setNutrition] = useState({
    calories:     initial?.nutrition?.calories     ?? '',
    protein:      initial?.nutrition?.protein      ?? '',
    carbs:        initial?.nutrition?.carbs        ?? '',
    fat:          initial?.nutrition?.fat          ?? '',
    fiber:        initial?.nutrition?.fiber        ?? '',
    sugar:        initial?.nutrition?.sugar        ?? '',
    saturatedFat: initial?.nutrition?.saturatedFat ?? '',
    sodium:       initial?.nutrition?.sodium       ?? '',
  })
  const [tags, setTags] = useState(initial?.tags?.join(', ') || '')
  const [steps, setSteps] = useState(initial?.steps?.join('\n') || '')

  const setN = key => e => setNutrition(prev => ({ ...prev, [key]: e.target.value }))
  const num = v => v !== '' ? Number(v) : null

  // When a scanned ingredient is added, auto-fill nutrition if the fields are still empty
  const addScannedIngredient = ingredient => {
    setIngredients(prev => [...prev, ingredient])
    setNutrition(prev => {
      const n = ingredient.per100g || {}
      const ratio = (ingredient.amount || 100) / 100
      const fill = (prevVal, raw) => (prevVal !== '' || raw == null) ? prevVal : String(Math.round(raw * ratio * 10) / 10)
      return {
        calories:     fill(prev.calories,     n.calories),
        protein:      fill(prev.protein,      n.protein),
        carbs:        fill(prev.carbs,        n.carbs),
        fat:          fill(prev.fat,          n.fat),
        fiber:        fill(prev.fiber,        n.fiber),
        sugar:        fill(prev.sugar,        n.sugar),
        saturatedFat: fill(prev.saturatedFat, n.saturatedFat),
        sodium:       fill(prev.sodium,       n.sodium),
      }
    })
    setScanningIngredient(false)
  }

  const save = (publish = false) => {
    if (!name.trim()) return
    onSave({
      ...(initial || newRecipe({ name })),
      name: name.trim(),
      ingredients,
      steps: steps.split('\n').map(s => s.trim()).filter(Boolean),
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      nutrition: {
        calories:     num(nutrition.calories),
        protein:      num(nutrition.protein),
        carbs:        num(nutrition.carbs),
        fat:          num(nutrition.fat),
        fiber:        num(nutrition.fiber),
        sugar:        num(nutrition.sugar),
        saturatedFat: num(nutrition.saturatedFat),
        sodium:       num(nutrition.sodium),
        servings: 1,
      },
      published: publish || (initial?.published ?? false),
      updatedAt: Date.now(),
    })
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0 }}>{initial ? 'Edit recipe' : 'New recipe'}</h3>
      <input className="input" placeholder="Recipe name" value={name} onChange={e => setName(e.target.value)} />

      {/* Ingredients */}
      <div>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="muted small">Ingredients</span>
          <Button size="sm" icon="camera" onClick={() => setScanningIngredient(true)}>Scan</Button>
        </div>
        {scanningIngredient && (
          <FoodScanner mode="ingredient" onAdd={addScannedIngredient} onCancel={() => setScanningIngredient(false)} />
        )}
        {ingredients.map(ing => (
          <div key={ing.id} className="row between" style={{ padding: '6px 0', borderBottom: '0.5px solid var(--sep)' }}>
            <div>
              <span className="small" style={{ fontWeight: 500 }}>{ing.name}</span>
              <span className="dim small" style={{ marginLeft: 8 }}>{ing.amount}{ing.unit}</span>
            </div>
            <button className="iconbtn" onClick={() => setIngredients(p => p.filter(i => i.id !== ing.id))}
              aria-label="Remove" style={{ fontSize: 14 }}>
              <Icon name="xmark" />
            </button>
          </div>
        ))}
      </div>

      {/* Nutrition per serving */}
      <div className="muted small">Nutrition per serving</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="input" placeholder="Calories (kcal)"    type="number" value={nutrition.calories}     onChange={setN('calories')} />
        <input className="input" placeholder="Protein (g)"        type="number" value={nutrition.protein}      onChange={setN('protein')} />
        <input className="input" placeholder="Carbs (g)"          type="number" value={nutrition.carbs}        onChange={setN('carbs')} />
        <input className="input" placeholder="Fat (g)"            type="number" value={nutrition.fat}          onChange={setN('fat')} />
        <input className="input" placeholder="Fiber (g)"          type="number" value={nutrition.fiber}        onChange={setN('fiber')} />
        <input className="input" placeholder="Sugar (g)"          type="number" value={nutrition.sugar}        onChange={setN('sugar')} />
        <input className="input" placeholder="Saturated fat (g)"  type="number" value={nutrition.saturatedFat} onChange={setN('saturatedFat')} />
        <input className="input" placeholder="Sodium (mg)"        type="number" value={nutrition.sodium}       onChange={setN('sodium')} />
      </div>

      <textarea className="input" placeholder="Steps (one per line)" rows={4} value={steps}
        onChange={e => setSteps(e.target.value)} style={{ resize: 'vertical' }} />
      <input className="input" placeholder="Tags (comma separated, e.g. high-protein, vegan)"
        value={tags} onChange={e => setTags(e.target.value)} />

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" onClick={() => save(false)} style={{ flex: 1 }}>Save draft</Button>
        <Button onClick={() => save(true)} style={{ flex: 1 }}>Publish</Button>
      </div>
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function RecipeRank() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const updateS = useStore(s => s.update)
  const [tab, setTab] = useState('recipes')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)

  const score = recipeRankScore(S)
  const tier = recipeRankTier(score)
  const tierInfo = RANK_TIERS[tier]
  const breakdown = recipeRankBreakdown(S)
  const recipes = S.recipes || []

  const saveRecipe = recipe => {
    updateS(s => {
      const idx = (s.recipes || []).findIndex(r => r.id === recipe.id)
      if (idx >= 0) s.recipes[idx] = recipe
      else s.recipes = [...(s.recipes || []), recipe]
    })
    setCreating(false)
    setEditing(null)
  }

  const deleteRecipe = id => {
    updateS(s => { s.recipes = (s.recipes || []).filter(r => r.id !== id) })
    setEditing(null)
  }

  return (
    <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/ranks')} aria-label="Back">
          <Icon name="chevronLeft" />
        </button>
        <div>
          <h1>RECIPE Rank</h1>
          <div className="sub" style={{ color: tierInfo.color }}>{tierInfo.label} · {score.toLocaleString()} pts</div>
        </div>
        <button className="iconbtn" onClick={() => setCreating(true)} aria-label="New recipe">
          <Icon name="plus" />
        </button>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['recipes', 'rank'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={tab === t ? 'tag acc' : 'tag'}
            style={{ textTransform: 'capitalize', cursor: 'pointer', border: 'none', flex: 1 }}>
            {t}
          </button>
        ))}
      </div>

      {creating && (
        <RecipeForm onSave={saveRecipe} onCancel={() => setCreating(false)} />
      )}

      {editing && (
        <RecipeForm initial={editing} onSave={saveRecipe} onCancel={() => setEditing(null)} />
      )}

      {tab === 'recipes' && !creating && !editing && (
        <>
          {!recipes.length
            ? <div className="card" style={{ textAlign: 'center', padding: 24 }}>
                <div style={{ fontSize: 36 }}>🥗</div>
                <div className="muted small" style={{ marginTop: 8 }}>No recipes yet. Create your first to earn RECIPE Rank points.</div>
                <div style={{ marginTop: 12 }}><Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Create recipe</Button></div>
              </div>
            : recipes.map(r => <RecipeCard key={r.id} recipe={r} onSelect={() => setEditing(r)} />)
          }
        </>
      )}

      {tab === 'rank' && !creating && !editing && (
        <>
          <div className="card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <div style={{ fontSize: 48 }}>🍴</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: tierInfo.color, marginTop: 8 }}>{tierInfo.label}</div>
            <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-.03em', marginTop: 4 }}>{score.toLocaleString()}</div>
            <div className="muted small">points</div>
          </div>
          <div className="card">
            <h3 style={{ margin: '0 0 16px' }}>Score breakdown</h3>
            {Object.values(breakdown).map(item => (
              <div key={item.label} style={{ marginBottom: 14 }}>
                <div className="row between" style={{ marginBottom: 4 }}>
                  <span className="small" style={{ fontWeight: 500 }}>{item.label}</span>
                  <div>
                    <span className="small" style={{ fontWeight: 700 }}>{item.score.toLocaleString()}</span>
                    {item.max != null && <span className="dim small"> / {item.max.toLocaleString()}</span>}
                    <span className="dim small"> pts</span>
                  </div>
                </div>
                {item.max != null && (
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (item.score / item.max) * 100)}%`, background: 'var(--orange)', borderRadius: 3 }} />
                  </div>
                )}
                {item.detail && <div className="dim small">{item.detail}</div>}
              </div>
            ))}
          </div>
          <div className="card">
            <h3 style={{ margin: '0 0 10px' }}>How RECIPE Rank works</h3>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
              {RECIPE_RANK_HOW.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
