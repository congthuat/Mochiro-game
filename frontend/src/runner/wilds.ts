// The countryside between the cities: what stands beside the road once the run leaves
// town — farmland, mountain forest, snowfields and desert (the tunnel has nothing: its
// walls are the scenery).
//
// Models: Kenney "Nature Kit 2.1" (CC0, https://www.kenney.nl), packed by
// scripts/build-landscape.ts into landscape.glb as `nat.*` nodes with vertex colours;
// plus a handful of shapes built here at runtime as `gen.*` (mountains, hills, dunes,
// crop rows, hay bales, snowmen, an oasis pond) — cheap low-poly geometry the kit
// does not have.
//
// The planners are pure layout: given a placer (districts.ts) they decide what goes on
// one stretch of roadside and return how long that stretch is. The districts layer owns
// the pooling, the scrolling and the instance buffers.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { makeRng, pick, randRange } from './utils'

export type Wild =
  | 'plains'
  | 'forest'
  | 'snow'
  | 'desert'
  | 'tunnel'
  | 'river'
  | 'volcano'
  | 'beach'
  | 'seabridge'
  | 'halong'
  | 'blossom'
  | 'waterfall'
  | 'savanna'
  | 'temple'
  | 'floatmarket'
  | 'windcoast'
  | 'future'
  | 'haunted'
  | 'icecave'
  | 'icelake'
  | 'farm'
  | 'redcanyon'
  | 'oasis'
  | 'jungle'
  | 'terraces'
  | 'highway'
  | 'dawn'
export const WILDS: readonly string[] = [
  'plains',
  'forest',
  'snow',
  'desert',
  'tunnel',
  'river',
  'volcano',
  'beach',
  'seabridge',
  'halong',
  'blossom',
  'waterfall',
  'savanna',
  'temple',
  'floatmarket',
  'windcoast',
  'future',
  'haunted',
  'icecave',
  'icelake',
  'farm',
  'redcanyon',
  'oasis',
  'jungle',
  'terraces',
  'highway',
  'dawn',
]
export type Tier = 'front' | 'sky' | 'far'

/** Extra per-part options. Positions are metres, x from the road centre (signed), dz along the lot. */
export interface WildOptions {
  y?: number
  rot?: number
  scale?: number
  /** Non-uniform stretch on top of `scale` (model axes). */
  sx?: number
  sy?: number
  sz?: number
  /** Multiplied into the model's vertex colours. */
  tint?: number
  /** 0..1 snow on the up-facing faces. */
  snow?: number
  /** Bright warm faces (lava, a lighthouse lamp) glow by this much. */
  glow?: number
  /** Floats: only placed on water, and down at the river under a bridge. */
  onWater?: boolean
  /** Stands in the water (islets, sea stacks): kept on land or water, lowered under a bridge. */
  island?: boolean
  /** Straddles the waterline (reeds, jetties): kept on either side of it, never under a bridge. */
  wade?: boolean
}

export interface ModelSize {
  width: number
  depth: number
  height: number
}

/** What a planner may do with one stretch of roadside. */
export interface WildPlacer {
  rng: () => number
  /** 0.4 on low-end devices … 1 on high: share of the optional clutter that is placed. */
  density: number
  /** Places one of `keys` (whichever is loaded and has room); its size, or null. */
  put(keys: string | readonly string[], x: number, dz: number, options?: WildOptions): ModelSize | null
  /** A flat ground plot (a field) — the ground colour under it changes. */
  plot(x: number, width: number, length: number, dz: number, color: number): void
  /** Where the water begins on `side` here (m from the centre line): 0 on a bridge, null if dry. */
  water(side: -1 | 1): number | null
}

// ── model lists ──────────────────────────────────────────────────────────────────

const PINES = ['nat.tree_pineTallA', 'nat.tree_pineTallB', 'nat.tree_pineTallC', 'nat.tree_pineTallD', 'nat.tree_pineRoundC', 'nat.tree_pineRoundD', 'nat.tree_pineRoundE', 'nat.tree_pineDefaultA', 'nat.tree_pineDefaultB', 'nat.tree_pineSmallA', 'nat.tree_pineSmallB', 'nat.tree_pineGroundA']
const TALL_PINES = ['nat.tree_pineTallA', 'nat.tree_pineTallB', 'nat.tree_pineTallC', 'nat.tree_pineTallD', 'nat.tree_pineDefaultA', 'nat.tree_pineDefaultB', 'nat.tree_pineRoundE']
const DARK_TREES = ['nat.tree_tall_dark', 'nat.tree_default_dark', 'nat.tree_cone_dark']
const FALL_TREES = ['nat.tree_default_fall', 'nat.tree_fat_fall', 'nat.tree_cone_fall', 'nat.tree_oak_fall']
const FARM_TREES = ['nat.tree_default', 'nat.tree_oak', 'nat.tree_fat', 'nat.tree_simple', 'nat.tree_small', 'nat.tree_plateau', 'nat.tree_cone']
const ROCKS = ['nat.rock_tallA', 'nat.rock_tallB', 'nat.rock_tallC', 'nat.rock_tallE', 'nat.rock_tallG', 'nat.rock_largeA', 'nat.rock_largeB', 'nat.rock_largeC', 'nat.rock_largeD']
const STONES = ['nat.stone_tallA', 'nat.stone_tallB', 'nat.stone_tallC', 'nat.stone_tallE', 'nat.stone_largeA', 'nat.stone_largeB', 'nat.stone_largeC']
const SMALL_ROCKS = ['nat.rock_smallA', 'nat.rock_smallC', 'nat.rock_largeA', 'nat.rock_largeC']
const UNDERGROWTH = ['nat.plant_bush', 'nat.plant_bushLarge', 'nat.plant_bushDetailed', 'nat.grass_large', 'nat.stump_old', 'nat.stump_round', 'nat.mushroom_redGroup', 'nat.mushroom_tanGroup', 'nat.log', 'nat.rock_smallA']
const FLOWERS = ['nat.flower_redA', 'nat.flower_yellowA', 'nat.flower_purpleA']
const BUSHES = ['nat.plant_bush', 'nat.plant_bushLarge', 'nat.plant_bushDetailed']
const CACTI = ['nat.cactus_tall', 'nat.cactus_short']
const PALMS = ['nat.tree_palm', 'nat.tree_palmTall', 'nat.tree_palmBend', 'nat.tree_palmShort']
const RUINS = ['nat.statue_column', 'nat.statue_column', 'nat.statue_columnDamaged', 'nat.statue_columnDamaged', 'nat.statue_block']
const CABINS = ['sub.building-type-a', 'sub.building-type-c', 'sub.building-type-e', 'sub.building-type-f', 'sub.building-type-h', 'sub.building-type-k']
const FARMHOUSES = ['sub.building-type-b', 'sub.building-type-d', 'sub.building-type-g', 'sub.building-type-j', 'sub.building-type-n', 'sub.building-type-q']
const LILIES = ['nat.lily_large', 'nat.lily_small']
const SHORE_PLANTS = ['nat.grass_leafsLarge', 'nat.plant_flatTall', 'nat.grass_large', 'nat.plant_bushDetailed']
const TROPIC_PALMS = ['nat.tree_palmDetailedTall', 'nat.tree_palmDetailedShort', 'nat.tree_palmTall', 'nat.tree_palmBend', 'nat.tree_palm']
const RIVER_TREES = ['nat.tree_default', 'nat.tree_oak', 'nat.tree_fat', 'nat.tree_simple', 'nat.tree_default_dark', 'nat.tree_tall_dark', 'nat.tree_simple_dark']
const LAVA_ROCKS = ['nat.rock_tallF', 'nat.rock_tallJ', 'nat.rock_tallA', 'nat.rock_tallC', 'nat.rock_largeB', 'nat.rock_largeD']
const DEAD_TREES = ['gen.deadTree', 'gen.deadTree', 'nat.tree_thin_dark']
const PARASOLS = ['gen.parasolA', 'gen.parasolB', 'gen.parasolC']
const BOATS = ['gen.sailboat', 'gen.sailboat', 'gen.fishingBoat']

/** Every `nat.*` model a planner can ask for (loaded from landscape.glb). */
export const WILD_MODEL_KEYS = [
  ...new Set([...PINES, ...DARK_TREES, ...FALL_TREES, ...FARM_TREES, ...ROCKS, ...STONES, ...SMALL_ROCKS, ...UNDERGROWTH, ...FLOWERS, ...BUSHES, ...CACTI, ...PALMS, ...RUINS, ...LILIES, ...SHORE_PLANTS, ...TROPIC_PALMS, ...RIVER_TREES, ...LAVA_ROCKS, 'nat.canoe', 'nat.tree_thin_dark', 'nat.statue_head', 'nat.crop_pumpkin', 'nat.fence_simple', 'nat.fence_planks', 'nat.campfire_logs', 'nat.tent_detailedClosed', 'nat.tent_smallOpen', 'nat.tent_detailedOpen']),
]

/** Pool sizes: the kinds that line whole stretches of road get more instances. */
export function wildCapacity(key: string): number {
  if (key === 'gen.cropRow') return 170
  if (/^nat\.tree_pine/.test(key)) return 80
  if (/^nat\.(tree_|rock_|stone_|cactus)/.test(key)) return 60
  if (/^gen\.(mountain|hill|greenPeak|fuji)/.test(key)) return 14
  if (/^gen\.sakura/.test(key)) return 90
  if (/^gen\.(maple|acacia)/.test(key)) return 60
  if (/^gen\.(karst|sheep|cow|camel|jackLantern|iceCrystal|torii|giantTree|bamboo|sunflowers|hoodoo)/.test(key)) return 40
  if (/^gen\.(mesa|terrace|glassTower|twistTower|marketBoat)/.test(key)) return 36
  if (/^gen\.(balloon|stiltHouse|junk)/.test(key)) return 24
  if (/^gen\.(castle|rocket|waterfall|templeGate|pagoda|kasbah|hauntedHouse|barn|dutchMill|biodome|prang|stupa)/.test(key)) return 12
  if (key === 'gen.dune') return 44
  if (/^gen\.(parasol|lounger|reeds|buoy|surfboard|basalt|deadTree)/.test(key)) return 48
  if (/^gen\.(islet|lavaPool|lavaFlow|cinderCone|sailboat|fishingBoat)/.test(key)) return 30
  if (/^gen\.(ship|volcano|lighthouse|lifeguard|beachHut|jetty)/.test(key)) return 12
  if (/^nat\.(lily|canoe)/.test(key)) return 40
  if (/^nat\.(plant|grass|flower|fence)/.test(key)) return 70
  return 36
}

// Desert re-tints: the kit's grey rock becomes red sandstone, its columns sandstone.
const SANDSTONE = 0xffb47a
const RED_ROCK = 0xf0905a
const RUIN_STONE = 0xffd9a0

const SIDE_ROT = (side: number): number => side * (Math.PI / 2)

/** Whole-number count for `n` at this density, with the fraction rolled. */
function some(p: WildPlacer, n: number): number {
  const scaled = n * p.density
  return Math.floor(scaled) + (p.rng() < scaled - Math.floor(scaled) ? 1 : 0)
}

const spin = (p: WildPlacer): number => p.rng() * Math.PI * 2

/**
 * Lays out the next stretch of `zone` on one side of the road and returns its length
 * along the road (m). Parts are centred on the stretch: dz runs from -span/2 to span/2.
 */
export function planWild(zone: string, tier: Tier, side: -1 | 1, p: WildPlacer): number {
  if (zone === 'tunnel' || zone === 'icecave') return tier === 'far' ? 60 : 24
  if (tier === 'far') return planFar(zone, side, p)
  switch (zone) {
    case 'forest':
      return tier === 'front' ? forestFront(side, p) : forestSky(side, p)
    case 'snow':
      return tier === 'front' ? snowFront(side, p) : snowSky(side, p)
    case 'desert':
      return tier === 'front' ? desertFront(side, p) : desertSky(side, p)
    case 'river':
      return tier === 'front' ? riverFront(side, p) : riverSky(side, p)
    case 'volcano':
      return tier === 'front' ? volcanoFront(side, p) : volcanoSky(side, p)
    case 'beach':
      return tier === 'front' ? beachFront(side, p) : beachSky(side, p)
    case 'seabridge':
      return tier === 'front' ? seaFront(side, p) : seaSky(side, p)
    case 'halong':
      return tier === 'front' ? halongFront(side, p) : halongSky(side, p)
    case 'blossom':
      return tier === 'front' ? blossomFront(side, p) : blossomSky(side, p)
    case 'waterfall':
      return tier === 'front' ? waterfallFront(side, p) : waterfallSky(side, p)
    case 'savanna':
      return tier === 'front' ? savannaFront(side, p) : savannaSky(side, p)
    case 'temple':
      return tier === 'front' ? templeFront(side, p) : templeSky(side, p)
    case 'floatmarket':
      return tier === 'front' ? marketFront(side, p) : marketSky(side, p)
    case 'windcoast':
      return tier === 'front' ? windFront(side, p) : windSky(side, p)
    case 'future':
      return tier === 'front' ? futureFront(side, p) : futureSky(side, p)
    case 'haunted':
      return tier === 'front' ? hauntedFront(side, p) : hauntedSky(side, p)
    case 'icelake':
      return tier === 'front' ? icelakeFront(side, p) : icelakeSky(side, p)
    case 'farm':
      return tier === 'front' ? farmFront(side, p) : farmSky(side, p)
    case 'redcanyon':
      return tier === 'front' ? canyonFront(side, p) : canyonSky(side, p)
    case 'oasis':
      return tier === 'front' ? oasisFront(side, p) : oasisSky(side, p)
    case 'jungle':
      return tier === 'front' ? jungleFront(side, p) : jungleSky(side, p)
    case 'terraces':
      return tier === 'front' ? terracesFront(side, p) : terracesSky(side, p)
    case 'highway':
      return tier === 'front' ? highwayFront(side, p) : highwaySky(side, p)
    case 'dawn':
      return tier === 'front' ? dawnFront(side, p) : dawnSky(side, p)
    default:
      return tier === 'front' ? plainsFront(side, p) : plainsSky(side, p)
  }
}

// ── forest ───────────────────────────────────────────────────────────────────────

function forestTree(p: WildPlacer): readonly string[] {
  const roll = p.rng()
  return roll < 0.16 ? FALL_TREES : roll < 0.3 ? DARK_TREES : PINES
}

function forestFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.07) {
    // A campsite in a clearing: tent, fire ring, log seat, a pine behind.
    const span = 16
    p.put(['nat.tent_detailedOpen', 'nat.tent_smallClosed'], side * 15, -2, { rot: SIDE_ROT(side) + randRange(p.rng, -0.4, 0.4), scale: 0.85 })
    p.put('nat.campfire_stones', side * 11.5, 2.5, { rot: spin(p), scale: 0.6 })
    p.put('nat.log', side * 10.4, 4.6, { rot: Math.PI / 2 + randRange(p.rng, -0.3, 0.3), scale: 0.7 })
    p.put(TALL_PINES, side * 21, randRange(p.rng, -6, 6), { rot: spin(p), scale: randRange(p.rng, 1, 1.3) })
    return span
  }
  if (roll < 0.17) {
    // Rock outcrop: a tall crag with smaller rocks at its foot.
    const span = randRange(p.rng, 12, 16)
    p.put(ROCKS.slice(0, 5), side * randRange(p.rng, 13, 17), 0, { rot: spin(p), scale: randRange(p.rng, 1.2, 1.9) })
    p.put(SMALL_ROCKS, side * randRange(p.rng, 9.5, 11), randRange(p.rng, -4, 4), { rot: spin(p), scale: randRange(p.rng, 0.6, 1) })
    if (p.rng() < 0.7) p.put(PINES, side * randRange(p.rng, 20, 26), randRange(p.rng, -5, 5), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.2) })
    return span
  }
  const span = randRange(p.rng, 6, 10)
  // The wall of trees: one close to the road, one or two behind it.
  p.put(forestTree(p), side * randRange(p.rng, 10, 13.5), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.15) })
  const back = 1 + some(p, 1.3)
  for (let i = 0; i < back; i++) {
    p.put(forestTree(p), side * randRange(p.rng, 15, 27), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.35) })
  }
  if (p.rng() < 0.55 * p.density + 0.15) {
    p.put(UNDERGROWTH, side * randRange(p.rng, 8.6, 11), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.4, 0.75) })
  }
  return span
}

function forestSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 8, 14)
  if (p.rng() < 0.14) {
    // A cliff face standing out of the trees.
    p.put(['nat.cliff_large_rock', 'nat.cliff_block_rock', 'nat.cliff_large_stone'], side * randRange(p.rng, 34, 50), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.5, 0.5), sx: randRange(p.rng, 1.6, 2.6), sy: randRange(p.rng, 1.8, 3.2), sz: randRange(p.rng, 1.2, 2) })
  }
  const trees = 2 + some(p, 1.5)
  for (let i = 0; i < trees; i++) {
    p.put(p.rng() < 0.85 ? TALL_PINES : DARK_TREES, side * randRange(p.rng, 28, 66), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.2, 1.9) })
  }
  return span
}

// ── snowfields ───────────────────────────────────────────────────────────────────

function snowFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.1) {
    // A log cabin under snow, firewood stacked by the door.
    const span = 22
    p.put(CABINS, side * 20, 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.05, 0.05), scale: randRange(p.rng, 0.95, 1.05), snow: 1 })
    p.put(['nat.log_stack', 'nat.log_stackLarge'], side * 13, randRange(p.rng, 4, 7), { rot: spin(p), scale: 0.6, snow: 1 })
    p.put(PINES, side * 12, -8, { rot: spin(p), scale: randRange(p.rng, 0.8, 1.1), snow: 1 })
    return span
  }
  if (roll < 0.24) {
    // A snowman (or a pair) waving at the road.
    const span = randRange(p.rng, 9, 13)
    p.put('gen.snowman', side * randRange(p.rng, 9.5, 11.5), 0, { rot: FACING(side) + randRange(p.rng, -0.4, 0.4), scale: randRange(p.rng, 0.9, 1.15) })
    if (p.rng() < 0.3) p.put('gen.snowman', side * 12.5, 2.4, { rot: FACING(side) + randRange(p.rng, -0.6, 0.6), scale: 0.7 })
    p.put(PINES, side * randRange(p.rng, 16, 24), randRange(p.rng, -4, 4), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.3), snow: 1 })
    return span
  }
  const span = randRange(p.rng, 7, 12)
  const trees = 1 + some(p, 1.6)
  for (let i = 0; i < trees; i++) {
    p.put(PINES, side * randRange(p.rng, i === 0 ? 10 : 14, i === 0 ? 14 : 28), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.3), snow: 1 })
  }
  if (p.rng() < 0.4) {
    p.put(p.rng() < 0.5 ? STONES : SMALL_ROCKS, side * randRange(p.rng, 9, 13), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.5, 1), snow: 1 })
  }
  return span
}

function snowSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 9, 15)
  if (p.rng() < 0.18) {
    p.put(STONES.slice(0, 4), side * randRange(p.rng, 32, 50), 0, { rot: spin(p), scale: randRange(p.rng, 1.6, 2.8), snow: 1 })
  }
  const trees = 2 + some(p, 1.4)
  for (let i = 0; i < trees; i++) {
    p.put(TALL_PINES, side * randRange(p.rng, 28, 64), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.1, 1.8), snow: 1 })
  }
  return span
}

// ── desert ───────────────────────────────────────────────────────────────────────

function desertFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.11) {
    // Oasis: a pool ringed with palms, a nomad tent.
    const span = 26
    const r = randRange(p.rng, 5, 7)
    const cx = side * (12 + r)
    p.put('gen.pond', cx, 0, { y: 0.02, sx: r, sz: r * randRange(p.rng, 0.8, 1.15), rot: spin(p) })
    const palms = 3 + some(p, 2)
    for (let i = 0; i < palms; i++) {
      const a = (i / palms) * Math.PI * 2 + randRange(p.rng, -0.3, 0.3)
      p.put(PALMS, cx + Math.cos(a) * (r + 1.5), Math.sin(a) * (r + 1.5), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.15) })
    }
    if (p.rng() < 0.6) p.put(['nat.tent_detailedClosed', 'nat.tent_smallOpen'], cx + side * (r + 5), randRange(p.rng, -4, 4), { rot: spin(p), scale: 0.85, tint: RUIN_STONE })
    p.put(BUSHES, cx - side * (r + 0.5), randRange(p.rng, -3, 3), { rot: spin(p), scale: 0.6 })
    return span
  }
  if (roll < 0.25) {
    // Ruins of a colonnade, half buried.
    const span = randRange(p.rng, 16, 22)
    const x = side * randRange(p.rng, 12, 16)
    const n = 3 + Math.floor(p.rng() * 3)
    for (let i = 0; i < n; i++) {
      p.put(RUINS, x, -span / 2 + 3 + (i * (span - 6)) / Math.max(1, n - 1), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.1), tint: RUIN_STONE })
    }
    if (p.rng() < 0.45) p.put(['nat.statue_head', 'nat.statue_obelisk', 'nat.statue_ring'], x + side * 7, randRange(p.rng, -3, 3), { rot: -side * (Math.PI / 2) + randRange(p.rng, -0.4, 0.4), scale: randRange(p.rng, 0.9, 1.3), tint: RUIN_STONE })
    return span
  }
  if (roll < 0.33) {
    // A red-rock butte close to the road.
    const span = randRange(p.rng, 14, 20)
    p.put(['nat.cliff_block_rock', 'nat.cliff_large_rock'], side * randRange(p.rng, 20, 26), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.3, 0.3), sx: randRange(p.rng, 1.4, 2), sy: randRange(p.rng, 1.2, 2.2), sz: randRange(p.rng, 1.2, 1.8), tint: RED_ROCK })
    p.put(SMALL_ROCKS, side * randRange(p.rng, 11, 14), randRange(p.rng, -5, 5), { rot: spin(p), scale: randRange(p.rng, 0.6, 1.1), tint: SANDSTONE })
    return span
  }
  const span = randRange(p.rng, 10, 20)
  const cacti = 1 + some(p, 1)
  for (let i = 0; i < cacti; i++) {
    p.put(CACTI, side * randRange(p.rng, 9.5, 20), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.5) })
  }
  if (p.rng() < 0.45) {
    p.put(SMALL_ROCKS.concat(ROCKS.slice(5)), side * randRange(p.rng, 10, 22), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.5, 1.2), tint: SANDSTONE })
  }
  if (p.rng() < 0.4 * p.density + 0.1) {
    p.put('gen.dune', side * randRange(p.rng, 18, 26), randRange(p.rng, -span / 3, span / 3), { rot: SIDE_ROT(side) + randRange(p.rng, -0.4, 0.4), sx: randRange(p.rng, 7, 12), sy: randRange(p.rng, 1.4, 2.8), sz: randRange(p.rng, 6, 10) })
  }
  return span
}

function desertSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 14, 30)
  const roll = p.rng()
  if (roll < 0.3) {
    // Mesas: the kit's cliff block, stretched into a flat-topped butte.
    p.put(['nat.cliff_block_rock', 'nat.cliff_large_rock'], side * randRange(p.rng, 40, 60), 0, { rot: spin(p), sx: randRange(p.rng, 2.5, 4.5), sy: randRange(p.rng, 1.6, 3.4), sz: randRange(p.rng, 2.5, 4), tint: RED_ROCK })
  } else if (roll < 0.75) {
    p.put('gen.dune', side * randRange(p.rng, 36, 56), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.5, 0.5), sx: randRange(p.rng, 14, 24), sy: randRange(p.rng, 3, 7), sz: randRange(p.rng, 12, 20) })
  }
  if (p.rng() < 0.5) p.put(CACTI, side * randRange(p.rng, 28, 40), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1, 1.6) })
  if (p.rng() < 0.12) p.put(PALMS, side * randRange(p.rng, 30, 45), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1, 1.3) })
  return span
}

