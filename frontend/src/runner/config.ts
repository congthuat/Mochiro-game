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
 * This is how a runner gets real visual variety for almost nothing: a zone is not new
 * geometry, it is a lighting palette — sky, fog, the sun's colour, the sky/ground
 * bounce and the exposure. Blended over a stretch of track the whole world changes
 * mood with them, and because the zones are keyed to distance a long run sees all four
 * while a short one still sees two. Taken from the same idea `Blue Run` uses for its
 * biomes and Subway Surfers for its city/neon themes.
 */
export interface Biome {
  /** Metres at which this zone is fully in charge. */
  at: number
  /** i18n key suffix: `biome.<name>`; also the zone id the scenery and traffic key off. */
  name: string
  /** City streets, open country, or the inside of the mountain tunnel. */
  kind: 'city' | 'wild' | 'tunnel'
  /** Metres over which the previous zone hands over to this one (default BIOME_BLEND). */
  blend?: number
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
  /** Something in the air. */
  weather?: 'snow' | 'leaves' | 'dust' | 'ash'
}

const GRASS = '#8adc7c'
const PAVEMENT = '#cfcabd'

/** Night to day is the biggest change of light in the lap, so the dawn takes longer. */
export const BIOME_DAWN = 280

/**
 * The run is a road trip of about ten minutes a lap: out of downtown through the
 * suburbs into farmland, over the big river, up into the mountain forest and through
 * the tunnel onto the snowfields, down across the desert at noon, past the volcano to
 * a tropical beach, over the long sea bridge into the harbour at dusk, and through
 * the neon night back to the city at dawn.
 *
 * `at` is where each zone is fully in charge; the spacing follows the speed ramp so
 * that, on Normal, a zone comes round every 40–60 s (see scripts/biome-check.ts).
 */
