// Sign-in gate: wallet (SIWE) or Google, with the device-minted Arc wallet that
// Google accounts get. Also the place where the player picks their language.
import { useCallback, useEffect, useRef, useState } from 'react'
import {Check, Copy, Globe, KeyRound, Loader2, LogOut, Wallet as WalletIcon} from 'lucide-react'
import { useLang, useT, setLang, type Lang } from '../../lib/i18n'
import { MochiroLogo } from './MochiroLogo'
import {
  chainConfig,
  createLocalWallet,
  googleClientId,
  googleIdentity,
  hasLocalWallet,
  linkMessage,
  loadGoogleIdentity,
  localWalletAddress,
  rememberGoogleClientId,
  signInWithGoogle,
  signInWithWallet,
  shortAddress,
  unlockLocalWallet,
  walletLabel,
  injectedProvider,
  type AuthAccount,
} from '../../lib/auth'

type Step =
  | { name: 'choose' }
  | { name: 'google-setup' }
  | { name: 'create'; credential: string; email: string | null }
  | { name: 'reveal'; credential: string; email: string | null; address: string; privateKey: string }
  | { name: 'unlock'; credential: string; email: string | null }
  | { name: 'busy'; what: 'google' | 'wallet' | 'link' }

function LangSwitch() {
  const lang = useLang()
  const t = useT()
  const options: { id: Lang; label: string; flag: string }[] = [
    { id: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
    { id: 'en', label: 'English', flag: '🇬🇧' },
  ]
  return (
    <div className="ar-lang" role="group" aria-label={t('lang.label')}>
      <Globe size={14} className="ar-lang-icon" />
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`ar-lang-btn ${lang === option.id ? 'is-active' : ''}`}
          onClick={() => setLang(option.id)}
        >
          <span aria-hidden>{option.flag}</span> {option.label}
        </button>
      ))}
    </div>
  )
}