// ── farmland ─────────────────────────────────────────────────────────────────────

const CROPS: Array<{ tint: number; height: [number, number]; spacing: number; soil: number; hay: boolean }> = [
  // Young green rows on dark soil, ripening wheat, tall maize.
  { tint: 0x7bc24a, height: [0.5, 0.7], spacing: 1.8, soil: 0x8a6646, hay: false },
  { tint: 0xf0cf5c, height: [0.8, 1.1], spacing: 1.7, soil: 0xb08a5a, hay: true },
  { tint: 0x5fa83c, height: [1.5, 2.1], spacing: 2.1, soil: 0x7d5c40, hay: false },
  { tint: 0xa9d15a, height: [0.4, 0.55], spacing: 1.6, soil: 0x96704c, hay: false },
]

function plainsFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.48) {
    // A field: furrowed rows along the road, a fence on the roadside edge.
    const span = randRange(p.rng, 16, 28)
    const crop = pick(p.rng, CROPS)
    const inner = 9.2
    const width = randRange(p.rng, 10, 17)
    const length = span - 2
    p.plot(side * (inner + width / 2), width, length, 0, crop.soil)
    const spacing = crop.spacing / Math.max(0.55, p.density)
    const rows = Math.min(9, Math.floor((width - 1) / spacing))
    for (let i = 0; i < rows; i++) {
      p.put('gen.cropRow', side * (inner + 1 + spacing / 2 + i * spacing), 0, { sx: spacing * 0.62, sy: randRange(p.rng, crop.height[0], crop.height[1]), sz: length - 1.2, tint: crop.tint })
    }
    if (p.rng() < 0.6) {
      const pieces = Math.floor(length / 4.2)
      for (let i = 0; i < pieces; i++) {
        p.put('nat.fence_simple', side * (inner - 0.4), -length / 2 + 2.1 + i * 4.2, { rot: Math.PI / 2, scale: 0.6 })
      }
    }
    if (crop.hay && p.rng() < 0.7) {
      const bales = 1 + Math.floor(p.rng() * 3)
      for (let i = 0; i < bales; i++) {
        p.put('gen.haybale', side * (inner + width + randRange(p.rng, 1.5, 4)), randRange(p.rng, -length / 2, length / 2), { rot: randRange(p.rng, -0.4, 0.4) })
      }
    } else if (p.rng() < 0.4) {
      p.put(FARM_TREES, side * (inner + width + randRange(p.rng, 2, 5)), randRange(p.rng, -length / 3, length / 3), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.2) })
    }
    return span
  }
  if (roll < 0.64) {
    // A farmstead: house, a tree, hay, pumpkins by the fence.
    const span = randRange(p.rng, 20, 26)
    p.put(FARMHOUSES, side * randRange(p.rng, 19, 23), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.06, 0.06), scale: randRange(p.rng, 1, 1.1) })
    p.put(FARM_TREES, side * randRange(p.rng, 12, 16), span / 2 - 3, { rot: spin(p), scale: randRange(p.rng, 0.9, 1.2) })
    const pumpkins = some(p, 3)
    for (let i = 0; i < pumpkins; i++) {
      p.put('nat.crop_pumpkin', side * randRange(p.rng, 10, 13), randRange(p.rng, -span / 2, 0), { rot: spin(p), scale: randRange(p.rng, 0.35, 0.5) })
    }
    p.put('gen.haybale', side * randRange(p.rng, 26, 30), randRange(p.rng, -span / 3, span / 3), { rot: spin(p) })
    if (p.rng() < 0.5) p.put('nat.sign', side * 9.2, -span / 2 + 2, { rot: SIDE_ROT(side), scale: 0.6 })
    return span
  }
  if (roll < 0.76) {
    // A windbreak: a line of poplars.
    const span = randRange(p.rng, 18, 26)
    const n = Math.max(3, Math.floor(span / 4.2))
    const x = side * randRange(p.rng, 11, 15)
    for (let i = 0; i < n; i++) p.put(['nat.tree_simple', 'nat.tree_cone'], x, -span / 2 + 2 + i * ((span - 4) / (n - 1)), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.1) })
    return span
  }
  // Meadow: a tree or two, bushes and wild flowers.
  const span = randRange(p.rng, 10, 18)
  const trees = some(p, 1.6)
  for (let i = 0; i < trees; i++) {
    p.put(FARM_TREES, side * randRange(p.rng, 11, 24), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.25) })
  }
  if (p.rng() < 0.6) p.put(BUSHES, side * randRange(p.rng, 9, 13), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.5, 0.8) })
  const flowers = some(p, 4)
  for (let i = 0; i < flowers; i++) {
    p.put(FLOWERS, side * randRange(p.rng, 8.8, 14), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.45, 0.65) })
  }
  return span
}

function plainsSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 14, 30)
  const roll = p.rng()
  if (roll < 0.14) {
    // Wind turbines on the skyline.
    p.put('ind.windmill', side * randRange(p.rng, 50, 75), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.3, 0.3), scale: randRange(p.rng, 1.3, 1.7) })
  } else if (roll < 0.22) {
    p.put(FARMHOUSES, side * randRange(p.rng, 34, 48), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.3, 0.3), scale: 1.05 })
    p.put(FARM_TREES, side * randRange(p.rng, 40, 52), span / 3, { rot: spin(p), scale: randRange(p.rng, 1.1, 1.4) })
  } else if (roll < 0.62) {
    // A copse.
    const n = 2 + some(p, 2)
    const x = randRange(p.rng, 32, 62)
    for (let i = 0; i < n; i++) p.put(FARM_TREES, side * (x + randRange(p.rng, -5, 5)), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 1.1, 1.6) })
  } else if (roll < 0.75) {
    p.put('gen.haybale', side * randRange(p.rng, 30, 44), 0, { rot: spin(p), scale: 1.1 })
  }
  return span
}

// ── water helpers ────────────────────────────────────────────────────────────────

/** Where the water begins on `side` if it is within `within` m (0: under a bridge), else null. */
function waterWithin(p: WildPlacer, side: -1 | 1, within: number): number | null {
  const water = p.water(side)
  return water !== null && water < within ? water : null
}

/** Boats lie along the road, heading either way. */
const heading = (p: WildPlacer): number => randRange(p.rng, -0.35, 0.35) + (p.rng() < 0.5 ? 0 : Math.PI)

/** An islet out on the water, with a palm, a tree or a lighthouse on top. */
function islet(p: WildPlacer, x: number, dz: number, size: number, crown: 'palm' | 'tree' | 'lighthouse' | 'none'): void {
  const height = size * randRange(p.rng, 0.22, 0.34)
  const placed = p.put('gen.islet', x, dz, { island: true, rot: spin(p), sx: size, sy: height, sz: size * randRange(p.rng, 0.75, 1.15) })
  if (!placed) return
  const top = height * 0.86
  if (crown === 'palm') {
    const n = size > 7 ? 2 : 1
    for (let i = 0; i < n; i++) p.put(TROPIC_PALMS, x + randRange(p.rng, -size, size) * 0.2, dz + randRange(p.rng, -size, size) * 0.2, { island: true, y: top, rot: spin(p), scale: randRange(p.rng, 0.8, 1.1) })
  } else if (crown === 'tree') {
    p.put(RIVER_TREES, x, dz, { island: true, y: top, rot: spin(p), scale: randRange(p.rng, 0.9, 1.3) })
  } else if (crown === 'lighthouse') {
    p.put('gen.lighthouse', x, dz, { island: true, y: top, rot: spin(p), glow: 1.5 })
  }
}

// ── the river valley ─────────────────────────────────────────────────────────────

function riverFront(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 60)
  if (water === 0) {
    // Under the bridge: the river itself — a canoe drifting, lily pads in the slack water.
    const span = randRange(p.rng, 12, 22)
    if (p.rng() < 0.4) p.put('nat.canoe', side * randRange(p.rng, 14, 34), 0, { onWater: true, rot: heading(p), scale: randRange(p.rng, 0.55, 0.7) })
    const pads = some(p, 2)
    for (let i = 0; i < pads; i++) p.put(LILIES, side * randRange(p.rng, 12, 40), randRange(p.rng, -span / 2, span / 2), { onWater: true, y: 0.02, rot: spin(p), scale: randRange(p.rng, 1.2, 1.8) })
    return span
  }
  if (water !== null) {
    // The lakeshore: a strip of grass, reeds at the waterline, lilies and canoes on the water.
    const span = randRange(p.rng, 10, 18)
    const reeds = 1 + some(p, 1.5)
    for (let i = 0; i < reeds; i++) p.put('gen.reeds', side * (water + randRange(p.rng, -1.5, 2)), randRange(p.rng, -span / 2, span / 2), { wade: true, rot: spin(p), scale: randRange(p.rng, 0.8, 1.3) })
    const roll = p.rng()
    if (roll < 0.14) {
      // A wooden jetty with a canoe tied up.
      p.put('gen.jetty', side * (water + 5), 0, { wade: true, y: -0.75, rot: randRange(p.rng, -0.08, 0.08) })
      p.put('nat.canoe', side * (water + 8), 2.6, { onWater: true, rot: randRange(p.rng, -0.15, 0.15), scale: 0.6 })
    } else if (roll < 0.36) {
      p.put('nat.canoe', side * (water + randRange(p.rng, 6, 24)), 0, { onWater: true, rot: heading(p), scale: randRange(p.rng, 0.55, 0.7) })
    }
    const pads = some(p, 2.5)
    for (let i = 0; i < pads; i++) p.put(LILIES, side * (water + randRange(p.rng, 2.5, 14)), randRange(p.rng, -span / 2, span / 2), { onWater: true, y: 0.02, rot: spin(p), scale: randRange(p.rng, 1.1, 1.7) })
    if (water > 15 && p.rng() < 0.6) p.put(RIVER_TREES, side * randRange(p.rng, 10, water - 4), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.15) })
    if (water > 11 && p.rng() < 0.6) p.put(SHORE_PLANTS, side * randRange(p.rng, 9, water - 2), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.6, 0.9) })
    return span
  }
  // The valley floor away from the water: fields now and then, mostly riverside woods.
  if (p.rng() < 0.3) return plainsFront(side, p)
  const span = randRange(p.rng, 7, 12)
  p.put(RIVER_TREES, side * randRange(p.rng, 10, 13.5), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.15) })
  const back = some(p, 1.4)
  for (let i = 0; i < back; i++) p.put(p.rng() < 0.75 ? RIVER_TREES : PINES, side * randRange(p.rng, 15, 26), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.3) })
  if (p.rng() < 0.5 * p.density + 0.1) p.put(p.rng() < 0.5 ? SHORE_PLANTS : FLOWERS, side * randRange(p.rng, 8.8, 11.5), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.5, 0.8) })
  return span
}

function riverSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 14, 26)
  const water = waterWithin(p, side, 80)
  if (water !== null) {
    const out = Math.max(30, water + 8)
    const roll = p.rng()
    if (roll < 0.3) p.put('gen.sailboat', side * randRange(p.rng, out, out + 40), 0, { onWater: true, rot: heading(p), scale: randRange(p.rng, 0.85, 1.1) })
    else if (roll < 0.42) p.put('nat.canoe', side * randRange(p.rng, out, out + 20), 0, { onWater: true, rot: heading(p), scale: 0.65 })
    else if (roll < 0.62) islet(p, side * randRange(p.rng, out + 6, out + 46), 0, randRange(p.rng, 5, 10), p.rng() < 0.7 ? 'tree' : 'none')
    if (water > 36) {
      const trees = 1 + some(p, 1)
      for (let i = 0; i < trees; i++) p.put(RIVER_TREES, side * randRange(p.rng, 28, water - 5), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.1, 1.5) })
    }
    return span
  }
  const trees = 2 + some(p, 1.5)
  for (let i = 0; i < trees; i++) {
    p.put(p.rng() < 0.7 ? RIVER_TREES : TALL_PINES, side * randRange(p.rng, 28, 64), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.1, 1.7) })
  }
  return span
}

// ── the volcano ──────────────────────────────────────────────────────────────────

const DARK_ROCK = 0x6a605c
const BURNT = 0x7a6258

function volcanoFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.13) {
    // A lava pool, crusted at the rim, black rocks around it.
    const span = randRange(p.rng, 18, 24)
    const r = randRange(p.rng, 4, 6.5)
    const cx = side * (11 + r)
    p.put('gen.lavaPool', cx, 0, { y: 0.04, sx: r, sz: r * randRange(p.rng, 0.75, 1.2), rot: spin(p), glow: 1.4 })
    const rocks = 2 + some(p, 2)
    for (let i = 0; i < rocks; i++) {
      const a = (i / rocks) * Math.PI * 2 + randRange(p.rng, -0.4, 0.4)
      p.put(LAVA_ROCKS, cx + Math.cos(a) * (r + 1.6), Math.sin(a) * (r + 1.6), { rot: spin(p), scale: randRange(p.rng, 0.5, 1), tint: DARK_ROCK })
    }
    return span
  }
  if (roll < 0.26) {
    // A lava flow creeping down from the slopes towards the road.
    const span = randRange(p.rng, 14, 20)
    const length = randRange(p.rng, 24, 46)
    const width = randRange(p.rng, 3, 6)
    p.put('gen.lavaFlow', side * (10 + length / 2), 0, { y: 0.06, sx: length, sz: width, rot: randRange(p.rng, -0.25, 0.25), glow: 1.3 })
    const rocks = 1 + some(p, 2)
    for (let i = 0; i < rocks; i++) p.put(LAVA_ROCKS, side * randRange(p.rng, 11, 10 + length), (p.rng() < 0.5 ? -1 : 1) * (width / 2 + randRange(p.rng, 1, 3)), { rot: spin(p), scale: randRange(p.rng, 0.5, 1.1), tint: DARK_ROCK })
    return span
  }
  if (roll < 0.4) {
    // Basalt columns.
    const span = randRange(p.rng, 10, 16)
    const n = 1 + some(p, 1.5)
    for (let i = 0; i < n; i++) p.put('gen.basalt', side * randRange(p.rng, 10, 20), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.8) })
    return span
  }
  if (roll < 0.5) {
    // A vent: a little cinder cone with a glowing mouth.
    const span = randRange(p.rng, 12, 18)
    const r = randRange(p.rng, 3, 5)
    p.put('gen.cinderCone', side * randRange(p.rng, 13, 20), 0, { sx: r, sy: randRange(p.rng, 1.8, 3.2), sz: r, rot: spin(p), glow: 1.2 })
    return span
  }
  // Scorched ground: dead trees, black rocks, a patch of ash.
  const span = randRange(p.rng, 8, 14)
  if (p.rng() < 0.3) {
    const width = randRange(p.rng, 6, 14)
    p.plot(side * (9.4 + width / 2), width, span - 2, 0, 0x37302d)
  }
  const trees = some(p, 1.3)
  for (let i = 0; i < trees; i++) p.put(DEAD_TREES, side * randRange(p.rng, 9.5, 22), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.3), tint: BURNT })
  const rocks = some(p, 1.2)
  for (let i = 0; i < rocks; i++) p.put(LAVA_ROCKS, side * randRange(p.rng, 9.5, 20), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.5, 1.2), tint: DARK_ROCK })
  return span
}

function volcanoSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 14, 28)
  const roll = p.rng()
  if (roll < 0.3) {
    const r = randRange(p.rng, 9, 17)
    p.put('gen.cinderCone', side * randRange(p.rng, 34, 60), 0, { sx: r, sy: randRange(p.rng, 6, 12), sz: r * randRange(p.rng, 0.85, 1.15), rot: spin(p), glow: 1.2 })
  } else if (roll < 0.5) {
    p.put(['nat.cliff_block_rock', 'nat.cliff_large_rock'], side * randRange(p.rng, 36, 56), 0, { rot: spin(p), sx: randRange(p.rng, 1.8, 3), sy: randRange(p.rng, 1.6, 3), sz: randRange(p.rng, 1.6, 2.6), tint: 0x5a504c })
  } else if (roll < 0.64) {
    const length = randRange(p.rng, 40, 70)
    p.put('gen.lavaFlow', side * (30 + length / 2), 0, { y: 0.06, sx: length, sz: randRange(p.rng, 5, 9), rot: randRange(p.rng, -0.3, 0.3), glow: 1.3 })
  }
  const trees = some(p, 1.4)
  for (let i = 0; i < trees; i++) p.put(DEAD_TREES, side * randRange(p.rng, 28, 50), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1, 1.5), tint: BURNT })
  return span
}

// ── the beach ────────────────────────────────────────────────────────────────────

const SURF_COLOURS = [0xff6b5a, 0x46c1e8, 0xffd23f, 0x7bdc6a, 0xff8fd0, 0xffffff]

function beachFront(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 70)
  if (water === 0) return seaFront(side, p)
  if (water !== null) {
    // The sand: parasols and loungers, a lifeguard, swimmers' buoys out on the water.
    const sand = water - 2
    const roll = p.rng()
    if (roll < 0.08 && sand > 16) {
      const span = 14
      p.put('gen.lifeguard', side * randRange(p.rng, 12, sand - 2), 0, { rot: SIDE_ROT(-side) })
      p.put('gen.buoy', side * (water + randRange(p.rng, 8, 14)), randRange(p.rng, -5, 5), { onWater: true, rot: spin(p) })
      return span
    }
    if (roll < 0.17) {
      // A beach bar: thatched hut under palms, parasols in front.
      const span = 18
      p.put('gen.beachHut', side * 13, 0, { rot: SIDE_ROT(side) })
      p.put(TROPIC_PALMS, side * randRange(p.rng, 11, 14), span / 2 - 2, { rot: spin(p), scale: randRange(p.rng, 0.85, 1.05) })
      if (sand > 22) p.put(PARASOLS, side * randRange(p.rng, 19, sand - 1), randRange(p.rng, -5, 5), { rot: spin(p) })
      return span
    }
    if (roll < 0.62 && sand > 12) {
      // Parasols, each with a lounger or two.
      const span = randRange(p.rng, 8, 13)
      const n = 1 + some(p, 1)
      for (let i = 0; i < n; i++) {
        const x = side * randRange(p.rng, 11, Math.max(11.5, sand - 2))
        const dz = randRange(p.rng, -span / 2 + 2, span / 2 - 2)
        p.put(PARASOLS, x, dz, { rot: spin(p), scale: randRange(p.rng, 0.95, 1.1) })
        const loungers = p.rng() < 0.6 ? 2 : 1
        for (let k = 0; k < loungers; k++) p.put('gen.lounger', x + side * 0.6, dz + (k === 0 ? -0.9 : 0.9), { rot: SIDE_ROT(side) + randRange(p.rng, -0.12, 0.12), tint: p.rng() < 0.5 ? 0xffffff : 0xffd0c0 })
      }
      if (p.rng() < 0.3) p.put('gen.surfboard', side * randRange(p.rng, 9.5, 12), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), tint: pick(p.rng, SURF_COLOURS) })
      if (p.rng() < 0.3) p.put('gen.buoy', side * (water + randRange(p.rng, 9, 16)), randRange(p.rng, -span / 2, span / 2), { onWater: true, rot: spin(p) })
      return span
    }
    // Palms leaning over the sand, a boat pulled up offshore.
    const span = randRange(p.rng, 8, 14)
    const palms = 1 + some(p, 0.8)
    for (let i = 0; i < palms; i++) p.put(TROPIC_PALMS, side * randRange(p.rng, 10, Math.max(10.5, Math.min(sand, 20))), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.1) })
    if (p.rng() < 0.35) p.put('gen.surfboard', side * randRange(p.rng, 9.5, 13), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), tint: pick(p.rng, SURF_COLOURS) })
    if (p.rng() < 0.25) p.put(BOATS, side * (water + randRange(p.rng, 8, 28)), 0, { onWater: true, rot: heading(p), scale: randRange(p.rng, 0.8, 1) })
    return span
  }
  // Inland: palm groves, bungalows, tropical shrubs.
  if (p.rng() < 0.14) {
    const span = 18
    p.put('gen.beachHut', side * randRange(p.rng, 15, 20), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.1, 0.1) })
    p.put(TROPIC_PALMS, side * randRange(p.rng, 11, 13), randRange(p.rng, -6, 6), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.1) })
    return span
  }
  const span = randRange(p.rng, 8, 14)
  const palms = 1 + some(p, 1.2)
  for (let i = 0; i < palms; i++) p.put(TROPIC_PALMS, side * randRange(p.rng, 10, 26), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.15) })
  const shrubs = some(p, 1.5)
  for (let i = 0; i < shrubs; i++) p.put(SHORE_PLANTS, side * randRange(p.rng, 9, 14), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.6, 0.95) })
  return span
}

function beachSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 14, 26)
  const water = waterWithin(p, side, 90)
  if (water !== null) return seaSky(side, p)
  const trees = 2 + some(p, 1.5)
  for (let i = 0; i < trees; i++) p.put(TROPIC_PALMS, side * randRange(p.rng, 28, 60), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.1, 1.5) })
  if (p.rng() < 0.15) p.put('gen.beachHut', side * randRange(p.rng, 30, 40), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.3, 0.3), scale: 1.1 })
  return span
}

// ── the sea bridge ───────────────────────────────────────────────────────────────

function seaFront(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 70)
  if (water === null) {
    // The causeway's ends: palms and rocks on the last of the land.
    const span = randRange(p.rng, 8, 14)
    p.put(TROPIC_PALMS, side * randRange(p.rng, 10, 18), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.1) })
    if (p.rng() < 0.5) p.put(LAVA_ROCKS, side * randRange(p.rng, 9.5, 14), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.5, 1), tint: 0xc9b79a })
    return span
  }
  const span = randRange(p.rng, 14, 26)
  const out = Math.max(13, water + 3)
  const roll = p.rng()
  if (roll < 0.24) {
    p.put('gen.buoy', side * randRange(p.rng, out, out + 10), 0, { onWater: true, rot: spin(p) })
  } else if (roll < 0.48) {
    p.put(BOATS, side * randRange(p.rng, out + 4, out + 30), 0, { onWater: true, rot: heading(p), scale: randRange(p.rng, 0.85, 1.05) })
  } else if (roll < 0.66) {
    // A sea stack, sometimes with a smaller one beside it.
    const x = side * randRange(p.rng, out + 4, out + 28)
    p.put(LAVA_ROCKS.slice(0, 4), x, 0, { island: true, rot: spin(p), scale: randRange(p.rng, 1.8, 2.8), tint: 0xc9b79a })
    if (p.rng() < 0.5) p.put(LAVA_ROCKS, x + side * randRange(p.rng, 4, 7), randRange(p.rng, -4, 4), { island: true, rot: spin(p), scale: randRange(p.rng, 1.2, 1.7), tint: 0xc9b79a })
  } else if (roll < 0.8) {
    islet(p, side * randRange(p.rng, out + 8, out + 30), 0, randRange(p.rng, 5, 8), 'palm')
  }
  return span
}

function seaSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 18, 34)
  const water = waterWithin(p, side, 90)
  if (water === null) return beachSky(side, p)
  const out = Math.max(30, water + 10)
  const roll = p.rng()
  if (roll < 0.16) {
    p.put('gen.ship', side * randRange(p.rng, out + 24, out + 60), 0, { onWater: true, rot: heading(p) * 0.4 + (p.rng() < 0.5 ? 0 : Math.PI) })
  } else if (roll < 0.4) {
    p.put('gen.sailboat', side * randRange(p.rng, out, out + 45), 0, { onWater: true, rot: heading(p), scale: randRange(p.rng, 0.9, 1.25) })
  } else if (roll < 0.52) {
    p.put('gen.fishingBoat', side * randRange(p.rng, out, out + 35), 0, { onWater: true, rot: heading(p) })
  } else if (roll < 0.68) {
    islet(p, side * randRange(p.rng, out + 10, out + 50), 0, randRange(p.rng, 8, 16), p.rng() < 0.25 ? 'lighthouse' : 'palm')
  } else if (roll < 0.78) {
    p.put(['nat.cliff_block_rock', 'nat.cliff_large_rock'], side * randRange(p.rng, out + 10, out + 50), 0, { island: true, rot: spin(p), sx: randRange(p.rng, 1.2, 2), sy: randRange(p.rng, 1.4, 2.4), sz: randRange(p.rng, 1.2, 2), tint: 0xc9b79a })
  }
  return span
}

// ── the new lands: shared bits ───────────────────────────────────────────────────

/** Turned towards the road and the oncoming runner (models face -z). */
const FACING = (side: number): number => side * Math.PI * 0.75
/** Turned to face the runner coming down the road. */
const TO_RUNNER = Math.PI
/** The nature kit faces +z, the camera, so it needs no turn to look at the runner. */
const KIT_TO_RUNNER = 0

const KARSTS = ['gen.karstA', 'gen.karstB', 'gen.karstC']
const SAKURA = ['gen.sakura', 'gen.sakura', 'gen.sakuraWhite']
const ACACIAS = ['gen.acaciaA', 'gen.acaciaB']
const STILT_HOUSES = ['gen.stiltHouse', 'gen.stiltHouseB']
const MARKET_BOATS = ['gen.marketBoat', 'gen.marketBoatB']
const GLASS_TOWERS = ['gen.glassTower', 'gen.twistTower']
const GRAVES = ['gen.graves', 'gen.gravesB']
const BALLOONS = ['gen.balloonA', 'gen.balloonB', 'gen.balloonC']
const GREEN_PEAKS = ['gen.greenPeakA', 'gen.greenPeakB']
const JUNGLE_PLANTS = ['nat.grass_leafsLarge', 'nat.plant_flatTall', 'nat.plant_bushLarge', 'nat.plant_bushDetailed']
const JUNGLE_TREES = ['nat.tree_tall_dark', 'nat.tree_default_dark', 'nat.tree_simple_dark', 'nat.tree_palmDetailedTall', 'nat.tree_fat', 'nat.tree_oak']
const SKYSCRAPERS = ['com.building-skyscraper-a', 'com.building-skyscraper-b', 'com.building-skyscraper-c', 'com.building-skyscraper-d', 'com.building-skyscraper-e']
const LOW_TOWNS = ['com.building-a', 'com.building-c', 'com.building-e', 'com.building-g', 'com.building-i', 'com.building-k', 'com.building-m']
const SKYLINE = ['com.low-detail-building-a', 'com.low-detail-building-c', 'com.low-detail-building-e', 'com.low-detail-building-h', 'com.low-detail-building-k', 'com.low-detail-building-wide-a']
const TULIPS = [0xe8303a, 0xf8d030, 0xf27ab0, 0x9a50c8, 0xfff4ec, 0xf06a24]

const MOSS = 0xa8b894
const LIMESTONE = 0xd6dccf
const ICE_ROCK = 0xdfeaf2
const DUSK_GOLD = 0xf2d07a

/** Lights the windows of a city-kit model after dark: palette 0 warm … 3 magenta. */
const windows = (p: WildPlacer, palette: number): number => palette + randRange(p.rng, 0.5, 0.95)

// ── Ha Long bay ──────────────────────────────────────────────────────────────────

function karstAt(p: WildPlacer, x: number, dz: number, r: number, tall: [number, number]): void {
  p.put(KARSTS, x, dz, { island: true, rot: spin(p), sx: r, sy: r * randRange(p.rng, tall[0], tall[1]), sz: r * randRange(p.rng, 0.75, 1.2) })
}

function halongFront(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 70)
  if (water !== null) {
    const span = randRange(p.rng, 14, 26)
    const out = Math.max(12, water + 4)
    const roll = p.rng()
    if (roll < 0.36) {
      // A karst rising sheer out of the bay, often a smaller one at its foot.
      const x = side * randRange(p.rng, out + 5, out + 26)
      const r = randRange(p.rng, 3.5, 7)
      karstAt(p, x, 0, r, [2.2, 3.6])
      if (p.rng() < 0.5) {
        const r2 = r * randRange(p.rng, 0.4, 0.6)
        karstAt(p, x + side * randRange(p.rng, -2, 6), (p.rng() < 0.5 ? -1 : 1) * (r + r2 + 1), r2, [1.8, 3])
      }
    } else if (roll < 0.6) {
      p.put('gen.junk', side * randRange(p.rng, out + 3, out + 24), 0, { onWater: true, rot: heading(p), scale: randRange(p.rng, 0.85, 1.1) })
    } else if (roll < 0.7) {
      // A floating fishing village: a house on its raft, a canoe tied alongside.
      const x = side * randRange(p.rng, out + 4, out + 14)
      p.put(STILT_HOUSES, x, 0, { onWater: true, y: -1.6, rot: FACING(side) + randRange(p.rng, -0.3, 0.3) })
      p.put('nat.canoe', x - side * 3.5, randRange(p.rng, 2, 4), { onWater: true, rot: heading(p), scale: 0.6 })
    } else if (roll < 0.8) {
      p.put(['gen.fishingBoat', 'nat.canoe'], side * randRange(p.rng, out, out + 20), 0, { onWater: true, rot: heading(p), scale: randRange(p.rng, 0.6, 0.9) })
    }
    if (water > 12 && p.rng() < 0.55) p.put(TROPIC_PALMS, side * randRange(p.rng, 10, water - 3), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.1) })
    if (water > 0 && p.rng() < 0.4) p.put(SMALL_ROCKS, side * (water + randRange(p.rng, -1, 1.5)), randRange(p.rng, -span / 2, span / 2), { wade: true, rot: spin(p), scale: randRange(p.rng, 0.6, 1.1), tint: LIMESTONE })
    return span
  }
  // The land between the bays: tropical woods and limestone outcrops.
  const span = randRange(p.rng, 8, 14)
  if (p.rng() < 0.22) {
    karstAt(p, side * randRange(p.rng, 18, 26), 0, randRange(p.rng, 3, 5), [1.8, 2.8])
    return span + 4
  }
  p.put(p.rng() < 0.5 ? TROPIC_PALMS : RIVER_TREES, side * randRange(p.rng, 10, 14), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.15) })
  const back = some(p, 1.3)
  for (let i = 0; i < back; i++) p.put(RIVER_TREES, side * randRange(p.rng, 15, 26), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.3) })
  if (p.rng() < 0.5) p.put(SHORE_PLANTS, side * randRange(p.rng, 9, 12), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.6, 0.9) })
  return span
}

function halongSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 16, 30)
  const water = waterWithin(p, side, 90)
  const out = water === null ? 34 : Math.max(30, water + 10)
  const roll = p.rng()
  if (roll < 0.55) karstAt(p, side * randRange(p.rng, out + 4, out + 40), 0, randRange(p.rng, 6, 12), [2, 3.4])
  else if (roll < 0.75 && water !== null) p.put('gen.junk', side * randRange(p.rng, out, out + 40), 0, { onWater: true, rot: heading(p), scale: randRange(p.rng, 1, 1.3) })
  if (water === null && p.rng() < 0.6) p.put(RIVER_TREES, side * randRange(p.rng, 28, 40), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.1, 1.5) })
  return span
}

// ── cherry blossom ───────────────────────────────────────────────────────────────

function blossomFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.1) {
    // A path of vermilion gates, stone lanterns at its mouth.
    const span = 16
    const n = 3 + Math.floor(p.rng() * 2)
    const x = side * randRange(p.rng, 12, 14)
    for (let i = 0; i < n; i++) p.put('gen.torii', x, -span / 2 + 3 + i * 3.2, { scale: 0.92 })
    p.put('gen.toro', x - side * 3.6, span / 2 - 1.5, { rot: TO_RUNNER, scale: 0.9 })
    p.put(SAKURA, side * randRange(p.rng, 19, 23), randRange(p.rng, -4, 4), { rot: spin(p), scale: randRange(p.rng, 1, 1.2) })
    return span
  }
  if (roll < 0.2) {
    // A koi pond under the trees, a lantern on its bank.
    const span = 20
    const r = randRange(p.rng, 4, 5.5)
    const cx = side * (11 + r)
    p.put('gen.pond', cx, 0, { y: 0.02, sx: r, sz: r * randRange(p.rng, 0.8, 1.1), rot: spin(p) })
    p.put('gen.toro', cx - side * (r + 0.4), r * 0.6, { rot: TO_RUNNER, scale: 0.85 })
    p.put(SAKURA, cx + side * (r + 2.5), randRange(p.rng, -3, 3), { rot: spin(p), scale: randRange(p.rng, 1, 1.25) })
    p.put(['nat.rock_smallA', 'nat.rock_smallC'], cx + side * 0.5, -r - 0.6, { rot: spin(p), scale: 0.7 })
    return span
  }
  if (roll < 0.26) {
    const span = 14
    p.put('gen.toro', side * randRange(p.rng, 9.6, 10.5), 0, { rot: TO_RUNNER, scale: 0.85 })
    p.put('gen.maple', side * randRange(p.rng, 13, 17), randRange(p.rng, -3, 3), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.15) })
    return span
  }
  // The avenue: blossom trees along the road, a carpet of fallen petals now and then.
  const span = randRange(p.rng, 6, 10)
  p.put(SAKURA, side * randRange(p.rng, 10.5, 13), randRange(p.rng, -span / 4, span / 4), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.15) })
  if (p.rng() < 0.55) p.put(p.rng() < 0.2 ? 'gen.maple' : SAKURA, side * randRange(p.rng, 16, 26), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1, 1.3) })
  if (p.rng() < 0.18) p.plot(side * 13.5, 8, span, 0, 0xf2c6d6)
  if (p.rng() < 0.3 * p.density) p.put(FLOWERS, side * randRange(p.rng, 9, 11), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: 0.5 })
  return span
}

function blossomSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 12, 24)
  if (p.rng() < 0.14) p.put('gen.pagoda', side * randRange(p.rng, 34, 50), 0, { rot: TO_RUNNER + randRange(p.rng, -0.4, 0.4), scale: randRange(p.rng, 1, 1.3) })
  const trees = 2 + some(p, 1.4)
  for (let i = 0; i < trees; i++) p.put(p.rng() < 0.18 ? 'gen.maple' : SAKURA, side * randRange(p.rng, 28, 56), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.2, 1.7) })
  return span
}

// ── the waterfalls ───────────────────────────────────────────────────────────────

function waterfallFront(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 70)
  if (water !== null && water > 0) {
    const span = randRange(p.rng, 12, 20)
    if (p.rng() < 0.2) {
      // A fall dropping straight into the pool, close by.
      p.put('gen.waterfall', side * (water + randRange(p.rng, 12, 20)), 0, { island: true, rot: FACING(side), scale: randRange(p.rng, 0.8, 1.05) })
    }
    const reeds = some(p, 1.2)
    for (let i = 0; i < reeds; i++) p.put(p.rng() < 0.5 ? 'gen.reeds' : SMALL_ROCKS, side * (water + randRange(p.rng, -1.5, 1.5)), randRange(p.rng, -span / 2, span / 2), { wade: true, rot: spin(p), scale: randRange(p.rng, 0.7, 1.1), tint: MOSS })
    if (p.rng() < 0.4) p.put(LILIES, side * (water + randRange(p.rng, 3, 10)), randRange(p.rng, -span / 2, span / 2), { onWater: true, y: 0.02, rot: spin(p), scale: 1.4 })
    if (water > 13) p.put(RIVER_TREES, side * randRange(p.rng, 10.5, water - 3), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.2) })
    if (water > 11 && p.rng() < 0.7) p.put(JUNGLE_PLANTS, side * randRange(p.rng, 9, water - 2), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.3) })
    return span
  }
  if (p.rng() < 0.12) {
    // A cliff with a thinner fall, a pool at its foot.
    const span = 22
    const x = side * randRange(p.rng, 22, 28)
    p.put('gen.waterfall', x, 0, { rot: FACING(side), scale: randRange(p.rng, 0.55, 0.7) })
    p.put('gen.pond', x - side * 4, -3, { y: 0.02, sx: 4.5, sz: 3.5, rot: spin(p) })
    return span
  }
  const span = randRange(p.rng, 7, 12)
  p.put(p.rng() < 0.6 ? RIVER_TREES : TALL_PINES, side * randRange(p.rng, 10, 13.5), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.2) })
  const back = 1 + some(p, 1)
  for (let i = 0; i < back; i++) p.put(p.rng() < 0.5 ? TALL_PINES : RIVER_TREES, side * randRange(p.rng, 15, 27), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.35) })
  if (p.rng() < 0.6) p.put(p.rng() < 0.6 ? JUNGLE_PLANTS : ['nat.log', 'nat.stump_old', 'nat.rock_smallA'], side * randRange(p.rng, 8.8, 11.5), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.6, 1), tint: MOSS })
  return span
}

function waterfallSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 16, 28)
  const water = waterWithin(p, side, 90)
  const roll = p.rng()
  if (roll < 0.2) {
    const x = water !== null ? side * randRange(p.rng, Math.max(32, water + 14), Math.max(44, water + 40)) : side * randRange(p.rng, 36, 56)
    p.put('gen.waterfall', x, 0, { island: true, rot: side * Math.PI * 0.8, scale: randRange(p.rng, 1.1, 1.6) })
  } else if (roll < 0.42) {
    p.put(['nat.cliff_large_rock', 'nat.cliff_block_rock'], side * randRange(p.rng, 36, 56), 0, { island: true, rot: SIDE_ROT(side) + randRange(p.rng, -0.5, 0.5), sx: randRange(p.rng, 1.6, 2.6), sy: randRange(p.rng, 2, 3.4), sz: randRange(p.rng, 1.4, 2), tint: MOSS })
  }
  if (water === null || water > 40) {
    const trees = 1 + some(p, 1.5)
    for (let i = 0; i < trees; i++) p.put(TALL_PINES, side * randRange(p.rng, 28, water === null ? 60 : water - 4), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.2, 1.8) })
  }
  return span
}

// ── the savanna ──────────────────────────────────────────────────────────────────

function savannaFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.1) {
    // Giraffes browsing an acacia.
    const span = 20
    const x = side * randRange(p.rng, 15, 20)
    p.put(ACACIAS, x + side * 3, 0, { rot: spin(p), scale: randRange(p.rng, 1, 1.25) })
    p.put('gen.giraffe', x - side * 1.5, randRange(p.rng, -4, -2), { rot: randRange(p.rng, -0.8, 0.8) + (p.rng() < 0.5 ? Math.PI : 0) })
    if (p.rng() < 0.6) p.put('gen.giraffe', x + side * 1, randRange(p.rng, 2, 5), { rot: spin(p), scale: 0.78 })
    return span
  }
  if (roll < 0.18) {
    // An elephant family on the move.
    const span = 22
    const x = side * randRange(p.rng, 17, 24)
    const rot = (p.rng() < 0.5 ? 0 : Math.PI) + randRange(p.rng, -0.3, 0.3)
    p.put('gen.elephant', x, 0, { rot, scale: randRange(p.rng, 1, 1.15) })
    p.put('gen.elephant', x + side * randRange(p.rng, -1, 2), 5, { rot: rot + randRange(p.rng, -0.2, 0.2), scale: 0.6 })
    if (p.rng() < 0.5) p.put('gen.elephant', x + side * 3, -5.5, { rot: rot + randRange(p.rng, -0.2, 0.2), scale: 0.95 })
    return span
  }
  if (roll < 0.26) {
    const span = 18
    p.put('gen.baobab', side * randRange(p.rng, 15, 22), 0, { rot: spin(p), scale: randRange(p.rng, 0.9, 1.2) })
    return span
  }
  // Open grassland: an acacia now and then, tussocks of gold grass, a termite rock.
  const span = randRange(p.rng, 10, 18)
  if (p.rng() < 0.55) p.put(ACACIAS, side * randRange(p.rng, 12, 26), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.15) })
  const tufts = 1 + some(p, 2)
  for (let i = 0; i < tufts; i++) p.put(['nat.grass_large', 'nat.plant_bush'], side * randRange(p.rng, 9, 20), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.6, 1), tint: DUSK_GOLD })
  if (p.rng() < 0.25) p.put(SMALL_ROCKS, side * randRange(p.rng, 10, 20), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.6, 1.2), tint: SANDSTONE })
  return span
}

function savannaSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 14, 28)
  const roll = p.rng()
  if (roll < 0.14) p.put('gen.giraffe', side * randRange(p.rng, 32, 50), 0, { rot: spin(p), scale: randRange(p.rng, 1, 1.2) })
  else if (roll < 0.24) p.put('gen.elephant', side * randRange(p.rng, 34, 54), 0, { rot: spin(p), scale: randRange(p.rng, 1.1, 1.3) })
  else if (roll < 0.32) p.put('gen.baobab', side * randRange(p.rng, 34, 54), 0, { rot: spin(p), scale: randRange(p.rng, 1.2, 1.5) })
  const trees = 1 + some(p, 1)
  for (let i = 0; i < trees; i++) p.put(ACACIAS, side * randRange(p.rng, 30, 64), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.2, 1.7) })
  return span
}

// ── the lost temple ──────────────────────────────────────────────────────────────

function templeFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.1) {
    // A gate tower facing the road, guardian heads either side.
    const span = 20
    const x = side * randRange(p.rng, 15, 18)
    p.put('gen.templeGate', x, 0, { rot: TO_RUNNER + side * 0.35, scale: randRange(p.rng, 0.95, 1.1) })
    for (const dz of [-5, 5]) p.put('nat.statue_head', x - side * 3.5, dz, { rot: KIT_TO_RUNNER - side * 0.35 + randRange(p.rng, -0.3, 0.3), scale: randRange(p.rng, 0.9, 1.2), tint: MOSS })
    return span
  }
  if (roll < 0.2) {
    const span = 22
    p.put('gen.prang', side * randRange(p.rng, 19, 24), 0, { rot: FACING(side), scale: randRange(p.rng, 0.9, 1.15) })
    p.put(['nat.statue_block', 'nat.statue_columnDamaged'], side * randRange(p.rng, 11, 13), randRange(p.rng, -6, 6), { rot: spin(p), scale: 0.9, tint: MOSS })
    return span
  }
  if (roll < 0.3) {
    // Fallen colonnade, swallowed by the forest.
    const span = randRange(p.rng, 14, 20)
    const x = side * randRange(p.rng, 11, 14)
    const n = 2 + Math.floor(p.rng() * 3)
    for (let i = 0; i < n; i++) p.put(RUINS, x, -span / 2 + 3 + (i * (span - 6)) / Math.max(1, n - 1), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.1), tint: MOSS })
    if (p.rng() < 0.6) p.put('nat.statue_head', x + side * 5, randRange(p.rng, -3, 3), { rot: KIT_TO_RUNNER - side * 0.35 + randRange(p.rng, -0.5, 0.5), scale: randRange(p.rng, 1, 1.4), tint: MOSS })
    return span
  }
  if (roll < 0.36) {
    const span = 16
    p.put('gen.stupa', side * randRange(p.rng, 14, 18), 0, { rot: spin(p), scale: randRange(p.rng, 0.8, 1) })
    return span
  }
  const span = randRange(p.rng, 7, 12)
  p.put(JUNGLE_TREES, side * randRange(p.rng, 10.5, 14), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.25) })
  if (p.rng() < 0.7) p.put(JUNGLE_TREES, side * randRange(p.rng, 16, 26), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1, 1.4) })
  if (p.rng() < 0.6) p.put(JUNGLE_PLANTS, side * randRange(p.rng, 8.8, 11), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.3) })
  return span
}

function templeSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 14, 26)
  const roll = p.rng()
  if (roll < 0.26) p.put('gen.prang', side * randRange(p.rng, 32, 52), 0, { rot: spin(p), scale: randRange(p.rng, 1.3, 2) })
  else if (roll < 0.36) p.put('gen.stupa', side * randRange(p.rng, 32, 50), 0, { rot: spin(p), scale: randRange(p.rng, 1.2, 1.6) })
  const trees = 1 + some(p, 1.5)
  for (let i = 0; i < trees; i++) p.put(JUNGLE_TREES, side * randRange(p.rng, 28, 60), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.3, 1.8) })
  return span
}

// ── the floating market ──────────────────────────────────────────────────────────

function marketFront(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 60)
  if (water !== null && water > 0) {
    const span = randRange(p.rng, 9, 16)
    const roll = p.rng()
    if (roll < 0.42) {
      const boats = 1 + some(p, 0.9)
      for (let i = 0; i < boats; i++) p.put(MARKET_BOATS, side * (water + randRange(p.rng, 3.5, 16)), randRange(p.rng, -span / 3, span / 3), { onWater: true, rot: heading(p), scale: randRange(p.rng, 0.95, 1.1) })
    } else if (roll < 0.66) {
      // A house on stilts over the water, its veranda to the road.
      p.put(STILT_HOUSES, side * (water + 2.8), 0, { wade: true, y: -0.7, rot: SIDE_ROT(side) + randRange(p.rng, -0.08, 0.08) })
    } else if (roll < 0.76) {
      p.put('nat.canoe', side * (water + randRange(p.rng, 4, 12)), 0, { onWater: true, rot: heading(p), scale: 0.65 })
    }
    if (water > 11 && p.rng() < 0.75) p.put(p.rng() < 0.7 ? TROPIC_PALMS : JUNGLE_PLANTS, side * randRange(p.rng, 10, water - 1.5), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.1) })
    if (p.rng() < 0.3) p.put(LILIES, side * (water + randRange(p.rng, 2, 6)), randRange(p.rng, -span / 2, span / 2), { onWater: true, y: 0.02, rot: spin(p), scale: 1.3 })
    return span
  }
  return riverFront(side, p)
}

function marketSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 14, 26)
  const water = waterWithin(p, side, 90)
  if (water === null) return riverSky(side, p)
  const out = Math.max(30, water + 10)
  const roll = p.rng()
  if (roll < 0.34) p.put(STILT_HOUSES, side * randRange(p.rng, out, out + 22), 0, { island: true, y: -0.7, rot: FACING(side) + randRange(p.rng, -0.4, 0.4), scale: randRange(p.rng, 1, 1.2) })
  else if (roll < 0.58) p.put(MARKET_BOATS, side * randRange(p.rng, out - 6, out + 20), 0, { onWater: true, rot: heading(p), scale: 1.1 })
  else if (roll < 0.78) islet(p, side * randRange(p.rng, out + 8, out + 40), 0, randRange(p.rng, 6, 10), 'palm')
  return span
}

// ── the windy coast ──────────────────────────────────────────────────────────────

