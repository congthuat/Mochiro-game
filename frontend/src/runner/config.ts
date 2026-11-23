// Mochiro tuning: run speeds, physics, scoring, spawn cadence, quality presets.
import type { ObstacleKind, PowerKind, Quality, ResolvedQuality, Settings } from './types'
import type { GearSpec } from './gear'
import type { PersonaId } from './persona'
import type { RecolorSpec } from './recolor'
import barbarianModel from '../assets/models/barbarian.glb?url'
import knightModel from '../assets/models/knight.glb?url'
import mageModel from '../assets/models/mage.glb?url'

/** Three-lane track. Lane 0 = left, 1 = centre, 2 = right. */
export const LANES = [-2.3, 0, 2.3] as const
export const TRACK_HALF_WIDTH = 4.6

export const RUN = {
  startSpeed: 15,
  maxSpeed: 42,
  rampSeconds: 150,
  /** Extra speed multiplier applied while a boost is active. */
  boostSpeedMult: 1.55,
  boostTime: 2.6,
  magnetTime: 8,
  magnetRadius: 7.6,
  maxShields: 2,
  hitInvuln: 1.4,
  coinValue: 25,
  /** Coins per +1 multiplier step. */
  comboStep: 8,
  maxMultiplier: 8,
  /** Distance points per metre (multiplied by the current multiplier). */
  distancePoints: 1,
  perfectLineBonus: 150,
  /** Points for a close call, before the multiplier. */
  nearMissBonus: 200,
  /** Spawn cadence: seconds of travel between obstacle patterns. */
  gapTimeStart: 1.06,
  gapTimeEnd: 0.62,
  /** Z distance ahead of the player where new content appears. */
  spawnAhead: 150,
  /** Z position behind the camera where content is recycled. */
  despawnZ: 14,
  /** Camera distance behind the runner. */
  camDistance: 7.9,
  camHeight: 4.1,
  /** Lane switch feel. */
  laneSwitchRate: 17,
  laneRoll: 0.34,
}

export const PHYSICS = {
  gravity: 34,
  jumpVelocity: 12.2,
  /** Grace period after leaving the ground where a jump still works. */
  coyoteTime: 0.11,
  /** Jump presses are buffered this long (seconds of game time). */
  jumpBuffer: 0.16,
  slideTime: 0.62,
  /** Holding slide at the end extends it a little (feels responsive). */
  slideGrace: 0.12,
}

export const BODY = {
  halfWidth: 0.4,
  standHeight: 1.7,
  slideHeight: 0.86,
  /** Collision box is inset slightly so near-misses feel fair. */
  forgiveness: 0.12,
  /**
   * Clearance below which a hazard that swept past counts as a close call. Tight on
   * purpose: a clean pass in the next lane leaves about 0.9 m of air, so only a
   * deliberate graze — mid-lane-change, or a jump that barely clears — earns it.
   */
  nearMiss: 0.3,
}

export interface ObstacleSpec {
  /** Top surface height when the obstacle can be landed on (car roofs). */
  platformTop?: number
  /** Upward kick applied on contact (ramps) — a launch never counts as a hit. */
  launch?: number
  kind: ObstacleKind
  width: number
  height: number
  /** Bottom edge above the track (bars hang from above). */
  bottom: number
  depth: number
  /** Score weight when smashed during a boost. */
  points: number
}

export const OBSTACLES: Record<ObstacleKind, ObstacleSpec> = {
  low: { kind: 'low', width: 2.0, height: 0.92, bottom: 0, depth: 1.15, points: 40 },
  tall: { kind: 'tall', width: 2.0, height: 2.65, bottom: 0, depth: 1.15, points: 60 },
  // Slide gates. The gap under them is deliberately well below head height: from a
  // camera that sits high behind the runner a 1.5 m gap reads as "I fit under that",
  // and the death that follows feels like a bug. At 1.25 m it never does.
  // City traffic: a car roof is a platform you can land on and sprint along.
  // Sized to the KayKit cars (runner/cars.ts): 1.68 m wide, roof at 1.48 m. Each model
  // narrows `depth` to its own length; this is the longest (sedan / station wagon).
  car: { kind: 'car', width: 1.68, height: 1.48, bottom: 0, depth: 3.78, points: 55, platformTop: 1.48 },
  bus: { kind: 'bus', width: 2.35, height: 2.8, bottom: 0, depth: 7.0, points: 90 },
  // A ramp kicks you skyward — land on the car parked behind it.
  ramp: { kind: 'ramp', width: 2.05, height: 1.3, bottom: 0, depth: 2.9, points: 30, launch: 14.5 },
  // Gateway: the visible lintel is exactly this box, so ducking is never a guess.
  tunnel: { kind: 'tunnel', width: 9.4, height: 1.97, bottom: 1.25, depth: 1.4, points: 80 },
  // Skyway: a box truck whose long flat roof is the high road. Taller than a car, so it
  // takes the ramp (or a well-timed jump) to get up there.
  truck: { kind: 'truck', width: 2.2, height: 1.6, bottom: 0, depth: 12.0, points: 70, platformTop: 1.6 },
  // Neon district laser fences: the low one is jumped, the high one is slid under (its
  // top sits above the best jump, like the gateway, so it can only be ducked).
  laserLow: { kind: 'laserLow', width: 2.0, height: 0.85, bottom: 0, depth: 0.5, points: 50 },
  laserHigh: { kind: 'laserHigh', width: 2.0, height: 1.95, bottom: 1.25, depth: 0.5, points: 70 },
}

/**
 * The pickup catalogue. Beneficial power-ups are the reward loop; harmful ones
 * are rare, loud and readable — they punish a greedy line, never a clean run.
 * Weights are spawn shares (harmful total ≈ 22%).
 */
export interface PowerSpec {
  kind: PowerKind
  harmful: boolean
  label: string
  hint: string
  colour: string
  duration: number
  weight: number
}

export const POWERS: PowerSpec[] = [
  { kind: 'shield', harmful: false, label: 'SHIELD UP', hint: 'One free hit', colour: '#4fd8ff', duration: 0, weight: 9 },
  { kind: 'magnet', harmful: false, label: 'MAGNET ONLINE', hint: 'Coins fly to you', colour: '#b47cff', duration: 8, weight: 18 },
  { kind: 'boost', harmful: false, label: 'OVERDRIVE', hint: 'Smash through traffic', colour: '#ff9b3d', duration: 3.4, weight: 14 },
  { kind: 'double', harmful: false, label: 'DOUBLE GOLD', hint: 'Every coin counts twice', colour: '#ffd45e', duration: 9, weight: 13 },
  { kind: 'ghost', harmful: false, label: 'PHASE SHIFT', hint: 'Traffic passes through you', colour: '#6ef0d4', duration: 4.5, weight: 11 },
  { kind: 'invert', harmful: true, label: 'CONTROLS JAMMED', hint: 'Steering is mirrored', colour: '#ff5d73', duration: 5, weight: 12 },
  { kind: 'fog', harmful: true, label: 'SMOKE SCREEN', hint: 'Visibility drops', colour: '#9aa7c2', duration: 4.5, weight: 6 },
  { kind: 'heavy', harmful: true, label: 'HEAVY LOAD', hint: 'Jumps fall short', colour: '#c98a4b', duration: 5, weight: 4 },
]

export const POWER_BY_KIND: Record<PowerKind, PowerSpec> = POWERS.reduce(
  (map, spec) => {
    map[spec.kind] = spec
    return map
  },
  {} as Record<PowerKind, PowerSpec>
)

/** Difficulty tiers, used for HUD flavour and spawn table gating. */
export interface Tier {
  at: number
  /** English name, for logs and tooling. The player sees `translate(key)`. */
  name: string
  /** i18n key (src/lib/i18n.ts) of the name shown in the HUD and the call-out. */
  key: string
}

export const TIERS: Tier[] = [
  { at: 0, name: 'Warm-up', key: 'runner.tier.warmup' },
  { at: 18, name: 'Overclock', key: 'runner.tier.overclock' },
  { at: 26, name: 'Surge', key: 'runner.tier.surge' },
  { at: 32, name: 'Hyperdrive', key: 'runner.tier.hyperdrive' },
  { at: 37, name: 'Terminal Velocity', key: 'runner.tier.terminal' },
]

export function tierFor(speed: number): Tier {
  let tier = TIERS[0]
  for (const item of TIERS) if (speed >= item.at) tier = item
  return tier
}

/** Speed curve: fast ramp early, then a long tail toward max speed. */
export function speedAt(elapsed: number): number {
  const t = Math.min(1, Math.max(0, elapsed / RUN.rampSeconds))
  const eased = 1 - Math.pow(1 - t, 2.1)
  return RUN.startSpeed + (RUN.maxSpeed - RUN.startSpeed) * eased
}

export function gapTimeAt(elapsed: number): number {
  const t = Math.min(1, Math.max(0, elapsed / RUN.rampSeconds))
  return RUN.gapTimeStart + (RUN.gapTimeEnd - RUN.gapTimeStart) * t
}

