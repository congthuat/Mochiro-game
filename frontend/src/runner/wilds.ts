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

export type Wild = 'plains' | 'forest' | 'snow' | 'desert' | 'tunnel' | 'river' | 'volcano' | 'beach' | 'seabridge'
export const WILDS: readonly string[] = ['plains', 'forest', 'snow', 'desert', 'tunnel', 'river', 'volcano', 'beach', 'seabridge']
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
  ...new Set([...PINES, ...DARK_TREES, ...FALL_TREES, ...FARM_TREES, ...ROCKS, ...STONES, ...SMALL_ROCKS, ...UNDERGROWTH, ...FLOWERS, ...BUSHES, ...CACTI, ...PALMS, ...RUINS, ...LILIES, ...SHORE_PLANTS, ...TROPIC_PALMS, ...RIVER_TREES, ...LAVA_ROCKS, 'nat.canoe', 'nat.tree_thin_dark']),
]

/** Pool sizes: the kinds that line whole stretches of road get more instances. */
export function wildCapacity(key: string): number {
  if (key === 'gen.cropRow') return 170
  if (/^nat\.tree_pine/.test(key)) return 80
  if (/^nat\.(tree_|rock_|stone_|cactus)/.test(key)) return 60
  if (/^gen\.(mountain|hill)/.test(key)) return 14
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
  if (zone === 'tunnel') return tier === 'far' ? 60 : 24
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
    p.put('gen.snowman', side * randRange(p.rng, 9.5, 11.5), 0, { rot: -side * (Math.PI / 2) + randRange(p.rng, -0.4, 0.4), scale: randRange(p.rng, 0.9, 1.15) })
    if (p.rng() < 0.3) p.put('gen.snowman', side * 12.5, 2.4, { rot: -side * (Math.PI / 2) + randRange(p.rng, -0.6, 0.6), scale: 0.7 })
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

// ── the far ring: mountains, hills, dunes ────────────────────────────────────────

function planFar(zone: string, side: -1 | 1, p: WildPlacer): number {
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
  ])
}
