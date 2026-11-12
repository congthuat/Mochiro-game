// Sign-in gate: wallet (SIWE) or Google, with the device-minted Arc wallet that
// Google accounts get. Also the place where the player picks their language.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Globe, KeyRound, Loader2, LogOut, ShieldCheck, Wallet as WalletIcon, UserPlus, X} from 'lucide-react'
import { formatNumber, useLang, useT, setLang, type Lang } from '../../lib/i18n'
import { MochiroLogo } from './MochiroLogo'
import { inAppBrowser, nativeBrowserName, openInBrowserHref } from '../../lib/inAppBrowser'
import { QRCodeSVG } from 'qrcode.react'
import { WC_WALLETS, connectWallet as connectViaWalletConnect, isMobile, walletConnectReady, type WcWallet } from '../../lib/walletConnect'
import { STORE_LINKS, WALLET_CATALOG, catalogWallet } from '../../lib/walletCatalog'
import { foundWallets, providerFor, rescanWallets, subscribeWallets, watchWallets } from '../../lib/walletProviders'
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
  type AuthAccount,
} from '../../lib/auth'

type Step =
  | { name: 'choose' }
  | { name: 'wallet' }
  | { name: 'google-setup' }
  | { name: 'create'; credential: string; email: string | null }
  | { name: 'reveal'; credential: string; email: string | null; address: string; privateKey: string }
  | { name: 'unlock'; credential: string; email: string | null }
  | { name: 'busy'; what: 'google' | 'wallet' | 'link' }

/** Server render: no browser, no wallets. One shared array so React sees a stable snapshot. */
const noWallets = (): ReturnType<typeof foundWallets> => NO_WALLETS
const NO_WALLETS: ReturnType<typeof foundWallets> = []

/** A wallet's own mark. Decorative — the name sits beside it. */
function WalletMark({ logo }: { logo: string | null }) {
  if (!logo) {
    return (
      <span className="ar-pick-logo">
        <WalletIcon size={16} />
      </span>
    )
  }
  return (
    <span className="ar-pick-logo">
      <img src={`${import.meta.env.BASE_URL}wallets/${logo}`} alt="" width={26} height={26} loading="lazy" decoding="async" />
    </span>
  )
}

