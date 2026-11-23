/**
 * The zone system, checked without a browser.
 *
 * A run is a journey: every zone once per round, shuffled with a fresh seed, the
 * groups in ZONE_GROUPS kept together, then a new round is drawn. The lighting is
 * blended over a stretch of track between zones. That is cheap, and easy to get wrong
 * in ways nobody sees until a player is ten minutes into a run:
 *
 *  1. **Every round visits every zone**, the groups in order, never opening in a
 *     tunnel, each zone lasting about the same time.
 *  2. **The handover has to be smooth.** A jump in the sky or the fog reads as a
 *     glitch, so the blend is sampled metre by metre (tunnel portals excepted).
 *  3. **The world has to stay readable**, and every zone is labelled in both languages.
 *
 *   bun run scripts/biome-check.ts
 */
import * as THREE from 'three'
import { BIOMES, ZONE_GROUPS, ZONE_ICONS, ZONE_SECONDS, TUNNEL_LENGTH, biomeMix, distanceAt, roundAt, setJourney, watersUpTo, zoneAt } from '../src/runner/config'
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

check('there are 31 zones', BIOMES.length === 31, BIOMES.map((z) => z.name).join(' · '))
check('no two zones share a name', new Set(BIOMES.map((z) => z.name)).size === BIOMES.length, `${BIOMES.length} names`)
for (const zone of BIOMES) {
  const en = translate(`biome.${zone.name}`, 'en')
  const vi = translate(`biome.${zone.name}`, 'vi')
  check(
    `${zone.name}: labelled in both languages, with an icon`,
    en !== `biome.${zone.name}` && vi !== `biome.${zone.name}` && Boolean(en) && Boolean(vi) && Boolean(ZONE_ICONS[zone.name]),
    `${ZONE_ICONS[zone.name] ?? '—'} en “${en}” · vi “${vi}”`
  )
}

console.log('\nThe journey\n')

const starts = new Map<string, number>()
let roundsOk = true
let groupsOk = true
let tunnelStart = false
let worstLength = ''
for (let seed = 1; seed <= 60; seed += 1) {
  setJourney(seed)
  for (const at of [0, 1]) {
    const first = roundAt(0)
    const legs = at === 0 ? first : roundAt(first[first.length - 1].end + 1)
    const names = legs.map((leg) => leg.zone.name)
    if (names.length !== BIOMES.length || new Set(names).size !== BIOMES.length) roundsOk = false
    for (const group of ZONE_GROUPS) {
      const i = names.indexOf(group[0])
      if (group.some((name, k) => names[i + k] !== name)) groupsOk = false
    }
    if (at === 0) {
      starts.set(names[0], (starts.get(names[0]) ?? 0) + 1)
      if (legs[0].zone.kind === 'tunnel') tunnelStart = true
    }
    for (const leg of legs) {
      if (leg.zone.kind === 'tunnel') continue
      const ratio = (leg.end - leg.start) / (distanceAt(ZONE_SECONDS) - distanceAt(0))
      if (ratio < 0.5) worstLength = `${leg.zone.name} ${Math.round(leg.end - leg.start)} m (seed ${seed})`
    }
  }
}
check('every round visits every zone exactly once', roundsOk, '60 seeds × 2 rounds')
check('grouped zones always travel together, in order', groupsOk, ZONE_GROUPS.map((g) => g.join('→')).join(' · '))
check('a run never opens in a tunnel', !tunnelStart, `${starts.size} different opening zones over 60 seeds`)
check('the opening zone varies from run to run', starts.size >= 12, [...starts.entries()].map(([z, n]) => `${z}×${n}`).join(' '))
check('no open-air zone is cut short', worstLength === '', worstLength || 'all at full length')

setJourney(7)
const round = roundAt(0)
const roundEnd = round[round.length - 1].end
check(
  'the tunnels keep their fixed length',
  round.filter((leg) => leg.zone.kind === 'tunnel').every((leg) => Math.abs(leg.end - leg.start - TUNNEL_LENGTH) < 0.5),
  round.filter((leg) => leg.zone.kind === 'tunnel').map((leg) => `${leg.zone.name} ${Math.round(leg.end - leg.start)} m`).join(' · ')
)
const waters = watersUpTo(roundEnd)
check(
  'every lake, river, canal and sea lies inside one zone',
  waters.every((w) => zoneAt(w.start) === zoneAt(w.end)),
  waters.map((w) => `${zoneAt(w.start)} ${Math.round(w.start)}–${Math.round(w.end)}`).join(' · ')
)
check(
  'every zone is reached',
  round.every((leg) => zoneAt(leg.start + 1) === leg.zone.name || biomeMix(leg.start + 1).from.name === leg.zone.name),
  round.map((leg) => leg.zone.name).join(' → ')
)

console.log('\nThe handover\n')

let worstStep = 0
let worstAt = 0
for (let d = 0; d < roundEnd * 1.5; d += 1) {
  const now = biomeMix(d)
  const next = biomeMix(d + 1)
  if (now.to.kind === 'tunnel' || now.from.kind === 'tunnel' || next.from.kind === 'tunnel') continue
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
check('the palette never jumps between one metre and the next', worstStep < 0.03, `largest step ${worstStep.toFixed(4)} at ${worstAt} m (a hard cut would be over 1.0)`)

console.log('\nStays readable\n')

const exposures = BIOMES.map((zone) => zone.exposure)
check('exposure stays in the band the game was tuned in', Math.min(...exposures) >= 0.88 && Math.max(...exposures) <= 1.1, `${Math.min(...exposures).toFixed(2)} … ${Math.max(...exposures).toFixed(2)}`)
check('the sun never goes out', BIOMES.every((zone) => zone.sunIntensity >= 0.6), `lowest key light ${Math.min(...BIOMES.map((z) => z.sunIntensity)).toFixed(2)}`)
check('no zone paints the sky pure white', BIOMES.every((zone) => zone.sky.toLowerCase() !== '#ffffff' && zone.fog.toLowerCase() !== '#ffffff'), 'sky and fog')

console.log(failed === 0 ? '\nBiome check passed.' : `\n${failed} biome check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
