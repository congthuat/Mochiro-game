// Obstacles: barriers (jump), blockers (dodge), overhead bars (slide), and the
// city traffic set — car roofs you can land on, buses to swerve around, ramps
// that launch you and tunnel mouths that gate the road. Meshes are pooled per
// kind and recycled behind the camera.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { LANES, OBSTACLES, RUN, type ObstacleSpec, type QualityPreset } from './config'
import { blobShadowTexture, glowTexture, hazardTexture, panelTexture } from './textures'
import { CAR_LAMPS, loadCarModels, type CarModel } from './cars'
import carsUrl from '../assets/models/kaykit-cars.glb?url'
import propsUrl from '../assets/models/obstacle-props.glb?url'
import { RAMPS, SKIN_KINDS, buildSkins, loadObstacleProps, rampSkin, skinMaterial, themeOf, type SkinBook, type SkinKind } from './obstacleSkins'
import type { ObstacleKind } from './types'
import {
  MOVER_SPECS,
  ROLLER,
  buildMoverBook,
  buildRig,
  createMover,
  dressRig,
  lookFor,
  moverMid,
  poseRig,
  stepMover,
  warningRingGeometry,
  type MoverBook,
  type MoverLook,
  type MoverRig,
  type MoverState,
  type MoverType,
} from './movers'

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
  /** The KayKit body this car is wearing (null for the stand-in or any other kind). */
  car: CarModel | null
  /** A moving obstacle's live state (kind 'mover'); null for everything else. */
  mover: MoverState | null
  /** The animated part sets, one per mover type, built on first use. */
  rigs: Partial<Record<MoverType, MoverRig>>
}

/** Something a mover did this frame that the runner turns into sound and dust. */
export interface MoverEvent {
  kind: 'land' | 'bell'
  x: number
  z: number
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

/** Rounded block — the soft bevels are what make the traffic read as toys, not crates. */
function rbox(w: number, h: number, d: number, r: number, hex: number, at: [number, number, number]): THREE.BufferGeometry {
  return paint(new RoundedBoxGeometry(w, h, d, 2, r), hex, at)
}

/** Tyre, rim and hub cap, axle along x, resting on the road. */
function wheelParts(x: number, z: number, radius: number, width: number): THREE.BufferGeometry[] {
  const part = (r: number, w: number, hex: number, segments: number) => {
    const geo = new THREE.CylinderGeometry(r, r, w, segments)
    geo.rotateZ(Math.PI / 2)
    return paint(geo, hex, [x, radius, z])
  }
  return [part(radius, width, TYRE, 20), part(radius * 0.56, width + 0.04, RIM, 14), part(radius * 0.2, width + 0.08, HUB, 10)]
}

/** The KayKit city palette, so the hand-built vehicles sit next to the modelled cars. */
const TYRE = 0x2e2e2e
const RIM = 0x838e93
const HUB = 0xc9d1d6
const TRIM = 0x808a8f
const GLASS = 0x2c3e4c
const LAMP = 0xeaeeef
const AMBER = 0xf68f40
const TAIL = 0xdf4730

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry
  for (const part of parts) part.dispose()
  return merged
}

/**
 * Stand-in city car, used only until the KayKit car pack has loaded (and by the fit
 * check): same footprint and roof as the modelled cars, bonnet facing +z.
 */
