import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { territoryRankScore, territoryRankTier, territoryRankBreakdown, cellBounds } from '../lib/ranks/territoryRank.js'
import { RANK_TIERS } from '../lib/ranks/tiers.js'

// Lazy-loaded map — only imported when the territory tab is active.
// Map rendering uses the browser's built-in canvas + OpenStreetMap tiles
// via a lightweight wrapper. No API key required.

function TerritoryMap({ cells }) {
  // Placeholder — in production this would render an interactive Leaflet
  // or Mapbox GL map with the captured hex cells overlaid.
  const bounds = cellBounds(cells)
  return (
    <div style={{
      height: 260,
      borderRadius: 'var(--r-lg)',
      background: 'var(--surface-2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 8,
      color: 'var(--label-3)',
    }}>
      <Icon name="map" style={{ fontSize: 40 }} />
      <div className="small">
        {cells.length > 0
          ? `${cells.length} cells captured`
          : 'Start a run to capture territory'}
      </div>
      {bounds && (
        <div className="dim small">
          {bounds.minLat.toFixed(3)}°, {bounds.minLng.toFixed(3)}° → {bounds.maxLat.toFixed(3)}°, {bounds.maxLng.toFixed(3)}°
        </div>
      )}
    </div>
  )
}

function StatBadge({ icon, label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <Icon name={icon} style={{ fontSize: 22, color }} />
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
      <div className="dim small">{label}</div>
    </div>
  )
}

export default function TerritoryRank() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [tab, setTab] = useState('map')

  const territory = S.territory || {}
  const cells = territory.capturedCells || []
  const heldCells = cells.filter(c => !c.lostAt)
  const regions = new Set(cells.map(c => c.regionId).filter(Boolean))

  const score = territoryRankScore(S)
  const tier = territoryRankTier(score)
  const tierInfo = RANK_TIERS[tier]
  const breakdown = territoryRankBreakdown(S)

  return (
    <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/ranks')} aria-label="Back">
          <Icon name="chevronLeft" />
        </button>
        <div>
          <h1>TERRITORY Rank</h1>
          <div className="sub" style={{ color: tierInfo.color }}>{tierInfo.label} · {score.toLocaleString()} pts</div>
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['map', 'rank'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={tab === t ? 'tag acc' : 'tag'}
            style={{ textTransform: 'capitalize', cursor: 'pointer', border: 'none', flex: 1 }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'map' && (
        <>
          <div className="card">
            <TerritoryMap cells={cells} />
            <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 16 }}>
              <StatBadge icon="map" label="cells captured" value={cells.length} color="var(--purple)" />
              <StatBadge icon="lock" label="cells held" value={heldCells.length} color="var(--blue)" />
              <StatBadge icon="globe" label="regions" value={regions.size} color="var(--green)" />
            </div>
          </div>

          <div className="card">
            <h3 style={{ margin: '0 0 10px' }}>How territory works</h3>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
              <li>Run or walk through an area to capture its hex cells</li>
              <li>Cells you capture show on the map in your colour</li>
              <li>Other users can reclaim your cells by running through them</li>
              <li>Gyms act as anchors — nearby cells are harder to lose</li>
              <li>Anti-cheat: routes are verified by GPS point density and speed limits</li>
              <li>Suspicious captures (speed &gt; 30 km/h) are held in escrow for review</li>
            </ul>
          </div>

          <Button variant="primary" icon="bolt" onClick={() => nav('/ranks/run')}>
            Start a run to capture territory
          </Button>
        </>
      )}

      {tab === 'rank' && (
        <>
          <div className="card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <div style={{ fontSize: 48 }}>🗺️</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: tierInfo.color, marginTop: 8 }}>{tierInfo.label}</div>
            <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-.03em', marginTop: 4 }}>{score.toLocaleString()}</div>
            <div className="muted small">points</div>
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
          <div className="card">
            <h3 style={{ margin: '0 0 16px' }}>Score breakdown</h3>
            {Object.values(breakdown).map(item => (
              <div key={item.label} style={{ marginBottom: 14 }}>
                <div className="row between" style={{ marginBottom: 5 }}>
                  <span className="small" style={{ fontWeight: 500 }}>{item.label}</span>
                  <span className="small muted">{item.score.toLocaleString()} / {item.max.toLocaleString()}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (item.score / item.max) * 100)}%`, background: 'var(--purple)', borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
          <Button onClick={() => nav('/leaderboard?rank=territory')} icon="chart">View Territory Leaderboard</Button>
        </>
      )}
    </div>
  )
}
