// Mochiro screens: loading, main menu, pause, results, settings, help, board.
import { ArrowLeftRight, Award, Check, Coins, Globe, HelpCircle, Home, Hourglass, Loader2, Lock, LogIn, Magnet, Medal, Play, Rocket, RotateCcw, Settings as SettingsIcon, Share2, Shield, ShieldPlus, ShoppingBag, Smartphone, Target, Trophy, UserPlus, Volume2, X, type LucideIcon } from 'lucide-react'
import { MochiroLogo } from './MochiroLogo'
import { formatCompact, formatDistance, formatScore, formatSpeed, formatTime } from '../../runner/utils'
import { useEffect, useRef, useState } from 'react'
import { DIFFICULTIES, CHARACTERS, CHARACTER_IDS, heroColorCss, type CharacterId, type CharacterSpec, type DifficultyId } from '../../runner/config'
import { CharacterStage } from '../../runner/stage'
import { formatNumber, useLang, useT, setLang, type Lang } from '../../lib/i18n'
import type { AuthAccount } from '../../lib/auth'
import { loadRunnerName, type BoardScope, type EconomyState, type NameState, type SeasonInfo } from '../../lib/runnerApi'
import { BankChip, RushMenuNudge, achievementsDue, claimableCount, formatLeft, heroPrice, heroUnlocked, inviteDue, useNow } from './RushEconomy'
import { AccountChip } from './AuthGate'
import type {
  ArcBrand,
  GlobalStats,
  HudState,
  LeaderboardEntry,
  ProgressState,
  RunnerProfile,
  RunSummary,
  Settings,
} from '../../runner/types'

export function RushLoading({ progress }: { progress: ProgressState }) {
  const t = useT()
  return (
    <div className="ar-loading">
      <div className="ar-spin" />
      <div className="ar-display text-[15px] tracking-[0.28em] text-[#16233d]">{t('app.name')}</div>
      <div className="ar-loading-bar">
        <span style={{ width: `${Math.round(progress.pct * 100)}%` }} />
      </div>
      <div className="ar-hint">{progress.label}</div>
    </div>
  )
}

/** Every ability has its own glyph, so the six cards can be told apart at a glance and
 *  no card has to spend a line on the word "Ability". */
const PERK_ICONS: Record<string, LucideIcon> = {
  shieldStart: Shield,
  longPower: Hourglass,
  badImmunity: ShieldPlus,
  quickLane: ArrowLeftRight,
  wideMagnet: Magnet,
  longBoost: Rocket,
}

function PerkIcon({ id }: { id: string }) {
  const Icon = PERK_ICONS[id] ?? Shield
  return <Icon size={14} className="ar-char-tile-perk-icon" aria-hidden="true" />
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="ar-stat">
      <div className="ar-stat-value">{value}</div>
      <div className="ar-stat-label">{label}</div>
    </div>
  )
}

