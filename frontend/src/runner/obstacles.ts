// Obstacles: barriers (jump), blockers (dodge), overhead bars (slide), and the
// city traffic set — car roofs you can land on, buses to swerve around, ramps
// that launch you and tunnel mouths that gate the road. Meshes are pooled per
// kind and recycled behind the camera.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LANES, OBSTACLES, RUN, type ObstacleSpec, type QualityPreset } from './config'
import { blobShadowTexture, glowTexture, hazardTexture, panelTexture } from './textures'
import type { ObstacleKind } from './types'

export type { ObstacleKind }

export interface Obstacle {
  kind: ObstacleKind
  spec: ObstacleSpec
  mesh: THREE.Mesh
  active: boolean
  smashing: boolean
  smashTime: number
  spin: THREE.Vector3
  lane: number
  z: number
  /** Soft contact shadow on the road under it (hidden for the tunnel arch). */
  shadow: THREE.Mesh
  /** Where it was at the start of this step — moving traffic needs its own sweep. */
  prevZ: number
  /** Own speed towards the runner on top of the world scroll (oncoming traffic), m/s. */
  vz: number
  /** A lane change in progress: eases x from `fromX` to `toX` between two z marks. */
  shift: { fromX: number; toX: number; startZ: number; endZ: number } | null
  /** The horn has sounded for this vehicle. */
  honked: boolean
  /** Per-kind decorations (blinkers, headlights, laser beams), built on first use. */
  decor: Partial<Record<ObstacleKind, THREE.Object3D>>
}

/** Kinds that are drawn as plain lane gates and pulse (the neon fences). */
export const LASER_KINDS: ObstacleKind[] = ['laserLow', 'laserHigh']

function paint(source: THREE.BufferGeometry, hex: number, offset?: [number, number, number]): THREE.BufferGeometry {
  // Extrusions are non-indexed while boxes are indexed: normalise before merging.
  const geometry = source.index ? source.toNonIndexed() : source
  if (geometry !== source) source.dispose()
  if (offset) geometry.translate(offset[0], offset[1], offset[2])
  const count = geometry.attributes.position.count
  const colours = new Float32Array(count * 3)
  const colour = new THREE.Color(hex)
  for (let i = 0; i < count; i++) {
    colours[i * 3] = colour.r
    colours[i * 3 + 1] = colour.g
    colours[i * 3 + 2] = colour.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return geometry
}

/** City car: tinted body, dark glass, wheels and lit lamps. Roof is walkable. */
export function carGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const wheel = (x: number, z: number) => {
    const geo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14)
    geo.rotateZ(Math.PI / 2)
    return paint(geo, 0x1b1e26, [x, 0.32, z])
  }
  parts.push(paint(new THREE.BoxGeometry(1.94, 0.62, 4.3), 0xffffff, [0, 0.71, 0]))
  parts.push(paint(new THREE.BoxGeometry(1.72, 0.56, 2.15), 0xffffff, [0, 1.24, -0.15]))
  parts.push(paint(new THREE.BoxGeometry(1.78, 0.4, 2.05), 0x18222f, [0, 1.28, -0.15]))
  parts.push(paint(new THREE.BoxGeometry(1.86, 0.18, 0.3), 0xfff0c4, [0, 0.78, 2.16]))
  parts.push(paint(new THREE.BoxGeometry(1.86, 0.18, 0.24), 0xff5a4a, [0, 0.78, -2.16]))
  parts.push(paint(new THREE.BoxGeometry(1.98, 0.22, 4.34), 0x2b3242, [0, 0.44, 0]))
  parts.push(wheel(-0.98, 1.42), wheel(0.98, 1.42), wheel(-0.98, -1.42), wheel(0.98, -1.42))
  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry
  for (const part of parts) part.dispose()
  return merged
}

