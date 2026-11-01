// Linked authentication methods: shows which methods (passkey, password, google) are linked to
// this account, allows unlinking and adding new methods. Used in Settings → Account.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { dateLocale } from '../lib/i18n-core.js'
import { api, getLinkedProviders, unlinkProvider, webauthnOK } from '../lib/api.js'
import { passwordError, notReached, useAgainOnceReached, ProveOwner } from './PasswordAuth.jsx'
import { Row, Button } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const errStyle = { color: 'var(--red)', marginTop: 10 }

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
  const done = r => { if (r?.providers) set(r); else load(); changed?.() }

  if (!st) return <><h3>{t('Linked accounts')}</h3><div className="muted small">…</div></>

  const providers = st.providers || []

  const edit = p => ui().openSheet(c => (
    <ProviderDetailSheet provider={p} state={st} close={c} done={done} />
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

export default LinkedAccountsSheet
