// Instanced scenery: trees, rocks, crystals and ruins — plus ground sampling helpers.
import * as THREE from 'three'
import type { TerrainField } from '../noise'
import type { ZoneDef, ZonePalette } from '../zones'

export interface Collider {
  x: number
  z: number
  r: number
  h: number
}

export interface GroundSpotOptions {
  islandRadius: number
  minSlope?: number
  maxSlope?: number
  minY?: number
  minRadius?: number
  maxRadius?: number
  avoid?: Collider[]
  avoidRadius?: number
  clearance?: { x: number; z: number; r: number }[]
  attempts?: number
}

export function findGroundSpot(
  field: TerrainField,
  rng: () => number,
  opts: GroundSpotOptions
): { x: number; y: number; z: number } | null {
  const {
    islandRadius,
    minSlope = 0,
    maxSlope = 0.34,
    minY = 0.6,
    minRadius = 0,
    maxRadius = islandRadius * 0.94,
    avoid,
    avoidRadius = 1.4,
    clearance,
    attempts = 90,
  } = opts

  for (let i = 0; i < attempts; i++) {
    const angle = rng() * Math.PI * 2
    const radius = Math.sqrt(rng()) * (maxRadius - minRadius) + minRadius
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const y = field.height(x, z)
    if (y < minY) continue
    const slope = field.slope(x, z)
    if (slope < minSlope || slope > maxSlope) continue
    if (avoid) {
      let blocked = false
      for (const c of avoid) {
        const dx = c.x - x
        const dz = c.z - z
        if (dx * dx + dz * dz < (c.r + avoidRadius) * (c.r + avoidRadius)) {
          blocked = true
          break
        }
      }
      if (blocked) continue
    }
    if (clearance) {
      let blocked = false
      for (const c of clearance) {
        const dx = c.x - x
        const dz = c.z - z
        if (dx * dx + dz * dz < c.r * c.r) {
          blocked = true
          break
        }
      }
      if (blocked) continue
    }
    return { x, y, z }
  }
  return null
}

/** A safe, gently sloped landing pad near the middle of the island. */
export function findSpawnSpot(
  field: TerrainField,
  islandRadius: number,
  rng: () => number
): { x: number; y: number; z: number } {
  const maxRadius = islandRadius * 0.34
  let best: { x: number; z: number; score: number } | null = null
  for (let i = 0; i < 320; i++) {
    const angle = rng() * Math.PI * 2
    const radius = Math.sqrt(rng()) * maxRadius
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const y = field.height(x, z)
    if (y < 2.2) continue
    const slope = field.slope(x, z)
    if (slope > 0.2) continue
    const score = y - slope * 45 - radius * 0.06
    if (!best || score > best.score) best = { x, z, score }
  }
  if (best) return { x: best.x, y: field.height(best.x, best.z), z: best.z }

  // Fallback: the highest sample found near the centre.
  let fallback = { x: 0, z: 0 }
  let bestHeight = -Infinity
  for (let i = 0; i < 200; i++) {
    const angle = rng() * Math.PI * 2
    const radius = Math.sqrt(rng()) * maxRadius
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const y = field.height(x, z)
    if (y > bestHeight) {
      bestHeight = y
      fallback = { x, z }
    }
  }
  return { x: fallback.x, y: field.height(fallback.x, fallback.z), z: fallback.z }
}

interface Placement {
  x: number
  y: number
  z: number
  rot: number
  scale: number
  tilt: number
}

export class PropField {
  readonly group = new THREE.Group()
  readonly colliders: Collider[] = []
  private meshes: THREE.InstancedMesh[] = []
  private crystalMaterial: THREE.MeshStandardMaterial | null = null