export function carGeometry(): THREE.BufferGeometry {
  const spec = OBSTACLES.car
  const top = spec.platformTop ?? spec.height
  const half = spec.depth / 2
  const parts: THREE.BufferGeometry[] = []
  parts.push(rbox(spec.width - 0.02, 0.62, spec.depth - 0.04, 0.16, 0xffffff, [0, 0.62, 0]))
  parts.push(rbox(spec.width - 0.18, top - 0.9, 2.0, 0.16, 0xffffff, [0, (0.9 + top) / 2, -0.15]))
  parts.push(rbox(spec.width - 0.14, top - 1.08, 1.86, 0.1, GLASS, [0, (0.94 + top - 0.14) / 2, -0.15]))
  parts.push(rbox(spec.width + 0.02, 0.22, 0.24, 0.08, TRIM, [0, 0.38, half - 0.1]))
  parts.push(rbox(spec.width + 0.02, 0.22, 0.24, 0.08, TRIM, [0, 0.38, -half + 0.1]))
  for (const x of [-0.56, 0.56]) {
    parts.push(rbox(0.36, 0.14, 0.08, 0.03, LAMP, [x, 0.68, half - 0.01]))
    parts.push(rbox(0.36, 0.14, 0.08, 0.03, TAIL, [x, 0.72, -half + 0.01]))
  }
  for (const x of [-0.72, 0.72]) for (const z of [1.15, -1.15]) parts.push(...wheelParts(x, z, 0.3, 0.24))
  return merge(parts)
}

/**
 * City bus: blue skirt, white upper deck, a full glass band with pillars, a lit route
 * sign and a big windscreen facing +z. Long, tall, unmissable — swerve, never jump.
 */
export function busGeometry(): THREE.BufferGeometry {
  const spec = OBSTACLES.bus
  const top = spec.height
  const half = spec.depth / 2 - 0.05
  const body = spec.width - 0.05
  const parts: THREE.BufferGeometry[] = []
  for (const z of [2.25, -2.1]) for (const x of [-1.0, 1.0]) parts.push(...wheelParts(x, z, 0.5, 0.34))
  // Livery: blue lower half, white upper half, an amber pinstripe between.
  parts.push(rbox(body, 1.06, half * 2, 0.14, 0x2f7fd6, [0, 0.32 + 0.53, 0]))
  parts.push(rbox(body, top - 1.34, half * 2, 0.2, 0xf3f6f8, [0, (1.34 + top) / 2, 0]))
  parts.push(rbox(body + 0.04, 0.12, half * 2 - 0.3, 0.04, AMBER, [0, 1.38, 0]))
  // Side glass band with pillars, then the front door on the kerb side.
  parts.push(rbox(body + 0.06, 0.8, 5.5, 0.06, GLASS, [0, 2.0, -0.45]))
  for (let z = -3.1; z <= 2.25; z += 1.07) parts.push(rbox(body + 0.08, 0.84, 0.07, 0.02, 0xf3f6f8, [0, 2.0, z]))
  parts.push(rbox(0.06, 1.78, 0.92, 0.04, GLASS, [body / 2 + 0.01, 1.3, 2.75]))
  // Roof: a lighter cap and the air-con pod.
  parts.push(rbox(body - 0.2, 0.06, half * 2 - 0.4, 0.03, 0xd9dfe4, [0, top - 0.02, 0]))
  parts.push(rbox(1.3, 0.22, 1.8, 0.08, HUB, [0, top + 0.08, -0.6]))
  // Nose: windscreen, route sign, bumper, lamps and mirrors.
  parts.push(rbox(body - 0.24, 1.25, 0.08, 0.05, GLASS, [0, 1.85, half + 0.01]))
  parts.push(rbox(1.6, 0.2, 0.06, 0.03, 0xffb340, [0, 2.6, half + 0.02]))
  parts.push(rbox(body + 0.04, 0.32, 0.22, 0.08, TRIM, [0, 0.45, half]))
  for (const side of [-1, 1]) {
    parts.push(rbox(0.36, 0.2, 0.06, 0.03, LAMP, [side * 0.84, 0.76, half + 0.02]))
    parts.push(rbox(0.14, 0.2, 0.06, 0.03, AMBER, [side * 1.06, 0.76, half + 0.02]))
    parts.push(rbox(0.08, 0.32, 0.14, 0.03, 0x1f2a36, [side * (body / 2 + 0.12), 2.15, half - 0.2]))
    parts.push(rbox(0.16, 0.05, 0.05, 0.02, 0x1f2a36, [side * (body / 2 + 0.06), 2.3, half - 0.2]))
  }
  // Tail: rear window, lamps, bumper.
  parts.push(rbox(body - 0.4, 0.7, 0.06, 0.04, GLASS, [0, 2.1, -half - 0.01]))
  parts.push(rbox(body + 0.04, 0.32, 0.22, 0.08, TRIM, [0, 0.45, -half]))
  for (const side of [-1, 1]) parts.push(rbox(0.28, 0.42, 0.06, 0.03, TAIL, [side * 0.9, 0.86, -half - 0.02]))
  return merge(parts)
}

