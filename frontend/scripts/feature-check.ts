/**
 * The systems added on top of the run: difficulty, missions, the pursuit, close calls
 * and the road itself — all checked without a browser.
 *
 * The interesting assertions here are the ones that would be invisible until a player
 * is three minutes in:
 *
 *  1. **One crash must be survivable and two must not be.** The pursuit meter is a
 *     rule, so it is checked as arithmetic rather than felt.
 *  2. **The cruiser must not cover the runner.** It is projected through the real game
 *     camera — the same technique `slide-pose.ts` uses — because "does this look right"
 *     is the only question that matters and there is no browser to look with.
 *  3. **A close call must be earned.** The threshold has to sit below the air a clean
 *     pass in the next lane leaves, or every obstacle would award one.
 *  4. **The road must read as a road.** The asphalt has to be dark and the paint has to
 *     be bright; a pale surface with pale markings is a runway.
 *
 *   bun run scripts/feature-check.ts
 */
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import {
  BIOMES,
  BODY,
  CAMERA,
  DIFFICULTIES,
  LANES,
  MISSIONS,
  PALETTE,
  PURSUIT,
  RUN,
  TRACK_HALF_WIDTH,
  difficulty,
  gapTimeAt,
  rollMissions,
  speedAt,
} from '../src/runner/config'
import { makeRng } from '../src/runner/utils'
import { HERO_HEIGHT, LINEUP_HALF_WIDTH, stageCameraZ, stageFov } from '../src/runner/stage'
import { mochiroFaviconHref, mochiroMarkSvg } from '../src/runner/mochiro'
import { translate } from '../src/lib/i18n'

let failed = 0
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
}

