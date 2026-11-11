/**
 * The collision sweep, checked without a browser.
 *
 * The bug this exists for: at full speed a single frame covers more ground than a
 * small obstacle is deep. The sweep used to widen its window to cover that —
 * `depth/2 + 0.55 + min(2.4, dz/2)` — which reached 2.75 m up the road, so the
 * height test ran while the obstacle was still metres away. A runner judged by the
 * height they had a step earlier could be waved through an obstacle their body was
 * still inside, and a "pass over" edge with 12 cm of forgiveness let them through a
 * low wall while barely off the ground.
 *
 * The rule is now: contact is either *beside the runner now*, or *swept past them
 * during this step* — and in the second case the height that decides the hit is the
 * one from the start of the step. No window, no forgiveness on the top edge.
 *
 * Two things are asserted here, at every speed and frame time the game can produce:
 *
 *  1. **Nothing slips through.** An obstacle the runner's body intersects is always
 *     a hit, and an obstacle that crosses the runner is never missed entirely.
 *  2. **The intended passes still work.** A slide still fits under a gate, and feet
 *     above an obstacle's top still clear it.
 *
 *   bun run scripts/sweep-check.ts
 */
import { BODY, OBSTACLES, RUN, type ObstacleSpec } from '../src/runner/config'

let failed = 0
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
}

/** Longest step the game can take: Runner clamps dt to this. */
const MAX_DT = 0.05
const RUNNER_REACH = 0.55
const speeds = [RUN.startSpeed, 24, RUN.maxSpeed, RUN.maxSpeed * RUN.boostSpeedMult]
const steps = [1 / 60, 1 / 30, MAX_DT]

type Verdict = 'clear' | 'hit' | 'under' | 'over'

/**
 * Mirrors `Runner.checkObstacles`. Geometry only — the ghost, boost and ramp
 * branches are gameplay on top of it and are checked elsewhere.
 */
function verdict(
  spec: ObstacleSpec,
  z: number,
  dz: number,
  y: number,
  previousY: number,
  height: number,
  laneX: number,
  obstacleX: number
): Verdict {
  const reach = spec.depth / 2 + RUNNER_REACH
  const previousZ = z - dz
  const alongside = Math.abs(z) <= reach
  const crossed = previousZ > reach && z < -reach
  if (!alongside && !crossed) return 'clear'
  if (Math.abs(obstacleX - laneX) > spec.width / 2 + BODY.halfWidth - BODY.forgiveness) return 'clear'
  const at = crossed ? previousY : y
  const bottom = spec.bottom
  const top = spec.bottom + spec.height
  if (at + height <= bottom + BODY.forgiveness) return 'under'
  if (at >= top) return 'over'
  return 'hit'
}

/**
 * How deep the runner's box is inside the obstacle's box, in metres. Zero when they
 * are clear of each other. The rule is allowed to wave through a graze no deeper
 * than `BODY.forgiveness` — that is the fairness tolerance and it is deliberate —
 * but anything deeper than that has to be a hit.
 */
function overlapDepth(spec: ObstacleSpec, z: number, y: number, height: number): number {
  const withinZ = Math.abs(z) <= spec.depth / 2 + RUNNER_REACH
  if (!withinZ) return 0
  const bottom = spec.bottom
  const top = spec.bottom + spec.height
  return Math.max(0, Math.min(y + height, top) - Math.max(y, bottom))
}

const kinds = Object.values(OBSTACLES)

// ---------------------------------------------------------------- coverage ---

console.log('Nothing slips through\n')
for (const spec of kinds) {
  for (const speed of speeds) {
    for (const dt of steps) {
      const dz = speed * dt
      // Walk the obstacle from well ahead of the runner to well behind it.
      let seen = false
      for (let z = 12; z > -12; z -= dz) {
        if (verdict(spec, z, dz, 0, 0, BODY.standHeight, 0, 0) !== 'clear') {
          seen = true
          break
        }
      }
      check(
        `${spec.kind}: a standing runner is never missed`,
        seen,
        `${speed.toFixed(1)} m/s · ${dt.toFixed(3)}s frames · step ${dz.toFixed(2)} m`
      )
    }
  }
}

