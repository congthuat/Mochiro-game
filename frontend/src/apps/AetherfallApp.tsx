import { useCallback, useEffect, useRef, useState } from 'react'
import '../game/ui.css'

import { Game } from '../game/Game'
import type {
  HudState,
  Phase,
  ProgressState,
  RunSummary,
  Settings,
  ToastMsg,
  UpgradeChoice,
  ZoneIntro,
} from '../game/types'
import { ZONES } from '../game/zones'
import { DamageOverlay, Hud, Radar, Toasts, ZoneIntroBanner } from '../components/game/Hud'
import {
  HowToPlayPanel,
  LeaderboardPanel,
  LoadingScreen,
  MainMenu,
  PauseMenu,
  ResultScreen,
  SettingsPanel,
  UpgradeScreen,
} from '../components/game/Screens'
import { TouchControls } from '../components/game/TouchControls'
import {
  fetchLeaderboard,
  fetchProfile,
  getClientId,
  loadStoredName,
  saveProfile,
  storeName,
  submitRun,
  type GlobalStats,
  type LeaderboardEntry,
  type Profile,
} from '../lib/profile'

const SETTINGS_KEY = 'aetherfall.settings'

const DEFAULT_SETTINGS: Settings = {
  master: 0.85,
  music: 0.55,
  sfx: 0.8,
  quality: 'auto',
  sensitivity: 1,
  showFps: false,
}

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function storeSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* storage unavailable */
  }
}

type Panel = 'none' | 'settings' | 'help' | 'leaderboard'