export interface QualityPreset {
  pixelRatio: number
  bloom: boolean
  bloomStrength: number
  shadows: boolean
  cityBlocks: number
  maxCoins: number
  maxObstacles: number
  particles: number
  speedLines: number
  arches: number
  fogNear: number
  fogFar: number
  antialias: boolean
  /** Image-based lighting: lovely on a GPU, ruinous on a software rasteriser. */
  environment: boolean
}

export const QUALITY_PRESETS: Record<ResolvedQuality, QualityPreset> = {
  low: {
    pixelRatio: 0.72,
    bloom: false,
    bloomStrength: 0,
    shadows: false,
    cityBlocks: 70,
    maxCoins: 36,
    maxObstacles: 26,
    particles: 160,
    speedLines: 0,
    arches: 3,
    fogNear: 80,
    fogFar: 230,
    antialias: false,
    environment: false,
  },
  medium: {
    pixelRatio: 1,
    bloom: true,
    bloomStrength: 0.26,
    shadows: false,
    cityBlocks: 120,
    maxCoins: 52,
    maxObstacles: 34,
    particles: 340,
    speedLines: 34,
    arches: 5,
    fogNear: 105,
    fogFar: 300,
    antialias: true,
    environment: true,
  },
  high: {
    pixelRatio: 1.6,
    bloom: true,
    bloomStrength: 0.36,
    shadows: true,
    cityBlocks: 180,
    maxCoins: 64,
    maxObstacles: 40,
    particles: 620,
    speedLines: 54,
    arches: 6,
    fogNear: 130,
    fogFar: 380,
    antialias: true,
    environment: true,
  },
}

export function resolveQuality(setting: Quality, measuredFps: number): ResolvedQuality {
  if (setting !== 'auto') return setting
  if (measuredFps >= 55) return 'high'
  if (measuredFps >= 36) return 'medium'
  return 'low'
}

/**
 * Where "Auto" starts, before a single frame has been timed.
 *
 * Auto used to start at High on every device and wait for the frame-rate watchdog to
 * notice — which on a phone meant the first seconds of every session ran at a crawl,
 * with shadows and bloom on, until the drop. This is a cheap guess from what the
 * browser will tell us; the watchdog still corrects it either way once the run is
 * going. `gpu` is the (unmasked, when available) WebGL renderer string.
 */
export function guessDeviceQuality(gpu = ''): ResolvedQuality {
  if (typeof navigator === 'undefined') return 'medium'
  const nav = navigator as Navigator & { deviceMemory?: number }
  const ua = nav.userAgent || ''
  const cores = nav.hardwareConcurrency || 4
  const memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined
  const coarse =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches
  // iPadOS reports itself as a Mac; the touch points give it away.
  const mobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) || coarse
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const screenPixels =
    typeof screen !== 'undefined' ? Math.max(1, screen.width) * Math.max(1, screen.height) * dpr * dpr : 1920 * 1080
  const g = gpu.toLowerCase()

  // Software rasterisers: nothing but Low is playable.
  if (/swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/.test(g)) return 'low'

  if (mobile) {
    // Safari caps hardwareConcurrency (and hides deviceMemory) on every iPhone and iPad,
    // so the core count says nothing there; Apple's GPUs all carry Medium comfortably.
    if (/apple gpu|apple a\d/.test(g) || /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) return 'medium'
    if (cores <= 4 || (memory !== undefined && memory <= 3)) return 'low'
    // Older mobile GPUs struggle with bloom at native resolution.
    if (/mali-(4|t)|adreno \(tm\) [3-5]\d\d|powervr sgx/.test(g)) return 'low'
    return 'medium'
  }

  if (cores <= 2 || (memory !== undefined && memory <= 2)) return 'low'
  const discrete = /nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro|vii)|radeon\(tm\) rx|arc\(tm\) a|intel\(r\) arc|apple m\d|apple gpu/.test(g)
  const integrated = /intel|uhd|iris|hd graphics|radeon\(tm\) graphics|vega \d|mali|adreno/.test(g) && !discrete
  if (cores <= 4 || (memory !== undefined && memory <= 4)) return discrete ? 'medium' : 'low'
  if (integrated) return 'medium'
  // A big screen on an unknown GPU: the shadow pass at 1.6× resolution is the risk.
  if (!discrete && screenPixels > 2560 * 1600) return 'medium'
  return discrete || !g ? 'high' : 'medium'
}

export const PALETTE = {
  // Daylight sky
  skyTop: '#2b8ae8',
  skyMid: '#7ccbfb',
  skyHorizon: '#eafaff',
  sun: '#fff6cf',
  cloud: '#ffffff',
  fog: '#e0f2ff',
  // Ground / track
  grass: '#8adc7c',
  grassDark: '#5fbf66',
  sand: '#f6e6bd',
  // Asphalt. Dark, because that is what a road is — and because the only bright
  // thing on a real carriageway is the paint, which is what carries the speed.
  road: '#525a64',
  roadDark: '#3f4650',
  // Road paint. One source of truth: the edge lines baked into the asphalt texture
  // and the dashed dividers laid as geometry both read this, so they can never
  // drift apart. Off-white rather than pure white — pure white blows out under the
  // tone mapping and turns into a glowing stripe at speed.
  grid: '#eef1f4',
  laneEdge: '#ff7fb0',
  rail: '#ff5566',
  railDark: '#d93a4e',
  // Brand + pickups
  coinRim: '#0aa9ff',
  coinGlow: '#5fd8ff',
  // Hazards / power-ups
  hazard: '#ff6a2b',
  danger: '#ff5a3c',
  dangerAlt: '#ffc94d',
  shield: '#2fc6ff',
  magnet: '#b06bff',
  boost: '#ff9f2e',
  // Buildings
  city: '#e9e3d6',
  cityWarm: '#ffe4b0',
  cityCool: '#cbe4ff',
  trim: '#2f7fe0',
} as const

export type CharacterId = 'kai' | 'mika' | 'bjorn' | 'nyx' | 'rin' | 'tim' | 'ezgi' | 'jeremy'

/** Roster order — also the order of the character line-up on the menu stage. */
export const CHARACTER_IDS: CharacterId[] = ['kai', 'mika', 'bjorn', 'nyx', 'rin', 'tim', 'ezgi', 'jeremy']

/**
 * Every hero has one signature ability, so picking a character is a gameplay
 * choice and not only a costume. The value is a multiplier for every perk except
 * `shieldStart` (a number of shields) and `badImmunity` (a plain yes/no, so the
 * value is unused).
 */
export type PerkId = 'shieldStart' | 'longPower' | 'badImmunity' | 'quickLane' | 'wideMagnet' | 'longBoost' | 'bounceBack' | 'goldRush'

export interface CharacterPerk {
  id: PerkId
  value: number
}

/**
 * Whether a collected power-up actually takes hold on a hero.
 *
 * Hazards bite everyone — that is the whole point of them — except on the one hero
 * whose perk is a ward. Kept as a pure function so the rule is testable on its own
 * and so there is exactly one place a harmful effect can be turned away.
 */
export function powerTakesHold(perk: CharacterPerk | undefined, harmful: boolean): boolean {
  return !(harmful && perk?.id === 'badImmunity')
}

export interface CharacterSpec {
  id: CharacterId
  name: string
  tagline: string
  perk: CharacterPerk
  /**
   * Rigged glTF character (KayKit — Adventurers Character Pack, CC0 by Kay
   * Lousberg). The colours below drive the procedural fallback rig.
   */
  model: string
  /** World height of the model, and the yaw that makes it look down -z. */
  modelHeight: number
  modelFacing: number
  /** Costume palette swap applied to the rigged atlas (see recolor.ts). */
  recolor?: RecolorSpec
  /** Extra kit parented to the skeleton (see gear.ts). */
  gear?: GearSpec
  /** Meshes baked into the rig that this class should not be carrying. */
  hideNodes?: string[]
  /** Dresses the rig as a real person instead of a fantasy class (see persona.ts). */
  persona?: PersonaId
  skin: number
  hair: number
  hairStyle: 'spiky' | 'ponytail'
  /** Jacket / top colour. */
  outfit: number
  /** Sleeves, cuffs and trim of the outfit. */
  outfitDark: number
  /** Inner tee. */
  shirt: number
  /** Shorts (Sam) or skirt (Bobbilee). */
  bottom: number
  shoe: number
  sole: number
  /** Star / bow / bag accent. */
  accent: number
  glove: number
  eye: number
}

/**
 * Each hero's signature colour on screen — card edge, stage plate, the light column on
 * the stage. `accent` is the yellow of the in-game gear and is shared by several heroes,
 * so it could not tell anyone apart. These are taken from each hero's outfit and darkened
 * until white text on them clears WCAG AA (4.5:1 or better).
 */
export const HERO_COLORS: Record<CharacterId, number> = {
  kai: 0x2563c9,
  mika: 0xd13a83,
  bjorn: 0xc2461f,
  nyx: 0x6b4fd8,
  rin: 0x23794a,
  tim: 0x9a6200,
  ezgi: 0x9b2747,
  jeremy: 0x1f6f78,
}

export function heroColorCss(id: CharacterId): string {
  return `#${HERO_COLORS[id].toString(16).padStart(6, '0')}`
}