/** City bus: long, tall, unmissable — swerve, never jump. */
export function busGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const wheel = (x: number, z: number) => {
    const geo = new THREE.CylinderGeometry(0.42, 0.42, 0.26, 14)
    geo.rotateZ(Math.PI / 2)
    return paint(geo, 0x161a21, [x, 0.42, z])
  }
  parts.push(paint(new THREE.BoxGeometry(2.3, 2.5, 6.9), 0x3f7fd0, [0, 1.55, 0]))
  parts.push(paint(new THREE.BoxGeometry(2.34, 0.5, 6.94), 0xf2f6ff, [0, 1.35, 0]))
  parts.push(paint(new THREE.BoxGeometry(2.36, 0.8, 6.3), 0x18222f, [0, 2.2, 0]))
  parts.push(paint(new THREE.BoxGeometry(2.2, 1.1, 0.24), 0x18222f, [0, 2.0, 3.5]))
  parts.push(paint(new THREE.BoxGeometry(2.2, 0.22, 0.26), 0xfff0c4, [0, 0.72, 3.56]))
  parts.push(paint(new THREE.BoxGeometry(2.2, 0.22, 0.26), 0xff5a4a, [0, 0.72, -3.56]))
  parts.push(wheel(-1.15, 2.3), wheel(1.15, 2.3), wheel(-1.15, -2.1), wheel(1.15, -2.1))
  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry
  for (const part of parts) part.dispose()
  return merged
}

/** Launch ramp: hazard-striped wedge that kicks the runner skyward. */
export function rampGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(-1.05, 0)
  shape.lineTo(1.05, 0)
  shape.lineTo(1.05, 1.3)
  shape.closePath()
  const wedge = new THREE.ExtrudeGeometry(shape, { depth: 2.9, bevelEnabled: false })
  wedge.translate(0, 0, -1.45)
  const parts = [
    paint(wedge, 0x3b4557),
    paint(new THREE.BoxGeometry(2.1, 0.14, 0.5), 0xf7c33c, [0, 1.02, 0.9]),
    paint(new THREE.BoxGeometry(2.1, 0.14, 0.5), 0x2b3242, [0, 0.62, 0.9]),
    paint(new THREE.BoxGeometry(2.1, 0.14, 0.5), 0xf7c33c, [0, 0.24, 0.9]),
    paint(new THREE.BoxGeometry(0.16, 1.32, 2.9), 0x2b3242, [-1.02, 0.66, 0]),
    paint(new THREE.BoxGeometry(0.16, 1.32, 2.9), 0x2b3242, [1.02, 0.66, 0]),
  ]
  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry
  for (const part of parts) part.dispose()
  return merged
}

/**
 * Skyway truck: a long box van, cab at the far end and the loading doors facing the
 * runner. The container roof *is* the platform — flat, 12 m long, at exactly
 * `platformTop`, so a convoy of them makes a raised road.
 */
