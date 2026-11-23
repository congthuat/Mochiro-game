// Bridges over water (config.ts WATERS, side 0): the river's cable-stayed bridge and the
// long viaduct across the sea. The ground is cut away under them (surface.ts); this
// draws everything else — the deep water below, the earth banks at each end, the deck
// girder, railings, lamps, piers, the bridge's towers and, out at sea, dolphins.
//
// Continuous parts (water, girder, rails) are single meshes that stay under the camera
// and are clipped per pixel to the crossing; the repeating ones (posts, lamps, piers,
// towers) are instanced and laid at fixed run distances every frame, so they sit still
// in the world while the road scrolls past.
import * as THREE from 'three'
import { DEEP_WATER_Y, shoreAt, watersBetween, type QualityPreset, type WaterHere } from './config'
import { applyCrossingClip, applyDeepWater, applySurface } from './surface'

const GROUND_Y = -0.34
const BANK_RUN = 9
const BANK_FOOT = DEEP_WATER_Y - 0.7
/** Length of the follow-camera strips, matching the ground (track.ts). */
const STRIP = 380
const STRIP_Z = -140
const DECK_HALF = 7.6
const RAIL_X = 7.3
const WALK_TOP = 0.3

const FASCIA: Record<string, number> = { cable: 0xc8463a, viaduct: 0x2f6fb5, skyway: 0x6a4bd8 }

/** Instances laid out afresh each frame. */
class Pool {
  readonly mesh: THREE.InstancedMesh
  private n = 0
  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, readonly cap: number, name: string) {
    this.mesh = new THREE.InstancedMesh(geometry, material, cap)
    this.mesh.name = name
    this.mesh.frustumCulled = false
    this.mesh.count = 0
  }
  begin(): void {
    this.n = 0
  }
  add(matrix: THREE.Matrix4): void {
    if (this.n >= this.cap) return
    this.mesh.setMatrixAt(this.n++, matrix)
  }
  end(): void {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z)
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // A hand merge: the parts are all non-indexed-compatible boxes and cylinders.
  const geometries = parts.map((part) => (part.index ? part.toNonIndexed() : part))
  const merged = new THREE.BufferGeometry()
  for (const name of ['position', 'normal'] as const) {
    const total = geometries.reduce((sum, g) => sum + g.getAttribute(name).array.length, 0)
    const array = new Float32Array(total)
    let offset = 0
    for (const g of geometries) {
      array.set(g.getAttribute(name).array as Float32Array, offset)
      offset += g.getAttribute(name).array.length
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, 3))
  }
  for (const part of parts) part.dispose()
  for (const g of geometries) g.dispose()
  return merged
}

/** A slope from the ground at the water's edge down below the water, 1000 m wide. */
function bankGeometry(): THREE.BufferGeometry {
  const drop = GROUND_Y - BANK_FOOT
  const length = Math.hypot(BANK_RUN, drop)
  const geometry = new THREE.PlaneGeometry(1000, length, 1, 1)
  geometry.rotateX(-Math.PI / 2)
  geometry.rotateX(-Math.atan2(drop, BANK_RUN))
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox!
  geometry.translate(0, GROUND_Y - bb.max.y, -bb.max.z)
  return geometry
}

/** A dolphin, nose to -z, about 2.4 m long. */
function dolphinGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(1, 10, 7)
  body.scale(0.38, 0.4, 1.2)
  const nose = new THREE.ConeGeometry(0.14, 0.5, 6)
  nose.rotateX(-Math.PI / 2)
  nose.translate(0, -0.06, -1.35)
  const fin = new THREE.ConeGeometry(0.2, 0.55, 4)
  fin.scale(0.35, 1, 1)
  fin.rotateX(0.5)
  fin.translate(0, 0.5, 0.15)
  const tail = new THREE.BoxGeometry(0.9, 0.06, 0.32)
  tail.translate(0, 0, 1.25)
  return merge([body, nose, fin, tail])
}

