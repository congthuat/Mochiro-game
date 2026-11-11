// Shared types for the Aetherfall game runtime.

export type Phase =
  | 'boot'
  | 'loading'
  | 'menu'
  | 'playing'
  | 'paused'
  | 'upgrade'
  | 'gameover'
  | 'victory'

export type Quality = 'auto' | 'low' | 'medium' | 'high'
export type ResolvedQuality = 'low' | 'medium' | 'high'

export interface Settings {
  master: number
  music: number
  sfx: number
  quality: Quality
  sensitivity: number
  showFps: boolean
}

export interface HudState {
  hp: number
  maxHp: number
  energy: number
  maxEnergy: number
  score: number
  shards: number
  shardsTotal: number
  enemies: number
  enemiesTotal: number
  zone: number
  zoneCount: number
  zoneName: string
  time: number
  portalOpen: boolean
  dashReady: number
  sprinting: boolean
  fps: number
  bossHp: number
  bossMax: number
}

export interface ScoreLine {
  label: string
  value: number
}

export interface RunSummary {
  score: number
  zoneReached: number
  zonesCleared: number
  shards: number
  kills: number
  duration: number
  victory: boolean
  lines: ScoreLine[]
}

export interface RadarBlip {
  x: number
  z: number
  kind: 'shard' | 'enemy' | 'boss' | 'orb' | 'portal'
}

export interface RadarData {
  rot: number
  range: number
  x: number
  z: number
  blips: RadarBlip[]
}

export interface UpgradeChoice {
  id: string
  name: string
  desc: string
  icon: string
  tag: string
}

export interface ToastMsg {
  id: number
  text: string
  tone: 'info' | 'good' | 'warn' | 'bad'
}

export interface ProgressState {
  pct: number
  label: string
  tip: string
}

export interface ZoneIntro {
  zone: number
  zoneCount: number
  name: string
  subtitle: string
  objective: string
}

export interface RunConfig {
  playerName: string
}
