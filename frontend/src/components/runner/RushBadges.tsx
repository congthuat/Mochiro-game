// NFT badges on Arc: a soulbound collectible for each big milestone. The server checks the
// milestone on verified runs and signs a voucher; the player's own wallet sends the mint.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, Droplets, ExternalLink, Loader2, Lock, LogIn, Medal, Rocket, Wrench } from 'lucide-react'
import { formatNumber, useT } from '../../lib/i18n'
import { shortAddress, type AuthAccount } from '../../lib/auth'
import { deviceHoldsKey, fallbackConfig, walletConfig, WalletError, type Signer, type WalletConfig } from '../../lib/arcWallet'
import {
  BadgeError,
  badgeImage,
  badgeTokenId,
  fetchBadgeSetup,
  fetchBadges,
  refreshBadges,
  requestVoucher,
  sendContractTx,
  waitReceipt,
  type BadgeInfo,
  type BadgeProgress,
  type BadgeSetup,
  type BadgeState,
} from '../../lib/badges'
import { formatDistance } from '../../runner/utils'
import { Backdrop, PanelHead } from './RushEconomy'
import { SignWith } from './RushWallet'

type Job = { kind: 'claim'; badge: BadgeInfo } | { kind: 'deploy' | 'fix'; tx: { to: string; data: string } }
type Flow =
  | { name: 'list' }
  | { name: 'confirm'; job: Job }
  | { name: 'busy'; job: Job; stage: 'sign' | 'chain'; hash?: string }
  | { name: 'done'; job: Job; hash: string }
  | { name: 'failed'; job: Job; code: string; hash?: string }

/** Current value toward a badge, as the player would say it. */
function progressText(badge: BadgeInfo, progress: BadgeProgress | null, t: ReturnType<typeof useT>): string {
  const value = progress ? (badge.metric === 'week_rank' ? progress.week_rank : progress[badge.metric]) : null
  switch (badge.metric) {
    case 'best_distance':
    case 'hard_distance':
      return `${formatDistance(Number(value ?? 0))} / ${formatDistance(badge.target)}`
    case 'best_combo':
      return `×${formatNumber(Number(value ?? 0))} / ×${formatNumber(badge.target)}`
    case 'week_rank':
      return value ? t('nft.bestWeek', { n: value }) : t('nft.noWeek')
    default:
      return `${formatNumber(Number(value ?? 0))} / ${formatNumber(badge.target)}`
  }
}

function progressRatio(badge: BadgeInfo, progress: BadgeProgress | null): number {
  if (!progress) return 0
  if (badge.metric === 'week_rank') return progress.week_rank !== null && progress.week_rank <= badge.target ? 1 : 0
  return Math.max(0, Math.min(1, Number(progress[badge.metric] ?? 0) / badge.target))
}

