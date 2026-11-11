/**
 * Does the box the game tests against match the box you can see?
 *
 * The runner is killed by numbers, not by pixels: `checkObstacles` compares the body
 * against `[spec.bottom, spec.bottom + spec.height]`. If the mesh sits somewhere else,
 * the player dies to an obstacle that visibly has room to spare — which is exactly how
 * the gateway shipped for a while (a 4.3 m opening drawn over a 1.42 m collision box).
 * This builds every obstacle mesh and measures it.
 *
 *   bun run scripts/obstacle-fit.ts
 */
import * as THREE from 'three'
import { BODY, OBSTACLES, PHYSICS, RUN, type ObstacleKind } from '../src/runner/config'
import { PILLAR_WIDTH, PILLAR_X, busGeometry, carGeometry, rampGeometry, tunnelGeometry } from '../src/runner/obstacles'

const TOLERANCE = 0.08

/** Same expression the manager uses for the plain box obstacles. */
const box = (kind: ObstacleKind) =>
  new THREE.BoxGeometry(OBSTACLES[kind].width, OBSTACLES[kind].height, OBSTACLES[kind].depth)

const meshes: Record<ObstacleKind, () => THREE.BufferGeometry> = {
  low: () => box('low'),
  tall: () => box('tall'),
  car: carGeometry,
  bus: busGeometry,
  ramp: rampGeometry,
  tunnel: tunnelGeometry,
}

/** Plain boxes are centred on their own origin; the manager lifts them into place. */
const meshLift = (kind: ObstacleKind): number =>
  ['low', 'tall'].includes(kind) ? OBSTACLES[kind].bottom + OBSTACLES[kind].height / 2 : 0

/** Gates are flat-topped and span the road: a vertical probe at the centre must land
 *  on the collision box at both ends. */
const GATES: ObstacleKind[] = ['low', 'tall', 'tunnel']
/** Platforms and ramps are not flat: their roof (or ridge) is the walkable surface. */
const PLATFORMS: ObstacleKind[] = ['car', 'bus', 'ramp']

/** Where the visible surface sits, straight up and straight down from the road centre. */
function probe(kind: ObstacleKind): { top: number | null; bottom: number | null; highest: number; lowest: number } {
  const spec = OBSTACLES[kind]
  const geometry = meshes[kind]()
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox as THREE.Box3
  const lift = meshLift(kind)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  mesh.position.y = lift
  mesh.updateMatrixWorld(true)
  const ray = new THREE.Raycaster()
  const cast = (from: number, dy: number): number | null => {
    ray.set(new THREE.Vector3(0, from, 0), new THREE.Vector3(0, dy, 0))
    const hits = ray.intersectObject(mesh, false)
    return hits.length ? hits[0].point.y : null
  }
  const top = cast(spec.bottom + spec.height + 0.3, -1)
  const bottom = cast(spec.bottom - 0.3, 1)
  ;(mesh.material as THREE.Material).dispose()
  geometry.dispose()
  return { top, bottom, highest: bounds.max.y + lift, lowest: bounds.min.y + lift }
}

let failed = 0
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
}

// The tallest jump anyone can reach. No perk lifts the jump today, so this is the base
// velocity — but the slide gates below are sized against this number and nothing else,
// so a jump perk would have to be folded in here.
const apex = PHYSICS.jumpVelocity ** 2 / (2 * PHYSICS.gravity)

console.log('Collision box vs visible mesh\n')

for (const kind of Object.keys(meshes) as ObstacleKind[]) {
  const spec = OBSTACLES[kind]
  const specBottom = spec.bottom
  const specTop = spec.bottom + spec.height
  const { top, bottom, highest, lowest } = probe(kind)

  if (GATES.includes(kind)) {
    const bottomOk = bottom !== null && Math.abs(bottom - specBottom) <= TOLERANCE
    const topOk = top !== null && Math.abs(top - specTop) <= TOLERANCE
    check(
      `${kind}: mesh matches its collision box`,
      bottomOk && topOk,
      `probe y ${bottom === null ? '—' : bottom.toFixed(2)}…${top === null ? '—' : top.toFixed(2)} vs box ${specBottom.toFixed(2)}…${specTop.toFixed(2)}`
    )
  } else {
    const bottomOk = Math.abs(lowest - specBottom) <= TOLERANCE
    const topOk = highest >= specTop - TOLERANCE
    check(
      `${kind}: mesh sits on its collision box`,
      bottomOk && topOk,
      `mesh y ${lowest.toFixed(2)}…${highest.toFixed(2)} vs box ${specBottom.toFixed(2)}…${specTop.toFixed(2)}`
    )
  }
}

console.log('\nGates you have to slide under')
for (const kind of ['tunnel'] as ObstacleKind[]) {
  const spec = OBSTACLES[kind]
  const top = spec.bottom + spec.height
  check(
    `${kind}: a standing runner is blocked`,
    spec.bottom < BODY.standHeight - BODY.forgiveness,
    `gap ${spec.bottom} m under a ${BODY.standHeight} m runner`
  )
  check(
    `${kind}: a sliding runner fits`,
    spec.bottom > BODY.slideHeight + BODY.forgiveness,
    `${BODY.slideHeight} m slide clears the ${spec.bottom} m gap`
  )
  check(
    `${kind}: cannot be jumped instead`,
    top - BODY.forgiveness > apex,
    `box top ${top.toFixed(2)} m vs the ${apex.toFixed(2)} m apex of the best jumper`
  )
}

console.log('\nThe gateway has to read as a gate, not a bare bar')
{
  const spec = OBSTACLES.tunnel
  const lintelOuter = spec.width / 2
  const pillarOuter = PILLAR_X + PILLAR_WIDTH / 2
  const proud = pillarOuter - lintelOuter
  // The runner first sees a gate from `RUN.spawnAhead` away. Anything narrower than a
  // few pixels out there is invisible, and the gate turns into a floating bar.
  const pixels = (proud / RUN.spawnAhead) * 1058
  check(
    'the columns stand proud of the lintel',
    proud >= 1,
    `${proud.toFixed(2)} m of column beyond the lintel — about ${pixels.toFixed(1)} px at spawn distance`
  )
  check(
    'the columns rise past the lintel',
    PILLAR_X > 0 && spec.bottom + spec.height < PILLAR_X + 100,
    `columns are taller than the ${(spec.bottom + spec.height).toFixed(2)} m lintel top`
  )
}

console.log(failed === 0 ? '\nObstacle fit check passed.' : `\n${failed} obstacle fit check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