export const CHARACTERS: Record<CharacterId, CharacterSpec> = {
  kai: {
    id: 'kai',
    perk: { id: 'shieldStart', value: 1 },
    name: 'Sam',
    tagline: 'USDC Shield',
    // Sam is a real person, so he is dressed from a photo of him rather than as a
    // fantasy class: Arc cap, black "YOU CAN'T VIBE CODE USDC." tee, black jeans,
    // steel watch, goatee (persona.ts). He keeps the knight's skeleton and moves.
    // The rig's plate, helmet, cape and blades all go; the round shield is swapped
    // for a USDC coin, which is what his shield perk now looks like.
    persona: 'sam',
    hideNodes: ['1H_Sword', '2H_Sword', 'Shield', 'Knight_Helmet', 'Knight_Cape'],
    model: knightModel,
    modelHeight: 1.74,
    modelFacing: Math.PI,
    skin: 0x80543a,
    hair: 0x1a1410,
    hairStyle: 'spiky',
    outfit: 0x1f2127,
    outfitDark: 0x111216,
    shirt: 0x1f2127,
    bottom: 0x2a2f3a,
    shoe: 0x1a1b1f,
    sole: 0xeef0f3,
    accent: 0x2775ca,
    glove: 0x80543a,
    eye: 0x2a1c14,
  },
  mika: {
    id: 'mika',
    perk: { id: 'longPower', value: 1.2 },
    name: 'Bobbilee',
    tagline: 'Keynote',
    // Bobbilee as herself, on stage (see persona.ts): hair pulled back, an ivory high-neck
    // fleece, dark trousers, white sneakers, and a backpack with her white puppy in it.
    persona: 'bobbilee',
    hideNodes: ['Spellbook', '1H_Wand', '2H_Staff', 'Mage_Hat', 'Mage_Cape'],
    model: mageModel,
    // The fit counts the (hidden) wizard hat, so the height is set for the hat: without
    // it she stands about as tall as the others (~1.53 visible) instead of a head shorter.
    modelHeight: 2.1,
    modelFacing: Math.PI,
    skin: 0xf1c4a4,
    hair: 0x6e4c34,
    hairStyle: 'ponytail',
    outfit: 0xdfd8cc,
    outfitDark: 0xccc3b4,
    shirt: 0xdfd8cc,
    bottom: 0x33353c,
    shoe: 0xf2f1ee,
    sole: 0xbfc0c4,
    accent: 0xccc3b4,
    glove: 0xf1c4a4,
    eye: 0x5a3a26,
  },
  bjorn: {
    id: 'bjorn',
    perk: { id: 'badImmunity', value: 1 },
    name: 'Teddyz',
    tagline: 'Thunder Bruiser',
    // Teddyz as himself (see persona.ts): short dark hair swept up, clean-shaven, a plain
    // white tee, black trousers with his keys on the belt loop, white sneakers. The
    // barbarian keeps his build and his moves; the horns, fur and axes stay home.
    persona: 'teddyz',
    hideNodes: ['Cape', 'Hat', 'Axe', 'Shield', 'Mug'],
    model: barbarianModel,
    modelHeight: 1.74,
    modelFacing: Math.PI,
    skin: 0xe1a078,
    hair: 0x1a1513,
    hairStyle: 'spiky',
    outfit: 0xf8f9fb,
    outfitDark: 0xd9dce2,
    shirt: 0xf8f9fb,
    bottom: 0x1c1d22,
    shoe: 0xf2f1ee,
    sole: 0xbfc0c4,
    accent: 0xcfd3da,
    glove: 0xe1a078,
    eye: 0x3a2417,
  },
  nyx: {
    id: 'nyx',
    perk: { id: 'quickLane', value: 1.35 },
    name: 'Lecter',
    tagline: 'Night Blade',
    // Lecter as himself (see persona.ts): red-brown swept-up hair with the sides faded, thin
    // gold glasses, and a Chelsea home kit (royal blue shirt with USDC on the front and
    // JEREMIAH 7 on the back, blue shorts, white socks) with white sneakers. The barbarian
    // keeps his build and his moves; the horns, fur and axes stay home.
    persona: 'lecter',
    hideNodes: ['Cape', 'Hat', 'Axe', 'Shield', 'Mug'],
    model: barbarianModel,
    modelHeight: 1.74,
    modelFacing: Math.PI,
    skin: 0xf1bf9c,
    hair: 0x7a2a1c,
    hairStyle: 'spiky',
    outfit: 0x2350c4,
    outfitDark: 0x1b3fa0,
    shirt: 0x2350c4,
    bottom: 0x2350c4,
    shoe: 0xf2f1ee,
    sole: 0xbfc0c4,
    accent: 0xf2c230,
    glove: 0xf1bf9c,
    eye: 0x2a1a12,
  },
  rin: {
    id: 'rin',
    perk: { id: 'wideMagnet', value: 1.45 },
    name: 'Mike',
    tagline: 'Marksman',
    // Mike as himself (see persona.ts): short black hair spiked straight up, thick
    // brows, a big grin, a light-blue oxford button-down open at the neck, navy chinos
    // and white sneakers, on the knight rig (Sam's and Tim's skeleton); the plate, helmet,
    // cape and blades all stay home.
    persona: 'mike',
    model: knightModel,
    hideNodes: ['1H_Sword', '2H_Sword', 'Shield', 'Knight_Helmet', 'Knight_Cape'],
    modelHeight: 1.74,
    modelFacing: Math.PI,
    skin: 0xe2ae95,
    hair: 0x141010,
    hairStyle: 'spiky',
    outfit: 0x9cc0e4,
    outfitDark: 0x8bb1da,
    shirt: 0x9cc0e4,
    bottom: 0x2b3446,
    shoe: 0xf2f1ee,
    sole: 0xbfc0c4,
    accent: 0xf6f8fa,
    glove: 0xe2ae95,
    eye: 0x25160e,
  },
  tim: {
    id: 'tim',
    // Overdrive is the duelist's move: the blade cuts through the traffic instead of
    // dodging it. Twice as long is a run you can feel, where a coin bonus was not.
    perk: { id: 'longBoost', value: 2 },
    name: 'Tim',
    tagline: 'Blade Duelist',
    // Tim as himself (see persona.ts): short auburn hair, thin dark glasses, a periwinkle
    // short-sleeved shirt with a conference lanyard, dark khaki chinos and white sneakers,
    // on the knight rig (Sam's skeleton); the plate, helmet, cape and blades stay home.
    persona: 'tim',
    model: knightModel,
    modelHeight: 1.74,
    modelFacing: Math.PI,
    hideNodes: ['1H_Sword', '2H_Sword', 'Shield', 'Knight_Helmet', 'Knight_Cape'],
    skin: 0xeebfa4,
    hair: 0x8a5230,
    hairStyle: 'spiky',
    outfit: 0xa7b7e2,
    outfitDark: 0x95a6d6,
    shirt: 0xa7b7e2,
    bottom: 0x6e6655,
    shoe: 0xf2f1ee,
    sole: 0xbfc0c4,
    accent: 0xf0b81c,
    glove: 0xeebfa4,
    eye: 0x5b7893,
  },
  ezgi: {
    id: 'ezgi',
    perk: { id: 'bounceBack', value: 30 },
    name: 'Ezgi',
    tagline: 'Bounce Back',
    // Ezgi as in her photo (see persona.ts): long, voluminous dark-brown curls past her
    // shoulders, a white channel-quilted puffer over a burgundy top, dark trousers and
    // white sneakers, and a big warm smile. Same mage rig as Bobbilee, kit hidden.
    persona: 'ezgi',
    hideNodes: ['Spellbook', '1H_Wand', '2H_Staff', 'Mage_Hat', 'Mage_Cape'],
    model: mageModel,
    modelHeight: 2.1,
    modelFacing: Math.PI,
    skin: 0xf1c2a0,
    hair: 0x3a2418,
    hairStyle: 'ponytail',
    outfit: 0xf4f2ee,
    outfitDark: 0xe3dfd7,
    shirt: 0x6e1a2a,
    bottom: 0x33353c,
    shoe: 0xf2f1ee,
    sole: 0xbfc0c4,
    accent: 0x9b2747,
    glove: 0xf1c2a0,
    eye: 0x4c2c1b,
  },
  jeremy: {
    id: 'jeremy',
    // Every Gold coin he picks up counts twice: the run's total, the bank and the revive
    // price all see the doubled figure (the server scales its coin cap by it, see
    // backend/routes/runner.js).
    perk: { id: 'goldRush', value: 2 },
    name: 'Jeremy Allaire',
    tagline: 'Gold ×2',
    // Jeremy as in his photo (see persona.ts): a shaved head, a cream linen blazer over a
    // navy open-collar shirt, cream trousers, a black belt and grey sneakers. On the knight
    // rig (Sam's skeleton); the plate, helmet, cape and blades stay home.
    persona: 'jeremy',
    model: knightModel,
    modelHeight: 1.74,
    modelFacing: Math.PI,
    hideNodes: ['1H_Sword', '2H_Sword', 'Shield', 'Knight_Helmet', 'Knight_Cape'],
    skin: 0xeec4ac,
    hair: 0xc9b8a0,
    hairStyle: 'spiky',
    outfit: 0xd8c9ae,
    outfitDark: 0xc5b595,
    shirt: 0x1b2234,
    bottom: 0xe6dfd0,
    shoe: 0x8d939c,
    sole: 0xf2f1ee,
    accent: 0xf0b81c,
    glove: 0xeec4ac,
    eye: 0x6f8fa6,
  },
}

