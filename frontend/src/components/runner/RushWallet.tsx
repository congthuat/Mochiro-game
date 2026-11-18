// Mochiro wallet on Arc testnet: balance, top up Arc with USDC, receive, send, activity.
// Signing stays in the browser (device wallet unlocked by password, or the player's own wallet app);
// the server only credits Arc after reading the payment from Arc itself.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  Coins,
  Copy,
  Droplets,
  ExternalLink,
  FileCode2,
  KeyRound,
  Loader2,
  RefreshCw,
  Share2,
  ShieldCheck,
  Wallet as WalletIcon,
  Zap,
} from 'lucide-react'
import { formatNumber, useLang, useT } from '../../lib/i18n'
import { shortAddress, type AuthAccount, type Eip1193 } from '../../lib/auth'
import { copyText } from '../../lib/shareCard'
import { foundWallets, subscribeWallets, watchWallets, type FoundWallet } from '../../lib/walletProviders'
import { INJECTED_LOGOS, WC_WALLETS, connectWallet, isMobile, openWalletApp, resumeWalletConnect, walletConnectReady, type WcWallet } from '../../lib/walletConnect'
import {
  addPendingTopup,
  checkAddress,
  deviceHoldsKey,
  estimateFee,
  fallbackConfig,
  fetchWalletAccount,
  formatUsdc,
  loadPendingTopups,
  parseUsdc,
  removePendingTopup,
  sendFromAccount,
  shortUsdc,
  timeAgo,
  topupMemo,
  waitForTopup,
  waitReceipt,
  walletConfig,
  WalletError,
  type Signer,
  type WalletAccount,
  type WalletConfig,
  type WalletPack,
  type WalletTx,
} from '../../lib/arcWallet'
import { Backdrop, PanelHead } from './RushEconomy'

type Tab = 'topup' | 'receive' | 'send' | 'history'
type Purpose = { type: 'topup'; pack: WalletPack } | { type: 'send'; to: string; wei: bigint }
type Flow =
  | { name: 'idle' }
  | { name: 'confirm'; purpose: Purpose }
  | { name: 'busy'; purpose: Purpose; stage: 'sign' | 'unlock' | 'chain' | 'credit'; device: boolean; hash?: string }
  | { name: 'done'; purpose: Purpose; hash: string; credited?: number; slow?: boolean }
  | { name: 'failed'; purpose: Purpose; code: string; hash?: string }

/** Server codes that will never turn into a credit — drop the saved payment. */
const FINAL_CODES = new Set(['tx_used', 'tx_failed', 'wrong_chain', 'wrong_sender', 'wrong_recipient', 'amount_low', 'no_memo', 'tx_too_old', 'unknown_pack'])

const NO_WALLETS: FoundWallet[] = []
const noWallets = () => NO_WALLETS

/** wei → plain decimal (no grouping) so it can go back into an input. */
function plainUsdc(wei: bigint, digits = 6): string {
  if (wei <= 0n) return '0'
  const whole = wei / 10n ** 18n
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, digits).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

function WalletMark({ logo }: { logo: string | null | undefined }) {
  return (
    <span className="ar-pick-logo">
      {logo ? (
        <img src={`${import.meta.env.BASE_URL}wallets/${logo}`} alt="" width={26} height={26} loading="lazy" decoding="async" />
      ) : (
        <WalletIcon size={16} />
      )}
    </span>
  )
}