export const BIOMES: Biome[] = [
  // The daylight the game shipped with — a run always starts here.
  { at: 0, name: 'city', kind: 'city', blend: BIOME_DAWN, skyTop: '#2b8ae8', sky: '#7ccbfb', cloudTint: '#ffffff', stars: 0, fog: '#e0f2ff', sun: '#fff3d6', skyBounce: '#bfe6ff', groundBounce: '#9fd08a', sunIntensity: 1, hemiIntensity: 0.45, fillIntensity: 0.38, exposure: 1.04, ground: GRASS, verge: PAVEMENT, peaks: 0, dunes: 0 },
  // Leaving town: houses and gardens, a warmer afternoon light.
  { at: 740, name: 'suburb', kind: 'city', skyTop: '#3a86d8', sky: '#93cdf2', cloudTint: '#fff6ea', stars: 0, fog: '#e8f0e4', sun: '#ffe9c2', skyBounce: '#cfe6f2', groundBounce: '#a6cc82', sunIntensity: 1.02, hemiIntensity: 0.45, fillIntensity: 0.37, exposure: 1.03, ground: GRASS, verge: PAVEMENT, peaks: 0, dunes: 0 },
  // Open farmland under a big clean sky.
  { at: 1820, name: 'plains', kind: 'wild', skyTop: '#1f7fe6', sky: '#8fd3ff', cloudTint: '#ffffff', stars: 0, fog: '#dff3ff', sun: '#fff2cc', skyBounce: '#c4e8ff', groundBounce: '#a8d37a', sunIntensity: 1.04, hemiIntensity: 0.46, fillIntensity: 0.36, exposure: 1.04, ground: '#9fd46a', verge: '#c8b08a', peaks: 0.25, dunes: 0 },
  // The river valley: lakes beside the road, then the big cable-stayed bridge.
  { at: 3540, name: 'river', kind: 'wild', skyTop: '#2f84dc', sky: '#94d0f2', cloudTint: '#ffffff', stars: 0, fog: '#d9efe9', sun: '#fff1cf', skyBounce: '#c2e4f2', groundBounce: '#8fc97a', sunIntensity: 1.02, hemiIntensity: 0.46, fillIntensity: 0.37, exposure: 1.04, ground: '#86cf6c', verge: '#bfae8a', peaks: 0.45, dunes: 0 },
  // Up into the pines: cooler light, a green haze, the range ahead.
  { at: 5400, name: 'forest', kind: 'wild', skyTop: '#3a7cc2', sky: '#9fcbe0', cloudTint: '#f3f7f2', stars: 0, fog: '#c8dccd', sun: '#ffe9c4', skyBounce: '#b9d8d0', groundBounce: '#5f8f52', sunIntensity: 0.98, hemiIntensity: 0.47, fillIntensity: 0.37, exposure: 1.03, ground: '#5f9f4a', verge: '#9c8a6e', peaks: 1, dunes: 0, weather: 'leaves' },
  // Under the mountain: sodium light and a dark, warm haze. The portal is a hard cut.
  { at: 7720, name: 'tunnel', kind: 'tunnel', blend: 24, skyTop: '#1a1612', sky: '#2a2219', cloudTint: '#4a3a2a', stars: 0, fog: '#2e2318', sun: '#ffc27a', skyBounce: '#ffb766', groundBounce: '#3a2a1a', sunIntensity: 0.6, hemiIntensity: 0.6, fillIntensity: 0.36, exposure: 1.0, ground: '#4b4a46', verge: '#7b766c', peaks: 1, dunes: 0 },
  // Out into the snow: blinding white after the tunnel, a cold blue sky.
  { at: 8240, name: 'snow', kind: 'wild', blend: 24, skyTop: '#5b8fd2', sky: '#bcd6ef', cloudTint: '#ffffff', stars: 0, fog: '#e4edf6', sun: '#f4f8ff', skyBounce: '#dbe9fb', groundBounce: '#c9d6e6', sunIntensity: 1.12, hemiIntensity: 0.72, fillIntensity: 0.42, exposure: 1.08, ground: '#eef3f8', verge: '#cfd8e2', peaks: 1, dunes: 0, weather: 'snow' },
  // Down to the desert under the noon sun: a hard blue sky, a hot pale haze.
  { at: 10660, name: 'desert', kind: 'wild', skyTop: '#3d7fd6', sky: '#a9cfe9', cloudTint: '#fff8ee', stars: 0, fog: '#f0dcb4', sun: '#fff0d2', skyBounce: '#f3dcb5', groundBounce: '#d6a868', sunIntensity: 1.08, hemiIntensity: 0.5, fillIntensity: 0.34, exposure: 1.05, ground: '#ecc98e', verge: '#d6b07a', peaks: 0, dunes: 1, weather: 'dust' },
  // The volcano: black basalt, lava in the fields, ash falling from a red sky.
  { at: 12760, name: 'volcano', kind: 'wild', skyTop: '#3a1a1e', sky: '#b5503a', cloudTint: '#7a5550', stars: 0, fog: '#8a5444', sun: '#ffb27a', skyBounce: '#ff9a6a', groundBounce: '#4a2a22', sunIntensity: 0.96, hemiIntensity: 0.56, fillIntensity: 0.36, exposure: 1.0, ground: '#4a433f', verge: '#625a54', peaks: 0, dunes: 0, volcano: 1, weather: 'ash' },
  // A tropical beach: white sand, palms, the sea along the right of the road.
  { at: 15280, name: 'beach', kind: 'wild', blend: 230, skyTop: '#1b84e0', sky: '#86d6f6', cloudTint: '#ffffff', stars: 0, fog: '#d6f1f6', sun: '#fff4d8', skyBounce: '#bfeaf6', groundBounce: '#e8d3a0', sunIntensity: 1.06, hemiIntensity: 0.5, fillIntensity: 0.37, exposure: 1.05, ground: '#f1dca8', verge: '#e6cf98', peaks: 0, dunes: 0, sea: 1 },
  // The sea bridge: open water on both sides as the afternoon turns gold.
  { at: 17600, name: 'seabridge', kind: 'wild', skyTop: '#2a6fd0', sky: '#a8d4ee', cloudTint: '#fff3e0', stars: 0, fog: '#e6eef0', sun: '#ffe2b0', skyBounce: '#cfe2ee', groundBounce: '#8fb3c4', sunIntensity: 1.04, hemiIntensity: 0.48, fillIntensity: 0.36, exposure: 1.04, ground: '#e0d0a4', verge: '#c4c2bc', peaks: 0, dunes: 0, sea: 1 },
  // Back into the city by the harbour at dusk: cranes, warehouses, container yards.
  { at: 19900, name: 'port', kind: 'city', skyTop: '#25215a', sky: '#5b4b9a', cloudTint: '#c9a6e6', stars: 0.35, fog: '#9382c6', sun: '#cdaaff', skyBounce: '#9182d6', groundBounce: '#453c72', sunIntensity: 0.86, hemiIntensity: 0.4, fillIntensity: 0.31, exposure: 0.97, ground: GRASS, verge: PAVEMENT, peaks: 0, dunes: 0 },
  // Neon night: dark sky, cold key light, the emissive lift on every prop doing the
  // work of keeping the runner and the traffic readable.
  { at: 21800, name: 'neon', kind: 'city', skyTop: '#04081a', sky: '#141d40', cloudTint: '#3b4c86', stars: 1, fog: '#28376d', sun: '#8fdcff', skyBounce: '#33549f', groundBounce: '#161d38', sunIntensity: 0.74, hemiIntensity: 0.4, fillIntensity: 0.3, exposure: 0.95, ground: GRASS, verge: PAVEMENT, peaks: 0, dunes: 0 },
]

/** Emoji for each zone, for the HUD's title card and journey bar. */
export const ZONE_ICONS: Record<string, string> = {
  city: '🏙️', suburb: '🏡', plains: '🌾', river: '🌉', forest: '🌲', tunnel: '🚇', snow: '❄️',
  desert: '🏜️', volcano: '🌋', beach: '🏖️', seabridge: '🌊', port: '⚓', neon: '🌃',
}