interface Dolphin {
  /** Clock time the current leap starts and how long it lasts. */
  start: number
  air: number
  at: number
  x: number
  water: number
  height: number
  travel: number
}

export class Crossing {
  readonly group = new THREE.Group()
  private fogFar: number
  private readonly deep: THREE.Mesh
  private readonly banks: [THREE.Mesh, THREE.Mesh]
  private readonly strips: THREE.Group
  private readonly fasciaMat: THREE.MeshStandardMaterial
  private readonly posts: Pool
  private readonly poles: Pool
  private readonly heads: Pool
  private readonly piers: Pool
  private readonly towers: Pool
  private readonly beacons: Pool
  private readonly pylons: THREE.Group
  private readonly dolphins: Pool
  private readonly pods: Dolphin[] = []
  private readonly matrix = new THREE.Matrix4()
  private readonly quat = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly pos = new THREE.Vector3()
  private readonly scale = new THREE.Vector3(1, 1, 1)
  private disposables: Array<{ dispose: () => void }> = []

  constructor(quality: QualityPreset) {
    this.fogFar = quality.fogFar
    this.group.name = 'crossing'

    // --- the water and its banks --------------------------------------------
    const waterGeo = new THREE.PlaneGeometry(1000, STRIP)
    waterGeo.rotateX(-Math.PI / 2)
    const waterMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.05 })
    applyDeepWater(waterMat)
    this.deep = new THREE.Mesh(waterGeo, waterMat)
    this.deep.name = 'deep-water'
    this.deep.position.set(0, DEEP_WATER_Y, STRIP_Z)
    this.group.add(this.deep)

    const bankGeo = bankGeometry()
    const bankMat = new THREE.MeshStandardMaterial({ color: 0x9c9284, roughness: 0.97, metalness: 0, side: THREE.DoubleSide })
    applySurface(bankMat, 'bank')
    const near = new THREE.Mesh(bankGeo, bankMat)
    const far = new THREE.Mesh(bankGeo, bankMat)
    far.rotation.y = Math.PI
    near.name = far.name = 'bank'
    this.banks = [near, far]
    this.group.add(near, far)
    this.disposables.push(waterGeo, waterMat, bankGeo, bankMat)

    // --- the deck: girder, fascia, rails (clipped to the crossing) ------------
    this.strips = new THREE.Group()
    this.strips.name = 'bridge-deck'
    const concrete = new THREE.MeshStandardMaterial({ color: 0xbdb8ae, roughness: 0.9, metalness: 0 })
    applyCrossingClip(concrete, 3)
    this.fasciaMat = new THREE.MeshStandardMaterial({ color: FASCIA.cable, roughness: 0.6, metalness: 0.1 })
    applyCrossingClip(this.fasciaMat, 3)
    const steel = new THREE.MeshStandardMaterial({ color: 0x8e9aa6, roughness: 0.45, metalness: 0.55 })
    applyCrossingClip(steel, 0)
    const girder = box(DECK_HALF * 2, 1.9, STRIP, 0, -0.97, STRIP_Z)
    const fascia = box(DECK_HALF * 2 + 0.2, 0.42, STRIP, 0, -0.28, STRIP_Z)
    const rails = merge([
      box(0.1, 0.1, STRIP, -RAIL_X, WALK_TOP + 1.1, STRIP_Z),
      box(0.1, 0.1, STRIP, RAIL_X, WALK_TOP + 1.1, STRIP_Z),
      box(0.05, 0.05, STRIP, -RAIL_X, WALK_TOP + 0.6, STRIP_Z),
      box(0.05, 0.05, STRIP, RAIL_X, WALK_TOP + 0.6, STRIP_Z),
    ])
    for (const [geometry, material, name] of [
      [girder, concrete, 'girder'],
      [fascia, this.fasciaMat, 'fascia'],
      [rails, steel, 'rails'],
    ] as const) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = name
      mesh.frustumCulled = false
      this.strips.add(mesh)
      this.disposables.push(geometry)
    }
    this.group.add(this.strips)
    this.disposables.push(concrete, this.fasciaMat, steel)

    // --- posts, lamps, piers, the sea viaduct's gantries ----------------------
    const plain = new THREE.MeshStandardMaterial({ color: 0x8e9aa6, roughness: 0.5, metalness: 0.5 })
    const white = new THREE.MeshStandardMaterial({ color: 0xece8e0, roughness: 0.7, metalness: 0.05 })
    const glow = new THREE.MeshBasicMaterial({ color: 0xffe2a8 })
    const red = new THREE.MeshBasicMaterial({ color: 0xff3b30 })
    const postGeo = box(0.1, 1.1, 0.1, 0, WALK_TOP + 0.55, 0)
    const poleGeo = merge([box(0.18, 6.2, 0.18, 0, WALK_TOP + 3.1, 0), box(0.9, 0.12, 0.12, -0.4, WALK_TOP + 6.1, 0)])
    const headGeo = box(0.7, 0.16, 0.34, -0.75, WALK_TOP + 6.0, 0)
    const pierGeo = merge([
      box(1.8, 4.8, 1.8, -4.4, -4.3, 0),
      box(1.8, 4.8, 1.8, 4.4, -4.3, 0),
      box(12, 0.9, 2.4, 0, -2.3, 0),
    ])
    const towerGeo = merge([
      box(1.2, 26, 1.2, -8.8, 7, 0),
      box(1.2, 26, 1.2, 8.8, 7, 0),
      box(19, 1.4, 1.3, 0, 18.6, 0),
      box(19, 0.8, 1.0, 0, 11.4, 0),
      box(2.6, 1.6, 2.6, -8.8, -5.4, 0),
      box(2.6, 1.6, 2.6, 8.8, -5.4, 0),
    ])
    const beaconGeo = merge([box(0.45, 0.45, 0.45, -8.8, 20.3, 0), box(0.45, 0.45, 0.45, 8.8, 20.3, 0)])
    const span = quality.fogFar + 100
    this.posts = new Pool(postGeo, plain, Math.ceil(span / 2.5) * 2 + 4, 'bridge-posts')
    this.poles = new Pool(poleGeo, plain, Math.ceil(span / 30) * 2 + 4, 'bridge-lamps')
    this.heads = new Pool(headGeo, glow, Math.ceil(span / 30) * 2 + 4, 'bridge-lamp-heads')
    this.piers = new Pool(pierGeo, white, Math.ceil(span / 45) + 4, 'bridge-piers')
    this.towers = new Pool(towerGeo, white, 4, 'bridge-towers')
    this.beacons = new Pool(beaconGeo, red, 4, 'bridge-beacons')
    for (const pool of [this.posts, this.poles, this.heads, this.piers, this.towers, this.beacons]) this.group.add(pool.mesh)
    this.disposables.push(plain, white, glow, red, postGeo, poleGeo, headGeo, pierGeo, towerGeo, beaconGeo)
    for (const pool of [this.posts, this.poles, this.heads, this.piers, this.towers, this.beacons]) this.disposables.push(pool.mesh)

    // --- the river bridge's two pylons and their stay cables ------------------
    this.pylons = this.cablePylons(white)

    // --- dolphins -----------------------------------------------------------
    const dolphinGeo = dolphinGeometry()
    const dolphinMat = new THREE.MeshStandardMaterial({ color: 0x7d98ae, roughness: 0.35, metalness: 0.1, flatShading: true })
    this.dolphins = new Pool(dolphinGeo, dolphinMat, 3, 'dolphins')
    this.group.add(this.dolphins.mesh)
    this.disposables.push(dolphinGeo, dolphinMat, this.dolphins.mesh)
    for (let i = 0; i < 3; i++) this.pods.push({ start: -1e9, air: 1, at: 0, x: 0, water: 0, height: 0, travel: 0 })

    this.group.traverse((object) => {
      object.castShadow = false
      object.receiveShadow = false
    })
    this.setVisible(false)
  }

  /** H-shaped pylons 120 m apart with a fan of stays each way; laid out from the bridge's start. */
  private cablePylons(material: THREE.Material): THREE.Group {
    const group = new THREE.Group()
    group.name = 'bridge-pylons'
    const pylonParts: THREE.BufferGeometry[] = []
    const cables: Array<[THREE.Vector3, THREE.Vector3]> = []
    for (const z of [-60, -180]) {
      for (const side of [-1, 1]) {
        pylonParts.push(box(1.5, 39, 1.8, side * 8.8, 12.5, z))
        pylonParts.push(box(3.4, 2.4, 3.6, side * 8.8, -5.4, z))
      }
      pylonParts.push(box(19, 2, 1.6, 0, 14.5, z), box(19, 1.4, 1.4, 0, 30.6, z), box(18, 0.8, 1.2, 0, -2.6, z))
      for (const side of [-1, 1]) {
        for (const d of [14, 22, 30, 38, 46, 54]) {
          for (const dir of [-1, 1]) {
            cables.push([new THREE.Vector3(side * 8.8, 30 - d * 0.12, z), new THREE.Vector3(side * RAIL_X, WALK_TOP + 0.9, z + dir * d)])
          }
        }
      }
    }
    const pylonGeo = merge(pylonParts)
    const pylon = new THREE.Mesh(pylonGeo, material)
    pylon.name = 'pylons'
    group.add(pylon)

    const cableGeo = new THREE.BoxGeometry(0.11, 0.11, 1)
    const cableMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.5, metalness: 0.2 })
    const stays = new THREE.InstancedMesh(cableGeo, cableMat, cables.length)
    stays.name = 'stays'
    const up = new THREE.Vector3(0, 0, 1)
    const dir = new THREE.Vector3()
    cables.forEach(([a, b], i) => {
      dir.subVectors(b, a)
      const length = dir.length()
      this.quat.setFromUnitVectors(up, dir.normalize())
      this.pos.addVectors(a, b).multiplyScalar(0.5)
      this.scale.set(1, 1, length)
      this.matrix.compose(this.pos, this.quat, this.scale)
      stays.setMatrixAt(i, this.matrix)
    })
    this.scale.set(1, 1, 1)
    group.add(stays)
    this.group.add(group)
    this.disposables.push(pylonGeo, cableGeo, cableMat, stays)
    return group
  }

  private setVisible(on: boolean): void {
    this.deep.visible = on
    this.banks[0].visible = on
    this.banks[1].visible = on
    this.strips.visible = on
  }

  setQuality(quality: QualityPreset): void {
    this.fogFar = quality.fogFar
  }

  /** Lays everything out for the run at `distance`; `inView` is what updateSurface returned. */
  update(distance: number, time: number, inView: boolean): void {
    const from = distance - 60
    const to = distance + this.fogFar + 40
    const pools = [this.posts, this.poles, this.heads, this.piers, this.towers, this.beacons]
    for (const pool of pools) pool.begin()
    this.pylons.visible = false
    this.setVisible(inView)
    let crossing: WaterHere | null = null
    if (inView) {
      for (const here of watersBetween(from, to)) {
        if (here.span.side !== 0) continue
        crossing = here
        break
      }
    }
    if (crossing) {
      const { start, end } = crossing
      const kind = crossing.span.bridge ?? 'viaduct'
      this.banks[0].position.z = distance - start
      this.banks[1].position.z = distance - end
      this.fasciaMat.color.setHex(FASCIA[kind] ?? FASCIA.viaduct)
      const lo = Math.max(from, start)
      const hi = Math.min(to, end)
      this.every(2.5, lo, hi, start - 2, end + 2, (at) => {
        for (const side of [-1, 1]) this.lay(this.posts, side * RAIL_X, distance - at)
      })
      this.every(30, lo, hi, start + 6, end - 6, (at, k) => {
        const side = k % 2 === 0 ? 1 : -1
        this.lay(this.poles, side * 7.0, distance - at, side > 0 ? 0 : Math.PI)
        this.lay(this.heads, side * 7.0, distance - at, side > 0 ? 0 : Math.PI)
      })
      if (kind !== 'cable') {
        this.every(45, lo, hi, start + 20, end - 20, (at) => this.lay(this.piers, 0, distance - at))
        this.every(260, lo, hi, start + 90, end - 90, (at) => {
          this.lay(this.towers, 0, distance - at)
          this.lay(this.beacons, 0, distance - at)
        })
      } else {
        this.pylons.visible = true
        this.pylons.position.z = distance - start
      }
    }
    for (const pool of pools) pool.end()
    this.updateDolphins(distance, time)
  }

  /** Calls `fn` at every multiple of `period` (absolute run distance) in [lo, hi] that is also in [min, max]. */
  private every(period: number, lo: number, hi: number, min: number, max: number, fn: (at: number, k: number) => void): void {
    const a = Math.max(lo, min)
    const b = Math.min(hi, max)
    for (let k = Math.ceil(a / period); k * period <= b; k++) fn(k * period, k)
  }

  private lay(pool: Pool, x: number, z: number, rotY = 0, y = 0): void {
    this.euler.set(0, rotY, 0)
    this.quat.setFromEuler(this.euler)
    this.pos.set(x, y, z)
    this.matrix.compose(this.pos, this.quat, this.scale)
    pool.add(this.matrix)
  }

  /** Out at sea, now and then a dolphin leaps — beside the beach and from the viaduct. */
  private updateDolphins(distance: number, time: number): void {
    const pool = this.dolphins
    pool.begin()
    for (const pod of this.pods) {
      let u = (time - pod.start) / pod.air
      if (u > 1.6 || u < 0) {
        // Under water: pick the next leap somewhere ahead, if there is open sea there.
        const at = distance + 50 + Math.random() * 110
        const spot = this.seaSpot(at)
        if (!spot) continue
        pod.start = time + Math.random() * 2.5
        pod.air = 1.3 + Math.random() * 0.5
        pod.at = at
        pod.x = spot.x
        pod.water = spot.y
        pod.height = 2.2 + Math.random() * 1.8
        pod.travel = 8 + Math.random() * 5
        u = (time - pod.start) / pod.air
      }
      if (u < 0 || u > 1) continue
      const at = pod.at + u * pod.travel
      const y = pod.water - 0.6 + (pod.height + 0.6) * 4 * u * (1 - u)
      const slope = ((pod.height + 0.6) * 4 * (1 - 2 * u)) / pod.travel
      this.euler.set(Math.atan(slope), 0, 0)
      this.quat.setFromEuler(this.euler)
      this.pos.set(pod.x, y, distance - at)
      this.matrix.compose(this.pos, this.quat, this.scale)
      pool.add(this.matrix)
    }
    pool.end()
  }

  private seaSpot(at: number): { x: number; y: number } | null {
    for (const here of watersBetween(at, at)) {
      if (!here.span.sea) continue
      if (here.span.side === 0) {
        if (at - here.start < 40 || here.end - at < 40) return null
        const side = Math.random() < 0.5 ? -1 : 1
        return { x: side * (16 + Math.random() * 45), y: DEEP_WATER_Y }
      }
      const shore = shoreAt(at, here.span.side)
      if (shore === null || shore > 80) return null
      return { x: here.span.side * (shore + 16 + Math.random() * 45), y: GROUND_Y }
    }
    return null
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const item of this.disposables) item.dispose()
    this.disposables.length = 0
  }
}