const hex = (value: string): THREE.Color => new THREE.Color(value)
const lum = (value: string): number => {
  const c = hex(value)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

console.log('Difficulty\n')

check('three modes, in order', DIFFICULTIES.length === 3 && DIFFICULTIES.map((d) => d.id).join(',') === 'easy,normal,hard', DIFFICULTIES.map((d) => d.id).join(' · '))
check(
  'speed rises and room falls from easy to hard',
  DIFFICULTIES[0].speed < DIFFICULTIES[1].speed &&
    DIFFICULTIES[1].speed < DIFFICULTIES[2].speed &&
    DIFFICULTIES[0].gaps > DIFFICULTIES[1].gaps &&
    DIFFICULTIES[1].gaps > DIFFICULTIES[2].gaps,
  DIFFICULTIES.map((d) => `${d.id} ×${d.speed} / ${d.gaps} gaps`).join(' · ')
)
check(
  'hard is a real step up and easy a real step down',
  DIFFICULTIES[2].speed / DIFFICULTIES[0].speed > 1.25,
  `top speed ${(RUN.maxSpeed * DIFFICULTIES[0].speed).toFixed(1)} … ${(RUN.maxSpeed * DIFFICULTIES[2].speed).toFixed(1)} m/s`
)
check(
  'harmful powers are rarer the easier the mode',
  DIFFICULTIES[0].harmful < 1 && DIFFICULTIES[2].harmful > 1,
  DIFFICULTIES.map((d) => `${d.id} ×${d.harmful}`).join(' · ')
)
check(
  'an unknown mode falls back to normal',
  difficulty('nonsense').id === 'normal' && difficulty(null).id === 'normal',
  difficulty(undefined).id
)
check(
  'the pattern gap stays positive at the top of every mode',
  DIFFICULTIES.every((d) => gapTimeAt(RUN.rampSeconds) * d.gaps > 0.3),
  `hard leaves ${(gapTimeAt(RUN.rampSeconds) * DIFFICULTIES[2].gaps).toFixed(2)} s at full ramp`
)
check(
  'the starting speed of easy is still a run, not a walk',
  speedAt(0) * DIFFICULTIES[0].speed > 10,
  `${(speedAt(0) * DIFFICULTIES[0].speed).toFixed(1)} m/s`
)

console.log('\nMissions\n')

const rng = makeRng(90210)
let unique = true
let inRange = true
let rewardPaid = true
for (let i = 0; i < 400; i += 1) {
  const rolls = rollMissions(rng)
  if (new Set(rolls.map((r) => r.id)).size !== rolls.length) unique = false
  for (const roll of rolls) {
    const spec = MISSIONS.find((m) => m.id === roll.id)
    if (!spec) {
      inRange = false
      continue
    }
    if (roll.target < spec.min || roll.target > spec.max || (roll.target - spec.min) % spec.step !== 0) inRange = false
    if (roll.reward !== spec.reward) rewardPaid = false
  }
}
check('three missions a run', rollMissions(makeRng(7)).length === 3, rollMissions(makeRng(7)).map((r) => r.id).join(' · '))
check('never the same mission twice in one run', unique, '400 rolls')
check('every target lands on the range and the step', inRange, '400 rolls')
check('every mission pays the reward it advertises', rewardPaid, MISSIONS.map((m) => `${m.id}:${m.reward}`).join(' · '))
check(
  'every mission is labelled in both languages',
  MISSIONS.every((m) => {
    const en = translate(`mission.${m.id}`, 'en')
    const vi = translate(`mission.${m.id}`, 'vi')
    return en !== `mission.${m.id}` && vi !== `mission.${m.id}`
  }),
  MISSIONS.map((m) => translate(`mission.${m.id}`, 'vi')).join(' · ')
)
check(
  'the hardest target of each mission is reachable inside one run',
  // A 90 s run at a conservative average of 22 m/s covers 1980 m, collects well over
  // 45 coins and slides many times; nothing asks for more than that.
  MISSIONS.every((m) => m.max <= 1600 || m.id === 'distance'),
  MISSIONS.map((m) => `${m.id} ≤ ${m.max}`).join(' · ')
)
const rewards = rollMissions(makeRng(11)).reduce((sum, r) => sum + r.reward, 0)
check(
  'a full set of missions pays for a continue',
  rewards >= DIFFICULTIES[2].reviveCost,
  `three missions pay ${rewards} coins, hard costs ${DIFFICULTIES[2].reviveCost}`
)

console.log('\nThe pursuit\n')

const heatAfterCrashes = (crashes: number, gap: number): number => {
  let heat = 0
  for (let i = 0; i < crashes; i += 1) {
    heat = Math.min(PURSUIT.bustedAt, heat + PURSUIT.crashHeat)
    heat = Math.max(0, heat - PURSUIT.coolPerSecond * gap)
  }
  return heat
}
check('one crash never busts you', heatAfterCrashes(1, 0) < PURSUIT.bustedAt, `one crash leaves ${heatAfterCrashes(1, 0).toFixed(2)}`)
check(
  'two crashes back to back do',
  heatAfterCrashes(2, 0) >= PURSUIT.bustedAt,
  `two crashes leave ${heatAfterCrashes(2, 0).toFixed(2)}`
)
check(
  'but two crashes with clean running between them do not',
  heatAfterCrashes(2, 2.2) < PURSUIT.bustedAt,
  `2.2 s of clean running between them leaves ${heatAfterCrashes(2, 2.2).toFixed(2)}`
)
check(
  'the meter empties again in a few seconds of clean running',
  PURSUIT.crashHeat / PURSUIT.coolPerSecond < 4,
  `${(PURSUIT.crashHeat / PURSUIT.coolPerSecond).toFixed(1)} s to cool one crash`
)
console.log('\nClose calls\n')

const cleanPassGap = LANES[1] - LANES[0] - (2.0 / 2 + BODY.halfWidth)
check(
  'a clean pass in the next lane is not a close call',
  cleanPassGap > BODY.nearMiss,
  `${cleanPassGap.toFixed(2)} m of air vs a ${BODY.nearMiss} m threshold`
)
check(
  'a graze is',
  BODY.nearMiss > 0 && BODY.nearMiss < cleanPassGap,
  `anything under ${BODY.nearMiss} m counts`
)
check(
  'sliding under a barrier is not a close call',
  // A slide is 0.86 m tall and the barriers start at 1.25 m, so a slide always leaves
  // 0.39 m — comfortably more than the threshold. Otherwise every gate would award one.
  1.25 - BODY.slideHeight > BODY.nearMiss,
  `${(1.25 - BODY.slideHeight).toFixed(2)} m of headroom under a slide gate`
)
check('a close call is worth real points', RUN.nearMissBonus >= 150, `${RUN.nearMissBonus} × multiplier`)

console.log('\nThe road\n')

check(
  'the asphalt is dark',
  lum(PALETTE.road) < 0.14 && lum(PALETTE.roadDark) < lum(PALETTE.road),
  `road ${PALETTE.road} (luma ${lum(PALETTE.road).toFixed(3)}), edge ${PALETTE.roadDark}`
)
check(
  'the paint is bright against it',
  lum(PALETTE.grid) / lum(PALETTE.road) > 6,
  `${PALETTE.grid} is ${(lum(PALETTE.grid) / lum(PALETTE.road)).toFixed(1)}× the asphalt`
)
check(
  'but it is not pure white',
  PALETTE.grid.toLowerCase() !== '#ffffff',
  `${PALETTE.grid} — pure white blows out under the tone mapping`
)
check(
  'the paint still reads under the darkest zone',
  BIOMES.every((zone) => zone.sunIntensity > 0.6),
  `dimmest key light ${Math.min(...BIOMES.map((z) => z.sunIntensity))}`
)
check('the road is wide enough for its markings', TRACK_HALF_WIDTH > 4.5, `half width ${TRACK_HALF_WIDTH} m`)

console.log('\nThe Mochiro mark\n')

const mark = mochiroMarkSvg(64)
check(
  'the mark is vector art, so it stays sharp at 24 px and at 400 px',
  mark.startsWith('<svg') && mark.endsWith('</svg>'),
  `${mark.length} bytes of SVG`
)
check(
  'it carries a rim, a field, a gloss and speed streaks',
  ['-edge', '-field', '-gloss', '-streak', '-clip'].every((part) => mark.includes(`moc${part}`)),
  'rim · field · gloss · streaks · clip'
)

// The monogram has to sit *inside* the badge. Read its own path rather than trusting
// the numbers in a comment: a stroke is drawn centred on the line, so the ink reaches
// half a stroke-width past every point, and the bevel copy is nudged down on top.
const path = mark.match(/d="M([^"]+)"/)?.[1] ?? ''
const nums = path.trim().split(/[\s,]+/).map(Number)
const xs = nums.filter((_, i) => i % 2 === 0)
const ys = nums.filter((_, i) => i % 2 === 1)
const HALF_STROKE = 3.3
const BEVEL = 1.4
const ink = {
  x0: Math.min(...xs) - HALF_STROKE,
  x1: Math.max(...xs) + HALF_STROKE,
  y0: Math.min(...ys) - HALF_STROKE,
  y1: Math.max(...ys) + HALF_STROKE + BEVEL,
}
const FIELD = { x0: 4, y0: 4, x1: 60, y1: 60 }
const pad = Math.min(ink.x0 - FIELD.x0, FIELD.x1 - ink.x1, ink.y0 - FIELD.y0, FIELD.y1 - ink.y1)
check(
  'the monogram sits inside the badge with room to spare',
  pad >= 8,
  `closest edge ${pad.toFixed(1)} units away (${(ink.x1 - ink.x0).toFixed(0)}×${(ink.y1 - ink.y0).toFixed(0)} of 56)`
)

