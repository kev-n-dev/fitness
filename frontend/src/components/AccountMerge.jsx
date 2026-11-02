// Account merging: merge another account into the current one, combining all auth methods
// and data. Used in Settings → Account.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { api, mergeAccount } from '../lib/api.js'
import { passwordError, MIN_PASSWORD } from './PasswordAuth.jsx'
import { Row, Button } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const errStyle = { color: 'var(--red)', marginTop: 10 }
const field = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }

// Settings row to access account merge
export function AccountMergeRow() {
  return (
    <Row
      icon="merge"
      iconTint="var(--indigo)"
      title={t('Merge accounts')}
      accessory="chevron"
      subtitle={t('Combine another account into this one.')}
      onClick={() => ui().openSheet(close => <AccountMergeSheet close={close} />)}
    />
  )
}

// Multi-step merge sheet
export function AccountMergeSheet({ close }) {
  const user = useStore(s => s.user)
  const [step, setStep] = useState('intro')  // 'intro' | 'source' | 'confirm' | 'done'
  const [sourceIdentifier, setSourceIdentifier] = useState('')
  const [sourcePassword, setSourcePassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [merged, setMerged] = useState(null)

  const doMerge = async () => {
    if (busy) return
    const identifier = sourceIdentifier.trim()
    if (!identifier) {
      setErr(t('Enter the name or e-mail of the account to merge.'))
      return
    }
    if (!sourcePassword) {
      setErr(t('Enter the password for that account.'))
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const r = await mergeAccount({
        identifier,
        password: sourcePassword,
      })
      setMerged(r.merged)
      setStep('done')
    } catch (e) {
      setErr(passwordError(e))
    } finally {
      setBusy(false)
    }
  }

  // Step 1: Introduction and warnings
  if (step === 'intro') {
    return <>
      <h3>{t('Merge accounts')}</h3>
      <div className="muted small" style={{ marginBottom: 14 }}>
        {t('Merging brings another account into this one. All passkeys, data, and settings from the other account will be moved here.')}
      </div>
      <div className="card small" style={{ textAlign: 'start', marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('What happens:')}</div>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>{t('The other account\'s passkeys become yours')}</li>
          <li>{t('All workout data is combined')}</li>
          <li>{t('The other account is deleted')}</li>
        </ul>
      </div>
      <div className="card small" style={{ textAlign: 'start', marginBottom: 14, background: 'var(--red-bg)', border: '1px solid var(--red)' }}>
        <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>{t('Warning:')}</div>
        <div>{t('This cannot be undone. Make sure you are merging the right account.')}</div>
      </div>
      <Button variant="primary" onClick={() => setStep('source')}>{t('Continue')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" onClick={close}>{t('Cancel')}</Button>
    </>
  }

  // Step 2: Enter source account credentials
  if (step === 'source') {
    return <>
      <h3>{t('Sign in to the other account')}</h3>
      <div className="muted small" style={{ marginBottom: 14 }}>
        {t('Enter the name (or e-mail) and password of the account you want to merge into "{0}".', user?.name || 'this account')}
      </div>
      <form onSubmit={e => { e.preventDefault(); setStep('confirm') }} noValidate>
        <input
          className="input"
          name="source-identifier"
          autoComplete="username"
          placeholder={t('Name or e-mail of other account')}
          maxLength={254}
          value={sourceIdentifier}
          onChange={e => setSourceIdentifier(e.target.value)}
          {...field}
        />
        <div style={{ height: 10 }} />
        <input
          className="input"
          type="password"
          name="source-password"
          autoComplete="current-password"
          placeholder={t('Password of other account')}
          value={sourcePassword}
          onChange={e => setSourcePassword(e.target.value)}
        />
        {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
        <div style={{ height: 12 }} />
        <Button type="submit" variant="primary">{t('Continue')}</Button>
      </form>
      <div style={{ height: 8 }} />
      <Button variant="ghost" onClick={() => { setStep('intro'); setErr(null) }}>{t('Back')}</Button>
    </>
  }

  // Step 3: Final confirmation
  if (step === 'confirm') {
    return <>
      <h3>{t('Confirm merge')}</h3>
      <div className="muted small" style={{ marginBottom: 14 }}>
        {t('You are about to merge the account "{0}" into "{1}".', sourceIdentifier.trim(), user?.name || 'this account')}
      </div>
      <div className="card small" style={{ textAlign: 'start', marginBottom: 14, background: 'var(--red-bg)', border: '1px solid var(--red)' }}>
        <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>{t('This is irreversible!')}</div>
        <div>{t('The account "{0}" will be deleted after merging. All its passkeys and data will be moved to "{1}".', sourceIdentifier.trim(), user?.name || 'this account')}</div>
      </div>
      {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
      <Button variant="danger" disabled={busy} onClick={doMerge}>
        {busy ? t('Merging…') : t('Merge accounts')}
      </Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" onClick={() => { setStep('source'); setErr(null) }}>{t('Back')}</Button>
    </>
  }

  // Step 4: Success
  if (step === 'done') {
    return <>
      <h3>{t('Accounts merged')}</h3>
      <div className="muted small" style={{ marginBottom: 14 }}>
        {t('The account "{0}" has been merged into "{1}". All passkeys and data have been combined.', merged?.name || sourceIdentifier.trim(), user?.name || 'this account')}
      </div>
      <Button variant="primary" onClick={() => { close(); toast(t('Accounts merged successfully')) }}>
        {t('Done')}
      </Button>
    </>
  }

  return null
}

export default AccountMergeSheet
