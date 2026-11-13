// Mochiro tuning: run speeds, physics, scoring, spawn cadence, quality presets.
import type { ObstacleKind, PowerKind, Quality, ResolvedQuality, Settings } from './types'
import type { GearSpec } from './gear'
import type { PersonaId } from './persona'
import type { RecolorSpec } from './recolor'
import barbarianModel from '../assets/models/barbarian.glb?url'
import knightModel from '../assets/models/knight.glb?url'
import mageModel from '../assets/models/mage.glb?url'
import rogueModel from '../assets/models/rogue.glb?url'
import rogueHoodedModel from '../assets/models/rogue_hooded.glb?url'

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
  car: { kind: 'car', width: 2.1, height: 1.02, bottom: 0, depth: 4.4, points: 55, platformTop: 1.02 },
  bus: { kind: 'bus', width: 2.35, height: 2.8, bottom: 0, depth: 7.0, points: 90 },
  // A ramp kicks you skyward — land on the car parked behind it.
  ramp: { kind: 'ramp', width: 2.05, height: 1.3, bottom: 0, depth: 2.9, points: 30, launch: 14.5 },
  // Gateway: the visible lintel is exactly this box, so ducking is never a guess.
  tunnel: { kind: 'tunnel', width: 9.4, height: 1.97, bottom: 1.25, depth: 1.4, points: 80 },
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
  { kind: 'double', harmful: false, label: 'DOUBLE ARC', hint: 'Every coin counts twice', colour: '#ffd45e', duration: 9, weight: 13 },
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
  name: string
}

export const TIERS: Tier[] = [
  { at: 0, name: 'Warm-up' },
  { at: 18, name: 'Overclock' },
  { at: 26, name: 'Surge' },
  { at: 32, name: 'Hyperdrive' },
  { at: 37, name: 'Terminal Velocity' },
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

export type CharacterId = 'kai' | 'mika' | 'bjorn' | 'nyx' | 'rin' | 'tim'

/** Roster order — also the order of the character line-up on the menu stage. */
export const CHARACTER_IDS: CharacterId[] = ['kai', 'mika', 'bjorn', 'nyx', 'rin', 'tim']

/**
 * Every hero has one signature ability, so picking a character is a gameplay
 * choice and not only a costume. The value is a multiplier for every perk except
 * `shieldStart` (a number of shields) and `badImmunity` (a plain yes/no, so the
 * value is unused).
 */
export type PerkId = 'shieldStart' | 'longPower' | 'badImmunity' | 'quickLane' | 'wideMagnet' | 'longBoost'

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
 * the stage. `accent` is the yellow of the in-game gear and is shared by five of the six,
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
    // fleece, dark trousers, white sneakers, a microphone where the staff was.
    persona: 'bobbilee',
    hideNodes: ['Spellbook', '1H_Wand', '2H_Staff', 'Mage_Hat', 'Mage_Cape'],
    model: mageModel,
    modelHeight: 1.74,
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
    // The rogue rig ships teal; the Night Blade wears violet.
    recolor: { from: [65, 190], to: 276, sat: 0.78, light: 0.82 },
    name: 'Lecter',
    tagline: 'Night Blade',
    model: rogueModel,
    // Two knives and nothing else: the rogue rig also ships a one- and a
    // two-handed crossbow, which made the assassin read as a second archer.
    hideNodes: ['Crossbow', 'Cape'],
    modelHeight: 1.74,
    modelFacing: Math.PI,
    skin: 0xd9b48f,
    hair: 0x2b2440,
    hairStyle: 'ponytail',
    outfit: 0x4b3a7a,
    outfitDark: 0x2f2450,
    shirt: 0xcfc6ee,
    bottom: 0x2f2450,
    shoe: 0x3a2f5e,
    sole: 0xb9aee0,
    accent: 0x9d7bff,
    glove: 0x241c3d,
    eye: 0xb07bff,
  },
  rin: {
    id: 'rin',
    perk: { id: 'wideMagnet', value: 1.45 },
    name: 'Mike',
    tagline: 'Marksman',
    // The hooded rig: the hood plus a ranged weapon is the classic ranger
    // silhouette, and it keeps the archer from looking like the bare-headed
    // knife-fighter.
    model: rogueHoodedModel,
    modelHeight: 1.74,
    modelFacing: Math.PI,
    // A bolt quiver on the back; the crossbow itself is the rig's own.
    gear: { quiver: true },
    // The rogue rig ships a knife *and* two crossbows. The knives go, the light
    // crossbow goes with them, and the arbalest stays: it is a real prop mounted on
    // the hand slot, so it swings with the arm instead of needing to be built and
    // re-placed every frame.
    hideNodes: ['Knife', '1H_Crossbow', 'Cape'],
    skin: 0xe8c4a0,
    hair: 0x3d2b1f,
    hairStyle: 'ponytail',
    outfit: 0x2f7d4f,
    outfitDark: 0x1f5c39,
    shirt: 0xf3f7f2,
    bottom: 0x2b3f2c,
    shoe: 0x24513a,
    sole: 0xe9f4ef,
    accent: 0xffd447,
    glove: 0x25332f,
    eye: 0x54c98a,
  },
  tim: {
    id: 'tim',
    // Overdrive is the duelist's move: the blade cuts through the traffic instead of
    // dodging it. Twice as long is a run you can feel, where a coin bonus was not.
    perk: { id: 'longBoost', value: 2 },
    name: 'Tim',
    tagline: 'Blade Duelist',
    // The knight rig a second time — the duelist is the shield knight's opposite
    // number. Gold plate instead of blue, no cloak, no shield, and the two-handed
    // blade: a swordsman you can tell apart from Sam in a single glance from behind.
    // Sharing a rig is safe because every clone repaints its own material (model.ts),
    // so neither hero's palette can leak into the other's.
    recolor: { from: [150, 260], to: 42, sat: 1.3, light: 1.0, grey: true },
    model: knightModel,
    modelHeight: 1.74,
    modelFacing: Math.PI,
    // Everything the knight ships except the greatsword and the body. `1H_Sword`
    // covers the side sword and its offhand twin, and the four shields and the cape
    // go with them, leaving a bare-headed duelist holding one big blade.
    hideNodes: [
      '1H_Sword',
      'Badge_Shield',
      'Rectangle_Shield',
      'Round_Shield',
      'Spike_Shield',
      'Knight_Cape',
      'Knight_Helmet',
    ],
    skin: 0xf2c9a0,
    hair: 0x8a5522,
    hairStyle: 'spiky',
    outfit: 0xe8b43a,
    outfitDark: 0xb8862a,
    shirt: 0xfff4d8,
    bottom: 0x4a3a22,
    shoe: 0x6b5228,
    sole: 0xf6e6c8,
    accent: 0xffd447,
    glove: 0x6b5228,
    eye: 0x4fa8e0,
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
  /** i18n key suffix: `biome.<name>`. */
  name: string
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
}

