import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { repRankScore, repRankTier, repCategoryOf } from '../lib/ranks/repRank.js'
import { runRankScore, runRankTier } from '../lib/ranks/runRank.js'
import { recipeRankScore, recipeRankTier } from '../lib/ranks/recipeRank.js'
import { territoryRankScore, territoryRankTier } from '../lib/ranks/territoryRank.js'
import { RANK_TIERS, tierForScore } from '../lib/ranks/tiers.js'
import { AccoladeBadge } from './Challenges.jsx'

// ── Mini rank badge ──────────────────────────────────────────────────────────

function MiniRankBadge({ label, icon, color, score, tier }) {
  const tierInfo = RANK_TIERS[tier] || RANK_TIERS.unranked
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: `color-mix(in srgb, ${color} 15%, var(--surface-2))`,
        border: `2px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto',
        fontSize: 18,
      }}>
        <Icon name={icon} style={{ color }} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: tierInfo.color }}>{tierInfo.label}</div>
      <div style={{ fontSize: 10, color: 'var(--label-3)' }}>{label}</div>
    </div>
  )
}

// ── Stat cell ────────────────────────────────────────────────────────────────

function StatCell({ value, label }) {
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div className="dim small">{label}</div>
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function UserProfile() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())

  const repScore     = repRankScore(S)
  const runScore     = runRankScore(S)
  const recipeScore  = recipeRankScore(S)
  const territoryScore = territoryRankScore(S)
  const totalScore   = repScore + runScore + recipeScore + territoryScore
  const overallTier  = tierForScore(totalScore)
  const overallTierInfo = RANK_TIERS[overallTier]

  const workoutCount = (S.workouts || []).length
  const runCount     = (S.runs || []).length
  const recipeCount  = (S.recipes || []).length

  // Accolades — from challenges that have been completed
  const accolades = S.accolades || []

  const displayName = isGuest ? 'Guest' : (user?.name || 'Athlete')

  return (
    <div className="narrow">
      <div className="hdr">
        <div style={{ width: 36 }} />
        <h1>Profile</h1>
        <button className="iconbtn" onClick={() => nav('/settings')} aria-label="Settings">
          <Icon name="gear" />
        </button>
      </div>

      {/* Profile card */}
      <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
        {/* Avatar */}
        <div style={{
          width: 76, height: 76, borderRadius: '50%',
          background: `color-mix(in srgb, ${overallTierInfo.color} 20%, var(--surface-2))`,
          border: `3px solid ${overallTierInfo.color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32, margin: '0 auto 12px',
        }}>
          {displayName[0]?.toUpperCase() || '?'}
        </div>

        <div style={{ fontSize: 22, fontWeight: 700 }}>{displayName}</div>

        {S.gym?.name && (
          <div className="muted small" style={{ marginTop: 4 }}>
            <Icon name="dumbbell" style={{ fontSize: 12, marginRight: 4 }} />
            {S.gym.name}
          </div>
        )}

        {/* Overall rank */}
        <div style={{ marginTop: 12 }}>
          <span className="tag" style={{
            background: `color-mix(in srgb, ${overallTierInfo.color} 15%, var(--surface-2))`,
            color: overallTierInfo.color,
            fontSize: 14,
            fontWeight: 700,
            padding: '4px 14px',
          }}>
            {overallTierInfo.label} · {totalScore.toLocaleString()} pts
          </span>
        </div>
      </div>

      {/* Sub-rank badges */}
      <div className="card">
        <div style={{ display: 'flex', gap: 8 }}>
          <MiniRankBadge label="REP"       icon="dumbbell" color="var(--blue)"   score={repScore}       tier={repRankTier(repScore)} />
          <MiniRankBadge label="RUN"       icon="bolt"     color="var(--green)"  score={runScore}       tier={runRankTier(runScore)} />
          <MiniRankBadge label="RECIPE"    icon="leaf"     color="var(--orange)" score={recipeScore}    tier={recipeRankTier(recipeScore)} />
          <MiniRankBadge label="TERRITORY" icon="map"      color="var(--purple)" score={territoryScore} tier={territoryRankTier(territoryScore)} />
        </div>
      </div>

      {/* Stats */}
      <div className="card">
        <div style={{ display: 'flex', gap: 8 }}>
          <StatCell value={workoutCount} label="workouts" />
          <StatCell value={runCount}     label="runs"     />
          <StatCell value={recipeCount}  label="recipes"  />
          <StatCell value={(S.territory?.capturedCells || []).length} label="cells" />
        </div>
      </div>

      {/* Accolades */}
      <div className="card">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Accolades</h3>
          <Button size="sm" variant="ghost" onClick={() => nav('/challenges')}>View all</Button>
        </div>
        {accolades.length > 0
          ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {accolades.slice(0, 12).map(a => (
                <AccoladeBadge key={a.id} accolade={a} size="sm" />
              ))}
            </div>
          : <div className="muted small">Complete challenges to earn accolades.</div>
        }
      </div>

      {/* Actions */}
      <Button icon="chart" onClick={() => nav('/ranks')}>View my ranks</Button>
      <div style={{ height: 8 }} />
      <Button icon="gear" onClick={() => nav('/settings')}>Settings</Button>
    </div>
  )
}