function LangSwitch() {
  const lang = useLang()
  const t = useT()
  // No flag emoji: Windows has none, and draws "VN" / "GB" in their place.
  const options: { id: Lang; label: string }[] = [
    { id: 'vi', label: 'Tiếng Việt' },
    { id: 'en', label: 'English' },
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
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function AuthGate({
  onSignedIn,
  onGuest,
  onDismiss,
  inviteFrom,
}: {
  onSignedIn: (account: AuthAccount) => void
  onGuest: () => void
  /** Who sent the invite link this visitor arrived through, if anyone. */
  inviteFrom?: { name: string; welcome: number } | null
  /**
   * Set only when the gate is opened *over* something — the menu. At startup there is
   * nothing behind it, so there is nothing to go back to and a click outside must not
   * dismiss it. Given a dismiss handler, the backdrop becomes a way out like any panel.
   */
  onDismiss?: () => void
}) {
  const t = useT()
  const appBrowser = inAppBrowser()
  const isCoccoc = typeof navigator !== 'undefined' && /CocCoc/i.test(navigator.userAgent)
  const browserHref = openInBrowserHref()
  const [step, setStep] = useState<Step>({ name: 'choose' })
  const [password, setPassword] = useState('')
  const [clientIdInput, setClientIdInput] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [pairing, setPairing] = useState<string | null>(null)
  const [qrUri, setQrUri] = useState<string | null>(null)
  /** Bumped whenever the player leaves a pairing, so a late answer cannot sign them in. */
  const pairToken = useRef(0)
  const googleButton = useRef<HTMLDivElement>(null)
  const credentialRef = useRef<string>('')
  const emailRef = useRef<string | null>(null)
  /**
   * Whether Google can be offered at all. The id can come from the build, from a value the
   * player pasted here, or — for the deployed site — from the backend, which is only known
   * after a request. Held in state so the button appears once that answer arrives rather than
   * showing the "paste your own id" screen to everyone on a correctly configured deployment.
   */
  const [clientId, setClientId] = useState<string | null>(() => googleClientId())
  /** Wallets announce themselves; this is the live answer, not a snapshot taken once. */
  const installed = useSyncExternalStore(subscribeWallets, foundWallets, noWallets)
  /** Wallets already in this browser come first. */
  const ordered = [...WALLET_CATALOG].sort(
    (a, b) => Number(installed.some((f) => f.kind === b.kind)) - Number(installed.some((f) => f.kind === a.kind)),
  )
  const googleReady = Boolean(clientId)

  useEffect(() => {
    watchWallets()
    let alive = true
    void chainConfig().then(() => {
      if (alive) setClientId(googleClientId())
    })
    return () => {
      alive = false
    }
  }, [])

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

  /** A wallet that announced itself: the provider is already here, nothing to pair. */
  const connectInstalled = async (kind: string) => {
    const provider = providerFor(kind)
    if (!provider) return
    setError('')
    setStep({ name: 'busy', what: 'wallet' })
    try {
      finish(await signInWithWallet(provider))
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : ''
      setError(message || t('auth.error'))
      setStep({ name: 'choose' })
    }
  }

  /** Same sign-in, different way of obtaining the provider — paired over WalletConnect. */
  const connectViaApp = async (wallet: WcWallet) => {
    const token = (pairToken.current += 1)
    setError('')
    setPairing(wallet.id)
    setQrUri(null)
    try {
      const provider = await connectViaWalletConnect(wallet, (uri) => {
        if (pairToken.current === token) setQrUri(uri)
      })
      if (pairToken.current !== token) return
      finish(await signInWithWallet(provider))
    } catch (issue) {
      if (pairToken.current !== token) return
      const message = issue instanceof Error ? issue.message : ''
      const friendly: Record<string, string> = {
        'wc-origin': t('pick.wcErrOrigin'),
        'wc-timeout': t('pick.wcErrTimeout'),
        'wc-expired': t('pick.wcErrExpired'),
      }
      setError(friendly[message] || message || t('auth.error'))
    } finally {
      if (pairToken.current === token) {
        setPairing(null)
        setQrUri(null)
      }
    }
  }

  /** Leaving the picker abandons any pairing in flight. */
  const leaveWalletStep = () => {
    pairToken.current += 1
    setPairing(null)
    setQrUri(null)
    setError('')
    setStep({ name: 'choose' })
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
        </header>

        {inviteFrom && step.name === 'choose' && (
          <div className="ar-invite-banner is-static">
            <UserPlus size={16} />
            <span>{t('invite.banner', { name: inviteFrom.name, n: formatNumber(inviteFrom.welcome) })}</span>
          </div>
        )}

        {step.name === 'choose' && (
          <>
            {appBrowser && (
              <div className="ar-auth-inapp">
                <AlertTriangle size={15} className="ar-auth-inapp-icon" />
                <div className="ar-auth-inapp-text">
                  <p className="ar-auth-inapp-title">{t('auth.inAppTitle')}</p>
                  <p className="ar-auth-inapp-body">{t('auth.inAppBody')}</p>
                  {browserHref && (
                    <a className="ar-auth-inapp-open" href={browserHref}>
                      {t('auth.openIn')} {nativeBrowserName()} <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="ar-pick-head">
              <span className="ar-pick-title">{t('auth.wallet')}</span>
              {onDismiss && (
                <button type="button" className="ar-pick-icon-btn" onClick={onDismiss} aria-label={t('board.close')}>
                  <X size={15} />
                </button>
              )}
            </div>

            {googleReady ? (
              <div className="ar-google-slot" ref={googleButton} />
            ) : (
              <button className="ar-btn ar-btn-primary py-4 text-[15px]" onClick={() => setStep({ name: 'google-setup' })}>
                <GoogleMark /> {t('auth.google')}
              </button>
            )}
            <p className="ar-pick-note">{t('pick.googleNote')}</p>

            <div className="ar-pick-label">{t('pick.more')}</div>
            <div className="ar-pick-grid">
              {ordered.map((wallet) => {
                const here = installed.some((found) => found.kind === wallet.kind)
                return here ? (
                  <button
                    key={wallet.kind}
                    type="button"
                    className="ar-pick-card"
                    disabled={pairing !== null}
                    onClick={() => void connectInstalled(wallet.kind)}
                  >
                    <WalletMark logo={wallet.logo} />
                    <span className="ar-pick-text">
                      <span className="ar-pick-name">{wallet.name}</span>
                      <span className="ar-pick-sub">{t('pick.detected')}</span>
                    </span>
                  </button>
                ) : (
                  <a
                    key={wallet.kind}
                    className="ar-pick-card"
                    href={wallet.installUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <WalletMark logo={wallet.logo} />
                    <span className="ar-pick-text">
                      <span className="ar-pick-name">{wallet.name}</span>
                      <span className="ar-pick-sub ar-pick-sub-link">
                        {t('pick.install')} <ExternalLink size={10} />
                      </span>
                    </span>
                  </a>
                )
              })}
            </div>

            {walletConnectReady() && (
              <button type="button" className="ar-pick-wide" onClick={() => setStep({ name: 'wallet' })}>
                <WalletMark logo="walletconnect.svg" />
                <span className="ar-pick-text">
                  <span className="ar-pick-name">{t('pick.wcTitle')}</span>
                  <span className="ar-pick-sub">{t('pick.wcHint')}</span>
                </span>
                <ChevronRight size={16} className="ar-pick-chevron" />
              </button>
            )}

            {installed.length === 0 && (
              <div className="ar-pick-help">
                <p className="ar-pick-help-title">{t('pick.noWalletTitle')}</p>
                <p className="ar-pick-help-body">{'\u2022'} {t('pick.tipBrowser')}</p>
                {isCoccoc && <p className="ar-pick-help-body">{'\u2022'} {t('pick.coccoc')}</p>}
                <div className="ar-pick-help-links">
                  {STORE_LINKS.map((kind) => {
                    const wallet = catalogWallet(kind)
                    if (!wallet) return null
                    return (
                      <a
                        key={kind}
                        className="ar-pick-help-link"
                        href={wallet.installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {wallet.name} {'\u00b7'} {t('pick.store')} <ExternalLink size={10} />
                      </a>
                    )
                  })}
                </div>
                <div className="ar-pick-help-actions">
                  <button type="button" className="ar-pick-mini" onClick={() => rescanWallets()}>
                    {t('pick.rescan')}
                  </button>
                  <button type="button" className="ar-pick-mini" onClick={() => window.location.reload()}>
                    {t('pick.reload')}
                  </button>
                </div>
              </div>
            )}

            {error ? <div className="ar-auth-error">{error}</div> : null}

            <button className="ar-guest" onClick={onGuest}>
              {t('auth.skip')}
            </button>
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

        {step.name === 'wallet' && (
          <div className="ar-pick">
            <div className="ar-pick-head">
              <button type="button" className="ar-pick-icon-btn" onClick={leaveWalletStep} aria-label={t('auth.back')}>
                <ChevronLeft size={16} />
              </button>
              <span className="ar-pick-title">{t('pick.wcTitle')}</span>
              <button type="button" className="ar-pick-icon-btn" onClick={leaveWalletStep} aria-label={t('auth.back')}>
                <X size={15} />
              </button>
            </div>

            {qrUri ? (
              /* A desktop has no wallet app to open, so the phone becomes the wallet. */
              <div className="ar-pick-qr">
                <div className="ar-pick-qr-code">
                  <QRCodeSVG value={qrUri} size={168} marginSize={2} level="M" />
                </div>
                <p className="ar-pick-qr-note">{t('auth.scanQr')}</p>
                <button
                  type="button"
                  className="ar-pick-mini"
                  onClick={() => {
                    pairToken.current += 1
                    setPairing(null)
                    setQrUri(null)
                  }}
                >
                  {t('pick.wcRetry')}
                </button>
              </div>
            ) : (
              <>
                <p className="ar-pick-sub" aria-live="polite">
                  {pairing ? t('pick.wcPreparing') : t('pick.wcHint')}
                </p>
                <div className="ar-pick-grid">
                  {WC_WALLETS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="ar-pick-card"
                      disabled={pairing !== null}
                      onClick={() => void connectViaApp(option)}
                    >
                      {pairing === option.id ? (
                        <span className="ar-pick-logo">
                          <Loader2 size={16} className="ar-spin" />
                        </span>
                      ) : (
                        <WalletMark logo={option.logo} />
                      )}
                      <span className="ar-pick-text">
                        <span className="ar-pick-name">{option.name}</span>
                        <span className="ar-pick-sub">{isMobile() ? t('pick.openApp') : t('pick.scanShort')}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <p className="ar-pick-safety">
              <ShieldCheck size={13} /> {t('pick.safety')}
            </p>

            <details className="ar-pick-tips">
              <summary className="ar-pick-tips-summary">{t('pick.helpTitle')}</summary>
              <ul className="ar-pick-tips-list">
                <li>{t('pick.tipUnlock')}</li>
                <li>{t('pick.tipPopup')}</li>
                <li>{t('pick.tipConflict')}</li>
                <li>{t('pick.tipNetwork')}</li>
              </ul>
            </details>

            {error ? <div className="ar-auth-error">{error}</div> : null}
          </div>
        )}

        {step.name === 'busy' && (
          <div className="ar-auth-busy">
            <Loader2 size={22} className="ar-spin" />
            <span>
              {step.what === 'wallet' ? t('auth.signing') : step.what === 'link' ? t('auth.connecting') : t('auth.connecting')}
            </span>
          </div>
        )}

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
