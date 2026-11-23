/**
 * Do the moving obstacles hit you with exactly what you can see — and can you always
 * get past them?
 *
 * A mover is collided with by `moverBox`, computed from the same pose `poseRig` draws.
 * This builds every look (procedural and with the prop pack), runs each one through
 * several whole cycles, and at every sampled frame compares the drawn hazard parts with
 * the box. Then it checks the fairness rules the patterns rely on:
 *
 *   - every mover leaves at least one lane it never enters;
 *   - in the lanes it works over, every pose can be passed by running, sliding or
 *     jumping (the rock wall and the near snowball excepted: those are dodges, and they
 *     are telegraphed);
 *   - the rock lands before you get there, never on you.
 *
 *   bun run scripts/mover-fit.ts
 */
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { BODY, LANES, PHYSICS } from '../src/runner/config'
import { bakeProps, type PropMap } from '../src/runner/obstacleSkins'
import {
  CROSSING,
  CROSSING_PERIOD,
  MOVER_LOOKS,
  MOVER_TYPES,
  PENDULUM,
  ROCKFALL,
  SCENERY_PARTS,
  SLIDER,
  SNOWBALL,
  SWEEPER,
  buildMoverBook,
  buildRig,
  createMover,
  dressRig,
  moverBox,
  moverMid,
  pendulumLength,
  poseRig,
  stepMover,
  type HitBox,
  type MoverPart,
  type MoverState,
  type MoverType,
} from '../src/runner/movers'

/** The box may stick out of the drawing by this much (an invisible hit is unfair). */
const OVER = 0.12
/** The drawing may stick out of the box by this much (a visible ghost-through is cheap). */
const UNDER = 0.3

let failed = 0
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
}

const apex = PHYSICS.jumpVelocity ** 2 / (2 * PHYSICS.gravity)
/** Nothing above this can touch the runner (head at the top of a jump). */
const REACH = apex + BODY.standHeight + 0.3
const PERIOD: Record<MoverType, number> = {
  roller: 2,
  snowball: 2,
  slider: SLIDER.period,
  crossing: CROSSING_PERIOD,
  pendulum: PENDULUM.period,
  rockfall: 2,
  sweeper: SWEEPER.period,
  hauler: 2,
}
/** The lanes each pattern puts the type on (both kerbs for the crossing). */
const LAYOUTS: Record<MoverType, Array<{ lanes: number[]; side: 1 | -1 }>> = {
  roller: [{ lanes: [0], side: 1 }, { lanes: [2], side: 1 }],
  snowball: [{ lanes: [1], side: 1 }],
  slider: [{ lanes: [0, 1], side: 1 }, { lanes: [1, 2], side: 1 }],
  crossing: [{ lanes: [1, 2], side: 1 }, { lanes: [0, 1], side: -1 }],
  pendulum: [{ lanes: [0, 1], side: 1 }, { lanes: [1, 2], side: 1 }],
  rockfall: [{ lanes: [2], side: 1 }],
  sweeper: [{ lanes: [1], side: 1 }],
  hauler: [{ lanes: [0], side: 1 }],
}
const rootXOf = (m: MoverState): number =>
  m.type === 'crossing' ? 0 : m.type === 'slider' || m.type === 'pendulum' ? moverMid(m) : LANES[m.lanes[0]]

async function loadProps(): Promise<PropMap> {
  const file = readFileSync(new URL('../src/assets/models/obstacle-props.glb', import.meta.url))
  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => loader.parse(data, '', resolve, reject))
  return bakeProps(gltf.scene)
}

interface Aabb {
  min: THREE.Vector3
  max: THREE.Vector3
  any: boolean
}

const v = new THREE.Vector3()
/** World bounds of the hazard parts as drawn (the pendulum: the bob, not its rope). */
function drawnBounds(rig: ReturnType<typeof buildRig>, m: MoverState): Aabb {
  const out: Aabb = { min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity), any: false }
  const bob = PENDULUM.bob[m.look] ?? PENDULUM.bob.log
  const ropeEnd = -pendulumLength(m.look) + bob[1] / 2 + 0.02
  for (const [name, mesh] of Object.entries(rig.parts) as Array<[MoverPart | 'mark', THREE.Mesh]>) {
    if (name === 'mark' || SCENERY_PARTS.includes(name as MoverPart) || !mesh.visible) continue
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
    if (!pos) continue
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      if (m.type === 'pendulum' && v.y > ropeEnd) continue
      v.applyMatrix4(mesh.matrixWorld)
      out.min.min(v)
      out.max.max(v)
      out.any = true
    }
  }
  return out
}

