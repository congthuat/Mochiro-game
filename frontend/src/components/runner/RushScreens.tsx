// Mochiro screens: loading, main menu, pause, results, settings, help, board.
import { Check, HelpCircle, Home, Loader2, LogIn, Medal, Play, RotateCcw, Settings as SettingsIcon, Shield, Trophy, Volume2, X } from 'lucide-react'
import { MochiroLogo } from './MochiroLogo'
import { formatCompact, formatDistance, formatScore, formatSpeed, formatTime } from '../../runner/utils'
import { useEffect, useRef, useState } from 'react'
import { DIFFICULTIES, CHARACTERS, CHARACTER_IDS, type CharacterId, type CharacterSpec, type DifficultyId } from '../../runner/config'
import { CharacterStage } from '../../runner/stage'
import { useLang, useT, setLang, type Lang } from '../../lib/i18n'
import type { AuthAccount } from '../../lib/auth'
import { loadRunnerName, type NameState } from '../../lib/runnerApi'
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
}: {
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
  onOpen: (panel: 'help' | 'board' | 'settings') => void
  profile: RunnerProfile | null
}) {
  const t = useT()
  const lang = useLang()
  const nameNotice =
    nameState === 'taken' ? t('name.taken') : nameState === 'short' ? t('name.short') : null
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
            <div className="ar-lang" role="group" aria-label={t('lang.label')}>
              {(['vi', 'en'] as Lang[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`ar-lang-btn ${lang === id ? 'is-active' : ''}`}
                  onClick={() => setLang(id)}
                >
                  {id === 'vi' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
                </button>
              ))}
            </div>
            {/* A guest has no account, and the gate only appears once — at startup. Without
                this button there was no way back to sign-in for the rest of the session. */}
            {account ? (
              <AccountChip account={account} onSignOut={onSignOut} />
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
              <div className="ar-stage-hint">{t('menu.tapToPick')}</div>
            </div>

            <div className="ar-char-row">
              {(CHARACTER_IDS.map((id) => CHARACTERS[id]) as CharacterSpec[]).map((item) => (
                <button
                  key={item.id}
                  className={`ar-char-tile ${character === item.id ? 'is-active' : ''}`}
                  style={{ ['--ar-accent' as string]: `#${item.accent.toString(16).padStart(6, '0')}` }}
                  onClick={() => onCharacterChange(item.id)}
                >
                  <span className="ar-char-tile-name">{item.name}</span>
                  <span className="ar-char-tile-tag">{t(`char.${item.id}.tag`)}</span>
                  <span className="ar-char-tile-perk">
                    <span className="ar-char-tile-perk-label">{t('char.ability')}</span>
                    <span className="ar-char-tile-perk-text">{t(`perk.${item.perk.id}`)}</span>
                  </span>
                </button>
              ))}
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

            <div className="ar-side-block">
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
                  </button>
                ))}
              </div>
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
            <button className="ar-btn ar-btn-primary ar-start" onClick={onStart}>
              <Play size={18} /> {t('menu.start')}
            </button>

            <div className="ar-menu-row">
              <button className="ar-btn" onClick={() => onOpen('help')}>
                <HelpCircle size={14} /> {t('menu.howTo')}
              </button>
              <button className="ar-btn" onClick={() => onOpen('board')}>
                <Trophy size={14} /> {t('menu.board')}
              </button>
              <button className="ar-btn" onClick={() => onOpen('settings')}>
                <SettingsIcon size={14} /> {t('menu.settings')}
              </button>
            </div>
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
  onRetry,
  onMenu,
  onLeaderboard,
  onRevive,
}: {
  summary: RunSummary
  submitState: 'idle' | 'sending' | 'done' | 'error'
  rank: number | null
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
        <div className="ar-hint mt-4">
          {submitState === 'sending' && t('over.submitting')}
          {submitState === 'done' && (rank ? `${t('over.submitted')} #${rank}` : t('over.submitted'))}
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
          <button className="ar-btn py-4" onClick={onRetry}>
            <RotateCcw size={16} /> {t('over.again')}
          </button>
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
    nameState === 'taken' ? t('name.taken') : nameState === 'short' ? t('name.short') : null
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
}: {
  entries: LeaderboardEntry[]
  stats: GlobalStats | null
  onClose: () => void
  highlightRank: number | null
}) {
  const t = useT()
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
              className={`ar-row ${highlightRank === index + 1 ? 'ar-row-highlight' : ''}`}
            >
              <span className={`ar-rank ${index < 3 ? 'ar-rank-medal' : ''}`}>
                {index < 3 ? <Medal size={16} /> : index + 1}
              </span>
              <div className="flex-1 overflow-hidden">
                <div className="ar-row-name">{entry.name}</div>
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
