/**
 * Can a tree stand in front of an Arc billboard?
 *
 * The camera rides high and far behind the runner, so a canopy does not have to be
 * *at* the sign to hide it — a tree ten metres nearer the camera and four metres
 * further out still lands on the same pixels. This reproduces the scenery layout with
 * the real numbers and projects both the billboards and the tree line onto the camera,
 * then fails if anything in front of a sign overlaps it.
 *
 *   bun run scripts/billboard-check.ts
 */
import * as THREE from 'three'
import { RUN } from '../src/runner/config'
import { clearOfBillboards } from '../src/runner/scenery'
import { makePine, makeTree } from '../src/runner/town'
import { makeRng } from '../src/runner/utils'

// Layout constants, mirrored from scenery.ts.
const CHUNK_LENGTH = 52
const CHUNK_COUNT = 6
const TREES_PER_SIDE = 3
const PINES_PER_SIDE = 1
const BILLBOARD_Y = 4.7
const BILLBOARD_HALF_HEIGHT = 1.1
const LAMPS_PER_SIDE = 2
const LAMP_X = 7.0
/** How far a lamp post reaches towards the road. */
const LAMP_INNER = 0.22
/** Top of the lamp head — level with the artwork, which is why a lamp can cross it. */
const LAMP_TOP = 4.3

const SEED = 90210
const rng = makeRng(SEED)
const randRange = (lo: number, hi: number): number => lo + rng() * (hi - lo)
const planRng = makeRng(SEED ^ 0x5eed)
const planRange = (lo: number, hi: number): number => lo + planRng() * (hi - lo)

/** Worst-case canopy and crown, measured from the generators themselves. */
function canopy(geometry: THREE.BufferGeometry, scale: number) {
  geometry.computeBoundingSphere()
  const sphere = geometry.boundingSphere as THREE.Sphere
  return { radius: sphere.radius * scale, offset: sphere.center.y * scale, lift: 0 }
}

let canopyRadius = 0
let canopyTop = 0
{
  for (let i = 0; i < 40; i += 1) {
    for (const build of [makeTree, makePine]) {
      const shape = canopy(build(rng), 1.35)
      canopyRadius = Math.max(canopyRadius, shape.radius)
      canopyTop = Math.max(canopyTop, shape.radius + shape.offset)
    }
  }
}

interface Tree {
  side: number
  x: number
  z: number
  /** Half-width of the silhouette, measured towards the road. */
  inner: number
  /** Top of the object, in metres. */
  top: number
}

// Claim the signs first, exactly as the scenery does.
const BILLBOARD_HALF_WIDTH = 2.2
const billboardPlan: Array<Array<{ side: number; x: number; halfWidth: number; z: number }>> = []
for (let c = 0; c < CHUNK_COUNT; c += 1) {
  const boards: Array<{ side: number; x: number; halfWidth: number; z: number }> = []
  if (c % 2 === 0) {
    for (const side of [-1, 1]) {
      boards.push({ side, x: side * 8.7, halfWidth: BILLBOARD_HALF_WIDTH, z: -planRange(6, CHUNK_LENGTH - 8) })
    }
  }
  billboardPlan.push(boards)
}

const trees: Tree[] = []
const billboards: Array<{ side: number; x: number; z: number }> = []
for (let c = 0; c < CHUNK_COUNT; c += 1) {
  const boards = billboardPlan[c]
  const offset = -c * CHUNK_LENGTH
  for (const board of boards) billboards.push({ side: board.side, x: board.side * 8.7, z: board.z + offset })
  // Neighbouring signs too — a tree overflows its own chunk.
  const nearby: Array<{ side: number; x: number; halfWidth: number; z: number }> = []
  for (let k = Math.max(0, c - 1); k <= Math.min(CHUNK_COUNT - 1, c + 1); k += 1) {
    for (const board of billboardPlan[k]) nearby.push({ ...board, z: board.z - (k - c) * CHUNK_LENGTH })
  }

  for (let i = 0; i < TREES_PER_SIDE; i += 1) {
    for (const side of [-1, 1]) {
      const z = -((i + 0.5) / TREES_PER_SIDE) * CHUNK_LENGTH - randRange(-5, 5)
      const x = side * randRange(9.6, 13.4)
      trees.push({
        side,
        x,
        z: clearOfBillboards(side, x, canopyRadius, z, offset, nearby, () => randRange(0, 5)) + offset,
        inner: canopyRadius,
        top: canopyTop,
      })
    }
  }
  for (let i = 0; i < PINES_PER_SIDE; i += 1) {
    for (const side of [-1, 1]) {
      const z = -((i + 0.35) / PINES_PER_SIDE) * CHUNK_LENGTH - randRange(-8, 8)
      const x = side * randRange(10.5, 14.5)
      trees.push({
        side,
        x,
        z: clearOfBillboards(side, x, canopyRadius, z, offset, nearby, () => randRange(0, 5)) + offset,
        inner: canopyRadius,
        top: canopyTop,
      })
    }
  }
  for (let i = 0; i < LAMPS_PER_SIDE; i += 1) {
    for (const side of [-1, 1]) {
      const z = -((i + 0.5) / LAMPS_PER_SIDE) * CHUNK_LENGTH
      trees.push({
        side,
        x: side * LAMP_X,
        z: clearOfBillboards(side, side * LAMP_X, LAMP_INNER, z, offset, nearby, () => randRange(0, 5)) + offset,
        inner: LAMP_INNER,
        top: LAMP_TOP,
      })
    }
  }
}