/**
 * The zones a run travels through.
 *
 * A zone is first of all a lighting palette — sky, fog, the sun's colour, the sky/ground
 * bounce and the exposure — blended over a stretch of track so the whole world changes
 * mood with it; wilds.ts and districts.ts then dress the roadside to match. The zones
 * are a catalogue: every run draws its own journey through them (see `setJourney`).
 */
export type Weather = 'snow' | 'leaves' | 'dust' | 'ash' | 'petals' | 'fireflies' | 'rain' | 'butterflies' | 'lanterns' | 'fireworks'

export interface Biome {
  /** i18n key suffix: `biome.<name>`; also the zone id the scenery and traffic key off. */
  name: string
  /** City streets, open country, or the inside of a tunnel (the mountain, the ice cave). */
  kind: 'city' | 'wild' | 'tunnel'
  /** Sky behind everything: zenith, the band halfway up, and (below) the fog colour at the horizon. */
  skyTop: string
  sky: string
  /** What the clouds and far ridges are lit with. */
  cloudTint: string
  /** 0 by day, 1 for a full star field. */
  stars: number
  fog: string
  /** Directional light colour. */
  sun: string
  /** Hemisphere light: sky side and ground side. */
  skyBounce: string
  groundBounce: string
  sunIntensity: number
  hemiIntensity: number
  /** The cool fill from the camera side, so the runner's face never goes dark. */
  fillIntensity: number
  exposure: number
  /** The open ground beside the road (grass, snow, sand) and the strip along the kerb. */
  ground: string
  verge: string
  /** Far silhouettes on the sky dome: 0 = rolling ridges, `peaks` = snow-capped mountains, `dunes` = sand. */
  peaks: number
  dunes: number
  /** A flat sea horizon instead of the far ridges (0..1). */
  sea?: number
  /** The erupting volcano on the horizon (0..1). */
  volcano?: number
  /** Northern lights over the sky dome (0..1). */
  aurora?: number
  /** A big low sun with a warm halo on the horizon: sunrise and sunset (0..1). */
  glow?: number
  /** Low mist over the ground and a heavier haze (0..1): the haunted wood, the waterfall's spray, a dawn meadow. */
  mist?: number
  /** A rainbow in the sky (0..1): the waterfall's spray. */
  rainbow?: number
  /** Something in the air. */
  weather?: Weather
}

const GRASS = '#8adc7c'
const PAVEMENT = '#cfcabd'

/**
 * Every zone, in the order the zone book lists them. A run visits them all — shuffled,
 * see ZONE_GROUPS for the ones that always travel together — before the order is drawn
 * again.
 */
