// Obstacles: barriers (jump), blockers (dodge), overhead bars (slide), and the
// city traffic set — car roofs you can land on, buses to swerve around, ramps
// that launch you and tunnel mouths that gate the road. Meshes are pooled per
// kind and recycled behind the camera.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LANES, OBSTACLES, RUN, type ObstacleSpec, type QualityPreset } from './config'
import { blobShadowTexture, hazardTexture, panelTexture } from './textures'
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
}

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
  const arch = new THREE.TorusGeometry(PILLAR_X, 0.5, 10, 26, Math.PI)
  arch.scale(1, 0.62, 1)
  arch.translate(0, PILLAR_TOP, 0)
  parts.push(paint(arch, 0xb7c3d4))
  const band = new THREE.TorusGeometry(PILLAR_X, 0.22, 8, 26, Math.PI)
  band.scale(1, 0.62, 1)
  band.translate(0, PILLAR_TOP, 0.66)
  parts.push(paint(band, 0xf7c33c))
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
    }
    // Traffic is painted with vertex colours so one geometry covers every livery.
    const trafficMat = (tint: number) =>
      new THREE.MeshStandardMaterial({ color: tint, vertexColors: true, roughness: 0.5, metalness: 0.28 })
    this.trafficMaterials = [trafficMat(0xff5a4a), trafficMat(0x4f9bff), trafficMat(0xffc93c), trafficMat(0xe8eef8)]
    this.materials = {
      low: hazardMat,
      tall: panelMat,
      car: this.trafficMaterials[0],
      bus: trafficMat(0xffffff),
      ramp: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }),
      tunnel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.12 }),
    }
    this.disposables.push(...Object.values(this.geometries), ...this.trafficMaterials, hazardMat, panelMat)
    this.disposables.push(this.shadowGeometry, this.shadowMaterial)
    // Real shadow maps only run on high; the blob keeps every tier grounded and on
    // high it reads as the darker contact occlusion right under the body.
    this.shadowMaterial.opacity = preset.shadows ? 0.34 : 0.5
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
    obstacle.mesh.visible = true
    obstacle.mesh.rotation.set(0, 0, 0)
    if (kind === 'car') obstacle.mesh.material = this.trafficMaterials[Math.floor(Math.random() * this.trafficMaterials.length)]
    obstacle.mesh.position.set(
      kind === 'tunnel' ? LANES[1] : LANES[Math.max(0, Math.min(LANES.length - 1, lane))],
      spec.bottom + spec.height / 2,
      z
    )
    // Vehicles and ramps sit on the road; the tunnel arch is built around y = 0.
    if (kind === 'car' || kind === 'bus' || kind === 'ramp') obstacle.mesh.position.y = 0
    if (kind === 'tunnel') obstacle.mesh.position.y = 0
    const shadow = obstacle.shadow
    shadow.visible = kind !== 'tunnel'
    // A touch wider than the footprint so the soft edge spills out round the base.
    shadow.scale.set(spec.width * 1.25, spec.depth * 1.18 + 0.5, 1)
    shadow.position.set(obstacle.mesh.position.x, 0.025, z)
    return obstacle
  }

  update(dt: number, speed: number): void {
    const dz = speed * dt
    for (const item of this.pool) {
      if (!item.active) continue
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
      item.z += dz
      item.mesh.position.z = item.z
      item.shadow.position.z = item.z
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
    }
    this.pool.push(obstacle)
    return obstacle
  }
}