export function truckGeometry(): THREE.BufferGeometry {
  const spec = OBSTACLES.truck
  const top = spec.platformTop ?? spec.height
  const half = spec.depth / 2
  const parts: THREE.BufferGeometry[] = []
  const wheel = (x: number, z: number) => {
    const geo = new THREE.CylinderGeometry(0.38, 0.38, 0.26, 14)
    geo.rotateZ(Math.PI / 2)
    return paint(geo, 0x161a21, [x, 0.38, z])
  }
  const cabLength = 2.3
  const boxLength = spec.depth - cabLength - 0.1
  const boxCentre = half - boxLength / 2
  // Chassis rail under everything.
  parts.push(paint(new THREE.BoxGeometry(2.0, 0.3, spec.depth - 0.2), 0x2b3242, [0, 0.5, 0]))
  // Container: tinted body up to the platform height.
  parts.push(paint(new THREE.BoxGeometry(2.2, top - 0.62, boxLength), 0xffffff, [0, 0.62 + (top - 0.62) / 2, boxCentre]))
  // Roof deck — a lighter tread so the high road reads as walkable.
  parts.push(paint(new THREE.BoxGeometry(2.14, 0.04, boxLength - 0.1), 0xdfe6f2, [0, top - 0.02, boxCentre]))
  // Hazard edges along both sides of the roof.
  parts.push(paint(new THREE.BoxGeometry(0.1, 0.06, boxLength), 0xf7c33c, [-1.06, top - 0.03, boxCentre]))
  parts.push(paint(new THREE.BoxGeometry(0.1, 0.06, boxLength), 0xf7c33c, [1.06, top - 0.03, boxCentre]))
  // Side stripe.
  parts.push(paint(new THREE.BoxGeometry(2.24, 0.16, boxLength - 0.6), 0x1b2433, [0, 1.05, boxCentre]))
  // Rear doors facing the runner, with lamps and a bumper.
  parts.push(paint(new THREE.BoxGeometry(2.0, top - 0.8, 0.06), 0xc9d2e0, [0, 0.62 + (top - 0.62) / 2, half + 0.01]))
  parts.push(paint(new THREE.BoxGeometry(0.06, top - 0.8, 0.08), 0x2b3242, [0, 0.62 + (top - 0.62) / 2, half + 0.04]))
  parts.push(paint(new THREE.BoxGeometry(0.34, 0.2, 0.1), 0xff4a3a, [-0.86, 0.72, half + 0.04]))
  parts.push(paint(new THREE.BoxGeometry(0.34, 0.2, 0.1), 0xff4a3a, [0.86, 0.72, half + 0.04]))
  parts.push(paint(new THREE.BoxGeometry(2.1, 0.18, 0.22), 0xf7c33c, [0, 0.42, half - 0.05]))
  // Cab at the far end, lower than the container so the roof stays the highest thing.
  const cabZ = -half + cabLength / 2
  parts.push(paint(new THREE.BoxGeometry(2.1, 0.8, cabLength), 0xffffff, [0, 1.0, cabZ]))
  parts.push(paint(new THREE.BoxGeometry(2.0, 0.42, cabLength * 0.62), 0x18222f, [0, 1.3, cabZ - 0.2]))
  parts.push(paint(new THREE.BoxGeometry(1.9, 0.18, 0.12), 0xfff0c4, [0, 0.76, -half - 0.02]))
  // Wheels: two at the cab, a tandem under the box.
  parts.push(wheel(-1.05, cabZ), wheel(1.05, cabZ))
  parts.push(wheel(-1.05, half - 1.4), wheel(1.05, half - 1.4), wheel(-1.05, half - 2.3), wheel(1.05, half - 2.3))
  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry
  for (const part of parts) part.dispose()
  return merged
}

/** Beam heights (centre, thickness) for each laser fence; the outer beams are the box edges. */
function laserBeams(kind: 'laserLow' | 'laserHigh'): Array<[number, number]> {
  const spec = OBSTACLES[kind]
  const bottom = spec.bottom
  const top = spec.bottom + spec.height
  if (kind === 'laserLow') return [[0.3, 0.1], [0.58, 0.1], [top - 0.05, 0.1]]
  const beams: Array<[number, number]> = [[bottom + 0.05, 0.1]]
  for (let y = bottom + 0.5; y < top - 0.3; y += 0.5) beams.push([y, 0.08])
  beams.push([top - 0.05, 0.1])
  return beams
}

/**
 * Neon laser fence. `part` picks the posts, the glowing beams, or both: the game draws
 * the beams with their own pulsing material, the fit check measures the whole thing.
 */
export function laserGeometry(kind: 'laserLow' | 'laserHigh', part: 'all' | 'frame' | 'beams' = 'all'): THREE.BufferGeometry {
  const spec = OBSTACLES[kind]
  const top = spec.bottom + spec.height
  const postTop = top + 0.22
  const parts: THREE.BufferGeometry[] = []
  if (part !== 'beams') {
    for (const x of [-1.05, 1.05]) {
      parts.push(paint(new THREE.BoxGeometry(0.16, postTop, 0.22), 0x2a2f45, [x, postTop / 2, 0]))
      parts.push(paint(new THREE.BoxGeometry(0.34, 0.08, 0.4), 0x1b1f30, [x, 0.04, 0]))
      parts.push(paint(new THREE.BoxGeometry(0.2, 0.12, 0.26), kind === 'laserLow' ? 0xff3d7f : 0x38e8ff, [x, postTop + 0.06, 0]))
    }
    // The low fence sits on a thin rail so it reads as rooted to the road.
    if (kind === 'laserLow') parts.push(paint(new THREE.BoxGeometry(2.0, 0.06, 0.18), 0x2a2f45, [0, 0.03, 0]))
  }
  if (part !== 'frame') {
    for (const [y, thick] of laserBeams(kind)) parts.push(paint(new THREE.BoxGeometry(1.98, thick, 0.08), 0xffffff, [0, y, 0]))
  }
  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry
  for (const item of parts) item.dispose()
  return merged
}