  constructor(
    field: TerrainField,
    zone: ZoneDef,
    palette: ZonePalette,
    density: number,
    rng: () => number,
    spawnClear = 14
  ) {
    const islandRadius = zone.islandRadius
    const clearance: { x: number; z: number; r: number }[] = [
      { x: 0, z: 0, r: spawnClear },
    ]

    const trunkMat = new THREE.MeshStandardMaterial({
      color: palette.trunk,
      roughness: 0.92,
      flatShading: true,
    })
    const foliageMat = new THREE.MeshStandardMaterial({
      color: palette.foliage,
      roughness: 0.85,
      flatShading: true,
    })
    const foliageAltMat = new THREE.MeshStandardMaterial({
      color: palette.foliageAlt,
      roughness: 0.85,
      flatShading: true,
    })
    const rockMat = new THREE.MeshStandardMaterial({
      color: palette.rock,
      roughness: 0.95,
      flatShading: true,
    })
    const ruinMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.rock).lerp(new THREE.Color(palette.peak), 0.45),
      roughness: 0.88,
      flatShading: true,
    })
    const crystalMat = new THREE.MeshStandardMaterial({
      color: palette.crystal,
      emissive: new THREE.Color(palette.crystal),
      emissiveIntensity: 1.1,
      roughness: 0.25,
      metalness: 0.15,
      flatShading: true,
    })
    this.crystalMaterial = crystalMat

    const place = (count: number, minSlope: number, maxSlope: number, minY: number, minGap: number): Placement[] => {
      const out: Placement[] = []
      const target = Math.max(0, Math.round(count * density))
      let attempts = 0
      while (out.length < target && attempts < target * 26 + 40) {
        attempts++
        const spot = findGroundSpot(field, rng, {
          islandRadius,
          minSlope,
          maxSlope,
          minY,
          clearance,
          attempts: 6,
        })
        if (!spot) continue
        let tooClose = false
        for (const p of out) {
          const dx = p.x - spot.x
          const dz = p.z - spot.z
          if (dx * dx + dz * dz < minGap * minGap) {
            tooClose = true
            break
          }
        }
        if (tooClose) continue
        out.push({
          x: spot.x,
          y: spot.y,
          z: spot.z,
          rot: rng() * Math.PI * 2,
          scale: 0.75 + rng() * 0.6,
          tilt: (rng() - 0.5) * 0.16,
        })
      }
      return out
    }

    // ------------------------------------------------------------------ trees
    const trees = place(zone.props.trees, 0, 0.3, 1.2, 5.5)
    if (trees.length > 0) {
      const trunkGeo = new THREE.CylinderGeometry(0.22, 0.36, 3.6, 6)
      trunkGeo.translate(0, 1.8, 0)
      const coneGeo = new THREE.ConeGeometry(1.9, 3.6, 7)
      coneGeo.translate(0, 4.5, 0)
      const coneGeo2 = new THREE.ConeGeometry(1.35, 3.0, 7)
      coneGeo2.translate(0, 6.4, 0)

      const trunks = this.makeInstanced(trunkGeo, trunkMat, trees.length)
      const cones = this.makeInstanced(coneGeo, foliageMat, trees.length)
      const cones2 = this.makeInstanced(coneGeo2, foliageAltMat, trees.length)
      const matrix = new THREE.Matrix4()
      const quat = new THREE.Quaternion()
      const euler = new THREE.Euler()
      const pos = new THREE.Vector3()
      const scl = new THREE.Vector3()
      trees.forEach((t, i) => {
        euler.set(t.tilt, t.rot, t.tilt * 0.6)
        quat.setFromEuler(euler)
        pos.set(t.x, t.y - 0.2, t.z)
        scl.setScalar(t.scale)
        matrix.compose(pos, quat, scl)
        trunks.setMatrixAt(i, matrix)
        cones.setMatrixAt(i, matrix)
        cones2.setMatrixAt(i, matrix)
        this.colliders.push({ x: t.x, z: t.z, r: 0.55 * t.scale, h: 6 * t.scale })
      })
      this.finish(trunks)
      this.finish(cones)
      this.finish(cones2)
      trunkGeo.dispose()
      coneGeo.dispose()
      coneGeo2.dispose()
    }

    // ------------------------------------------------------------------ rocks
    const rocks = place(zone.props.rocks, 0, 0.62, 0.3, 3.2)
    if (rocks.length > 0) {
      const rockGeo = new THREE.IcosahedronGeometry(1.15, 0)
      const mesh = this.makeInstanced(rockGeo, rockMat, rocks.length)
      const matrix = new THREE.Matrix4()
      const quat = new THREE.Quaternion()
      const euler = new THREE.Euler()
      const pos = new THREE.Vector3()
      const scl = new THREE.Vector3()
      rocks.forEach((r, i) => {
        const s = r.scale * (0.7 + rng() * 0.8)
        euler.set(r.tilt * 2, r.rot, r.tilt * 3)
        quat.setFromEuler(euler)
        pos.set(r.x, r.y + s * 0.35, r.z)
        scl.set(s * (0.8 + rng() * 0.5), s * (0.7 + rng() * 0.6), s * (0.8 + rng() * 0.5))
        matrix.compose(pos, quat, scl)
        mesh.setMatrixAt(i, matrix)
        if (s > 0.95) this.colliders.push({ x: r.x, z: r.z, r: s * 0.85, h: s * 1.2 })
      })
      this.finish(mesh)
      rockGeo.dispose()
    }

    // --------------------------------------------------------------- crystals
    const crystals = place(zone.props.crystals, 0, 0.55, 0.5, 4)
    if (crystals.length > 0) {
      const geo = new THREE.OctahedronGeometry(0.78, 0)
      geo.translate(0, 1.1, 0)
      const mesh = this.makeInstanced(geo, crystalMat, crystals.length)
      const matrix = new THREE.Matrix4()
      const quat = new THREE.Quaternion()
      const euler = new THREE.Euler()
      const pos = new THREE.Vector3()
      const scl = new THREE.Vector3()
      crystals.forEach((c, i) => {
        const s = c.scale * (0.8 + rng() * 0.9)
        euler.set(c.tilt, c.rot, c.tilt * 1.4)
        quat.setFromEuler(euler)
        pos.set(c.x, c.y, c.z)
        scl.set(s, s * (1.1 + rng() * 0.9), s)
        matrix.compose(pos, quat, scl)
        mesh.setMatrixAt(i, matrix)
        this.colliders.push({ x: c.x, z: c.z, r: 0.5 * s, h: 2 })
      })
      this.finish(mesh)
      geo.dispose()
    }

    // ------------------------------------------------------------------ ruins
    const ruins = place(zone.props.ruins, 0, 0.34, 0.6, 7)
    if (ruins.length > 0) {
      const pillarGeo = new THREE.CylinderGeometry(0.62, 0.78, 4.6, 8)
      pillarGeo.translate(0, 2.3, 0)
      const slabGeo = new THREE.BoxGeometry(2.6, 0.7, 1.4)
      slabGeo.translate(0, 0.35, 0)
      const pillars = this.makeInstanced(pillarGeo, ruinMat, ruins.length)
      const slabs = this.makeInstanced(slabGeo, ruinMat, ruins.length)
      const matrix = new THREE.Matrix4()
      const quat = new THREE.Quaternion()
      const euler = new THREE.Euler()
      const pos = new THREE.Vector3()
      const scl = new THREE.Vector3()
      ruins.forEach((r, i) => {
        const broken = rng() < 0.45
        const height = broken ? 0.35 + rng() * 0.4 : 0.85 + rng() * 0.35
        euler.set(r.tilt * 1.5, r.rot, r.tilt * 1.2)
        quat.setFromEuler(euler)
        pos.set(r.x, r.y - 0.15, r.z)
        scl.set(r.scale, r.scale * height, r.scale)
        matrix.compose(pos, quat, scl)
        pillars.setMatrixAt(i, matrix)
        this.colliders.push({ x: r.x, z: r.z, r: 0.8 * r.scale, h: 5 * height })

        euler.set(0, r.rot + 0.6, r.tilt)
        quat.setFromEuler(euler)
        pos.set(r.x + Math.cos(r.rot) * 2.6, r.y - 0.1, r.z + Math.sin(r.rot) * 2.6)
        scl.setScalar(r.scale * 0.9)
        matrix.compose(pos, quat, scl)
        slabs.setMatrixAt(i, matrix)
      })
      this.finish(pillars)
      this.finish(slabs)
      pillarGeo.dispose()
      slabGeo.dispose()
    }
  }

  private makeInstanced(geometry: THREE.BufferGeometry, material: THREE.Material, count: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = true
    this.group.add(mesh)
    this.meshes.push(mesh)
    return mesh
  }

  private finish(mesh: THREE.InstancedMesh): void {
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }

  update(time: number): void {
    if (this.crystalMaterial) {
      this.crystalMaterial.emissiveIntensity = 0.85 + Math.sin(time * 1.8) * 0.35
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose()
      const mat = mesh.material as THREE.Material | THREE.Material[]
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
      mesh.dispose()
    }
    this.meshes = []
    this.colliders.length = 0
  }
}
