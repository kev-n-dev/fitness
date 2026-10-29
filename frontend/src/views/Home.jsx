import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay, streakWeeks, lastBW, setsDoneActive } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekStartOf, weekDayOffset, DAYS, DAYN } from '../lib/format.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, starterPlanSheet, bwDeltaColor, weighInsSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import QueueRow from '../components/QueueRow.jsx'
import { queueOf, queueView, weekTally, pinState } from '../lib/queue.js'
import { scheduleModeOf } from '../lib/rotation.js'
import { useConnectionTrouble } from '../components/SyncBanner.jsx'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'
import { dayNoteOf } from '../lib/day-notes.js'
import { getCachedVitals, healthReadStatus, enableHealthRead } from '../lib/health-read.js'
import { MOBILE } from '../lib/mobile.js'

// Default daily water goal in ml — matches Nutrition.jsx DEFAULT_GOALS.water
const DEFAULT_WATER_GOAL = 2500

/** Format milliseconds as "7h 30m". */
function fmtDuration(ms) {
  if (!ms) return '–'
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Dashboard sub-components ──────────────────────────────────────────────────

/** Thin radial progress ring used in goal tiles. r=22, stroke=4 */
function GoalRing({ pct, color = 'var(--acc)', size = 54 }) {
  const r = 20, stroke = 4
  const circ = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx={24} cy={24} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
      <circle cx={24} cy={24} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${(clamped / 100) * circ} ${circ}`}
        strokeLinecap="round"
        style={{ transform: 'rotate(-90deg)', transformOrigin: '24px 24px', transition: 'stroke-dasharray .4s var(--ease)' }} />
    </svg>
  )
}

/** One tile inside the goals grid. */
function GoalTile({ icon, label, value, sub, pct, color, onClick, children }) {
  const ring = pct != null
  return (
    <div className={`goal-tile${onClick ? ' tappable' : ''}`}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      {...(onClick ? tappable(onClick) : {})}>
      <div className="goal-tile-top">
        {ring
          ? <div className="goal-tile-ring"><GoalRing pct={pct} color={color} /><Icon name={icon} className="goal-tile-icon" style={{ color }} /></div>
          : <span className="lrow-i" style={{ background: color + '26', color, fontSize: 18 }}><Icon name={icon} /></span>
        }
        <div className="goal-tile-vals">
          <div className="goal-tile-val">{value}</div>
          {sub && <div className="dim small" style={{ marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
      <div className="goal-tile-label">{label}</div>
      {children}
    </div>
  )
}

/** Today's Health Connect activity strip (distance, calories, HR + extended clinical). */
function HealthMonitorCard({ vitals, onNav }) {
  if (!vitals) return null

  // Core activity (always present if HC is connected)
  const activity = [
    { icon: 'figureRun', label: t('Distance'), value: ((vitals.distanceM || 0) / 1000).toFixed(1) + ' km', color: 'var(--teal)' },
    { icon: 'flame',     label: t('Burned'),   value: (vitals.calories || 0) + ' kcal',                    color: 'var(--orange)' },
  ]
  if (vitals.avgBpm > 0) {
    activity.push({ icon: 'heart', label: t('Avg HR'), value: vitals.avgBpm + ' bpm', color: 'var(--red)' })
  }

  // Extended clinical (only when wearable data exists)
  const clinical = []
  if (vitals.restingBpm > 0) clinical.push({ icon: 'heart',    label: t('Resting HR'), value: vitals.restingBpm + ' bpm', color: 'var(--red)' })
  if (vitals.hrvMs      > 0) clinical.push({ icon: 'gauge',    label: t('HRV'),        value: vitals.hrvMs + ' ms',       color: 'var(--purple)' })
  if (vitals.spo2       > 0) clinical.push({ icon: 'sparkles', label: t('SpO₂'),       value: vitals.spo2 + '%',          color: 'var(--blue)' })
  if (vitals.respiratoryRate > 0) clinical.push({ icon: 'sunrise', label: t('Resp. rate'), value: vitals.respiratoryRate + '/min', color: 'var(--teal)' })
  if (vitals.vo2Max     > 0) clinical.push({ icon: 'rocket',   label: t('VO₂ Max'),    value: vitals.vo2Max + ' ml/kg/min', color: 'var(--green)' })

  const allItems = [...activity, ...clinical]

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>{t('Health monitors')}</h2>
        <span className="dim small">{t('via Health Connect')}</span>
      </div>

      <div className="health-monitor-grid">
        {allItems.map(item => (
          <div key={item.label} className="health-monitor-tile">
            <span className="lrow-i" style={{ background: item.color + '22', color: item.color, fontSize: 18, marginBottom: 6 }}>
              <Icon name={item.icon} />
            </span>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-.02em' }}>{item.value}</div>
            <div className="dim small">{item.label}</div>
          </div>
        ))}
      </div>

      {/* HR range sub-label */}
      {vitals.minBpm > 0 && vitals.maxBpm > 0 && (
        <div className="muted small" style={{ marginTop: 10, textAlign: 'center' }}>
          {t('HR range')}: {vitals.minBpm}–{vitals.maxBpm} bpm
        </div>
      )}

      {/* Irregular rhythm alert */}
      {vitals.irregularRhythmAlert && (
        <div className="row" style={{ gap: 7, marginTop: 10, color: 'var(--red)', fontSize: 13 }}>
          <Icon name="warning" style={{ fontSize: 16 }} />
          <span>{t('Irregular heart rhythm detected')}</span>
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => onNav('/nutrition')}>
          {t('Nutrition')}
        </Button>
      </div>
    </div>
  )
}

/** Sleep tile for the goals grid — shows last night's duration and stage breakdown. */
function SleepTile({ sleep }) {
  if (!sleep) return null
  const { durationMs, stages = {} } = sleep
  const deepMin  = Math.round((stages.deepMs  || 0) / 60000)
  const remMin   = Math.round((stages.remMs   || 0) / 60000)
  const goal = 8 * 3600000   // 8-hour target
  return (
    <GoalTile
      icon="moon"
      label={t('Sleep')}
      value={fmtDuration(durationMs)}
      sub={deepMin || remMin ? `${t('Deep')} ${deepMin}m · REM ${remMin}m` : t('Last night')}
      pct={(durationMs / goal) * 100}
      color="var(--indigo)"
    />
  )
}

/** Prompt to connect Health Connect when it isn't yet (Android only). */
function ConnectHealthCard({ onConnect }) {
  if (!MOBILE) return null
  return (
    <div className="card">
      <div className="row" style={{ gap: 12 }}>
        <span className="lrow-i" style={{ background: 'var(--green)26', color: 'var(--green)' }}><Icon name="heart" /></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{t('Health Connect')}</div>
          <div className="muted small">{t('See steps, heart rate & calories on this screen')}</div>
        </div>
        <Button size="sm" variant="tinted" onClick={onConnect}>{t('Connect')}</Button>
      </div>
    </div>
  )
}

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  // The banner switched off and the sync stuck: a dot on the gear (Settings → Show connection status).
  const trouble = useConnectionTrouble()
  const [weekOffset, setWeekOffset] = useState(0)
  const [vitals, setVitals] = useState(null)
  const [hcStatus, setHcStatus] = useState(null)

  // Load Health Connect vitals (cached read — no network call).
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    getCachedVitals().then(v => { if (v?.date === today) setVitals(v) }).catch(() => {})
    healthReadStatus().then(setHcStatus).catch(() => {})
  }, [])

  const connectHealthRead = async () => {
    const result = await enableHealthRead(data => { if (data?.vitals) setVitals(data.vitals) })
    if (result.ok) setHcStatus(s => ({ ...s, on: true, granted: true }))
  }

  // ── Water tracking ──────────────────────────────────────────────────────────
  const updateS = useStore(s => s.update)
  const todayKey = todayISO()
  const todayMeals = (S.meals || []).filter(m => m.time?.startsWith(todayKey))
  const waterToday = Math.round(todayMeals.reduce((acc, m) => acc + (m.nutrition?.water || 0), 0))
  const waterGoal = (S.nutritionGoals?.water) || DEFAULT_WATER_GOAL

  const addWater = ml => {
    updateS(s => {
      s.meals = [...(s.meals || []), {
        id: crypto.randomUUID(),
        name: t('Water'),
        time: new Date().toISOString(),
        nutrition: { water: ml },
      }]
    })
  }

  const today = new Date()
  // A weekday can hold several routines. `todayRoutines` is the whole day; `routine` is the
  // first, kept for the one-routine glyph. The derived session name joins them (§9).
  const todayRoutines = effectiveRoutines(S, todayISO())
  const routine = todayRoutines[0] || null
  const todayName = todayRoutines.map(r => r.name).join(' + ')
  // A fulfilled pin (a coach session pinned to today and since done) reads as no override.
  const todayOvr = S.dayPlan[todayISO()] !== undefined && pinState(S, S.dayPlan[todayISO()]) !== 'done'
  // An open editor on a saved workout (lib/session-edit.js) holds S.active too, but it is not a
  // session in progress: the row takes you back to it as an edit, the way the tab bar does.
  const editingSaved = !!S.active?.editingWorkoutId
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const ws = weekStartOf(S)
  // The first day of the shown week. Named for the role, not for Monday — which day that is
  // is the setting.
  const wkStart = new Date(today)
  wkStart.setDate(today.getDate() - weekDayOffset(today.getDay(), ws) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  // The last session logged for today, if any — what the row below reports instead of asking
  // you to start the one you already did. Last wins, so a second session names itself. Only once
  // today's plan is covered, though: a freestyle session on a planned day, or the rotation's
  // first session done when its next one is today's too, leaves the row offering what is still
  // to do, as Start and the progress row already do. A queue session is never "covered" by an
  // earlier workout: the queue only names one it does not count as done yet.
  const loggedToday = S.workouts.filter(w => w.d === todayISO())
  const queueIds = queueOf(S)?.ids || []
  const coveredToday = id => !queueIds.includes(id) && loggedToday.some(w => (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId]).includes(id))
  const doneToday = (todayRoutines.every(r => coveredToday(r.id)) && loggedToday.at(-1)) || null
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(wkStart); d.setDate(wkStart.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineIds(S, iso).length > 0, ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    // A day off with a note (#261) reads as excused, not as a plan that went by.
    const dot = done ? ' done' : dayNoteOf(S, iso) ? ' noted' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} {...tappable(() => dayOverrideSheet(iso))}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${wkStart.getDate()} ${wkStart.toLocaleDateString(dateLocale(), { month: 'short' })} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString(dateLocale(), { month: 'short' })}`

  // A coach week (S.queue) read through the same tolerant reader QueueRow uses, so a malformed
  // queue from another client shows the weekday dots, never an empty card.
  const queue = queueView(S, todayISO())
  // This card shows one thing or the other — QueueRow for a live queue, or Rotation chosen with
  // nothing built yet (S.scheduleMode), in which case there is no queue for QueueRow to render and
  // an empty-state card takes its place. Plan does the same in rotation mode: no weekday grid, only
  // the days that add a routine the loop does not have (Plan.jsx, "Also on fixed days").
  const rotating = scheduleModeOf(S) === 'rotation'
  // A planner-written queue (no rotationId) still names its weekday when it hasn't started yet —
  // that copy predates rotation and stays as it is. Our own rotation has no weekday of its own
  // (lib/rotation.js): naming one here — including on the pass's own one-day empty gap (THE
  // ONE-DAY BOUNDARY, rotation.js) or before a first routine is even added — would be the
  // fixed-week model leaking into a schedule that was never weekday-based.
  const liveQ = queueOf(S)
  const plannerQueue = !!queue && !liveQ?.rotationId
  // Ownership, not mere presence of a rotationId: a stale id left over from a rebuilt rotation
  // would otherwise still read as "this app manages it" (lib/rotation.js).
  const managedQueue = !!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id
  // On a rest day, saying when you train next beats leaving the row as a full stop.
  const next = !S.active && !todayRoutines.length && !(rotating && !plannerQueue) ? nextTrainingDay(S, todayISO()) : null
  // The streak card's fraction: this calendar week's workouts over the weekdays with a plan, or,
  // in a coach week, the queue's sessions and your own days together (lib/queue.js weekTally).
  const { done: doneThisWeek, planned: plannedPerWeek } = weekTally(S, todayISO())
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))

  // today's session shown right under the week strip
  const onToday = () => { if (S.active) nav('/workout'); else if (todayRoutines.length) startFlow(effectiveRoutineIds(S, todayISO())); else dayOverrideSheet(todayISO()) }
  // A chip on the coach week's progress row starts that one routine, in any order. A session
  // already in progress wins, as on the today row — starting another would overwrite it.
  const onQueueStart = id => { if (S.active) nav('/workout'); else startFlow([id]) }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : 'openGym'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={trouble ? t('Settings') + ', ' + t('Connection problem') : t('Settings')}><Icon name="gear" />{trouble && <span className="tab-dot" aria-hidden="true" />}</button>
    </div>

    <div className="card">
      {/* A coach week runs by order, not by weekday, so its progress row stands in for the
          seven dots (components/QueueRow.jsx). The today row below stays as it is: the queue's
          next session reaches it through effectiveRoutineIds like any planned routine. */}
      {rotating ? (queue ? <QueueRow S={S} today={todayISO()} onStart={onQueueStart} managed={managedQueue} /> : <div className="empty">
        {t('No rotation yet. Add routines to it in Plan.')}
        <div style={{ marginTop: 10 }}><Button size="sm" variant="tinted" onClick={() => nav('/plan')}>{t('Set up in Plan')}</Button></div>
      </div>) : <>
        <div className="row between" style={{ marginBottom: 8 }}>
          <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
          <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
          <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
        </div>
        <div className="week">{strip}</div>
      </>}
      {/* Once today's session is logged the row stops asking for it. The week strip already
          knew (its dot goes 'done'); this row did not, so a finished day kept showing the
          routine name behind a green Start tag and read as still outstanding (issue #4).
          An in-progress session still wins — that one is happening right now. Tapping the
          row keeps working, so a second session in one day is a tap away, just not urged. */}
      <div className="today-row" {...tappable(onToday)}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : doneToday ? 'var(--surface-3)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={S.active ? (editingSaved ? 'pencil' : 'play') : doneToday ? 'checkCircle' : routine ? glyphOf(routine.emoji) : 'moon'}
              style={doneToday && !S.active ? { color: 'var(--green)' } : undefined} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? (editingSaved ? S.active.name : t('{0} (in progress)', S.active.name))
              : doneToday ? (doneToday.name ? t('{0} (done)', doneToday.name) : t('Workout done'))
              : routine ? todayName : t('Rest day')}{todayOvr && routine && !doneToday ? ' · ' + t('rescheduled') : ''}</div>
            {next && !doneToday && <div className="ss">{t('Next session: {0}, {1}', t(DAYN[next.weekday]), next.routine.name)}</div>}
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{editingSaved ? t('Edit') : t('Resume')}</span>
          : doneToday ? <span className="tag" style={{ color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>{t('Done')}</span>
          : routine ? <span className="tag acc">{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
      </div>
      {/* The row above starts today's plan in one tap, and so does the Start button in the tab
          bar — which is the whole problem when you want something else. Both jump straight into
          the planned session whenever there is one, so the Start screen (a freestyle session,
          and your other routines) is only reachable on a day with nothing planned. The one other
          way in, "Choose a different workout" on the weigh-in sheet, does not exist when the
          weigh-in is switched off. This is that door, and it starts nothing on its own. */}
      {!S.active && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
        <Button size="sm" variant="ghost" className="dim" icon="swap" onClick={() => nav('/workout')}>
          {t('Choose a different workout')}
        </Button>
      </div>}
    </div>

    {/* Jump to the gym check-in cards (QR membership codes). Shown here as a quick tap on
        arrival at the gym; folds away per user via the "Gym check-in" switch in Settings. */}
    {S.checkIn !== false && (
      <div className="card tappable" style={{ cursor: 'pointer' }} {...tappable(() => nav('/checkin'))}>
        <div className="row between">
          <div className="row" style={{ gap: 9 }}>
            <span className="lrow-i" style={{ background: 'var(--blue)' }}><Icon name="qr" /></span>
            <div>
              <div className="lbl2">{t('At the gym')}</div>
              <div className="ttl">{t('Check in')}</div>
            </div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
      </div>
    )}

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="calendar" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going, or grab a ready-made starter plan.')}</div>
        <Button variant="primary" icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    {S.showWeightCard !== false && <div className="card">
      <div className="row between bw-head" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
          {/* only when it actually moved — an unchanged weight used to read as "− 0" */}
          {!!delta && (
            <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginInlineStart: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 13 }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
        {/* every weigh-in, week by week with its average (Discord 'Weight') */}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
          <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={weighInsSheet}>{t('All weigh-ins')}</Button>
        </div>
      </> : <div className="muted small">{S.weighIn === false
        ? t('No weigh-ins yet. Log your weight to start the curve.')
        : t("No weigh-ins yet. Log your weight to start the curve (we also ask before every workout).")}</div>}
    </div>}

    <div className="card tappable" style={{ cursor: 'pointer' }} {...tappable(() => calendarSheet())}>
      <div className="row between">
        <div>
          <div className="row" style={{ gap: 7, fontSize: 22, fontWeight: 600, letterSpacing: '-.021em' }}>
            <Icon name="flame" style={{ color: 'var(--orange)' }} />
            {t('{0} week streak', streakWeeks(S))}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>{doneThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {tn('{0} workout total', '{0} workouts total', S.workouts.length)}</div>
        </div>
        <Icon name="calendar" className="chev" style={{ fontSize: 20 }} />
      </div>
    </div>

    {/* ── Goals & trackers ─────────────────────────────────────────────────── */}
    <h2 style={{ margin: '18px 2px 10px', fontSize: 20, fontWeight: 700, letterSpacing: '-.021em' }}>{t('Goals & trackers')}</h2>

    <div className="goals-grid">
      {/* Weekly workouts */}
      {plannedPerWeek > 0 && (
        <GoalTile
          icon="dumbbell"
          label={t('Weekly workouts')}
          value={`${doneThisWeek} / ${plannedPerWeek}`}
          sub={doneThisWeek >= plannedPerWeek ? t('Goal reached!') : t('{0} to go', plannedPerWeek - doneThisWeek)}
          pct={(doneThisWeek / plannedPerWeek) * 100}
          color="var(--acc)"
          onClick={() => calendarSheet()}
        />
      )}

      {/* Daily steps — always shown; 0 when HC isn't connected yet */}
      <GoalTile
        icon="steps"
        label={t('Steps today')}
        value={(vitals?.steps || 0).toLocaleString()}
        sub={vitals
          ? `${t('Goal')} ${(S.stepGoal || 10000).toLocaleString()}`
          : t('Needs Health Connect')}
        pct={((vitals?.steps || 0) / (S.stepGoal || 10000)) * 100}
        color={vitals ? 'var(--teal)' : 'var(--label-3)'}
        onClick={vitals ? undefined : (MOBILE ? connectHealthRead : undefined)}
      />

      {/* Sleep — last night, from HC */}
      {vitals?.sleep && <SleepTile sleep={vitals.sleep} />}

      {/* Body weight goal */}
      {S.showWeightCard !== false && S.targetW && bw && (
        <GoalTile
          icon="target"
          label={t('Weight goal')}
          value={`${fmtNum(bw.w)} ${S.unit}`}
          sub={`${t('Goal')} ${fmtNum(S.targetW)} ${S.unit}`}
          pct={(() => {
            // oldest bw as start, targetW as end; clamp 0–100
            const start = S.bodyweight.length > 1 ? S.bodyweight[0].w : bw.w
            const range = Math.abs(S.targetW - start)
            if (range === 0) return 100
            const gone = Math.abs(bw.w - start)
            return Math.min(100, (gone / range) * 100)
          })()}
          color="var(--yellow)"
          onClick={goalSheet}
        />
      )}

      {/* Water today */}
      <GoalTile
        icon="leaf"
        label={t('Water')}
        value={waterToday >= 1000 ? `${(waterToday / 1000).toFixed(1)} L` : `${waterToday} ml`}
        sub={`${t('Goal')} ${waterGoal >= 1000 ? (waterGoal / 1000).toFixed(1) + ' L' : waterGoal + ' ml'}`}
        pct={(waterToday / waterGoal) * 100}
        color="var(--blue)"
        onClick={() => nav('/nutrition')}
      >
        {/* Quick-add buttons inline in the tile */}
        <div className="goal-tile-actions">
          <button className="chip" style={{ fontSize: 12 }} onClick={e => { e.stopPropagation(); addWater(250) }}>+250 ml</button>
          <button className="chip" style={{ fontSize: 12 }} onClick={e => { e.stopPropagation(); addWater(500) }}>+500 ml</button>
        </div>
      </GoalTile>

    </div>

    {/* ── Health Connect monitors ──────────────────────────────────────────── */}
    <HealthMonitorCard vitals={vitals} onNav={nav} />
    {MOBILE && hcStatus && !hcStatus.on && !vitals && (
      <ConnectHealthCard onConnect={connectHealthRead} />
    )}
  </div>
}