export function RushBadges({ account, onSignIn, onClose }: { account: AuthAccount | null; onSignIn: () => void; onClose: () => void }) {
  const t = useT()
  const [state, setState] = useState<BadgeState | null>(null)
  const [setup, setSetup] = useState<BadgeSetup | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [config, setConfig] = useState<WalletConfig>(fallbackConfig)
  const [flow, setFlow] = useState<Flow>({ name: 'list' })
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void walletConfig()
      .then((next) => alive.current && setConfig(next))
      .catch(() => undefined)
    return () => {
      alive.current = false
    }
  }, [])

  const isOwner = Boolean(account && state && account.address.toLowerCase() === state.owner.toLowerCase())

  const load = useCallback(async () => {
    try {
      const next = await fetchBadges()
      if (!alive.current) return
      setState(next)
      setLoadState('ok')
      const owner = account && account.address.toLowerCase() === next.owner.toLowerCase()
      if (owner) {
        const info = await fetchBadgeSetup().catch(() => null)
        if (alive.current) setSetup(info)
      }
    } catch {
      if (alive.current) setLoadState((prev) => (prev === 'ok' ? 'ok' : 'error'))
    }
  }, [account])

  useEffect(() => {
    void load()
  }, [load])

  const busy = flow.name === 'busy'
  const canSign = account ? account.method === 'wallet' || deviceHoldsKey(account) : false

  const run = async (job: Job, signer: Signer) => {
    if (!account) return
    setFlow({ name: 'busy', job, stage: 'sign' })
    let hash: string
    try {
      const tx = job.kind === 'claim' ? await requestVoucher(job.badge.id) : job.tx
      hash = await sendContractTx(account, signer, tx, config)
    } catch (error) {
      if (!alive.current) return
      const code = error instanceof BadgeError || error instanceof WalletError ? error.code : 'network'
      setFlow({ name: 'failed', job, code })
      return
    }
    if (!alive.current) return
    setFlow({ name: 'busy', job, stage: 'chain', hash })
    const mined = await waitReceipt(config, hash, 90_000)
    if (!alive.current) return
    if (mined === false) {
      setFlow({ name: 'failed', job, code: 'tx_failed', hash })
      return
    }
    if (job.kind === 'claim') {
      // Show it as owned right away; the chain read below confirms it.
      setState((prev) => (prev ? { ...prev, owned: Array.from(new Set([...prev.owned, job.badge.id])) } : prev))
    } else {
      await refreshBadges()
    }
    setFlow({ name: 'done', job, hash })
    void load()
  }

  const errorText = (code: string) => {
    for (const key of [`nft.err.${code}`, `wal.err.${code}`]) {
      const text = t(key)
      if (text !== key) return text
    }
    return t('wal.err.generic')
  }

  const badgeName = (badge: BadgeInfo) => t(`nft.b.${badge.key}`)
  const jobTitle = (job: Job) => (job.kind === 'claim' ? badgeName(job.badge) : t(job.kind === 'deploy' ? 'nft.admin.title' : 'nft.admin.fixTitle'))

  const ownedCount = state ? state.badges.filter((badge) => state.owned.includes(badge.id)).length : 0

  let body
  if (loadState === 'loading' && !state) {
    body = (
      <div className="ar-wal-finding ar-nft-loading">
        <Loader2 size={16} className="ar-spin" /> <span>{t('nft.loading')}</span>
      </div>
    )
  } else if (!state) {
    body = (
      <div className="ar-wal-result is-bad">
        <p className="ar-hint">{t('nft.offline')}</p>
        <button className="ar-btn" onClick={() => void load()}>
          {t('nft.retry')}
        </button>
      </div>
    )
  } else if (flow.name !== 'list') {
    const job = flow.job
    const image = job.kind === 'claim' ? badgeImage(job.badge.key) : null
    body = (
      <div className="ar-nft-flow">
        {(flow.name === 'confirm' || flow.name === 'failed') && (
          <button type="button" className="ar-wal-back" onClick={() => setFlow({ name: 'list' })}>
            <ChevronLeft size={14} /> {t('wal.back')}
          </button>
        )}
        <div className="ar-nft-hero">
          {image ? (
            <img src={image} alt="" className={flow.name === 'done' ? 'is-new' : ''} />
          ) : (
            <span className="ar-nft-hero-icon">{job.kind === 'deploy' ? <Rocket size={30} /> : <Wrench size={28} />}</span>
          )}
          <div>
            <p className="ar-nft-hero-name">{jobTitle(job)}</p>
            <p className="ar-hint">{job.kind === 'claim' ? t(`nft.g.${job.badge.key}`) : t(job.kind === 'deploy' ? 'nft.admin.body' : 'nft.admin.fixBody')}</p>
          </div>
        </div>

        {flow.name === 'confirm' && account && (
          <>
            <div className="ar-wal-summary">
              {job.kind === 'claim' && (
                <div className="ar-wal-sum-row">
                  <span>{t('nft.price')}</span>
                  <strong>{t('nft.free')}</strong>
                </div>
              )}
              <div className="ar-wal-sum-row is-sub">
                <span>{t(job.kind === 'deploy' ? 'nft.gasDeploy' : 'nft.gasMint')}</span>
              </div>
              <div className="ar-wal-sum-row is-sub">
                <span>{t(job.kind === 'claim' ? 'nft.to' : 'nft.from')}</span>
                <span className="ar-wal-mono">{shortAddress(account.address)}</span>
              </div>
            </div>
            {canSign ? (
              <SignWith
                account={account}
                label={job.kind === 'claim' ? t('nft.mint') : t(job.kind === 'deploy' ? 'nft.admin.go' : 'nft.admin.fix')}
                onSign={(signer) => void run(job, signer)}
              />
            ) : (
              <div className="ar-eco-note is-bad">{t('wal.err.no-key')}</div>
            )}
          </>
        )}

        {flow.name === 'busy' && (
          <div className="ar-wal-steps" aria-live="polite">
            {(['sign', 'chain'] as const).map((step, index) => {
              const at = flow.stage === 'sign' ? 0 : 1
              const status = index < at ? 'done' : index === at ? 'now' : 'next'
              return (
                <div key={step} className={`ar-wal-step is-${status}`}>
                  <span className="ar-wal-step-dot">
                    {status === 'done' ? <Check size={12} /> : status === 'now' ? <Loader2 size={12} className="ar-spin" /> : null}
                  </span>
                  <span>{t(step === 'sign' ? 'nft.step.sign' : 'nft.step.chain')}</span>
                </div>
              )
            })}
            {flow.hash && (
              <a className="ar-wal-link" href={`${config.explorer}/tx/${flow.hash}`} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> {t('wal.viewTx')}
              </a>
            )}
          </div>
        )}

        {flow.name === 'done' && (
          <div className="ar-wal-result is-ok">
            <span className="ar-wal-result-icon">
              <Check size={22} />
            </span>
            <p className="ar-wal-result-big">{job.kind === 'claim' ? t('nft.minted') : t('nft.admin.done')}</p>
            {job.kind === 'claim' && <p className="ar-hint">{t('nft.mintedBody')}</p>}
            <a className="ar-wal-link" href={`${config.explorer}/tx/${flow.hash}`} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> {t('wal.viewTx')}
            </a>
            <button className="ar-btn ar-btn-primary" onClick={() => setFlow({ name: 'list' })}>
              {t('wal.done')}
            </button>
          </div>
        )}

        {flow.name === 'failed' && (
          <div className="ar-wal-short">
            <p>{errorText(flow.code)}</p>
            {flow.code === 'insufficient' && (
              <a className="ar-btn ar-btn-sm ar-btn-primary" href={config.faucet} target="_blank" rel="noreferrer">
                <Droplets size={13} /> {t('wal.getFaucet')}
              </a>
            )}
            {flow.hash && (
              <a className="ar-wal-link" href={`${config.explorer}/tx/${flow.hash}`} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> {t('wal.viewTx')}
              </a>
            )}
            <button className="ar-btn ar-btn-sm" onClick={() => setFlow({ name: 'confirm', job })}>
              {t('nft.tryAgain')}
            </button>
          </div>
        )}
      </div>
    )
  } else {
    const live = state.deployed && state.ready && state.contract
    const setupJob: Job | null =
      isOwner && setup?.available
        ? setup.deploy
          ? { kind: 'deploy', tx: setup.deploy }
          : setup.fixSigner
            ? { kind: 'fix', tx: setup.fixSigner }
            : null
        : null
    body = (
      <>
        <div className="ar-nft-top">
          <span className="ar-nft-count">
            <Medal size={14} /> {t('nft.count', { n: ownedCount, max: state.badges.length })}
          </span>
          {state.contract && state.deployed && (
            <a className="ar-wal-link" href={`${state.explorer}/address/${state.contract}`} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> {t('nft.contract')}
            </a>
          )}
        </div>
        <p className="ar-hint ar-nft-intro">{t('nft.intro')}</p>

        {setupJob && (
          <div className="ar-nft-admin">
            <span className="ar-nft-admin-icon">{setupJob.kind === 'deploy' ? <Rocket size={18} /> : <Wrench size={18} />}</span>
            <div className="ar-nft-admin-text">
              <b>{t(setupJob.kind === 'deploy' ? 'nft.admin.title' : 'nft.admin.fixTitle')}</b>
              <span>{t(setupJob.kind === 'deploy' ? 'nft.admin.body' : 'nft.admin.fixBody')}</span>
            </div>
            <button className="ar-btn ar-btn-sm ar-btn-primary" onClick={() => setFlow({ name: 'confirm', job: setupJob })}>
              {t(setupJob.kind === 'deploy' ? 'nft.admin.cta' : 'nft.admin.fix')}
            </button>
          </div>
        )}
        {!live && !setupJob && <div className="ar-eco-note ar-nft-soon">{t('nft.soon')}</div>}
        {!account && (
          <button type="button" className="ar-invite-banner" onClick={onSignIn}>
            <LogIn size={16} />
            <span>{t('nft.signIn')}</span>
          </button>
        )}

        <div className="ar-nft-grid">
          {state.badges.map((badge) => {
            const owned = state.owned.includes(badge.id)
            const ratio = progressRatio(badge, state.progress)
            const claimable = Boolean(live && account && badge.reached && !owned)
            return (
              <div key={badge.id} className={`ar-nft-card ${owned ? 'is-owned' : badge.reached ? 'is-ready' : 'is-locked'}`}>
                <div className="ar-nft-art">
                  <img src={badgeImage(badge.key)} alt="" />
                  {!owned && !badge.reached && (
                    <span className="ar-nft-lock">
                      <Lock size={13} />
                    </span>
                  )}
                </div>
                <div className="ar-nft-name">{badgeName(badge)}</div>
                <div className="ar-nft-goal">{t(`nft.g.${badge.key}`)}</div>
                {account && !owned && (
                  <div className="ar-nft-bar" aria-hidden>
                    <span style={{ width: `${Math.round(ratio * 100)}%` }} />
                  </div>
                )}
                {account && !owned && <div className="ar-nft-val">{progressText(badge, state.progress, t)}</div>}
                {owned && state.contract && account ? (
                  <a
                    className="ar-nft-owned"
                    href={`${state.explorer}/token/${state.contract}/instance/${badgeTokenId(badge.id, account.address)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Check size={13} /> {t('nft.owned')}
                  </a>
                ) : claimable ? (
                  <button className="ar-btn ar-btn-sm ar-btn-primary ar-nft-claim" disabled={busy} onClick={() => setFlow({ name: 'confirm', job: { kind: 'claim', badge } })}>
                    <Medal size={13} /> {t('nft.claim')}
                  </button>
                ) : badge.reached && account ? (
                  <span className="ar-nft-state is-ready">{t('nft.reached')}</span>
                ) : null}
              </div>
            )
          })}
        </div>
        <p className="ar-hint mt-3 ar-nft-foot">{t('nft.foot', { n: state.weekMinPlayers })}</p>
      </>
    )
  }

  return (
    <Backdrop onClose={() => !busy && onClose()}>
      <div className="ar-panel ar-modal ar-nft">
        <PanelHead icon={<Medal size={15} className="mr-2 inline" />} title={t('nft.title')} onClose={() => !busy && onClose()} />
        {body}
      </div>
    </Backdrop>
  )
}
