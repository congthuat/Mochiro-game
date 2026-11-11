// Gameplay tuning: player stats, upgrades, scoring, physics, quality presets.
import type { Quality, ResolvedQuality, UpgradeChoice } from './types'

export interface PlayerStats {
  maxHp: number
  hp: number
  moveSpeed: number
  sprintMult: number
  jumpVelocity: number
  airJumps: number
  attackDamage: number
  attackRadius: number
  attackCooldown: number
  dashCooldown: number
  dashDistance: number
  maxEnergy: number
  energyRegen: number
  pickupRadius: number
  damageMult: number
  lifeSteal: number
}

export const BASE_STATS: PlayerStats = {
  maxHp: 100,
  hp: 100,
  moveSpeed: 8.2,
  sprintMult: 1.42,
  jumpVelocity: 10.4,
  airJumps: 0,
  attackDamage: 26,
  attackRadius: 5.0,
  attackCooldown: 0.46,
  dashCooldown: 1.5,
  dashDistance: 8.5,
  maxEnergy: 100,
  energyRegen: 24,
  pickupRadius: 2.2,
  damageMult: 1,
  lifeSteal: 0,
}

export const PHYSICS = {
  gravity: 27,
  maxFallSpeed: 42,
  coyoteTime: 0.12,
  jumpBuffer: 0.14,
  airControl: 0.72,
  groundAccel: 46,
  airAccel: 26,
  friction: 34,
  turnRate: 12,
  attackEnergy: 12,
  dashEnergy: 26,
  dashDuration: 0.22,
  dashInvuln: 0.3,
  hitInvuln: 1.15,
  knockback: 9,
}

export const SCORE = {
  shard: 100,
  wisp: 60,
  sentry: 95,
  brute: 160,
  boss: 3000,
  zoneClear: 1000,
  hpBonus: 8,
}

export interface UpgradeDefinition {
  id: string
  name: string
  desc: string
  icon: string
  tag: string
  apply: (s: PlayerStats) => void
}

export const UPGRADES: UpgradeDefinition[] = [
  {
    id: 'vital-core',
    name: 'Vital Core',
    desc: '+25 max health and heal for the same amount.',
    icon: 'heart',
    tag: 'Survival',
    apply: (s) => {
      s.maxHp += 25
      s.hp = Math.min(s.maxHp, s.hp + 25)
    },
  },
  {
    id: 'swift-boots',
    name: 'Swift Boots',
    desc: '+12% movement speed.',
    icon: 'wind',
    tag: 'Mobility',
    apply: (s) => {
      s.moveSpeed *= 1.12
    },
  },
  {
    id: 'storm-pulse',
    name: 'Storm Pulse',
    desc: '+22% pulse blast damage.',
    icon: 'zap',
    tag: 'Offense',
    apply: (s) => {
      s.attackDamage *= 1.22
    },
  },
  {
    id: 'wide-arc',
    name: 'Wide Arc',
    desc: '+25% pulse blast radius.',
    icon: 'radar',
    tag: 'Offense',
    apply: (s) => {
      s.attackRadius *= 1.25
    },
  },
  {
    id: 'kinetic-dash',
    name: 'Kinetic Dash',
    desc: '-25% dash cooldown, longer dash.',
    icon: 'move-right',
    tag: 'Mobility',
    apply: (s) => {
      s.dashCooldown *= 0.75
      s.dashDistance *= 1.12
    },
  },
  {
    id: 'energy-well',
    name: 'Energy Well',
    desc: '+30 max energy, +35% regen.',
    icon: 'battery-charging',
    tag: 'Mobility',
    apply: (s) => {
      s.maxEnergy += 30
      s.energyRegen *= 1.35
    },
  },
  {
    id: 'shard-magnet',
    name: 'Shard Magnet',
    desc: '+70% pickup radius.',
    icon: 'magnet',
    tag: 'Utility',
    apply: (s) => {
      s.pickupRadius *= 1.7
    },
  },
  {
    id: 'iron-will',
    name: 'Iron Will',
    desc: '-20% damage taken.',
    icon: 'shield',
    tag: 'Survival',
    apply: (s) => {
      s.damageMult *= 0.8
    },
  },
  {
    id: 'siphon-pulse',
    name: 'Siphon Pulse',
    desc: 'Heal 5 health per enemy defeated.',
    icon: 'droplets',
    tag: 'Survival',
    apply: (s) => {
      s.lifeSteal += 5
    },
  },
  {
    id: 'sky-step',
    name: 'Sky Step',
    desc: 'Gain an extra mid-air jump.',
    icon: 'feather',
    tag: 'Mobility',
    apply: (s) => {
      s.airJumps += 1
    },
  },
  {
    id: 'overcharge',
    name: 'Overcharge',
    desc: '-18% pulse cooldown.',
    icon: 'timer',
    tag: 'Offense',
    apply: (s) => {
      s.attackCooldown *= 0.82
    },
  },
  {
    id: 'aegis-field',
    name: 'Aegis Field',
    desc: '+20 max health and -10% damage taken.',
    icon: 'shield-check',
    tag: 'Survival',
    apply: (s) => {
      s.maxHp += 20
      s.hp = Math.min(s.maxHp, s.hp + 20)
      s.damageMult *= 0.9
    },
  },
]

export function pickUpgradeChoices(rng: () => number, count = 3): UpgradeDefinition[] {
  const pool = [...UPGRADES]
  const out: UpgradeDefinition[] = []
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length) % pool.length
    out.push(pool.splice(idx, 1)[0])
  }
  return out
}

export function toChoices(defs: UpgradeDefinition[]): UpgradeChoice[] {
  return defs.map((d) => ({ id: d.id, name: d.name, desc: d.desc, icon: d.icon, tag: d.tag }))
}

export interface QualityPreset {
  pixelRatio: number
  shadows: boolean
  shadowMapSize: number
  motes: number
  particles: number
  terrainSegments: number
  propDensity: number
  fogScale: number
}

export const QUALITY_PRESETS: Record<ResolvedQuality, QualityPreset> = {
  low: {
    pixelRatio: 0.8,
    shadows: false,
    shadowMapSize: 512,
    motes: 90,
    particles: 420,
    terrainSegments: 96,
    propDensity: 0.62,
    fogScale: 0.72,
  },
  medium: {
    pixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    motes: 180,
    particles: 700,
    terrainSegments: 128,
    propDensity: 0.85,
    fogScale: 0.9,
  },
  high: {
    pixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    motes: 300,
    particles: 1000,
    terrainSegments: 160,
    propDensity: 1,
    fogScale: 1,
  },
}

export function resolveQuality(q: Quality, deviceMemory = 8, cores = 8): ResolvedQuality {
  if (q !== 'auto') return q
  if (deviceMemory <= 4 || cores <= 4) return 'low'
  if (deviceMemory <= 8 || cores <= 6) return 'medium'
  return 'high'
}

export const DEFAULTS = {
  sensitivity: 1,
  volumeMaster: 0.85,
  volumeMusic: 0.55,
  volumeSfx: 0.8,
}
