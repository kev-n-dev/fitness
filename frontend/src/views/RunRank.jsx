import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { runRankScore, runRankTier, runRankBreakdown, newRun, formatPace, formatDuration, RUN_MILESTONES, bestTimeForDistance } from '../lib/ranks/runRank.js'
import { RANK_TIERS } from '../lib/ranks/tiers.js'

// ── Active run tracker ───────────────────────────────────────────────────────

function useRunTracker() {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [distance, setDistance] = useState(0)
  const [points, setPoints] = useState([])
  const [error, setError] = useState(null)
  const startTime = useRef(null)
  const watchId = useRef(null)
  const lastPos = useRef(null)
  const timerRef = useRef(null)

  const start = () => {
    if (!navigator.geolocation) { setError('GPS not available on this device'); return }
    setError(null)
    setElapsed(0)
    setDistance(0)
    setPoints([])
    startTime.current = Date.now()
    setRunning(true)

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000))
    }, 1000)

    watchId.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords
        const t = Date.now()
        setPoints(prev => [...prev, { lat, lng, t }])
        if (lastPos.current) {
          setDistance(prev => prev + haversineKm(lastPos.current, { lat, lng }))
        }
        lastPos.current = { lat, lng }
      },
      err => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )
  }

  const stop = () => {
    setRunning(false)
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    if (timerRef.current) clearInterval(timerRef.current)
    return { elapsed, distance, points }
  }

  useEffect(() => () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  return { running, elapsed, distance, points, error, start, stop }
}

function haversineKm(a, b) {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function RunRank() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const updateS = useStore(s => s.update)
  const [tab, setTab] = useState('tracker') // 'tracker' | 'history' | 'rank'
  const tracker = useRunTracker()

  const score = runRankScore(S)
  const tier = runRankTier(score)
  const tierInfo = RANK_TIERS[tier]
  const breakdown = runRankBreakdown(S)
  const runs = S.runs || []

  const finishRun = () => {
    const { elapsed, distance, points } = tracker.stop()
    if (distance < 0.1) return // ignore accidental taps
    const run = newRun({ distanceKm: distance, durationSec: elapsed, routePoints: points })
    updateS(s => { s.runs = [...(s.runs || []), run] })
  }

  return (
    <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/ranks')} aria-label="Back">
          <Icon name="chevronLeft" />
        </button>
        <div>
          <h1>RUN Rank</h1>
          <div className="sub" style={{ color: tierInfo.color }}>{tierInfo.label} · {score.toLocaleString()} pts</div>
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['tracker', 'history', 'rank'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={tab === t ? 'tag acc' : 'tag'}
            style={{ textTransform: 'capitalize', cursor: 'pointer', border: 'none', flex: 1 }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'tracker' && (
        <>
          {/* Live tracker */}
          <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
            {tracker.error && <div className="muted small" style={{ color: 'var(--red)', marginBottom: 12 }}>{tracker.error}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 36, fontWeight: 800 }}>{tracker.distance.toFixed(2)}</div>
                <div className="muted small">km</div>
              </div>
              <div>
                <div style={{ fontSize: 36, fontWeight: 800 }}>{formatDuration(tracker.elapsed)}</div>
                <div className="muted small">time</div>
              </div>
              <div>
                <div style={{ fontSize: 36, fontWeight: 800 }}>
                  {tracker.elapsed > 0 && tracker.distance > 0.01 ? formatPace(Math.round(tracker.elapsed / tracker.distance)) : '—'}
                </div>
                <div className="muted small">pace</div>
              </div>
            </div>
            {!tracker.running
              ? <Button variant="primary" icon="play" onClick={tracker.start}>Start run</Button>
              : <Button variant="primary" icon="stop" onClick={finishRun} style={{ background: 'var(--red)' }}>Finish run</Button>
            }
          </div>
        </>
      )}

      {tab === 'history' && (
        <div>
          {!runs.length
            ? <div className="card muted small" style={{ textAlign: 'center', padding: 24 }}>No runs logged yet. Start your first run above.</div>
            : runs.slice().reverse().map(run => (
              <div key={run.id} className="card">
                <div className="row between">
                  <div>
                    <div className="ttl">{run.distanceKm.toFixed(2)} km</div>
                    <div className="muted small">{run.date} · {formatDuration(run.durationSec)} · {formatPace(run.paceSecPerKm)}</div>
                  </div>
                  <Icon name="bolt" style={{ color: 'var(--green)', fontSize: 20 }} />
                </div>
              </div>
            ))
          }
        </div>
      )}

      {tab === 'rank' && (
        <>
          <div className="card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <div style={{ fontSize: 48 }}>🏃</div>
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

          {/* Distance score */}
          <div className="card">
            <div className="row between">
              <span style={{ fontWeight: 600 }}>Total distance</span>
              <span style={{ fontWeight: 700, color: 'var(--green)' }}>{breakdown.distance.score.toLocaleString()} pts</span>
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>{breakdown.distance.detail} · 2 pts per km, no cap</div>
          </div>

          {/* Milestone PRs */}
          <div className="card">
            <h3 style={{ margin: '0 0 14px' }}>Milestone times</h3>
            {RUN_MILESTONES.map(m => {
              const best = bestTimeForDistance(runs, m.distKm)
              const item = breakdown.milestones.items.find(i => i.key === m.key)
              const earned = item?.pts || 0
              const max = m.brackets[0].pts
              const pct = (earned / max) * 100
              return (
                <div key={m.key} style={{ marginBottom: 14 }}>
                  <div className="row between" style={{ marginBottom: 4 }}>
                    <span className="small" style={{ fontWeight: 600 }}>{m.label}</span>
                    <div style={{ textAlign: 'right' }}>
                      <span className="small" style={{ fontWeight: 700, color: earned > 0 ? 'var(--green)' : 'var(--label-3)' }}>{earned} pts</span>
                      <span className="dim small"> / {max}</span>
                    </div>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', marginBottom: 3 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: 'var(--green)', borderRadius: 3 }} />
                  </div>
                  <div className="row between">
                    <span className="dim small">{item?.bracketLabel || 'Not yet run'}</span>
                    {best && <span className="dim small">PR: {formatDuration(best)}</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Challenge bonus */}
          {breakdown.challenges.score > 0 && (
            <div className="card">
              <div className="row between">
                <span style={{ fontWeight: 600 }}>Challenge bonuses</span>
                <span style={{ fontWeight: 700, color: 'var(--yellow)' }}>+{breakdown.challenges.score.toLocaleString()} pts</span>
              </div>
            </div>
          )}

          <Button onClick={() => nav('/leaderboard?rank=run')} icon="chart">View RUN Leaderboard</Button>
        </>
      )}
    </div>
  )
}
