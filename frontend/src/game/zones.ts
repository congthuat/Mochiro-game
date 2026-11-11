// The five zones of Aetherfall — each with its own palette, layout and difficulty.

export interface ZonePalette {
  skyTop: number
  skyHorizon: number
  sunColor: number
  sunIntensity: number
  hemiSky: number
  hemiGround: number
  fog: number
  waterDeep: number
  waterShallow: number
  grass: number
  grassAlt: number
  rock: number
  sand: number
  peak: number
  foliage: number
  foliageAlt: number
  trunk: number
  crystal: number
  mote: number
  cloud: number
  starOpacity: number
}

export interface ZoneDef {
  index: number
  name: string
  subtitle: string
  tip: string
  seed: number
  maxHeight: number
  islandRadius: number
  sharpness: number
  water: boolean
  shards: number
  orbs: number
  enemies: { wisp: number; sentry: number; brute: number }
  hpScale: number
  speedScale: number
  props: { trees: number; rocks: number; crystals: number; ruins: number }
  palette: ZonePalette
  music: { root: number; scale: number[]; tempo: number; mood: 'calm' | 'tense' | 'dark' | 'heroic' }
  boss: boolean
}

export const ZONES: ZoneDef[] = [
  {
    index: 0,
    name: 'Verdant Hollow',
    subtitle: 'Where the shards first fell',
    tip: 'Chain pulse blasts to clear packs fast — energy regenerates while you move.',
    seed: 1337,
    maxHeight: 26,
    islandRadius: 96,
    sharpness: 1.55,
    water: true,
    shards: 8,
    orbs: 2,
    enemies: { wisp: 5, sentry: 1, brute: 0 },
    hpScale: 1,
    speedScale: 1,
    props: { trees: 120, rocks: 70, crystals: 16, ruins: 8 },
    palette: {
      skyTop: 0x1e5fb4,
      skyHorizon: 0xc6e6ff,
      sunColor: 0xfff4d6,
      sunIntensity: 2.5,
      hemiSky: 0xa6d4ff,
      hemiGround: 0x3d5c33,
      fog: 0xcfe6ff,
      waterDeep: 0x0a3a5c,
      waterShallow: 0x3ec9cf,
      grass: 0x4f9b3c,
      grassAlt: 0x74c452,
      rock: 0x8d8d85,
      sand: 0xdccb92,
      peak: 0xd8d4c6,
      foliage: 0x2f7d38,
      foliageAlt: 0x46a44f,
      trunk: 0x5a4030,
      crystal: 0x66e6ff,
      mote: 0xfff0b4,
      cloud: 0xffffff,
      starOpacity: 0,
    },
    music: { root: 57, scale: [0, 2, 4, 7, 9], tempo: 76, mood: 'calm' },
    boss: false,
  },
  {
    index: 1,
    name: 'Ember Dunes',
    subtitle: 'A sea of glass and gold',
    tip: 'Sentries keep their distance — dash in, blast, dash out.',
    seed: 90210,
    maxHeight: 22,
    islandRadius: 92,
    sharpness: 1.35,
    water: true,
    shards: 9,
    orbs: 2,
    enemies: { wisp: 6, sentry: 2, brute: 1 },
    hpScale: 1.35,
    speedScale: 1.08,
    props: { trees: 34, rocks: 130, crystals: 26, ruins: 16 },
    palette: {
      skyTop: 0x27356f,
      skyHorizon: 0xffb066,
      sunColor: 0xffd28a,
      sunIntensity: 2.7,
      hemiSky: 0xffd0a0,
      hemiGround: 0x6b4a2a,
      fog: 0xf0b98a,
      waterDeep: 0x123c52,
      waterShallow: 0x35a7bd,
      grass: 0xbfa15a,
      grassAlt: 0xd6b978,
      rock: 0xa9744a,
      sand: 0xe6c286,
      peak: 0xd8b892,
      foliage: 0x6d7a34,
      foliageAlt: 0x8b9440,
      trunk: 0x6b4a2f,
      crystal: 0xffc46b,
      mote: 0xffd9a0,
      cloud: 0xffd9b0,
      starOpacity: 0.12,
    },
    music: { root: 55, scale: [0, 3, 5, 7, 10], tempo: 88, mood: 'tense' },
    boss: false,
  },
  {
    index: 2,
    name: 'Frostmere Peaks',
    subtitle: 'Silence above the clouds',
    tip: 'Air jumps matter on cliffs — grab Sky Step when it appears.',
    seed: 121212,
    maxHeight: 34,
    islandRadius: 90,
    sharpness: 1.85,
    water: true,
    shards: 10,
    orbs: 2,
    enemies: { wisp: 7, sentry: 3, brute: 2 },
    hpScale: 1.75,
    speedScale: 1.16,
    props: { trees: 90, rocks: 110, crystals: 22, ruins: 12 },
    palette: {
      skyTop: 0x3a6ea5,
      skyHorizon: 0xe4f2ff,
      sunColor: 0xdcefff,
      sunIntensity: 2.0,
      hemiSky: 0xcfe6ff,
      hemiGround: 0x6f7d88,
      fog: 0xd8ecff,
      waterDeep: 0x14526e,
      waterShallow: 0x6fd4e8,
      grass: 0xb9cfd8,
      grassAlt: 0xdcecf4,
      rock: 0x6f7d88,
      sand: 0xc4d6de,
      peak: 0xf4faff,
      foliage: 0x2c5f52,
      foliageAlt: 0x3a7a67,
      trunk: 0x4a3a30,
      crystal: 0x9ff0ff,
      mote: 0xffffff,
      cloud: 0xffffff,
      starOpacity: 0.2,
    },
    music: { root: 60, scale: [0, 2, 3, 5, 7, 8, 10], tempo: 82, mood: 'calm' },
    boss: false,
  },
  {
    index: 3,
    name: 'Umbra Fen',
    subtitle: 'The drowned cathedral',
    tip: 'Brutes telegraph their charge — sidestep, then punish.',
    seed: 777001,
    maxHeight: 20,
    islandRadius: 88,
    sharpness: 1.25,
    water: true,
    shards: 11,
    orbs: 3,
    enemies: { wisp: 8, sentry: 3, brute: 2 },
    hpScale: 2.2,
    speedScale: 1.26,
    props: { trees: 110, rocks: 60, crystals: 40, ruins: 26 },
    palette: {
      skyTop: 0x080f20,
      skyHorizon: 0x2b3a52,
      sunColor: 0x9db4ff,
      sunIntensity: 1.2,
      hemiSky: 0x415a80,
      hemiGround: 0x121c14,
      fog: 0x141f2e,
      waterDeep: 0x06121a,
      waterShallow: 0x1f6b5e,
      grass: 0x2f5a3a,
      grassAlt: 0x3d7148,
      rock: 0x3d4550,
      sand: 0x4a5348,
      peak: 0x59606b,
      foliage: 0x24462f,
      foliageAlt: 0x2f5a3a,
      trunk: 0x2f2620,
      crystal: 0x7cf5c8,
      mote: 0x7cf5c8,
      cloud: 0x394a66,
      starOpacity: 0.85,
    },
    music: { root: 50, scale: [0, 1, 5, 7, 8], tempo: 96, mood: 'dark' },
    boss: false,
  },
  {
    index: 4,
    name: 'Sky Citadel',
    subtitle: 'The Colossus awaits',
    tip: 'Watch the glowing rings — dash or jump the instant they detonate.',
    seed: 616161,
    maxHeight: 30,
    islandRadius: 84,
    sharpness: 1.7,
    water: false,
    shards: 6,
    orbs: 2,
    enemies: { wisp: 4, sentry: 2, brute: 0 },
    hpScale: 2.6,
    speedScale: 1.35,
    props: { trees: 0, rocks: 90, crystals: 34, ruins: 40 },
    palette: {
      skyTop: 0x141b33,
      skyHorizon: 0x7686ad,
      sunColor: 0xc7d4ff,
      sunIntensity: 1.7,
      hemiSky: 0x8a9ccc,
      hemiGround: 0x2a3040,
      fog: 0x2a3450,
      waterDeep: 0x101828,
      waterShallow: 0x2f4a6b,
      grass: 0x4a5570,
      grassAlt: 0x5d6b8a,
      rock: 0x545d74,
      sand: 0x6b7488,
      peak: 0x8f9ab8,
      foliage: 0x3a4a68,
      foliageAlt: 0x4a5c80,
      trunk: 0x333a4a,
      crystal: 0xb48cff,
      mote: 0xc9b0ff,
      cloud: 0x6f7fa8,
      starOpacity: 0.45,
    },
    music: { root: 45, scale: [0, 2, 3, 7, 10], tempo: 108, mood: 'heroic' },
    boss: true,
  },
]

export const ZONE_COUNT = ZONES.length

export function zoneAt(index: number): ZoneDef {
  return ZONES[Math.max(0, Math.min(ZONES.length - 1, index))]
}
