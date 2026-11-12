// Mochiro meta screens: wallet chip, shop, daily reward, daily quests, season reward and
// the first-run coach. All coin movement is decided by the server (/api/economy); these
// components only ask and then show whatever state the server sends back.
import { Check, Coins, Gift, Lock, ShoppingBag, Sparkles, Target, Trophy, X, Zap } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { CHARACTERS, CHARACTER_IDS, type CharacterId } from '../../runner/config'
import { formatNumber, useT } from '../../lib/i18n'
import type { EconomyState, UpgradeKind } from '../../lib/runnerApi'

/** Ticks every `ms` so countdowns stay live without re-rendering the whole app. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(timer)
  }, [ms])
  return now
}

export function formatLeft(iso: string, now: number): string {
  const left = Math.max(0, Date.parse(iso) - now)
  const minutes = Math.floor(left / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${Math.max(1, mins)}m`
}

/** True when the hero can be played: free, bought, or the server is unreachable. */
export function heroUnlocked(economy: EconomyState | null, id: CharacterId): boolean {
  if (!economy) return true
  return economy.unlocked.includes(id) || (economy.catalog.characters[id] ?? 0) === 0
}

export function heroPrice(economy: EconomyState | null, id: CharacterId): number {
  return economy?.catalog.characters[id] ?? 0
}

export function claimableCount(economy: EconomyState | null): number {
  if (!economy) return 0
  const quests = economy.quests.filter((q) => !q.claimed && q.progress >= q.target).length
  return quests + (economy.season.lastWeek.claimable ? 1 : 0)
}

export function BankChip({ bank, onClick }: { bank: number | null; onClick?: () => void }) {
  const t = useT()
  return (
    <button type="button" className="ar-bank" onClick={onClick} title={t('eco.bank')}>
      <Coins size={15} />
      <span className="ar-bank-value">{bank === null ? '—' : formatNumber(bank)}</span>
      <span className="ar-bank-label">{t('eco.coins')}</span>
    </button>
  )
}

function Backdrop({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="ar-screen"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </div>
  )
}

function PanelHead({ icon, title, onClose }: { icon: ReactNode; title: string; onClose: () => void }) {
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="ar-modal-title">
        {icon}
        {title}
      </div>
      <button className="ar-btn ar-btn-sm" onClick={onClose}>
        <X size={14} /> {t('board.close')}
      </button>
    </div>
  )
}

export type EcoNote = { tone: 'ok' | 'bad'; text: string } | null

