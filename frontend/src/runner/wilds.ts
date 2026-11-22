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

export type Wild = 'plains' | 'forest' | 'snow' | 'desert' | 'tunnel'
export const WILDS: readonly string[] = ['plains', 'forest', 'snow', 'desert', 'tunnel']
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

/** Every `nat.*` model a planner can ask for (loaded from landscape.glb). */
export const WILD_MODEL_KEYS = [
  ...new Set([...PINES, ...DARK_TREES, ...FALL_TREES, ...FARM_TREES, ...ROCKS, ...STONES, ...SMALL_ROCKS, ...UNDERGROWTH, ...FLOWERS, ...BUSHES, ...CACTI, ...PALMS, ...RUINS]),
]

/** Pool sizes: the kinds that line whole stretches of road get more instances. */
export function wildCapacity(key: string): number {
  if (key === 'gen.cropRow') return 170
  if (/^nat\.tree_pine/.test(key)) return 80
  if (/^nat\.(tree_|rock_|stone_|cactus)/.test(key)) return 60
  if (/^gen\.(mountain|hill)/.test(key)) return 14
  if (key === 'gen.dune') return 44
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

// ── the far ring: mountains, hills, dunes ────────────────────────────────────────

function planFar(zone: string, side: -1 | 1, p: WildPlacer): number {
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
  colour: (h: number, r: number, into: THREE.Color) => void,
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
  const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z)
    colour((a.y + b.y + d.y) / 3, rng(), c)
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
        tri(lower[j], apex, lower[k])
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
  ])
}
