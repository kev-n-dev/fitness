// Linked authentication methods: shows which methods (passkey, password, google) are linked to
// this account, allows unlinking and adding new methods. Used in Settings → Account.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { dateLocale } from '../lib/i18n-core.js'
import { api, getLinkedProviders, unlinkProvider, webauthnOK, createPasskey } from '../lib/api.js'
import { passwordError, notReached, useAgainOnceReached, ProveOwner, MIN_PASSWORD, looksLikeEmail, foldEmail } from './PasswordAuth.jsx'
import { Row, Button } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
const errStyle = { color: 'var(--red)', marginTop: 10 }
const field = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }
// A passkey prompt the person closed is their answer, not an error worth a line in red.
const dismissed = e => e?.name === 'NotAllowedError' || e?.name === 'AbortError'

// Format date for display
const when = iso => {
  if (!iso) return null
  const d = new Date(iso)
  const year = d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}
  try { return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', ...year }) }
  catch { return '' }
}

// Provider display info
const PROVIDER_INFO = {
  passkey: { icon: 'fingerprint', tint: 'var(--acc)', label: () => t('Passkey') },
  password: { icon: 'key', tint: 'var(--orange)', label: () => t('Password') },
  google: { icon: 'globe', tint: 'var(--blue)', label: () => t('Google') },
}

const providerIcon = p => PROVIDER_INFO[p]?.icon || 'link'
const providerTint = p => PROVIDER_INFO[p]?.tint || 'var(--grey)'
const providerLabel = p => PROVIDER_INFO[p]?.label() || p

// Hook to fetch linked providers
export function useLinkedProviders(on) {
  const [st, setSt] = useState(null)
  const [unreached, setUnreached] = useState(false)
  const load = () => getLinkedProviders()
    .then(r => { setSt(r); setUnreached(false) })
    .catch(e => setUnreached(notReached(e)))
  useEffect(() => { if (on) load() }, [on])
  useAgainOnceReached(on && unreached, load)
  return { st, load, set: setSt }
}

// Settings row showing count of linked methods
export function LinkedAccountsRow({ state, changed }) {
  if (!state) return null
  const n = state.providers?.length || 0
  return (
    <Row
      icon="link"
      iconTint="var(--purple)"
      title={t('Linked accounts')}
      accessory="chevron"
      subtitle={n === 0 ? t('No linked authentication methods.') : t('{0} authentication method(s) linked', n)}
      onClick={() => ui().openSheet(close => <LinkedAccountsSheet close={close} changed={changed} />)}
    />
  )
}

// Sheet listing all providers
export function LinkedAccountsSheet({ close, changed }) {
  const { st, set, load } = useLinkedProviders(true)
  const config = useStore(s => s.config)
  const passwordLoginOn = !!config?.password_login
  const done = r => { if (r?.providers) set(r); else load(); changed?.() }

  if (!st) return <><h3>{t('Linked accounts')}</h3><div className="muted small">…</div></>

  const providers = st.providers || []
  const hasPassword = providers.some(p => p.provider === 'password')
  const hasPasskey = providers.some(p => p.provider === 'passkey')

  const edit = p => ui().openSheet(c => (
    <ProviderDetailSheet provider={p} state={st} close={c} done={done} />
  ))

  const linkPassword = () => ui().openSheet(c => (
    <LinkPasswordSheet state={st} close={c} done={done} />
  ))

  const linkPasskey = () => ui().openSheet(c => (
    <LinkPasskeySheet state={st} close={c} done={done} />
  ))

  return <>
    <h3>{t('Linked accounts')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('These are the ways you can sign in to this profile. Tap one to see details or remove it.')}
    </div>
    {providers.length > 0 && (
      <div className="sect-b">
        {providers.map(p => (
          <Row
            key={p.id}
            icon={providerIcon(p.provider)}
            iconTint={providerTint(p.provider)}
            title={providerLabel(p.provider)}
            subtitle={[
              p.email,
              p.lastUsed && t('Last used {0}', when(p.lastUsed))
            ].filter(Boolean).join(' · ') || null}
            accessory="chevron"
            onClick={() => edit(p)}
          />
        ))}
      </div>
    )}
    {providers.length === 0 && (
      <div className="dim small" style={{ marginBottom: 14 }}>
        {t('No authentication methods linked yet.')}
      </div>
    )}
    <div style={{ height: 14 }} />
    {/* Link new methods */}
    {!hasPassword && passwordLoginOn && (
      <>
        <Button icon="key" onClick={linkPassword}>{t('Link password')}</Button>
        <div style={{ height: 8 }} />
      </>
    )}
    {!hasPasskey && webauthnOK() && (
      <>
        <Button icon="fingerprint" onClick={linkPasskey}>{t('Link passkey')}</Button>
        <div style={{ height: 8 }} />
      </>
    )}
    <Button onClick={close}>{t('Done')}</Button>
  </>
}