/**
 * Launch ramp (the city's steel one): rises along the run from a lip on the road to a
 * 1.3 m top edge, arrows up the slope. The zone themes build their own from the same
 * recipe in obstacleSkins.ts.
 */
export function rampGeometry(): THREE.BufferGeometry {
  return rampSkin(RAMPS.metal)
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
  const cabLength = 2.3
  const boxLength = spec.depth - cabLength - 0.1
  const boxCentre = half - boxLength / 2
  const boxHeight = top - 0.62
  const boxMid = 0.62 + boxHeight / 2
  // Chassis rail under everything.
  parts.push(rbox(2.0, 0.3, spec.depth - 0.2, 0.06, 0x2b3242, [0, 0.5, 0]))
  // Container: tinted body up to exactly the platform height, softly bevelled.
  parts.push(rbox(2.2, boxHeight, boxLength, 0.08, 0xffffff, [0, boxMid, boxCentre]))
  // Corrugation ribs down both sides.
  for (let z = boxCentre - boxLength / 2 + 0.5; z < boxCentre + boxLength / 2 - 0.3; z += 0.8) {
    parts.push(rbox(2.24, boxHeight - 0.12, 0.08, 0.02, 0xdfe5ec, [0, boxMid, z]))
  }
  // Roof deck — a lighter tread so the high road reads as walkable.
  parts.push(paint(new THREE.BoxGeometry(2.08, 0.04, boxLength - 0.16), 0xeef2f8, [0, top - 0.02, boxCentre]))
  // Hazard edges along both sides of the roof.
  parts.push(paint(new THREE.BoxGeometry(0.1, 0.06, boxLength - 0.08), 0xf7c33c, [-1.04, top - 0.03, boxCentre]))
  parts.push(paint(new THREE.BoxGeometry(0.1, 0.06, boxLength - 0.08), 0xf7c33c, [1.04, top - 0.03, boxCentre]))
  // Side stripe.
  parts.push(rbox(2.28, 0.16, boxLength - 0.6, 0.04, 0x1b2433, [0, 1.05, boxCentre]))
  // Rear doors facing the runner: seam, locking bars, lamps and a bumper.
  const doorZ = half + 0.01
  parts.push(rbox(2.04, boxHeight - 0.14, 0.06, 0.02, 0xc9d2e0, [0, boxMid, doorZ]))
  parts.push(paint(new THREE.BoxGeometry(0.05, boxHeight - 0.16, 0.08), 0x2b3242, [0, boxMid, doorZ + 0.03]))
  for (const x of [-0.62, -0.3, 0.3, 0.62]) {
    parts.push(paint(new THREE.BoxGeometry(0.05, boxHeight - 0.24, 0.06), 0x8a94a3, [x, boxMid, doorZ + 0.05]))
  }
  for (const side of [-1, 1]) {
    parts.push(rbox(0.34, 0.2, 0.1, 0.03, 0xff4a3a, [side * 0.86, 0.72, doorZ + 0.03]))
    parts.push(rbox(0.12, 0.2, 0.1, 0.03, AMBER, [side * 0.6, 0.72, doorZ + 0.03]))
  }
  parts.push(rbox(2.1, 0.18, 0.22, 0.06, 0xf7c33c, [0, 0.42, half - 0.05]))
  // Cab at the far end, lower than the container so the roof stays the highest thing.
  const cabZ = -half + cabLength / 2
  const nose = -half
  parts.push(rbox(2.1, 0.95, cabLength, 0.18, 0xffffff, [0, 0.98, cabZ]))
  parts.push(rbox(2.14, 0.34, cabLength * 0.5, 0.06, GLASS, [0, 1.2, cabZ - 0.3]))
  parts.push(rbox(1.84, 0.38, 0.06, 0.04, GLASS, [0, 1.2, nose - 0.01]))
  parts.push(rbox(1.2, 0.26, 0.06, 0.03, 0x3a4048, [0, 0.8, nose - 0.02]))
  parts.push(rbox(2.14, 0.22, 0.22, 0.06, TRIM, [0, 0.5, nose + 0.06]))
  for (const side of [-1, 1]) parts.push(rbox(0.3, 0.16, 0.06, 0.03, 0xfff0c4, [side * 0.8, 0.8, nose - 0.02]))
  // Wheels: two at the cab, a tandem under the box, with mud flaps behind.
  parts.push(...wheelParts(-0.98, cabZ, 0.4, 0.28), ...wheelParts(0.98, cabZ, 0.4, 0.28))
  for (const z of [half - 1.4, half - 2.3]) parts.push(...wheelParts(-0.98, z, 0.4, 0.28), ...wheelParts(0.98, z, 0.4, 0.28))
  for (const x of [-0.98, 0.98]) parts.push(paint(new THREE.BoxGeometry(0.3, 0.42, 0.04), 0x1b1e26, [x, 0.36, half - 0.75]))
  return merge(parts)
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
  private blinkerGeometry = new THREE.BoxGeometry(0.14, 0.12, 0.12)
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
  /** Modelled cars once the pack has loaded; until then the stand-in car is used. */
  private carModels: CarModel[] = []
  private carMaterial: THREE.Material | null = null
  private lastCar = -1
  private disposed = false
  /** Zone-themed looks for the jump / dodge / slide / ramp obstacles. */
  private skins: SkinBook
  private skinMaterial = skinMaterial()
  private lastSkin = new Map<string, number>()
  /** Which zone owns the road at a given obstacle z (set by the runner). */
  private zoneAt: ((z: number) => string) | null = null
  /** Moving obstacles: their looks, the pulsing warning ring, and this frame's events. */
  private moverBook: MoverBook
  private emptyGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3))
  private markGeometry = warningRingGeometry()
  private markMaterial = new THREE.MeshBasicMaterial({ color: 0xff4a1a, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false })
  private moverEvents: MoverEvent[] = []

  constructor(preset: QualityPreset) {
    this.cap = preset.maxObstacles
    // The pack is shared by every run (cached in cars.ts), so it is never disposed here.
    loadCarModels(carsUrl)
      .then(({ models, material }) => {
        if (this.disposed) return
        this.carModels = models
        this.carMaterial = material
      })
      .catch(() => {
        // Offline or blocked: the stand-in cars keep the road playable.
      })

    this.skins = buildSkins(null, tunnelGeometry)
    this.disposables.push(this.skinMaterial, ...this.skinGeometries())
    this.moverBook = buildMoverBook(null)
    this.disposables.push(...this.moverGeometries(), this.emptyGeometry, this.markGeometry, this.markMaterial)
    // With the kit props in, the book is rebuilt with the modelled skins. The old one
    // stays alive (it may still be on the road) until the manager is disposed.
    loadObstacleProps(propsUrl)
      .then((props) => {
        if (this.disposed) return
        this.skins = buildSkins(props, tunnelGeometry)
        this.disposables.push(...this.skinGeometries())
        this.moverBook = buildMoverBook(props)
        this.disposables.push(...this.moverGeometries())
      })
      .catch(() => {
        // Offline or blocked: the procedural skins cover every zone on their own.
      })

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
      mover: this.emptyGeometry,
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
      ramp: this.skinMaterial,
      tunnel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.12 }),
      truck: this.truckMaterials[0],
      laserLow: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5, emissive: 0x220a18, emissiveIntensity: 1 }),
      laserHigh: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5, emissive: 0x08202a, emissiveIntensity: 1 }),
      mover: this.skinMaterial,
    }
    this.disposables.push(
      ...Object.values(this.geometries).filter((geometry) => geometry !== this.emptyGeometry),
      ...this.trafficMaterials,
      ...this.truckMaterials,
      this.materials.bus,
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

  private moverGeometries(): THREE.BufferGeometry[] {
    return Object.values(this.moverBook).flatMap((parts) => Object.values(parts))
  }

  private skinGeometries(): THREE.BufferGeometry[] {
    return Object.values(this.skins).flatMap((kinds) => SKIN_KINDS.flatMap((kind) => kinds[kind]))
  }

  /** Lets obstacles dress for the zone they are spawned in (`z` is the spawn z). */
  setZoneSource(zoneAt: (z: number) => string): void {
    this.zoneAt = zoneAt
  }

  /**
   * Gives a jump / dodge / slide / ramp obstacle the look of the zone it stands in,
   * never the same variant twice running. Collision is untouched: every skin is built
   * inside the kind's box (scripts/obstacle-fit.ts checks them all).
   */
  private dressSkin(item: Obstacle, z: number): void {
    const kind = item.kind as SkinKind
    const theme = themeOf(this.zoneAt ? this.zoneAt(z) : 'city')
    const variants = this.skins[theme][kind]
    if (!variants.length) return
    const key = `${theme}.${kind}`
    let index = Math.floor(Math.random() * variants.length)
    if (variants.length > 1 && index === this.lastSkin.get(key)) index = (index + 1) % variants.length
    this.lastSkin.set(key, index)
    item.mesh.geometry = variants[index]
    item.mesh.material = this.skinMaterial
    item.mesh.userData.skin = `${key}#${index}`
  }

  /** How many more obstacles can be put on the road right now. */
  /** A race raises the pool's floor so no device drops an obstacle its rivals have. */
  minCap = 0

  available(): number {
    let free = Math.max(0, Math.max(this.cap, this.minCap) - this.pool.length)
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

  /**
   * Added to every spawn's z. A race lays each pattern out at its exact metre even when
   * the frame that spawns it lands a little past that point; the pattern is computed
   * at its nominal spot and moved here, so its layout never depends on the frame rate.
   */
  zShift = 0

  spawn(kind: ObstacleKind, lane: number, z: number): Obstacle | null {
    return this.place(kind, lane, z + this.zShift)
  }

  private place(kind: ObstacleKind, lane: number, z: number): Obstacle | null {
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
    obstacle.car = null
    obstacle.mover = null
    if (kind === 'car') this.dressCar(obstacle)
    if (kind === 'truck') obstacle.mesh.material = this.truckMaterials[Math.floor(Math.random() * this.truckMaterials.length)]
    if ((SKIN_KINDS as readonly ObstacleKind[]).includes(kind)) this.dressSkin(obstacle, z)
    this.decorate(obstacle)
    if (kind === 'car') this.fitCarDecor(obstacle)
    obstacle.mesh.position.set(
      kind === 'tunnel' ? LANES[1] : LANES[Math.max(0, Math.min(LANES.length - 1, lane))],
      spec.bottom + spec.height / 2,
      z
    )
    // Vehicles and ramps sit on the road; the tunnel arch is built around y = 0.
    if (kind === 'car' || kind === 'bus' || kind === 'ramp' || kind === 'truck') obstacle.mesh.position.y = 0
    if (kind === 'tunnel' || LASER_KINDS.includes(kind)) obstacle.mesh.position.y = 0
    const shadow = obstacle.shadow
    shadow.visible = kind !== 'tunnel' && kind !== 'mover' && !LASER_KINDS.includes(kind)
    // A touch wider than the footprint so the soft edge spills out round the base.
    shadow.scale.set(obstacle.spec.width * 1.25, obstacle.spec.depth * 1.18 + 0.5, 1)
    shadow.position.set(obstacle.mesh.position.x, 0.025, z)
    return obstacle
  }

  /**
   * Puts a moving obstacle on the road: `lanes` are the lanes it works over (one, or the
   * two it swings / slides / bars across), `vz` its own speed towards the runner.
   */
  spawnMover(
    type: MoverType,
    lanes: number[],
    z: number,
    opts: { side?: 1 | -1; phase?: number; vz?: number; look?: MoverLook } = {}
  ): Obstacle | null {
    z += this.zShift
    const item = this.place('mover', lanes[0], z)
    if (!item) return null
    const zone = this.zoneAt ? this.zoneAt(z) : 'city'
    const look = opts.look ?? lookFor(type, themeOf(zone), zone)
    item.spec = MOVER_SPECS[type]
    item.mover = createMover(type, look, lanes, z, opts.side ?? 1, opts.phase ?? 0)
    item.vz = opts.vz ?? 0
    item.mesh.userData.skin = `mover.${type}.${look}`
    let rig = item.rigs[type]
    if (!rig) {
      rig = buildRig(type, this.skinMaterial, { geometry: this.markGeometry, material: this.markMaterial })
      item.rigs[type] = rig
      item.mesh.add(rig.root)
    }
    dressRig(rig, this.moverBook, look, this.emptyGeometry)
    rig.root.visible = true
    rig.root.scale.set(1, 1, 1)
    const m = item.mover
    item.mesh.position.set(this.moverRootX(m), 0, z)
    this.poseMover(item, 0, 0)
    return item
  }

  /** Where a mover's rig is anchored across the road. */
  private moverRootX(m: MoverState): number {
    if (m.type === 'crossing') return 0
    if (m.type === 'slider' || m.type === 'pendulum') return moverMid(m)
    return LANES[m.lanes[0]]
  }

  /** Steps a mover's pose, puts its rig and shadow there and queues what it did. */
  private poseMover(item: Obstacle, dt: number, speed: number): void {
    const m = item.mover
    const rig = m && item.rigs[m.type]
    if (!m || !rig) return
    stepMover(m, this.time, dt, item.z, speed)
    poseRig(rig, m, item.mesh.position.x, this.time)
    const shadow = item.shadow
    shadow.visible = m.type !== 'crossing' && m.type !== 'sweeper'
    shadow.position.x = m.x
    switch (m.type) {
      case 'roller':
        shadow.scale.set((m.look === 'pumpkin' ? 1.05 : 1.45) * 1.15, ROLLER.radius * 2.6, 1)
        break
      case 'snowball':
        shadow.scale.set(m.size * 2.3, m.size * 2.0, 1)
        break
      case 'rockfall': {
        // The shadow gathers under the warning ring as the rock comes down.
        const k = m.drop < 0 ? 0.45 : 0.45 + 0.75 * m.drop
        shadow.scale.set(item.spec.width * 1.25 * k, item.spec.depth * 1.3 * k, 1)
        break
      }
      case 'pendulum':
        shadow.scale.set(1.3, 1.3, 1)
        break
      default:
        shadow.scale.set(item.spec.width * 1.2, item.spec.depth * 1.15 + 0.5, 1)
    }
    if (m.landed) this.moverEvents.push({ kind: 'land', x: m.x, z: item.z })
    if (m.warned && item.z > -Math.max(8, speed) * 2.6) this.moverEvents.push({ kind: 'bell', x: m.side * 4, z: item.z })
  }

  /** What the movers did since the last call (landings, bells), oldest first. */
  drainMoverEvents(): MoverEvent[] {
    if (!this.moverEvents.length) return []
    const events = this.moverEvents
    this.moverEvents = []
    return events
  }

  /**
   * Puts a car on the road in one of the five KayKit bodies (never the same one twice
   * running), with its own length as the collision box. Before the pack has loaded it
   * falls back to the tinted stand-in.
   */
  private dressCar(item: Obstacle): void {
    const models = this.carModels
    if (models.length && this.carMaterial) {
      let index = Math.floor(Math.random() * models.length)
      if (index === this.lastCar && models.length > 1) index = (index + 1 + Math.floor(Math.random() * (models.length - 1))) % models.length
      this.lastCar = index
      const model = models[index]
      item.car = model
      item.spec = model.spec
      item.mesh.geometry = model.geometry
      item.mesh.material = this.carMaterial
      return
    }
    item.spec = OBSTACLES.car
    item.mesh.geometry = this.geometries.car
    item.mesh.material = this.trafficMaterials[Math.floor(Math.random() * this.trafficMaterials.length)]
  }

  /** Moves the lamps onto the bumpers of whichever body the car is wearing. */
  private fitCarDecor(item: Obstacle): void {
    const node = item.decor.car
    if (!node) return
    const front = item.car ? item.car.front : OBSTACLES.car.depth / 2
    const back = item.car ? item.car.back : -OBSTACLES.car.depth / 2
    const lights = node.getObjectByName('headlights')
    if (lights) lights.position.z = front
    const blinkers = node.getObjectByName('blinkers')
    for (const set of blinkers?.children ?? []) {
      const [rear, nose] = set.children
      if (rear) rear.position.z = back - 0.02
      if (nose) nose.position.z = front + 0.02
    }
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
    for (const rig of Object.values(item.rigs)) if (rig) rig.root.visible = false
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
    // Cars carry their lamps on a group slid onto the bumper per body (fitCarDecor).
    const front = kind === 'car' ? 0 : 3.48
    const [lampX, lampY] = kind === 'car' ? CAR_LAMPS.head : [0.84, 0.76]
    // Headlights: only lit for oncoming traffic, so "it is coming at you" reads at a glance.
    const lights = new THREE.Group()
    lights.name = 'headlights'
    lights.position.z = front
    for (const x of [-lampX, lampX]) {
      const sprite = new THREE.Sprite(this.headGlowMaterial)
      sprite.position.set(x, lampY, 0.1)
      sprite.scale.setScalar(kind === 'car' ? 1.35 : 1.6)
      lights.add(sprite)
    }
    const cone = new THREE.Mesh(this.beamCone, this.beamConeMaterial)
    cone.rotation.x = -Math.PI / 2
    cone.position.set(0, 0.04, 4.6)
    lights.add(cone)
    root.add(lights)
    if (kind === 'car') {
      // Indicators on all four corners; only the side it is moving to flashes.
      const blinkers = new THREE.Group()
      blinkers.name = 'blinkers'
      for (const side of [-1, 1]) {
        const set = new THREE.Group()
        set.name = side < 0 ? 'left' : 'right'
        // Rear first, then nose: fitCarDecor slides them onto the bumpers.
        for (const z of [-OBSTACLES.car.depth / 2, OBSTACLES.car.depth / 2]) {
          const lamp = new THREE.Mesh(this.blinkerGeometry, this.blinkerMaterial)
          lamp.position.set(side * CAR_LAMPS.blink[0], CAR_LAMPS.blink[1], z)
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
    this.markMaterial.opacity = 0.5 + 0.42 * Math.max(0, Math.sin(this.time * 11))
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
      if (item.mover) this.poseMover(item, dt, speed)
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
    this.disposed = true
    for (const item of this.disposables) item.dispose()
    this.group.clear()
    this.pool.length = 0
  }

  private acquire(kind: ObstacleKind): Obstacle | null {
    for (const item of this.pool) {
      if (!item.active && item.kind === kind) return item
    }
    if (this.pool.length >= Math.max(this.cap, this.minCap)) {
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
      car: null,
      mover: null,
      rigs: {},
    }
    this.pool.push(obstacle)
    return obstacle
  }
}
