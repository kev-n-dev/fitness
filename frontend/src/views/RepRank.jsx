import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { repRankScore, repRankTier, repRankBreakdown, repCategoryOf, REP_CATEGORIES } from '../lib/ranks/repRank.js'
import { RANK_TIERS } from '../lib/ranks/tiers.js'

function BreakdownRow({ label, score, max }) {
  const pct = Math.min(100, (score / max) * 100)
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="row between" style={{ marginBottom: 5 }}>
        <span className="small" style={{ fontWeight: 500 }}>{label}</span>
        <span className="small muted">{score.toLocaleString()} / {max.toLocaleString()}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--blue)', borderRadius: 3, transition: 'width 0.6s var(--ease)' }} />
      </div>
    </div>
  )
}

export default function RepRank() {
  const nav = useNavigate()
  const S = useStore(s => s.S)

  const score = repRankScore(S)
  const tier = repRankTier(score)
  const tierInfo = RANK_TIERS[tier]
  const breakdown = repRankBreakdown(S)
  const category = repCategoryOf(S)
  const categoryInfo = REP_CATEGORIES[category]

  return (
    <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/ranks')} aria-label="Back">
          <Icon name="chevronLeft" />
        </button>
        <div>
          <h1>REP Rank</h1>
          <div className="sub">Strength & consistency</div>
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* Rank badge */}
      <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
        <div style={{ fontSize: 56, lineHeight: 1 }}>🏋️</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: tierInfo.color, marginTop: 8 }}>
          {tierInfo.label}
        </div>
        <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-.03em', marginTop: 4 }}>
          {score.toLocaleString()}
        </div>
        <div className="muted small">points</div>
        <div className="tag" style={{ marginTop: 10, display: 'inline-flex', background: 'var(--surface-2)', color: 'var(--label-2)' }}>
          {categoryInfo.label} category
        </div>

        {/* Progress to next tier */}
        {tier !== 'elite' && (
          <div style={{ marginTop: 16 }}>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${tierInfo.progress(score)}%`, background: tierInfo.color, borderRadius: 3 }} />
            </div>
            <div className="row between" style={{ marginTop: 4 }}>
              <span className="dim small">{tierInfo.label}</span>
              <span className="dim small">{tierInfo.next}</span>
            </div>
          </div>
        )}
      </div>

      {/* Score breakdown */}
      <div className="card">
        <h3 style={{ margin: '0 0 16px' }}>Score breakdown</h3>
        {Object.values(breakdown).map(item => (
          <BreakdownRow key={item.label} {...item} />
        ))}
      </div>

      {/* How scoring works */}
      <div className="card">
        <h3 style={{ margin: '0 0 10px' }}>How REP Rank works</h3>
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>5 pts per completed workout (max 2,000)</li>
          <li>1 pt per logged set (max 5,000)</li>
          <li>50 pts per unique exercise trained (max 3,000)</li>
          <li>20 pts per consecutive week streak (max 2,000)</li>
          <li>Ranked within your category — beginners vs beginners, advanced vs advanced</li>
        </ul>
      </div>

      <Button onClick={() => nav('/leaderboard?rank=rep')} icon="chart">
        View REP Leaderboard
      </Button>
    </div>
  )
}