function windFront(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 70)
  const roll = p.rng()
  if (roll < 0.16) {
    // A flock of sheep on the clifftop grass.
    const span = 16
    const n = 2 + some(p, 3)
    const x = side * randRange(p.rng, 12, water !== null ? Math.max(13, water - 6) : 22)
    for (let i = 0; i < n; i++) p.put('gen.sheep', x + randRange(p.rng, -3, 3), randRange(p.rng, -6, 6), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.1) })
    return span
  }
  if (roll < 0.28 && water === null) {
    // A wind turbine close by, towering.
    const span = 24
    p.put('ind.windmill', side * randRange(p.rng, 18, 24), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.3, 0.3), scale: randRange(p.rng, 1, 1.25) })
    return span
  }
  if (roll < 0.36) {
    const span = 22
    p.put(CABINS, side * randRange(p.rng, 18, 22), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.1, 0.1) })
    p.put('nat.fence_planks', side * 11, -4, { rot: Math.PI / 2, scale: 0.7 })
    p.put('nat.fence_planks', side * 11, 0, { rot: Math.PI / 2, scale: 0.7 })
    return span
  }
  // Short wind-bent grass and flowers to the cliff edge; rocks where the sea breaks.
  const span = randRange(p.rng, 8, 14)
  if (water !== null && water > 0) {
    p.put(LAVA_ROCKS, side * (water + randRange(p.rng, -1, 2)), randRange(p.rng, -span / 2, span / 2), { wade: true, rot: spin(p), scale: randRange(p.rng, 0.7, 1.4), tint: 0xc9c1ae })
    if (p.rng() < 0.3) p.put(LAVA_ROCKS.slice(0, 4), side * (water + randRange(p.rng, 8, 20)), 0, { island: true, rot: spin(p), scale: randRange(p.rng, 1.6, 2.6), tint: 0xc9c1ae })
  } else if (p.rng() < 0.4) {
    p.put(['nat.tree_plateau', 'nat.tree_small', 'nat.tree_simple'], side * randRange(p.rng, 12, 24), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.1) })
  }
  const flowers = some(p, 2.5)
  for (let i = 0; i < flowers; i++) p.put(p.rng() < 0.6 ? FLOWERS : ['nat.grass_large'], side * randRange(p.rng, 9, water !== null ? Math.max(10, water - 2) : 18), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.45, 0.7) })
  return span
}

function windSky(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 90)
  if (water !== null) {
    const span = randRange(p.rng, 18, 32)
    const out = Math.max(32, water + 10)
    const roll = p.rng()
    if (roll < 0.3) p.put('gen.sailboat', side * randRange(p.rng, out, out + 45), 0, { onWater: true, rot: heading(p), scale: randRange(p.rng, 0.9, 1.2) })
    else if (roll < 0.42) islet(p, side * randRange(p.rng, out + 10, out + 40), 0, randRange(p.rng, 7, 12), 'lighthouse')
    else if (roll < 0.6) p.put(['nat.cliff_block_rock', 'nat.cliff_large_rock'], side * randRange(p.rng, out + 6, out + 40), 0, { island: true, rot: spin(p), sx: randRange(p.rng, 1.2, 2), sy: randRange(p.rng, 1.6, 2.6), sz: randRange(p.rng, 1.2, 2), tint: 0xc9c1ae })
    return span
  }
  // The turbines: a long line of them marching along the ridge.
  const span = randRange(p.rng, 16, 24)
  p.put('ind.windmill', side * randRange(p.rng, 34, 46), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.2, 0.2), scale: randRange(p.rng, 1.3, 1.6) })
  if (p.rng() < 0.3) p.put('gen.sheep', side * randRange(p.rng, 28, 34), randRange(p.rng, -span / 2, span / 2), { rot: spin(p) })
  return span
}

// ── the future city ──────────────────────────────────────────────────────────────

function futureFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.22) {
    const span = randRange(p.rng, 16, 22)
    p.put(GLASS_TOWERS, side * randRange(p.rng, 18, 26), 0, { rot: spin(p), scale: randRange(p.rng, 0.8, 1.1), glow: 1 })
    p.put('gen.lightPost', side * 9.4, -span / 2 + 2, { glow: 1 })
    return span
  }
  if (roll < 0.32) {
    const span = 22
    p.put('gen.biodome', side * randRange(p.rng, 18, 24), 0, { rot: spin(p), scale: randRange(p.rng, 0.9, 1.2) })
    return span
  }
  if (roll < 0.37) {
    const span = 26
    p.put('gen.rocket', side * randRange(p.rng, 22, 28), 0, { rot: FACING(side), scale: randRange(p.rng, 1, 1.2) })
    return span
  }
  if (roll < 0.47) {
    // A ring of light standing over the verge.
    const span = 14
    p.put('gen.lightRing', side * 13, 0, { glow: 1.2 })
    return span
  }
  // Tidy plantings and light posts between the towers.
  const span = randRange(p.rng, 8, 14)
  p.put(['nat.tree_default', 'nat.tree_small', 'nat.tree_cone'], side * randRange(p.rng, 11, 14), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.8, 1) })
  if (p.rng() < 0.5) p.put('gen.lightPost', side * 9.4, randRange(p.rng, -span / 2, span / 2), { glow: 1 })
  if (p.rng() < 0.4) p.put(SKYSCRAPERS, side * randRange(p.rng, 20, 28), 0, { rot: SIDE_ROT(side), glow: windows(p, 2) })
  return span
}

function futureSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 12, 22)
  const roll = p.rng()
  if (roll < 0.5) p.put(GLASS_TOWERS, side * randRange(p.rng, 30, 56), 0, { rot: spin(p), scale: randRange(p.rng, 1.2, 1.8), glow: 1 })
  else if (roll < 0.75) p.put(SKYSCRAPERS, side * randRange(p.rng, 30, 56), 0, { rot: spin(p), scale: randRange(p.rng, 1.1, 1.5), glow: windows(p, 2) })
  else if (roll < 0.85) p.put('gen.biodome', side * randRange(p.rng, 34, 50), 0, { rot: spin(p), scale: randRange(p.rng, 1.3, 1.8) })
  return span
}

// ── the haunted wood ─────────────────────────────────────────────────────────────

const GLOOM = 0x6a6470

function hauntedFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.14) {
    // A graveyard behind a black iron fence.
    const span = 18
    const x = side * randRange(p.rng, 13, 16)
    p.plot(x, 8, span - 2, 0, 0x2f3329)
    p.put(GRAVES, x, -3.5, { rot: TO_RUNNER + randRange(p.rng, -0.2, 0.2) })
    p.put(GRAVES, x + side * 1.5, 3.5, { rot: TO_RUNNER + randRange(p.rng, -0.2, 0.2) })
    for (let i = 0; i < 4; i++) p.put('nat.fence_simple', x - side * 4.6, -span / 2 + 2.4 + i * 4.3, { rot: Math.PI / 2, scale: 0.6, tint: 0x3a3a44 })
    p.put(DEAD_TREES, x + side * 5, randRange(p.rng, -5, 5), { rot: spin(p), scale: randRange(p.rng, 1, 1.3), tint: GLOOM })
    return span
  }
  if (roll < 0.22) {
    const span = 24
    p.put('gen.hauntedHouse', side * randRange(p.rng, 19, 24), 0, { rot: FACING(side), glow: 1.4 })
    p.put('gen.jackLantern', side * 10, randRange(p.rng, -4, 4), { rot: TO_RUNNER, glow: 1.8 })
    return span
  }
  if (roll < 0.34) {
    // A patch of carved pumpkins, grinning at the road.
    const span = randRange(p.rng, 8, 12)
    const n = 2 + some(p, 2)
    for (let i = 0; i < n; i++) {
      const x = side * randRange(p.rng, 9.4, 13)
      const dz = randRange(p.rng, -span / 2, span / 2)
      if (p.rng() < 0.7) p.put('gen.jackLantern', x, dz, { rot: TO_RUNNER + randRange(p.rng, -0.5, 0.5), scale: randRange(p.rng, 0.8, 1.2), glow: 1.8 })
      else p.put('nat.crop_pumpkin', x, dz, { rot: spin(p), scale: randRange(p.rng, 0.35, 0.5) })
    }
    return span
  }
  if (roll < 0.4) {
    const span = 12
    p.put('gen.ghost', side * randRange(p.rng, 10.5, 15), 0, { y: randRange(p.rng, 0.8, 2.2), rot: TO_RUNNER + randRange(p.rng, -0.6, 0.6) })
    p.put(DEAD_TREES, side * randRange(p.rng, 17, 24), randRange(p.rng, -4, 4), { rot: spin(p), scale: randRange(p.rng, 1, 1.4), tint: GLOOM })
    return span
  }
  const span = randRange(p.rng, 7, 12)
  p.put(p.rng() < 0.6 ? DEAD_TREES : DARK_TREES, side * randRange(p.rng, 10, 14), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.3), tint: GLOOM })
  const back = some(p, 1.5)
  for (let i = 0; i < back; i++) p.put(p.rng() < 0.5 ? DEAD_TREES : DARK_TREES, side * randRange(p.rng, 15, 26), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1, 1.4), tint: GLOOM })
  if (p.rng() < 0.4) p.put(['nat.mushroom_redGroup', 'nat.mushroom_tanGroup', 'nat.stump_old'], side * randRange(p.rng, 9, 12), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.6, 1) })
  return span
}

function hauntedSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 12, 24)
  if (p.rng() < 0.1) p.put('gen.castle', side * randRange(p.rng, 46, 64), 0, { rot: FACING(side), scale: randRange(p.rng, 1, 1.3), glow: 1.4 })
  const trees = 2 + some(p, 1.5)
  for (let i = 0; i < trees; i++) p.put(p.rng() < 0.5 ? DEAD_TREES : DARK_TREES, side * randRange(p.rng, 28, 60), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.3, 1.9), tint: GLOOM })
  return span
}

// ── the frozen lake ──────────────────────────────────────────────────────────────

function icelakeFront(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 70)
  if (water !== null && water > 0) {
    // Out on the ice: a fishing shack, crystals pushed up by the frost.
    const span = randRange(p.rng, 12, 20)
    const roll = p.rng()
    if (roll < 0.22) p.put('gen.iceHut', side * (water + randRange(p.rng, 5, 16)), 0, { onWater: true, rot: FACING(side) + randRange(p.rng, -0.4, 0.4) })
    else if (roll < 0.5) p.put('gen.iceCrystal', side * (water + randRange(p.rng, 2, 14)), 0, { onWater: true, rot: spin(p), scale: randRange(p.rng, 0.8, 1.5), glow: 0.6 })
    else if (roll < 0.58) p.put('gen.snowman', side * (water + randRange(p.rng, 3, 8)), 0, { onWater: true, rot: TO_RUNNER + randRange(p.rng, -0.5, 0.5) })
    if (water > 12) p.put(PINES, side * randRange(p.rng, 10, water - 3), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.2), snow: 1 })
    if (p.rng() < 0.4) p.put(STONES, side * (water + randRange(p.rng, -1, 1)), randRange(p.rng, -span / 2, span / 2), { wade: true, rot: spin(p), scale: randRange(p.rng, 0.5, 0.9), snow: 1, tint: ICE_ROCK })
    return span
  }
  const roll = p.rng()
  if (roll < 0.1) {
    const span = 16
    p.put('gen.igloo', side * randRange(p.rng, 14, 18), 0, { rot: FACING(side) })
    p.put('gen.iceCrystal', side * randRange(p.rng, 10, 12), randRange(p.rng, 3, 6), { rot: spin(p), scale: 0.8, glow: 0.6 })
    return span
  }
  if (roll < 0.2) {
    const span = randRange(p.rng, 8, 12)
    const n = 1 + some(p, 1.5)
    for (let i = 0; i < n; i++) p.put('gen.iceCrystal', side * randRange(p.rng, 10, 18), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.8, 1.6), glow: 0.6 })
    return span
  }
  return snowFront(side, p)
}

function icelakeSky(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 90)
  if (water !== null) {
    const span = randRange(p.rng, 16, 30)
    const out = Math.max(30, water + 10)
    const roll = p.rng()
    if (roll < 0.3) p.put(STONES.slice(0, 4), side * randRange(p.rng, out, out + 40), 0, { island: true, rot: spin(p), scale: randRange(p.rng, 1.6, 2.8), snow: 1, tint: ICE_ROCK })
    else if (roll < 0.5) p.put('gen.iceCrystal', side * randRange(p.rng, out, out + 30), 0, { onWater: true, rot: spin(p), scale: randRange(p.rng, 1.6, 2.6), glow: 0.6 })
    else if (roll < 0.6) p.put('gen.iceHut', side * randRange(p.rng, out, out + 30), 0, { onWater: true, rot: spin(p) })
    return span
  }
  return snowSky(side, p)
}

// ── the flower farm ──────────────────────────────────────────────────────────────

function farmFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.26) {
    // Tulips: stripes of colour running away from the road.
    const span = randRange(p.rng, 18, 28)
    const inner = 9.2
    const width = randRange(p.rng, 10, 16)
    const length = span - 2
    p.plot(side * (inner + width / 2), width, length, 0, 0x7a5a3e)
    const spacing = 1.5 / Math.max(0.6, p.density)
    const rows = Math.min(9, Math.floor((width - 1) / spacing))
    const start = Math.floor(p.rng() * TULIPS.length)
    for (let i = 0; i < rows; i++) {
      p.put('gen.cropRow', side * (inner + 1 + spacing / 2 + i * spacing), 0, { sx: spacing * 0.7, sy: randRange(p.rng, 0.45, 0.55), sz: length - 1.2, tint: TULIPS[(start + Math.floor(i / 2)) % TULIPS.length] })
    }
    return span
  }
  if (roll < 0.4) {
    // Sunflowers along the fence, faces to the runner.
    const span = 18
    for (let i = 0; i < 3; i++) p.put('gen.sunflowers', side * randRange(p.rng, 10, 11), -6 + i * 6, {})
    if (p.rng() < 0.7) for (let i = 0; i < 3; i++) p.put('gen.sunflowers', side * randRange(p.rng, 12.5, 13.5), -6 + i * 6, {})
    return span
  }
  if (roll < 0.52) {
    // The barn, its silo, hay in the yard.
    const span = 26
    const x = side * randRange(p.rng, 20, 24)
    p.put('gen.barn', x, 0, { rot: FACING(side) })
    p.put('gen.silo', x + side * 2, 7, { rot: spin(p) })
    p.put('gen.haybale', side * randRange(p.rng, 12, 14), randRange(p.rng, -8, -4), { rot: spin(p) })
    if (p.rng() < 0.5) p.put('gen.tractor', side * randRange(p.rng, 13, 15), randRange(p.rng, 3, 7), { rot: spin(p) })
    return span
  }
  if (roll < 0.62) {
    // Cows in the pasture behind a fence.
    const span = 20
    for (let i = 0; i < 4; i++) p.put('nat.fence_simple', side * 9.6, -span / 2 + 2.4 + i * 4.3, { rot: Math.PI / 2, scale: 0.6 })
    const n = 2 + some(p, 2)
    for (let i = 0; i < n; i++) p.put('gen.cow', side * randRange(p.rng, 12, 20), randRange(p.rng, -span / 2 + 2, span / 2 - 2), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.05) })
    return span
  }
  if (roll < 0.7) {
    const span = 22
    p.put('gen.dutchMill', side * randRange(p.rng, 17, 22), 0, { rot: FACING(side) })
    return span
  }
  return plainsFront(side, p)
}

function farmSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 14, 26)
  const roll = p.rng()
  if (roll < 0.2) p.put('gen.dutchMill', side * randRange(p.rng, 32, 50), 0, { rot: FACING(side), scale: randRange(p.rng, 1.1, 1.4) })
  else if (roll < 0.34) {
    p.put('gen.barn', side * randRange(p.rng, 34, 48), 0, { rot: FACING(side), scale: 1.1 })
    p.put('gen.silo', side * randRange(p.rng, 30, 34), span / 3, { rot: spin(p) })
  } else if (roll < 0.46) {
    const n = 1 + some(p, 2)
    for (let i = 0; i < n; i++) p.put('gen.cow', side * randRange(p.rng, 28, 40), randRange(p.rng, -span / 2, span / 2), { rot: spin(p) })
  } else return plainsSky(side, p)
  return span
}

// ── the red canyon ───────────────────────────────────────────────────────────────

function canyonFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.12) {
    // A natural arch, its opening to the runner.
    const span = 20
    p.put('gen.rockArch', side * randRange(p.rng, 16, 22), 0, { rot: TO_RUNNER + side * randRange(p.rng, 0.1, 0.4), scale: randRange(p.rng, 0.9, 1.2) })
    return span
  }
  if (roll < 0.26) {
    const span = randRange(p.rng, 12, 18)
    const n = 1 + some(p, 2)
    for (let i = 0; i < n; i++) p.put('gen.hoodoo', side * randRange(p.rng, 11, 20), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.7, 1.3) })
    return span
  }
  if (roll < 0.36) {
    const span = randRange(p.rng, 16, 22)
    p.put('gen.mesa', side * randRange(p.rng, 22, 28), 0, { rot: spin(p), sx: randRange(p.rng, 7, 10), sy: randRange(p.rng, 8, 13), sz: randRange(p.rng, 6, 9) })
    return span
  }
  const span = randRange(p.rng, 10, 18)
  if (p.rng() < 0.6) p.put(CACTI, side * randRange(p.rng, 9.5, 18), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.4) })
  const rocks = some(p, 1.6)
  for (let i = 0; i < rocks; i++) p.put(p.rng() < 0.5 ? SMALL_ROCKS : ROCKS, side * randRange(p.rng, 10, 22), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.5, 1.3), tint: RED_ROCK })
  if (p.rng() < 0.4) p.put(BUSHES, side * randRange(p.rng, 9, 14), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.4, 0.6), tint: 0xc8c090 })
  return span
}

function canyonSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 16, 30)
  const roll = p.rng()
  if (roll < 0.45) p.put('gen.mesa', side * randRange(p.rng, 38, 60), 0, { rot: spin(p), sx: randRange(p.rng, 10, 20), sy: randRange(p.rng, 12, 22), sz: randRange(p.rng, 9, 16) })
  else if (roll < 0.6) p.put('gen.rockArch', side * randRange(p.rng, 34, 50), 0, { rot: TO_RUNNER + side * 0.3, scale: randRange(p.rng, 1.4, 2) })
  else if (roll < 0.78) p.put('gen.hoodoo', side * randRange(p.rng, 30, 44), 0, { rot: spin(p), scale: randRange(p.rng, 1.3, 2) })
  return span
}

// ── the oasis ────────────────────────────────────────────────────────────────────

function oasisFront(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 60)
  if (water !== null && water > 0) {
    // The pool's edge: palms, reeds, a camel come down to drink.
    const span = randRange(p.rng, 9, 14)
    p.put(p.rng() < 0.5 ? PALMS : TROPIC_PALMS, side * randRange(p.rng, Math.min(water - 2, 10), water - 1), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.9, 1.2) })
    if (p.rng() < 0.5) p.put('gen.reeds', side * (water + randRange(p.rng, -1, 1.5)), randRange(p.rng, -span / 2, span / 2), { wade: true, rot: spin(p), scale: randRange(p.rng, 0.8, 1.2) })
    if (p.rng() < 0.16) p.put('gen.camel', side * (water - 2.5), randRange(p.rng, -2, 2), { rot: SIDE_ROT(-side) + randRange(p.rng, -0.4, 0.4) })
    if (p.rng() < 0.3) p.put(LILIES, side * (water + randRange(p.rng, 2, 8)), 0, { onWater: true, y: 0.02, rot: spin(p), scale: 1.3 })
    return span
  }
  const roll = p.rng()
  if (roll < 0.14) {
    // A caravan plodding along beside the road.
    const span = 22
    const x = side * randRange(p.rng, 13, 17)
    const dir = p.rng() < 0.5 ? 0 : Math.PI
    const n = 2 + some(p, 1.5)
    for (let i = 0; i < n; i++) p.put('gen.camel', x + randRange(p.rng, -0.5, 0.5), -span / 2 + 3 + i * 4.2, { rot: dir + randRange(p.rng, -0.15, 0.15) })
    return span
  }
  if (roll < 0.26) {
    // A nomad camp: tents, a fire, palms.
    const span = 20
    p.put(['nat.tent_detailedClosed', 'nat.tent_smallOpen', 'nat.tent_detailedOpen'], side * randRange(p.rng, 14, 18), -3, { rot: SIDE_ROT(side) + randRange(p.rng, -0.4, 0.4), tint: 0xf2d6b0 })
    p.put(['nat.tent_detailedClosed', 'nat.tent_smallOpen'], side * randRange(p.rng, 17, 21), 4, { rot: SIDE_ROT(side) + randRange(p.rng, -0.4, 0.4), tint: 0xd8a070, scale: 0.85 })
    p.put('nat.campfire_logs', side * 12, 2, { rot: spin(p), scale: 0.6 })
    p.put(PALMS, side * randRange(p.rng, 22, 26), 0, { rot: spin(p), scale: 1.1 })
    return span
  }
  if (roll < 0.32) {
    const span = 24
    p.put('gen.kasbah', side * randRange(p.rng, 22, 28), 0, { rot: FACING(side) })
    return span
  }
  return desertFront(side, p)
}

function oasisSky(side: -1 | 1, p: WildPlacer): number {
  const water = waterWithin(p, side, 90)
  if (water !== null) {
    const span = randRange(p.rng, 12, 22)
    const trees = 1 + some(p, 1.5)
    for (let i = 0; i < trees; i++) p.put(TROPIC_PALMS, side * randRange(p.rng, Math.max(water + 6, 30), water + 30), randRange(p.rng, -span / 2, span / 2), { island: true, rot: spin(p), scale: randRange(p.rng, 1.1, 1.4) })
    return span
  }
  if (p.rng() < 0.12) {
    p.put('gen.kasbah', side * randRange(p.rng, 36, 50), 0, { rot: FACING(side), scale: 1.3 })
    return 30
  }
  if (p.rng() < 0.12) {
    p.put('gen.camel', side * randRange(p.rng, 30, 44), 0, { rot: spin(p), scale: 1.1 })
  }
  return desertSky(side, p)
}

// ── the jungle ───────────────────────────────────────────────────────────────────

function jungleFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.16) {
    const span = randRange(p.rng, 14, 18)
    p.put('gen.giantTree', side * randRange(p.rng, 14, 19), 0, { rot: spin(p), scale: randRange(p.rng, 0.85, 1.1) })
    p.put(JUNGLE_PLANTS, side * randRange(p.rng, 9, 11), randRange(p.rng, -5, 5), { rot: spin(p), scale: randRange(p.rng, 1.2, 1.8) })
    return span
  }
  if (roll < 0.22) {
    // A stone face in the undergrowth.
    const span = 14
    p.put('nat.statue_head', side * randRange(p.rng, 12, 15), 0, { rot: KIT_TO_RUNNER - side * 0.5, scale: randRange(p.rng, 1.2, 1.6), tint: MOSS })
    p.put(JUNGLE_PLANTS, side * 10, 3, { rot: spin(p), scale: 1.5 })
    return span
  }
  if (roll < 0.28) {
    const span = 12
    p.put('gen.bamboo', side * randRange(p.rng, 10.5, 14), 0, { rot: spin(p), scale: randRange(p.rng, 0.9, 1.2) })
    return span
  }
  const span = randRange(p.rng, 6, 10)
  p.put(JUNGLE_TREES, side * randRange(p.rng, 11, 14), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.95, 1.3) })
  const back = 1 + some(p, 1.2)
  for (let i = 0; i < back; i++) p.put(p.rng() < 0.25 ? 'gen.giantTree' : JUNGLE_TREES, side * randRange(p.rng, 16, 28), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1, 1.4) })
  const plants = 1 + some(p, 1)
  for (let i = 0; i < plants; i++) p.put(JUNGLE_PLANTS, side * randRange(p.rng, 8.8, 12), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.1, 1.9) })
  return span
}

function jungleSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 10, 18)
  if (p.rng() < 0.4) p.put('gen.giantTree', side * randRange(p.rng, 28, 44), 0, { rot: spin(p), scale: randRange(p.rng, 1.2, 1.6) })
  const trees = 2 + some(p, 1.5)
  for (let i = 0; i < trees; i++) p.put(JUNGLE_TREES, side * randRange(p.rng, 28, 60), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.4, 2) })
  return span
}

// ── the rice terraces ────────────────────────────────────────────────────────────

function terracesFront(side: -1 | 1, p: WildPlacer): number {
  const roll = p.rng()
  if (roll < 0.32) {
    // A flooded paddy, rows of young rice.
    const span = randRange(p.rng, 16, 24)
    const inner = 9.4
    const width = randRange(p.rng, 9, 14)
    const length = span - 2
    p.plot(side * (inner + width / 2), width, length, 0, 0x6f9a6a)
    const spacing = 1.3 / Math.max(0.6, p.density)
    const rows = Math.min(9, Math.floor((width - 1) / spacing))
    for (let i = 0; i < rows; i++) p.put('gen.cropRow', side * (inner + 1 + spacing / 2 + i * spacing), 0, { sx: spacing * 0.45, sy: randRange(p.rng, 0.35, 0.5), sz: length - 1.2, tint: 0x9ad04a })
    return span
  }
  if (roll < 0.46) {
    const span = 22
    p.put('gen.lanternHouse', side * randRange(p.rng, 16, 20), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.1, 0.1), glow: 1.5 })
    p.put('gen.bamboo', side * randRange(p.rng, 23, 26), randRange(p.rng, -6, 6), { rot: spin(p) })
    return span
  }
  if (roll < 0.6) {
    const span = randRange(p.rng, 18, 26)
    p.put('gen.terrace', side * randRange(p.rng, 24, 30), 0, { rot: spin(p), sx: randRange(p.rng, 10, 14), sy: randRange(p.rng, 4, 7), sz: randRange(p.rng, 9, 13) })
    return span
  }
  const span = randRange(p.rng, 8, 14)
  if (p.rng() < 0.4) p.put('gen.bamboo', side * randRange(p.rng, 10.5, 14), 0, { rot: spin(p), scale: randRange(p.rng, 0.8, 1.1) })
  else p.put(FARM_TREES, side * randRange(p.rng, 11, 16), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.15) })
  if (p.rng() < 0.5) p.put(BUSHES, side * randRange(p.rng, 9, 12), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.5, 0.8) })
  return span
}

function terracesSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 18, 30)
  const roll = p.rng()
  if (roll < 0.55) p.put('gen.terrace', side * randRange(p.rng, 40, 60), 0, { rot: spin(p), sx: randRange(p.rng, 18, 30), sy: randRange(p.rng, 8, 15), sz: randRange(p.rng, 16, 26) })
  else if (roll < 0.7) p.put('gen.lanternHouse', side * randRange(p.rng, 30, 40), 0, { rot: FACING(side), glow: 1.5, scale: 1.1 })
  if (p.rng() < 0.4) p.put(FARM_TREES, side * randRange(p.rng, 28, 36), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 1.1, 1.4) })
  return span
}

// ── the skyway over the night city ───────────────────────────────────────────────

function highwayFront(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 14, 22)
  // Down below the deck: blocks and towers; the tall ones rise past the railings.
  const tall = p.rng() < 0.55
  p.put(tall ? SKYSCRAPERS : LOW_TOWNS, side * randRange(p.rng, 16, 26), 0, { island: true, rot: SIDE_ROT(side) + (p.rng() < 0.5 ? 0 : Math.PI), glow: windows(p, Math.floor(p.rng() * 4)) })
  return span
}

function highwaySky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 12, 22)
  p.put(p.rng() < 0.7 ? SKYSCRAPERS : GLASS_TOWERS, side * randRange(p.rng, 32, 62), 0, { island: true, rot: spin(p), scale: randRange(p.rng, 1.1, 1.6), glow: windows(p, Math.floor(p.rng() * 4)) })
  return span
}

// ── dawn over the meadows ────────────────────────────────────────────────────────

function dawnFront(side: -1 | 1, p: WildPlacer): number {
  if (p.rng() < 0.06) {
    // A balloon coming down to land in the next field.
    const span = 20
    p.put(BALLOONS, side * randRange(p.rng, 16, 22), 0, { y: randRange(p.rng, 0.5, 6), rot: spin(p) })
    return span
  }
  const span = randRange(p.rng, 10, 18)
  const trees = some(p, 1.2)
  for (let i = 0; i < trees; i++) p.put(FARM_TREES, side * randRange(p.rng, 12, 26), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.85, 1.25) })
  const flowers = 1 + some(p, 4)
  for (let i = 0; i < flowers; i++) p.put(FLOWERS, side * randRange(p.rng, 8.8, 16), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), scale: randRange(p.rng, 0.5, 0.75) })
  if (p.rng() < 0.15) p.put('gen.haybale', side * randRange(p.rng, 14, 22), 0, { rot: spin(p) })
  return span
}

function dawnSky(side: -1 | 1, p: WildPlacer): number {
  const span = randRange(p.rng, 14, 26)
  if (p.rng() < 0.55) p.put(BALLOONS, side * randRange(p.rng, 26, 64), 0, { y: randRange(p.rng, 10, 34), rot: spin(p), scale: randRange(p.rng, 1, 1.5) })
  if (p.rng() < 0.5) {
    const n = 1 + some(p, 1.5)
    const x = randRange(p.rng, 30, 60)
    for (let i = 0; i < n; i++) p.put(FARM_TREES, side * (x + randRange(p.rng, -5, 5)), randRange(p.rng, -span / 3, span / 3), { rot: spin(p), scale: randRange(p.rng, 1.1, 1.5) })
  }
  return span
}

/** The far ring for the new lands, or null to fall through to the old ones. */
function landFar(zone: string, side: -1 | 1, p: WildPlacer): number | null {
  switch (zone) {
    case 'halong': {
      const span = randRange(p.rng, 26, 50)
      const r = randRange(p.rng, 9, 20)
      karstAt(p, side * (80 + r + randRange(p.rng, 0, 90)), 0, r, [1.8, 3])
      return span
    }
    case 'blossom': {
      const span = randRange(p.rng, 70, 120)
      if (p.rng() < 0.3) {
        const r = randRange(p.rng, 80, 120)
        p.put('gen.fuji', side * (170 + r * 0.6 + randRange(p.rng, 0, 60)), 0, { rot: spin(p), sx: r, sy: r * randRange(p.rng, 0.55, 0.7), sz: r })
        return span
      }
      return null
    }
    case 'waterfall':
    case 'jungle':
    case 'temple': {
      const span = randRange(p.rng, 45, 80)
      const r = randRange(p.rng, 34, 60)
      p.put(GREEN_PEAKS, side * (74 + r * 0.8 + randRange(p.rng, 0, 30)), 0, { island: true, rot: spin(p), sx: r, sy: randRange(p.rng, zone === 'temple' ? 30 : 50, zone === 'temple' ? 60 : 100), sz: r * randRange(p.rng, 0.8, 1.3) })
      return span
    }
    case 'terraces': {
      const span = randRange(p.rng, 50, 90)
      const r = randRange(p.rng, 40, 70)
      p.put(p.rng() < 0.6 ? 'gen.terrace' : GREEN_PEAKS, side * (80 + r * 0.7 + randRange(p.rng, 0, 40)), 0, { rot: spin(p), sx: r, sy: randRange(p.rng, 24, 50), sz: r * randRange(p.rng, 0.8, 1.2) })
      return span
    }
    case 'savanna': {
      const span = randRange(p.rng, 60, 110)
      const r = randRange(p.rng, 40, 70)
      p.put('gen.hill', side * (90 + r * 0.7 + randRange(p.rng, 0, 50)), 0, { rot: spin(p), sx: r, sy: randRange(p.rng, 6, 14), sz: r * randRange(p.rng, 0.8, 1.4), tint: 0xf0d080 })
      return span
    }
    case 'redcanyon': {
      const span = randRange(p.rng, 50, 90)
      const r = randRange(p.rng, 24, 50)
      p.put('gen.mesa', side * (90 + r + randRange(p.rng, 0, 60)), 0, { rot: spin(p), sx: r, sy: randRange(p.rng, 20, 42), sz: r * randRange(p.rng, 0.7, 1.3) })
      return span
    }
    case 'future': {
      const span = randRange(p.rng, 24, 44)
      p.put(GLASS_TOWERS, side * randRange(p.rng, 80, 150), 0, { rot: spin(p), scale: randRange(p.rng, 1.8, 3), glow: 1 })
      return span
    }
    case 'highway': {
      const span = randRange(p.rng, 20, 36)
      p.put(SKYLINE, side * randRange(p.rng, 70, 130), 0, { island: true, rot: spin(p), scale: randRange(p.rng, 1.6, 2.6), glow: windows(p, Math.floor(p.rng() * 4)) })
      return span
    }
    case 'haunted': {
      const span = randRange(p.rng, 60, 110)
      const r = randRange(p.rng, 34, 60)
      p.put(['gen.mountainA', 'gen.mountainB', 'gen.mountainC'], side * (80 + r * 0.8 + randRange(p.rng, 0, 30)), 0, { rot: spin(p), sx: r, sy: randRange(p.rng, 40, 70), sz: r, tint: 0x6a6f80 })
      return span
    }
    case 'dawn': {
      if (p.rng() < 0.3) {
        p.put(BALLOONS, side * randRange(p.rng, 80, 140), 0, { y: randRange(p.rng, 30, 60), rot: spin(p), scale: randRange(p.rng, 2, 3) })
        return randRange(p.rng, 40, 70)
      }
      return null
    }
    default:
      return null
  }
}

// ── the far ring: mountains, hills, dunes ────────────────────────────────────────

function planFar(zone: string, side: -1 | 1, p: WildPlacer): number {
  const land = landFar(zone, side, p)
  if (land !== null) return land
  if (zone === 'volcano') {
    const span = randRange(p.rng, 60, 110)
    if (p.rng() < 0.4) {
      const r = randRange(p.rng, 50, 80)
      p.put('gen.volcano', side * (110 + r * 0.6 + randRange(p.rng, 0, 50)), 0, { rot: spin(p), sx: r, sy: randRange(p.rng, 50, 80), sz: r * randRange(p.rng, 0.85, 1.15), glow: 1.3 })
    } else {
      const r = randRange(p.rng, 34, 60)
      p.put(['gen.mountainA', 'gen.mountainB', 'gen.mountainC'], side * (74 + r * 0.8 + randRange(p.rng, 0, 30)), 0, { rot: spin(p), sx: r, sy: randRange(p.rng, 45, 90), sz: r * randRange(p.rng, 0.8, 1.3), tint: 0x6b5a55 })
    }
    return span
  }
  if (zone === 'beach' || zone === 'seabridge' || zone === 'river') {
    const span = randRange(p.rng, 70, 130)
    const wet = p.water(side) !== null
    if (wet && p.rng() < 0.45) return span
    const r = randRange(p.rng, 30, 65)
    const green = zone === 'river' ? 0xffffff : 0xd8f0b0
    p.put('gen.hill', side * (90 + r * 0.7 + randRange(p.rng, 0, 60)), 0, { island: true, rot: spin(p), sx: r, sy: randRange(p.rng, wet ? 12 : 10, wet ? 26 : 30), sz: r * randRange(p.rng, 0.7, 1.3), tint: green })
    return span
  }
  if (zone === 'desert') {
    const span = randRange(p.rng, 50, 90)
    const w = randRange(p.rng, 40, 80)
    p.put('gen.dune', side * (78 + w * 0.6 + randRange(p.rng, 0, 50)), 0, { rot: SIDE_ROT(side) + randRange(p.rng, -0.4, 0.4), sx: w, sy: randRange(p.rng, 10, 24), sz: randRange(p.rng, 50, 100) })
    return span
  }
  if (zone === 'plains') {
    const span = randRange(p.rng, 60, 110)
    const r = randRange(p.rng, 40, 70)
    p.put('gen.hill', side * (80 + r * 0.7 + randRange(p.rng, 0, 40)), 0, { rot: spin(p), sx: r, sy: randRange(p.rng, 10, 22), sz: r * randRange(p.rng, 0.8, 1.4) })
    return span
  }
  // Forest and snow: a range of peaks, one or two deep.
  const span = randRange(p.rng, 45, 80)
  const snow = zone === 'snow' ? 1 : 0
  const r = randRange(p.rng, 34, 60)
  p.put(['gen.mountainA', 'gen.mountainB', 'gen.mountainC'], side * (74 + r * 0.8 + randRange(p.rng, 0, 30)), 0, { rot: spin(p), sx: r, sy: randRange(p.rng, 55, 105), sz: r * randRange(p.rng, 0.8, 1.3), snow })
  if (p.rng() < 0.5) {
    const r2 = randRange(p.rng, 50, 80)
    p.put(['gen.mountainA', 'gen.mountainB', 'gen.mountainC'], side * (150 + r2), randRange(p.rng, -span / 2, span / 2), { rot: spin(p), sx: r2, sy: randRange(p.rng, 90, 150), sz: r2, snow })
  }
  return span
}

// ── generated shapes ─────────────────────────────────────────────────────────────

/** Strips a geometry down to non-indexed position + one flat colour. */
function painted(source: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone()
  source.dispose()
  geometry.deleteAttribute('normal')
  geometry.deleteAttribute('uv')
  const count = geometry.attributes.position.count
  const colour = new THREE.Color(hex)
  const data = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colour.toArray(data, i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(data, 3))
  return geometry
}

/**
 * A lathed mound, unit radius and height, standing on y = 0. `profile(t)` is the height
 * at radius fraction 1 - t (t = 0 at the rim, 1 at the top); `colour` paints each face
 * by its centre height (0..1) and a per-face random.
 */
function mound(
  seed: number,
  profile: (t: number) => number,
  colour: (h: number, r: number, into: THREE.Color, top: boolean) => void,
  options: { radial: number; rings: number; jitter: number; lean?: number }
): THREE.BufferGeometry {
  const rng = makeRng(seed)
  const { radial, rings, jitter } = options
  const lean = options.lean ?? 0
  const ringPoints: THREE.Vector3[][] = []
  for (let i = 0; i < rings; i++) {
    const t = i / rings
    const ring: THREE.Vector3[] = []
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const r = (1 - t) * (1 + (i === 0 ? 0.6 : 1) * (rng() - 0.5) * jitter)
      const h = i === 0 ? 0 : profile(t) * (1 + (rng() - 0.5) * jitter * 0.6)
      ring.push(new THREE.Vector3(Math.cos(a) * r + lean * t, h, Math.sin(a) * r))
    }
    ringPoints.push(ring)
  }
  const apex = new THREE.Vector3(lean + (rng() - 0.5) * 0.08, profile(1), (rng() - 0.5) * 0.08)
  const positions: number[] = []
  const colours: number[] = []
  const c = new THREE.Color()
  const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, top = false) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z)
    colour((a.y + b.y + d.y) / 3, rng(), c, top)
    for (let k = 0; k < 3; k++) colours.push(c.r, c.g, c.b)
  }
  for (let i = 0; i < rings; i++) {
    const lower = ringPoints[i]
    const upper = ringPoints[i + 1]
    for (let j = 0; j < radial; j++) {
      const k = (j + 1) % radial
      if (upper) {
        tri(lower[j], upper[j], lower[k])
        tri(lower[k], upper[j], upper[k])
      } else {
        tri(lower[j], apex, lower[k], true)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  // Wound counter-clockwise seen from outside: (up the slope) × (round the ring) points out.
  return geometry
}

const linear = (hex: number): THREE.Color => new THREE.Color(hex)

function mountain(seed: number): THREE.BufferGeometry {
  const grass = linear(0x5f7f52)
  const rock = linear(0x8d8f93)
  const dark = linear(0x6f7378)
  const snow = linear(0xf4f7fb)
  return mound(
    seed,
    (t) => Math.pow(t, 0.85),
    (h, r, into) => {
      if (h > 0.64 + r * 0.08) into.copy(snow)
      else if (h < 0.16 + r * 0.06) into.copy(grass).lerp(rock, r * 0.4)
      else into.copy(r < 0.4 ? dark : rock).lerp(snow, Math.max(0, h - 0.5) * 0.5)
    },
    { radial: 11, rings: 6, jitter: 0.32 }
  )
}

function hill(seed: number): THREE.BufferGeometry {
  const low = linear(0x7cbf5a)
  const high = linear(0x9ad06a)
  return mound(
    seed,
    (t) => Math.sin((t * Math.PI) / 2),
    (h, r, into) => into.copy(low).lerp(high, Math.min(1, h * 0.9 + r * 0.2)),
    { radial: 12, rings: 4, jitter: 0.18 }
  )
}

function dune(seed: number): THREE.BufferGeometry {
  const low = linear(0xe0b375)
  const high = linear(0xf6d7a0)
  return mound(
    seed,
    (t) => Math.pow(Math.sin((t * Math.PI) / 2), 1.4),
    (h, r, into) => into.copy(low).lerp(high, Math.min(1, h * 0.8 + r * 0.25)),
    { radial: 12, rings: 4, jitter: 0.14, lean: 0.35 }
  )
}

/** One furrow of crop: a rounded ridge 1 m wide, 1 m tall and 1 m long (tinted per field). */
function cropRow(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(-0.5, 0)
  shape.lineTo(-0.42, 0.62)
  shape.lineTo(-0.18, 0.95)
  shape.lineTo(0.18, 0.95)
  shape.lineTo(0.42, 0.62)
  shape.lineTo(0.5, 0)
  shape.closePath()
  const prism = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
  prism.translate(0, 0, -0.5)
  const geometry = painted(prism, 0xffffff)
  // A little light at the crest, a little shade at the foot.
  const pos = geometry.attributes.position
  const col = geometry.attributes.color
  for (let i = 0; i < pos.count; i++) {
    const shade = 0.72 + 0.28 * pos.getY(i)
    col.setXYZ(i, shade, shade, shade)
  }
  return geometry
}

function haybale(): THREE.BufferGeometry {
  const body = painted(new THREE.CylinderGeometry(0.85, 0.85, 1.5, 12).rotateZ(Math.PI / 2).translate(0, 0.85, 0), 0xe8c45e)
  const bands = painted(new THREE.CylinderGeometry(0.87, 0.87, 0.12, 12).rotateZ(Math.PI / 2).translate(0.35, 0.85, 0), 0xc99d3c)
  const bands2 = painted(new THREE.CylinderGeometry(0.87, 0.87, 0.12, 12).rotateZ(Math.PI / 2).translate(-0.35, 0.85, 0), 0xc99d3c)
  const merged = mergeGeometries([body, bands, bands2], false) as THREE.BufferGeometry
  for (const part of [body, bands, bands2]) part.dispose()
  return merged
}

function snowman(): THREE.BufferGeometry {
  const parts = [
    painted(new THREE.IcosahedronGeometry(0.85, 1).translate(0, 0.78, 0), 0xf6f9fc),
    painted(new THREE.IcosahedronGeometry(0.62, 1).translate(0, 1.9, 0), 0xf6f9fc),
    painted(new THREE.IcosahedronGeometry(0.44, 1).translate(0, 2.75, 0), 0xf6f9fc),
    // Carrot nose, coal eyes and buttons, a hat, a scarf, stick arms. Front is -z.
    painted(new THREE.ConeGeometry(0.09, 0.5, 6).rotateX(-Math.PI / 2).translate(0, 2.75, -0.62), 0xf08a24),
    painted(new THREE.BoxGeometry(0.09, 0.09, 0.06).translate(-0.15, 2.88, -0.4), 0x22252b),
    painted(new THREE.BoxGeometry(0.09, 0.09, 0.06).translate(0.15, 2.88, -0.4), 0x22252b),
    painted(new THREE.BoxGeometry(0.1, 0.1, 0.06).translate(0, 2.05, -0.6), 0x22252b),
    painted(new THREE.BoxGeometry(0.1, 0.1, 0.06).translate(0, 1.75, -0.62), 0x22252b),
    painted(new THREE.CylinderGeometry(0.3, 0.3, 0.42, 10).translate(0, 3.26, 0), 0x2b2f38),
    painted(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 12).translate(0, 3.06, 0), 0x2b2f38),
    painted(new THREE.CylinderGeometry(0.47, 0.5, 0.16, 10).translate(0, 2.4, 0), 0xd9443c),
    painted(new THREE.BoxGeometry(1.1, 0.06, 0.06).rotateZ(0.5).translate(-0.95, 2.15, 0), 0x6b4630),
    painted(new THREE.BoxGeometry(1.1, 0.06, 0.06).rotateZ(-0.6).translate(0.95, 2.2, 0), 0x6b4630),
  ]
  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry
  for (const part of parts) part.dispose()
  return merged
}

function pond(): THREE.BufferGeometry {
  const water = painted(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2).translate(0, 0.04, 0), 0x46b6d6)
  const rim = painted(new THREE.RingGeometry(0.96, 1.12, 16).rotateX(-Math.PI / 2).translate(0, 0.02, 0), 0x9cc56a)
  const merged = mergeGeometries([water, rim], false) as THREE.BufferGeometry
  water.dispose()
  rim.dispose()
  return merged
}

// ── shapes for the water, the beach and the volcano ─────────────────────────────

/** Merges painted parts into one geometry and frees them. */
function assemble(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry
  for (const part of parts) part.dispose()
  return merged
}

/** Paints each triangle by its index and centre. */
function faces(source: THREE.BufferGeometry, colour: (face: number, centre: THREE.Vector3) => number): THREE.BufferGeometry {
  const geometry = painted(source, 0xffffff)
  const pos = geometry.attributes.position
  const col = geometry.attributes.color
  const c = new THREE.Color()
  const centre = new THREE.Vector3()
  for (let f = 0; f < pos.count / 3; f++) {
    centre.set(0, 0, 0)
    for (let k = 0; k < 3; k++) centre.add(new THREE.Vector3(pos.getX(f * 3 + k), pos.getY(f * 3 + k), pos.getZ(f * 3 + k)))
    centre.multiplyScalar(1 / 3)
    c.setHex(colour(f, centre))
    for (let k = 0; k < 3; k++) col.setXYZ(f * 3 + k, c.r, c.g, c.b)
  }
  return geometry
}

/** A flat triangle visible from both sides. */
function sheet(a: [number, number, number], b: [number, number, number], d: [number, number, number], hex: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...d, ...a, ...d, ...b], 3))
  return painted(geometry, hex)
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry =>
  painted(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex)

/** A boat hull along z (bow at -z), standing on y = 0: deck on top, a band along the waterline. */
function hull(length: number, width: number, height: number, side: number, deck: number, keel: number): THREE.BufferGeometry {
  const source = new THREE.BoxGeometry(width, height, length, 1, 2, 8)
  const pos = source.attributes.position
  const bow = length * 0.32
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i)
    let y = pos.getY(i)
    const z = pos.getZ(i)
    const fromBow = z + length / 2
    if (fromBow < bow) {
      x *= Math.pow(fromBow / bow, 0.7)
      if (y > 0) y += (1 - fromBow / bow) * height * 0.25
    }
    if (y < 0) x *= 0.62
    pos.setXYZ(i, x, y + height / 2, z)
  }
  return faces(source, (_, c) => (c.y > height * 0.92 ? deck : c.y < height * 0.3 ? keel : side))
}

function parasol(stripe: number): THREE.BufferGeometry {
  return assemble([
    painted(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 5).translate(0, 1.25, 0), 0xe8e8e8),
    // Eight gores, alternating, then the underside in the stripe colour.
    faces(new THREE.ConeGeometry(1.45, 0.5, 8).translate(0, 2.5, 0), (f) => (f < 8 ? (f % 2 ? stripe : 0xffffff) : stripe)),
  ])
}