export default function AetherfallApp({ onSwitchGame }: { onSwitchGame: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)

  const [phase, setPhase] = useState<Phase>('boot')
  const [progress, setProgress] = useState<ProgressState>({ pct: 0.03, label: 'Warming up', tip: '' })
  const [hud, setHud] = useState<HudState | null>(null)
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const [intro, setIntro] = useState<ZoneIntro | null>(null)
  const [choices, setChoices] = useState<UpgradeChoice[]>([])
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [panel, setPanel] = useState<Panel>('none')
  const [hitCount, setHitCount] = useState(0)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [name, setName] = useState<string>(() => loadStoredName())
  const [profile, setProfile] = useState<Profile | null>(null)
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [submitState, setSubmitState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [rank, setRank] = useState<number | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [isTouch] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      (('ontouchstart' in window) || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0))
  )

  const settingsRef = useRef(settings)
  const nameRef = useRef(name)
  const clientIdRef = useRef<string>('')

  settingsRef.current = settings
  nameRef.current = name

  const pushToast = useCallback((toast: ToastMsg) => {
    setToasts((prev) => [...prev.slice(-3), toast])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== toast.id))
    }, 2700)
  }, [])

  // ---------------------------------------------------------------- backend --
  useEffect(() => {
    document.title = 'Aetherfall — Guardian of the Shards'
    const clientId = getClientId()
    clientIdRef.current = clientId
    let cancelled = false

    const load = async () => {
      try {
        const [existing, board] = await Promise.all([fetchProfile(clientId), fetchLeaderboard()])
        if (cancelled) return
        if (existing) {
          setProfile(existing)
          if (existing.name) {
            setName(existing.name)
            storeName(existing.name)
          }
        } else {
          const created = await saveProfile(clientId, loadStoredName())
          if (!cancelled && created) setProfile(created)
        }
        setEntries(board.entries)
        setStats(board.stats)
      } catch {
        /* offline: the game still runs, the board stays empty */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    storeSettings(settings)
    gameRef.current?.applySettings(settings)
  }, [settings])

  useEffect(() => {
    storeName(name)
    const clientId = clientIdRef.current
    if (!clientId) return
    const timer = window.setTimeout(() => {
      void saveProfile(clientId, name)
        .then((updated) => {
          if (updated) setProfile(updated)
        })
        .catch(() => undefined)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [name])

  // ------------------------------------------------------------------- game --
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let game: Game | null = null
    try {
      game = new Game(container, settingsRef.current)
    } catch (error) {
      console.error('[aetherfall] renderer init failed', error)
      setFatal('This browser could not start WebGL. Try a recent Chrome, Edge or Firefox build.')
      return
    }
    gameRef.current = game

    const offs = [
      game.on('phase', (next: Phase) => {
        setPhase(next)
        if (next === 'menu') {
          setSummary(null)
          setRank(null)
          setSubmitState('idle')
          setChoices([])
          setPanel('none')
        }
        if (next === 'loading') {
          setProgress({ pct: 0.04, label: 'Preparing', tip: '' })
        }
      }),
      game.on('progress', (state: ProgressState) => setProgress(state)),
      game.on('hud', (state: HudState) => setHud(state)),
      game.on('toast', (toast: ToastMsg) => pushToast(toast)),
      game.on('zone-intro', (info: ZoneIntro) => setIntro(info)),
      game.on('upgrades', (list: UpgradeChoice[]) => setChoices(list)),
      game.on('damage', () => setHitCount((count) => count + 1)),
      game.on('result', (result: RunSummary) => {
        setSummary(result)
        setSubmitState('sending')
        const clientId = clientIdRef.current || getClientId()
        void submitRun(clientId, nameRef.current, {
          score: result.score,
          zone_reached: result.zoneReached,
          shards: result.shards,
          kills: result.kills,
          duration_s: Math.round(result.duration),
          victory: result.victory,
        })
          .then(async (response) => {
            if (response.profile) setProfile(response.profile)
            setSubmitState('done')
            try {
              const board = await fetchLeaderboard()
              setEntries(board.entries)
              setStats(board.stats)
              if (response.entry) {
                const index = board.entries.findIndex((item) => item.id === response.entry?.id)
                setRank(index >= 0 ? index + 1 : null)
              }
            } catch {
              /* board refresh is best-effort */
            }
          })
          .catch(() => setSubmitState('error'))
      }),
    ]

    // Dev-only QA seam used by scripts/browser-check.ts (absent from production builds).
    if (import.meta.env.DEV) {
      ;(window as unknown as { __aetherfall?: unknown }).__aetherfall = {
        snapshot: () => gameRef.current?.debugSnapshot() ?? null,
        clearObjectives: () => gameRef.current?.debugClearObjectives(),
        teleportToPortal: () => gameRef.current?.debugTeleportToPortal(),
      }
    }

    void game.boot()

    return () => {
      offs.forEach((off) => off())
      game?.dispose()
      gameRef.current = null
    }
  }, [pushToast])

  // Pause automatically when the tab loses focus mid-run.
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'hidden') gameRef.current?.pause()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  // Escape closes panels, then toggles pause.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (panel !== 'none') {
        setPanel('none')
        return
      }
      const game = gameRef.current
      if (!game) return
      if (phase === 'paused') game.resume()
      else if (phase === 'playing') game.pause()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [panel, phase])

  const handleStart = useCallback(() => {
    setSummary(null)
    setRank(null)
    setSubmitState('idle')
    setPanel('none')
    void gameRef.current?.startRun()
  }, [])

  const handleRetry = useCallback(() => {
    setSummary(null)
    setRank(null)
    setSubmitState('idle')
    void gameRef.current?.restartRun()
  }, [])

  const handleQuit = useCallback(() => {
    setPanel('none')
    gameRef.current?.quitToMenu()
  }, [])

  const inRun = phase === 'playing' || phase === 'paused' || phase === 'upgrade'
  const nextZoneName = ZONES[Math.min(ZONES.length - 1, (hud?.zone ?? 1))]?.name ?? ''
  const currentZoneName = ZONES[Math.max(0, (hud?.zone ?? 1) - 1)]?.name ?? ''

  if (fatal) {
    return (
      <div className="ae-root flex h-screen w-full items-center justify-center bg-[#04060e] p-6">
        <div className="ae-panel max-w-[520px] px-7 py-6 text-center">
          <div className="ae-display text-[16px] text-[#dff2ff]">Cannot start the game</div>
          <p className="mt-3 text-[14px] leading-relaxed text-[#b9cdea]">{fatal}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ae-root relative h-screen w-full overflow-hidden bg-[#04060e]">
      <div ref={containerRef} className="absolute inset-0" />

      {(phase === 'menu' || phase === 'gameover' || phase === 'victory') && (
        <button
          type="button"
          className="ae-btn ae-btn-ghost absolute right-4 top-4 z-30 !px-4 !py-2 text-[11px]"
          onClick={onSwitchGame}
        >
          Mochiro →
        </button>
      )}

      {inRun && hud && <Hud hud={hud} onPause={() => gameRef.current?.pause()} showFps={settings.showFps} />}
      {inRun && !isTouch && (
        <div className="pointer-events-none absolute bottom-5 left-5 hidden sm:block">
          <Radar gameRef={gameRef} />
        </div>
      )}
      {isTouch && phase === 'playing' && <TouchControls gameRef={gameRef} />}
      <Toasts toasts={toasts} />
      {phase === 'playing' && <DamageOverlay hitCount={hitCount} />}
      {phase === 'playing' && <ZoneIntroBanner intro={intro} />}

      {(phase === 'boot' || phase === 'loading') && <LoadingScreen progress={progress} />}

      {phase === 'menu' && (
        <MainMenu
          onStart={handleStart}
          onOpen={setPanel}
          name={name}
          onNameChange={setName}
          profile={profile}
          entries={entries}
          stats={stats}
        />
      )}

      {phase === 'paused' && panel === 'none' && (
        <PauseMenu
          hud={hud}
          onResume={() => gameRef.current?.resume()}
          onRestart={handleRetry}
          onSettings={() => setPanel('settings')}
          onQuit={handleQuit}
        />
      )}

      {phase === 'upgrade' && (
        <UpgradeScreen
          choices={choices}
          zoneName={currentZoneName}
          nextZoneName={nextZoneName}
          hud={hud}
          onChoose={(id) => gameRef.current?.chooseUpgrade(id)}
        />
      )}

      {(phase === 'victory' || phase === 'gameover') && summary && (
        <ResultScreen
          summary={summary}
          name={name}
          onNameChange={setName}
          submitState={submitState}
          rank={rank}
          onRetry={handleRetry}
          onMenu={handleQuit}
          onLeaderboard={() => setPanel('leaderboard')}
        />
      )}

      {panel === 'settings' && (
        <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setPanel('none')} />
      )}
      {panel === 'help' && <HowToPlayPanel onClose={() => setPanel('none')} isTouch={isTouch} />}
      {panel === 'leaderboard' && (
        <LeaderboardPanel entries={entries} stats={stats} onClose={() => setPanel('none')} />
      )}
    </div>
  )
}
