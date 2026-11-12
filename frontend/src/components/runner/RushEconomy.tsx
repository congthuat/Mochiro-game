// Mochiro meta screens: wallet chip, shop, daily reward, daily quests, season reward and
// the first-run coach. All coin movement is decided by the server (/api/economy); these
// components only ask and then show whatever state the server sends back.
import {
  Award,
  CalendarCheck,
  Check,
  Coins,
  Copy,
  Flame,
  Footprints,
  Gift,
  Lock,
  LogIn,
  Route,
  Share2,
  ShoppingBag,
  Skull,
  Sparkles,
  Star,
  Target,
  Trophy,
  UserPlus,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { CHARACTERS, CHARACTER_IDS, heroColorCss, type CharacterId } from '../../runner/config'
import { formatDistance } from '../../runner/utils'
import { formatNumber, getLang, useT } from '../../lib/i18n'
import { inviteLink, type AchievementGroup, type EconomyState, type UpgradeKind } from '../../lib/runnerApi'
import { copyText, shareCard } from '../../lib/shareCard'

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

/** Achievement tiers reached but not yet cashed in. */
export function achievementsDue(economy: EconomyState | null): number {
  return (economy?.achievements ?? []).reduce(
    (sum, group) => sum + group.tiers.filter((tier) => tier.reached && !tier.claimed).length,
    0
  )
}

/** 1 when the invited player's welcome bonus is ready to collect. */
export function inviteDue(economy: EconomyState | null): number {
  const mine = economy?.invite?.mine
  return mine && mine.ready && !mine.paid ? 1 : 0
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
            {[...CHARACTER_IDS].sort((a, b) => heroPrice(economy, a) - heroPrice(economy, b)).map((id) => {
              const spec = CHARACTERS[id]
              const price = heroPrice(economy, id)
              const owned = heroUnlocked(economy, id)
              const short = Math.max(0, price - economy.bank)
              const accent = heroColorCss(id)
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

/**
 * "Today" on the menu: the daily gift and each of today's quests on one line apiece.
 * Anything ready to collect glows and says how much; the rest shows how close it is.
 * Every row opens the panel where it is collected, so the menu never has to guess
 * which claim the player meant.
 */
export function RushToday({
  economy,
  onOpen,
}: {
  economy: EconomyState | null
  onOpen: (panel: 'daily' | 'quests') => void
}) {
  const t = useT()
  const now = useNow()
  if (!economy) return null
  const daily = economy.daily
  const last = economy.season.lastWeek
  return (
    <section className="ar-today" aria-label={t('today.title')}>
      <div className="ar-today-head">
        <span className="ar-side-label">{t('today.title')}</span>
        <span className="ar-today-reset">{t('quest.resets', { time: formatLeft(economy.resetsAt, now) })}</span>
      </div>
      <button
        type="button"
        className={`ar-today-row${daily.claimable ? ' is-ready' : ' is-done'}`}
        onClick={() => onOpen('daily')}
      >
        <Gift size={15} className="ar-today-icon" />
        <span className="ar-today-label">
          {daily.claimable ? t('today.daily', { d: daily.nextDay }) : t('today.dailyDone')}
        </span>
        {daily.claimable ? (
          <span className="ar-today-pill">{t('today.collect', { n: formatNumber(daily.nextReward) })}</span>
        ) : (
          <Check size={15} className="ar-today-check" />
        )}
      </button>
      {last.claimable && (
        <button type="button" className="ar-today-row is-ready" onClick={() => onOpen('quests')}>
          <Trophy size={15} className="ar-today-icon" />
          <span className="ar-today-label">{t('season.reward', { rank: last.rank ?? '' })}</span>
          <span className="ar-today-pill">{t('today.collect', { n: formatNumber(last.reward) })}</span>
        </button>
      )}
      {economy.quests.map((quest) => {
        const ready = !quest.claimed && quest.progress >= quest.target
        const pct = Math.max(0, Math.min(1, quest.progress / Math.max(1, quest.target)))
        return (
          <button
            key={quest.id}
            type="button"
            className={`ar-today-row${ready ? ' is-ready' : quest.claimed ? ' is-done' : ''}`}
            onClick={() => onOpen('quests')}
          >
            <Target size={15} className="ar-today-icon" />
            <span className="ar-today-label">{questLabel(t, quest.id, quest.target)}</span>
            {ready ? (
              <span className="ar-today-pill">{t('today.collect', { n: formatNumber(quest.reward) })}</span>
            ) : quest.claimed ? (
              <Check size={15} className="ar-today-check" />
            ) : (
              <>
                <span className="ar-today-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(pct * 100)}%` }} />
                </span>
                <span className="ar-today-reward">+{formatNumber(quest.reward)}</span>
              </>
            )}
          </button>
        )
      })}
    </section>
  )
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

// ----------------------------------------------------------- achievements --
const ACH_ICONS: Record<string, LucideIcon> = {
  distance: Route,
  score: Star,
  combo: Flame,
  runs: Footprints,
  coins: Coins,
  hard: Skull,
  heroes: Users,
  upgrades: Zap,
  streak: CalendarCheck,
  quests: Target,
  friends: UserPlus,
}

/** How a target reads in a goal line: metres for distance, plain numbers otherwise. */
/** A goal reads "1 km" or "2.5 km", not the HUD's "1.00 km". */
function goalDistance(m: number): string {
  if (m < 1000 || m % 100 !== 0) return formatDistance(m)
  return `${new Intl.NumberFormat(getLang() === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 1 }).format(m / 1000)} km`
}

function achTarget(id: string, n: number): string {
  return id === 'distance' || id === 'hard' ? goalDistance(n) : formatNumber(n)
}

function AchievementRow({
  group,
  busy,
  onClaim,
}: {
  group: AchievementGroup
  busy: boolean
  onClaim: (group: string) => void
}) {
  const t = useT()
  const Icon = ACH_ICONS[group.id] ?? Award
  const reached = group.tiers.filter((tier) => tier.reached).length
  const due = group.tiers.filter((tier) => tier.reached && !tier.claimed)
  const dueTotal = due.reduce((sum, tier) => sum + tier.reward, 0)
  const next = group.tiers.find((tier) => !tier.reached) ?? null
  const prevTarget = reached > 0 ? group.tiers[reached - 1].target : 0
  const pct = next ? Math.max(0, Math.min(100, ((group.value - prevTarget) / (next.target - prevTarget)) * 100)) : 100
  const allDone = !next && due.length === 0
  const goal = next ?? group.tiers[group.tiers.length - 1]
  return (
    <div className={`ar-ach ${due.length ? 'is-due' : ''} ${allDone ? 'is-done' : ''}`}>
      <span className="ar-ach-icon">
        <Icon size={20} />
      </span>
      <div className="flex-1 overflow-hidden">
        <div className="ar-ach-head">
          <span className="ar-row-name">{t(`ach.${group.id}`)}</span>
          <span className="ar-ach-pips" aria-label={t('ach.tier', { n: reached, max: group.tiers.length })}>
            {group.tiers.map((tier) => (
              <span key={tier.id} className={tier.claimed ? 'is-on' : tier.reached ? 'is-due' : ''} />
            ))}
          </span>
        </div>
        <div className="ar-ach-goal">{t(`ach.${group.id}.goal`, { n: achTarget(group.id, goal.target) })}</div>
        <div className="ar-quest-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="ar-row-sub">
          {next
            ? `${achTarget(group.id, Math.min(group.value, next.target))} / ${achTarget(group.id, next.target)} · +${formatNumber(next.reward)} Arc`
            : t('ach.maxed')}
        </div>
      </div>
      {due.length > 0 ? (
        <button className="ar-btn ar-btn-sm ar-btn-primary" disabled={busy} onClick={() => onClaim(group.id)}>
          <Sparkles size={13} /> +{formatNumber(dueTotal)}
        </button>
      ) : allDone ? (
        <span className="ar-up-max">
          <Check size={13} /> {t('ach.done')}
        </span>
      ) : (
        <span className="ar-ach-lock">
          <Lock size={13} />
        </span>
      )}
    </div>
  )
}

export function RushAchievements({
  economy,
  busy,
  note,
  guest,
  onClaim,
  onClose,
}: {
  economy: EconomyState
  busy: string | null
  note: EcoNote
  guest: boolean
  onClaim: (group?: string) => void
  onClose: () => void
}) {
  const t = useT()
  const groups = economy.achievements ?? []
  const totalTiers = groups.reduce((sum, g) => sum + g.tiers.length, 0)
  const reachedTiers = groups.reduce((sum, g) => sum + g.tiers.filter((tier) => tier.reached).length, 0)
  const due = achievementsDue(economy)
  const dueTotal = groups.reduce(
    (sum, g) => sum + g.tiers.filter((tier) => tier.reached && !tier.claimed).reduce((a, tier) => a + tier.reward, 0),
    0
  )
  // Claimable first, then the closest to the next tier, finished groups last.
  const sorted = [...groups].sort((a, b) => rank(b) - rank(a))
  function rank(g: AchievementGroup): number {
    const dueNow = g.tiers.some((tier) => tier.reached && !tier.claimed)
    const next = g.tiers.find((tier) => !tier.reached)
    if (dueNow) return 3
    if (!next) return 0
    return 1 + Math.min(0.99, g.value / next.target)
  }
  const life = economy.lifetime
  return (
    <Backdrop onClose={onClose}>
      <div className="ar-panel ar-modal ar-ach-panel">
        <PanelHead icon={<Award size={15} className="mr-2 inline" />} title={t('ach.title')} onClose={onClose} />
        <div className="ar-shop-top">
          <BankChip bank={economy.bank} />
          <span className="ar-hint">{t('ach.progress', { n: reachedTiers, max: totalTiers })}</span>
        </div>
        {life && (
          <div className="ar-life">
            <div>
              <b>{formatNumber(life.runs)}</b>
              <span>{t('menu.sprints')}</span>
            </div>
            <div>
              <b>{formatDistance(life.best_distance)}</b>
              <span>{t('menu.farthest')}</span>
            </div>
            <div>
              <b>{formatNumber(life.coins)}</b>
              <span>{t('ach.lifeCoins')}</span>
            </div>
          </div>
        )}
        {note && <div className={`ar-eco-note ${note.tone === 'bad' ? 'is-bad' : ''}`}>{note.text}</div>}
        {due > 1 && (
          <button className="ar-btn ar-btn-primary ar-ach-all" disabled={busy !== null} onClick={() => onClaim()}>
            <Sparkles size={15} /> {t('ach.claimAll', { n: formatNumber(dueTotal) })}
          </button>
        )}
        <div className="ar-rows ar-ach-list">
          {sorted.map((group) => (
            <AchievementRow key={group.id} group={group} busy={busy !== null} onClaim={onClaim} />
          ))}
        </div>
        <p className="ar-hint mt-3">{guest ? t('ach.guest') : t('ach.note')}</p>
      </div>
    </Backdrop>
  )
}

// ----------------------------------------------------------------- invite --
export function RushInvite({
  economy,
  busy,
  note,
  inviteFrom,
  onSignIn,
  onClaim,
  onClose,
}: {
  economy: EconomyState
  busy: string | null
  note: EcoNote
  inviteFrom?: { name: string; welcome: number } | null
  onSignIn: () => void
  onClaim: () => void
  onClose: () => void
}) {
  const t = useT()
  const invite = economy.invite
  const rules = economy.catalog.invite ?? { welcome: 1000, reward: 1500, needDistance: 1000, cap: 10, joinWindowDays: 14 }
  const [copied, setCopied] = useState(false)
  const link = invite?.code ? inviteLink(invite.code) : null
  const mine = invite?.mine ?? null

  const copy = async () => {
    if (!link) return
    if (await copyText(link)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }
  }
  const share = async () => {
    if (!link) return
    const outcome = await shareCard(null, t('invite.shareText', { n: formatNumber(rules.welcome) }), link)
    if (outcome === 'copied' || outcome === 'failed') void copy()
  }

  return (
    <Backdrop onClose={onClose}>
      <div className="ar-panel ar-modal ar-invite" style={{ width: 'min(520px, 100%)' }}>
        <PanelHead icon={<UserPlus size={15} className="mr-2 inline" />} title={t('invite.title')} onClose={onClose} />
        {note && <div className={`ar-eco-note ${note.tone === 'bad' ? 'is-bad' : ''}`}>{note.text}</div>}

        {!mine && inviteFrom && (
          <div className="ar-invite-mine">
            <Gift size={20} />
            <div className="flex-1">
              <div className="ar-row-name">{t('invite.from', { name: inviteFrom.name })}</div>
              <div className="ar-row-sub">{t('invite.pending', { n: formatNumber(inviteFrom.welcome) })}</div>
            </div>
            <button className="ar-btn ar-btn-sm ar-btn-primary" onClick={onSignIn}>
              {t('menu.signIn')}
            </button>
          </div>
        )}

        {mine && (
          <div className={`ar-invite-mine ${mine.paid ? 'is-paid' : ''}`}>
            <Gift size={20} />
            <div className="flex-1">
              <div className="ar-row-name">{t('invite.from', { name: mine.by })}</div>
              <div className="ar-row-sub">
                {mine.paid
                  ? t('invite.welcomePaid', { n: formatNumber(rules.welcome) })
                  : mine.ready
                    ? t('invite.welcomeReady', { n: formatNumber(rules.welcome) })
                    : t('invite.welcomeNeed', { m: goalDistance(rules.needDistance), n: formatNumber(rules.welcome) })}
              </div>
            </div>
            {!mine.paid && (
              <button className="ar-btn ar-btn-sm ar-btn-primary" disabled={!mine.ready || busy !== null} onClick={onClaim}>
                {mine.ready ? <Sparkles size={13} /> : <Lock size={13} />} {t('quest.claim')}
              </button>
            )}
          </div>
        )}

        <div className="ar-invite-steps">
          <div>
            <span>1</span>
            {t('invite.step1')}
          </div>
          <div>
            <span>2</span>
            {t('invite.step2', { m: goalDistance(rules.needDistance) })}
          </div>
          <div>
            <span>3</span>
            {t('invite.step3', { you: formatNumber(rules.reward), them: formatNumber(rules.welcome) })}
          </div>
        </div>

        {link ? (
          <>
            <div className="ar-invite-link">
              <span className="ar-invite-code">{invite?.code}</span>
              <span className="ar-invite-url">{link.replace(/^https?:\/\//, '')}</span>
            </div>
            <div className="ar-menu-row">
              <button className="ar-btn ar-btn-primary" onClick={() => void share()}>
                <Share2 size={14} /> {t('invite.share')}
              </button>
              <button className="ar-btn" onClick={() => void copy()}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('auth.copied') : t('invite.copy')}
              </button>
            </div>
            <div className="ar-invite-stats">
              <div>
                <b>
                  {invite?.joined ?? 0}/{rules.cap}
                </b>
                <span>{t('invite.joined')}</span>
              </div>
              <div>
                <b>{invite?.paid ?? 0}</b>
                <span>{t('invite.paid')}</span>
              </div>
              <div>
                <b>{formatNumber((invite?.paid ?? 0) * rules.reward)}</b>
                <span>{t('invite.earned')}</span>
              </div>
            </div>
          </>
        ) : inviteFrom ? null : (
          <div className="ar-menu-actions">
            <p className="ar-hint">{t('invite.signIn')}</p>
            <button className="ar-btn ar-btn-primary py-3" onClick={onSignIn}>
              <LogIn size={15} /> {t('menu.signIn')}
            </button>
          </div>
        )}
        <p className="ar-hint mt-3">{t('invite.note', { cap: rules.cap })}</p>
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