/**
 * Gateway: the visible lintel *is* the collision box, so sliding under it is never a
 * guess. Two columns carry it, planted on the pavement outside the road.
 *
 * The arch above is decoration and sits far out of reach — it is a curve, and the one
 * thing a gate must not be confused with is the *other* thing you slide under.
 */
export const PILLAR_X = 5.4
export const PILLAR_WIDTH = 1.5
const PILLAR_TOP = OBSTACLES.tunnel.bottom + OBSTACLES.tunnel.height + 0.7

export function tunnelGeometry(): THREE.BufferGeometry {
  const spec = OBSTACLES.tunnel
  const bottom = spec.bottom
  const top = spec.bottom + spec.height
  const parts: THREE.BufferGeometry[] = []
  // The columns stand *outside* the lintel and rise past it, otherwise the gate reads
  // as a bare bar hanging over the road — from 150 m out, a column tucked behind the
  // lintel's end is two pixels wide and simply not there.
  const pillar = (x: number) => paint(new THREE.BoxGeometry(PILLAR_WIDTH, PILLAR_TOP, 1.6), 0x9aa6b8, [x, PILLAR_TOP / 2, 0])
  parts.push(pillar(-PILLAR_X), pillar(PILLAR_X))
  // The gate itself — the same box the runner is tested against.
  parts.push(
    paint(new THREE.BoxGeometry(9.4, top - bottom, 1.4), 0xb7c3d4, [0, (bottom + top) / 2, 0])
  )
  // Hazard chevrons on the leading face so the duck reads at speed.
  for (let i = -3; i <= 3; i++) {
    parts.push(
      paint(
        new THREE.BoxGeometry(0.62, top - bottom - 0.26, 0.08),
        i % 2 === 0 ? 0xf7c33c : 0x2b3242,
        [i * 1.28, (bottom + top) / 2, 0.72]
      )
    )
  }
  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry
  for (const part of parts) part.dispose()
  return merged
}

export class ObstacleManager {
  readonly group = new THREE.Group()

  readonly pool: Obstacle[] = []
  private geometries: Record<ObstacleKind, THREE.BufferGeometry>
  private materials: Record<ObstacleKind, THREE.Material>
  private trafficMaterials: THREE.MeshStandardMaterial[]
  private truckMaterials: THREE.MeshStandardMaterial[]
  private beamGeometries: Record<'laserLow' | 'laserHigh', THREE.BufferGeometry>
  private beamMaterials: Record<'laserLow' | 'laserHigh', THREE.MeshBasicMaterial>
  private blinkerGeometry = new THREE.BoxGeometry(0.16, 0.14, 0.2)
  private blinkerMaterial = new THREE.MeshBasicMaterial({ color: 0xffa21a, toneMapped: false })
  private headGlowMaterial: THREE.SpriteMaterial
  private beamCone: THREE.PlaneGeometry = new THREE.PlaneGeometry(2.0, 9)
  private beamConeMaterial: THREE.MeshBasicMaterial
  private time = 0
  private cap: number
  private shadowGeometry = new THREE.PlaneGeometry(1, 1)
  private shadowMaterial = new THREE.MeshBasicMaterial({
    map: blobShadowTexture(),
    color: 0x000000,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  })
  private disposables: Array<{ dispose: () => void }> = []