/** The crossing boom over a runner span: lowest and highest drawn surface in reach. */
const ray = new THREE.Raycaster()
const down = new THREE.Vector3(0, -1, 0)
const up = new THREE.Vector3(0, 1, 0)
function boomUnder(boom: THREE.Mesh, x: number, half: number): { bottom: number; top: number } | null {
  let bottom = Infinity
  let top = -Infinity
  for (let k = 0; k <= 8; k++) {
    const px = x - half + (2 * half * k) / 8
    for (const pz of [-0.05, 0, 0.05]) {
      ray.set(new THREE.Vector3(px, 12, pz), down)
      const all = ray.intersectObject(boom, false)
      ray.set(new THREE.Vector3(px, -1, pz), up)
      all.push(...ray.intersectObject(boom, false))
      for (const hit of all) {
        if (hit.point.y > REACH) continue
        top = Math.max(top, hit.point.y)
        bottom = Math.min(bottom, hit.point.y)
      }
    }
  }
  return top > -Infinity ? { bottom, top } : null
}

/** Is a runner at lane x, feet at y, body `height` tall, inside the box? (the game's test) */
function hits(m: MoverState, x: number, y: number, height: number, box: HitBox): boolean {
  if (!moverBox(m, x, BODY.halfWidth, box)) return false
  const lateral = Math.abs(box.x - x) - (box.width / 2 + BODY.halfWidth)
  if (lateral > -BODY.forgiveness) return false
  if (y + height <= box.bottom + BODY.forgiveness) return false
  if (y >= box.top) return false
  return true
}

const props = await loadProps()
const material = new THREE.MeshBasicMaterial()
const empty = new THREE.BufferGeometry()
const ringGeo = new THREE.RingGeometry(0.5, 1, 8)
const box: HitBox = { x: 0, width: 0, bottom: 0, top: 0, depth: 0, platform: 0 }

console.log('Drawn hazard vs collision box, over whole cycles\n')
for (const [label, book] of [['procedural', buildMoverBook(null)], ['with kit', buildMoverBook(props)]] as const) {
  for (const type of MOVER_TYPES) {
    for (const look of MOVER_LOOKS[type]) {
      for (const layout of LAYOUTS[type]) {
        const rig = buildRig(type, material, { geometry: ringGeo, material })
        dressRig(rig, book, look, empty)
        const m = createMover(type, look, layout.lanes, -150, layout.side, 0)
        let worst = { over: 0, under: 0, where: '' }
        let samples = 0
        let bad = ''
        const speed = 22
        const dt = 1 / 60
        let z = -150
        for (let f = 0; f < 60 * Math.max(3 * PERIOD[type], 7); f++) {
          const time = f * dt
          z = Math.min(0, -150 + speed * time)
          stepMover(m, time, dt, z, speed)
          if (f % 3) continue
          const rootX = rootXOf(m)
          rig.root.position.set(rootX, 0, 0)
          poseRig(rig, m, rootX, time)
          rig.root.updateMatrixWorld(true)
          const note = (what: string, over: number, under: number) => {
            if (over > worst.over) worst = { ...worst, over, where: `${what} t=${time.toFixed(2)}` }
            if (under > worst.under) worst = { ...worst, under, where: worst.where || `${what} t=${time.toFixed(2)}` }
            if (!bad && (over > OVER || under > UNDER)) bad = `${what} t=${time.toFixed(2)} over ${over.toFixed(2)} under ${under.toFixed(2)}`
          }
          if (type === 'crossing') {
            for (const lx of LANES) {
              const live = moverBox(m, lx, BODY.halfWidth, box) && box.bottom < REACH - OVER
              const drawn = boomUnder(rig.parts.boom as THREE.Mesh, lx, BODY.halfWidth)
              samples += 1
              if (!live && !drawn) continue
              if (!live || !drawn) {
                // A sliver at the very edge of the span is fine; a whole missing bar is not.
                const sliver = live ? box.width < 0.2 : false
                if (!sliver && !bad) bad = `lane ${lx} t=${time.toFixed(2)}: box ${live ? 'live' : 'none'}, drawn ${drawn ? 'yes' : 'no'}`
                continue
              }
              note(`lane ${lx} bottom`, drawn.bottom - box.bottom, box.bottom - drawn.bottom)
              const boxTop = Math.min(box.top, REACH)
              note(`lane ${lx} top`, boxTop - drawn.top, drawn.top - boxTop)
            }
            continue
          }
          const live = moverBox(m, LANES[1], BODY.halfWidth, box)
          const drawn = drawnBounds(rig, m)
          samples += 1
          if (!live) {
            if (drawn.any && drawn.min.y < 3 && !bad) bad = `t=${time.toFixed(2)}: drawn at y ${drawn.min.y.toFixed(2)} but no box`
            continue
          }
          const lo = box.x - box.width / 2
          const hi = box.x + box.width / 2
          note('left', drawn.min.x - lo, lo - drawn.min.x)
          note('right', hi - drawn.max.x, drawn.max.x - hi)
          note('bottom', drawn.min.y - box.bottom, box.bottom - drawn.min.y)
          note('top', box.top - drawn.max.y, drawn.max.y - box.top)
          const reach = Math.max(-drawn.min.z, drawn.max.z)
          note('depth', box.depth / 2 - reach, reach - box.depth / 2)
        }
        check(
          `${label} ${type}/${look} lanes ${layout.lanes.join('+')}`,
          !bad,
          bad || `${samples} poses, box out by ≤${worst.over.toFixed(2)}, drawing out by ≤${worst.under.toFixed(2)}${worst.where ? ` (${worst.where})` : ''}`
        )
      }
    }
  }
}

