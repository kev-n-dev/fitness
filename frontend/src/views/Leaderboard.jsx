import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { repRankScore, repRankTier } from '../lib/ranks/repRank.js'
import { runRankScore, runRankTier } from '../lib/ranks/runRank.js'
import { recipeRankScore, recipeRankTier } from '../lib/ranks/recipeRank.js'
import { territoryRankScore, territoryRankTier } from '../lib/ranks/territoryRank.js'
import { RANK_TIERS } from '../lib/ranks/tiers.js'

// ── Rank type config ─────────────────────────────────────────────────────────

const RANK_TYPES = [
  { key: 'overall', label: 'Overall', icon: 'chart',    color: 'var(--acc)' },
  { key: 'rep',     label: 'REP',     icon: 'dumbbell', color: 'var(--blue)' },
  { key: 'run',     label: 'RUN',     icon: 'bolt',     color: 'var(--green)' },
  { key: 'recipe',  label: 'RECIPE',  icon: 'leaf',     color: 'var(--orange)' },
  { key: 'territory',label:'TERRITORY',icon:'map',      color: 'var(--purple)' },
]

// ── Leaderboard row ──────────────────────────────────────────────────────────

function LeaderboardRow({ rank, name, score, tier, isYou, gym }) {
  const tierInfo = RANK_TIERS[tier] || RANK_TIERS.unranked
  const medalColor = rank === 1 ? 'var(--yellow)' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : 'var(--label-3)'
  return (
    <div className="row between" style={{
      padding: '12px 0',
      borderBottom: '0.5px solid var(--sep)',
      background: isYou ? 'color-mix(in srgb, var(--acc) 6%, transparent)' : undefined,
    }}>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ width: 28, textAlign: 'center', fontWeight: 700, fontSize: 15, color: medalColor }}>
          {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}
        </div>
        <div>
          <div style={{ fontWeight: isYou ? 600 : 400 }}>
            {name}{isYou ? ' (you)' : ''}
          </div>
          {gym && <div className="dim small">{gym}</div>}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 600, color: tierInfo.color }}>{score.toLocaleString()}</div>
        <div className="dim small" style={{ fontSize: 11 }}>{tierInfo.label}</div>
      </div>
    </div>
  )
}

// ── Gym leaderboard row ──────────────────────────────────────────────────────

function GymRow({ rank, name, score, memberCount }) {
  const medalColor = rank === 1 ? 'var(--yellow)' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : 'var(--label-3)'
  return (
    <div className="row between" style={{ padding: '12px 0', borderBottom: '0.5px solid var(--sep)' }}>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ width: 28, textAlign: 'center', fontWeight: 700, fontSize: 15, color: medalColor }}>
          {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}
        </div>
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          <div className="dim small">{memberCount} members</div>
        </div>
      </div>
      <div style={{ fontWeight: 600 }}>{score.toLocaleString()}</div>
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function Leaderboard() {
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const initialRank = searchParams.get('rank') || 'overall'

  const [rankType, setRankType] = useState(initialRank)
  const [boardType, setBoardType] = useState('individual') // 'individual' | 'gym'
  const [period, setPeriod] = useState('alltime') // 'weekly' | 'monthly' | 'alltime'

  // Your own scores
  const myScores = {
    rep: repRankScore(S),
    run: runRankScore(S),
    recipe: recipeRankScore(S),
    territory: territoryRankScore(S),
  }
  myScores.overall = myScores.rep + myScores.run + myScores.recipe + myScores.territory

  const myScore = myScores[rankType] || 0
  const myTier = {
    rep: repRankTier(myScores.rep),
    run: runRankTier(myScores.run),
    recipe: recipeRankTier(myScores.recipe),
    territory: territoryRankTier(myScores.territory),
    overall: repRankTier(myScores.overall),
  }[rankType]

  // Placeholder leaderboard data — in production this comes from the API
  const mockRows = user ? [
    { id: 'you', name: user.name, score: myScore, tier: myTier, isYou: true, gym: S.gym?.name || null },
  ] : []

  const activeRank = RANK_TYPES.find(r => r.key === rankType)

  return (
    <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/ranks')} aria-label="Back">
          <Icon name="chevronLeft" />
        </button>
        <div>
          <h1>Leaderboard</h1>
          <div className="sub">See how you stack up</div>
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* Individual / Gym toggle */}
      <Segmented
        options={[{ value: 'individual', label: 'Individuals' }, { value: 'gym', label: 'Gyms' }]}
        value={boardType}
        onChange={setBoardType}
      />

      {/* Rank type selector */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '12px 0', scrollbarWidth: 'none' }}>
        {RANK_TYPES.map(rt => (
          <button key={rt.key} onClick={() => setRankType(rt.key)}
            className={rankType === rt.key ? 'tag acc' : 'tag'}
            style={{ whiteSpace: 'nowrap', cursor: 'pointer', border: 'none', gap: 4, display: 'flex', alignItems: 'center' }}>
            <Icon name={rt.icon} style={{ fontSize: 12 }} />
            {rt.label}
          </button>
        ))}
      </div>

      {/* Period filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['weekly', 'monthly', 'alltime'].map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={period === p ? 'tag acc' : 'tag'}
            style={{ textTransform: 'capitalize', cursor: 'pointer', border: 'none', flex: 1 }}>
            {p === 'alltime' ? 'All time' : p.replace(/ly$/, '')}
          </button>
        ))}
      </div>

      {/* Your position card */}
      <div className="card" style={{ background: 'color-mix(in srgb, var(--acc) 10%, var(--surface))' }}>
        <div className="row between">
          <div>
            <div className="muted small">Your {activeRank?.label} score</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: activeRank?.color }}>{myScore.toLocaleString()}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted small">Rank</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>—</div>
          </div>
        </div>
      </div>

      {/* Board */}
      {boardType === 'individual' && (
        <div className="card">
          {mockRows.length > 0
            ? mockRows.map((row, i) => (
                <LeaderboardRow key={row.id} rank={i + 1} {...row} />
              ))
            : null
          }
          <div className="muted small" style={{ textAlign: 'center', padding: '24px 0' }}>
            Leaderboard data loads from the server when other users join.
            <br /><br />
            <span style={{ opacity: 0.5 }}>Your position is tracked privately until the board has more entries.</span>
          </div>
        </div>
      )}

      {boardType === 'gym' && (
        <div className="card">
          <div className="muted small" style={{ textAlign: 'center', padding: '24px 0' }}>
            Gym leaderboards appear once gyms register and members link their accounts.
            <br /><br />
            <Button size="sm" variant="tinted" onClick={() => nav('/settings')}>
              Link your gym
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