export function AuthGate({
  onSignedIn,
  onGuest,
  onDismiss,
}: {
  onSignedIn: (account: AuthAccount) => void
  onGuest: () => void
  /**
   * Set only when the gate is opened *over* something — the menu. At startup there is
   * nothing behind it, so there is nothing to go back to and a click outside must not
   * dismiss it. Given a dismiss handler, the backdrop becomes a way out like any panel.
   */
  onDismiss?: () => void
}) {
  const t = useT()
  const [step, setStep] = useState<Step>({ name: 'choose' })
  const [password, setPassword] = useState('')
  const [clientIdInput, setClientIdInput] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const googleButton = useRef<HTMLDivElement>(null)
  const credentialRef = useRef<string>('')
  const emailRef = useRef<string | null>(null)
  const googleReady = Boolean(googleClientId())
  const wallet = injectedProvider()
  const label = walletLabel()

  const finish = useCallback(
    (account: AuthAccount) => {
      onSignedIn(account)
    },
    [onSignedIn]
  )

  /** Take a Google credential the rest of the way: unlock or mint the device wallet. */
  const handleCredential = useCallback(
    async (credential: string, email: string | null) => {
      credentialRef.current = credential
      emailRef.current = email
      setError('')
      if (hasLocalWallet()) {
        setStep({ name: 'unlock', credential, email })
        return
      }
      // Ask the server whether this Google account already owns a wallet.
      setStep({ name: 'busy', what: 'google' })
      try {
        const result = await signInWithGoogle(credential)
        if (result.account) finish(result.account)
        else setStep({ name: 'create', credential, email })
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : t('auth.error'))
        setStep({ name: 'choose' })
      }
    },
    [finish, t]
  )

  useEffect(() => {
    if (!googleReady || step.name !== 'choose') return
    let cancelled = false
    void loadGoogleIdentity().then((loaded) => {
      if (cancelled || !loaded) return
      const identity = googleIdentity()
      const target = googleButton.current
      const id = googleClientId()
      if (!identity?.accounts?.id || !target || !id) return
      identity.accounts.id.initialize({
        client_id: id,
        callback: (response) => {
          if (!response.credential) return
          const payload = response.credential.split('.')[1]
          let email: string | null = null
          try {
            email = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).email ?? null
          } catch {
            email = null
          }
          void handleCredential(response.credential, email)
        },
      })
      target.innerHTML = ''
      identity.accounts.id.renderButton(target, {
        theme: 'filled_blue',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: Math.min(target.clientWidth || 320, 360),
      })
    })
    return () => {
      cancelled = true
    }
  }, [googleReady, step.name, handleCredential])

  const connectWallet = async () => {
    setError('')
    setStep({ name: 'busy', what: 'wallet' })
    try {
      const account = await signInWithWallet()
      finish(account)
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : ''
      setError(message === 'no-wallet' ? t('auth.noWallet') : message || t('auth.error'))
      setStep({ name: 'choose' })
    }
  }

  const submitCreate = async () => {
    if (step.name !== 'create') return
    setError('')
    setStep({ name: 'busy', what: 'link' })
    try {
      const created = await createLocalWallet(password)
      setStep({ name: 'reveal', credential: step.credential, email: step.email, address: created.address, privateKey: created.privateKey })
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : ''
      setError(message === 'weak-password' ? t('auth.passwordHint') : t('auth.error'))
      setStep({ name: 'create', credential: step.credential, email: step.email })
    }
  }

  /** Sign the link message with the device key and register it with the server. */
  const linkWallet = async (credential: string, privateKeyPassword: string) => {
    const unlocked = await unlockLocalWallet(privateKeyPassword)
    if (!unlocked) return false
    const config = await chainConfig()
    const message = linkMessage(unlocked.address, emailRef.current, config.chainId)
    const signature = await unlocked.signMessage(message)
    const result = await signInWithGoogle(credential, {
      address: unlocked.address,
      message,
      signature,
    })
    if (result.account) {
      finish(result.account)
      return true
    }
    return false
  }

  const submitUnlock = async () => {
    if (step.name !== 'unlock') return
    setError('')
    setStep({ name: 'busy', what: 'link' })
    try {
      const ok = await linkWallet(step.credential, password)
      if (!ok) {
        setError(t('auth.wrongPassword'))
        setStep({ name: 'unlock', credential: step.credential, email: step.email })
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : t('auth.error'))
      setStep({ name: 'unlock', credential: step.credential, email: step.email })
    }
  }

  const revealDone = async () => {
    if (step.name !== 'reveal') return
    setError('')
    setStep({ name: 'busy', what: 'link' })
    try {
      const ok = await linkWallet(step.credential, password)
      if (!ok) {
        setError(t('auth.error'))
        setStep({ name: 'choose' })
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : t('auth.error'))
      setStep({ name: 'choose' })
    }
  }

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — the key is on screen anyway */
    }
  }

  return (
    <div
      className="ar-screen"
      onClick={(event) => {
        if (!onDismiss) return
        if (event.target === event.currentTarget) onDismiss()
      }}
    >
      <div className="ar-panel ar-auth">
        <div className="ar-auth-bar">
          <LangSwitch />
        </div>

        <header className="ar-auth-head">
          <span className="ar-auth-mark">
            <MochiroLogo size={60} />
          </span>
          <h1 className="ar-auth-title">{t('auth.title')}</h1>
          <p className="ar-auth-sub">{t('auth.subtitle')}</p>
        </header>

        {step.name === 'choose' && (
          <>
            {googleReady ? (
              <div className="ar-google-slot" ref={googleButton} />
            ) : (
              <button className="ar-btn ar-btn-primary py-4 text-[15px]" onClick={() => setStep({ name: 'google-setup' })}>
                <GoogleMark /> {t('auth.google')}
              </button>
            )}

            <div className="ar-auth-or">
              <span>{t('auth.or')}</span>
            </div>

            <button className="ar-btn py-4 text-[15px]" onClick={() => void connectWallet()} disabled={!wallet}>
              <WalletIcon size={16} />
              {wallet ? `${t('auth.wallet')} — ${label}` : t('auth.wallet')}
            </button>
            <div className="ar-hint mt-2 text-left">{wallet ? t('auth.walletOnly') : t('auth.noWallet')}</div>

            {error ? <div className="ar-auth-error">{error}</div> : null}

            <button className="ar-guest" onClick={onGuest}>
              {t('auth.skip')}
            </button>
            <div className="ar-hint">{t('auth.guestNote')}</div>
          </>
        )}

        {step.name === 'google-setup' && (
          <>
            <div className="ar-hint text-left">{t('auth.googleUnconfigured')}</div>
            <input
              className="ar-input mt-2"
              value={clientIdInput}
              onChange={(event) => setClientIdInput(event.target.value)}
              placeholder="1234567890-xxxxxxxx.apps.googleusercontent.com"
              spellCheck={false}
            />
            <div className="ar-menu-row mt-3">
              <button
                className="ar-btn ar-btn-primary"
                onClick={() => {
                  rememberGoogleClientId(clientIdInput)
                  window.location.reload()
                }}
                disabled={!clientIdInput.endsWith('.apps.googleusercontent.com')}
              >
                {t('auth.google')}
              </button>
              <button className="ar-btn" onClick={() => setStep({ name: 'choose' })}>
                {t('board.close')}
              </button>
            </div>
          </>
        )}

        {step.name === 'create' && (
          <>
            <div className="ar-auth-step">{t('auth.createTitle')}</div>
            <div className="ar-hint text-left">{t('auth.createNote')}</div>
            <input
              className="ar-input mt-3"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('auth.password')}
            />
            <div className="ar-hint mt-1 text-left">{t('auth.passwordHint')}</div>
            {error ? <div className="ar-auth-error">{error}</div> : null}
            <button className="ar-btn ar-btn-primary mt-3 py-3" onClick={() => void submitCreate()} disabled={password.length < 8}>
              <KeyRound size={15} /> {t('auth.create')}
            </button>
          </>
        )}

        {step.name === 'unlock' && (
          <>
            <div className="ar-auth-step">{t('auth.unlock')}</div>
            <div className="ar-hint text-left">
              {t('auth.unlockNote')} <span className="ar-mono">{shortAddress(localWalletAddress())}</span>
            </div>
            <input
              className="ar-input mt-3"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('auth.password')}
            />
            {error ? <div className="ar-auth-error">{error}</div> : null}
            <button className="ar-btn ar-btn-primary mt-3 py-3" onClick={() => void submitUnlock()} disabled={password.length < 1}>
              <KeyRound size={15} /> {t('auth.unlock')}
            </button>
          </>
        )}

        {step.name === 'reveal' && (
          <>
            <div className="ar-auth-step">{t('auth.keyTitle')}</div>
            <div className="ar-hint text-left">{t('auth.keyNote')}</div>
            <div className="ar-key-box">
              <code>{step.privateKey}</code>
              <button className="ar-btn ar-btn-mini" onClick={() => void copyKey(step.privateKey)}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('auth.copied') : t('auth.copy')}
              </button>
            </div>
            <div className="ar-hint text-left">
              {t('auth.signedIn')}: <span className="ar-mono">{step.address}</span>
            </div>
            <button className="ar-btn ar-btn-primary mt-3 py-3" onClick={() => void revealDone()}>
              <Check size={15} /> {t('auth.keySaved')}
            </button>
          </>
        )}

        {step.name === 'busy' && (
          <div className="ar-auth-busy">
            <Loader2 size={22} className="ar-spin" />
            <span>
              {step.what === 'wallet' ? t('auth.signing') : step.what === 'link' ? t('auth.connecting') : t('auth.connecting')}
            </span>
          </div>
        )}

        <div className="ar-auth-foot">
          <span>Arc Testnet · 5042002</span>
          <span className="ar-mono">{hasLocalWallet() ? shortAddress(localWalletAddress()) : '—'}</span>
        </div>
      </div>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.1-11.3-7.6l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41 35.4 44 30.1 44 24c0-1.3-.1-2.7-.4-4z" />
    </svg>
  )
}

/** Compact account chip for the menu header. */
export function AccountChip({ account, onSignOut }: { account: AuthAccount; onSignOut: () => void }) {
  const t = useT()
  return (
    <div className="ar-account">
      <span className={`ar-account-dot ${account.method === 'google' ? 'is-google' : 'is-wallet'}`} />
      <span className="ar-account-text">
        {account.email ? <strong>{account.email}</strong> : null}
        <span className="ar-mono">{shortAddress(account.address)}</span>
      </span>
      <button className="ar-btn ar-btn-mini" onClick={onSignOut} title={t('auth.logout')}>
        <LogOut size={13} />
      </button>
    </div>
  )
}
