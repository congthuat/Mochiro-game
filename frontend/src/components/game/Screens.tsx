import { useEffect, useState, type ReactNode } from 'react'
import {
  Activity,
  BatteryCharging,
  ChevronRight,
  Clock,
  Crown,
  Droplets,
  Feather,
  Gem,
  Heart,
  Info,
  Keyboard,
  Magnet,
  MoveRight,
  Play,
  Radar as RadarIcon,
  RotateCcw,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
  Skull,
  Sparkles,
  Timer,
  TrendingUp,
  Trophy,
  User,
  Volume2,
  Wind,
  X,
  Zap,
} from 'lucide-react'
import type { HudState, ProgressState, RunSummary, Settings, UpgradeChoice } from '../../game/types'
import { formatScore, formatTime } from '../../game/utils'
import type { GlobalStats, LeaderboardEntry, Profile } from '../../lib/profile'

const UPGRADE_ICONS: Record<string, typeof Heart> = {
  heart: Heart,
  wind: Wind,
  zap: Zap,
  radar: RadarIcon,
  'move-right': MoveRight,
  'battery-charging': BatteryCharging,
  magnet: Magnet,
  shield: Shield,
  droplets: Droplets,
  feather: Feather,
  timer: Timer,
  'shield-check': ShieldCheck,
}

function UpgradeIcon({ name, size = 22 }: { name: string; size?: number }) {
  const Icon = UPGRADE_ICONS[name] ?? Sparkles
  return <Icon size={size} />
}

export function LoadingScreen({ progress }: { progress: ProgressState }) {
  return (
    <div className="ae-grid-line absolute inset-0 flex flex-col items-center justify-center bg-[#04060e]/95">
      <div className="ae-fade-in w-[min(560px,88vw)] text-center">
        <div className="ae-title text-[clamp(34px,7vw,64px)] leading-none">Aetherfall</div>
        <div className="ae-sub mt-3">Guardian of the Shards</div>

        <div className="ae-progress mt-10">
          <div className="ae-progress-fill" style={{ width: `${Math.max(4, progress.pct * 100)}%` }} />
        </div>
        <div className="mt-3 flex items-center justify-between text-[12px] text-[#93a7c9]">
          <span className="tracking-[0.28em] uppercase">{progress.label || 'Booting'}</span>
          <span className="tabular-nums">{Math.round(progress.pct * 100)}%</span>
        </div>

        {progress.tip && (
          <div className="ae-panel-soft mt-8 px-4 py-3 text-left text-[13px] text-[#b9cdea]">
            <span className="mr-2 text-[#8fe6ff]">TIP</span>
            {progress.tip}
          </div>
        )}
      </div>
    </div>
  )
}