function lounger(): THREE.BufferGeometry {
  const parts = [box(0.62, 0.08, 1.9, 0, 0.32, 0, 0xf2f2f2)]
  for (const x of [-0.27, 0.27]) for (const z of [-0.85, 0.85]) parts.push(box(0.06, 0.32, 0.06, x, 0.16, z, 0xdcdcdc))
  parts.push(box(0.56, 0.06, 1.2, 0, 0.39, 0.32, 0x3d8fd8))
  // The backrest is at -z: turned to the sea, the sunbather faces it.
  parts.push(painted(new THREE.BoxGeometry(0.56, 0.06, 0.75).rotateX(0.8).translate(0, 0.62, -0.6), 0x3d8fd8))
  return assemble(parts)
}

function lifeguard(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (const x of [-0.8, 0.8]) for (const z of [-0.8, 0.8]) parts.push(box(0.14, 2.6, 0.14, x, 1.3, z, 0xf4f4f4))
  parts.push(box(2.1, 0.16, 2.1, 0, 2.6, 0, 0xc8955e))
  parts.push(box(1.6, 1.3, 1.4, 0, 3.33, 0.1, 0xf4f4f4))
  parts.push(box(1.64, 0.26, 1.44, 0, 3.2, 0.1, 0xd83a34))
  parts.push(box(1.2, 0.45, 0.04, 0, 3.6, -0.62, 0x2b3440))
  parts.push(painted(new THREE.ConeGeometry(1.35, 0.7, 4).rotateY(Math.PI / 4).translate(0, 4.33, 0.1), 0xd83a34))
  for (const x of [-0.35, 0.35]) parts.push(painted(new THREE.BoxGeometry(0.08, 2.9, 0.08).rotateX(-0.35).translate(x, 1.3, -1.4), 0xc8955e))
  for (let i = 0; i < 4; i++) parts.push(box(0.7, 0.06, 0.06, 0, 0.5 + i * 0.6, -1.85 + i * 0.21, 0xc8955e))
  parts.push(painted(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 4).translate(0.85, 5.2, 0.7), 0xdddddd))
  parts.push(box(0.6, 0.36, 0.03, 1.17, 5.85, 0.7, 0xd83a34))
  return assemble(parts)
}

function beachHut(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (const x of [-1.4, 1.4]) for (const z of [-1.4, 1.4]) parts.push(box(0.18, 0.9, 0.18, x, 0.45, z, 0x8a6440))
  parts.push(box(3.6, 0.2, 3.6, 0, 0.95, 0, 0xb8875a))
  parts.push(box(3, 2.1, 3, 0, 2.1, 0, 0xd9a86c))
  parts.push(box(0.8, 1.5, 0.05, 0, 1.8, -1.52, 0x6b4630))
  parts.push(box(0.7, 0.6, 0.05, 0.95, 2.3, -1.52, 0x2b3440))
  parts.push(box(0.7, 0.6, 0.05, -0.95, 2.3, -1.52, 0x2b3440))
  parts.push(painted(new THREE.ConeGeometry(3.0, 1.9, 4).rotateY(Math.PI / 4).translate(0, 4.1, 0), 0xd8b562))
  return assemble(parts)
}

function surfboard(): THREE.BufferGeometry {
  return faces(new THREE.SphereGeometry(1, 8, 6).scale(0.28, 1.15, 0.05).rotateX(0.12), (_, c) => (Math.abs(c.x) < 0.07 ? 0xd8d8d8 : 0xffffff))
}

function sailboat(): THREE.BufferGeometry {
  return assemble([
    hull(5.6, 1.7, 0.9, 0xf6f6f6, 0xc89a62, 0x2f6fb5),
    box(1, 0.45, 1.6, 0, 1.1, 0.7, 0xf6f6f6),
    painted(new THREE.CylinderGeometry(0.05, 0.06, 7, 5).translate(0, 4.3, -0.3), 0xdddddd),
    sheet([0, 1.4, -0.15], [0, 7.6, -0.28], [0, 1.4, 2.4], 0xffffff),
    sheet([0, 1.2, -0.5], [0, 7, -0.4], [0, 1.0, -2.7], 0xf4efe2),
  ])
}

function fishingBoat(): THREE.BufferGeometry {
  return assemble([
    hull(7.5, 2.4, 1.4, 0xc0392b, 0x9c7a56, 0x23303c),
    box(1.6, 1.4, 1.8, 0, 2.1, 1.6, 0xf2f2f2),
    box(1.62, 0.36, 1.82, 0, 2.4, 1.6, 0x2b3440),
    box(1.8, 0.12, 2.0, 0, 2.86, 1.6, 0x2f6fb5),
    painted(new THREE.CylinderGeometry(0.06, 0.07, 4.5, 5).translate(0, 3.4, -0.8), 0x5a4a3a),
    painted(new THREE.BoxGeometry(0.06, 0.06, 3).rotateX(0.6).translate(0, 3.6, -1.9), 0x5a4a3a),
    box(1.2, 0.5, 1, 0, 1.65, -1.8, 0xe0a030),
  ])
}

function ship(): THREE.BufferGeometry {
  const rng = makeRng(83)
  const parts = [
    hull(44, 8, 4.4, 0x1f3a5c, 0x6b7a86, 0xa8322c),
    box(7, 6, 5, 0, 7.4, 17, 0xf0f0f0),
    box(7.1, 0.6, 5.1, 0, 9.3, 17, 0x24303c),
    box(9, 0.4, 2, 0, 10.2, 15.5, 0xf0f0f0),
    box(2, 3, 2, 0, 11.6, 18.4, 0xd8473a),
  ]
  const colours = [0xd8473a, 0x2f7fd6, 0x2fae6a, 0xf0b23a, 0x8a5a9a, 0xe0e0e0, 0xd8473a, 0x2f7fd6]
  for (let bay = 0; bay < 4; bay++) {
    for (const x of [-2.5, 0, 2.5]) {
      const levels = 1 + Math.floor(rng() * 3)
      for (let level = 0; level < levels; level++) parts.push(box(2.4, 2.4, 5.8, x, 5.6 + level * 2.45, -12 + bay * 6.2, pick(rng, colours)))
    }
  }
  return assemble(parts)
}

function buoy(): THREE.BufferGeometry {
  return assemble([
    painted(new THREE.CylinderGeometry(0.35, 0.55, 0.9, 8).translate(0, 0.45, 0), 0xd83a34),
    painted(new THREE.CylinderGeometry(0.37, 0.4, 0.22, 8).translate(0, 0.75, 0), 0xf4f4f4),
    painted(new THREE.ConeGeometry(0.25, 0.7, 6).translate(0, 1.25, 0), 0xd83a34),
    painted(new THREE.IcosahedronGeometry(0.1, 0).translate(0, 1.65, 0), 0xffd24a),
  ])
}

function isletShape(seed: number): THREE.BufferGeometry {
  const sand = linear(0xe9d49a)
  const rock = linear(0xa89a84)
  const grass = linear(0x5aa84a)
  const dark = linear(0x468e3e)
  return mound(
    seed,
    (t) => Math.sin((t * Math.PI) / 2),
    (h, r, into) => {
      if (h < 0.22) into.copy(sand)
      else if (h < 0.42) into.copy(r < 0.5 ? rock : sand).lerp(grass, r * 0.3)
      else into.copy(r < 0.5 ? grass : dark)
    },
    { radial: 10, rings: 4, jitter: 0.25 }
  )
}

function lighthouse(): THREE.BufferGeometry {
  return assemble([
    painted(new THREE.CylinderGeometry(1.6, 1.8, 1.0, 10).translate(0, 0.5, 0), 0x9a9a9a),
    faces(new THREE.CylinderGeometry(0.9, 1.4, 10, 10, 5).translate(0, 6, 0), (_, c) => (Math.floor((c.y - 1) / 2) % 2 ? 0xa8323a : 0xf6f6f6)),
    painted(new THREE.CylinderGeometry(1.3, 1.3, 0.25, 10).translate(0, 11.1, 0), 0x2b2f38),
    painted(new THREE.CylinderGeometry(0.65, 0.65, 1.1, 8).translate(0, 11.8, 0), 0xffd24a),
    painted(new THREE.ConeGeometry(0.95, 0.9, 10).translate(0, 12.8, 0), 0xa8323a),
  ])
}

/** A plank jetty along x, on posts (planners sink it so the deck sits just above the water). */
function jetty(): THREE.BufferGeometry {
  const parts = [box(14, 0.2, 2.2, 0, 1.45, 0, 0xb48a5e)]
  for (let i = 0; i < 5; i++) for (const z of [-1, 1]) parts.push(box(0.22, 1.6, 0.22, -6.5 + i * 3.25, 0.8, z, 0x6b4e36))
  return assemble(parts)
}

function reeds(): THREE.BufferGeometry {
  const rng = makeRng(61)
  const greens = [0x6f9a3e, 0x86ad4a, 0x5c8a34]
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 14; i++) {
    const h = 1.4 + rng() * 1.1
    const a = rng() * Math.PI * 2
    const r = Math.sqrt(rng()) * 1.1
    const blade = new THREE.ConeGeometry(0.06, h, 3).translate(0, h / 2, 0).rotateX((rng() - 0.5) * 0.3).rotateZ((rng() - 0.5) * 0.3)
    parts.push(painted(blade.translate(Math.cos(a) * r, 0, Math.sin(a) * r), pick(rng, greens)))
    if (i < 5) parts.push(painted(new THREE.CylinderGeometry(0.07, 0.07, 0.35, 5).translate(Math.cos(a) * r, h * 0.78, Math.sin(a) * r), 0x6b4630))
  }
  return assemble(parts)
}

function lavaPool(): THREE.BufferGeometry {
  const rng = makeRng(71)
  const parts = [
    painted(new THREE.CircleGeometry(1.18, 14).rotateX(-Math.PI / 2), 0x2e2624),
    painted(new THREE.RingGeometry(0.84, 1.06, 14).rotateX(-Math.PI / 2).translate(0, 0.02, 0), 0xc8320c),
    painted(new THREE.CircleGeometry(0.9, 14).rotateX(-Math.PI / 2).translate(0, 0.04, 0), 0xff6a1a),
  ]
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2
    const r = rng() * 0.55
    parts.push(painted(new THREE.CircleGeometry(0.08 + rng() * 0.1, 5).rotateX(-Math.PI / 2).translate(Math.cos(a) * r, 0.06, Math.sin(a) * r), 0x3a2622))
  }
  return assemble(parts)
}

/** A tongue of lava, 1 × 1, along x (planners stretch it away from the road). */
function lavaFlow(): THREE.BufferGeometry {
  const rng = makeRng(73)
  const source = new THREE.PlaneGeometry(1, 1, 10, 3).rotateX(-Math.PI / 2)
  const pos = source.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    // Wavy edges, narrowing towards the tip at -x (nearest the road).
    const narrow = 0.55 + 0.45 * (x + 0.5)
    pos.setZ(i, z * narrow * (1 + (Math.abs(z) > 0.4 ? (rng() - 0.5) * 0.5 : 0)))
    pos.setY(i, Math.abs(z) > 0.4 ? 0 : 0.03)
  }
  return faces(source, (_, c) => {
    const roll = rng()
    if (Math.abs(c.z) > 0.3) return roll < 0.5 ? 0xc8320c : 0x3a2622
    return roll < 0.62 ? 0xff6a1a : roll < 0.84 ? 0xffa030 : 0x3a2622
  })
}

function cinderCone(seed: number, big: boolean): THREE.BufferGeometry {
  const lava = linear(0xff5a14)
  const streak = linear(0xff7a22)
  const scoria = linear(big ? 0x4a3a36 : 0x6a3a2c)
  const dark = linear(0x2e2a2a)
  const mid = linear(0x56463f)
  return mound(
    seed,
    (t) => (t > 0.97 ? 0.84 : big ? Math.pow(Math.min(1, t / 0.84), 1.5) : Math.min(1, Math.pow(t / 0.84, 0.9))),
    (h, r, into, top) => {
      if (top) into.copy(lava)
      else if (r < (big ? 0.07 : 0.05) && h > 0.3) into.copy(streak)
      else if (h > 0.8) into.copy(scoria)
      else into.copy(dark).lerp(mid, Math.min(1, h * 0.8 + r * 0.3))
    },
    { radial: big ? 14 : 10, rings: 6, jitter: 0.12 }
  )
}

function deadTree(): THREE.BufferGeometry {
  const rng = makeRng(67)
  const parts = [painted(new THREE.CylinderGeometry(0.12, 0.28, 5.5, 6).translate(0, 2.75, 0), 0x2f2826)]
  for (let i = 0; i < 4; i++) {
    const length = 1.4 + rng() * 1.2
    const branch = new THREE.CylinderGeometry(0.04, 0.1, length, 5)
      .translate(0, length / 2, 0)
      .rotateZ((i % 2 ? 1 : -1) * (0.6 + rng() * 0.5))
      .rotateY(rng() * Math.PI * 2)
      .translate(0, 2.6 + i * 0.6, 0)
    parts.push(painted(branch, 0x3d3230))
  }
  return assemble(parts)
}

function basalt(): THREE.BufferGeometry {
  const rng = makeRng(97)
  const parts: THREE.BufferGeometry[] = []
  const spots: Array<[number, number]> = [[0, 0], [1.1, 0.3], [-1, 0.5], [0.4, -1], [-0.6, -0.9], [1.4, -0.8], [-1.6, -0.2]]
  for (const [x, z] of spots) {
    const r = 0.45 + rng() * 0.25
    const h = 1.2 + rng() * 3.3
    parts.push(faces(new THREE.CylinderGeometry(r, r, h, 6), (_, c) => (c.y > h / 2 - 0.01 ? 0x5a5658 : rng() < 0.5 ? 0x383538 : 0x2f2d31)).translate(x, h / 2, z))
  }
  return assemble(parts)
}

// ── shapes for the new lands ─────────────────────────────────────────────────────