export function RushWallet({
  account,
  clientId,
  bank,
  onSignIn,
  onEconomyChanged,
  onClose,
}: {
  account: AuthAccount | null
  clientId: string
  bank: number | null
  onSignIn: () => void
  onEconomyChanged: () => void
  onClose: () => void
}) {
  const t = useT()
  const lang = useLang()
  const [config, setConfig] = useState<WalletConfig>(fallbackConfig)
  const [configReady, setConfigReady] = useState(false)
  const [data, setData] = useState<WalletAccount | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [tab, setTab] = useState<Tab>('topup')
  const [flow, setFlow] = useState<Flow>({ name: 'idle' })
  const [fee, setFee] = useState<bigint>(2_000_000_000_000_000n)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    let off = false
    walletConfig()
      .then((next) => {
        if (off) return
        setConfig(next)
        setConfigReady(true)
        void estimateFee(next, true).then((value) => !off && setFee(value))
      })
      .catch(() => !off && setConfigReady(false))
    return () => {
      off = true
    }
  }, [])

  const address = account?.address ?? null
  const load = useCallback(
    async (fresh = false) => {
      if (!address) return
      setLoadState((state) => (state === 'ok' ? 'ok' : 'loading'))
      try {
        const next = await fetchWalletAccount(address, fresh)
        if (!alive.current) return
        setData(next)
        setLoadState('ok')
      } catch {
        if (alive.current) setLoadState((state) => (state === 'ok' ? 'ok' : 'error'))
      }
    },
    [address]
  )

  useEffect(() => {
    void load()
  }, [load])

  // Finish any top-up that was paid but not credited (closed tab, flaky network…).
  useEffect(() => {
    if (!account) return
    const pending = loadPendingTopups(clientId)
    if (!pending.length) return
    let off = false
    setNote({ tone: 'info', text: t('wal.resuming') })
    void (async () => {
      let credited = 0
      for (const entry of pending) {
        const outcome = await waitForTopup(clientId, entry.hash, entry.pack, () => off, 20_000)
        if (outcome.status === 'confirmed') {
          removePendingTopup(entry.hash)
          credited += outcome.credited
        } else if (outcome.status === 'error' && FINAL_CODES.has(outcome.error)) {
          removePendingTopup(entry.hash)
        }
      }
      if (off) return
      if (credited > 0) {
        setNote({ tone: 'ok', text: t('wal.resumed', { n: formatNumber(credited) }) })
        onEconomyChanged()
        void load(true)
      } else {
        setNote(null)
      }
    })()
    return () => {
      off = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.address, clientId])

  const balance = data ? BigInt(data.wei) : null
  const canSign = account ? account.method === 'wallet' || deviceHoldsKey(account) : false
  const busy = flow.name === 'busy'

  const errText = (code: string) => {
    const key = `wal.err.${code}`
    const text = t(key)
    return text === key ? t('wal.err.generic') : text
  }

  const run = async (purpose: Purpose, signer: Signer) => {
    if (!account) return
    setNote(null)
    const device = signer.kind === 'device'
    setFlow({ name: 'busy', purpose, device, stage: device ? 'unlock' : 'sign' })
    let hash: string
    try {
      if (purpose.type === 'topup') {
        const wei = parseUsdc(purpose.pack.usdc)
        if (!wei || !config.treasury) throw new WalletError('network')
        hash = await sendFromAccount(account, signer, { to: config.treasury, wei, data: topupMemo(config, purpose.pack.id) }, config)
        addPendingTopup({ clientId, hash, pack: purpose.pack.id, at: Date.now() })
      } else {
        hash = await sendFromAccount(account, signer, { to: purpose.to, wei: purpose.wei }, config)
      }
    } catch (error) {
      if (!alive.current) return
      const code = error instanceof WalletError ? error.code : 'network'
      // A wrong password keeps the player on the confirm screen so they can retype it.
      if (code === 'bad-password' || code === 'rejected') {
        setFlow({ name: 'confirm', purpose })
        setNote({ tone: 'bad', text: errText(code) })
      } else {
        setFlow({ name: 'failed', purpose, code })
      }
      return
    }
    if (!alive.current) return
    setFlow({ name: 'busy', purpose, device, stage: 'chain', hash })
    const mined = await waitReceipt(config, hash, 60_000)
    if (!alive.current) return
    if (mined === false) {
      if (purpose.type === 'topup') removePendingTopup(hash)
      setFlow({ name: 'failed', purpose, code: 'tx_failed', hash })
      void load(true)
      return
    }
    if (purpose.type === 'send') {
      setFlow({ name: 'done', purpose, hash, slow: mined === null })
      void load(true)
      return
    }
    setFlow({ name: 'busy', purpose, device, stage: 'credit', hash })
    const outcome = await waitForTopup(clientId, hash, purpose.pack.id, () => !alive.current, 60_000)
    if (!alive.current) return
    if (outcome.status === 'confirmed') {
      removePendingTopup(hash)
      setFlow({ name: 'done', purpose, hash, credited: outcome.credited || purpose.pack.arc })
      onEconomyChanged()
    } else if (outcome.status === 'error' && outcome.error !== 'offline' && outcome.error !== 'server_error') {
      if (FINAL_CODES.has(outcome.error)) removePendingTopup(hash)
      setFlow({ name: 'failed', purpose, code: outcome.error, hash })
    } else {
      setFlow({ name: 'done', purpose, hash, slow: true })
    }
    void load(true)
  }

  const reset = () => {
    setFlow({ name: 'idle' })
    setNote(null)
  }

  const switchTab = (next: Tab) => {
    if (busy) return
    setTab(next)
    reset()
  }

  // --------------------------------------------------------------- signed out --
  if (!account) {
    return (
      <Backdrop onClose={onClose}>
        <div className="ar-panel ar-modal ar-wallet">
          <PanelHead icon={<WalletIcon size={15} className="mr-2 inline" />} title={t('wal.title')} onClose={onClose} />
          <div className="ar-wal-signin">
            <span className="ar-wal-signin-icon">
              <WalletIcon size={22} />
            </span>
            <p className="ar-row-name">{t('wal.signInTitle')}</p>
            <p className="ar-hint">{t('wal.signInBody')}</p>
            <button className="ar-btn ar-btn-primary" onClick={onSignIn}>
              {t('menu.signIn')}
            </button>
          </div>
        </div>
      </Backdrop>
    )
  }

  const explorerAddr = `${config.explorer}/address/${account.address}`

  return (
    <Backdrop onClose={() => !busy && onClose()}>
      <div className="ar-panel ar-modal ar-wallet">
        <PanelHead icon={<WalletIcon size={15} className="mr-2 inline" />} title={t('wal.title')} onClose={() => !busy && onClose()} />

        {/* ---------------------------------------------------------- balance card */}
        <div className="ar-wal-card">
          <div className="ar-wal-card-top">
            <span className="ar-wal-net">
              <span className="ar-wal-dot" /> {t('wal.network')}
            </span>
            <span className="ar-wal-ingame" title={t('wal.inGameTitle')}>
              <Coins size={12} /> {t('wal.inGame', { n: bank === null ? '—' : formatNumber(bank) })}
            </span>
            <button
              type="button"
              className="ar-wal-icon-btn"
              onClick={() => void load(true)}
              disabled={loadState === 'loading'}
              aria-label={t('wal.refresh')}
              title={t('wal.refresh')}
            >
              <RefreshCw size={14} className={loadState === 'loading' && data ? 'ar-spin' : ''} />
            </button>
          </div>
          <div className="ar-wal-balance-label">{t('wal.balance')}</div>
          {loadState === 'error' && !data ? (
            <div className="ar-wal-offline">
              <AlertTriangle size={14} /> {t('wal.unreachable')}
              <button className="ar-btn ar-btn-sm" onClick={() => void load(true)}>
                {t('wal.retry')}
              </button>
            </div>
          ) : (
            <div className="ar-wal-balance">
              {data ? formatUsdc(data.wei, 4) : <Loader2 size={20} className="ar-spin" />}
              <span className="ar-wal-unit">USDC</span>
            </div>
          )}
          <div className="ar-wal-card-foot">
            <button
              type="button"
              className="ar-wal-addr"
              onClick={async () => {
                if (await copyText(account.address)) setNote({ tone: 'ok', text: t('wal.copied') })
              }}
              title={t('wal.copy')}
            >
              <span>{shortAddress(account.address)}</span>
              <Copy size={12} />
            </button>
            <a className="ar-wal-link" href={explorerAddr} target="_blank" rel="noreferrer" title={t('wal.explorer')}>
              <ExternalLink size={12} /> {t('wal.explorerShort')}
            </a>
          </div>
        </div>

        <div className="ar-seg ar-wal-tabs" role="tablist">
          {(['topup', 'receive', 'send', 'history'] as Tab[]).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`ar-btn ar-btn-sm ${tab === id ? 'ar-seg-active' : ''}`}
              disabled={busy && tab !== id}
              onClick={() => switchTab(id)}
            >
              {t(`wal.tab.${id}`)}
            </button>
          ))}
        </div>

        {note && <div className={`ar-eco-note ${note.tone === 'bad' ? 'is-bad' : ''}`}>{note.text}</div>}

        <div className="ar-wal-body">
          {flow.name === 'busy' && <Progress flow={flow} config={config} />}
          {flow.name === 'done' && <Done flow={flow} config={config} onDone={reset} />}
          {flow.name === 'failed' && (
            <div className="ar-wal-result is-bad">
              <span className="ar-wal-result-icon">
                <AlertTriangle size={20} />
              </span>
              <p className="ar-row-name">{errText(flow.code)}</p>
              {flow.hash && (
                <a className="ar-wal-link" href={`${config.explorer}/tx/${flow.hash}`} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} /> {t('wal.viewTx')}
                </a>
              )}
              <button className="ar-btn" onClick={reset}>
                {t('wal.back')}
              </button>
            </div>
          )}

          {flow.name === 'idle' && tab === 'topup' && (
            <TopupPicker
              config={config}
              ready={configReady}
              onPick={(pack) => {
                setNote(null)
                setFlow({ name: 'confirm', purpose: { type: 'topup', pack } })
              }}
            />
          )}
          {flow.name === 'idle' && tab === 'receive' && (
            <Receive address={account.address} faucet={config.faucet} onCopied={() => setNote({ tone: 'ok', text: t('wal.copied') })} />
          )}
          {flow.name === 'idle' && tab === 'send' && (
            <SendForm
              self={account.address}
              balance={balance}
              fee={fee}
              disabled={!canSign}
              onReview={(to, wei) => {
                setNote(null)
                setFlow({ name: 'confirm', purpose: { type: 'send', to, wei } })
              }}
            />
          )}
          {flow.name === 'idle' && tab === 'history' && (
            <History data={data} loading={loadState === 'loading' && !data} config={config} lang={lang} self={account.address} />
          )}

          {flow.name === 'confirm' && (
            <Confirm
              purpose={flow.purpose}
              account={account}
              config={config}
              balance={balance}
              fee={fee}
              canSign={canSign}
              onBack={reset}
              onSign={(signer) => void run(flow.purpose, signer)}
            />
          )}

          {!canSign && (tab === 'topup' || tab === 'send') && flow.name !== 'busy' && (
            <p className="ar-wal-warn">
              <KeyRound size={13} /> {t('wal.noKey')}
            </p>
          )}
        </div>
      </div>
    </Backdrop>
  )
}