// ------------------------------------------------------- the body decides ---

console.log('\nThe body decides — sliding included\n')
const heights: Array<[string, number]> = [
  ['standing', BODY.standHeight],
  ['sliding', BODY.slideHeight],
]
for (const spec of kinds) {
  for (const [label, height] of heights) {
    for (const speed of speeds) {
      const dz = speed * steps[2]
      // A runner whose feet are below the obstacle's top is inside it. Walk both
      // the approach and a range of heights, and demand a hit whenever the boxes
      // genuinely overlap.
      let worst = ''
      let deepest = 0
      for (let y = 0; y <= spec.bottom + spec.height + 0.4; y += 0.05) {
        for (let z = 6; z > -6; z -= dz) {
          const depth = overlapDepth(spec, z, y, height)
          if (depth <= BODY.forgiveness) continue
          if (verdict(spec, z, dz, y, y, height, 0, 0) === 'hit') continue
          if (depth > deepest) {
            deepest = depth
            worst = `y=${y.toFixed(2)} z=${z.toFixed(2)} buried ${depth.toFixed(2)} m`
          }
        }
      }
      check(
        `${spec.kind}: a ${label} body inside it is always hit`,
        worst === '',
        worst || `no overlap deeper than the ${BODY.forgiveness} m fairness tolerance`
      )
    }
  }
}

// ------------------------------------------------------- the bug that was ---

console.log('\nThe cases that used to slip through\n')
const low = OBSTACLES.low
check(
  'a runner barely off the ground no longer passes through a low wall',
  verdict(low, 0, 0.5, 0.85, 0.85, BODY.standHeight, 0, 0) === 'hit',
  `feet 0.85 m against a wall ${low.height} m tall`
)
check(
  'the old sweep window would have waved that through',
  0.85 >= low.bottom + low.height - BODY.forgiveness,
  `0.85 m against the old "feet above the top" edge of ${(low.height - BODY.forgiveness).toFixed(2)} m`
)
const dz = RUN.maxSpeed * RUN.boostSpeedMult * MAX_DT
check(
  'an obstacle that crosses the runner in one frame is caught',
  verdict(low, -low.depth / 2 - 0.2, dz, 0, 0, BODY.standHeight, 0, 0) === 'hit',
  `step ${dz.toFixed(2)} m against a ${low.depth} m deep obstacle`
)

// -------------------------------------------------------- the good passes ---

console.log('\nThe intended passes still work\n')
check(
  'a slide still fits under the gateway',
  verdict(OBSTACLES.tunnel, 0, 0.5, 0, 0, BODY.slideHeight, 0, 0) === 'under',
  `sliding height ${BODY.slideHeight} m against a ${OBSTACLES.tunnel.bottom} m opening`
)
check(
  'standing up does not fit under the gateway',
  verdict(OBSTACLES.tunnel, 0, 0.5, 0, 0, BODY.standHeight, 0, 0) === 'hit',
  `standing height ${BODY.standHeight} m against a ${OBSTACLES.tunnel.bottom} m gap`
)
check(
  'a runner clear above an obstacle passes over it',
  verdict(OBSTACLES.low, 0, 0.5, 1.2, 1.2, BODY.standHeight, 0, 0) === 'over',
  `feet 1.2 m against a wall ${low.height} m tall`
)
check(
  'a runner on a car roof is not hit by the car',
  verdict(OBSTACLES.car, 0, 0.5, OBSTACLES.car.platformTop!, 0, BODY.standHeight, 0, 0) === 'over',
  `feet at the platform top of ${OBSTACLES.car.platformTop} m`
)
check(
  'a different lane is not a hit',
  verdict(OBSTACLES.tall, 0, 0.5, 0, 0, BODY.standHeight, 0, 2.3) === 'clear',
  'one lane over'
)

console.log(failed === 0 ? '\nSweep check passed.' : `\n${failed} sweep check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
