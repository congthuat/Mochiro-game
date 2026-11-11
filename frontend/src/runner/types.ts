// Shared types for Mochiro (endless runner).
import type { CharacterId, DifficultyId, MissionId } from './config'

export type Phase = 'boot' | 'loading' | 'menu' | 'playing' | 'paused' | 'gameover'

export type Quality = 'auto' | 'low' | 'medium' | 'high'
export type ResolvedQuality = 'low' | 'medium' | 'high'

export interface Settings {
  character: CharacterId
  difficulty: DifficultyId
  master: number
  music: number
  sfx: number
  quality: Quality
  shake: boolean
  showFps: boolean
}

export type PowerKind =
  | 'shield'
  | 'magnet'
  | 'boost'
  | 'double'
  | 'ghost'
  | 'invert'
  | 'fog'
  | 'heavy'

export type ObstacleKind = 'low' | 'tall' | 'car' | 'bus' | 'ramp' | 'tunnel'

export interface HudState {
  score: number
  best: number
  coins: number
  distance: number
  speed: number
  topSpeed: number
  multiplier: number
  combo: number
  bestCombo: number
  shield: boolean
  magnet: number
  boost: number
  double: number
  ghost: number
  invert: number
  fog: number
  heavy: number
  shieldHits: number
  fps: number
  tierName: string
  /** The zone the run is in — see BIOMES in config.ts. */
  biome: string
  /** Danger meter, 0 (clean) … 1 (the run is over). Crashes fill it, clean running drains it. */
  heat: number
  /** True while a continue is still available this run. */
  canRevive: boolean
  reviveCost: number
  missions: MissionProgress[]
}

export interface MissionProgress {
  id: MissionId
  target: number
  progress: number
  done: boolean
  reward: number
}

export interface RunSummary {
  score: number
  coins: number
  distance: number
  topSpeed: number
  bestCombo: number
  duration: number
  shieldHits: number
  record: boolean
  nearMisses: number
  missions: MissionProgress[]
  /** Coins earned from completed missions, already included in `coins`. */
  missionCoins: number
  /** The danger meter filled, rather than a single hazard ending the run. */
  busted: boolean
  difficulty: DifficultyId
  /** A continue has been spent this run, so the offer is gone. */
  revived: boolean
  /** What a continue would have cost. */
  reviveCost: number
}

/** Fired the instant a coin or power-up is banked, for HUD feedback. */
export interface PickupEvent {
  id: number
  kind: 'coin' | 'power'
  amount: number
  combo: number
  multiplier: number
  multiplierUp: boolean
  power: PowerKind | null
  harmful: boolean
  /** Collected, but shrugged off by a ward — the banner says so instead of the hazard. */
  warded: boolean
}

export interface ToastMsg {
  id: number
  text: string
  kind: 'info' | 'good' | 'warn' | 'power'
}

export interface ProgressState {
  pct: number
  label: string
}

export interface ArcBrand {
  name: string
  symbol: string | null
  description: string
  tags: string[]
  website: string | null
  x_handle: string | null
  followers: number | null
  /** Same-origin path for the logo image, or null when the catalog was unreachable. */
  logo: string | null
  degraded: boolean
}

export interface RunnerProfile {
  id: number
  client_id: string
  name: string
  best_score: number
  total_score: number
  total_coins: number
  best_distance: number
  best_combo: number
  runs: number
}

export interface LeaderboardEntry {
  id: number
  name: string
  score: number
  coins: number
  distance_m: number
  top_speed: number
  best_combo: number
  duration_s: number
  created_at: string
}

export interface GlobalStats {
  runs: number
  coins: number
  best_score: number
  best_distance: number
}

export interface RunSubmission {
  score: number
  coins: number
  distance_m: number
  top_speed: number
  best_combo: number
  duration_s: number
}