// Detail sheet for a single provider
function ProviderDetailSheet({ provider, state, close, done }) {
  const providers = state.providers || []
  const canRemove = providers.length > 1

  const info = [
    provider.email && t('E-mail: {0}', provider.email),
    provider.created && t('Added {0}', when(provider.created)),
    provider.lastUsed && t('Last used {0}', when(provider.lastUsed)),
  ].filter(Boolean)

  const remove = () => ui().openSheet(c => (
    <RemoveProviderSheet
      provider={provider}
      state={state}
      close={c}
      done={r => { done(r); close() }}
    />
  ))

  return <>
    <h3>{providerLabel(provider.provider)}</h3>
    {info.length > 0 && (
      <div className="muted small" style={{ marginBottom: 14 }}>
        {info.join(' · ')}
      </div>
    )}
    <div style={{ height: 8 }} />
    {canRemove ? (
      <button type="button" className="btn danger" onClick={remove}>
        {t('Remove this method')}
      </button>
    ) : (
      <div className="dim small">
        {t('This is the only way to sign in, so it cannot be removed.')}
      </div>
    )}
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Done')}</Button>
  </>
}

// Confirmation sheet for removing a provider
function RemoveProviderSheet({ provider, state, close, done }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const hasPasskeys = state.providers?.some(p => p.provider === 'passkey')
  const hasPassword = state.providers?.some(p => p.provider === 'password')

  const remove = async proof => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await unlinkProvider(provider.id, proof)
      close()
      done(r)
      toast(t('Authentication method removed'))
    } catch (e) {
      setErr(passwordError(e))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <h3>{t('Remove this method?')}</h3>
    <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
      {providerLabel(provider.provider)}
      {provider.email && <span className="muted"> · {provider.email}</span>}
    </div>
    <div className="muted small" style={{ marginBottom: 6 }}>
      {t('You will no longer be able to sign in with this method.')}
    </div>
    <div className="dim small" style={{ marginBottom: 14 }}>{t('First confirm that it is you.')}</div>
    <ProveOwner
      passkey={hasPasskeys}
      password={hasPassword}
      explain={passwordError}
      danger
      submitText={t('Remove')}
      onProof={remove}
    />
    {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
    <div style={{ height: 8 }} />
    <Button type="button" variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

// Sheet for linking a password to the account
function LinkPasswordSheet({ state, close, done }) {
  const [step, setStep] = useState('prove')  // 'prove' | 'form'
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [proof, setProof] = useState(null)

  const hasPasskeys = state.providers?.some(p => p.provider === 'passkey')
  const hasPassword = state.providers?.some(p => p.provider === 'password')

  const length = s => [...String(s || '')].length

  const onProofComplete = async proofData => {
    setProof(proofData)
    setStep('form')
  }

  const submit = async ev => {
    ev.preventDefault()
    if (busy) return
    const mail = email.trim()
    const bad = mail && !looksLikeEmail(mail) ? t('That is not an e-mail address.')
      : length(pw) < MIN_PASSWORD ? t('Use at least {0} characters.', MIN_PASSWORD)
      : pw !== again ? t('The two passwords are not the same.')
      : null
    if (bad) { setErr(bad); return }
    setBusy(true)
    setErr(null)
    try {
      await post('/api/account/link/password', {
        password: pw,
        email: mail || undefined,
        ...proof
      })
      close()
      done()
      toast(t('Password linked'))
    } catch (e) {
      setErr(passwordError(e))
    } finally {
      setBusy(false)
    }
  }

  if (step === 'prove') {
    return <>
      <h3>{t('Link password')}</h3>
      <div className="muted small" style={{ marginBottom: 14 }}>
        {t('Add a password to this account so you can sign in where passkeys don\'t work. First confirm that it is you.')}
      </div>
      <ProveOwner
        passkey={hasPasskeys}
        password={hasPassword}
        explain={passwordError}
        onProof={onProofComplete}
      />
      {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
      <div style={{ height: 8 }} />
      <Button type="button" variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
    </>
  }

  return <>
    <h3>{t('Link password')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Choose a password for this account. You can also add an optional e-mail to sign in with instead of your name.')}
    </div>
    <form onSubmit={submit} noValidate>
      <input
        className="input"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder={t('E-mail (optional)')}
        maxLength={254}
        value={email}
        onChange={e => setEmail(e.target.value)}
        {...field}
      />
      <div className="dim small" style={{ marginTop: 6 }}>{t('Lets you sign in with it instead of your name.')}</div>
      <div style={{ height: 10 }} />
      <input
        className="input"
        type="password"
        name="new-password"
        autoComplete="new-password"
        placeholder={t('Password')}
        value={pw}
        onChange={e => setPw(e.target.value)}
      />
      <div style={{ height: 10 }} />
      <input
        className="input"
        type="password"
        name="new-password-again"
        autoComplete="new-password"
        placeholder={t('Repeat the password')}
        value={again}
        onChange={e => setAgain(e.target.value)}
      />
      <div className="dim small" style={{ marginTop: 6 }}>{t('At least {0} characters. A few unrelated words make a good one.', MIN_PASSWORD)}</div>
      {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
      <div style={{ height: 12 }} />
      <Button type="submit" variant="primary" disabled={busy}>{t('Link password')}</Button>
    </form>
    <div style={{ height: 8 }} />
    <Button type="button" variant="ghost" className="dim" onClick={() => setStep('prove')}>{t('Back')}</Button>
  </>
}

// Sheet for linking a passkey to the account
function LinkPasskeySheet({ state, close, done }) {
  const [name, setName] = useState('')
  const [ready, setReady] = useState(null)  // { cid, options } once the proof went through
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const hasPasskeys = state.providers?.some(p => p.provider === 'passkey')
  const hasPassword = state.providers?.some(p => p.provider === 'password')

  const create = async () => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const credential = await createPasskey(ready.options)
      await post('/api/account/passkeys/verify', { cid: ready.cid, credential, name })
      close()
      done()
      toast(t('Passkey linked'))
    } catch (e) {
      if (dismissed(e)) { setBusy(false); return }
      setErr(passwordError(e))
      // The server spent the challenge on that answer: a retry starts from the proof again.
      if (e?.status) setReady(null)
    } finally {
      setBusy(false)
    }
  }

  return <>
    <h3>{t('Link passkey')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {ready
        ? t('Confirmed. Now create the new passkey; your browser will ask where to keep it.')
        : t('Add a passkey to this account for faster sign-in. First confirm that it is you.')}
    </div>
    <input
      className="input"
      placeholder={t('Name, e.g. Work laptop')}
      maxLength={40}
      value={name}
      onChange={e => setName(e.target.value)}
    />
    <div style={{ height: 12 }} />
    {ready ? (
      <Button variant="primary" icon="fingerprint" disabled={busy} onClick={create}>{t('Create passkey')}</Button>
    ) : (
      <ProveOwner
        passkey={hasPasskeys}
        password={hasPassword}
        explain={passwordError}
        onProof={async proof => setReady(await post('/api/account/passkeys/options', proof))}
      />
    )}
    {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
    <div style={{ height: 8 }} />
    <Button type="button" variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export default LinkedAccountsSheet