export const BIOMES: Biome[] = [
  // The daylight the game shipped with.
  { name: 'city', kind: 'city', skyTop: '#2b8ae8', sky: '#7ccbfb', cloudTint: '#ffffff', stars: 0, fog: '#e0f2ff', sun: '#fff3d6', skyBounce: '#bfe6ff', groundBounce: '#9fd08a', sunIntensity: 1, hemiIntensity: 0.45, fillIntensity: 0.38, exposure: 1.04, ground: GRASS, verge: PAVEMENT, peaks: 0, dunes: 0 },
  // Houses and gardens, a warmer afternoon light.
  { name: 'suburb', kind: 'city', skyTop: '#3a86d8', sky: '#93cdf2', cloudTint: '#fff6ea', stars: 0, fog: '#e8f0e4', sun: '#ffe9c2', skyBounce: '#cfe6f2', groundBounce: '#a6cc82', sunIntensity: 1.02, hemiIntensity: 0.45, fillIntensity: 0.37, exposure: 1.03, ground: GRASS, verge: PAVEMENT, peaks: 0, dunes: 0 },
  // Open farmland under a big clean sky.
  { name: 'plains', kind: 'wild', skyTop: '#1f7fe6', sky: '#8fd3ff', cloudTint: '#ffffff', stars: 0, fog: '#dff3ff', sun: '#fff2cc', skyBounce: '#c4e8ff', groundBounce: '#a8d37a', sunIntensity: 1.04, hemiIntensity: 0.46, fillIntensity: 0.36, exposure: 1.04, ground: '#9fd46a', verge: '#c8b08a', peaks: 0.25, dunes: 0 },
  // The river valley: lakes beside the road, then the big cable-stayed bridge.
  { name: 'river', kind: 'wild', skyTop: '#2f84dc', sky: '#94d0f2', cloudTint: '#ffffff', stars: 0, fog: '#d9efe9', sun: '#fff1cf', skyBounce: '#c2e4f2', groundBounce: '#8fc97a', sunIntensity: 1.02, hemiIntensity: 0.46, fillIntensity: 0.37, exposure: 1.04, ground: '#86cf6c', verge: '#bfae8a', peaks: 0.45, dunes: 0 },
  // Up into the pines: cooler light, a green haze, the range ahead.
  { name: 'forest', kind: 'wild', skyTop: '#3a7cc2', sky: '#9fcbe0', cloudTint: '#f3f7f2', stars: 0, fog: '#c8dccd', sun: '#ffe9c4', skyBounce: '#b9d8d0', groundBounce: '#5f8f52', sunIntensity: 0.98, hemiIntensity: 0.47, fillIntensity: 0.37, exposure: 1.03, ground: '#5f9f4a', verge: '#9c8a6e', peaks: 1, dunes: 0, weather: 'leaves' },
  // Under the mountain: sodium light and a dark, warm haze. The portals are hard cuts.
  { name: 'tunnel', kind: 'tunnel', skyTop: '#1a1612', sky: '#2a2219', cloudTint: '#4a3a2a', stars: 0, fog: '#2e2318', sun: '#ffc27a', skyBounce: '#ffb766', groundBounce: '#3a2a1a', sunIntensity: 0.6, hemiIntensity: 0.6, fillIntensity: 0.36, exposure: 1.0, ground: '#4b4a46', verge: '#7b766c', peaks: 1, dunes: 0 },
  // Out into the snow: blinding white after the tunnel, a cold blue sky.
  { name: 'snow', kind: 'wild', skyTop: '#5b8fd2', sky: '#bcd6ef', cloudTint: '#ffffff', stars: 0, fog: '#e4edf6', sun: '#f4f8ff', skyBounce: '#dbe9fb', groundBounce: '#c9d6e6', sunIntensity: 1.12, hemiIntensity: 0.72, fillIntensity: 0.42, exposure: 1.08, ground: '#eef3f8', verge: '#cfd8e2', peaks: 1, dunes: 0, weather: 'snow' },
  // The desert under the noon sun: a hard blue sky, a hot pale haze.
  { name: 'desert', kind: 'wild', skyTop: '#3d7fd6', sky: '#a9cfe9', cloudTint: '#fff8ee', stars: 0, fog: '#f0dcb4', sun: '#fff0d2', skyBounce: '#f3dcb5', groundBounce: '#d6a868', sunIntensity: 1.08, hemiIntensity: 0.5, fillIntensity: 0.34, exposure: 1.05, ground: '#ecc98e', verge: '#d6b07a', peaks: 0, dunes: 1, weather: 'dust' },
  // The volcano: black basalt, lava in the fields, ash falling from a red sky.
  { name: 'volcano', kind: 'wild', skyTop: '#3a1a1e', sky: '#b5503a', cloudTint: '#7a5550', stars: 0, fog: '#8a5444', sun: '#ffb27a', skyBounce: '#ff9a6a', groundBounce: '#4a2a22', sunIntensity: 0.96, hemiIntensity: 0.56, fillIntensity: 0.36, exposure: 1.0, ground: '#4a433f', verge: '#625a54', peaks: 0, dunes: 0, volcano: 1, weather: 'ash' },
  // A tropical beach: white sand, palms, the sea along the right of the road.
  { name: 'beach', kind: 'wild', skyTop: '#1b84e0', sky: '#86d6f6', cloudTint: '#ffffff', stars: 0, fog: '#d6f1f6', sun: '#fff4d8', skyBounce: '#bfeaf6', groundBounce: '#e8d3a0', sunIntensity: 1.06, hemiIntensity: 0.5, fillIntensity: 0.37, exposure: 1.05, ground: '#f1dca8', verge: '#e6cf98', peaks: 0, dunes: 0, sea: 1 },
  // The sea bridge: open water on both sides as the afternoon turns gold.
  { name: 'seabridge', kind: 'wild', skyTop: '#2a6fd0', sky: '#a8d4ee', cloudTint: '#fff3e0', stars: 0, fog: '#e6eef0', sun: '#ffe2b0', skyBounce: '#cfe2ee', groundBounce: '#8fb3c4', sunIntensity: 1.04, hemiIntensity: 0.48, fillIntensity: 0.36, exposure: 1.04, ground: '#e0d0a4', verge: '#c4c2bc', peaks: 0, dunes: 0, sea: 1 },
  // The harbour at dusk: cranes, warehouses, container yards.
  { name: 'port', kind: 'city', skyTop: '#25215a', sky: '#5b4b9a', cloudTint: '#c9a6e6', stars: 0.35, fog: '#9382c6', sun: '#cdaaff', skyBounce: '#9182d6', groundBounce: '#453c72', sunIntensity: 0.86, hemiIntensity: 0.4, fillIntensity: 0.31, exposure: 0.97, ground: GRASS, verge: PAVEMENT, peaks: 0, dunes: 0 },
  // Neon night: dark sky, cold key light, the emissive lift on every prop doing the
  // work of keeping the runner and the traffic readable.
  { name: 'neon', kind: 'city', skyTop: '#04081a', sky: '#141d40', cloudTint: '#3b4c86', stars: 1, fog: '#28376d', sun: '#8fdcff', skyBounce: '#33549f', groundBounce: '#161d38', sunIntensity: 0.74, hemiIntensity: 0.4, fillIntensity: 0.3, exposure: 0.95, ground: GRASS, verge: PAVEMENT, peaks: 0, dunes: 0 },
  // Ha Long Bay: jade water, limestone karsts standing out of it, junks under brown sails.
  { name: 'halong', kind: 'wild', skyTop: '#4a8fcc', sky: '#a9d4e4', cloudTint: '#f6faf6', stars: 0, fog: '#cfe5e0', sun: '#fff1d8', skyBounce: '#c8e6e2', groundBounce: '#8fb89e', sunIntensity: 1.0, hemiIntensity: 0.5, fillIntensity: 0.37, exposure: 1.04, ground: '#a8cf86', verge: '#cbbf9c', peaks: 0, dunes: 0, sea: 1, mist: 0.35 },
  // A valley of cherry blossom and red maples, petals on the wind.
  { name: 'blossom', kind: 'wild', skyTop: '#5a8fd8', sky: '#c2d8f0', cloudTint: '#fff0f4', stars: 0, fog: '#f2dfe6', sun: '#fff0e6', skyBounce: '#f0d8e4', groundBounce: '#a8c98a', sunIntensity: 1.02, hemiIntensity: 0.5, fillIntensity: 0.37, exposure: 1.05, ground: '#9ccf78', verge: '#d8c2a6', peaks: 0.6, dunes: 0, weather: 'petals' },
  // A green canyon: sheer cliffs, waterfalls into the river, spray and a rainbow.
  { name: 'waterfall', kind: 'wild', skyTop: '#3f86c8', sky: '#a4d0e6', cloudTint: '#ffffff', stars: 0, fog: '#d2eae4', sun: '#fff4dc', skyBounce: '#c6e6ea', groundBounce: '#6fa878', sunIntensity: 1.0, hemiIntensity: 0.5, fillIntensity: 0.37, exposure: 1.04, ground: '#6fb85a', verge: '#a89a80', peaks: 1, dunes: 0, mist: 0.45, rainbow: 1 },
  // The savanna at sunset: acacias, a huge orange sky, giraffes and elephants against it.
  { name: 'savanna', kind: 'wild', skyTop: '#3d4f92', sky: '#f0a46a', cloudTint: '#ffd0a6', stars: 0, fog: '#f0bf8c', sun: '#ffc07a', skyBounce: '#ffcf9a', groundBounce: '#b8863e', sunIntensity: 1.0, hemiIntensity: 0.5, fillIntensity: 0.35, exposure: 1.02, ground: '#d2b25e', verge: '#c09a5a', peaks: 0.15, dunes: 0, glow: 1 },
  // Ruins of an old temple city: mossy towers, stone gates over the road, statues.
  { name: 'temple', kind: 'wild', skyTop: '#4a86b8', sky: '#b2d0d6', cloudTint: '#f2f2ea', stars: 0, fog: '#cdd9c4', sun: '#fff0c8', skyBounce: '#cfe0d0', groundBounce: '#6f9a58', sunIntensity: 1.0, hemiIntensity: 0.5, fillIntensity: 0.36, exposure: 1.03, ground: '#77a85a', verge: '#a8a088', peaks: 0.35, dunes: 0, weather: 'butterflies' },
  // The floating market: a road between two canals, boats heaped with fruit, stilt houses.
  { name: 'floatmarket', kind: 'wild', skyTop: '#2a88dc', sky: '#9ad6f0', cloudTint: '#ffffff', stars: 0, fog: '#dcefe2', sun: '#fff2d0', skyBounce: '#c8eaee', groundBounce: '#8ec86e', sunIntensity: 1.04, hemiIntensity: 0.48, fillIntensity: 0.36, exposure: 1.04, ground: '#7fc860', verge: '#c8a878', peaks: 0, dunes: 0 },
  // A windy coast: green clifftops over the sea, white turbines turning.
  { name: 'windcoast', kind: 'wild', skyTop: '#2d7ad8', sky: '#9ecff4', cloudTint: '#ffffff', stars: 0, fog: '#e0eef6', sun: '#fff6e0', skyBounce: '#cfe6f6', groundBounce: '#8fc878', sunIntensity: 1.04, hemiIntensity: 0.48, fillIntensity: 0.37, exposure: 1.05, ground: '#8fcf6e', verge: '#bdb59a', peaks: 0, dunes: 0, sea: 1 },
  // The city of the future at dusk: glass towers, glowing tubes, a rocket on its pad.
  { name: 'future', kind: 'wild', skyTop: '#1c2a6a', sky: '#6c80cf', cloudTint: '#d8c8ff', stars: 0.2, fog: '#9ba8de', sun: '#d8e8ff', skyBounce: '#a8b8f0', groundBounce: '#4a5288', sunIntensity: 0.9, hemiIntensity: 0.44, fillIntensity: 0.33, exposure: 0.99, ground: '#7c9ab8', verge: '#b8c2d4', peaks: 0, dunes: 0 },
  // The haunted wood at night: fog, dead trees, fireflies, glowing pumpkins, gravestones.
  { name: 'haunted', kind: 'wild', skyTop: '#080a16', sky: '#1e2238', cloudTint: '#4a4f6a', stars: 0.6, fog: '#30364a', sun: '#a8b8e8', skyBounce: '#3c4672', groundBounce: '#1c202c', sunIntensity: 0.72, hemiIntensity: 0.44, fillIntensity: 0.32, exposure: 0.95, ground: '#3e4838', verge: '#4c4a40', peaks: 0.3, dunes: 0, mist: 1, weather: 'fireflies' },
  // The ice cave: a tunnel of blue ice under the glacier, icicles overhead.
  { name: 'icecave', kind: 'tunnel', skyTop: '#0e2a3e', sky: '#1e4a66', cloudTint: '#6aa0c0', stars: 0, fog: '#2a6a8a', sun: '#bfeaff', skyBounce: '#8fd8ff', groundBounce: '#2a5a78', sunIntensity: 0.7, hemiIntensity: 0.66, fillIntensity: 0.38, exposure: 1.02, ground: '#a8d0e0', verge: '#c8e4f0', peaks: 1, dunes: 0 },
  // The frozen lake under the northern lights.
  { name: 'icelake', kind: 'wild', skyTop: '#06102a', sky: '#16325c', cloudTint: '#4a6a9a', stars: 1, fog: '#2c4c74', sun: '#cfe8ff', skyBounce: '#5a86c0', groundBounce: '#4a6a90', sunIntensity: 0.8, hemiIntensity: 0.6, fillIntensity: 0.36, exposure: 1.0, ground: '#dfe9f4', verge: '#c2d0e0', peaks: 1, dunes: 0, aurora: 1, weather: 'snow' },
  // A farm and fields of flowers: sunflowers, tulip stripes, a red barn, butterflies.
  { name: 'farm', kind: 'wild', skyTop: '#2c82e0', sky: '#9cd6fa', cloudTint: '#ffffff', stars: 0, fog: '#e4f4f6', sun: '#fff2cc', skyBounce: '#cfeaff', groundBounce: '#b0d47e', sunIntensity: 1.04, hemiIntensity: 0.47, fillIntensity: 0.36, exposure: 1.04, ground: '#a3d46e', verge: '#cbb48c', peaks: 0.2, dunes: 0, weather: 'butterflies' },
  // A red rock canyon: mesas and arches, a hot hazy sky.
  { name: 'redcanyon', kind: 'wild', skyTop: '#3a78c8', sky: '#b6cce0', cloudTint: '#fff2e6', stars: 0, fog: '#e6b894', sun: '#ffe4c0', skyBounce: '#f0c8a8', groundBounce: '#c0603a', sunIntensity: 1.06, hemiIntensity: 0.5, fillIntensity: 0.34, exposure: 1.04, ground: '#c8744c', verge: '#b0603e', peaks: 0, dunes: 0.35, weather: 'dust' },
  // An oasis: palms round blue water, camels, tents, the dunes all round.
  { name: 'oasis', kind: 'wild', skyTop: '#2f7ed8', sky: '#a4d4ee', cloudTint: '#fffaf0', stars: 0, fog: '#eee2bc', sun: '#fff2d4', skyBounce: '#e8e0c0', groundBounce: '#c8a870', sunIntensity: 1.06, hemiIntensity: 0.5, fillIntensity: 0.35, exposure: 1.05, ground: '#e6cc94', verge: '#d4b480', peaks: 0, dunes: 1 },
  // The rainforest: giant trees, vines, a soft warm rain.
  { name: 'jungle', kind: 'wild', skyTop: '#4f7f9e', sky: '#a6c4c2', cloudTint: '#e6ece8', stars: 0, fog: '#a8c4b0', sun: '#f6f0d8', skyBounce: '#b0d0b8', groundBounce: '#4a7a3e', sunIntensity: 0.92, hemiIntensity: 0.5, fillIntensity: 0.36, exposure: 1.02, ground: '#4f9a3c', verge: '#7a6a4a', peaks: 0.5, dunes: 0, mist: 0.3, weather: 'rain' },
  // Rice terraces and an old lantern town at golden hour, sky lanterns rising.
  { name: 'terraces', kind: 'wild', skyTop: '#33427c', sky: '#e69c7c', cloudTint: '#ffc8b0', stars: 0.15, fog: '#d6a28e', sun: '#ffb88a', skyBounce: '#f0b8a0', groundBounce: '#8a8a48', sunIntensity: 0.9, hemiIntensity: 0.48, fillIntensity: 0.34, exposure: 1.0, ground: '#9cb84a', verge: '#a88a62', peaks: 0.7, dunes: 0, glow: 0.6, weather: 'lanterns' },
  // The skyway: an elevated road over the night city, fireworks over the towers.
  { name: 'highway', kind: 'wild', skyTop: '#060a1e', sky: '#1a2250', cloudTint: '#3e4a8a', stars: 1, fog: '#2a3470', sun: '#9fd0ff', skyBounce: '#3a4e9a', groundBounce: '#1a1e3a', sunIntensity: 0.74, hemiIntensity: 0.4, fillIntensity: 0.3, exposure: 0.95, ground: '#2a2e3e', verge: '#3a3e4e', peaks: 0, dunes: 0, weather: 'fireworks' },
  // Daybreak over the meadows: the sun coming up, mist in the hollows, hot-air balloons.
  { name: 'dawn', kind: 'wild', skyTop: '#3a5aa8', sky: '#f4b89c', cloudTint: '#ffd8c0', stars: 0.1, fog: '#f0c8b6', sun: '#ffd2a0', skyBounce: '#f0c8b8', groundBounce: '#9aa878', sunIntensity: 0.92, hemiIntensity: 0.48, fillIntensity: 0.35, exposure: 1.02, ground: '#9fcf7a', verge: '#c8b8a0', peaks: 0.3, dunes: 0, glow: 1, mist: 0.5 },
]

