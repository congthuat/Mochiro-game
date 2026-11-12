// Mochiro — React shell: HUD, screens, persistence and the runner lifecycle.
import { mochiroFaviconHref } from '../runner/mochiro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthGate } from '../components/runner/AuthGate'
import { readSession, refreshSession, signOut, type AuthAccount } from '../lib/auth'
import '../runner/ui.css'

import { Runner } from '../runner/Runner'
import { arcArtwork } from '../runner/arc'
import type { ArcBrand, GlobalStats, HudState, LeaderboardEntry, Phase, PickupEvent, PowerKind, ProgressState, RunSummary, RunnerProfile, Settings, ToastMsg } from '../runner/types'
import type { RushAction } from '../runner/input'
import { CHARACTERS, type CharacterId } from '../runner/config'
import { HitOverlay, RushHud, RushToasts, SwipeHint } from '../components/runner/RushHud'
import {
  RushGameOver,
  RushHelp,
  RushLeaderboard,
  RushLoading,
  RushMenu,
  RushPause,
  RushSettings,
  RushInstallHint,
} from '../components/runner/RushScreens'
import {
  fetchRunnerLeaderboard,
  fetchRunnerProfile,
  getRunnerClientId,
  loadRunnerName,
  checkRunnerName,
  type NameState,
  saveRunnerProfile,
  storeRunnerName,
  startRunnerTicket,
  submitRunnerRun,
  type OffBoardReason,
  cachedEconomy,
  economyAction,
  fetchEconomy,
  type BoardScope,
  type EconomyAction,
  type EconomyState,
  type SeasonInfo,
  captureInviteCode,
  forgetInviteCode,
  lookupInvite,
  inviteLink,
} from '../lib/runnerApi'
import { getLang, translate } from '../lib/i18n'
import { drawShareCard, shareCard } from '../lib/shareCard'
import { setupPwa, type PwaInstall } from '../lib/pwa'
import {
  RushAchievements,
  RushInvite,
  RushDaily,
  RushQuests,
  RushShop,
  TutorialCoach,
  heroUnlocked,
  nextCoachStep,
  type CoachStep,
  type EcoNote,
} from '../components/runner/RushEconomy'

const SETTINGS_KEY = 'arcrush.settings'
const BEST_KEY = 'arcrush.best'
const TUTORIAL_KEY = 'mochiro.tutorialDone'

function tutorialDone(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_KEY) === '1'
  } catch {
    return true
  }
}

function markTutorialDone(): void {
  try {
    window.localStorage.setItem(TUTORIAL_KEY, '1')
  } catch {
    /* storage unavailable */
  }
}

const DEFAULT_SETTINGS: Settings = {
  character: 'kai',
  difficulty: 'normal',
  master: 0.85,
  music: 0.5,
  sfx: 0.85,
  quality: 'auto',
  shake: true,
  showFps: false,
}

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
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