export function RushMenu({
  brand,
  name,
  onNameChange,
  onStart,
  onOpen,
  profile,
  character,
  onCharacterChange,
  difficulty,
  onDifficultyChange,
  account,
  onSignOut,
  onSignIn,
  nameState,
  quality,
  economy,
  buying,
  onUnlock,
  canInstall,
  onInstall,
  inviteFrom,
}: {
  economy: EconomyState | null
  buying: boolean
  onUnlock: (id: CharacterId) => void
  /** The browser offered to install the game (or it is iOS Safari, which needs a hint). */
  canInstall: boolean
  onInstall: () => void
  /** Name of the player whose invite link brought a not-yet-signed-in visitor here. */
  inviteFrom: { name: string; welcome: number } | null
  brand: ArcBrand | null
  name: string
  character: CharacterId
  onCharacterChange: (id: CharacterId) => void
  difficulty: DifficultyId
  onDifficultyChange: (id: DifficultyId) => void
  account: AuthAccount | null
  onSignOut: () => void
  onSignIn: () => void
  nameState: NameState
  quality: 'low' | 'medium' | 'high'
  onNameChange: (value: string) => void
  onStart: () => void
  onOpen: (panel: 'help' | 'board' | 'settings' | 'shop' | 'quests' | 'achievements' | 'invite' | 'daily') => void
  profile: RunnerProfile | null
}) {
  const t = useT()
  const lang = useLang()
  const nameNotice =
    nameState === 'taken'
      ? t('name.taken')
      : nameState === 'short'
        ? t('name.short')
        : nameState === 'blocked'
          ? t('name.blocked')
          : null
  const played = (profile?.runs ?? 0) > 0 ? profile : null
  // The field is a value once the name is settled, and a field again the moment it is not.
  // `editing` keeps it mounted while the player is typing: without it, a name that becomes
  // free again would swap the input for the value mid-keystroke and drop the caret.
  const [editing, setEditing] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stageInstance = useRef<CharacterStage | null>(null)
  const [stageReady, setStageReady] = useState(false)

  // One live 3D line-up, mounted with the menu. Clicks on a hero are handled by
  // the stage itself (raycast), so picking works by looking at the character.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const stage = new CharacterStage(
      { canvas, quality, onReady: () => setStageReady(true), onSelect: (id) => onCharacterChange(id) },
      character
    )
    stageInstance.current = stage
    return () => {
      stage.dispose()
      stageInstance.current = null
    }
    // Mounted once per menu visit: the stage owns its own render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality])

  useEffect(() => {
    stageInstance.current?.select(character, false)
  }, [character])

  return (
    <div className="ar-screen ar-screen-menu">
      <div className="ar-panel ar-menu">
        <header className="ar-menu-head">
          <div className="ar-menu-brand">
            <MochiroLogo size={56} />
            <div className="ar-menu-brand-text">
              <h1 className="ar-title">{t('app.name')}</h1>
            </div>
          </div>
          <div className="ar-menu-tools">
            <BankChip bank={economy?.bank ?? null} onClick={() => onOpen('shop')} />
            <div className="ar-lang" role="group" aria-label={t('lang.label')}>
              <Globe size={14} className="ar-lang-icon" />
              {(['vi', 'en'] as Lang[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`ar-lang-btn ${lang === id ? 'is-active' : ''}`}
                  onClick={() => setLang(id)}
                >
                  {id === 'vi' ? 'Tiếng Việt' : 'English'}
                </button>
              ))}
            </div>
            {/* A guest has no account, and the gate only appears once — at startup. Without
                this button there was no way back to sign-in for the rest of the session. */}
            {account ? (
              <AccountChip account={account} name={nameState === 'ok' ? name : null} onSignOut={onSignOut} />
            ) : (
              <button type="button" className="ar-signin" onClick={onSignIn}>
                <LogIn size={14} /> {t('menu.signIn')}
              </button>
            )}
          </div>
        </header>

        <div className="ar-menu-body">
          <section className="ar-menu-heroes">
            <div className="ar-stage" ref={stageRef}>
              <canvas ref={canvasRef} />
              {!stageReady && (
                <div className="ar-stage-loading">
                  <Loader2 size={16} className="ar-spin" /> {t('menu.chooseRunner')}
                </div>
              )}
              {/* The pick is named on the stage itself: the 3D line-up shows who, the plate
                  says who and what they are, in that hero's colour. */}
              <div
                className="ar-stage-plate"
                key={character}
                style={{ ['--ar-accent' as string]: heroColorCss(character) }}
                title={t('menu.tapToPick')}
              >
                <span className="ar-stage-plate-dot" />
                <strong>{CHARACTERS[character].name}</strong>
                <span className="ar-stage-plate-tag">{t(`char.${character}.tag`)}</span>
              </div>
            </div>

            <div className="ar-char-row">
              {(CHARACTER_IDS.map((id) => CHARACTERS[id]) as CharacterSpec[]).map((item) => (
                <button
                  key={item.id}
                  className={`ar-char-tile ${character === item.id ? 'is-active' : ''} ${
                    heroUnlocked(economy, item.id)
                      ? ''
                      : (economy?.bank ?? 0) >= heroPrice(economy, item.id)
                        ? 'is-locked is-affordable'
                        : 'is-locked'
                  }`}
                  style={{ ['--ar-accent' as string]: heroColorCss(item.id) }}
                  onClick={() => onCharacterChange(item.id)}
                >
                  <span className="ar-char-tile-name">{item.name}</span>
                  <span className="ar-char-tile-tag">{t(`char.${item.id}.tag`)}</span>
                  <span className="ar-char-tile-perk" title={t('char.ability')}>
                    <PerkIcon id={item.perk.id} />
                    <span className="ar-char-tile-perk-text">{t(`perk.${item.perk.id}`)}</span>
                  </span>
                  {/* Every card ends in the same status line — in use, owned, or its price —
                      so all six are one shape and the ability panels line up. */}
                  {heroUnlocked(economy, item.id) ? (
                    <span className={`ar-char-tile-foot${character === item.id ? ' is-using' : ''}`}>
                      {character === item.id && <Check size={11} strokeWidth={3} />}
                      {character === item.id ? t('char.inUse') : t('shop.owned')}
                    </span>
                  ) : (
                    <span className="ar-char-tile-price">
                      <Lock size={10} /> {formatNumber(heroPrice(economy, item.id))}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Hero, then difficulty, then go: the two choices that shape the run sit
                together, and the column no longer ends in a slab of empty panel. */}
            <div className="ar-side-block ar-menu-diff">
              <div className="ar-side-label">{t('set.difficulty')}</div>
              <div className="ar-diff-row">
                {DIFFICULTIES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`ar-diff${difficulty === item.id ? ' is-active' : ''}`}
                    onClick={() => onDifficultyChange(item.id)}
                  >
                    {t(`diff.${item.id}`)}
                    <span className="ar-diff-mult">×{DIFFICULTIES.find((d) => d.id === item.id)?.score}</span>
                  </button>
                ))}
              </div>
              <p className="ar-diff-desc">{t(`diff.${difficulty}.desc`)}</p>
            </div>
          </section>

          <aside className="ar-menu-side">
            {/* These are the player's own numbers, not the world's — but having a profile is
                not the same as having played. A row is created for a guest the moment they
                arrive, so `profile` alone proves nothing; `runs > 0` does. Four zeros where
                a scoreboard should be reads as broken, a dash reads as "not yet". */}
            <div className="ar-stats-grid">
              <Stat value={played ? formatScore(played.best_score) : '—'} label={t('menu.best')} />
              <Stat value={played ? formatCompact(played.total_coins) : '—'} label={t('menu.arcTotal')} />
              <Stat value={played ? formatCompact(played.runs) : '—'} label={t('menu.sprints')} />
              <Stat value={played ? formatDistance(played.best_distance) : '—'} label={t('menu.farthest')} />
            </div>

            {/* Signed in, the name belongs to the account: it is set once and edited in
                Settings, not re-typed on every visit. A guest has no account to hold it,
                so the field stays. */}
            <div className="ar-side-block">
              <div className="ar-side-label">{t('menu.runnerName')}</div>
              {account && nameState === 'ok' && !editing ? (
                <div className="ar-name-fixed">{name}</div>
              ) : (
                <input
                  className="ar-input"
                  value={name}
                  maxLength={20}
                  autoFocus={account !== null}
                  onFocus={() => setEditing(true)}
                  onBlur={() => {
                    setEditing(false)
                    // Cleared and left? The last name that was actually stored comes back,
                    // so the field is never left holding nothing.
                    if (!name.trim()) onNameChange(loadRunnerName())
                  }}
                  onChange={(event) => onNameChange(event.target.value)}
                />
              )}
              {nameNotice && <p className="ar-name-error">{nameNotice}</p>}
            </div>

            {/* Not disabled. A taken name is refused where it matters — the save — and the
                run simply keeps the name already on the profile. A dead start button is a
                wall: it stops the player playing over a label. */}
            {heroUnlocked(economy, character) ? (
              <button className="ar-btn ar-btn-primary ar-start" onClick={onStart}>
                <Play size={18} /> {t('menu.start')}
              </button>
            ) : (
              <>
                <button
                  className="ar-btn ar-btn-primary ar-start"
                  disabled={buying || (economy?.bank ?? 0) < heroPrice(economy, character)}
                  onClick={() => onUnlock(character)}
                >
                  <Lock size={17} /> {t('menu.unlock', { price: formatNumber(heroPrice(economy, character)) })}
                </button>
                {(economy?.bank ?? 0) < heroPrice(economy, character) && (
                  <p className="ar-name-error">
                    {t('menu.needMore', { n: formatNumber(heroPrice(economy, character) - (economy?.bank ?? 0)) })}
                  </p>
                )}
              </>
            )}

            <RushMenuNudge economy={economy} onOpen={onOpen} />

            {inviteFrom && !account && (
              <button type="button" className="ar-invite-banner" onClick={onSignIn}>
                <UserPlus size={16} />
                <span>{t('invite.banner', { name: inviteFrom.name, n: formatNumber(inviteFrom.welcome) })}</span>
              </button>
            )}

            <div className="ar-menu-row ar-eco-row">
              <button className="ar-btn" onClick={() => onOpen('shop')}>
                <ShoppingBag size={14} /> {t('menu.shop')}
              </button>
              <button className="ar-btn ar-badged" onClick={() => onOpen('quests')}>
                <Target size={14} /> {t('menu.quests')}
                {claimableCount(economy) > 0 && <span className="ar-badge">{claimableCount(economy)}</span>}
              </button>
              <button className="ar-btn ar-badged" onClick={() => onOpen('achievements')}>
                <Award size={14} /> {t('menu.achievements')}
                {achievementsDue(economy) > 0 && (
                  <span className="ar-badge">{achievementsDue(economy) > 9 ? '9+' : achievementsDue(economy)}</span>
                )}
              </button>
            </div>

            <div className="ar-menu-row ar-menu-row-4">
              <button className="ar-btn ar-badged" onClick={() => onOpen('invite')}>
                <UserPlus size={14} /> {t('menu.invite')}
                {inviteDue(economy) > 0 && <span className="ar-badge">1</span>}
              </button>
              <button className="ar-btn" onClick={() => onOpen('board')}>
                <Trophy size={14} /> {t('menu.board')}
              </button>
              <button className="ar-btn" onClick={() => onOpen('help')}>
                <HelpCircle size={14} /> {t('menu.howTo')}
              </button>
              <button className="ar-btn" onClick={() => onOpen('settings')}>
                <SettingsIcon size={14} /> {t('menu.settings')}
              </button>
            </div>

            {canInstall && (
              <button type="button" className="ar-install" onClick={onInstall}>
                <Smartphone size={15} />
                <span>{t('pwa.install')}</span>
              </button>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

// Every panel below dismisses when the backdrop around it is clicked — the behaviour
// every dialog on the web has. The test is `event.target === event.currentTarget`: the
// click has to land on the backdrop itself, so a click that started inside the panel and
// ended outside it does not dismiss, because the target is then one of the panel's
// children. The pause panel resumes rather than closes, because that is what a click
// outside "paused" means.
export function RushPause({
  hud,
  onResume,
  onRestart,
  onSettings,
  onQuit,
}: {
  hud: HudState | null
  onResume: () => void
  onRestart: () => void
  onSettings: () => void
  onQuit: () => void
}) {
  const t = useT()
  return (
    <div
      className="ar-screen"
      onClick={(event) => {
        if (event.target === event.currentTarget) onResume()
      }}
    >
      <div className="ar-panel ar-modal" style={{ width: 'min(440px, 100%)' }}>
        <div className="ar-modal-title">{t('pause.title')}</div>
        <div className="ar-rows">
          <div className="ar-row">
            <span className="ar-row-name">{t('pause.score')}</span>
            <span className="ar-row-score">{formatScore(hud?.score ?? 0)}</span>
          </div>
          <div className="ar-row">
            <span className="ar-row-name">{t('pause.arc')}</span>
            <span className="ar-row-score">{hud?.coins ?? 0}</span>
          </div>
          <div className="ar-row">
            <span className="ar-row-name">{t('pause.distance')}</span>
            <span className="ar-row-score">{hud?.distance ?? 0} m</span>
          </div>
        </div>
        <div className="ar-menu-actions">
          <button className="ar-btn ar-btn-primary" onClick={onResume}>
            <Play size={15} /> {t('pause.resume')}
          </button>
          <div className="ar-menu-row">
            <button className="ar-btn" onClick={onRestart}>
              <RotateCcw size={14} /> {t('pause.restart')}
            </button>
            <button className="ar-btn" onClick={onSettings}>
              <SettingsIcon size={14} /> {t('menu.settings')}
            </button>
            <button className="ar-btn" onClick={onQuit}>
              <Home size={14} /> {t('over.menu')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function RushGameOver({
  summary,
  submitState,
  rank,
  offBoard,
  onSignIn,
  onRetry,
  onMenu,
  onLeaderboard,
  onRevive,
  banked,
  onShare,
  sharing,
}: {
  banked: number | null
  onShare: () => void
  sharing: boolean
  summary: RunSummary
  submitState: 'idle' | 'sending' | 'done' | 'error'
  rank: number | null
  offBoard: 'guest' | 'unverified' | null
  onSignIn: () => void
  onRetry: () => void
  onMenu: () => void
  onLeaderboard: () => void
  onRevive: () => void
}) {
  const t = useT()
  return (
    <div className="ar-screen">
      <div className="ar-panel ar-modal" style={{ width: 'min(520px, 100%)', textAlign: 'center' }}>
        <div className="ar-modal-title">{t('over.title')}</div>
        <div className="ar-big-score mt-3">{formatScore(summary.score)}</div>
        {summary.record && <div className="ar-record">{t('over.record')}</div>}
        <div className="ar-over-mode">
          <span className={`ar-mode-tag is-${summary.difficulty}`}>{t(`diff.${summary.difficulty}`)}</span>
          {t('over.modeMult', { score: DIFFICULTIES.find((d) => d.id === summary.difficulty)?.score ?? 1 })}
        </div>
        {summary.busted && <div className="ar-bust">{t('over.busted')}</div>}
        <div className="ar-result-grid">
          <Stat value={`${summary.coins}`} label={t('over.arc')} />
          <Stat value={`${summary.distance} m`} label={t('over.distance')} />
          <Stat value={`${formatSpeed(summary.topSpeed)}`} label={t('over.topSpeed')} />
          <Stat value={`${summary.bestCombo}`} label={t('over.bestCombo')} />
          <Stat value={formatTime(summary.duration)} label={t('over.time')} />
          <Stat value={rank ? `#${rank}` : '—'} label={t('over.rank')} />
        </div>
        {summary.missions.length > 0 && (
          <div className="ar-over-missions">
            <div className="ar-over-missions-title">{t('over.missions')}</div>
            {summary.missions.map((mission) => (
              <div key={mission.id} className={`ar-over-mission${mission.done ? ' is-done' : ''}`}>
                <span className="ar-over-mission-name">
                  {mission.done ? <Check size={12} /> : <span className="ar-over-mission-dot" />}
                  {t(`mission.${mission.id}`)}
                </span>
                <span className="ar-over-mission-count">
                  {mission.done ? `+${mission.reward}` : `${mission.progress}/${mission.target}`}
                </span>
              </div>
            ))}
            {summary.nearMisses > 0 && (
              <div className="ar-over-mission">
                <span className="ar-over-mission-name">
                  <span className="ar-over-mission-dot" />
                  {t('over.nearMiss')}
                </span>
                <span className="ar-over-mission-count">{summary.nearMisses}</span>
              </div>
            )}
          </div>
        )}
        {submitState === 'done' && banked !== null && banked > 0 && (
          <div className="ar-banked">
            <Coins size={14} /> {t('over.banked', { n: formatNumber(banked) })}
          </div>
        )}
        <div className="ar-hint mt-4">
          {submitState === 'sending' && t('over.submitting')}
          {submitState === 'done' && !offBoard && (rank ? `${t('over.submitted')} #${rank}` : t('over.submitted'))}
          {submitState === 'done' && offBoard === 'guest' && (
            <>
              {t('over.guestSaved')}{' '}
              <button type="button" className="ar-link" onClick={onSignIn}>
                {t('over.guestSignIn')}
              </button>
            </>
          )}
          {submitState === 'done' && offBoard === 'unverified' && t('over.unverified')}
          {submitState === 'error' && t('menu.connecting')}
        </div>
        <div className="ar-menu-actions">
          {!summary.revived && summary.coins >= summary.reviveCost && (
            <>
              <button className="ar-btn ar-btn-primary py-4" onClick={onRevive}>
                <Shield size={16} /> {t('over.revive')} · {summary.reviveCost} {t('over.reviveCost')}
              </button>
              <div className="ar-hint">{t('over.reviveHint')}</div>
            </>
          )}
          {!summary.revived && summary.coins < summary.reviveCost && <div className="ar-hint">{t('over.noCoins')}</div>}
          {/* The revive button above is the hero action of this screen; "sprint again"
              is the ordinary one. Both were filled gradients, so neither read as the
              choice — two primaries is the same as none. */}
          <div className="ar-menu-row">
            <button className="ar-btn py-4" onClick={onRetry}>
              <RotateCcw size={16} /> {t('over.again')}
            </button>
            <button className="ar-btn ar-btn-share py-4" disabled={sharing} onClick={onShare}>
              {sharing ? <Loader2 size={16} className="ar-spin-icon" /> : <Share2 size={16} />} {t('over.share')}
            </button>
          </div>
          <div className="ar-menu-row">
            <button className="ar-btn" onClick={onLeaderboard}>
              <Trophy size={14} /> {t('over.board')}
            </button>
            <button className="ar-btn" onClick={onMenu}>
              <Home size={14} /> {t('over.menu')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="ar-setting">
      <div className="ar-setting-head">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <input
        className="ar-range"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button className="ar-toggle w-full" onClick={() => onChange(!value)}>
      <span>{label}</span>
      <span className={`ar-switch ${value ? 'ar-switch-on' : ''}`} />
    </button>
  )
}

export function RushSettings({
  settings,
  onChange,
  onClose,
  name,
  onNameChange,
  nameState,
}: {
  settings: Settings
  onChange: (settings: Settings) => void
  onClose: () => void
  name: string
  onNameChange: (value: string) => void
  nameState: NameState
}) {
  const t = useT()
  const lang = useLang()
  const nameNotice =
    nameState === 'taken'
      ? t('name.taken')
      : nameState === 'short'
        ? t('name.short')
        : nameState === 'blocked'
          ? t('name.blocked')
          : null
  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  const qualities: Array<{ id: Settings['quality']; label: string }> = [
    { id: 'auto', label: t('set.quality.auto') },
    { id: 'low', label: t('set.quality.low') },
    { id: 'medium', label: t('set.quality.medium') },
    { id: 'high', label: t('set.quality.high') },
  ]

  return (
    <div
      className="ar-screen"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ar-panel ar-modal">
        <div className="flex items-center justify-between">
          <div className="ar-modal-title">
            <Volume2 size={15} className="mr-2 inline" />
            {t('set.title')}
          </div>
          <button className="ar-btn ar-btn-sm" onClick={onClose}>
            <X size={14} /> {t('board.close')}
          </button>
        </div>

        {/* The one place a name can be changed once it is attached to an account. */}
        <div className="ar-setting">
          <div className="ar-setting-head">
            <span>{t('menu.runnerName')}</span>
          </div>
          <input
            className="ar-input"
            value={name}
            maxLength={20}
            onChange={(event) => onNameChange(event.target.value)}
          />
          {nameNotice && <p className="ar-name-error">{nameNotice}</p>}
        </div>

        <Slider label={t('set.master')} value={settings.master} onChange={(master) => update({ master })} />
        <Slider label={t('set.music')} value={settings.music} onChange={(music) => update({ music })} />
        <Slider label={t('set.effects')} value={settings.sfx} onChange={(sfx) => update({ sfx })} />

        <div className="ar-setting">
          <div className="ar-setting-head">
            <span>{t('set.graphics')}</span>
            <span>{settings.quality === 'auto' ? t('set.quality.adaptive') : t(`set.quality.${settings.quality}`)}</span>
          </div>
          <div className="ar-seg">
            {qualities.map((quality) => (
              <button
                key={quality.id}
                className={`ar-btn ar-btn-sm ${settings.quality === quality.id ? 'ar-seg-active' : ''}`}
                onClick={() => update({ quality: quality.id })}
              >
                {quality.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ar-rows">
          <Toggle label={t('set.shake')} value={settings.shake} onChange={(shake) => update({ shake })} />
          <Toggle label={t('set.fps')} value={settings.showFps} onChange={(showFps) => update({ showFps })} />
        </div>
      </div>
    </div>
  )
}

export function RushHelp({
  onClose,
  isTouch,
  brand,
}: {
  onClose: () => void
  isTouch: boolean
  brand: ArcBrand | null
}) {
  const t = useT()
  const keys: Array<{ key: string; label: string }> = [
    { key: 'A / D', label: t('help.lane') },
    { key: 'SPACE', label: t('help.jumpBarrier') },
    { key: 'S', label: t('help.slideBar') },
    { key: 'ESC', label: t('help.pause') },
  ]
  const touch: Array<{ key: string; label: string }> = [
    { key: 'SWIPE ←→', label: t('help.lane') },
    { key: 'SWIPE ↑', label: t('help.jump') },
    { key: 'SWIPE ↓', label: t('help.slide') },
    { key: 'TAP', label: t('help.jump') },
  ]

  return (
    <div
      className="ar-screen"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ar-panel ar-modal">
        <div className="flex items-center justify-between">
          <div className="ar-modal-title">{t('help.title')}</div>
          <button className="ar-btn ar-btn-sm" onClick={onClose}>
            <X size={14} /> {t('board.close')}
          </button>
        </div>

        <p className="mt-4 text-[14px] leading-relaxed text-[#3c5170]">
          {t('help.intro', { brand: brand?.name ?? 'Arc' })}
        </p>

        <div className="ar-keys">
          {(isTouch ? touch : keys).map((item) => (
            <div key={item.key} className="ar-key">
              <kbd>{item.key}</kbd>
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        <div className="ar-rows">
          <div className="ar-row">
            <span className="ar-row-name">{t('help.pickups')}</span>
            <span className="ar-row-sub">
              <span className="ar-legend-good">{t('help.boons')}</span>
              <span className="ar-legend-sep"> · </span>
              <span className="ar-legend-bad">{t('help.hazards')}</span>
            </span>
          </div>
          <div className="ar-row">
            <span className="ar-row-name">{t('help.obstacles')}</span>
            <span className="ar-row-sub">{t('help.obstaclesSub')}</span>
          </div>
          <div className="ar-row">
            <span className="ar-row-name" style={{ color: '#5ce1ff' }}>
              {t('power.shield.label')}
            </span>
            <span className="ar-row-sub">{t('power.shield.hint')}</span>
          </div>
          <div className="ar-row">
            <span className="ar-row-name" style={{ color: '#c084fc' }}>
              {t('power.magnet.label')}
            </span>
            <span className="ar-row-sub">{t('power.magnet.hint')}</span>
          </div>
          <div className="ar-row">
            <span className="ar-row-name" style={{ color: '#ffb347' }}>
              {t('power.boost.label')}
            </span>
            <span className="ar-row-sub">{t('power.boost.hint')}</span>
          </div>
          <div className="ar-row">
            <span className="ar-row-name">{t('help.scoring')}</span>
            <span className="ar-row-sub">{t('help.payout')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function RushLeaderboard({
  entries,
  stats,
  onClose,
  highlightRank,
  scope,
  onScope,
  season,
}: {
  entries: LeaderboardEntry[]
  stats: GlobalStats | null
  onClose: () => void
  highlightRank: number | null
  scope: BoardScope
  onScope: (scope: BoardScope) => void
  season: SeasonInfo | null
}) {
  const t = useT()
  const now = useNow()
  return (
    <div
      className="ar-screen"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ar-panel ar-modal">
        <div className="flex items-center justify-between">
          <div className="ar-modal-title">
            <Trophy size={15} className="mr-2 inline" />
            {t('board.title')}
          </div>
          <button className="ar-btn ar-btn-sm" onClick={onClose}>
            <X size={14} /> {t('board.close')}
          </button>
        </div>

        <div className="ar-seg mt-3">
          {(['week', 'all'] as BoardScope[]).map((id) => (
            <button
              key={id}
              className={`ar-btn ar-btn-sm ${scope === id ? 'ar-seg-active' : ''}`}
              onClick={() => onScope(id)}
            >
              {t(id === 'week' ? 'season.week' : 'season.all')}
            </button>
          ))}
        </div>

        {scope === 'week' && season && (
          <div className="ar-season-box">
            <div className="ar-season-ends">
              <Trophy size={14} /> {t('season.ends', { time: formatLeft(season.endsAt, now) })}
            </div>
            <div className="ar-row-sub">{t('season.prizes')}</div>
            {season.lastWeekTop.length > 0 && (
              <div className="ar-season-last">
                <span className="ar-row-sub">{t('season.lastTop')}:</span>
                {season.lastWeekTop.map((entry, index) => (
                  <span key={entry.id} className="ar-season-champ">
                    {['🥇', '🥈', '🥉'][index]} {entry.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="ar-hint mt-3">
          {stats
            ? t('board.stats', {
                runs: formatCompact(stats.runs),
                coins: formatCompact(stats.coins),
                far: formatDistance(stats.best_distance),
              })
            : '—'}
        </div>

        <div className="ar-rows">
          {entries.length === 0 && <div className="ar-row">{t('board.empty')}</div>}
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              className={`ar-row ${scope === 'all' && highlightRank === index + 1 ? 'ar-row-highlight' : ''}`}
            >
              <span className={`ar-rank ${index < 3 ? 'ar-rank-medal' : ''}`}>
                {index < 3 ? <Medal size={16} /> : index + 1}
              </span>
              <div className="flex-1 overflow-hidden">
                <div className="ar-row-name">
                  {entry.name}
                  {entry.difficulty && entry.difficulty !== 'normal' && (
                    <span className={`ar-mode-tag is-${entry.difficulty}`}>{t(`diff.${entry.difficulty}`)}</span>
                  )}
                </div>
                <div className="ar-row-sub">
                  {t('board.row', {
                    coins: entry.coins,
                    dist: formatDistance(entry.distance_m),
                    speed: formatSpeed(entry.top_speed),
                  })}
                </div>
              </div>
              <span className="ar-row-score">{formatScore(entry.score)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** iOS Safari has no install button of its own to call, so the steps are shown instead. */
export function RushInstallHint({ onClose }: { onClose: () => void }) {
  const t = useT()
  return (
    <div
      className="ar-screen"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ar-panel ar-modal" style={{ width: 'min(420px, 100%)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="ar-modal-title">
            <Smartphone size={15} className="mr-2 inline" />
            {t('pwa.title')}
          </div>
          <button className="ar-btn ar-btn-sm" onClick={onClose}>
            <X size={14} /> {t('board.close')}
          </button>
        </div>
        <div className="ar-invite-steps mt-3">
          <div>
            <span>1</span>
            {t('pwa.ios1')}
          </div>
          <div>
            <span>2</span>
            {t('pwa.ios2')}
          </div>
          <div>
            <span>3</span>
            {t('pwa.ios3')}
          </div>
        </div>
        <p className="ar-hint mt-3">{t('pwa.why')}</p>
      </div>
    </div>
  )
}
