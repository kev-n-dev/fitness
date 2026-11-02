import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, passkeyError, bio, getLinkedProviders } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { askAddDeviceData } from '../sheets.jsx'
import { passwordOn, PasswordRegisterForm, openPasswordSignIn } from '../components/PasswordAuth.jsx'
import { openDeviceLinkRedeem } from '../components/Passkeys.jsx'
import GoogleLoginButton from '../components/GoogleLoginButton.jsx'

// Check if Google login is enabled in the config
function googleOn(config) {
  return !!config?.google_login
}

// Show a tip toast suggesting linking additional auth methods if the user only has one
async function showLinkTipIfNeeded() {
  try {
    const r = await getLinkedProviders()
    if (r?.providers?.length === 1) {
      // Delay the tip slightly so it appears after the welcome toast
      setTimeout(() => {
        useUI.getState().toast(t('Tip: Add a backup sign-in method in Settings → Account'))
      }, 3500)
    }
  } catch {
    // Ignore errors - this is just a helpful tip
  }
}

// Visual divider with centered text
function Divider({ children }) {
  return (
    <div className="auth-divider">
      <span className="auth-divider-line" />
      {children && <span className="auth-divider-text">{children}</span>}
      <span className="auth-divider-line" />
    </div>
  )
}

// Method card for registration flow
function MethodCard({ icon, title, description, recommended, onClick }) {
  return (
    <button className={'auth-method-card' + (recommended ? ' recommended' : '')} onClick={onClick}>
      <span className="auth-method-icon"><Icon name={icon} /></span>
      <span className="auth-method-content">
        <span className="auth-method-title">
          {title}
          {recommended && <span className="auth-method-badge">{t('Recommended')}</span>}
        </span>
        <span className="auth-method-desc">{description}</span>
      </span>
      <Icon name="chevronRight" className="auth-method-chevron" />
    </button>
  )
}

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState, loadConfig } = useStore()
  const config = useStore(s => s.config)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState('choose') // 'choose' | 'passkey' | 'password'
  const inviteOnly = !!config?.invite_only
  const pwOn = passwordOn(config)
  const canPasskey = webauthnOK()
  const ref = useRef(null)
  
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [step])
  useEffect(() => { loadConfig() }, [loadConfig])
  
  // Skip method selection if only one option
  useEffect(() => {
    if (!canPasskey && pwOn) setStep('password')
    else if (canPasskey && !pwOn) setStep('passkey')
  }, [canPasskey, pwOn])
  
  const [busy, setBusy] = useState(false)
  
  const createPasskey = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    setBusy(true)
    try {
      const u = await passkeyRegister(n, code.trim())
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t("Profile created, and this device's data moved into it")) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { 
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(passkeyError(e, t('Registration failed')))
    } finally {
      setBusy(false)
    }
  }
  
  // Method selection step
  if (step === 'choose' && canPasskey && pwOn) return <>
    <h3>{t('Create your profile')}</h3>
    <div className="auth-step-indicator">
      <span className="auth-step active">{t('Step 1')}</span>
      <span className="auth-step-sep">→</span>
      <span className="auth-step">{t('Step 2')}</span>
    </div>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Choose how you want to sign in to your profile.')}</div>
    
    <MethodCard
      icon="fingerprint"
      title={t('Passkey')}
      description={t('Use {0}. No password to remember — fast and secure.', bio())}
      recommended
      onClick={() => setStep('passkey')}
    />
    <div style={{ height: 10 }} />
    <MethodCard
      icon="key"
      title={t('Password')}
      description={t('Traditional sign-in with your name and a password.')}
      onClick={() => setStep('password')}
    />
    
    <div className="dim small" style={{ marginTop: 16, lineHeight: 1.4 }}>
      {t('You can add more sign-in methods later in Settings.')}
    </div>
  </>
  
  // Password registration
  if (step === 'password' && pwOn) return <>
    <h3>{t('Create your profile')}</h3>
    {canPasskey && pwOn && (
      <div className="auth-step-indicator">
        <span className="auth-step done" onClick={() => setStep('choose')}>✓</span>
        <span className="auth-step-sep">→</span>
        <span className="auth-step active">{t('Step 2')}</span>
      </div>
    )}
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name and a password. You sign in with both.')}</div>
    <PasswordRegisterForm close={close} inviteOnly={inviteOnly} name={name} setName={setName} code={code} setCode={setCode} />
    {canPasskey && (
      <Button variant="ghost" className="dim" style={{ marginTop: 8 }} onClick={() => setStep('choose')}>
        {t('← Back to options')}
      </Button>
    )}
  </>
  
  // Passkey registration
  return <>
    <h3>{t('Create your profile')}</h3>
    {canPasskey && pwOn && (
      <div className="auth-step-indicator">
        <span className="auth-step done" onClick={() => setStep('choose')}>✓</span>
        <span className="auth-step-sep">→</span>
        <span className="auth-step active">{t('Step 2')}</span>
      </div>
    )}
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey lives on your device, so no password needed.', bio())}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only. Enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={createPasskey} disabled={busy}>{t('Create passkey')}</Button>
    {canPasskey && pwOn && (
      <Button variant="ghost" className="dim" style={{ marginTop: 8 }} onClick={() => setStep('choose')}>
        {t('← Back to options')}
      </Button>
    )}
  </>
}