function loadBest(): number {
  if (typeof window === 'undefined') return 0
  try {
    return Number(window.localStorage.getItem(BEST_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

function storeBest(value: number): void {
  try {
    window.localStorage.setItem(BEST_KEY, String(Math.floor(value)))
  } catch {
    /* storage unavailable */
  }
}

type Panel = 'none' | 'settings' | 'help' | 'board' | 'auth' | 'shop' | 'quests' | 'daily' | 'achievements' | 'invite' | 'install'

export default function RushApp() {
  const containerRef = useRef<HTMLDivElement>(null)
  const runnerRef = useRef<Runner | null>(null)

  const [phase, setPhase] = useState<Phase>('boot')
  const [progress, setProgress] = useState<ProgressState>({ pct: 0.06, label: 'Booting the runner' })
  const [hud, setHud] = useState<HudState | null>(null)
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const [pickup, setPickup] = useState<PickupEvent | null>(null)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [panel, setPanel] = useState<Panel>('none')
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [name, setName] = useState<string>(() => loadRunnerName())
  // A name that is already someone else's is never written. The check runs on every
  // keystroke (debounced) and gates the save, so the stored profile always holds a name
  // that was free at the moment it was taken.
  const [nameState, setNameState] = useState<NameState>('ok')
  const nameTouched = useRef(false)
  const handleNameChange = useCallback((value: string) => {
    nameTouched.current = true
    setName(value)
  }, [])
  const [brand, setBrand] = useState<ArcBrand | null>(null)
  const [profile, setProfile] = useState<RunnerProfile | null>(null)
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [submitState, setSubmitState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [rank, setRank] = useState<number | null>(null)
  const [hitCount, setHitCount] = useState(0)
  const [hintSeen, setHintSeen] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)
  // Sign-in gate: the player chooses wallet / Google / guest once per browser.
  const [account, setAccount] = useState<AuthAccount | null>(() => readSession()?.account ?? null)
  const [gated, setGated] = useState<boolean>(() => {
    if (readSession()) return false
    try {
      return window.localStorage.getItem('arcrush.guest') !== '1'
    } catch {
      return true
    }
  })
  const [isTouch] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0))
  )

  const settingsRef = useRef(settings)
  const nameRef = useRef(name)
  const phaseRef = useRef<Phase>('boot')
  const panelRef = useRef<Panel>('none')
  const clientIdRef = useRef('')
  // The server's stamp on the run in progress; spent by the result post(s).
  const ticketRef = useRef<Promise<string | null>>(Promise.resolve(null))
  const [offBoard, setOffBoard] = useState<OffBoardReason>(null)
  const bestRef = useRef(loadBest())

  // ---- meta progression (wallet, shop, daily, quests, season) ----
  const [economy, setEconomy] = useState<EconomyState | null>(() =>
    typeof window === 'undefined' ? null : cachedEconomy(getRunnerClientId())
  )
  const [ecoBusy, setEcoBusy] = useState<string | null>(null)
  const [ecoNote, setEcoNote] = useState<EcoNote>(null)
  const [banked, setBanked] = useState<number | null>(null)
  const dailyOffered = useRef(false)
  const [boardScope, setBoardScope] = useState<BoardScope>('week')
  const [season, setSeason] = useState<SeasonInfo | null>(null)
  const [coach, setCoach] = useState<CoachStep | null>(null)
  const [sharing, setSharing] = useState(false)
  const [inviteFrom, setInviteFrom] = useState<{ name: string; welcome: number } | null>(null)
  const [pwa, setPwa] = useState<PwaInstall | null>(null)
  const inviteTried = useRef<string | null>(null)

  settingsRef.current = settings
  const economyRef = useRef<EconomyState | null>(null)
  economyRef.current = economy
  nameRef.current = name
  phaseRef.current = phase
  panelRef.current = panel

  const pushToast = useCallback((toast: ToastMsg) => {
    setToasts((prev) => [...prev.slice(-2), toast])
    window.setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== toast.id)), 2400)
  }, [])

  // Re-check the stored session against the server (it may have expired).
  useEffect(() => {
    if (!readSession()) return
    let cancelled = false
    void refreshSession().then((session) => {
      if (cancelled) return
      if (session.authenticated && session.account) setAccount(session.account)
      else {
        setAccount(null)
        setGated(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // --------------------------------------------------------------- backend --
  useEffect(() => {
    document.title = 'Mochiro — endless runner'
    // index.html ships a generic icon; the mark is vector, so the tab icon is built
    // from the very same source as the logo in the header.
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) {
      icon.type = 'image/svg+xml'
      icon.href = mochiroFaviconHref()
    }
    const clientId = getRunnerClientId()
    clientIdRef.current = clientId
    let cancelled = false
    setEconomy(cachedEconomy(clientId))
    void fetchEconomy(clientId).then((state) => {
      if (!cancelled && state) setEconomy(state)
    })

    const load = async () => {
      try {
        const [existing, board] = await Promise.all([fetchRunnerProfile(clientId), fetchRunnerLeaderboard()])
        if (cancelled) return
        if (board) {
          setEntries(board.entries)
          setStats(board.stats)
        }
        if (existing) {
          setProfile(existing)
          // The profile is the account's own name, so it wins — unless the player has
          // already started typing, in which case their edit is the newer intent.
          if (!nameTouched.current) setName(existing.name)
        } else {
          void saveRunnerProfile(clientId, nameRef.current).then((created) => {
            if (!cancelled && created) setProfile(created)
          })
        }
      } catch {
        /* the game runs fine offline — scores stay local */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [account])

  // ------------------------------------------------------ invites + install --
  // A visitor who came in on someone's link sees who invited them, and the link is kept
  // until they sign in, when the invite is accepted on their behalf.
  useEffect(() => {
    const code = captureInviteCode()
    if (code && !readSession()) {
      void lookupInvite(code).then((info) => {
        if (info) setInviteFrom({ name: info.name, welcome: info.welcome })
        else forgetInviteCode()
      })
    }
    return setupPwa(setPwa)
  }, [])

  useEffect(() => {
    if (!account || !economy?.invite?.canJoin) return
    const code = captureInviteCode()
    if (!code || inviteTried.current === `${account.address}:${code}`) return
    if (economy.invite.code && economy.invite.code === code) {
      forgetInviteCode()
      return
    }
    inviteTried.current = `${account.address}:${code}`
    const clientId = clientIdRef.current || getRunnerClientId()
    void economyAction(clientId, { kind: 'invite', code }).then((outcome) => {
      if (outcome.state) setEconomy(outcome.state)
      if (outcome.error === 'offline') return
      forgetInviteCode()
      setInviteFrom(null)
      const by = outcome.state?.invite?.mine?.by
      if (outcome.ok && by) {
        pushToast({ id: Date.now(), kind: 'good', text: translate('invite.joinedToast', undefined, { name: by }) })
      }
    })
  }, [account, economy, pushToast])

  // ------------------------------------------------------------------ game --
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let runner: Runner | null = null
    try {
      runner = new Runner(container, settingsRef.current, bestRef.current)
    } catch (error) {
      console.error('[arcrush] renderer init failed', error)
      setFatal('This browser could not start WebGL. Try a recent Chrome, Edge or Firefox build.')
      return
    }
    runnerRef.current = runner

    const offs = [
      runner.events.on('phase', (next) => {
        phaseRef.current = next
        setPhase(next)
        if (next === 'menu') {
          setSummary(null)
          setRank(null)
          setSubmitState('idle')
          setPanel('none')
        }
      }),
      runner.events.on('progress', (state) => setProgress(state)),
      runner.events.on('hud', (state) => setHud(state)),
      runner.events.on('toast', (toast) => pushToast(toast)),
      runner.events.on('pickup', (event) => setPickup(event)),
      runner.events.on('brand', (value) => setBrand(value)),
      runner.events.on('damage', () => setHitCount((count) => count + 1)),
      runner.events.on('action', (action) =>
        setCoach((step) => (step && step !== 'done' ? nextCoachStep(step, action) : step))
      ),
      runner.events.on('pauseKey', () => {
        if (panelRef.current !== 'none') {
          setPanel('none')
          return
        }
        const current = runnerRef.current
        if (!current) return
        if (phaseRef.current === 'playing') current.pause()
        else if (phaseRef.current === 'paused') current.resume()
      }),
      runner.events.on('result', (result) => {
        setSummary(result)
        setPanel('none')
        if (result.record) storeBest(result.score)
        setSubmitState('sending')
        const clientId = clientIdRef.current || getRunnerClientId()
        void ticketRef.current.then((ticket) => submitRunnerRun(clientId, nameRef.current, {
          score: result.score,
          coins: result.coins,
          distance_m: result.distance,
          // Stored in world units per second, like distance_m is stored in metres.
          // It used to be converted to km/h here *and* by formatSpeed on the way out,
          // so the board advertised 842 km/h for a person on foot.
          top_speed: Math.round(result.topSpeed),
          best_combo: result.bestCombo,
          duration_s: Math.round(result.duration),
          difficulty: result.difficulty,
        }, ticket))
          .then(async (response) => {
            if (response.profile) setProfile(response.profile)
            setRank(response.rank)
            setOffBoard(response.offBoard)
            // Coins from a run the server stamped go straight into the wallet.
            setBanked(response.banked ?? (response.offBoard === 'unverified' ? 0 : result.coins))
            setSubmitState('done')
            void fetchEconomy(clientId).then((state) => {
              if (state) setEconomy(state)
            })
            try {
              const board = await fetchRunnerLeaderboard()
              setEntries(board.entries)
              setStats(board.stats)
            } catch {
              /* board refresh is best effort */
            }
          })
          .catch(() => setSubmitState('error'))
      }),
    ]

    // Dev-only QA seam used by scripts/runner-browser-check.ts.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __arcrush?: unknown }).__arcrush = {
      portrait: (on: boolean) => runnerRef.current?.debugPortrait(on),
      studio: (on: boolean) => runnerRef.current?.debugStudio(on),
      gear: () => runnerRef.current?.debugGear() ?? [],
      bones: () => runnerRef.current?.debugBones() ?? {},
      weapons: () => runnerRef.current?.debugWeapons() ?? {},
      shield: (count: number) => runnerRef.current?.debugSetShield(count),
      carry: () => runnerRef.current?.debugCarry() ?? { ok: false },
      mask: (part: string, hidden: boolean) => runnerRef.current?.debugMask(part, hidden) ?? [],
      freeze: (frozen: boolean) => runnerRef.current?.debugFreezeFrame(frozen),
      overlap: () => runnerRef.current?.debugOverlap() ?? { ok: false },
      probe: () => runnerRef.current?.debugProbe(),
      parts: () => runnerRef.current?.debugParts(),
      stats: () => runnerRef.current?.debugStats(),
      noFx: (on: boolean) => runnerRef.current?.debugNoFx(on),
      hair: (on: boolean) => runnerRef.current?.debugHair(on),
      coin: (on: boolean) => runnerRef.current?.debugCoin(on),
      billboard: (on: boolean) => runnerRef.current?.debugBillboard(on),
      juice: () => runnerRef.current?.debugJuice(),
      place: (kind: string, lane: number, z: number) =>
        runnerRef.current?.debugPlaceObstacle(kind as 'car' | 'ramp' | 'tunnel' | 'bus' | 'low' | 'tall', lane, z),
      drop: (height: number) => runnerRef.current?.debugDrop(height),
      clear: () => runnerRef.current?.debugClearObstacles(),
      lines: (on: boolean) => runnerRef.current?.debugSpeedLines(on),
      advance: (seconds: number) => runnerRef.current?.debugAdvance(seconds),
      distance: (metres: number) => runnerRef.current?.debugDistance(metres),
      power: (kind: string | null) => runnerRef.current?.debugPower(kind as 'shield' | null),
      spawnPower: (kind: string, lane?: number) =>
        runnerRef.current?.debugSpawnPower(kind as 'shield' | 'magnet' | 'boost', lane),
      artwork: () => ({
        coin: arcArtwork.coin?.toDataURL() ?? null,
        billboard: arcArtwork.billboard?.toDataURL() ?? null,
        mark: arcArtwork.mark?.toDataURL() ?? null,
      }),
      street: (on: boolean) => runnerRef.current?.debugStreet(on),
      character: (id: CharacterId) => runnerRef.current?.setCharacter(id),
      facing: (radians: number) => runnerRef.current?.debugFacing(radians),
        snapshot: () => runnerRef.current?.debugSnapshot() ?? null,
        grant: (kind: PowerKind) => runnerRef.current?.debugGrant(kind),
        spawnObstacle: (kind: 'low' | 'tall' | 'tunnel', lane?: number) =>
          runnerRef.current?.debugSpawnObstacle(kind, lane),
        spawnCoins: (count?: number, lane?: number) => runnerRef.current?.debugSpawnCoins(count, lane),
        freezeSpawns: (freeze: boolean) => runnerRef.current?.debugFreezeSpawns(freeze),
        pause: () => runnerRef.current?.pause(),
        resume: () => runnerRef.current?.resume(),
        finish: () => runnerRef.current?.debugFinish(),
      }
    }

    void runner.boot()

    return () => {
      offs.forEach((off) => off())
      runner?.dispose()
      runnerRef.current = null
    }
  }, [pushToast])

  useEffect(() => {
    runnerRef.current?.applySettings(settings)
    storeSettings(settings)
  }, [settings])

  // Shop upgrades stretch the helpful power-ups in the next run.
  const upgradeKey = economy ? JSON.stringify(economy.upgrades) : ''
  useEffect(() => {
    if (!economy) return
    runnerRef.current?.setUpgrades(economy.upgrades, economy.catalog.upgrades.step)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upgradeKey, phase === 'menu'])

  // First run ever: a three-step coach (lane, jump, slide) over the live game.
  useEffect(() => {
    if (phase === 'playing' && coach === null && !tutorialDone()) setCoach('lane')
  }, [phase, coach])
  useEffect(() => {
    if (coach !== 'done') return
    markTutorialDone()
    const timer = window.setTimeout(() => setCoach(null), 2600)
    return () => window.clearTimeout(timer)
  }, [coach])

  // The daily reward offers itself once per visit, on the menu.
  useEffect(() => {
    if (phase !== 'menu' || gated || panel !== 'none' || dailyOffered.current) return
    if (!economy?.daily.claimable) return
    dailyOffered.current = true
    setPanel('daily')
  }, [phase, gated, panel, economy])

  useEffect(() => {
    if (panel !== 'board') return
    let cancelled = false
    void fetchRunnerLeaderboard(boardScope)
      .then((board) => {
        if (cancelled) return
        setEntries(board.entries)
        setStats(board.stats)
        setSeason(board.season)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [panel, boardScope])

  const runEconomy = useCallback(async (action: EconomyAction, busyKey: string, success: (reward?: number) => string) => {
    const clientId = clientIdRef.current || getRunnerClientId()
    setEcoBusy(busyKey)
    setEcoNote(null)
    const outcome = await economyAction(clientId, action)
    setEcoBusy(null)
    if (outcome.state) setEconomy(outcome.state)
    if (outcome.ok) {
      runnerRef.current?.uiSound('click')
      setEcoNote({ tone: 'ok', text: success(outcome.reward) })
      return true
    }
    if (!outcome.state) void fetchEconomy(clientId).then((state) => state && setEconomy(state))
    setEcoNote({
      tone: 'bad',
      text: translate(outcome.error === 'not_enough_coins' ? 'shop.notEnough' : 'shop.failed'),
    })
    return false
  }, [])

  const handleBuy = useCallback(
    (item: string) =>
      void runEconomy({ kind: 'buy', item }, item, () => translate(item.startsWith('char:') ? 'shop.bought' : 'shop.upgraded')),
    [runEconomy]
  )
  const handleClaimDaily = useCallback(() => {
    void runEconomy({ kind: 'daily' }, 'daily', (reward) => translate('daily.got', undefined, { n: reward ?? 0 })).then(
      (ok) => {
        if (ok) window.setTimeout(() => setPanel((current) => (current === 'daily' ? 'none' : current)), 1200)
      }
    )
  }, [runEconomy])
  const handleClaimQuest = useCallback(
    (quest: string) =>
      void runEconomy({ kind: 'quest', quest }, quest, (reward) => translate('daily.got', undefined, { n: reward ?? 0 })),
    [runEconomy]
  )
  const handleClaimAchievement = useCallback(
    (group?: string) =>
      void runEconomy({ kind: 'achievement', group }, `ach:${group ?? 'all'}`, (reward) =>
        translate('daily.got', undefined, { n: reward ?? 0 })
      ),
    [runEconomy]
  )
  const handleClaimInvite = useCallback(
    () =>
      void runEconomy({ kind: 'inviteClaim' }, 'invite', (reward) => translate('daily.got', undefined, { n: reward ?? 0 })),
    [runEconomy]
  )

  const handleShare = useCallback(async () => {
    if (!summary || sharing) return
    setSharing(true)
    runnerRef.current?.uiSound('click')
    try {
      const code = economyRef.current?.invite?.code ?? null
      const link = code ? inviteLink(code) : 'https://mochiro.xyz'
      const lang = getLang()
      const blob = await drawShareCard({
        score: summary.score,
        distance: summary.distance,
        coins: summary.coins,
        bestCombo: summary.bestCombo,
        duration: summary.duration,
        record: summary.record,
        rank,
        difficulty: summary.difficulty,
        hero: CHARACTERS[settingsRef.current.character]?.name ?? 'Mochiro',
        player: nameRef.current.trim() || 'Runner',
        link,
        scene: runnerRef.current?.snapshot() ?? null,
        lang,
      })
      const text = translate('share.text', lang, { score: summary.score.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US') })
      const outcome = await shareCard(blob, text, link)
      const key =
        outcome === 'downloaded' ? 'share.downloaded' : outcome === 'copied' ? 'share.copied' : outcome === 'failed' ? 'share.failed' : null
      if (key) pushToast({ id: Date.now(), kind: outcome === 'failed' ? 'warn' : 'good', text: translate(key) })
    } finally {
      setSharing(false)
    }
  }, [summary, sharing, rank, pushToast])

  const handleClaimSeason = useCallback(
    () => void runEconomy({ kind: 'season' }, 'season', (reward) => translate('daily.got', undefined, { n: reward ?? 0 })),
    [runEconomy]
  )

  useEffect(() => {
    if (!profile?.best_score) return
    if (profile.best_score > bestRef.current) {
      bestRef.current = profile.best_score
      storeBest(profile.best_score)
      runnerRef.current?.setBestScore(profile.best_score)
    }
  }, [profile])

  useEffect(() => {
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setNameState('short')
      return
    }
    setNameState('checking')
    let cancelled = false
    const timer = window.setTimeout(() => {
      void checkRunnerName(trimmed, getRunnerClientId())
        .then((result) => {
          if (!cancelled) setNameState(result)
        })
        // A check that cannot run must not lock the player out of their own game.
        .catch(() => {
          if (!cancelled) setNameState('ok')
        })
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [name])

  useEffect(() => {
    storeRunnerName(name)
    if (nameState !== 'ok') return
    const timer = window.setTimeout(() => {
      const clientId = clientIdRef.current
      if (!clientId) return
      void saveRunnerProfile(clientId, name)
        .then((updated) => {
          if (updated) setProfile(updated)
        })
        .catch(() => undefined)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [name, nameState])

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'hidden') runnerRef.current?.pause()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  const handleSignedIn = useCallback((next: AuthAccount) => {
    setAccount(next)
    setGated(false)
    try {
      window.localStorage.setItem('arcrush.guest', '0')
    } catch {
      /* ignore */
    }
  }, [])

  const handleGuest = useCallback(() => {
    setGated(false)
    try {
      window.localStorage.setItem('arcrush.guest', '1')
    } catch {
      /* ignore */
    }
  }, [])

  const handleSignOut = useCallback(() => {
    void signOut().then(() => {
      setAccount(null)
      setGated(true)
      runnerRef.current?.quitToMenu()
    })
  }, [])

  const handleStart = useCallback(() => {
    if (!heroUnlocked(economyRef.current, settingsRef.current.character)) {
      setPanel('shop')
      return
    }
    setSummary(null)
    setRank(null)
    setSubmitState('idle')
    setPanel('none')
    setHintSeen(false)
    setOffBoard(null)
    setBanked(null)
    ticketRef.current = startRunnerTicket(clientIdRef.current || getRunnerClientId())
    runnerRef.current?.uiSound('click')
    runnerRef.current?.startRun()
  }, [])

  const handleRetry = useCallback(() => {
    setSummary(null)
    setRank(null)
    setSubmitState('idle')
    setHintSeen(false)
    setOffBoard(null)
    setBanked(null)
    ticketRef.current = startRunnerTicket(clientIdRef.current || getRunnerClientId())
    runnerRef.current?.restartRun()
  }, [])

  const handleQuit = useCallback(() => {
    setPanel('none')
    runnerRef.current?.quitToMenu()
  }, [])

  const handleAction = useCallback((action: RushAction) => {
    runnerRef.current?.pressAction(action)
  }, [])

  const openPanel = useCallback((next: Panel) => {
    runnerRef.current?.uiSound('click')
    setPanel(next)
  }, [])

  if (fatal) {
    return (
      <div className="ar-root flex h-screen w-full items-center justify-center bg-[#04050f] p-6">
        <div className="ar-panel max-w-[520px] px-7 py-6 text-center">
          <div className="ar-display text-[16px]">Cannot start the run</div>
          <p className="mt-3 text-[14px] leading-relaxed text-[#b9cdea]">{fatal}</p>
        </div>
      </div>
    )
  }

  const inRun = phase === 'playing' || phase === 'paused'

  if (gated && phase !== 'boot' && phase !== 'loading') {
    return (
      <div className="ar-root relative h-screen w-full overflow-hidden bg-[#04050f]">
        <div ref={containerRef} className="absolute inset-0" />
        <AuthGate onSignedIn={handleSignedIn} onGuest={handleGuest} inviteFrom={account ? null : inviteFrom} />
      </div>
    )
  }

  return (
    <div className="ar-root relative h-screen w-full overflow-hidden bg-[#04050f]">
      <div ref={containerRef} className="absolute inset-0" />

      {inRun && hud && (
        <RushHud
          hud={hud}
          pickup={pickup}
          brandLogo={brand?.logo ?? null}
          onPause={() => runnerRef.current?.pause()}
          showFps={settings.showFps}
          isTouch={isTouch}
          onAction={handleAction}
        />
      )}
      {inRun && (
        <HitOverlay
          hitCount={hitCount}
          boosting={(hud?.boost ?? 0) > 0}
          shielded={Boolean(hud?.shield)}
        />
      )}
      <RushToasts toasts={toasts} />
      {phase === 'playing' && coach && (
        <TutorialCoach
          step={coach}
          isTouch={isTouch}
          onSkip={() => {
            markTutorialDone()
            setCoach(null)
          }}
        />
      )}
      {isTouch && phase === 'playing' && !hintSeen && !coach && <SwipeHint onDone={() => setHintSeen(true)} />}

      {(phase === 'boot' || phase === 'loading') && <RushLoading progress={progress} />}

      {phase === 'menu' && (
        <RushMenu
          brand={brand}
          name={name}
          onNameChange={handleNameChange}
          nameState={nameState}
          onStart={handleStart}
          onOpen={(next) => {
            setEcoNote(null)
            openPanel(next)
          }}
          economy={economy}
          buying={ecoBusy !== null}
          onUnlock={(id) => handleBuy(`char:${id}`)}
          profile={profile}
          character={settings.character}
          onCharacterChange={(id) => setSettings((prev) => ({ ...prev, character: id }))}
          difficulty={settings.difficulty}
          onDifficultyChange={(id) => setSettings((prev) => ({ ...prev, difficulty: id }))}
          account={account}
          onSignOut={handleSignOut}
          onSignIn={() => setPanel('auth')}
          quality={settings.quality === 'auto' ? 'medium' : settings.quality}
          canInstall={pwa !== null}
          onInstall={() => {
            if (!pwa) return
            if (pwa.kind === 'ios') openPanel('install')
            else void pwa.prompt().then((accepted) => accepted && setPwa(null))
          }}
          inviteFrom={inviteFrom}
        />
      )}

      {phase === 'paused' && panel === 'none' && (
        <RushPause
          hud={hud}
          onResume={() => runnerRef.current?.resume()}
          onRestart={handleRetry}
          onSettings={() => openPanel('settings')}
          onQuit={handleQuit}
        />
      )}

      {phase === 'gameover' && summary && (
        <RushGameOver
          summary={summary}
          submitState={submitState}
          rank={rank}
          offBoard={offBoard}
          onSignIn={() => setPanel('auth')}
          onRetry={handleRetry}
          onMenu={handleQuit}
          onLeaderboard={() => openPanel('board')}
          onRevive={() => runnerRef.current?.revive()}
          banked={banked}
          onShare={() => void handleShare()}
          sharing={sharing}
        />
      )}

      {panel === 'settings' && (
        <RushSettings
          settings={settings}
          onChange={setSettings}
          onClose={() => setPanel('none')}
          name={name}
          onNameChange={handleNameChange}
          nameState={nameState}
        />
      )}
      {panel === 'help' && <RushHelp onClose={() => setPanel('none')} isTouch={isTouch} brand={brand} />}
      {panel === 'auth' && (
        <AuthGate
          onSignedIn={(next) => {
            handleSignedIn(next)
            setPanel('none')
          }}
          onGuest={() => setPanel('none')}
          onDismiss={() => setPanel('none')}
          inviteFrom={inviteFrom}
        />
      )}
      {panel === 'board' && (
        <RushLeaderboard
          entries={entries}
          stats={stats}
          highlightRank={rank}
          onClose={() => setPanel('none')}
          scope={boardScope}
          onScope={setBoardScope}
          season={season}
        />
      )}
      {panel === 'shop' && economy && (
        <RushShop
          economy={economy}
          busy={ecoBusy}
          note={ecoNote}
          guest={!account}
          onBuy={handleBuy}
          onPick={(id) => {
            setSettings((prev) => ({ ...prev, character: id }))
            setPanel('none')
          }}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'quests' && economy && (
        <RushQuests
          economy={economy}
          busy={ecoBusy}
          note={ecoNote}
          onClaim={handleClaimQuest}
          onClaimSeason={handleClaimSeason}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'achievements' && economy && (
        <RushAchievements
          economy={economy}
          busy={ecoBusy}
          note={ecoNote}
          guest={!account}
          onClaim={handleClaimAchievement}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'invite' && economy && (
        <RushInvite
          economy={economy}
          busy={ecoBusy}
          note={ecoNote}
          inviteFrom={account ? null : inviteFrom}
          onSignIn={() => setPanel('auth')}
          onClaim={handleClaimInvite}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'install' && <RushInstallHint onClose={() => setPanel('none')} />}
      {panel === 'daily' && economy && (
        <RushDaily economy={economy} busy={ecoBusy !== null} onClaim={handleClaimDaily} onClose={() => setPanel('none')} />
      )}
    </div>
  )
}
