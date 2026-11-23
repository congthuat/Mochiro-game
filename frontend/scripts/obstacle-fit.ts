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
import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { bakeCars } from '../src/runner/cars'
import { SKIN_KINDS, THEMES, THEME_OF, bakeProps, buildSkins } from '../src/runner/obstacleSkins'
import { PILLAR_WIDTH, PILLAR_X, busGeometry, carGeometry, laserGeometry, rampGeometry, truckGeometry, tunnelGeometry } from '../src/runner/obstacles'

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
  truck: truckGeometry,
  laserLow: () => laserGeometry('laserLow'),
  laserHigh: () => laserGeometry('laserHigh'),
}

/** Plain boxes are centred on their own origin; the manager lifts them into place. */
const meshLift = (kind: ObstacleKind): number =>
  ['low', 'tall'].includes(kind) ? OBSTACLES[kind].bottom + OBSTACLES[kind].height / 2 : 0

/** Gates are flat-topped and span the road: a vertical probe at the centre must land
 *  on the collision box at both ends. */
const GATES: ObstacleKind[] = ['low', 'tall', 'tunnel', 'laserLow', 'laserHigh']
/** Platforms and ramps are not flat: their roof (or ridge) is the walkable surface. */
const PLATFORMS: ObstacleKind[] = ['car', 'bus', 'ramp', 'truck']

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

console.log('\nThe KayKit cars: every body stands on its own collision box')
{
  const file = readFileSync(new URL('../src/assets/models/kaykit-cars.glb', import.meta.url))
  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  // No DOM here, so the atlas texture cannot decode; geometry is all this needs.
  const quiet = console.error
  console.error = () => {}
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject))
  console.error = quiet
  const models = bakeCars(gltf.scene)
  check('all five cars baked', models.length === 5, models.map((model) => model.name).join(', '))
  const roofTop = OBSTACLES.car.platformTop ?? OBSTACLES.car.height
  for (const model of models) {
    const mesh = new THREE.Mesh(model.geometry, new THREE.MeshBasicMaterial())
    mesh.updateMatrixWorld(true)
    // The roof is probed off-centre and behind the taxi sign / police light bar.
    const ray = new THREE.Raycaster(new THREE.Vector3(0.45, 4, -0.6), new THREE.Vector3(0, -1, 0))
    const roof = ray.intersectObject(mesh, false)[0]?.point.y ?? null
    const box = (model.geometry.computeBoundingBox(), model.geometry.boundingBox as THREE.Box3)
    const fits =
      Math.abs(box.min.y) <= 0.02 &&
      roof !== null &&
      Math.abs(roof - roofTop) <= TOLERANCE &&
      box.max.x - box.min.x <= model.spec.width + 0.02 &&
      Math.max(model.front, -model.back) <= model.spec.depth / 2 + 0.01 &&
      model.spec.depth <= OBSTACLES.car.depth
    check(
      `${model.name}: wheels on the road, roof is the platform, body inside the box`,
      fits,
      `y ${box.min.y.toFixed(2)}…roof ${roof?.toFixed(2) ?? '—'} (platform ${roofTop}), ${(box.max.x - box.min.x).toFixed(2)} × ${model.spec.depth} m`
    )
    ;(mesh.material as THREE.Material).dispose()
  }
}