/** How many zones a full journey visits. */
export const ZONE_COUNT = BIOMES.length

/** Emoji for each zone, for the HUD's title card, the journey bar and the zone book. */
export const ZONE_ICONS: Record<string, string> = {
  city: '🏙️', suburb: '🏡', plains: '🌾', river: '🌉', forest: '🌲', tunnel: '🚇', snow: '❄️',
  desert: '🏜️', volcano: '🌋', beach: '🏖️', seabridge: '🌊', port: '⚓', neon: '🌃',
  halong: '⛵', blossom: '🌸', waterfall: '🏞️', savanna: '🦒', temple: '🛕', floatmarket: '🛶',
  windcoast: '🌬️', future: '🚀', haunted: '🎃', icecave: '🧊', icelake: '🌌', farm: '🌻',
  redcanyon: '🌵', oasis: '🐪', jungle: '🦜', terraces: '🏮', highway: '🛣️', dawn: '🌅',
}

/**
 * Zones that always travel together, in this order: the forest climbs to the tunnel
 * that comes out on the snowfields; the ice cave opens on the frozen lake; the beach
 * runs onto the sea bridge; the neon night takes the skyway out of town into dawn.
 */
export const ZONE_GROUPS: string[][] = [
  ['forest', 'tunnel', 'snow'],
  ['icecave', 'icelake'],
  ['beach', 'seabridge'],
  ['neon', 'highway', 'dawn'],
]

/** Seconds a zone lasts at the Normal pace, wherever in the run it falls. */
export const ZONE_SECONDS = 50
/** A tunnel is a fixed tube (tunnel.ts builds it once), so it is a fixed length. */
export const TUNNEL_LENGTH = 520
/** The handover at a tunnel portal: a hard cut the rock face hides. */
const PORTAL_BLEND = 24
/** Shortest handover between two open-air zones. */
export const BIOME_BLEND = 150
/** Longest handover (night into noon). */
const BIOME_BLEND_MAX = 480
/** A handover never takes more than this share of the zone it starts in. */
const BLEND_SHARE = 0.42

/**
 * Metres a run covers in `elapsed` seconds at the Normal pace (the integral of speedAt).
 * The journey is laid out with it, so each zone lasts about ZONE_SECONDS: short in metres
 * at the start of a run, long once the speed has ramped up.
 */
export function distanceAt(elapsed: number): number {
  const ramp = RUN.rampSeconds
  const rise = RUN.maxSpeed - RUN.startSpeed
  const t = Math.min(Math.max(0, elapsed), ramp)
  let d = RUN.startSpeed * t + rise * (t - (ramp / 3.1) * (1 - Math.pow(1 - t / ramp, 3.1)))
  if (elapsed > ramp) d += RUN.maxSpeed * (elapsed - ramp)
  return d
}

/** The inverse of distanceAt. */
export function timeAtDistance(distance: number): number {
  let lo = 0
  let hi = 60 + distance / RUN.startSpeed
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2
    if (distanceAt(mid) < distance) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const linearCache = new Map<string, [number, number, number]>()
function linearRgb(hex: string): [number, number, number] {
  let out = linearCache.get(hex)
  if (!out) {
    const n = parseInt(hex.slice(1), 16)
    const ch = (v: number) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    out = [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)]
    linearCache.set(hex, out)
  }
  return out
}

const PALETTE_KEYS = ['sky', 'skyTop', 'fog', 'sun', 'skyBounce', 'groundBounce', 'ground', 'verge'] as const

/** How far apart two zones' palettes are: the biggest colour change among them (linear RGB, summed channels). */
export function paletteGap(a: Biome, b: Biome): number {
  let gap = 0
  for (const key of PALETTE_KEYS) {
    const x = linearRgb(a[key])
    const y = linearRgb(b[key])
    gap = Math.max(gap, Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]))
  }
  return gap
}

/**
 * Metres over which `from` hands over to `to`: a hard cut at a tunnel portal, otherwise
 * longer the further apart the palettes are, so night into noon takes its time and
 * never steps (scripts/biome-check.ts samples it metre by metre).
 */
export function handover(from: Biome, to: Biome): number {
  if (from.kind === 'tunnel' || to.kind === 'tunnel') return PORTAL_BLEND
  const gap = paletteGap(from, to)
  return Math.round(Math.min(BIOME_BLEND_MAX, Math.max(BIOME_BLEND, 150 + gap * 220, (1.5 * gap) / 0.014)))
}

/**
 * Water. Two kinds:
 *  - beside the road (side ±1): a lake, a river or the sea beyond `shore` metres from
 *    the centre line, painted onto the ground at ground level. Its shore curls away
 *    over WATER_TAPER at both ends, so a body of water never ends in a ruled line.
 *  - under the road (side 0): the road crosses on a bridge; the ground is cut away
 *    right across and the water lies DEEP_WATER_Y below, with a bank at each end.
 * Spans are absolute run distances, laid out per zone (ZONE_WATERS) when the journey
 * is drawn; the shader in surface.ts and the scenery placement in districts.ts share
 * the shapes below, so a boat never sits on grass.
 */
export interface WaterSpan {
  start: number
  end: number
  side: -1 | 0 | 1
  /** Beside the road: distance of the shore from the centre line (m). */
  shore: number
  /** Under the road: what carries it. A skyway crosses the night city, not water. */
  bridge?: 'cable' | 'viaduct' | 'skyway'
  /** Salt water: dolphins, sailing boats. */
  sea?: boolean
  /** Frozen over: no waves, no glitter. */
  ice?: boolean
  color: string
}

/**
 * Where a zone's water lies: `from`/`to` are fractions of the zone, `length` fixes a
 * span's length in metres (a cable-stayed bridge has a set span), and a span marked
 * `after` starts no sooner than 100 m past the one before it.
 */
interface WaterPlan {
  from: number
  to: number
  length?: number
  after?: boolean
  side: -1 | 0 | 1
  shore: number
  bridge?: WaterSpan['bridge']
  sea?: boolean
  ice?: boolean
  color: string
}