  constructor(preset: QualityPreset) {
    this.cap = preset.maxObstacles

    const hazard = hazardTexture()
    const panel = panelTexture()
    this.disposables.push(hazard, panel)

    const hazardMat = new THREE.MeshStandardMaterial({
      map: hazard,
      emissiveMap: hazard,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.06,
      roughness: 0.72,
      metalness: 0.08,
    })
    const panelMat = new THREE.MeshStandardMaterial({
      map: panel,
      emissiveMap: panel,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.08,
      roughness: 0.68,
      metalness: 0.1,
    })
    this.geometries = {
      low: new THREE.BoxGeometry(OBSTACLES.low.width, OBSTACLES.low.height, OBSTACLES.low.depth),
      tall: new THREE.BoxGeometry(OBSTACLES.tall.width, OBSTACLES.tall.height, OBSTACLES.tall.depth),
      car: carGeometry(),
      bus: busGeometry(),
      ramp: rampGeometry(),
      tunnel: tunnelGeometry(),
      truck: truckGeometry(),
      laserLow: laserGeometry('laserLow', 'frame'),
      laserHigh: laserGeometry('laserHigh', 'frame'),
    }
    this.beamGeometries = { laserLow: laserGeometry('laserLow', 'beams'), laserHigh: laserGeometry('laserHigh', 'beams') }
    const beamMat = (hex: number) =>
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false })
    // Jump beams are hot pink, duck beams are cyan — the colour tells you the verb.
    this.beamMaterials = { laserLow: beamMat(0xff3d7f), laserHigh: beamMat(0x38e8ff) }
    const glow = glowTexture('rgba(255, 246, 214, 1)', 'rgba(255, 220, 150, 0)')
    this.disposables.push(glow)
    this.headGlowMaterial = new THREE.SpriteMaterial({
      map: glow,
      color: 0xfff2cc,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.beamConeMaterial = new THREE.MeshBasicMaterial({
      map: glow,
      color: 0xfff0c0,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.disposables.push(
      ...Object.values(this.beamGeometries),
      ...Object.values(this.beamMaterials),
      this.blinkerGeometry,
      this.blinkerMaterial,
      this.headGlowMaterial,
      this.beamCone,
      this.beamConeMaterial
    )
    // Traffic is painted with vertex colours so one geometry covers every livery.
    const trafficMat = (tint: number) =>
      new THREE.MeshStandardMaterial({ color: tint, vertexColors: true, roughness: 0.5, metalness: 0.28 })
    this.trafficMaterials = [trafficMat(0xff5a4a), trafficMat(0x4f9bff), trafficMat(0xffc93c), trafficMat(0xe8eef8)]
    this.truckMaterials = [trafficMat(0xf2f5fb), trafficMat(0xff8a3c), trafficMat(0x2fc6b0)]
    this.materials = {
      low: hazardMat,
      tall: panelMat,
      car: this.trafficMaterials[0],
      bus: trafficMat(0xffffff),
      ramp: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }),
      tunnel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.12 }),
      truck: this.truckMaterials[0],
      laserLow: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5, emissive: 0x220a18, emissiveIntensity: 1 }),
      laserHigh: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5, emissive: 0x08202a, emissiveIntensity: 1 }),
    }
    this.disposables.push(
      ...Object.values(this.geometries),
      ...this.trafficMaterials,
      ...this.truckMaterials,
      this.materials.bus,
      this.materials.ramp,
      this.materials.tunnel,
      this.materials.laserLow,
      this.materials.laserHigh,
      hazardMat,
      panelMat
    )
    this.disposables.push(this.shadowGeometry, this.shadowMaterial)
    // Real shadow maps only run on high; the blob keeps every tier grounded and on
    // high it reads as the darker contact occlusion right under the body.
    this.shadowMaterial.opacity = preset.shadows ? 0.34 : 0.5
  }

  /** How many more obstacles can be put on the road right now. */
  available(): number {
    let free = Math.max(0, this.cap - this.pool.length)
    for (const item of this.pool) if (!item.active) free++
    return free
  }

  get activeCount(): number {
    let count = 0
    for (const item of this.pool) if (item.active) count++
    return count
  }

  reset(): void {
    for (const item of this.pool) {
      item.active = false
      item.smashing = false
      item.mesh.visible = false
      item.shadow.visible = false
      item.mesh.rotation.set(0, 0, 0)
    }
  }

  setQuality(preset: QualityPreset): void {
    this.cap = preset.maxObstacles
    this.shadowMaterial.opacity = preset.shadows ? 0.34 : 0.5
  }

  spawn(kind: ObstacleKind, lane: number, z: number): Obstacle | null {
    const obstacle = this.acquire(kind)
    if (!obstacle) return null
    const spec = OBSTACLES[kind]
    obstacle.active = true
    obstacle.smashing = false
    obstacle.smashTime = 0
    obstacle.lane = lane
    obstacle.z = z
    obstacle.prevZ = z
    obstacle.vz = 0
    obstacle.shift = null
    obstacle.honked = false
    obstacle.mesh.visible = true
    obstacle.mesh.rotation.set(0, 0, 0)
    if (kind === 'car') obstacle.mesh.material = this.trafficMaterials[Math.floor(Math.random() * this.trafficMaterials.length)]
    if (kind === 'truck') obstacle.mesh.material = this.truckMaterials[Math.floor(Math.random() * this.truckMaterials.length)]
    this.decorate(obstacle)
    obstacle.mesh.position.set(
      kind === 'tunnel' ? LANES[1] : LANES[Math.max(0, Math.min(LANES.length - 1, lane))],
      spec.bottom + spec.height / 2,
      z
    )
    // Vehicles and ramps sit on the road; the tunnel arch is built around y = 0.
    if (kind === 'car' || kind === 'bus' || kind === 'ramp' || kind === 'truck') obstacle.mesh.position.y = 0
    if (kind === 'tunnel' || LASER_KINDS.includes(kind)) obstacle.mesh.position.y = 0
    const shadow = obstacle.shadow
    shadow.visible = kind !== 'tunnel' && !LASER_KINDS.includes(kind)
    // A touch wider than the footprint so the soft edge spills out round the base.
    shadow.scale.set(spec.width * 1.25, spec.depth * 1.18 + 0.5, 1)
    shadow.position.set(obstacle.mesh.position.x, 0.025, z)
    return obstacle
  }

  /**
   * Turns a parked vehicle into oncoming traffic: it drives at the runner at `speed`
   * m/s on top of the world scroll, headlights on.
   */
  makeOncoming(item: Obstacle, speed: number): void {
    item.vz = speed
    const decor = item.decor[item.kind]
    const lights = decor?.getObjectByName('headlights')
    if (lights) lights.visible = true
  }

  /** A vehicle that signals, then changes lane between two points on the road. */
  makeMerge(item: Obstacle, toLane: number, startZ: number, endZ: number): void {
    const toX = LANES[Math.max(0, Math.min(LANES.length - 1, toLane))]
    item.shift = { fromX: item.mesh.position.x, toX, startZ, endZ }
  }

  /** Builds (once) and shows the decoration set for the obstacle's current kind. */
  private decorate(item: Obstacle): void {
    for (const key of Object.keys(item.decor) as ObstacleKind[]) {
      const node = item.decor[key]
      if (node) node.visible = false
    }
    const kind = item.kind
    let node = item.decor[kind]
    if (!node) {
      const built = this.buildDecor(kind)
      if (!built) return
      node = built
      item.decor[kind] = node
      item.mesh.add(node)
    }
    node.visible = true
    const lights = node.getObjectByName('headlights')
    if (lights) lights.visible = false
    const blink = node.getObjectByName('blinkers')
    if (blink) blink.visible = false
  }

  private buildDecor(kind: ObstacleKind): THREE.Object3D | null {
    if (kind === 'laserLow' || kind === 'laserHigh') {
      const beams = new THREE.Mesh(this.beamGeometries[kind], this.beamMaterials[kind])
      beams.renderOrder = 2
      return beams
    }
    if (kind !== 'car' && kind !== 'bus') return null
    const root = new THREE.Group()
    const front = kind === 'car' ? 2.24 : 3.62
    const lampY = kind === 'car' ? 0.78 : 0.72
    const lampX = kind === 'car' ? 0.68 : 0.88
    // Headlights: only lit for oncoming traffic, so "it is coming at you" reads at a glance.
    const lights = new THREE.Group()
    lights.name = 'headlights'
    for (const x of [-lampX, lampX]) {
      const sprite = new THREE.Sprite(this.headGlowMaterial)
      sprite.position.set(x, lampY, front + 0.1)
      sprite.scale.setScalar(1.5)
      lights.add(sprite)
    }
    const cone = new THREE.Mesh(this.beamCone, this.beamConeMaterial)
    cone.rotation.x = -Math.PI / 2
    cone.position.set(0, 0.04, front + 4.6)
    lights.add(cone)
    root.add(lights)
    if (kind === 'car') {
      // Indicators on all four corners; only the side it is moving to flashes.
      const blinkers = new THREE.Group()
      blinkers.name = 'blinkers'
      for (const side of [-1, 1]) {
        const set = new THREE.Group()
        set.name = side < 0 ? 'left' : 'right'
        for (const z of [-2.2, 2.2]) {
          const lamp = new THREE.Mesh(this.blinkerGeometry, this.blinkerMaterial)
          lamp.position.set(side * 0.94, 0.9, z)
          set.add(lamp)
        }
        blinkers.add(set)
      }
      root.add(blinkers)
    }
    return root
  }

  update(dt: number, speed: number): void {
    const dz = speed * dt
    this.time += dt
    // Laser fences breathe; the flicker is what sells them as energy, not plastic.
    const pulse = 0.72 + 0.28 * Math.sin(this.time * 14)
    this.beamMaterials.laserLow.opacity = pulse
    this.beamMaterials.laserHigh.opacity = 0.72 + 0.28 * Math.sin(this.time * 14 + 1.7)
    const blinkOn = Math.floor(this.time * 5) % 2 === 0
    for (const item of this.pool) {
      if (!item.active) continue
      item.prevZ = item.z
      if (item.smashing) {
        item.smashTime += dt
        item.mesh.position.z += dz * 1.6
        item.mesh.position.y += 6 * dt
        item.mesh.position.x += item.spin.x * dt
        item.mesh.rotation.x += item.spin.x * 3 * dt
        item.mesh.rotation.y += item.spin.y * 3 * dt
        item.mesh.rotation.z += item.spin.z * 3 * dt
        item.shadow.visible = false
        if (item.smashTime > 0.9) {
          item.active = false
          item.smashing = false
          item.mesh.visible = false
        }
        continue
      }
      item.z += dz + item.vz * dt
      item.mesh.position.z = item.z
      item.shadow.position.z = item.z
      if (item.shift) {
        const { fromX, toX, startZ, endZ } = item.shift
        const raw = (item.z - startZ) / (endZ - startZ)
        const t = Math.min(1, Math.max(0, raw))
        const eased = t * t * (3 - 2 * t)
        const x = fromX + (toX - fromX) * eased
        item.mesh.position.x = x
        item.shadow.position.x = x
        // A slight yaw into the turn so the move reads as steering, not sliding.
        item.mesh.rotation.y = -Math.sin(Math.PI * t) * 0.16 * Math.sign(toX - fromX)
        const blink = item.decor.car?.getObjectByName('blinkers')
        if (blink) {
          blink.visible = t < 1
          const side = toX > fromX ? 'right' : 'left'
          for (const set of blink.children) set.visible = set.name === side && blinkOn
        }
        if (t >= 1) {
          item.shift = null
          item.mesh.rotation.y = 0
          if (blink) blink.visible = false
        }
      }
      if (item.z > RUN.despawnZ) {
        item.active = false
        item.mesh.visible = false
        item.shadow.visible = false
      }
    }
  }

  /** Called when a boosting runner ploughs through an obstacle. */
  smash(item: Obstacle): void {
    item.smashing = true
    item.smashTime = 0
    item.spin.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3)
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose()
    this.group.clear()
    this.pool.length = 0
  }

  private acquire(kind: ObstacleKind): Obstacle | null {
    for (const item of this.pool) {
      if (!item.active && item.kind === kind) return item
    }
    if (this.pool.length >= this.cap) {
      // Steal the farthest recycled mesh rather than dropping the spawn.
      const fallback = this.pool.find((item) => !item.active)
      if (fallback) {
        fallback.kind = kind
        fallback.spec = OBSTACLES[kind]
        fallback.mesh.geometry = this.geometries[kind]
        fallback.mesh.material = this.materials[kind]
        return fallback
      }
      return null
    }
    const spec = OBSTACLES[kind]
    const mesh = new THREE.Mesh(this.geometries[kind], this.materials[kind])
    mesh.visible = false
    mesh.castShadow = true
    this.group.add(mesh)
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial)
    shadow.rotation.x = -Math.PI / 2
    shadow.visible = false
    shadow.renderOrder = 1
    this.group.add(shadow)
    const obstacle: Obstacle = {
      kind,
      spec,
      mesh,
      active: false,
      smashing: false,
      smashTime: 0,
      spin: new THREE.Vector3(),
      lane: 1,
      z: 0,
      shadow,
      prevZ: 0,
      vz: 0,
      shift: null,
      honked: false,
      decor: {},
    }
    this.pool.push(obstacle)
    return obstacle
  }
}