// ------------------------------------------------------------------- shop --
export function RushShop({
  economy,
  busy,
  note,
  guest,
  onBuy,
  onPick,
  onClose,
}: {
  economy: EconomyState
  busy: string | null
  note: EcoNote
  guest: boolean
  onBuy: (item: string) => void
  onPick: (id: CharacterId) => void
  onClose: () => void
}) {
  const t = useT()
  const [tab, setTab] = useState<'heroes' | 'powers'>('heroes')
  const { costs, max, step, kinds } = economy.catalog.upgrades

  return (
    <Backdrop onClose={onClose}>
      <div className="ar-panel ar-modal ar-shop">
        <PanelHead icon={<ShoppingBag size={15} className="mr-2 inline" />} title={t('shop.title')} onClose={onClose} />
        <div className="ar-shop-top">
          <BankChip bank={economy.bank} />
          <div className="ar-seg ar-shop-tabs">
            <button className={`ar-btn ar-btn-sm ${tab === 'heroes' ? 'ar-seg-active' : ''}`} onClick={() => setTab('heroes')}>
              {t('shop.heroes')}
            </button>
            <button className={`ar-btn ar-btn-sm ${tab === 'powers' ? 'ar-seg-active' : ''}`} onClick={() => setTab('powers')}>
              {t('shop.powers')}
            </button>
          </div>
        </div>
        <p className="ar-hint mt-2">{guest ? t('shop.signInSafe') : t('shop.hint')}</p>
        {note && <div className={`ar-eco-note ${note.tone === 'bad' ? 'is-bad' : ''}`}>{note.text}</div>}

        {tab === 'heroes' ? (
          <div className="ar-shop-grid">
            {CHARACTER_IDS.map((id) => {
              const spec = CHARACTERS[id]
              const price = heroPrice(economy, id)
              const owned = heroUnlocked(economy, id)
              const short = Math.max(0, price - economy.bank)
              const accent = `#${spec.accent.toString(16).padStart(6, '0')}`
              return (
                <div key={id} className={`ar-shop-card ${owned ? 'is-owned' : ''}`} style={{ ['--ar-accent' as string]: accent }}>
                  <div className="ar-shop-card-head">
                    <span className="ar-shop-swatch" />
                    <span className="ar-shop-name">{spec.name}</span>
                    {!owned && <Lock size={13} />}
                  </div>
                  <div className="ar-shop-perk">{t(`perk.${spec.perk.id}`)}</div>
                  {owned ? (
                    <button className="ar-btn ar-btn-sm" onClick={() => onPick(id)}>
                      <Check size={13} /> {price === 0 ? t('shop.free') : t('shop.owned')}
                    </button>
                  ) : (
                    <button
                      className="ar-btn ar-btn-sm ar-btn-primary"
                      disabled={busy !== null || short > 0}
                      title={short > 0 ? t('menu.needMore', { n: formatNumber(short) }) : undefined}
                      onClick={() => onBuy(`char:${id}`)}
                    >
                      <Coins size={13} /> {formatNumber(price)}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="ar-rows">
            {kinds.map((kind: UpgradeKind) => {
              const level = economy.upgrades[kind] ?? 0
              const price = level < max ? costs[level] : null
              return (
                <div key={kind} className="ar-row ar-up-row">
                  <div className="flex-1 overflow-hidden">
                    <div className="ar-row-name">
                      <Zap size={13} className="mr-1 inline" />
                      {t(`shop.up.${kind}`)}
                    </div>
                    <div className="ar-up-pips">
                      {Array.from({ length: max }, (_, i) => (
                        <span key={i} className={i < level ? 'is-on' : ''} />
                      ))}
                      <span className="ar-row-sub">
                        {t('shop.level', { n: level, max })}
                        {level > 0 ? ` · ${t('shop.lasts', { pct: Math.round(level * step * 100) })}` : ''}
                      </span>
                    </div>
                  </div>
                  {price === null ? (
                    <span className="ar-up-max">{t('shop.max')}</span>
                  ) : (
                    <button
                      className="ar-btn ar-btn-sm ar-btn-primary"
                      disabled={busy !== null || economy.bank < price}
                      onClick={() => onBuy(`up:${kind}`)}
                    >
                      <Coins size={13} /> {formatNumber(price)}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Backdrop>
  )
}

// ------------------------------------------------------------------ daily --
export function RushDaily({
  economy,
  busy,
  onClaim,
  onClose,
}: {
  economy: EconomyState
  busy: boolean
  onClaim: () => void
  onClose: () => void
}) {
  const t = useT()
  const { rewards, nextDay, claimable } = economy.daily
  return (
    <Backdrop onClose={onClose}>
      <div className="ar-panel ar-modal ar-daily" style={{ width: 'min(520px, 100%)' }}>
        <PanelHead icon={<Gift size={15} className="mr-2 inline" />} title={t('daily.title')} onClose={onClose} />
        <div className="ar-daily-grid">
          {rewards.map((reward, index) => {
            const day = index + 1
            const done = claimable ? day < nextDay : day <= nextDay
            const today = claimable && day === nextDay
            return (
              <div key={day} className={`ar-daily-cell ${done ? 'is-done' : ''} ${today ? 'is-today' : ''} ${day === 7 ? 'is-big' : ''}`}>
                <span className="ar-daily-day">{t('daily.day', { n: day })}</span>
                {done ? <Check size={18} /> : <Coins size={18} />}
                <span className="ar-daily-amount">{formatNumber(reward)}</span>
              </div>
            )
          })}
        </div>
        <p className="ar-hint mt-3">{t('daily.streak')}</p>
        <div className="ar-menu-actions">
          {claimable ? (
            <button className="ar-btn ar-btn-primary py-4" disabled={busy} onClick={onClaim}>
              <Gift size={16} /> {t('daily.claim', { n: formatNumber(economy.daily.nextReward) })}
            </button>
          ) : (
            <button className="ar-btn py-4" onClick={onClose}>
              <Check size={16} /> {t('daily.got', { n: formatNumber(rewards[Math.max(0, nextDay - 1)]) })}
            </button>
          )}
        </div>
      </div>
    </Backdrop>
  )
}

// ----------------------------------------------------------------- quests --
function questLabel(t: ReturnType<typeof useT>, id: string, target: number): string {
  const n = id === 'time' ? Math.round(target / 60) : formatNumber(target)
  return t(`quest.${id}`, { n })
}

export function RushQuests({
  economy,
  busy,
  note,
  onClaim,
  onClaimSeason,
  onClose,
}: {
  economy: EconomyState
  busy: string | null
  note: EcoNote
  onClaim: (quest: string) => void
  onClaimSeason: () => void
  onClose: () => void
}) {
  const t = useT()
  const now = useNow()
  const last = economy.season.lastWeek
  return (
    <Backdrop onClose={onClose}>
      <div className="ar-panel ar-modal" style={{ width: 'min(540px, 100%)' }}>
        <PanelHead icon={<Target size={15} className="mr-2 inline" />} title={t('quest.title')} onClose={onClose} />
        <div className="ar-shop-top">
          <BankChip bank={economy.bank} />
          <span className="ar-hint">{t('quest.resets', { time: formatLeft(economy.resetsAt, now) })}</span>
        </div>
        {note && <div className={`ar-eco-note ${note.tone === 'bad' ? 'is-bad' : ''}`}>{note.text}</div>}

        {last.claimable && last.rank && (
          <div className="ar-season-win">
            <Trophy size={18} />
            <span className="flex-1">{t('season.reward', { rank: last.rank })}</span>
            <button className="ar-btn ar-btn-sm ar-btn-primary" disabled={busy !== null} onClick={onClaimSeason}>
              <Coins size={13} /> {t('season.claim', { n: formatNumber(last.reward) })}
            </button>
          </div>
        )}

        <div className="ar-rows">
          {economy.quests.map((quest) => {
            const done = quest.progress >= quest.target
            const pct = Math.min(100, (quest.progress / quest.target) * 100)
            return (
              <div key={quest.id} className={`ar-row ar-quest ${quest.claimed ? 'is-claimed' : ''}`}>
                <div className="flex-1 overflow-hidden">
                  <div className="ar-row-name">{questLabel(t, quest.id, quest.target)}</div>
                  <div className="ar-quest-bar">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <div className="ar-row-sub">
                    {quest.id === 'time'
                      ? `${Math.floor(quest.progress / 60)}/${Math.round(quest.target / 60)}`
                      : `${formatNumber(quest.progress)}/${formatNumber(quest.target)}`}
                    {' · '}+{quest.reward} Arc
                  </div>
                </div>
                {quest.claimed ? (
                  <span className="ar-up-max">
                    <Check size={13} /> {t('quest.claimed')}
                  </span>
                ) : (
                  <button
                    className={`ar-btn ar-btn-sm ${done ? 'ar-btn-primary' : ''}`}
                    disabled={!done || busy !== null}
                    onClick={() => onClaim(quest.id)}
                  >
                    {done ? <Sparkles size={13} /> : <Lock size={13} />} {t('quest.claim')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <p className="ar-hint mt-3">{t('quest.note')}</p>
      </div>
    </Backdrop>
  )
}

// ------------------------------------------------------------------ coach --
const COACH_STEPS = ['lane', 'jump', 'slide'] as const
export type CoachStep = (typeof COACH_STEPS)[number] | 'done'

/** One-line coach at the top of the screen for a player's very first run. */
export function TutorialCoach({ step, isTouch, onSkip }: { step: CoachStep; isTouch: boolean; onSkip: () => void }) {
  const t = useT()
  const index = COACH_STEPS.indexOf(step as (typeof COACH_STEPS)[number])
  const text = step === 'done' ? t('tut.done') : t(`tut.${step}${isTouch ? '' : 'Keys'}`)
  return (
    <div className={`ar-coach ${step === 'done' ? 'is-done' : ''}`} role="status">
      {step !== 'done' && <span className="ar-coach-step">{t('tut.step', { n: index + 1 })}</span>}
      <span className="ar-coach-text">{text}</span>
      {step !== 'done' && (
        <button type="button" className="ar-coach-skip" onClick={onSkip}>
          {t('tut.skip')}
        </button>
      )}
    </div>
  )
}

export function nextCoachStep(step: CoachStep, action: string): CoachStep {
  if (step === 'lane' && (action === 'left' || action === 'right')) return 'jump'
  if (step === 'jump' && action === 'jump') return 'slide'
  if (step === 'slide' && action === 'slide') return 'done'
  return step
}
