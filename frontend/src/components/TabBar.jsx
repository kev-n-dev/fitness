import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutineIds, effectiveRoutines } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import Elapsed from './Elapsed.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'
import { menuSheet, startFlow } from '../sheets.jsx'

// Module scope, not TabBar's render body. Declared inside it, `Tab` was a new function on every
// render, so React saw a different component type each time and threw the button away and built a
// fresh one — on a bar that is fixed on screen, and once a second for the whole of a rest. The
// state it took with it is the DOM node itself: focus, the :active tint, any in-flight transition.
function Tab({ active, icon, label, onClick, dot }) {
  return (
    <button className={active ? 'on' : ''} onClick={onClick} aria-label={dot ? label + ', ' + t('Connection problem') : undefined}>
      <span className="tab-ic"><Icon name={icon} />{dot && <span className="tab-dot" aria-hidden="true" />}</span><span>{label}</span>
    </button>
  )
}

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  // With the connection banner switched off, a sync problem shows as a dot on Home, the tab
  // Settings lives under (#369, #330).
  const trouble = useConnectionTrouble()
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  
  // Tab active states
  const onHome = cur === 'home' || cur === 'settings' || cur === 'checkin' || cur === 'nutrition' || cur === 'measurements' || cur === 'progress-photos'
  const onPlan = cur === 'plan' || cur === 'library' || cur === 'muscles'
  const onCompete = cur === 'stats' || cur === 'history' || cur === 'ranks' || cur === 'leaderboard' || cur === 'challenges' || cur === 'structural-balance'
  const onSocial = cur === 'social' || cur === 'profile'

  const running = !!S.active && cur !== 'workout' && !S.active.editingWorkoutId && !S.active.backfill && S.active.start > 0

  // Open Log sheet with workout and meal options
  const openLogSheet = () => {
    const hasPlannedRoutines = effectiveRoutines(S, todayISO()).some(r => r.ex.length)
    menuSheet({
      title: t('Log'),
      sections: [
        {
          title: t('Workout'),
          items: [
            hasPlannedRoutines && {
              icon: 'clipboard',
              label: t('Planned'),
              sub: t('Start from today\'s scheduled routines'),
              onClick: () => onStart(effectiveRoutineIds(S, todayISO()))
            },
            {
              icon: 'play',
              label: t('Freestyle'),
              sub: t('Start an empty workout session'),
              onClick: () => startFlow([])
            }
          ].filter(Boolean)
        },
        {
          title: t('Meal'),
          items: [
            {
              icon: 'list',
              label: t('From saved meals'),
              sub: t('Pick from existing meals'),
              onClick: () => nav('/nutrition')
            },
            {
              icon: 'plus',
              label: t('New meal'),
              sub: t('Add a new meal entry'),
              onClick: () => nav('/log-meal')
            }
          ]
        }
      ]
    })
  }

  // Handler for center button: resume if active, otherwise show log sheet
  const handleCenterButton = () => {
    if (S.active) {
      nav('/workout')
    } else {
      openLogSheet()
    }
  }

  return (
    <nav id="tabbar">
      <Tab active={onHome} icon="house" label={t('Home')} dot={trouble} onClick={() => nav('/home')} />
      <Tab active={onPlan} icon="clipboard" label={t('Train')} onClick={() => nav('/plan')} />
      {/* Centre log / resume button */}
      <button className={'start' + (S.active ? ' rec' : '') + (S.active && cur === 'workout' ? ' on' : '')} onClick={handleCenterButton}
        aria-label={running ? t('Resume') : undefined}>
        <span className="cir"><Icon name={S.active ? 'play' : 'plus'} /></span>
        {running ? <span className="tab-time"><Elapsed start={S.active.start} /></span>
          : <span>{S.active ? (cur === 'workout' ? t('Workout') : S.active.editingWorkoutId ? t('Edit workout') : t('Resume')) : t('Log')}</span>}
      </button>
      <Tab active={onCompete} icon="chart" label={t('Progress')} onClick={() => nav('/stats')} />
      <Tab active={onSocial} icon="person2" label={t('Community')} onClick={() => nav('/social')} />
    </nav>
  )
}