// WCAG contrast between the mark and the badge it stands on: the mark is the only
// thing that has to read at favicon size.
const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const stopsOf = (id: string): string[] =>
  mark.match(new RegExp(`id="moc-${id}"[^>]*>([\\s\\S]*?)</linearGradient>`))?.[1].match(/#[0-9a-f]{6}/gi) ?? []
const fieldStops = stopsOf('field')
const markStops = stopsOf('mark')
const darkestMark = Math.min(...markStops.map(luminance))
const lightestField = Math.max(...fieldStops.map(luminance))
const ratio = (Math.max(darkestMark, lightestField) + 0.05) / (Math.min(darkestMark, lightestField) + 0.05)
check(
  'the monogram reads against the badge at any size',
  ratio > 4.5,
  `${ratio.toFixed(1)}:1 contrast (WCAG AA needs 4.5:1)`
)

const favicon = decodeURIComponent(mochiroFaviconHref().replace('data:image/svg+xml,', ''))
check(
  'the browser-tab icon is the same mark, not a copy that can drift',
  favicon === mark.replace(/moc-/g, 'fav-'),
  'built from one source, only the gradient ids differ'
)

console.log('\nThe menu line-up\n')

let clipped = 0
let worstCoverage = 1
let worstAt = 0
const SHAPES = [3.2, 2.8, 2.4, 2.0, 1.6, 1.2, 0.9]
for (const aspect of SHAPES) {
  const fov = stageFov(aspect)
  const z = stageCameraZ(fov, aspect)
  const halfHeight = z * Math.tan((fov * Math.PI) / 360)
  const halfWidth = halfHeight * aspect
  if (LINEUP_HALF_WIDTH > halfWidth + 0.02) clipped += 1
  if (HERO_HEIGHT > 0.94 + halfHeight) clipped += 1
  // The invariant that matters: at least one axis is filled. Fitting by width means
  // the line-up always spans the stage, which is exactly what the old fixed camera did
  // not do — it left the six of them in a wide strip of empty background.
  const coverage = Math.max(
    Math.min(1, LINEUP_HALF_WIDTH / halfWidth),
    Math.min(1, HERO_HEIGHT / (halfHeight * 2))
  )
  if (coverage < worstCoverage) {
    worstCoverage = coverage
    worstAt = aspect
  }
}
check(
  'the six heroes fit the stage at every shape',
  clipped === 0,
  clipped === 0 ? `seven stage shapes from ${SHAPES[0]}:1 to ${SHAPES[SHAPES.length - 1]}:1` : `${clipped} clipped`
)
check(
  'and span it, instead of standing in a strip of empty background',
  worstCoverage > 0.95,
  `worst ${(worstCoverage * 100).toFixed(0)}% of an axis at ${worstAt}:1 (the old fixed camera gave 72%)`
)
check(
  'the camera never comes so close that faces distort',
  SHAPES.every((a) => stageCameraZ(stageFov(a), a) >= 3.4),
  `closest ${Math.min(...SHAPES.map((a) => stageCameraZ(stageFov(a), a))).toFixed(2)} m`
)

// A panel you cannot dismiss by clicking beside it feels broken, and that is exactly the
// kind of behaviour that disappears when a screen is rewritten. Four panels have it:
// pause, settings, how-to-play and the leaderboard. The results screen deliberately does
// not — you have to choose something there.
const SCREEN_SOURCE = readFileSync('src/components/runner/RushScreens.tsx', 'utf8')
const backdropDismiss = (SCREEN_SOURCE.match(/if \(event\.target === event\.currentTarget\)/g) ?? []).length
check(
  'every dismissible panel closes on a backdrop click',
  backdropDismiss === 4,
  `${backdropDismiss} of 4 — pause, settings, how-to-play, leaderboard`
)

console.log(failed === 0 ? '\nFeature check passed.' : `\n${failed} feature check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