/** Screen-space span of a horizontal slice at distance |camZ - z|, as a ratio of depth. */
const span = (x: number, halfWidth: number, z: number, camZ: number): [number, number] => {
  const depth = camZ - z
  return [(x - halfWidth) / depth, (x + halfWidth) / depth]
}

let failed = 0
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
}

console.log(`Worst-case canopy: radius ${canopyRadius.toFixed(2)} m, top ${canopyTop.toFixed(2)} m\n`)

// The camera pulls back during a run, so test the near and far ends of its travel.
for (const camZ of [RUN.camDistance, RUN.camDistance + 2.4]) {
  let worst = Infinity
  let worstNote = 'nothing in front of a sign'
  for (const board of billboards) {
    // A canopy only hides the sign if it is nearer the camera and its band reaches
    // the artwork: the sign hangs at 3.6–5.8 m, the crowns run up past 7 m.
    const boardSpan = span(board.x, BILLBOARD_HALF_WIDTH, board.z, camZ)
    for (const tree of trees) {
      if (tree.side !== board.side || tree.z <= board.z) continue
      if (tree.z - board.z > 40) continue
      if (tree.top < BILLBOARD_Y - BILLBOARD_HALF_HEIGHT) continue
      const treeSpan = span(tree.x, tree.inner, tree.z, camZ)
      const gap = Math.max(boardSpan[0] - treeSpan[1], treeSpan[0] - boardSpan[1])
      if (gap < worst) {
        worst = gap
        worstNote = `tree x ${tree.x.toFixed(1)} z ${tree.z.toFixed(1)} vs sign x ${board.x.toFixed(1)} z ${board.z.toFixed(1)}`
      }
    }
  }
  check(
    `camera at z ${camZ.toFixed(1)}: no canopy crosses a billboard`,
    worst >= 0,
    worst === Infinity ? worstNote : `${worst >= 0 ? 'closest approach' : 'overlap'} ${worst.toFixed(3)} (${worstNote})`
  )
}

// The same rule has to hold for layouts nobody has seen yet, so sweep random ones.
console.log('\nSweeping random layouts')
{
  const sweepRng = makeRng(4242)
  const range = (lo: number, hi: number): number => lo + sweepRng() * (hi - lo)
  let worstGap = Infinity
  let offenders = 0
  for (let trial = 0; trial < 400; trial += 1) {
    const boards = [-1, 1].map((side) => ({ side, x: side * 8.7, halfWidth: BILLBOARD_HALF_WIDTH, z: -range(6, CHUNK_LENGTH - 8) }))
    const probes: Tree[] = []
    for (let i = 0; i < TREES_PER_SIDE * 2; i += 1) {
      const side = i % 2 === 0 ? -1 : 1
      const x = side * range(9.6, 13.4)
      const z = -range(0, CHUNK_LENGTH + 10)
      probes.push({ side, x, z: clearOfBillboards(side, x, canopyRadius, z, 0, boards, () => range(0, 5)), inner: canopyRadius, top: canopyTop })
    }
    for (let i = 0; i < LAMPS_PER_SIDE * 2; i += 1) {
      const side = i % 2 === 0 ? -1 : 1
      const z = -range(0, CHUNK_LENGTH + 10)
      probes.push({ side, x: side * LAMP_X, z: clearOfBillboards(side, side * LAMP_X, LAMP_INNER, z, 0, boards, () => range(0, 5)), inner: LAMP_INNER, top: LAMP_TOP })
    }
    for (const board of boards) {
      const boardSpan = span(board.x, board.halfWidth, board.z, RUN.camDistance + 2.4)
      for (const probe of probes) {
        if (probe.side !== board.side || probe.z <= board.z) continue
        if (probe.top < BILLBOARD_Y - BILLBOARD_HALF_HEIGHT) continue
        const probeSpan = span(probe.x, probe.inner, probe.z, RUN.camDistance + 2.4)
        const gap = Math.max(boardSpan[0] - probeSpan[1], probeSpan[0] - boardSpan[1])
        worstGap = Math.min(worstGap, gap)
        if (gap < 0) offenders += 1
      }
    }
  }
  check('400 random layouts stay clear', offenders === 0, `${offenders} crossing(s), closest approach ${worstGap.toFixed(3)}`)
}

console.log(failed === 0 ? '\nBillboard sightline check passed.' : `\n${failed} billboard check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