export default function Login() {
  const { setUser, adoptProfile, setGuest } = useStore()
  const config = useStore(s => s.config)
  const canGuest = guestAllowed(config)
  const pwOn = passwordOn(config)
  const googleEnabled = googleOn(config)
  const [signingIn, setSigningIn] = useState(false)
  
  const register = () => useUI.getState().openSheet(close => <RegisterSheet close={close} />)
  
  const signIn = async () => {
    setSigningIn(true)
    try {
      const u = await passkeyLogin()
      setUser(u, { adopt: true })
      await adoptProfile(askAddDeviceData)
      useUI.getState().toast(t('Welcome back, {0}', u.name))
      showLinkTipIfNeeded()
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') {
        useUI.getState().toast(passkeyError(e, t('Sign-in failed')))
      }
    } finally {
      setSigningIn(false)
    }
  }
  
  const head = <>
    <div className="auth-logo"><Icon name="dumbbell" /></div>
    <h1 className="auth-title">openGym</h1>
  </>
  
  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow auth-page">
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo. Everything stays in this browser.')}</div>
      <Button variant="primary" icon="play" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'start', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data. Nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )
  
  // No passkey support fallback
  if (!webauthnOK()) {
    return (
      <div className="narrow auth-page">
        {head}
        <div className="muted auth-tagline">{t('Your workouts. Your weights. Your profile.')}</div>
        
        {pwOn ? <>
          <div className="card small muted" style={{ textAlign: 'start', marginBottom: 14 }}>
            {t("This browser doesn't support passkeys. Sign in with your name and password instead.")}
          </div>
          
          <div className="auth-section">
            <Button variant="primary" icon="key" onClick={() => openPasswordSignIn()}>{t('Sign in with password')}</Button>
            <div style={{ height: 10 }} />
            {googleEnabled && <><GoogleLoginButton /><div style={{ height: 10 }} /></>}
          </div>
          
          <Divider>{t('New here?')}</Divider>
          
          <Button icon="plusCircle" onClick={register}>{t('Create profile')}</Button>
        </> : <div className="card small muted" style={{ textAlign: 'start' }}>{canGuest
          ? t("This browser doesn't do passkeys, but you can still use openGym locally on this device.")
          : t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}</div>}
        
        {canGuest && <>
          <div style={{ height: 16 }} />
          <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>
        </>}
      </div>
    )
  }

  // Full login page with passkey support
  const hasSecondarySignIn = pwOn || googleEnabled
  
  return (
    <div className="narrow auth-page">
      {head}
      <div className="muted auth-tagline">{t('Your workouts. Your weights. Your profile.')}</div>
      
      {/* Sign In Section */}
      <div className="auth-section">
        <div className="auth-section-label">{t('Sign in')}</div>
        
        {/* Primary: Passkey */}
        <Button variant="primary" icon="fingerprint" onClick={signIn} disabled={signingIn}>
          {signingIn ? t('Signing in…') : t('Sign in with passkey')}
        </Button>
        
        {/* Secondary sign-in methods */}
        {hasSecondarySignIn && <>
          <Divider>{t('or')}</Divider>
          <div className="auth-secondary-row">
            {pwOn && (
              <Button className="auth-secondary-btn" icon="key" onClick={() => openPasswordSignIn()}>
                {t('Password')}
              </Button>
            )}
            {googleEnabled && (
              <GoogleLoginButton compact className="auth-secondary-btn" />
            )}
          </div>
        </>}
      </div>
      
      {/* Create Account Section */}
      <Divider>{t('New here?')}</Divider>
      
      <div className="auth-section">
        <Button variant="tinted" icon="plusCircle" onClick={register}>{t('Create profile')}</Button>
      </div>
      
      {/* Tertiary actions */}
      <div className="auth-tertiary">
        <button className="auth-tertiary-link" onClick={openDeviceLinkRedeem}>
          <Icon name="qr" />
          <span>{t('Link from another device')}</span>
        </button>
        
        {canGuest && (
          <button className="auth-tertiary-link" onClick={() => setGuest(true)}>
            <Icon name="person" />
            <span>{t('Continue as guest')}</span>
          </button>
        )}
      </div>
      
      {/* Footer info */}
      <div className="auth-footer">
        {pwOn 
          ? t('Passkeys use {0}. A password works too, where passkeys do not.', bio()) 
          : t('Passkeys use {0}. No passwords to remember.', bio())}
      </div>
    </div>
  )
}