const ZONE_WATERS: Record<string, WaterPlan[]> = {
  // A lake on the left, the river crossing, the river on the right.
  river: [
    { from: 0.08, to: 0.42, side: -1, shore: 24, color: '#3a9ab4' },
    { from: 0.47, to: 1, length: 240, after: true, side: 0, shore: 0, bridge: 'cable', color: '#2f8fb0' },
    { from: 0.62, to: 0.98, after: true, side: 1, shore: 24, color: '#3a9ab4' },
  ],
  // The sea along the right all the way to the bridge.
  beach: [{ from: 0.03, to: 1, side: 1, shore: 30, sea: true, color: '#22b0c8' }],
  seabridge: [{ from: 0.02, to: 1, side: 0, shore: 0, bridge: 'viaduct', sea: true, color: '#1f8cc2' }],
  // Jade water among the karsts: the bay on the left, the cable bridge, the bay on the right.
  halong: [
    { from: 0.04, to: 0.4, side: -1, shore: 26, sea: true, color: '#2f9e98' },
    { from: 0.46, to: 1, length: 240, after: true, side: 0, shore: 0, bridge: 'cable', sea: true, color: '#2a9290' },
    { from: 0.6, to: 1, after: true, side: 1, shore: 26, sea: true, color: '#2f9e98' },
  ],
  // The road runs on the dyke between two canals.
  floatmarket: [
    { from: 0.04, to: 1, side: -1, shore: 19, color: '#7d9a62' },
    { from: 0.04, to: 1, side: 1, shore: 19, color: '#7d9a62' },
  ],
  // The open sea below the cliffs on the left.
  windcoast: [{ from: 0.04, to: 1, side: -1, shore: 40, sea: true, color: '#2a8ec0' }],
  // The pool under the falls, along the right.
  waterfall: [{ from: 0.12, to: 0.92, side: 1, shore: 26, color: '#3aa0a8' }],
  // The oasis pool, on the right half way through.
  oasis: [{ from: 0.28, to: 0.66, side: 1, shore: 22, color: '#2fb2b6' }],
  // The frozen lake on the left.
  icelake: [{ from: 0.06, to: 0.94, side: -1, shore: 22, ice: true, color: '#bcd8e6' }],
  // The skyway: the ground drops away to the lit streets below.
  highway: [{ from: 0.03, to: 1, side: 0, shore: 0, bridge: 'skyway', color: '#121a34' }],
}

export const WATER_TAPER = 150
/** How far the shore curls away at the very end of a span (beyond the fog on every preset). */
export const WATER_CURL = 460
/** Water level under a bridge. */
export const DEEP_WATER_Y = -5.5
/** Shortest side water worth drawing. */
const WATER_MIN = 200

/** One zone of a journey, in absolute run distance. */
export interface Leg {
  zone: Biome
  /** Where this zone is fully in charge. */
  start: number
  /** Where the next zone is fully in charge. */
  end: number
  /** Metres before `start` over which the previous zone hands over to this one. */
  blend: number
  /** Place in its round of the journey (0-based), and which round. */
  index: number
  cycle: number
  waters: WaterSpan[]
}

interface Journey {
  seed: number
  first: string | null
  legs: Leg[]
  /** Seconds (Normal pace) at the end of the last leg. */
  time: number
}

/** A small seeded generator (mulberry32), so a journey is the same every time it is drawn. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BY_NAME = new Map(BIOMES.map((zone) => [zone.name, zone]))
/** The units the shuffle moves: a group, or a zone on its own. */
const UNITS: Biome[][] = (() => {
  const grouped = new Set(ZONE_GROUPS.flat())
  const units = ZONE_GROUPS.map((group) => group.map((name) => BY_NAME.get(name) as Biome))
  for (const zone of BIOMES) if (!grouped.has(zone.name)) units.push([zone])
  return units
})()

function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/**
 * One round of the journey: every zone once, groups kept together. A few orders are
 * drawn and the one with the gentlest handovers kept, so a run does not keep lurching
 * from night to noon. The first round never opens in a tunnel (or on the zone a
 * player asked to start in, for the debug seam); no round opens on the unit the last
 * one closed with.
 */
function drawRound(journey: Journey, cycle: number, previous: Biome[] | null): Biome[] {
  const rng = seeded((journey.seed ^ Math.imul(cycle + 1, 0x9e3779b1)) >>> 0)
  let best: Biome[][] = []
  let bestScore = Infinity
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const order = shuffle(UNITS.slice(), rng)
    const lead = (unit: Biome[]) =>
      cycle === 0 && journey.first ? unit.some((zone) => zone.name === journey.first) : unit[0].kind !== 'tunnel'
    if (cycle === 0) {
      const at = order.findIndex(lead)
      if (at > 0) [order[0], order[at]] = [order[at], order[0]]
    } else if (order[0] === previous) {
      ;[order[0], order[1]] = [order[1], order[0]]
    }
    let score = 0
    let last = previous ? previous[previous.length - 1] : null
    for (const unit of order) {
      if (last) score += paletteGap(last, unit[0])
      last = unit[unit.length - 1]
    }
    if (score < bestScore) {
      bestScore = score
      best = order
    }
  }
  return best.flat()
}

/** Lays a zone's water out along its leg (needs the next leg's handover). */
function layWaters(leg: Leg, next: Leg): WaterSpan[] {
  const plans = ZONE_WATERS[leg.zone.name]
  if (!plans) return []
  const length = leg.end - leg.start
  const first = leg.start - leg.blend / 2 + 40
  const last = leg.end - next.blend / 2 - 40
  const out: WaterSpan[] = []
  let previousEnd = -Infinity
  for (const plan of plans) {
    let start = Math.max(first, leg.start + plan.from * length)
    if (plan.after) start = Math.max(start, previousEnd + 100)
    const end = Math.min(last, plan.length ? start + plan.length : leg.start + plan.to * length)
    if (plan.length ? end - start < plan.length - 0.5 : end - start < WATER_MIN) continue
    out.push({ start, end, side: plan.side, shore: plan.shore, bridge: plan.bridge, sea: plan.sea, ice: plan.ice, color: plan.color })
    previousEnd = end
  }
  return out
}

function extend(journey: Journey): void {
  const legs = journey.legs
  const tail = legs[legs.length - 1]
  const cycle = tail ? tail.cycle + 1 : 0
  const previous = tail ? UNITS.find((unit) => unit.includes(tail.zone)) ?? null : null
  const round = drawRound(journey, cycle, previous)
  round.forEach((zone, index) => {
    const before = legs[legs.length - 1]
    const start = before ? before.end : 0
    const length = zone.kind === 'tunnel' ? TUNNEL_LENGTH : distanceAt(journey.time + ZONE_SECONDS) - distanceAt(journey.time)
    journey.time = timeAtDistance(start + length)
    const blend = before ? Math.min(handover(before.zone, zone), BLEND_SHARE * (before.end - before.start)) : 0
    const leg: Leg = { zone, start, end: start + length, blend, index, cycle, waters: [] }
    if (before) before.waters = layWaters(before, leg)
    legs.push(leg)
  })
}

let journey: Journey = { seed: 1, first: null, legs: [], time: 0 }

/**
 * Draws the journey every zone function below reads. A run rolls a fresh seed; `first`
 * (debug only) makes the journey open with that zone's group.
 */
export function setJourney(seed: number, first: string | null = null): void {
  journey = { seed: seed >>> 0, first, legs: [], time: 0 }
  extend(journey)
}

export function journeySeed(): number {
  return journey.seed
}

/** Keeps the journey drawn at least a few zones past `distance`. */
function reach(distance: number): Leg[] {
  const legs = journey.legs
  if (legs.length === 0) extend(journey)
  while (legs[legs.length - 1].start < distance + 6000) extend(journey)
  return legs
}