console.log('\nZone skins: every look stands inside its collision box')
{
  const file = readFileSync(new URL('../src/assets/models/obstacle-props.glb', import.meta.url))
  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => loader.parse(data, '', resolve, reject))
  const props = bakeProps(gltf.scene)
  check('prop pack baked', props.size >= 25, `${props.size} props`)
  const zones = Object.keys(THEME_OF)
  check('every zone has an obstacle theme', zones.length === 31 && zones.every((zone) => THEMES.includes(THEME_OF[zone])), `${zones.length} zones`)
  const ray = new THREE.Raycaster()
  for (const [label, book] of [['procedural', buildSkins(null, tunnelGeometry)], ['with kit', buildSkins(props, tunnelGeometry)]] as const) {
    for (const theme of THEMES) {
      for (const kind of SKIN_KINDS) {
        const list = book[theme][kind]
        if (!list.length) {
          check(`${label} ${theme}.${kind}`, false, 'no skin at all')
          continue
        }
        list.forEach((geometry, i) => {
          const spec = OBSTACLES[kind]
          const lift = kind === 'low' || kind === 'tall' ? spec.height / 2 : 0
          const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
          mesh.position.y = lift
          mesh.updateMatrixWorld(true)
          geometry.computeBoundingBox()
          const b = (geometry.boundingBox as THREE.Box3).clone().translate(new THREE.Vector3(0, lift, 0))
          const top = spec.bottom + spec.height
          const down = (x: number, z: number, from: number): number | null => {
            ray.set(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0))
            return ray.intersectObject(mesh, false)[0]?.point.y ?? null
          }
          const up = (x: number, z: number, from: number): number | null => {
            ray.set(new THREE.Vector3(x, from, z), new THREE.Vector3(0, 1, 0))
            return ray.intersectObject(mesh, false)[0]?.point.y ?? null
          }
          const cover = (xs: number[], ys: number[]): number => {
            let hits = 0
            for (const x of xs) for (const y of ys) {
              ray.set(new THREE.Vector3(x, y, 8), new THREE.Vector3(0, 0, -1))
              const hit = ray.intersectObject(mesh, false)[0]
              if (hit && Math.abs(hit.point.z) <= spec.depth / 2 + 0.15) hits++
            }
            return hits
          }
          const tris = geometry.attributes.position.count / 3
          const problems: string[] = []
          if (tris > 2600) problems.push(`${tris} triangles`)
          if (!geometry.getAttribute('glow') || !geometry.getAttribute('color')) problems.push('missing colour/glow')
          let detail = ''
          if (kind === 'low' || kind === 'tall') {
            const t = down(0, 0, top + 0.3)
            const c = cover([-0.75, 0, 0.75], kind === 'low' ? [0.2, 0.5, 0.8] : [0.4, 1.3, 2.3])
            if (Math.abs(b.min.y) > TOLERANCE) problems.push(`floats at ${b.min.y.toFixed(2)}`)
            if (t === null || Math.abs(t - top) > TOLERANCE) problems.push(`centre top ${t?.toFixed(2) ?? '—'} vs ${top}`)
            if (b.max.y > top + 0.2) problems.push(`pokes up to ${b.max.y.toFixed(2)}`)
            if (Math.max(-b.min.x, b.max.x) > spec.width / 2 + 0.1) problems.push(`${(b.max.x - b.min.x).toFixed(2)} m wide`)
            if (Math.max(-b.min.z, b.max.z) > spec.depth / 2 + 0.12) problems.push(`${(b.max.z - b.min.z).toFixed(2)} m deep`)
            if (c < 6) problems.push(`only ${c}/9 of the face is solid`)
            detail = `top ${t?.toFixed(2)}, face ${c}/9, ${tris} tris`
          } else if (kind === 'tunnel') {
            const t = down(0, 0, top + 0.3)
            const u = up(0, 0, spec.bottom - 0.3)
            const c = cover([-3, 0, 3], [spec.bottom + 0.1, top - 0.12])
            // Nothing may hang into the clearance anywhere over the road.
            const pos = geometry.attributes.position
            let lowest = Infinity
            for (let v = 0; v < pos.count; v++) if (Math.abs(pos.getX(v)) < PILLAR_X - PILLAR_WIDTH / 2 - 0.02) lowest = Math.min(lowest, pos.getY(v))
            if (u === null || Math.abs(u - spec.bottom) > TOLERANCE) problems.push(`underside ${u?.toFixed(2) ?? '—'}`)
            if (t === null || Math.abs(t - top) > TOLERANCE) problems.push(`top ${t?.toFixed(2) ?? '—'}`)
            if (lowest < spec.bottom - 0.02) problems.push(`hangs down to ${lowest.toFixed(2)} over the road`)
            if (c < 6) problems.push(`only ${c}/6 of the beam is solid`)
            detail = `clear under ${u?.toFixed(2)}, top ${t?.toFixed(2)}, ${tris} tris`
          } else {
            const near = down(0, 1.2, 3)
            const far = down(0, -1.2, 3)
            if (Math.abs(b.min.y) > TOLERANCE) problems.push(`floats at ${b.min.y.toFixed(2)}`)
            if (b.max.y < top - TOLERANCE || b.max.y > top + 0.15) problems.push(`top edge ${b.max.y.toFixed(2)}`)
            if (Math.max(-b.min.x, b.max.x) > spec.width / 2 + 0.06 || Math.max(-b.min.z, b.max.z) > spec.depth / 2 + 0.06) problems.push('outside its footprint')
            if (near === null || far === null || !(near < 0.45 && far > 0.95)) problems.push(`does not rise along the run (${near?.toFixed(2)} → ${far?.toFixed(2)})`)
            detail = `rises ${near?.toFixed(2)} → ${far?.toFixed(2)} along the run, ${tris} tris`
          }
          check(`${label} ${theme}.${kind}#${i}`, problems.length === 0, problems.length ? problems.join('; ') : detail)
          ;(mesh.material as THREE.Material).dispose()
        })
      }
    }
  }
}

console.log('\nGates you have to slide under')
for (const kind of ['tunnel', 'laserHigh'] as ObstacleKind[]) {
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