export const BIOMES: Biome[] = [
  // The daylight the game shipped with — a run always starts here.
  { at: 0, name: 'day', skyTop: '#2b8ae8', sky: '#7ccbfb', cloudTint: '#ffffff', stars: 0, fog: '#e0f2ff', sun: '#fff3d6', skyBounce: '#bfe6ff', groundBounce: '#9fd08a', sunIntensity: 1, hemiIntensity: 0.45, fillIntensity: 0.38, exposure: 1.04 },
  // Golden hour: low warm sun, long light, dust in the air.
  { at: 520, name: 'golden', skyTop: '#6a78c0', sky: '#f0a266', cloudTint: '#ffd9bd', stars: 0, fog: '#ffd7ad', sun: '#ffcb84', skyBounce: '#ffc188', groundBounce: '#a87c47', sunIntensity: 1.06, hemiIntensity: 0.43, fillIntensity: 0.34, exposure: 1.01 },
  // Dusk: the light goes violet and the shadows stop reading as warm.
  { at: 1150, name: 'dusk', skyTop: '#25215a', sky: '#5b4b9a', cloudTint: '#c9a6e6', stars: 0.35, fog: '#9382c6', sun: '#cdaaff', skyBounce: '#9182d6', groundBounce: '#453c72', sunIntensity: 0.86, hemiIntensity: 0.4, fillIntensity: 0.31, exposure: 0.97 },
  // Neon night: dark sky, cold key light, the emissive lift on every prop doing the
  // work of keeping the runner and the traffic readable.
  { at: 1900, name: 'neon', skyTop: '#04081a', sky: '#141d40', cloudTint: '#3b4c86', stars: 1, fog: '#28376d', sun: '#8fdcff', skyBounce: '#33549f', groundBounce: '#161d38', sunIntensity: 0.74, hemiIntensity: 0.4, fillIntensity: 0.3, exposure: 0.95 },
]

/** Metres over which one zone hands over to the next. */
export const BIOME_BLEND = 150

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
  // `from` is the zone the run has *fully entered* — the last one whose `at` it has
  // passed. Picking the last zone whose handover has merely *started* would swap the
  // base colour a whole blend early, and the sky would cut in one metre rather than
  // easing over 150: the check caught exactly that at 369 m.
  let index = 0
  for (let i = 0; i < BIOMES.length; i += 1) if (distance >= BIOMES[i].at) index = i
  const to = BIOMES[index + 1]
  if (!to) return { from: BIOMES[index], to: BIOMES[index], t: 0 }
  const raw = (distance - (to.at - BIOME_BLEND)) / BIOME_BLEND
  const t = Math.min(1, Math.max(0, raw))
  // Smoothstep: a handover that eases in and out reads as weather, not as a switch.
  return { from: BIOMES[index], to, t: t * t * (3 - 2 * t) }
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