/** Index of the leg holding `distance` (the first one for anything before the start). */
function legIndex(distance: number): number {
  const legs = reach(distance)
  let lo = 0
  let hi = legs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (legs[mid].start <= distance) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** The leg the run is in at `distance`. */
export function legAt(distance: number): Leg {
  return journey.legs[legIndex(distance)]
}

/** The legs of the round `distance` is in, for the HUD's journey bar. */
export function roundAt(distance: number): Leg[] {
  const leg = legAt(distance)
  return journey.legs.filter((other) => other.cycle === leg.cycle)
}

export interface BiomeMix {
  from: Biome
  to: Biome
  /** 0 while `from` owns the sky, 1 once `to` has taken over. */
  t: number
}

/**
 * Which two zones the run currently sits between, and how far through the handover it
 * is. Pure, so the check can walk the whole distance range without a browser.
 */
export function biomeMix(distance: number): BiomeMix {
  const span = biomeSpan(distance)
  const raw = (distance - span.start) / (span.end - span.start)
  const t = Math.min(1, Math.max(0, raw))
  // Smoothstep: a handover that eases in and out reads as weather, not as a switch.
  return { from: span.from, to: span.to, t: t * t * (3 - 2 * t) }
}

export interface BiomeSpan {
  from: Biome
  to: Biome
  /** Absolute run distances at which the handover from `from` to `to` starts and ends. */
  start: number
  end: number
}

/**
 * The handover the run is in or is heading for, in absolute run distance. `from` is the
 * zone the run has *fully entered*; the handover to the next one ends where that one
 * is fully in charge.
 */
export function biomeSpan(distance: number): BiomeSpan {
  const i = legIndex(distance)
  const leg = journey.legs[i]
  const next = journey.legs[i + 1]
  return { from: leg.zone, to: next.zone, start: next.start - next.blend, end: next.start }
}

/** The zone owning `distance`, as a Biome (the nearer side of a handover). */
export function biomeAt(distance: number): Biome {
  const span = biomeSpan(distance)
  return distance < (span.start + span.end) / 2 ? span.from : span.to
}

/** The zone that owns the road at `distance` (the nearer side of a handover). */
export function zoneAt(distance: number): string {
  return biomeAt(distance).name
}

export interface TunnelSpan {
  /** The portal (where the road becomes the tunnel's) and the far mouth. */
  start: number
  end: number
  zone: string
}

function tunnelOf(i: number): TunnelSpan {
  const leg = journey.legs[i]
  const next = journey.legs[i + 1]
  return { start: leg.start - leg.blend / 2, end: leg.end - next.blend / 2, zone: leg.zone.name }
}

/**
 * The tunnel the road is in or will reach next from `distance` (any tunnel, or only
 * `zone`'s): `end` is still ahead of `distance - margin`.
 */
export function nextTunnel(distance: number, zone: string | null = null, margin = 0): TunnelSpan {
  let i = Math.max(0, legIndex(distance - margin) - 1)
  for (;;) {
    const leg = journey.legs[i]
    if (leg.zone.kind === 'tunnel' && (zone === null || leg.zone.name === zone)) {
      const span = tunnelOf(i)
      if (span.end + margin > distance) return span
    }
    i += 1
    if (i >= journey.legs.length - 1) reach(journey.legs[i - 1].end + 1)
  }
}

/** The tunnel the road is in or heading for at `distance`. */
export function tunnelAround(distance: number): TunnelSpan {
  return nextTunnel(distance)
}

/** Metres into the water (negative: on land) at `rel` metres into a side span, `x` across. */
export function sideWaterDepth(span: WaterSpan, rel: number, x: number): number {
  if (span.side === 0) return -1e4
  const into = Math.min(rel, span.end - span.start - rel)
  if (into <= 0) return -1e4
  const t = Math.min(1, Math.max(0, 1 - into / WATER_TAPER))
  const shore = span.shore + t * t * WATER_CURL + Math.sin(rel * 0.031) * 3 + Math.sin(rel * 0.087 + 1.3) * 1.4
  return x * span.side - shore
}

export interface WaterHere {
  span: WaterSpan
  /** Absolute run distances of the span. */
  start: number
  end: number
}

/** The water spans overlapping [from, to] (absolute run distance), nearest first. */
export function watersBetween(from: number, to: number): WaterHere[] {
  const out: WaterHere[] = []
  reach(to)
  const legs = journey.legs
  // A zone's water starts no earlier than half its incoming handover.
  for (let i = Math.max(0, legIndex(from) - 1); i < legs.length && legs[i].start - BIOME_BLEND_MAX <= to; i += 1) {
    for (const span of legs[i].waters) if (span.end >= from && span.start <= to) out.push({ span, start: span.start, end: span.end })
  }
  return out
}

/** Every water span in the journey up to `to` — for the check. */
export function watersUpTo(to: number): WaterSpan[] {
  reach(to)
  return journey.legs.filter((leg) => leg.start <= to).flatMap((leg) => leg.waters)
}

/** What is at run distance `distance`, `x` metres across: land, side water (at ground level) or deep water under a bridge. */
export function waterAt(distance: number, x: number): 'land' | 'side' | 'deep' {
  let side = false
  for (const here of watersBetween(distance, distance)) {
    if (here.span.side === 0) return 'deep'
    if (sideWaterDepth(here.span, distance - here.start, x) > 0) side = true
  }
  return side ? 'side' : 'land'
}

/** Where the side water's shore is on `side` at `distance`, or null if there is none. */
export function shoreAt(distance: number, side: -1 | 1): number | null {
  for (const here of watersBetween(distance, distance)) {
    if (here.span.side !== side) continue
    const depth = sideWaterDepth(here.span, distance - here.start, 0)
    if (depth > -1e3) return -depth
  }
  return null
}

setJourney(1)

/**
 * Difficulty. One multiplier set applied to the two things that actually decide how
 * hard a run is — how fast the world moves and how much room it leaves between
 * obstacle patterns — plus how often a run hands you a harmful power, and what a
 * second chance costs.
 */
export type DifficultyId = 'easy' | 'normal' | 'hard'

export interface DifficultySpec {
  id: DifficultyId
  /** Multiplier on both the starting and the top speed. */
  speed: number
  /** Multiplier on the gap between patterns: bigger leaves more room. */
  gaps: number
  /** Multiplier on how often a harmful power is drawn. */
  harmful: number
  /**
   * Multiplier on every point scored. Easy runs last far longer, so without this the
   * gentlest mode topped the board; risk has to pay.
   */
  score: number
  /** Multiplier on the Arc a run puts in the wallet (applied by the server). */
  bank: number
  /** Least a continue can cost, in coins. */
  reviveCost: number
}

/**
 * Easy is for learning (half points), Normal is the reference, Hard is for the board
 * (+50% points, +30% Arc). The server re-checks the claimed mode against the run's own
 * distance and speed, which differ measurably between modes.
 */
export const DIFFICULTIES: DifficultySpec[] = [
  { id: 'easy', speed: 0.86, gaps: 1.28, harmful: 0.5, score: 0.5, bank: 0.7, reviveCost: 20 },
  { id: 'normal', speed: 1, gaps: 1, harmful: 1, score: 1, bank: 1, reviveCost: 30 },
  { id: 'hard', speed: 1.16, gaps: 0.8, harmful: 1.45, score: 1.5, bank: 1.3, reviveCost: 40 },
]

/** A continue costs a quarter of the run's coins (never less than the mode's floor). */
export const REVIVE_SHARE = 0.25

export function reviveCostFor(spec: DifficultySpec, coins: number): number {
  return Math.max(spec.reviveCost, Math.ceil(coins * REVIVE_SHARE))
}

export function difficulty(id: string | null | undefined): DifficultySpec {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1]
}

/**
 * Missions — the thing that turns "how far did I get" into "what am I trying to do".
 *
 * Three are rolled per run from a weighted catalogue, with a target inside a range so
 * two runs never ask for exactly the same thing. Every one of them is measurable from
 * state the run already keeps, and the reward is paid in coins, which is what makes
 * coins worth chasing.
 */
export type MissionId = 'distance' | 'coins' | 'combo' | 'powers' | 'slides' | 'nearMiss' | 'jumps'

export interface MissionSpec {
  id: MissionId
  /** Inclusive target range, in the mission's own unit. */
  min: number
  max: number
  /** Targets are rounded to this so they read as round numbers. */
  step: number
  /** Coins paid on completion. */
  reward: number
  /** Bigger is rarer. */
  weight: number
}

export const MISSIONS: MissionSpec[] = [
  { id: 'distance', min: 600, max: 1600, step: 100, reward: 30, weight: 10 },
  { id: 'coins', min: 20, max: 45, step: 5, reward: 25, weight: 10 },
  { id: 'combo', min: 12, max: 26, step: 2, reward: 35, weight: 7 },
  { id: 'powers', min: 3, max: 7, step: 1, reward: 30, weight: 8 },
  { id: 'slides', min: 5, max: 14, step: 1, reward: 25, weight: 8 },
  { id: 'jumps', min: 8, max: 20, step: 2, reward: 25, weight: 8 },
  { id: 'nearMiss', min: 2, max: 5, step: 1, reward: 45, weight: 5 },
]

export const MISSION_COUNT = 3

export interface MissionRoll {
  id: MissionId
  target: number
  reward: number
}

/** Rolls a fresh set of missions. `rng` is the run's seeded generator. */
export function rollMissions(rng: () => number, count = MISSION_COUNT): MissionRoll[] {
  const pool = MISSIONS.slice()
  const rolls: MissionRoll[] = []
  while (rolls.length < count && pool.length > 0) {
    const total = pool.reduce((sum, m) => sum + m.weight, 0)
    let pick = rng() * total
    let index = 0
    while (index < pool.length - 1 && pick > pool[index].weight) {
      pick -= pool[index].weight
      index += 1
    }
    const spec = pool.splice(index, 1)[0]
    const span = Math.max(1, Math.round((spec.max - spec.min) / spec.step))
    const target = spec.min + Math.round(rng() * span) * spec.step
    rolls.push({ id: spec.id, target, reward: spec.reward })
  }
  return rolls
}

/**
 * Crash pressure. A crash adds heat and clean running sheds it; reach the top of the
 * meter and the run is over. Nothing chases the runner on screen — the meter is the
 * whole of the system — so two crashes in quick succession end a run that a single
 * crash would not have.
 */
export const PURSUIT = {
  /**
   * Heat added by one crash. Two of them back to back is exactly the meter, so a
   * single mistake is survivable and a second one inside the cool-down is not.
   */
  crashHeat: 0.5,
  /** Heat shed per second of clean running. */
  coolPerSecond: 0.17,
  /**
   * Heat at which the run is over. There is no car on screen any more, so the meter is
   * the whole of the system: a crash is felt as the bar jumping, and two crashes in
   * quick succession end the run.
   */
  bustedAt: 1,
}

export const CAMERA = {
  fov: 62,
  boostFov: 74,
  fovRate: 4.5,
  shakeDecay: 3.4,
}