/** Metres over which one zone hands over to the next, unless the zone sets its own. */
export const BIOME_BLEND = 150

/**
 * A long run loops the zones: after the neon night the sky eases back to day at this
 * distance and the trip starts again, so a great run keeps changing scenery.
 */
export const BIOME_LAP = 23900

/** Handover length into `zone`. */
export function blendInto(zone: Biome): number {
  return zone.blend ?? BIOME_BLEND
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
 * zone the run has *fully entered* — the last one whose `at` it has passed. Picking the
 * last zone whose handover has merely *started* would swap the base colour a whole
 * blend early, and the sky would cut in one metre rather than easing over the blend.
 */
export function biomeSpan(distance: number): BiomeSpan {
  const lap = Math.floor(distance / BIOME_LAP) * BIOME_LAP
  const d = distance - lap
  let index = 0
  for (let i = 0; i < BIOMES.length; i += 1) if (d >= BIOMES[i].at) index = i
  // After the last zone the lap closes back on the first one, at BIOME_LAP.
  const to = BIOMES[index + 1] ?? BIOMES[0]
  const toAt = BIOMES[index + 1] ? to.at : BIOME_LAP
  const end = lap + toAt
  return { from: BIOMES[index], to, start: end - blendInto(to), end }
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

/**
 * Where the mountain tunnel runs, in metres into a lap: from the portal (where the
 * road becomes the tunnel's) to the far mouth (where it becomes the snowfield's).
 */
export function tunnelSpan(): { start: number; end: number } {
  const index = BIOMES.findIndex((zone) => zone.kind === 'tunnel')
  const zone = BIOMES[index]
  const next = BIOMES[index + 1] ?? BIOMES[0]
  const nextAt = BIOMES[index + 1] ? next.at : BIOME_LAP
  return { start: zone.at - blendInto(zone) / 2, end: nextAt - blendInto(next) / 2 }
}

/** The tunnel of the lap `distance` is in, in absolute run distance. */
export function tunnelAround(distance: number): { start: number; end: number } {
  const span = tunnelSpan()
  const lap = Math.floor(distance / BIOME_LAP) * BIOME_LAP
  return { start: lap + span.start, end: lap + span.end }
}

/**
 * Water. Two kinds:
 *  - beside the road (side ±1): a lake, a river or the sea beyond `shore` metres from
 *    the centre line, painted onto the ground at ground level. Its shore curls away
 *    over WATER_TAPER at both ends, so a body of water never ends in a ruled line.
 *  - under the road (side 0): the road crosses on a bridge; the ground is cut away
 *    right across and the water lies DEEP_WATER_Y below, with a bank at each end.
 * Spans are in metres into a lap; the shader in surface.ts and the scenery placement
 * in districts.ts share the shapes below, so a boat never sits on grass.
 */
export interface WaterSpan {
  start: number
  end: number
  side: -1 | 0 | 1
  /** Beside the road: distance of the shore from the centre line (m). */
  shore: number
  /** Under the road: what carries it. */
  bridge?: 'cable' | 'viaduct'
  /** Salt water: dolphins, sailing boats. */
  sea?: boolean
  color: string
}

export const WATERS: WaterSpan[] = [
  // The river valley: a lake on the left, the river crossing, the river on the right.
  { start: 3700, end: 4330, side: -1, shore: 24, color: '#3a9ab4' },
  { start: 4420, end: 4660, side: 0, shore: 0, bridge: 'cable', color: '#2f8fb0' },
  { start: 4760, end: 5260, side: 1, shore: 24, color: '#3a9ab4' },
  // The beach: the sea on the right all along, then the bridge right across it.
  { start: 15330, end: 17520, side: 1, shore: 30, sea: true, color: '#22b0c8' },
  { start: 17640, end: 19820, side: 0, shore: 0, bridge: 'viaduct', sea: true, color: '#1f8cc2' },
]

export const WATER_TAPER = 150
/** How far the shore curls away at the very end of a span (beyond the fog on every preset). */
export const WATER_CURL = 460
/** Water level under a bridge. */
export const DEEP_WATER_Y = -5.5

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
  const first = Math.floor(from / BIOME_LAP) - 1
  const last = Math.floor(to / BIOME_LAP)
  for (let lap = first; lap <= last; lap += 1) {
    const base = lap * BIOME_LAP
    for (const span of WATERS) {
      const start = base + span.start
      const end = base + span.end
      if (end >= from && start <= to) out.push({ span, start, end })
    }
  }
  return out
}

/** What is at run distance `distance`, `x` metres across: land, side water (at ground level) or deep water under a bridge. */
export function waterAt(distance: number, x: number): 'land' | 'side' | 'deep' {
  for (const here of watersBetween(distance, distance)) {
    if (here.span.side === 0) return 'deep'
    if (sideWaterDepth(here.span, distance - here.start, x) > 0) return 'side'
  }
  return 'land'
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
