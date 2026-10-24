import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { repRankScore, repRankTier } from '../lib/ranks/repRank.js'
import { runRankScore, runRankTier } from '../lib/ranks/runRank.js'
import { recipeRankScore, recipeRankTier } from '../lib/ranks/recipeRank.js'
import { territoryRankScore, territoryRankTier } from '../lib/ranks/territoryRank.js'
import { RANK_TIERS } from '../lib/ranks/tiers.js'

function RankCard({ label, icon, color, score, tier, route }) {
  const nav = useNavigate()
  const tierInfo = RANK_TIERS[tier] || RANK_TIERS.unranked
  return (
    <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav(route)}>
      <div className="row between">
        <div className="row" style={{ gap: 12 }}>
          <span className="lrow-i" style={{ background: color, fontSize: 20 }}>
            <Icon name={icon} />
          </span>
          <div>
            <div className="lbl2">{label}</div>
            <div className="ttl" style={{ color: tierInfo.color }}>{tierInfo.label}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="big" style={{ fontSize: 22, fontWeight: 700, color: tierInfo.color }}>{score.toLocaleString()}</div>
          <div className="dim small">pts</div>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ height: 4, borderRadius: 2, background: 'var(--surface-2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, tierInfo.progress(score))}%`, background: tierInfo.color, borderRadius: 2, transition: 'width 0.6s var(--ease)' }} />
        </div>
        <div className="row between" style={{ marginTop: 4 }}>
          <span className="dim small">{tierInfo.label}</span>
          <span className="dim small">{tierInfo.next}</span>
        </div>
      </div>
    </div>
  )
}

export default function Ranks() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)

  const repScore = repRankScore(S)
  const runScore = runRankScore(S)
  const recipeScore = recipeRankScore(S)
  const territoryScore = territoryRankScore(S)

  const totalScore = repScore + runScore + recipeScore + territoryScore

  return (
    <div className="narrow">
      <div className="hdr">
        <div>
          <h1>Compete</h1>
          <div className="sub">Your ranks across all disciplines</div>
        </div>
        <button className="iconbtn" onClick={() => nav('/leaderboard')} aria-label="Leaderboard">
          <Icon name="chart" />
        </button>
      </div>

      {/* Overall score banner */}
      <div className="card" style={{ background: 'var(--surface)', borderRadius: 'var(--r-lg)' }}>
        <div className="row between" style={{ alignItems: 'center' }}>
          <div>
            <div className="muted small">Overall score</div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1 }}>
              {totalScore.toLocaleString()}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted small">Global rank</div>
            <div className="big" style={{ fontWeight: 700 }}>—</div>
          </div>
        </div>
      </div>

      {/* Four rank cards */}
      <RankCard
        label="REP Rank"
        icon="dumbbell"
        color="var(--blue)"
        score={repScore}
        tier={repRankTier(repScore)}
        route="/ranks/rep"
      />
      <RankCard
        label="RUN Rank"
        icon="bolt"
        color="var(--green)"
        score={runScore}
        tier={runRankTier(runScore)}
        route="/ranks/run"
      />
      <RankCard
        label="RECIPE Rank"
        icon="leaf"
        color="var(--orange)"
        score={recipeScore}
        tier={recipeRankTier(recipeScore)}
        route="/ranks/recipe"
      />
      <RankCard
        label="TERRITORY Rank"
        icon="map"
        color="var(--purple)"
        score={territoryScore}
        tier={territoryRankTier(territoryScore)}
        route="/ranks/territory"
      />

      {/* Quick links */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <div className="card tappable" style={{ flex: 1, cursor: 'pointer', textAlign: 'center', padding: '14px 10px' }}
          onClick={() => nav('/challenges')}>
          <Icon name="trophy" style={{ fontSize: 22, color: 'var(--yellow)' }} />
          <div className="small" style={{ marginTop: 4, fontWeight: 500 }}>Challenges</div>
        </div>
        <div className="card tappable" style={{ flex: 1, cursor: 'pointer', textAlign: 'center', padding: '14px 10px' }}
          onClick={() => nav('/leaderboard')}>
          <Icon name="chart" style={{ fontSize: 22, color: 'var(--blue)' }} />
          <div className="small" style={{ marginTop: 4, fontWeight: 500 }}>Leaderboard</div>
        </div>
        <div className="card tappable" style={{ flex: 1, cursor: 'pointer', textAlign: 'center', padding: '14px 10px' }}
          onClick={() => nav('/profile')}>
          <Icon name="person" style={{ fontSize: 22, color: 'var(--acc)' }} />
          <div className="small" style={{ marginTop: 4, fontWeight: 500 }}>Profile</div>
        </div>
      </div>
    </div>
  )
}
