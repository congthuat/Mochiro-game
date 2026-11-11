/**
 * The zone system, checked without a browser.
 *
 * A zone is a lighting palette rather than new geometry — sky, fog, the sun's colour,
 * the sky/ground bounce, the exposure — blended over a stretch of track as the run
 * travels. That makes it cheap, and it makes it easy to get wrong in ways nobody sees
 * until a player is three minutes into a run:
 *
 *  1. **The handover has to be smooth.** A jump in the sky or the fog reads as a
 *     glitch, not as weather, so the blend is sampled metre by metre and every step
 *     has to be small.
 *  2. **The world has to stay readable.** Exposure and light intensity are checked
 *     against the band the game was tuned in; a zone that goes too dark loses the
 *     runner and the traffic.
 *  3. **Every zone has to be reachable and labelled** in both languages, and the
 *     first one has to own the start of the run.
 *
 *   bun run scripts/biome-check.ts
 */
import * as THREE from 'three'
import { BIOMES, BIOME_BLEND, biomeMix } from '../src/runner/config'
import { translate } from '../src/lib/i18n'

let failed = 0
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
}

const a = new THREE.Color()
const b = new THREE.Color()
const blend = (from: string, to: string, t: number): THREE.Color => a.set(from).lerp(b.set(to), t).clone()

console.log('The zones\n')

check('there are at least four zones', BIOMES.length >= 4, BIOMES.map((z) => z.name).join(' → '))
check('the first zone starts at zero', BIOMES[0].at === 0, `${BIOMES[0].name} at ${BIOMES[0].at} m`)
check(
  'the zones are strictly ordered by distance',
  BIOMES.every((zone, i) => i === 0 || zone.at > BIOMES[i - 1].at),
  BIOMES.map((z) => `${z.name}@${z.at}`).join(' · ')
)
check(
  'no two zones share a name',
  new Set(BIOMES.map((z) => z.name)).size === BIOMES.length,
  BIOMES.map((z) => z.name).join(', ')
)
check(
  'the handover is shorter than the shortest zone',
  BIOMES.every((zone, i) => i === 0 || zone.at - BIOMES[i - 1].at > BIOME_BLEND),
  `blend ${BIOME_BLEND} m · closest zones ${Math.min(...BIOMES.slice(1).map((z, i) => z.at - BIOMES[i].at))} m apart`
)

for (const zone of BIOMES) {
  const en = translate(`biome.${zone.name}`, 'en')
  const vi = translate(`biome.${zone.name}`, 'vi')
  check(
    `${zone.name}: labelled in both languages`,
    en !== `biome.${zone.name}` && vi !== `biome.${zone.name}` && Boolean(en) && Boolean(vi),
    `en “${en}” · vi “${vi}”`
  )
}

console.log('\nThe handover\n')

check('a fresh run starts in the first zone', biomeMix(0).from.name === BIOMES[0].name && biomeMix(0).t === 0, `${biomeMix(0).from.name} t=${biomeMix(0).t}`)
const last = BIOMES[BIOMES.length - 1]
check('a long run ends in the last zone', biomeMix(50_000).from.name === last.name, biomeMix(50_000).from.name)
check(
  'every zone is reached',
  BIOMES.every((zone) => biomeMix(zone.at + 1).from.name === zone.name),
  BIOMES.map((z) => `${z.name}@${biomeMix(z.at + 1).from.name}`).join(' · ')
)

// Metre by metre: the blended sky, fog and sun may never jump.
let worstStep = 0
let worstAt = 0
for (let d = 0; d < 3000; d += 1) {
  const now = biomeMix(d)
  const next = biomeMix(d + 1)
  for (const key of ['sky', 'fog', 'sun', 'skyBounce', 'groundBounce'] as const) {
    const from = blend(now.from[key], now.to[key], now.t)
    const to = blend(next.from[key], next.to[key], next.t)
    const step = Math.abs(from.r - to.r) + Math.abs(from.g - to.g) + Math.abs(from.b - to.b)
    if (step > worstStep) {
      worstStep = step
      worstAt = d
    }
  }
}
check(
  'the palette never jumps between one metre and the next',
  worstStep < 0.02,
  `largest step ${worstStep.toFixed(4)} at ${worstAt} m (a hard cut would be over 1.0)`
)

console.log('\nStays readable\n')

const exposure = (d: number): number => {
  const { from, to, t } = biomeMix(d)
  return from.exposure + (to.exposure - from.exposure) * t
}
const intensity = (d: number): number => {
  const { from, to, t } = biomeMix(d)
  return from.sunIntensity + (to.sunIntensity - from.sunIntensity) * t
}
let minExposure = 9
let maxExposure = 0
let minSun = 9
for (let d = 0; d < 3000; d += 5) {
  minExposure = Math.min(minExposure, exposure(d))
  maxExposure = Math.max(maxExposure, exposure(d))
  minSun = Math.min(minSun, intensity(d))
}
check('exposure stays in the band the game was tuned in', minExposure >= 0.8 && maxExposure <= 1.0, `${minExposure.toFixed(2)} … ${maxExposure.toFixed(2)}`)
check('the sun never goes out', minSun >= 0.6, `lowest key light ${minSun.toFixed(2)}`)
check(
  'no zone paints the sky pure white',
  BIOMES.every((zone) => zone.sky.toLowerCase() !== '#ffffff' && zone.fog.toLowerCase() !== '#ffffff'),
  BIOMES.map((z) => `${z.name} ${z.sky}/${z.fog}`).join(' · ')
)
check(
  'every zone changes the sky it hands over to',
  BIOMES.every((zone, i) => i === 0 || zone.sky !== BIOMES[i - 1].sky),
  BIOMES.map((z) => z.sky).join(' → ')
)

console.log(failed === 0 ? '\nBiome check passed.' : `\n${failed} biome check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