// ------------------------------------------------------------------ top up --
function TopupPicker({ config, ready, onPick }: { config: WalletConfig; ready: boolean; onPick: (pack: WalletPack) => void }) {
  const t = useT()
  return (
    <>
      <p className="ar-hint">
        {t('wal.topupHint')} {t('wal.gasNote')}
      </p>
      {!ready && !config.packs.length ? (
        <div className="ar-wal-loading">
          <Loader2 size={18} className="ar-spin" />
        </div>
      ) : (
        <div className="ar-wal-packs">
          {config.packs.map((pack) => (
            <button key={pack.id} type="button" className="ar-wal-pack" onClick={() => onPick(pack)}>
              {pack.bonus > 0 && <span className="ar-wal-pack-bonus">{t('wal.bonus', { n: pack.bonus })}</span>}
              <span className="ar-wal-pack-arc">
                <Coins size={15} /> {formatNumber(pack.arc)}
              </span>
              <span className="ar-wal-pack-usdc">{t('wal.payUsdc', { n: pack.usdc })}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

// ------------------------------------------------------------------ confirm --
function Confirm({
  purpose,
  account,
  config,
  balance,
  fee,
  canSign,
  onBack,
  onSign,
}: {
  purpose: Purpose
  account: AuthAccount
  config: WalletConfig
  balance: bigint | null
  fee: bigint
  canSign: boolean
  onBack: () => void
  onSign: (signer: Signer) => void
}) {
  const t = useT()
  const amount = purpose.type === 'topup' ? parseUsdc(purpose.pack.usdc) ?? 0n : purpose.wei
  const short = balance === null ? 0n : amount + fee - balance
  const amountText = purpose.type === 'topup' ? purpose.pack.usdc : formatUsdc(purpose.wei, 6)
  const label = purpose.type === 'topup' ? t('wal.confirmPay', { n: amountText }) : t('wal.confirmSend', { n: amountText })

  return (
    <div className="ar-wal-confirm">
      <button type="button" className="ar-wal-back" onClick={onBack}>
        <ChevronLeft size={14} /> {t('wal.back')}
      </button>
      <div className="ar-wal-summary">
        <div className="ar-wal-sum-row">
          <span>{t('wal.youPay')}</span>
          <strong>{amountText} USDC</strong>
        </div>
        {purpose.type === 'topup' ? (
          <>
            <div className="ar-wal-sum-row">
              <span>{t('wal.youGet')}</span>
              <strong className="ar-wal-gold">
                <Coins size={13} /> {formatNumber(purpose.pack.arc)} Gold
              </strong>
            </div>
            <div className="ar-wal-sum-row is-sub">
              <span>{t('wal.toTreasury')}</span>
              <a href={`${config.explorer}/address/${config.treasury}`} target="_blank" rel="noreferrer">
                {shortAddress(config.treasury)}
              </a>
            </div>
          </>
        ) : (
          <div className="ar-wal-sum-row is-sub">
            <span>{t('wal.sendTo')}</span>
            <span className="ar-wal-mono">{purpose.to}</span>
          </div>
        )}
        <div className="ar-wal-sum-row is-sub">
          <span>{t('wal.fee', { n: formatUsdc(fee, 5) })}</span>
        </div>
      </div>

      {purpose.type === 'send' && (
        <p className="ar-wal-warn">
          <AlertTriangle size={13} /> {t('wal.sendWarn')}
        </p>
      )}

      {short > 0n ? (
        <div className="ar-wal-short">
          <p>{t('wal.notEnough', { n: formatUsdc(short, 4) })}</p>
          <a className="ar-btn ar-btn-sm ar-btn-primary" href={config.faucet} target="_blank" rel="noreferrer">
            <Droplets size={13} /> {t('wal.getFaucet')}
          </a>
          <p className="ar-hint">{t('wal.faucetNote')}</p>
        </div>
      ) : !canSign ? null : account.method === 'google' || account.walletKind === 'embedded' ? (
        <DeviceSigner label={label} onSign={onSign} />
      ) : (
        <ExternalSigner account={account} label={label} onSign={onSign} />
      )}
    </div>
  )
}

function DeviceSigner({ label, onSign }: { label: string; onSign: (signer: Signer) => void }) {
  const t = useT()
  const [password, setPassword] = useState('')
  return (
    <form
      className="ar-wal-sign"
      onSubmit={(event) => {
        event.preventDefault()
        if (password) onSign({ kind: 'device', password })
      }}
    >
      <label className="ar-wal-label" htmlFor="ar-wal-pass">
        {t('wal.password')}
      </label>
      <input
        id="ar-wal-pass"
        className="ar-input"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoFocus
      />
      <p className="ar-hint">{t('wal.passwordHint')}</p>
      <button type="submit" className="ar-btn ar-btn-primary ar-wal-go" disabled={!password}>
        <ShieldCheck size={14} /> {label}
      </button>
    </form>
  )
}

type ReadyWallet =
  | { type: 'injected'; name: string; provider: Eip1193 }
  | { type: 'phone'; wallet: WcWallet; provider: Eip1193 }

/** Older wallets only identify themselves by a flag, so their name arrives as a bare kind. */
const WALLET_NAMES: Record<string, string> = {
  metamask: 'MetaMask',
  rabby: 'Rabby',
  okx: 'OKX Wallet',
  coinbase: 'Coinbase Wallet',
  trust: 'Trust Wallet',
  bitget: 'Bitget Wallet',
  phantom: 'Phantom',
  rainbow: 'Rainbow',
  zerion: 'Zerion',
  brave: 'Brave Wallet',
  other: 'Browser wallet',
}
const walletName = (name: string) => WALLET_NAMES[name] ?? name

/** Resolves to null instead of hanging when a wallet never answers. */
function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([work.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

/**
 * Pays with the wallet the player signed in with. That wallet is found first — a browser
 * wallet already connected to this address, or the phone app paired at sign-in — so paying is
 * one tap and the wallet simply pops up. The full picker (and a QR code) is only the fallback.
 */
function ExternalSigner({ account, label, onSign }: { account: AuthAccount; label: string; onSign: (signer: Signer) => void }) {
  const t = useT()
  const installed = useSyncExternalStore(subscribeWallets, foundWallets, noWallets)
  const [ready, setReady] = useState<ReadyWallet | null>(null)
  const [looking, setLooking] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [pairing, setPairing] = useState<string | null>(null)
  const [qr, setQr] = useState<{ uri: string; name: string } | null>(null)
  const [error, setError] = useState('')
  const token = useRef(0)

  useEffect(() => {
    watchWallets()
    return () => {
      token.current += 1
    }
  }, [])

  // Find the wallet that already holds this address. `eth_accounts` never opens a prompt: it
  // only answers for a site the wallet is already connected to.
  useEffect(() => {
    let off = false
    const want = account.address.toLowerCase()
    void (async () => {
      for (const wallet of installed) {
        const accounts = await within(wallet.provider.request({ method: 'eth_accounts' }), 1500)
        if (off) return
        if (Array.isArray(accounts) && accounts.some((entry) => String(entry).toLowerCase() === want)) {
          setReady({ type: 'injected', name: walletName(wallet.name), provider: wallet.provider })
          setLooking(false)
          return
        }
      }
      const paired = await within(resumeWalletConnect(account.address), 8000)
      if (off) return
      if (paired) setReady({ type: 'phone', wallet: paired.wallet, provider: paired.provider })
      setLooking(false)
    })()
    return () => {
      off = true
    }
  }, [account.address, installed])

  const payWithReady = (wallet: ReadyWallet) => {
    setError('')
    onSign({ kind: 'external', provider: wallet.provider })
    // On a phone, bring the wallet app forward so the request is waiting on screen.
    if (wallet.type === 'phone') setTimeout(() => openWalletApp(wallet.wallet), 700)
  }

  const viaWc = async (wallet: WcWallet) => {
    const mine = (token.current += 1)
    setError('')
    setPairing(wallet.id)
    setQr(null)
    try {
      const provider = await connectWallet(wallet, (uri) => {
        if (token.current === mine && !isMobile()) setQr({ uri, name: wallet.name })
      })
      if (token.current !== mine) return
      onSign({ kind: 'external', provider: provider as Eip1193 })
    } catch {
      if (token.current === mine) setError(t('wal.err.network'))
    } finally {
      if (token.current === mine) {
        setPairing(null)
        setQr(null)
      }
    }
  }

  if (qr) {
    return (
      <div className="ar-pick-qr">
        <div className="ar-pick-qr-code">
          <QRCodeSVG value={qr.uri} size={168} marginSize={2} level="M" />
        </div>
        <p className="ar-pick-qr-note">{t('wal.scanPay', { name: qr.name })}</p>
        <button
          type="button"
          className="ar-pick-mini"
          onClick={() => {
            token.current += 1
            setPairing(null)
            setQr(null)
          }}
        >
          {t('wal.cancel')}
        </button>
      </div>
    )
  }

  if (looking && !showAll) {
    return (
      <div className="ar-wal-sign ar-wal-finding">
        <Loader2 size={16} className="ar-spin" />
        <span>{t('wal.findingWallet')}</span>
      </div>
    )
  }

  if (ready && !showAll) {
    const name = ready.type === 'phone' ? ready.wallet.name : ready.name
    const logo = ready.type === 'phone' ? ready.wallet.logo : INJECTED_LOGOS[ready.name]
    return (
      <div className="ar-wal-sign">
        <button type="button" className="ar-btn ar-btn-primary ar-wal-go" onClick={() => payWithReady(ready)}>
          <ShieldCheck size={14} /> {label}
        </button>
        <p className="ar-wal-ready">
          <WalletMark logo={logo} />
          <span>{t(ready.type === 'phone' ? 'wal.readyPhone' : 'wal.readyBrowser', { name })}</span>
        </p>
        <button type="button" className="ar-wal-back ar-wal-other" onClick={() => setShowAll(true)}>
          {t('wal.changeWallet')}
        </button>
      </div>
    )
  }

  return (
    <div className="ar-wal-sign">
      <p className="ar-wal-label">{t('wal.chooseWallet')}</p>
      <p className="ar-hint ar-wal-mono">{shortAddress(account.address)}</p>
      {installed.length > 0 ? (
        <div className="ar-pick-grid">
          {installed.map((wallet) => (
            <button
              key={wallet.id}
              type="button"
              className="ar-pick-card"
              disabled={pairing !== null}
              onClick={() => onSign({ kind: 'external', provider: wallet.provider })}
            >
              <WalletMark logo={INJECTED_LOGOS[walletName(wallet.name)]} />
              <span className="ar-pick-text">
                <span className="ar-pick-name">{walletName(wallet.name)}</span>
                <span className="ar-pick-sub">{label}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="ar-hint">{t('wal.noWallets')}</p>
      )}
      {walletConnectReady() && (
        <>
          <p className="ar-wal-label ar-wal-label-sm">{t('wal.phoneWallets')}</p>
          <div className="ar-pick-grid">
            {WC_WALLETS.slice(0, 4).map((wallet) => (
              <button
                key={wallet.id}
                type="button"
                className="ar-pick-card"
                disabled={pairing !== null}
                onClick={() => void viaWc(wallet)}
              >
                {pairing === wallet.id ? (
                  <span className="ar-pick-logo">
                    <Loader2 size={16} className="ar-spin" />
                  </span>
                ) : (
                  <WalletMark logo={wallet.logo} />
                )}
                <span className="ar-pick-text">
                  <span className="ar-pick-name">{wallet.name}</span>
                  <span className="ar-pick-sub">{t('wal.payWith', { name: wallet.name })}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {error && <div className="ar-eco-note is-bad">{error}</div>}
    </div>
  )
}

// ----------------------------------------------------------------- progress --
function Progress({ flow, config }: { flow: Extract<Flow, { name: 'busy' }>; config: WalletConfig }) {
  const t = useT()
  const device = flow.stage === 'unlock' || flow.device
  const steps = [
    { id: 'sign', label: t(device ? 'wal.step.unlock' : 'wal.step.sign') },
    { id: 'chain', label: t('wal.step.chain') },
    ...(flow.purpose.type === 'topup' ? [{ id: 'credit', label: t('wal.step.credit') }] : []),
  ]
  const order = ['sign', 'chain', 'credit']
  const at = order.indexOf(flow.stage === 'unlock' ? 'sign' : flow.stage)
  return (
    <div className="ar-wal-steps" aria-live="polite">
      {steps.map((step) => {
        const index = order.indexOf(step.id)
        const state = index < at ? 'done' : index === at ? 'now' : 'next'
        return (
          <div key={step.id} className={`ar-wal-step is-${state}`}>
            <span className="ar-wal-step-dot">
              {state === 'done' ? <Check size={12} /> : state === 'now' ? <Loader2 size={12} className="ar-spin" /> : null}
            </span>
            <span>{step.label}</span>
          </div>
        )
      })}
      {flow.hash && (
        <a className="ar-wal-link" href={`${config.explorer}/tx/${flow.hash}`} target="_blank" rel="noreferrer">
          <ExternalLink size={12} /> {t('wal.viewTx')}
        </a>
      )}
    </div>
  )
}

function Done({ flow, config, onDone }: { flow: Extract<Flow, { name: 'done' }>; config: WalletConfig; onDone: () => void }) {
  const t = useT()
  const topup = flow.purpose.type === 'topup'
  return (
    <div className={`ar-wal-result ${flow.slow ? 'is-wait' : 'is-ok'}`}>
      <span className="ar-wal-result-icon">{flow.slow ? <Loader2 size={20} /> : <Check size={22} />}</span>
      {flow.slow && topup ? (
        <p className="ar-hint">{t('wal.slow')}</p>
      ) : topup && flow.purpose.type === 'topup' ? (
        <>
          <p className="ar-wal-result-big">{t('wal.topupDone', { n: formatNumber(flow.credited ?? flow.purpose.pack.arc) })}</p>
          <p className="ar-hint">{t('wal.topupDoneBody', { usdc: flow.purpose.pack.usdc })}</p>
        </>
      ) : flow.purpose.type === 'send' ? (
        <p className="ar-wal-result-big">{t('wal.sent', { n: formatUsdc(flow.purpose.wei, 6) })}</p>
      ) : null}
      <a className="ar-wal-link" href={`${config.explorer}/tx/${flow.hash}`} target="_blank" rel="noreferrer">
        <ExternalLink size={12} /> {t('wal.viewTx')}
      </a>
      <button className="ar-btn ar-btn-primary" onClick={onDone}>
        {t('wal.done')}
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ receive --
function Receive({ address, faucet, onCopied }: { address: string; faucet: string; onCopied: () => void }) {
  const t = useT()
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  return (
    <div className="ar-wal-receive">
      <div className="ar-wal-qr">
        <QRCodeSVG value={address} size={156} marginSize={2} level="M" />
      </div>
      <p className="ar-wal-mono ar-wal-full">{address}</p>
      <div className="ar-wal-actions">
        <button
          className="ar-btn ar-btn-sm"
          onClick={async () => {
            if (await copyText(address)) onCopied()
          }}
        >
          <Copy size={13} /> {t('wal.copy')}
        </button>
        {canShare && (
          <button className="ar-btn ar-btn-sm" onClick={() => void navigator.share({ text: address }).catch(() => undefined)}>
            <Share2 size={13} /> {t('wal.share')}
          </button>
        )}
      </div>
      <p className="ar-wal-warn">
        <AlertTriangle size={13} /> {t('wal.receiveHint')}
      </p>
      <a className="ar-btn ar-btn-sm ar-btn-primary" href={faucet} target="_blank" rel="noreferrer">
        <Droplets size={13} /> {t('wal.getFaucet')}
      </a>
      <p className="ar-hint">{t('wal.faucetNote')}</p>
    </div>
  )
}

// --------------------------------------------------------------------- send --
function SendForm({
  self,
  balance,
  fee,
  disabled,
  onReview,
}: {
  self: string
  balance: bigint | null
  fee: bigint
  disabled: boolean
  onReview: (to: string, wei: bigint) => void
}) {
  const t = useT()
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const sendFee = (fee * 21n) / 30n
  const max = balance === null ? 0n : balance - sendFee > 0n ? balance - sendFee : 0n

  const review = async () => {
    setError('')
    setChecking(true)
    const target = await checkAddress(to)
    setChecking(false)
    if (!target) return setError(t('wal.badAddress'))
    if (target.toLowerCase() === self.toLowerCase()) return setError(t('wal.selfSend'))
    const wei = parseUsdc(amount)
    if (!wei) return setError(t('wal.badAmount'))
    if (balance !== null && wei > max) return setError(t('wal.tooMuch'))
    onReview(target, wei)
  }

  return (
    <form
      className="ar-wal-send"
      onSubmit={(event) => {
        event.preventDefault()
        void review()
      }}
    >
      <label className="ar-wal-label" htmlFor="ar-wal-to">
        {t('wal.to')}
      </label>
      <input
        id="ar-wal-to"
        className="ar-input ar-wal-mono"
        placeholder="0x…"
        spellCheck={false}
        autoComplete="off"
        value={to}
        disabled={disabled}
        onChange={(event) => setTo(event.target.value.trim())}
      />
      <label className="ar-wal-label" htmlFor="ar-wal-amount">
        {t('wal.amount')}
      </label>
      <div className="ar-wal-amount">
        <input
          id="ar-wal-amount"
          className="ar-input"
          inputMode="decimal"
          placeholder="0.0"
          autoComplete="off"
          value={amount}
          disabled={disabled}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ''))}
        />
        <button type="button" className="ar-btn ar-btn-sm" disabled={disabled || max <= 0n} onClick={() => setAmount(plainUsdc(max))}>
          {t('wal.max')}
        </button>
      </div>
      {error && <div className="ar-eco-note is-bad">{error}</div>}
      <button type="submit" className="ar-btn ar-btn-primary ar-wal-go" disabled={disabled || checking || !to || !amount}>
        {checking ? <Loader2 size={14} className="ar-spin" /> : <ArrowUpRight size={14} />} {t('wal.review')}
      </button>
    </form>
  )
}

// ------------------------------------------------------------------ history --
function History({
  data,
  loading,
  config,
  lang,
  self,
}: {
  data: WalletAccount | null
  loading: boolean
  config: WalletConfig
  lang: 'vi' | 'en'
  self: string
}) {
  const t = useT()
  if (loading) {
    return (
      <div className="ar-wal-loading">
        <Loader2 size={18} className="ar-spin" />
      </div>
    )
  }
  if (!data || !data.historyOk) return <p className="ar-hint">{t('wal.historyOff')}</p>
  if (!data.txs.length) return <p className="ar-hint">{t('wal.historyEmpty')}</p>
  return (
    <>
      <div className="ar-wal-txs">
        {data.txs.map((tx) => (
          <TxRow key={tx.hash} tx={tx} config={config} lang={lang} self={self} />
        ))}
      </div>
      <a className="ar-wal-link ar-wal-all" href={`${config.explorer}/address/${self}`} target="_blank" rel="noreferrer">
        <ExternalLink size={12} /> {t('wal.viewAll')}
      </a>
    </>
  )
}

function TxRow({ tx, config, lang, self }: { tx: WalletTx; config: WalletConfig; lang: 'vi' | 'en'; self: string }) {
  const t = useT()
  const value = shortUsdc(tx.value, 4)
  const zero = value === '0'
  const label =
    tx.kind === 'topup'
      ? t('wal.tx.topup')
      : tx.kind === 'contract'
        ? t('wal.tx.contract')
        : t(`wal.tx.${tx.direction}`)
  const other = tx.direction === 'in' ? tx.from : tx.to
  const sub = useMemo(() => {
    const when = timeAgo(tx.time, lang)
    const method = tx.kind === 'contract' && tx.method ? `${tx.method} · ` : ''
    if (tx.direction === 'self' || !other) return `${method}${when}`
    const who = other.toLowerCase() === config.treasury.toLowerCase() ? 'Mochiro' : shortAddress(other)
    return `${method}${t(tx.direction === 'in' ? 'wal.tx.from' : 'wal.tx.to', { who })} · ${when}`
  }, [tx, lang, other, config.treasury, t])
  const Icon = tx.kind === 'topup' ? Zap : tx.kind === 'contract' ? FileCode2 : tx.direction === 'in' ? ArrowDownLeft : ArrowUpRight
  void self
  return (
    <a className={`ar-wal-tx is-${tx.direction} ${tx.ok ? '' : 'is-failed'}`} href={`${config.explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer">
      <span className={`ar-wal-tx-icon is-${tx.kind}`}>
        <Icon size={14} />
      </span>
      <span className="ar-wal-tx-text">
        <span className="ar-wal-tx-name">
          {label}
          {!tx.ok && <span className="ar-wal-tx-fail">{t('wal.tx.failed')}</span>}
        </span>
        <span className="ar-wal-tx-sub">{sub}</span>
      </span>
      <span className="ar-wal-tx-value">{zero ? '' : `${tx.direction === 'in' ? '+' : tx.direction === 'out' ? '−' : ''}${value}`}</span>
    </a>
  )
}