/** Moves every vertex of `source` by up to `amount` (keeps shared corners together). */
function jitter(source: THREE.BufferGeometry, seed: number, amount: number, keepBase = true): THREE.BufferGeometry {
  const rng = makeRng(seed)
  const pos = source.attributes.position
  const moved = new Map<string, [number, number, number]>()
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`
    let d = moved.get(key)
    if (!d) {
      d = [(rng() - 0.5) * amount, (rng() - 0.5) * amount, (rng() - 0.5) * amount]
      moved.set(key, d)
    }
    const base = keepBase && pos.getY(i) <= (source.boundingBox?.min.y ?? -Infinity) + 1e-3
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + (base ? 0 : d[1]), pos.getZ(i) + d[2])
  }
  return source
}

/** A random pick of the palette per face. */
const speckled = (source: THREE.BufferGeometry, seed: number, palette: readonly number[]): THREE.BufferGeometry => {
  const rng = makeRng(seed)
  return faces(source, () => pick(rng, palette))
}

const cyl = (top: number, bottom: number, h: number, seg: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry =>
  painted(new THREE.CylinderGeometry(top, bottom, h, seg).translate(x, y, z), hex)

const ball = (r: number, x: number, y: number, z: number, hex: number, detail = 0): THREE.BufferGeometry =>
  painted(new THREE.IcosahedronGeometry(r, detail).translate(x, y, z), hex)

// Ha Long ────────────────────────────────────────────────────────────────────────

function karst(seed: number): THREE.BufferGeometry {
  const stone = linear(LIMESTONE)
  const grey = linear(0xa9ada6)
  const streak = linear(0x7f857c)
  const green = linear(0x4f8f45)
  const deep = linear(0x3b7438)
  return mound(
    seed,
    (t) => Math.pow(t, 0.32),
    (h, r, into, top) => {
      if (top || h > 0.93 - r * 0.05) into.copy(r < 0.5 ? green : deep)
      else if (h > 0.25 && r < 0.2) into.copy(green).lerp(deep, r * 3)
      else if (r < 0.32) into.copy(streak)
      else into.copy(r < 0.66 ? grey : stone)
    },
    { radial: 9, rings: 6, jitter: 0.34, lean: 0.12 }
  )
}

function junk(): THREE.BufferGeometry {
  const parts = [
    hull(9, 2.6, 1.5, 0x6b4a32, 0x9c7a56, 0x3a2a20),
    box(2.4, 1.3, 2.4, 0, 2.1, 2.6, 0x7a5638),
    box(2.7, 0.18, 2.7, 0, 2.85, 2.6, 0x4a3426),
    box(1.6, 0.9, 0.06, 0, 2.2, 1.38, 0x2a2226),
  ]
  // Two masts, each with a battened fan of sail.
  for (const [z, h, w] of [[-1.4, 8.6, 3.4], [1.2, 7.2, 2.8]] as const) {
    parts.push(cyl(0.07, 0.09, h, 5, 0, 1.5 + h / 2, z, 0x4a3426))
    const foot = 2.0
    const head = 1.5 + h - 0.3
    const back = z + 0.2
    parts.push(sheet([0, foot, back], [0, head, back], [0, head - 0.4, back + w], 0xb8562e))
    parts.push(sheet([0, foot, back], [0, head - 0.4, back + w], [0, foot + 0.2, back + w * 0.9], 0xa84a26))
    for (let i = 1; i < 6; i++) {
      const y = foot + ((head - foot) * i) / 6
      parts.push(box(0.05, 0.06, w * (0.88 + i * 0.02), 0, y, back + (w * (0.88 + i * 0.02)) / 2, 0x3a2a20))
    }
  }
  return assemble(parts)
}

// Cherry blossom ─────────────────────────────────────────────────────────────────

function blossomTree(seed: number, palette: readonly number[], trunk: number, tall: number): THREE.BufferGeometry {
  const rng = makeRng(seed)
  const parts = [cyl(0.2, 0.36, tall, 6, 0, tall / 2, 0, trunk)]
  for (const a of [0.4, 2.5, 4.4]) {
    const branch = new THREE.CylinderGeometry(0.08, 0.14, 2, 5).translate(0, 1, 0).rotateZ(0.8).rotateY(a).translate(0, tall * 0.75, 0)
    parts.push(painted(branch, trunk))
  }
  const blobs: Array<[number, number, number, number]> = [[0, tall + 1.1, 0, 1.7], [1.4, tall + 0.4, 0.3, 1.3], [-1.3, tall + 0.5, -0.4, 1.35], [0.3, tall + 0.3, 1.4, 1.2], [-0.2, tall + 0.6, -1.4, 1.25]]
  for (const [x, y, z, r] of blobs) {
    const s = r * (0.85 + rng() * 0.3)
    parts.push(speckled(new THREE.IcosahedronGeometry(s, 0).scale(1, 0.78, 1).translate(x, y, z), seed + Math.floor(x * 10), palette))
  }
  return assemble(parts)
}

function torii(): THREE.BufferGeometry {
  const red = 0xd8402e
  const black = 0x2b2626
  const parts = [
    cyl(0.26, 0.3, 4.9, 8, -2.1, 2.45, 0, red),
    cyl(0.26, 0.3, 4.9, 8, 2.1, 2.45, 0, red),
    cyl(0.34, 0.34, 0.5, 8, -2.1, 0.25, 0, black),
    cyl(0.34, 0.34, 0.5, 8, 2.1, 0.25, 0, black),
    box(5.4, 0.34, 0.34, 0, 3.9, 0, red),
    box(0.3, 0.7, 0.3, 0, 4.4, 0, red),
    box(5.9, 0.34, 0.5, 0, 4.75, 0, red),
    box(5.2, 0.32, 0.66, 0, 5.08, 0, black),
  ]
  // The upswept ends of the top beam.
  for (const s of [-1, 1]) parts.push(painted(new THREE.BoxGeometry(1.2, 0.32, 0.66).rotateZ(s * 0.2).translate(s * 3.1, 5.2, 0), black))
  return assemble(parts)
}

function toro(): THREE.BufferGeometry {
  const stone = 0xb0aca4
  const dark = 0x8a867e
  return assemble([
    box(0.9, 0.25, 0.9, 0, 0.125, 0, dark),
    cyl(0.16, 0.2, 0.9, 6, 0, 0.7, 0, stone),
    box(0.7, 0.16, 0.7, 0, 1.22, 0, stone),
    box(0.52, 0.48, 0.52, 0, 1.54, 0, stone),
    box(0.3, 0.26, 0.54, 0, 1.56, 0, 0xffd27a),
    box(0.54, 0.26, 0.3, 0, 1.56, 0, 0xffd27a),
    painted(new THREE.ConeGeometry(0.72, 0.42, 4).rotateY(Math.PI / 4).translate(0, 1.99, 0), dark),
    ball(0.12, 0, 2.26, 0, stone),
  ])
}

function pagoda(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [box(6.2, 0.6, 6.2, 0, 0.3, 0, 0x8a867e)]
  let y = 0.6
  for (let i = 0; i < 5; i++) {
    const w = 4.6 - i * 0.5
    const h = i === 0 ? 1.9 : 1.3
    parts.push(box(w, h, w, 0, y + h / 2, 0, 0x9a3a2e))
    parts.push(box(w * 0.3, h * 0.6, 0.05, 0, y + h * 0.4, -w / 2 - 0.01, 0x2a2226))
    y += h
    parts.push(painted(new THREE.ConeGeometry(w * 0.98, 0.9, 4, 1, true).rotateY(Math.PI / 4).translate(0, y + 0.2, 0), 0x3a3a40))
    parts.push(box(w * 1.2, 0.14, w * 1.2, 0, y - 0.2, 0, 0x2f2f36))
    y += 0.25
  }
  parts.push(cyl(0.08, 0.14, 2.6, 6, 0, y + 1.3, 0, 0xd8a83a))
  for (let i = 0; i < 4; i++) parts.push(cyl(0.3, 0.3, 0.08, 8, 0, y + 0.5 + i * 0.45, 0, 0xd8a83a))
  return assemble(parts)
}

function fuji(seed: number): THREE.BufferGeometry {
  const low = linear(0x5c6d8e)
  const mid = linear(0x6f7fa0)
  const snow = linear(0xf4f7fb)
  return mound(
    seed,
    (t) => (t > 0.93 ? 0.96 : Math.pow(t / 0.93, 1.7) * 0.96),
    (h, r, into) => {
      if (h > 0.5 + r * 0.18) into.copy(snow)
      else into.copy(low).lerp(mid, Math.min(1, h + r * 0.4))
    },
    { radial: 16, rings: 7, jitter: 0.06 }
  )
}

// The waterfalls ─────────────────────────────────────────────────────────────────

function waterfall(): THREE.BufferGeometry {
  const rock = new THREE.BoxGeometry(16, 14, 8, 4, 4, 2).translate(0, 7, 2)
  rock.computeBoundingBox()
  const cliff = speckled(jitter(rock, 41, 1.6), 43, [0x7d7a72, 0x6e6b64, 0x8a877e, 0x5f7a4a])
  const rng = makeRng(47)
  const parts = [cliff]
  // The moss and the trees on top.
  parts.push(speckled(new THREE.BoxGeometry(16.5, 0.8, 8.5, 4, 1, 2).translate(0, 14.2, 2), 45, [0x4f8f45, 0x3f7a3a]))
  for (const x of [-6, -3.5, 4, 6.5]) parts.push(speckled(new THREE.IcosahedronGeometry(1.5 + rng(), 0).translate(x, 15.6, 2 + (rng() - 0.5) * 4), 49 + x, [0x3f7a3a, 0x4f8f45, 0x2f6a32]))
  // The fall: a sheet of streaming water down the face, foam at its foot.
  const fall = new THREE.PlaneGeometry(5, 13.6, 5, 10).translate(0, 7.4, -2.45)
  parts.push(faces(fall, (f) => ((Math.floor(f / 2) % 5) + Math.floor(rng() * 2)) % 3 === 0 ? 0xd8f0ff : rng() < 0.5 ? 0xa8d8f0 : 0xf6fbff))
  parts.push(faces(new THREE.PlaneGeometry(5.4, 0.9, 4, 1).rotateX(-0.5).translate(0, 14.1, -2.2), () => (rng() < 0.5 ? 0xe8f6ff : 0xc0e4f6)))
  for (let i = 0; i < 6; i++) parts.push(painted(new THREE.IcosahedronGeometry(0.9 + rng() * 0.7, 0).scale(1, 0.55, 1).translate(-2.6 + i * 1.05, 0.3, -3 - rng() * 1.2), 0xf6fbff))
  return assemble(parts)
}

function greenPeak(seed: number): THREE.BufferGeometry {
  const green = linear(0x4f8a48)
  const dark = linear(0x3e7040)
  const rock = linear(0x8a8a80)
  const mist = linear(0x7aa070)
  return mound(
    seed,
    (t) => Math.pow(t, 0.62),
    (h, r, into) => {
      if (r < 0.14 && h > 0.2) into.copy(rock)
      else into.copy(r < 0.55 ? green : dark).lerp(mist, Math.max(0, h - 0.6) * 0.6)
    },
    { radial: 11, rings: 6, jitter: 0.36, lean: 0.15 }
  )
}

// The savanna ────────────────────────────────────────────────────────────────────

function acacia(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed)
  const bark = 0x5a4434
  const lean = (rng() - 0.5) * 0.3
  const parts = [painted(new THREE.CylinderGeometry(0.14, 0.24, 4.4, 5).translate(0, 2.2, 0).rotateZ(lean), bark)]
  for (const a of [0.5, 2.6, 4.5]) parts.push(painted(new THREE.CylinderGeometry(0.06, 0.1, 2.2, 4).translate(0, 1.1, 0).rotateZ(0.9).rotateY(a + rng()).translate(-lean * 3.6, 3.7, 0), bark))
  const top = [0x7a8a3a, 0x6a7a30, 0x8a9a48]
  parts.push(speckled(new THREE.CylinderGeometry(3.2, 2.6, 0.7, 9).translate(-lean * 4.4, 5.1, 0), seed + 1, top))
  parts.push(speckled(new THREE.CylinderGeometry(1.9, 1.6, 0.5, 7).translate(-lean * 4.4 + 1.4, 4.7, 1.2), seed + 2, top))
  return assemble(parts)
}

function baobab(): THREE.BufferGeometry {
  const bark = [0x8a7466, 0x7a665a, 0x947e6e]
  const parts = [speckled(new THREE.CylinderGeometry(1.15, 1.7, 7, 9, 2).translate(0, 3.5, 0), 91, bark)]
  const rng = makeRng(93)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng() * 0.4
    parts.push(painted(new THREE.CylinderGeometry(0.12, 0.3, 2.4, 5).translate(0, 1.2, 0).rotateZ(0.7 + rng() * 0.4).rotateY(a).translate(0, 6.8, 0), 0x7a665a))
    parts.push(speckled(new THREE.IcosahedronGeometry(0.9, 0).scale(1, 0.6, 1).translate(Math.cos(a) * 1.9, 8.6, Math.sin(a) * 1.9), 95 + i, [0x6a8a3a, 0x5a7a30]))
  }
  return assemble(parts)
}

function giraffe(): THREE.BufferGeometry {
  const coat = [0xe8b45a, 0xe8b45a, 0x8a5a2e]
  const parts: THREE.BufferGeometry[] = [speckled(new THREE.BoxGeometry(1.0, 1.0, 2.0, 2, 2, 3).translate(0, 2.7, 0), 101, coat)]
  for (const x of [-0.35, 0.35]) for (const z of [-0.75, 0.75]) parts.push(box(0.18, 2.3, 0.18, x, 1.15, z, 0xd8a050))
  parts.push(speckled(new THREE.BoxGeometry(0.38, 2.6, 0.42, 1, 4, 1).translate(0, 1.3, 0).rotateX(-0.42).translate(0, 2.9, -0.8), 103, coat))
  parts.push(box(0.36, 0.38, 0.8, 0, 5.3, -1.95, 0xe8b45a))
  parts.push(box(0.26, 0.24, 0.3, 0, 5.2, -2.45, 0x8a5a2e))
  for (const x of [-0.12, 0.12]) parts.push(box(0.07, 0.3, 0.07, x, 5.62, -1.75, 0x5a3a22))
  parts.push(painted(new THREE.BoxGeometry(0.06, 1.1, 0.06).rotateX(0.3).translate(0, 2.5, 1.1), 0x5a3a22))
  return assemble(parts)
}

function elephant(): THREE.BufferGeometry {
  const grey = 0x8a8a90
  const dark = 0x76767c
  const parts = [
    painted(new THREE.SphereGeometry(1, 9, 6).scale(1.3, 1.15, 1.9).translate(0, 2.4, 0.2), grey),
    painted(new THREE.SphereGeometry(0.85, 8, 6).translate(0, 2.9, -1.85), grey),
  ]
  for (const x of [-0.65, 0.65]) for (const z of [-0.9, 1.1]) parts.push(cyl(0.34, 0.38, 1.7, 7, x, 0.85, z, dark))
  for (const s of [-1, 1]) parts.push(painted(new THREE.BoxGeometry(0.12, 1.4, 1.1).rotateY(s * 0.5).translate(s * 0.95, 2.9, -1.5), dark))
  parts.push(painted(new THREE.CylinderGeometry(0.14, 0.3, 1.9, 6).translate(0, -0.95, 0).rotateX(0.25).translate(0, 2.6, -2.55), grey))
  for (const s of [-1, 1]) parts.push(painted(new THREE.ConeGeometry(0.08, 0.9, 5).rotateX(-1.9).translate(s * 0.4, 2.3, -2.55), 0xf2ead8))
  parts.push(painted(new THREE.CylinderGeometry(0.04, 0.06, 0.9, 4).rotateX(-0.4).translate(0, 2.4, 2.25), dark))
  return assemble(parts)
}

// The lost temple and the jungle ─────────────────────────────────────────────────

const TEMPLE_STONE = [0x8a7a62, 0x7d705c, 0x6a7a4a, 0x948468]

function prang(): THREE.BufferGeometry {
  const parts = [speckled(new THREE.BoxGeometry(8, 1.2, 8, 2, 1, 2).translate(0, 0.6, 0), 111, TEMPLE_STONE)]
  parts.push(speckled(new THREE.BoxGeometry(5, 3.6, 5, 2, 2, 2).translate(0, 3, 0), 112, TEMPLE_STONE))
  parts.push(box(1.2, 2.2, 0.1, 0, 2.3, -2.52, 0x2a2622))
  let y = 4.8
  for (let i = 0; i < 6; i++) {
    const r = 2.9 - i * 0.42
    const h = 1.05 - i * 0.05
    parts.push(speckled(new THREE.CylinderGeometry(r * 0.86, r, h, 8).translate(0, y + h / 2, 0), 113 + i, TEMPLE_STONE))
    y += h
  }
  parts.push(speckled(new THREE.ConeGeometry(0.62, 2.2, 8).translate(0, y + 1.1, 0), 120, TEMPLE_STONE))
  return assemble(parts)
}

function templeGate(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (const x of [-3.3, 3.3]) {
    parts.push(speckled(new THREE.BoxGeometry(2.6, 6, 2.6, 1, 3, 1).translate(x, 3, 0), 131 + x, TEMPLE_STONE))
    let y = 6
    for (let i = 0; i < 4; i++) {
      const r = 1.7 - i * 0.32
      parts.push(speckled(new THREE.CylinderGeometry(r * 0.85, r, 0.8, 8).translate(x, y + 0.4, 0), 133 + i, TEMPLE_STONE))
      y += 0.8
    }
    parts.push(painted(new THREE.ConeGeometry(0.38, 1.4, 8).translate(x, y + 0.7, 0), 0x7d705c))
  }
  parts.push(speckled(new THREE.BoxGeometry(4.2, 1.6, 2.2, 2, 1, 1).translate(0, 5.2, 0), 139, TEMPLE_STONE))
  parts.push(speckled(new THREE.BoxGeometry(2.2, 1.6, 1.6).translate(0, 6.8, 0), 140, TEMPLE_STONE))
  parts.push(painted(new THREE.ConeGeometry(0.9, 1.6, 8).translate(0, 8.4, 0), 0x7d705c))
  // Vines down the towers.
  for (const x of [-4.4, -2.4, 2.5, 4.3]) parts.push(box(0.12, 3.4, 0.12, x, 3.6, -1.34, 0x4f8a3a))
  return assemble(parts)
}

function stupa(): THREE.BufferGeometry {
  const white = 0xd8d0c0
  return assemble([
    box(7, 0.8, 7, 0, 0.4, 0, 0xb8b0a0),
    box(5.6, 0.8, 5.6, 0, 1.2, 0, white),
    painted(new THREE.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.6, 0), white),
    box(1.4, 0.8, 1.4, 0, 4.4, 0, 0xc8c0b0),
    painted(new THREE.ConeGeometry(0.7, 4.2, 8).translate(0, 6.9, 0), 0xd8a83a),
  ])
}

function giantTree(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed)
  const bark = [0x5a4a3c, 0x4e4034, 0x665446]
  const parts = [speckled(new THREE.CylinderGeometry(1.0, 1.6, 10, 8, 2).translate(0, 5, 0), seed, bark)]
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng() * 0.5
    parts.push(painted(new THREE.BoxGeometry(0.3, 3.2, 2.2).translate(0, 1.6, 1.4).rotateY(a), 0x4e4034))
  }
  const leaves = [0x2f5a2a, 0x3a6a30, 0x2a4f26]
  parts.push(speckled(new THREE.IcosahedronGeometry(5.4, 0).scale(1, 0.4, 1).translate(0, 11, 0), seed + 1, leaves))
  parts.push(speckled(new THREE.IcosahedronGeometry(3.6, 0).scale(1, 0.5, 1).translate(1, 13, -0.6), seed + 2, leaves))
  parts.push(speckled(new THREE.IcosahedronGeometry(2.4, 0).scale(1, 0.6, 1).translate(-2.6, 9.6, 1.8), seed + 3, leaves))
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2
    const r = 2.4 + rng() * 2.4
    const h = 2.5 + rng() * 4
    parts.push(box(0.08, h, 0.08, Math.cos(a) * r, 10 - h / 2, Math.sin(a) * r, 0x4f7a32))
  }
  return assemble(parts)
}

function bamboo(): THREE.BufferGeometry {
  const rng = makeRng(141)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2
    const r = Math.sqrt(rng()) * 1.3
    const h = 6 + rng() * 3.5
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const lean = (rng() - 0.5) * 0.12
    parts.push(faces(new THREE.CylinderGeometry(0.09, 0.11, h, 5, 6).translate(0, h / 2, 0).rotateZ(lean).translate(x, 0, z), (f) => (Math.floor(f / 10) % 2 ? 0x7aa040 : 0x6a9036)))
    parts.push(painted(new THREE.ConeGeometry(0.7, 2, 5).translate(x - lean * h, h - 0.4, z), pick(rng, [0x5f9a3a, 0x72aa44])))
  }
  return assemble(parts)
}

// The floating market and the terraces ───────────────────────────────────────────

function stiltHouse(wall: number, roof: number, posts: number, lanterns: boolean): THREE.BufferGeometry {
  const wood = 0x5a4030
  const parts: THREE.BufferGeometry[] = []
  for (const x of [-2.6, 0, 2.6]) for (const z of [-2.2, 2.2]) parts.push(box(0.22, posts, 0.22, x, posts / 2, z, wood))
  parts.push(box(6.2, 0.25, 5.2, 0, posts, 0, 0x7a5a40))
  parts.push(box(5.2, 2.3, 3.4, 0, posts + 1.27, 0.6, wall))
  parts.push(box(0.9, 1.6, 0.06, 0, posts + 0.92, -1.12, 0x2a2226))
  for (const x of [-1.7, 1.7]) parts.push(box(0.8, 0.6, 0.06, x, posts + 1.5, -1.12, lanterns ? 0xffc860 : 0x2a2226))
  // The roof: two pitched slabs and the gables.
  const top = posts + 2.4
  for (const s of [-1, 1]) parts.push(painted(new THREE.BoxGeometry(6.4, 0.16, 3.3).rotateX(s * 0.5).translate(0, top + 0.42, 0.6 + s * 1.45), roof))
  for (const x of [-2.6, 2.6]) parts.push(sheet([x, top - 0.02, -0.85], [x, top - 0.02, 2.05], [x, top + 0.8, 0.6], wall))
  // The veranda rail to the front.
  parts.push(box(6, 0.1, 0.1, 0, posts + 0.9, -2.5, wood))
  for (const x of [-2.9, -1.4, 1.4, 2.9]) parts.push(box(0.1, 0.9, 0.1, x, posts + 0.45, -2.5, wood))
  if (lanterns) for (const x of [-2.4, -0.8, 0.8, 2.4]) {
    parts.push(box(0.03, 0.4, 0.03, x, top - 0.15, -1.3, 0x2a2226))
    parts.push(painted(new THREE.SphereGeometry(0.26, 6, 4).scale(1, 1.3, 1).translate(x, top - 0.6, -1.3), 0xff4a2a))
  }
  return assemble(parts)
}

function marketBoat(seed: number, canopy: boolean): THREE.BufferGeometry {
  const rng = makeRng(seed)
  const parts = [hull(6, 1.5, 0.6, 0x6a4a32, 0x8a6a48, 0x3a2a20)]
  const fruit = seed % 2 ? [0xf08a24, 0xf2d040, 0x6ab040, 0xd83a2a] : [0x3e8a3a, 0xe86a2a, 0xf2d040, 0x8a3aa0]
  for (let i = 0; i < 16; i++) parts.push(ball(0.2 + rng() * 0.12, (rng() - 0.5) * 0.9, 0.75 + rng() * 0.35, -1.4 + rng() * 2.4, pick(rng, fruit)))
  if (canopy) parts.push(painted(new THREE.CylinderGeometry(0.75, 0.75, 1.6, 8, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(0, 0.9, 1.3), 0x3a5a3a))
  // The rower, standing at the stern in a conical hat.
  parts.push(box(0.4, 0.75, 0.3, 0, 1.0, 2.4, seed % 2 ? 0x3a6ab8 : 0xd8d0b8))
  parts.push(box(0.3, 0.55, 0.26, 0, 0.42, 2.4, 0x2a2a30))
  parts.push(ball(0.17, 0, 1.55, 2.4, 0xd8a880))
  parts.push(painted(new THREE.ConeGeometry(0.5, 0.3, 10).translate(0, 1.75, 2.4), 0xe8d8a0))
  parts.push(painted(new THREE.BoxGeometry(0.06, 0.06, 2.6).rotateX(0.7).translate(0.35, 0.9, 2.8), 0x8a6a48))
  return assemble(parts)
}

function terrace(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed)
  const parts: THREE.BufferGeometry[] = []
  const levels = 6
  const rice = seed % 2 ? [0x8ac040, 0x9ad04a, 0x7ab038] : [0xd8c040, 0xc8b438, 0x9ac040]
  for (let i = 0; i < levels; i++) {
    const r = 1 - i * 0.13
    const h = 1 / levels
    const step = new THREE.CylinderGeometry(r, r, h, 12, 1)
    const pos = step.attributes.position
    for (let k = 0; k < pos.count; k++) {
      const a = Math.atan2(pos.getZ(k), pos.getX(k))
      const wobble = 1 + Math.sin(a * 3 + seed + i) * 0.06 + Math.sin(a * 5 + i * 2) * 0.04
      pos.setXYZ(k, pos.getX(k) * wobble, pos.getY(k), pos.getZ(k) * wobble)
    }
    step.translate(0, i * h + h / 2, 0)
    const top = i * h + h - 1e-3
    parts.push(faces(step, (_, c) => (c.y > top ? pick(rng, rice) : rng() < 0.3 ? 0x6a8a3a : 0x7a5a3a)))
  }
  return assemble(parts)
}

// The windy coast ────────────────────────────────────────────────────────────────

function sheep(): THREE.BufferGeometry {
  const parts = [painted(new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.85, 1.4).translate(0, 0.78, 0), 0xf2f0e8)]
  parts.push(box(0.28, 0.32, 0.42, 0, 0.92, -0.78, 0x2a2a2a))
  for (const x of [-0.2, 0.2]) for (const z of [-0.4, 0.4]) parts.push(box(0.09, 0.4, 0.09, x, 0.2, z, 0x2a2a2a))
  for (const s of [-1, 1]) parts.push(box(0.16, 0.06, 0.1, s * 0.2, 1.02, -0.66, 0x2a2a2a))
  return assemble(parts)
}

// The future city ────────────────────────────────────────────────────────────────

const LIGHT_CYAN = 0x40f0ff

function glassTower(): THREE.BufferGeometry {
  const parts = [faces(new THREE.BoxGeometry(8, 38, 8, 2, 12, 2).translate(0, 19, 0), (f, c) => ((Math.floor(c.y / 3.2) + f) % 3 ? 0x7ea8c8 : 0x5f86a6))]
  for (let y = 5; y < 37; y += 6) parts.push(box(8.3, 0.36, 8.3, 0, y, 0, LIGHT_CYAN))
  parts.push(box(5, 4, 5, 0, 40, 0, 0x8fb8d0))
  parts.push(cyl(0.12, 0.2, 7, 5, 0, 45.5, 0, 0xd8dce4))
  parts.push(ball(0.35, 0, 49, 0, LIGHT_CYAN))
  return assemble(parts)
}

function twistTower(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 14; i++) {
    const w = 7 - i * 0.16
    parts.push(faces(new THREE.BoxGeometry(w, 2.8, w).rotateY(i * 0.13).translate(0, 1.4 + i * 3, 0), (f) => (f % 4 < 2 ? 0x8fb8d0 : 0x6f98b8)))
    parts.push(painted(new THREE.BoxGeometry(w + 0.3, 0.22, w + 0.3).rotateY(i * 0.13).translate(0, i * 3 + 2.9, 0), i % 3 === 0 ? LIGHT_CYAN : 0xd8dce4))
  }
  parts.push(painted(new THREE.ConeGeometry(2.6, 6, 4).rotateY(14 * 0.13 + Math.PI / 4).translate(0, 45, 0), 0xd8dce4))
  return assemble(parts)
}

function lightPost(): THREE.BufferGeometry {
  return assemble([
    cyl(0.3, 0.36, 0.3, 8, 0, 0.15, 0, 0x8a909a),
    cyl(0.08, 0.1, 5, 6, 0, 2.6, 0, 0xd8dce4),
    box(1.6, 0.18, 0.3, 0.6, 5.1, 0, 0xd8dce4),
    box(1.3, 0.1, 0.32, 0.75, 5.0, 0, LIGHT_CYAN),
  ])
}

function lightRing(): THREE.BufferGeometry {
  return assemble([
    painted(new THREE.TorusGeometry(4.4, 0.32, 6, 28).translate(0, 4.9, 0), LIGHT_CYAN),
    painted(new THREE.TorusGeometry(4.0, 0.12, 4, 28).translate(0, 4.9, 0), 0xd8dce4),
    box(1.6, 0.5, 1.6, 0, 0.25, 0, 0x8a909a),
  ])
}

function rocket(): THREE.BufferGeometry {
  const parts = [box(9, 1, 9, 0, 0.5, 0, 0x8a909a), box(9.2, 0.1, 9.2, 0, 1.02, 0, 0xf0c030)]
  parts.push(faces(new THREE.CylinderGeometry(1.2, 1.2, 14, 10, 4).translate(0, 8.5, 0), (_, c) => (c.y > 11 && c.y < 12.5 ? 0x2b2f38 : 0xf2f2f2)))
  parts.push(painted(new THREE.ConeGeometry(1.2, 3.4, 10).translate(0, 17.2, 0), 0xd83a34))
  for (let i = 0; i < 4; i++) parts.push(painted(new THREE.BoxGeometry(0.12, 2.4, 1.4).translate(0, 2.7, 1.5).rotateY((i * Math.PI) / 2), 0xd83a34))
  parts.push(box(1, 19, 1, 3.4, 10.5, 0, 0xc0392b))
  for (let y = 4; y < 19; y += 4) parts.push(box(2.4, 0.25, 0.25, 2.3, y, 0, 0x8a909a))
  parts.push(ball(0.3, 3.4, 20.3, 0, LIGHT_CYAN))
  return assemble(parts)
}

function biodome(): THREE.BufferGeometry {
  const parts = [cyl(6.4, 6.6, 0.6, 16, 0, 0.3, 0, 0x8a909a)]
  const rng = makeRng(151)
  for (let i = 0; i < 6; i++) parts.push(ball(1 + rng() * 0.8, (rng() - 0.5) * 6, 1.8 + rng(), (rng() - 0.5) * 6, pick(rng, [0x4f9a45, 0x5aa84a, 0x3e8a3a])))
  parts.push(faces(new THREE.SphereGeometry(6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.6, 0), (f) => (f % 5 === 0 ? 0xe8eef2 : 0xa8d8e8)))
  return assemble(parts)
}

// The haunted wood ───────────────────────────────────────────────────────────────

function graves(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const x = (i % 3) * 1.8 - 1.8 + (rng() - 0.5) * 0.5
    const z = Math.floor(i / 3) * 2.4 - 1.2 + (rng() - 0.5) * 0.4
    const tilt = (rng() - 0.5) * 0.3
    const stone = pick(rng, [0x8a8a92, 0x7a7a84, 0x9a9aa2])
    if (rng() < 0.35) {
      parts.push(painted(new THREE.BoxGeometry(0.16, 1.4, 0.16).translate(0, 0.7, 0).rotateZ(tilt).translate(x, 0, z), stone))
      parts.push(painted(new THREE.BoxGeometry(0.7, 0.16, 0.16).translate(0, 1.0, 0).rotateZ(tilt).translate(x, 0, z), stone))
    } else {
      parts.push(painted(new THREE.BoxGeometry(0.75, 0.8, 0.18).translate(0, 0.4, 0).rotateZ(tilt).translate(x, 0, z), stone))
      parts.push(painted(new THREE.CylinderGeometry(0.375, 0.375, 0.18, 8, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0.8, 0).rotateZ(tilt).translate(x, 0, z), stone))
    }
    parts.push(box(0.8, 0.14, 1.5, x, 0.07, z + 0.9, 0x3a3428))
  }
  return assemble(parts)
}

function jackLantern(): THREE.BufferGeometry {
  const rng = makeRng(161)
  return assemble([
    faces(new THREE.SphereGeometry(0.62, 10, 6).scale(1, 0.72, 1).translate(0, 0.45, 0), () => (rng() < 0.5 ? 0xf08a24 : 0xd8701a)),
    cyl(0.06, 0.09, 0.3, 5, 0, 0.98, 0, 0x4a6a2a),
    sheet([-0.32, 0.56, -0.62], [-0.1, 0.56, -0.64], [-0.21, 0.74, -0.6], 0xffe060),
    sheet([0.1, 0.56, -0.64], [0.32, 0.56, -0.62], [0.21, 0.74, -0.6], 0xffe060),
    box(0.5, 0.1, 0.04, 0, 0.32, -0.6, 0xffe060),
  ])
}

function hauntedHouse(): THREE.BufferGeometry {
  const wall = 0x4a4452
  const roof = 0x2a2630
  const lit = 0xffc860
  const dark = 0x1a1a22
  const parts = [
    box(7, 0.6, 6, 0, 0.3, 0, 0x3a3640),
    box(6.4, 6, 5.4, 0, 3.6, 0, wall),
    painted(new THREE.ConeGeometry(5.2, 3.6, 4).rotateY(Math.PI / 4).scale(1, 1, 0.86).translate(0, 8.4, 0), roof),
    box(2.8, 4, 2.8, 2.2, 8.4, 0.8, 0x524a5a),
    painted(new THREE.ConeGeometry(2.4, 4.4, 4).rotateY(Math.PI / 4).translate(2.2, 12.6, 0.8), roof),
    painted(new THREE.BoxGeometry(0.7, 3, 0.7).rotateZ(0.12).translate(-2.1, 9.6, 1), 0x3a3238),
    box(1.2, 2.2, 0.08, 0, 1.7, -2.72, dark),
    box(3.4, 0.2, 1.6, 0, 3, -3.4, roof),
  ]
  const windows: Array<[number, number, boolean]> = [[-2, 2.5, true], [2, 2.5, false], [-2, 5, false], [0, 5, true], [2, 5, true]]
  for (const [x, y, on] of windows) parts.push(box(0.9, 1.1, 0.08, x, y, -2.72, on ? lit : dark))
  parts.push(box(0.9, 1.1, 0.08, 2.2, 8.6, -0.62, lit))
  for (const x of [-1.5, 1.5]) parts.push(box(0.16, 2.2, 0.16, x, 1.7, -4.1, 0x3a3238))
  return assemble(parts)
}

function ghost(): THREE.BufferGeometry {
  const sheetCol = 0xeef2ff
  return assemble([
    painted(new THREE.SphereGeometry(0.5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.2, 0), sheetCol),
    faces(new THREE.CylinderGeometry(0.5, 0.72, 1.2, 8, 1, true).translate(0, 0.6, 0), () => sheetCol),
    painted(new THREE.CylinderGeometry(0.5, 0.72, 1.2, 8, 1, true).scale(-1, 1, 1).translate(0, 0.6, 0), 0xc8cce0),
    box(0.12, 0.18, 0.05, -0.16, 1.32, -0.47, 0x1a1a22),
    box(0.12, 0.18, 0.05, 0.16, 1.32, -0.47, 0x1a1a22),
    box(0.16, 0.14, 0.05, 0, 1.06, -0.5, 0x1a1a22),
  ])
}

function castle(): THREE.BufferGeometry {
  const stone = [0x5a5668, 0x4e4a5c, 0x625e70]
  const roof = 0x2e2840
  const lit = 0xffc860
  const parts = [speckled(new THREE.BoxGeometry(14, 9, 10, 3, 2, 2).translate(0, 4.5, 0), 171, stone)]
  for (let i = 0; i < 6; i++) parts.push(box(1.2, 1.2, 10.2, -6.4 + i * 2.56, 9.6, 0, 0x4e4a5c))
  for (const [x, z, h] of [[-7, -5, 15], [7, -5, 13], [-7, 5, 12], [7, 5, 16]] as const) {
    parts.push(speckled(new THREE.CylinderGeometry(1.8, 2, h, 8).translate(x, h / 2, z), 173 + h, stone))
    parts.push(painted(new THREE.ConeGeometry(2.3, 4.4, 8).translate(x, h + 2.2, z), roof))
    parts.push(box(0.6, 1, 0.08, x, h - 2.5, z - 1.95, lit))
  }
  parts.push(speckled(new THREE.BoxGeometry(4, 9, 4).translate(0, 13, 1), 179, stone))
  parts.push(painted(new THREE.ConeGeometry(3.4, 6, 4).rotateY(Math.PI / 4).translate(0, 20.5, 1), roof))
  for (const x of [-4, -1.5, 1.5, 4]) parts.push(box(0.8, 1.3, 0.08, x, 5.5, -5.04, lit))
  parts.push(box(0.9, 1.3, 0.08, 0, 14, -1.04, lit))
  parts.push(box(2.6, 3.6, 0.08, 0, 1.8, -5.04, 0x1a1a22))
  return assemble(parts)
}

// The frozen lake ────────────────────────────────────────────────────────────────

function igloo(): THREE.BufferGeometry {
  return assemble([
    faces(new THREE.SphereGeometry(2.2, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), (f) => (f % 3 ? 0xf2f8ff : 0xd8e6f2)),
    faces(new THREE.CylinderGeometry(0.85, 0.85, 1.6, 8, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(0, 0, -2.3), (f) => (f % 2 ? 0xf2f8ff : 0xdce8f2)),
    box(0.9, 0.9, 0.05, 0, 0.45, -3.12, 0x2a3440),
  ])
}

function iceCrystal(): THREE.BufferGeometry {
  const rng = makeRng(181)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const h = 1.2 + rng() * 2.2
    const r = 0.25 + rng() * 0.25
    const a = rng() * Math.PI * 2
    const d = i === 0 ? 0 : 0.4 + rng() * 0.6
    const spike = new THREE.ConeGeometry(r, h, 6).translate(0, h / 2, 0).rotateZ(i === 0 ? 0 : (rng() - 0.5) * 0.9).rotateX(i === 0 ? 0 : (rng() - 0.5) * 0.9)
    parts.push(faces(spike.translate(Math.cos(a) * d, 0, Math.sin(a) * d), () => (rng() < 0.5 ? 0xa8eeff : 0xd8f8ff)))
  }
  return assemble(parts)
}

function iceHut(): THREE.BufferGeometry {
  return assemble([
    box(0.2, 0.15, 2.6, -1.0, 0.08, 0, 0x5a4030),
    box(0.2, 0.15, 2.6, 1.0, 0.08, 0, 0x5a4030),
    box(2.4, 2.1, 2.2, 0, 1.2, 0, 0xc83a2e),
    painted(new THREE.BoxGeometry(2.7, 0.18, 1.5).rotateX(0.45).translate(0, 2.55, 0.55), 0xf2f6fa),
    painted(new THREE.BoxGeometry(2.7, 0.18, 1.5).rotateX(-0.45).translate(0, 2.55, -0.55), 0xf2f6fa),
    box(0.7, 1.4, 0.05, -0.4, 0.95, -1.12, 0x3a2a24),
    box(0.5, 0.45, 0.05, 0.6, 1.5, -1.12, 0xffd27a),
    cyl(0.1, 0.1, 1, 5, 0.8, 2.9, 0.4, 0x3a3a40),
  ])
}

// The flower farm ────────────────────────────────────────────────────────────────

function barn(): THREE.BufferGeometry {
  const red = 0xb8322a
  const roof = 0x4a4a4e
  const trim = 0xf2f0ea
  const parts = [box(8, 5, 10, 0, 2.5, 0, red)]
  for (const s of [-1, 1]) {
    parts.push(painted(new THREE.BoxGeometry(2.6, 0.2, 10.4).rotateZ(s * -1.0).translate(s * 3.6, 6.0, 0), roof))
    parts.push(painted(new THREE.BoxGeometry(2.6, 0.2, 10.4).rotateZ(s * -0.38).translate(s * 1.3, 7.6, 0), roof))
  }
  parts.push(painted(new THREE.CylinderGeometry(4, 4, 9.98, 4, 1).rotateY(Math.PI / 4).rotateX(Math.PI / 2).scale(1, 0.62, 1).translate(0, 5.0, 0), red))
  parts.push(box(3, 3.6, 0.08, 0, 1.8, -5.02, 0x8a2620))
  parts.push(painted(new THREE.BoxGeometry(0.2, 4.4, 0.1).rotateZ(0.7).translate(0, 1.8, -5.08), trim))
  parts.push(painted(new THREE.BoxGeometry(0.2, 4.4, 0.1).rotateZ(-0.7).translate(0, 1.8, -5.08), trim))
  parts.push(box(3.2, 0.2, 0.1, 0, 3.6, -5.08, trim))
  parts.push(box(1.2, 1, 0.08, 0, 5.6, -5.02, trim))
  return assemble(parts)
}

function silo(): THREE.BufferGeometry {
  return assemble([
    faces(new THREE.CylinderGeometry(1.8, 1.8, 10, 12, 5).translate(0, 5, 0), (_, c) => (Math.floor(c.y / 2) % 2 ? 0xd8d8d0 : 0xc4c6c0)),
    painted(new THREE.SphereGeometry(1.85, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 10, 0), 0x8a9aa8),
  ])
}

function dutchMill(): THREE.BufferGeometry {
  const parts = [
    faces(new THREE.CylinderGeometry(1.7, 2.7, 9, 8, 3).translate(0, 4.5, 0), (_, c) => (c.y < 3 ? 0x9a5a3a : 0xe8e0d0)),
    painted(new THREE.ConeGeometry(2.1, 2.4, 8).translate(0, 10.2, 0), 0x4a3a32),
    box(0.8, 1.6, 0.08, 0, 0.8, -2.62, 0x4a3426),
    box(0.6, 0.6, 0.08, 0, 5.5, -2.15, 0x2a3440),
    cyl(0.35, 0.35, 0.8, 6, 0, 0, 0, 0x4a3426).rotateX(Math.PI / 2).translate(0, 8.8, -2.2),
  ]
  // Four lattice sails on the -z face.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4
    const arm = new THREE.BoxGeometry(0.2, 5.6, 0.12).translate(0, 2.9, 0).rotateZ(a)
    parts.push(painted(arm.translate(0, 8.8, -2.65), 0x6b4a32))
    const sail = new THREE.BoxGeometry(1.1, 4.4, 0.05).translate(0.65, 3.3, 0).rotateZ(a)
    parts.push(painted(sail.translate(0, 8.8, -2.7), 0xf2ead8))
  }
  return assemble(parts)
}

function sunflowers(): THREE.BufferGeometry {
  const rng = makeRng(191)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 14; i++) {
    const x = (rng() - 0.5) * 1.6
    const z = -2.6 + (i / 13) * 5.2 + (rng() - 0.5) * 0.3
    const h = 1.8 + rng() * 0.8
    parts.push(cyl(0.04, 0.06, h, 4, x, h / 2, z, 0x4f7a2a))
    parts.push(painted(new THREE.BoxGeometry(0.5, 0.05, 0.22).rotateZ(0.4).translate(x + 0.2, h * 0.5, z), 0x5a8a30))
    parts.push(painted(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 10).rotateX(Math.PI / 2 - 0.25).translate(x, h + 0.1, z), 0xf8c820))
    parts.push(painted(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8).rotateX(Math.PI / 2 - 0.25).translate(x, h + 0.1, z), 0x6a3a1a))
  }
  return assemble(parts)
}

function cow(): THREE.BufferGeometry {
  const rng = makeRng(197)
  const parts = [faces(new THREE.BoxGeometry(0.95, 0.85, 1.9, 2, 2, 3).translate(0, 1.15, 0), () => (rng() < 0.4 ? 0x2a2a2e : 0xf4f2ee))]
  for (const x of [-0.32, 0.32]) for (const z of [-0.7, 0.7]) parts.push(box(0.18, 0.75, 0.18, x, 0.38, z, 0xe8e6e2))
  parts.push(box(0.55, 0.55, 0.6, 0, 1.45, -1.15, 0xf4f2ee))
  parts.push(box(0.5, 0.26, 0.2, 0, 1.28, -1.5, 0xf0b4b0))
  for (const s of [-1, 1]) parts.push(box(0.26, 0.08, 0.08, s * 0.36, 1.78, -1.05, 0xe8e0c8))
  parts.push(box(0.3, 0.2, 0.4, 0, 0.66, 0.4, 0xf0b4b0))
  return assemble(parts)
}

function tractor(): THREE.BufferGeometry {
  return assemble([
    box(1.3, 0.9, 2.6, 0, 1.2, -0.3, 0x3a8a3a),
    box(1.3, 1.3, 1.1, 0, 2.2, 0.6, 0x3a8a3a),
    box(1.32, 0.7, 1.12, 0, 2.3, 0.6, 0x2a3440),
    box(1.4, 0.12, 1.3, 0, 2.9, 0.6, 0xf2d040),
    cyl(0.95, 0.95, 0.5, 12, 0, 0, 0, 0x2a2a2e).rotateZ(Math.PI / 2).translate(0.95, 0.95, 0.7),
    cyl(0.95, 0.95, 0.5, 12, 0, 0, 0, 0x2a2a2e).rotateZ(Math.PI / 2).translate(-0.95, 0.95, 0.7),
    cyl(0.5, 0.5, 0.36, 10, 0, 0, 0, 0x2a2a2e).rotateZ(Math.PI / 2).translate(0.8, 0.5, -1.2),
    cyl(0.5, 0.5, 0.36, 10, 0, 0, 0, 0x2a2a2e).rotateZ(Math.PI / 2).translate(-0.8, 0.5, -1.2),
    cyl(0.08, 0.08, 1, 5, 0.35, 2.1, -1.1, 0x3a3a40),
  ])
}

// The red canyon ─────────────────────────────────────────────────────────────────

const CANYON_BANDS = [0xc8583a, 0xe07a4a, 0xb04a30, 0xe8b080, 0xd0643c]

function mesa(seed: number): THREE.BufferGeometry {
  const top = linear(0xb86a44)
  const band = CANYON_BANDS.map(linear)
  return mound(
    seed,
    (t) => (t < 0.32 ? Math.pow(t / 0.32, 0.55) : 1),
    (h, r, into, last) => {
      if (last || h > 0.985) into.copy(top)
      else into.copy(band[Math.floor(h * 7 + r * 0.6) % band.length])
    },
    { radial: 12, rings: 6, jitter: 0.22 }
  )
}

function rockArch(): THREE.BufferGeometry {
  const rng = makeRng(201)
  const arc = new THREE.TorusGeometry(4.6, 1.3, 5, 12, Math.PI)
  return assemble([
    faces(jitter(arc, 203, 0.5, false), () => pick(rng, CANYON_BANDS.slice(0, 3))),
    speckled(new THREE.IcosahedronGeometry(1.9, 0).scale(1, 0.7, 1.1).translate(-4.6, 0.4, 0), 205, CANYON_BANDS),
    speckled(new THREE.IcosahedronGeometry(2.1, 0).scale(1, 0.7, 1.1).translate(4.6, 0.4, 0), 207, CANYON_BANDS),
  ])
}

function hoodoo(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed)
  const parts: THREE.BufferGeometry[] = []
  let y = 0
  for (let i = 0; i < 4; i++) {
    const r = 1.3 - i * 0.18 + rng() * 0.2
    const h = 1.3 + rng() * 0.7
    parts.push(speckled(jitter(new THREE.CylinderGeometry(r * 0.8, r, h, 7).translate(0, y + h / 2, 0), seed + i, 0.25, false), seed + 10 + i, i % 2 ? CANYON_BANDS.slice(0, 2) : CANYON_BANDS.slice(2, 4)))
    y += h * 0.96
  }
  parts.push(speckled(new THREE.IcosahedronGeometry(1.3, 0).scale(1.2, 0.55, 1.1).translate(0.2, y + 0.3, 0), seed + 20, [0x6a4a3a, 0x7a5642]))
  return assemble(parts)
}

// The oasis ──────────────────────────────────────────────────────────────────────

function camel(): THREE.BufferGeometry {
  const tan = 0xc8a06a
  const dark = 0xb08a58
  const parts = [
    painted(new THREE.SphereGeometry(1, 8, 6).scale(0.55, 0.5, 1.0).translate(0, 1.9, 0), tan),
    painted(new THREE.SphereGeometry(0.5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 2.2, 0.1), dark),
    painted(new THREE.BoxGeometry(0.3, 1.2, 0.36).rotateX(-0.5).translate(0, 2.4, -1.1), tan),
    box(0.32, 0.36, 0.72, 0, 3.0, -1.55, tan),
    box(0.9, 0.3, 0.9, 0, 2.35, 0.55, 0xa8322c),
  ]
  for (const x of [-0.28, 0.28]) for (const z of [-0.6, 0.6]) parts.push(box(0.13, 1.6, 0.13, x, 0.8, z, dark))
  return assemble(parts)
}

function kasbah(): THREE.BufferGeometry {
  const mud = [0xc88a5a, 0xbc7e50, 0xd09464]
  const parts = [speckled(new THREE.BoxGeometry(12, 5, 10, 3, 2, 3).translate(0, 2.5, 0), 211, mud)]
  for (let i = 0; i < 7; i++) {
    parts.push(box(0.8, 0.8, 0.5, -5.4 + i * 1.8, 5.4, -4.8, 0xbc7e50))
    parts.push(box(0.8, 0.8, 0.5, -5.4 + i * 1.8, 5.4, 4.8, 0xbc7e50))
  }
  for (const [x, z] of [[-6, -5], [6, -5], [-6, 5], [6, 5]] as const) {
    parts.push(painted(new THREE.CylinderGeometry(1.4, 2.0, 8, 4).rotateY(Math.PI / 4).translate(x, 4, z), 0xb87a4c))
    parts.push(box(2.4, 0.6, 2.4, x, 8.3, z, 0xa86c40))
  }
  parts.push(box(2.2, 3, 0.1, 0, 1.5, -5.02, 0x3a2418))
  for (const x of [-3.5, 3.5]) parts.push(box(0.6, 0.8, 0.1, x, 3.4, -5.02, 0x3a2418))
  return assemble(parts)
}

// Dawn ───────────────────────────────────────────────────────────────────────────

function balloon(stripes: readonly number[]): THREE.BufferGeometry {
  const envelope = new THREE.SphereGeometry(4, 12, 8).scale(1, 1.2, 1)
  const pos = envelope.attributes.position
  // Taper the lower half into the classic teardrop.
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    if (y < 0) {
      const t = 1 + (y / 4.8) * 0.55
      pos.setXYZ(i, pos.getX(i) * t, y, pos.getZ(i) * t)
    }
  }
  envelope.translate(0, 8.2, 0)
  const parts = [faces(envelope, (_, c) => stripes[Math.floor(((Math.atan2(c.z, c.x) + Math.PI) / (Math.PI * 2)) * 12) % stripes.length])]
  parts.push(box(1.1, 0.9, 1.1, 0, 0.45, 0, 0x8a5a32))
  for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) parts.push(painted(new THREE.CylinderGeometry(0.02, 0.02, 2.6, 3).translate(0, 1.3, 0).rotateZ(-x * 0.5).rotateX(z * 0.5).translate(x, 0.9, z), 0x4a3a2a))
  parts.push(cyl(0.6, 0.8, 0.4, 8, 0, 3.4, 0, 0x3a3a40))
  return assemble(parts)
}

/**
 * The runtime-built models, keyed `gen.*`, each standing on y = 0 with its footprint
 * centred. Unit-sized where the planners stretch them (mountains, hills, dunes, rows).
 */
export function buildGeneratedModels(): Map<string, THREE.BufferGeometry> {
  return new Map<string, THREE.BufferGeometry>([
    ['gen.mountainA', mountain(11)],
    ['gen.mountainB', mountain(29)],
    ['gen.mountainC', mountain(47)],
    ['gen.hill', hill(5)],
    ['gen.dune', dune(17)],
    ['gen.cropRow', cropRow()],
    ['gen.haybale', haybale()],
    ['gen.snowman', snowman()],
    ['gen.pond', pond()],
    ['gen.parasolA', parasol(0xe23b3b)],
    ['gen.parasolB', parasol(0x2f7fd6)],
    ['gen.parasolC', parasol(0xf4a23a)],
    ['gen.lounger', lounger()],
    ['gen.lifeguard', lifeguard()],
    ['gen.beachHut', beachHut()],
    ['gen.surfboard', surfboard()],
    ['gen.sailboat', sailboat()],
    ['gen.fishingBoat', fishingBoat()],
    ['gen.ship', ship()],
    ['gen.buoy', buoy()],
    ['gen.islet', isletShape(37)],
    ['gen.lighthouse', lighthouse()],
    ['gen.jetty', jetty()],
    ['gen.reeds', reeds()],
    ['gen.lavaPool', lavaPool()],
    ['gen.lavaFlow', lavaFlow()],
    ['gen.cinderCone', cinderCone(53, false)],
    ['gen.volcano', cinderCone(59, true)],
    ['gen.deadTree', deadTree()],
    ['gen.basalt', basalt()],
    ['gen.karstA', karst(211)],
    ['gen.karstB', karst(223)],
    ['gen.karstC', karst(239)],
    ['gen.junk', junk()],
    ['gen.sakura', blossomTree(301, [0xf7b8cf, 0xf2a0be, 0xfbd3e0], 0x5a3a2e, 2.6)],
    ['gen.sakuraWhite', blossomTree(307, [0xfde8ef, 0xf8d0dc, 0xffffff], 0x4e3a30, 2.8)],
    ['gen.maple', blossomTree(311, [0xd8452e, 0xe86a2a, 0xc23a2a], 0x4a3428, 2.2)],
    ['gen.torii', torii()],
    ['gen.toro', toro()],
    ['gen.pagoda', pagoda()],
    ['gen.fuji', fuji(317)],
    ['gen.waterfall', waterfall()],
    ['gen.greenPeakA', greenPeak(331)],
    ['gen.greenPeakB', greenPeak(337)],
    ['gen.acaciaA', acacia(341)],
    ['gen.acaciaB', acacia(347)],
    ['gen.baobab', baobab()],
    ['gen.giraffe', giraffe()],
    ['gen.elephant', elephant()],
    ['gen.prang', prang()],
    ['gen.templeGate', templeGate()],
    ['gen.stupa', stupa()],
    ['gen.giantTree', giantTree(353)],
    ['gen.bamboo', bamboo()],
    ['gen.stiltHouse', stiltHouse(0x8a6440, 0x9a8a6a, 2.2, false)],
    ['gen.stiltHouseB', stiltHouse(0x4a86b8, 0x9aa4a8, 2.2, false)],
    ['gen.lanternHouse', stiltHouse(0x7a5a40, 0x5a4a3e, 1.0, true)],
    ['gen.marketBoat', marketBoat(359, false)],
    ['gen.marketBoatB', marketBoat(362, true)],
    ['gen.terrace', terrace(367)],
    ['gen.sheep', sheep()],
    ['gen.glassTower', glassTower()],
    ['gen.twistTower', twistTower()],
    ['gen.lightPost', lightPost()],
    ['gen.lightRing', lightRing()],
    ['gen.rocket', rocket()],
    ['gen.biodome', biodome()],
    ['gen.graves', graves(373)],
    ['gen.gravesB', graves(379)],
    ['gen.jackLantern', jackLantern()],
    ['gen.hauntedHouse', hauntedHouse()],
    ['gen.ghost', ghost()],
    ['gen.castle', castle()],
    ['gen.igloo', igloo()],
    ['gen.iceCrystal', iceCrystal()],
    ['gen.iceHut', iceHut()],
    ['gen.barn', barn()],
    ['gen.silo', silo()],
    ['gen.dutchMill', dutchMill()],
    ['gen.sunflowers', sunflowers()],
    ['gen.cow', cow()],
    ['gen.tractor', tractor()],
    ['gen.mesa', mesa(383)],
    ['gen.rockArch', rockArch()],
    ['gen.hoodoo', hoodoo(389)],
    ['gen.camel', camel()],
    ['gen.kasbah', kasbah()],
    ['gen.balloonA', balloon([0xe23b3b, 0xf8d030])],
    ['gen.balloonB', balloon([0x2f7fd6, 0xffffff, 0x2f7fd6, 0x46c1e8])],
    ['gen.balloonC', balloon([0xe23b3b, 0xf4a23a, 0xf8d030, 0x5ab04a, 0x2f7fd6, 0x8a50c8])],
  ])
}