export function PanelShell({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#03060e]/70 p-4 backdrop-blur-sm">
      <div className={`ae-panel ae-rise max-h-[86vh] w-full overflow-hidden ${wide ? 'max-w-[880px]' : 'max-w-[560px]'}`}>
        <div className="flex items-start justify-between border-b border-[#7abeff]/12 px-6 py-4">
          <div>
            <div className="ae-display text-[15px] text-[#dff2ff]">{title}</div>
            {subtitle && <div className="mt-1 text-[12px] text-[#93a7c9]">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="ae-btn ae-btn-ghost !px-3 !py-2" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="ae-scroll max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

export function MainMenu({
  onStart,
  onOpen,
  name,
  onNameChange,
  profile,
  entries,
  stats,
}: {
  onStart: () => void
  onOpen: (panel: 'settings' | 'help' | 'leaderboard') => void
  name: string
  onNameChange: (value: string) => void
  profile: Profile | null
  entries: LeaderboardEntry[]
  stats: GlobalStats | null
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.target as HTMLElement)?.tagName !== 'INPUT') onStart()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onStart])

  const top = entries.slice(0, 5)

  return (
    <div className="absolute inset-0 flex items-center">
      <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(3,6,14,0.95)_0%,rgba(3,6,14,0.74)_45%,rgba(3,6,14,0.2)_100%)]" />

      <div className="ae-slide-in relative ml-[clamp(18px,5vw,86px)] w-[min(540px,88vw)]">
        <div className="ae-sub">A three-dimensional action adventure</div>
        <h1 className="ae-title mt-2 text-[clamp(40px,7vw,74px)] leading-[0.95]">Aetherfall</h1>
        <p className="mt-4 max-w-[440px] text-[15px] leading-relaxed text-[#b9cdea]">
          Five shattered isles. One guardian. Recover the aether shards, cleanse the shadow host, and face the Colossus
          in the Sky Citadel.
        </p>

        <div className="mt-7 w-[min(360px,80vw)]">
          <label className="ae-sub mb-2 flex items-center gap-2">
            <User size={12} /> Guardian name
          </label>
          <input
            className="ae-input"
            value={name}
            maxLength={24}
            placeholder="Guardian"
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" className="ae-btn ae-btn-primary !px-8 !py-4" onClick={onStart}>
            <Play size={18} /> Start Run
          </button>
          <button type="button" className="ae-btn" onClick={() => onOpen('help')}>
            <Keyboard size={16} /> How to Play
          </button>
          <button type="button" className="ae-btn" onClick={() => onOpen('leaderboard')}>
            <Trophy size={16} /> Leaderboard
          </button>
          <button type="button" className="ae-btn" onClick={() => onOpen('settings')}>
            <SettingsIcon size={16} /> Settings
          </button>
        </div>

        <div className="mt-8 grid w-[min(560px,88vw)] grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Best score" value={formatScore(profile?.best_score ?? 0)} icon={<TrendingUp size={14} />} />
          <Stat label="Victories" value={profile?.victories ?? 0} icon={<Crown size={14} />} />
          <Stat label="Runs" value={profile?.runs ?? 0} icon={<Activity size={14} />} />
          <Stat label="Shards" value={profile?.total_shards ?? 0} icon={<Gem size={14} />} />
        </div>

        {stats && (
          <div className="mt-4 text-[12px] text-[#7f95bb]">
            Global: {stats.runs} runs logged · {stats.shards} shards recovered · {stats.victories} guardians victorious
          </div>
        )}
      </div>

      {top.length > 0 && (
        <div className="ae-rise absolute right-[clamp(18px,4vw,64px)] top-1/2 hidden w-[320px] -translate-y-1/2 lg:block">
          <div className="ae-panel px-5 py-4">
            <div className="ae-display flex items-center justify-between text-[13px] text-[#dff2ff]">
              <span>Top guardians</span>
              <Trophy size={15} className="text-[#ffd479]" />
            </div>
            <div className="mt-3 space-y-2">
              {top.map((entry, index) => (
                <div key={entry.id} className="flex items-center gap-3 text-[13px]">
                  <span className={`w-5 text-center tabular-nums ${index === 0 ? 'text-[#ffd479]' : 'text-[#7f95bb]'}`}>
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-[#dcebff]">{entry.name}</span>
                  {entry.victory && <Crown size={12} className="text-[#ffd479]" />}
                  <span className="tabular-nums text-[#8fe6ff]">{formatScore(entry.score)}</span>
                </div>
              ))}
            </div>
            <button type="button" className="ae-btn ae-btn-ghost mt-4 w-full !py-2" onClick={() => onOpen('leaderboard')}>
              View full board <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <div className="ae-panel-soft px-3 py-2">
      <div className="ae-sub flex items-center gap-1.5 text-[10px]">
        {icon} {label}
      </div>
      <div className="mt-1 text-[16px] font-bold tabular-nums text-[#e9f2ff]">{value}</div>
    </div>
  )
}

export function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings
  onChange: (next: Settings) => void
  onClose: () => void
}) {
  const [muted, setMuted] = useState(settings.master === 0)

  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })

  return (
    <PanelShell title="Settings" subtitle="Audio, graphics and controls" onClose={onClose}>
      <div className="space-y-6">
        <section>
          <div className="ae-sub mb-3 flex items-center gap-2">
            <Volume2 size={13} /> Audio
          </div>
          <div className="space-y-4">
            <Slider
              label="Master volume"
              value={settings.master}
              onChange={(v) => {
                setMuted(v === 0)
                update({ master: v })
              }}
            />
            <Slider label="Music" value={settings.music} onChange={(v) => update({ music: v })} />
            <Slider label="Sound effects" value={settings.sfx} onChange={(v) => update({ sfx: v })} />
            <button
              type="button"
              className="ae-btn ae-btn-ghost w-full"
              onClick={() => {
                const next = muted ? 0.85 : 0
                setMuted(!muted)
                update({ master: next })
              }}
            >
              <Volume2 size={15} /> {muted ? 'Unmute all audio' : 'Mute all audio'}
            </button>
          </div>
        </section>

        <section>
          <div className="ae-sub mb-3 flex items-center gap-2">
            <Sparkles size={13} /> Graphics
          </div>
          <div className="flex flex-wrap gap-2">
            {(['auto', 'low', 'medium', 'high'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => update({ quality: option })}
                className={`ae-btn !px-4 !py-2 ${settings.quality === option ? 'ae-btn-primary' : 'ae-btn-ghost'}`}
              >
                {option}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-[#8ba1c4]">
            Auto mode monitors frame rate and steps quality down on slower machines. Scenery detail refreshes when the
            next zone loads.
          </p>
        </section>

        <section>
          <div className="ae-sub mb-3 flex items-center gap-2">
            <Keyboard size={13} /> Controls
          </div>
          <Slider
            label="Camera sensitivity"
            value={settings.sensitivity}
            min={0.4}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => update({ sensitivity: v })}
          />
          <label className="mt-4 flex cursor-pointer items-center gap-3 text-[14px] text-[#cfe1f8]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#6ee7ff]"
              checked={settings.showFps}
              onChange={(event) => update({ showFps: event.target.checked })}
            />
            Show frame rate counter
          </label>
        </section>
      </div>
    </PanelShell>
  )
}

function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  format,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  format?: (value: number) => string
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[13px]">
        <span className="text-[#cfe1f8]">{label}</span>
        <span className="tabular-nums text-[#8fe6ff]">{format ? format(value) : `${Math.round(value * 100)}%`}</span>
      </div>
      <input
        type="range"
        className="ae-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export function HowToPlayPanel({ onClose, isTouch }: { onClose: () => void; isTouch: boolean }) {
  const rows: [string, string][] = isTouch
    ? [
        ['Virtual stick (left)', 'Move the guardian'],
        ['Drag anywhere (right)', 'Rotate the camera'],
        ['JUMP / PULSE / DASH', 'Action buttons on the right'],
      ]
    : [
        ['W A S D', 'Move the guardian'],
        ['Mouse drag', 'Rotate the camera · wheel to zoom'],
        ['Space', 'Jump (air jumps with Sky Step)'],
        ['Left click / J', 'Pulse blast — hits everything in front'],
        ['Q / right click', 'Dash — short burst of invulnerability'],
        ['Shift', 'Sprint'],
        ['Esc', 'Pause'],
      ]

  return (
    <PanelShell title="How to play" subtitle="Reach the beacon to clear each zone" onClose={onClose} wide>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="ae-sub mb-3">Controls</div>
          <div className="space-y-2">
            {rows.map(([keys, action]) => (
              <div key={keys} className="ae-panel-soft flex items-center justify-between gap-3 px-3 py-2">
                <span className="ae-display text-[11px] text-[#8fe6ff]">{keys}</span>
                <span className="text-right text-[13px] text-[#cfe1f8]">{action}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="ae-sub mb-3">Objectives</div>
          <ul className="space-y-3 text-[13px] leading-relaxed text-[#cfe1f8]">
            <li className="flex gap-3">
              <Gem size={16} className="mt-0.5 shrink-0 text-[#8ef6ff]" />
              Collect every aether shard on the isle. A light beam marks each one.
            </li>
            <li className="flex gap-3">
              <Skull size={16} className="mt-0.5 shrink-0 text-[#ff8aa6]" />
              Cleanse all shadow hostiles — wisps chase, sentries snipe, brutes charge.
            </li>
            <li className="flex gap-3">
              <RadarIcon size={16} className="mt-0.5 shrink-0 text-[#c9b0ff]" />
              When both are done the beacon opens. Step into the portal to advance.
            </li>
            <li className="flex gap-3">
              <Zap size={16} className="mt-0.5 shrink-0 text-[#ffd479]" />
              Each cleared zone grants an upgrade — build the guardian you need.
            </li>
            <li className="flex gap-3">
              <Crown size={16} className="mt-0.5 shrink-0 text-[#ffd479]" />
              Survive all five zones and topple the Shadow Colossus for victory.
            </li>
          </ul>
          <div className="ae-panel-soft mt-4 px-3 py-2 text-[12px] text-[#8ba1c4]">
            <Info size={12} className="mr-1 inline" /> Your score is submitted to the global board when the run ends.
          </div>
        </div>
      </div>
    </PanelShell>
  )
}

export function LeaderboardPanel({
  entries,
  stats,
  highlightId,
  onClose,
}: {
  entries: LeaderboardEntry[]
  stats: GlobalStats | null
  highlightId?: number | null
  onClose: () => void
}) {
  return (
    <PanelShell
      title="Leaderboard"
      subtitle={stats ? `${stats.runs} runs · ${stats.shards} shards · best ${formatScore(stats.best_score)}` : 'Loading…'}
      onClose={onClose}
      wide
    >
      {entries.length === 0 ? (
        <div className="py-10 text-center text-[14px] text-[#8ba1c4]">
          No runs recorded yet — be the first guardian on the board.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="ae-sub grid grid-cols-[36px_1fr_92px_70px_70px_76px] gap-2 px-3">
            <span>#</span>
            <span>Guardian</span>
            <span className="text-right">Score</span>
            <span className="text-right">Zone</span>
            <span className="text-right">Shards</span>
            <span className="text-right">Time</span>
          </div>
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              className={`ae-panel-soft grid grid-cols-[36px_1fr_92px_70px_70px_76px] items-center gap-2 px-3 py-2 text-[13px] ${
                highlightId === entry.id ? 'border-[#6ee7ff]/60 text-[#dff2ff]' : 'text-[#cfe1f8]'
              }`}
            >
              <span className={`tabular-nums ${index < 3 ? 'text-[#ffd479]' : 'text-[#7f95bb]'}`}>{index + 1}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold">{entry.name}</span>
                {entry.victory && <Crown size={12} className="shrink-0 text-[#ffd479]" />}
              </span>
              <span className="text-right font-bold tabular-nums text-[#8fe6ff]">{formatScore(entry.score)}</span>
              <span className="text-right tabular-nums">{entry.zone_reached}/5</span>
              <span className="text-right tabular-nums">{entry.shards}</span>
              <span className="text-right tabular-nums">{formatTime(entry.duration_s)}</span>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  )
}

export function PauseMenu({
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
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#03060e]/72 backdrop-blur-[3px]">
      <div className="ae-panel ae-rise w-[min(460px,90vw)] px-7 py-6">
        <div className="ae-display text-[16px] text-[#dff2ff]">Paused</div>
        <div className="mt-1 text-[13px] text-[#93a7c9]">
          {hud ? `Zone ${hud.zone}/5 · ${hud.zoneName} · score ${formatScore(hud.score)}` : 'Run in progress'}
        </div>

        {hud && (
          <div className="mt-5 grid grid-cols-3 gap-2">
            <Stat label="Shards" value={`${hud.shards}/${hud.shardsTotal}`} icon={<Gem size={12} />} />
            <Stat label="Hostiles" value={hud.enemies} icon={<Skull size={12} />} />
            <Stat label="Time" value={formatTime(hud.time)} icon={<Clock size={12} />} />
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <button type="button" className="ae-btn ae-btn-primary w-full" onClick={onResume}>
            <Play size={16} /> Resume
          </button>
          <button type="button" className="ae-btn w-full" onClick={onRestart}>
            <RotateCcw size={16} /> Restart run
          </button>
          <button type="button" className="ae-btn w-full" onClick={onSettings}>
            <SettingsIcon size={16} /> Settings
          </button>
          <button type="button" className="ae-btn ae-btn-ghost w-full" onClick={onQuit}>
            <X size={16} /> Quit to menu
          </button>
        </div>
        <div className="mt-4 text-center text-[12px] text-[#7f95bb]">Press Esc to resume</div>
      </div>
    </div>
  )
}

export function UpgradeScreen({
  choices,
  zoneName,
  nextZoneName,
  hud,
  onChoose,
}: {
  choices: UpgradeChoice[]
  zoneName: string
  nextZoneName: string
  hud: HudState | null
  onChoose: (id: string) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const index = Number(event.key) - 1
      if (index >= 0 && index < choices.length) onChoose(choices[index].id)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [choices, onChoose])

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#03060e]/80 p-4 backdrop-blur-[3px]">
      <div className="w-full max-w-[900px]">
        <div className="ae-rise text-center">
          <div className="ae-sub">Zone cleared</div>
          <div className="ae-title mt-2 text-[clamp(26px,4vw,42px)] leading-none">{zoneName}</div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-[13px] text-[#b9cdea]">
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp size={14} className="text-[#8fe6ff]" /> Score {formatScore(hud?.score ?? 0)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Heart size={14} className="text-[#ff8aa6]" /> {hud?.hp ?? 0}/{hud?.maxHp ?? 0} integrity
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Gem size={14} className="text-[#8ef6ff]" /> {hud?.shards ?? 0} shards
            </span>
          </div>
          <div className="mt-6 ae-display text-[13px] text-[#cfe1f8]">Choose an upgrade · press 1, 2 or 3</div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {choices.map((choice, index) => (
            <button
              key={choice.id}
              type="button"
              onMouseEnter={() => setHovered(choice.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onChoose(choice.id)}
              className={`ae-card ae-rise ${hovered === choice.id ? 'ae-card-selected' : ''}`}
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#6ee7ff]/30 bg-[#0a1226]/80 text-[#8fe6ff]">
                  <UpgradeIcon name={choice.icon} />
                </span>
                <span className="ae-sub text-[10px] text-[#7f95bb]">{choice.tag}</span>
              </div>
              <div className="ae-display mt-4 text-[14px] text-[#e9f2ff]">{choice.name}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-[#a8bfe0]">{choice.desc}</p>
              <div className="mt-4 flex items-center gap-1 text-[12px] text-[#6ee7ff]">
                Select <ChevronRight size={13} />
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 text-center text-[12px] text-[#7f95bb]">
          Next: <span className="text-[#cfe1f8]">{nextZoneName}</span>
        </div>
      </div>
    </div>
  )
}

export function ResultScreen({
  summary,
  name,
  onNameChange,
  submitState,
  rank,
  onRetry,
  onMenu,
  onLeaderboard,
}: {
  summary: RunSummary
  name: string
  onNameChange: (value: string) => void
  submitState: 'idle' | 'sending' | 'done' | 'error'
  rank: number | null
  onRetry: () => void
  onMenu: () => void
  onLeaderboard: () => void
}) {
  const victory = summary.victory
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#03060e]/82 p-4 backdrop-blur-[3px]">
      <div className="ae-panel ae-rise w-full max-w-[620px] px-7 py-6">
        <div className="text-center">
          <div className="ae-sub">{victory ? 'The citadel is silent' : 'The light fades'}</div>
          <div
            className="ae-title mt-2 text-[clamp(28px,5vw,46px)] leading-none"
            style={victory ? undefined : { filter: 'grayscale(0.35)' }}
          >
            {victory ? 'Victory' : 'Run ended'}
          </div>
          <div className="mt-3 text-[14px] text-[#b9cdea]">
            {victory
              ? 'The Shadow Colossus has fallen. Aetherfall is restored.'
              : `You fell in zone ${summary.zoneReached} of 5. The isles await another attempt.`}
          </div>
        </div>

        <div className="mt-6 text-center">
          <div className="ae-sub">Final score</div>
          <div className="ae-display text-[clamp(34px,6vw,54px)] leading-none text-[#e9f2ff] tabular-nums">
            {formatScore(summary.score)}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Zones cleared" value={`${summary.zonesCleared}/5`} icon={<Trophy size={12} />} />
          <Stat label="Shards" value={summary.shards} icon={<Gem size={12} />} />
          <Stat label="Hostiles" value={summary.kills} icon={<Skull size={12} />} />
          <Stat label="Time" value={formatTime(summary.duration)} icon={<Clock size={12} />} />
        </div>

        <div className="ae-panel-soft mt-5 px-4 py-3">
          {summary.lines.map((line) => (
            <div key={line.label} className="flex items-center justify-between py-1 text-[13px] text-[#cfe1f8]">
              <span>{line.label}</span>
              <span className="tabular-nums text-[#8fe6ff]">+{formatScore(line.value)}</span>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <label className="ae-sub mb-2 flex items-center gap-2">
            <User size={12} /> Name on the board
          </label>
          <input
            className="ae-input"
            value={name}
            maxLength={24}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <div className="mt-2 text-[12px] text-[#8ba1c4]">
            {submitState === 'sending' && 'Submitting your run…'}
            {submitState === 'done' && (rank ? `Submitted — global rank #${rank}` : 'Submitted to the global board')}
            {submitState === 'error' && 'Could not reach the score service — your result is saved locally only.'}
            {submitState === 'idle' && 'Your run will be submitted automatically.'}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className="ae-btn ae-btn-primary flex-1" onClick={onRetry}>
            <RotateCcw size={16} /> Play again
          </button>
          <button type="button" className="ae-btn flex-1" onClick={onLeaderboard}>
            <Trophy size={16} /> Leaderboard
          </button>
          <button type="button" className="ae-btn ae-btn-ghost flex-1" onClick={onMenu}>
            <X size={16} /> Main menu
          </button>
        </div>
      </div>
    </div>
  )
}