console.log('\nWays through\n')
for (const type of MOVER_TYPES) {
  for (const layout of LAYOUTS[type]) {
    const look = MOVER_LOOKS[type][0]
    const m = createMover(type, look, layout.lanes, -150, layout.side, 0)
    const everHit = [false, false, false]
    let stuck = ''
    const speeds = type === 'rockfall' ? [8, 14, 22, 30, 40] : [22]
    let landedAt = Infinity
    for (const speed of speeds) {
      m.drop = -1
      m.z0 = -150
      const dt = 1 / 60
      for (let f = 0; f < 60 * Math.max(3 * PERIOD[type], 150 / speed + 1); f++) {
        const time = f * dt
        const z = Math.min(0, -150 + speed * time)
        stepMover(m, time, dt, z, speed)
        if (m.landed) landedAt = Math.min(landedAt, -z)
        // Only the poses you can actually meet: the last stretch of the approach.
        const near = z > -12
        if (type !== 'rockfall' && type !== 'snowball' ? false : !near) continue
        for (let lane = 0; lane < 3; lane++) {
          const x = LANES[lane]
          const run = hits(m, x, 0, BODY.standHeight, box)
          if (run) everHit[lane] = true
          if (!layout.lanes.includes(lane) || !run) continue
          const slide = hits(m, x, 0, BODY.slideHeight, box)
          // Jumping: the box top has to be under the jump's reach.
          const jump = !moverBox(m, x, BODY.halfWidth, box) || box.top <= apex - 0.15
          const dodge = type === 'rockfall' || type === 'snowball' || type === 'roller' || type === 'hauler'
          if (slide && !jump && !dodge && !stuck) stuck = `lane ${lane} t=${time.toFixed(2)}: box ${box.bottom.toFixed(2)}…${box.top.toFixed(2)}`
        }
      }
    }
    const free = everHit.map((hit, lane) => (hit ? -1 : lane)).filter((lane) => lane >= 0)
    check(`${type} on ${layout.lanes.join('+')}${type === 'crossing' ? ` (side ${layout.side})` : ''}: a lane it never enters`, free.length > 0, `free lane(s) ${free.join(', ') || 'none'}`)
    check(`${type} on ${layout.lanes.join('+')}: every pose can be run, slid or jumped`, !stuck, stuck || 'yes')
    if (type === 'rockfall') check('rockfall lands before you get there, at every speed', landedAt >= 4, `lands ≥ ${landedAt.toFixed(1)} m ahead`)
  }
}

// The snowball is a dodge by design: jumpable far out, never in the last stretch.
{
  const m = createMover('snowball', 'snow', [1], -150)
  stepMover(m, 0, 0, SNOWBALL.fullAt + 1, 22)
  moverBox(m, LANES[1], BODY.halfWidth, box)
  check('snowball is too tall to jump by the last stretch', box.top > apex, `top ${box.top.toFixed(2)} m vs jump ${apex.toFixed(2)} m`)
  stepMover(m, 0, 0, -140, 22)
  moverBox(m, LANES[1], BODY.halfWidth, box)
  check('…and jumpable when it starts out', box.top < apex - 0.3, `top ${box.top.toFixed(2)} m`)
}
// The rock wall cannot be jumped: you change lane for it, warned by its ring.
check('the rock wall is a dodge, not a jump', ROCKFALL.height > apex, `${ROCKFALL.height} m vs ${apex.toFixed(2)} m`)
check('the crossing boom clears a slide and blocks a stand', CROSSING.pivotY - CROSSING.thick / 2 + BODY.forgiveness > BODY.slideHeight && CROSSING.pivotY - CROSSING.thick / 2 + BODY.forgiveness < BODY.standHeight, `boom underside ${(CROSSING.pivotY - CROSSING.thick / 2).toFixed(2)} m`)
check('the pendulum clears a slide and blocks a stand', PENDULUM.clearance + BODY.forgiveness > BODY.slideHeight && PENDULUM.clearance + BODY.forgiveness < BODY.standHeight, `clearance ${PENDULUM.clearance} m`)

console.log(failed ? `\n${failed} check(s) failed` : '\nAll mover checks passed')
process.exit(failed ? 1 : 0)
