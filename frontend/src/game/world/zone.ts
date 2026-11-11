// Assembles a complete, playable zone: lights, sky, terrain, water, scenery.
import * as THREE from 'three'
import { TerrainField, mulberry32 } from '../noise'
import type { ZoneDef } from '../zones'
import type { QualityPreset } from '../config'
import { SkyDome } from './sky'
import { Terrain } from './terrain'
import { Water } from './water'
import { PropField, findSpawnSpot, type Collider } from './props'
import { MoteField } from '../effects'

export const WATER_LEVEL = 0

export interface WorldRef {
  readonly zone: ZoneDef
  readonly field: TerrainField
  readonly colliders: Collider[]
  readonly group: THREE.Group
  readonly spawnPoint: THREE.Vector3
  readonly portalSpot: THREE.Vector3
  heightAt(x: number, z: number): number
  resolveCollision(pos: THREE.Vector3, radius: number): void
  update(dt: number, time: number, playerPos: THREE.Vector3): void
  dispose(): void
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 16)
  })

export class ZoneWorld implements WorldRef {
  readonly group = new THREE.Group()
  readonly field: TerrainField
  readonly colliders: Collider[] = []
  readonly spawnPoint = new THREE.Vector3(0, 0, 0)
  readonly portalSpot = new THREE.Vector3()
  readonly sunDir: THREE.Vector3
  readonly fogNear: number
  readonly fogFar: number

  private sun: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private ambient: THREE.AmbientLight
  private sky: SkyDome
  private water: Water | null = null
  private terrain: Terrain | null = null
  private props: PropField | null = null
  private motes: MoteField | null = null

  constructor(
    readonly zone: ZoneDef,
    private preset: QualityPreset,
    private rng: () => number
  ) {
    const palette = zone.palette
    this.field = new TerrainField(
      {
        seed: zone.seed,
        maxHeight: zone.maxHeight,
        islandRadius: zone.islandRadius,
        sharpness: zone.sharpness,
      },
      240
    )

    // Sun direction: fixed per zone for a consistent lighting mood.
    const sunAngle = (zone.index * 0.9 + 0.7) % (Math.PI * 2)
    this.sunDir = new THREE.Vector3(Math.cos(sunAngle) * 0.55, 0.78, Math.sin(sunAngle) * 0.55).normalize()

    this.hemi = new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, 0.85)
    this.hemi.position.set(0, 40, 0)
    this.group.add(this.hemi)

    this.ambient = new THREE.AmbientLight(palette.hemiSky, 0.28)
    this.group.add(this.ambient)

    this.sun = new THREE.DirectionalLight(palette.sunColor, palette.sunIntensity)
    this.sun.position.copy(this.sunDir).multiplyScalar(70)
    this.sun.castShadow = preset.shadows
    this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize)
    const cam = this.sun.shadow.camera
    cam.left = -46
    cam.right = 46
    cam.top = 46
    cam.bottom = -46
    cam.near = 1
    cam.far = 220
    cam.updateProjectionMatrix()
    this.sun.shadow.bias = -0.0008
    this.sun.shadow.normalBias = 0.035
    this.group.add(this.sun)
    this.group.add(this.sun.target)

    this.sky = new SkyDome()
    this.sky.configure(palette, this.sunDir)
    this.group.add(this.sky.group)

    this.fogNear = 55 * preset.fogScale
    this.fogFar = (zone.index === 3 ? 165 : 235) * preset.fogScale

    const spawn = findSpawnSpot(this.field, zone.islandRadius, this.rng)
    this.spawnPoint.set(spawn.x, spawn.y + 0.2, spawn.z)
    const spot = this.findFlatSpot(0.5 * zone.islandRadius) || { x: spawn.x, z: spawn.z }
    this.portalSpot.set(spot.x, this.field.height(spot.x, spot.z) + 0.05, spot.z)
  }

  /** Heavy terrain + water generation (called from the staged builder). */
  buildGround(): void {
    const palette = this.zone.palette
    this.terrain = new Terrain(this.field, palette, this.preset.terrainSegments, 240)
    this.group.add(this.terrain.mesh)
    this.water = new Water(240, palette, this.sunDir, this.fogNear, this.fogFar)
    this.water.configure(palette, this.sunDir, this.fogNear, this.fogFar, this.zone.index === 4)
    this.group.add(this.water.mesh)
  }

  /** Scenery pass — instanced props + ambient motes. */
  buildScenery(): void {
    const palette = this.zone.palette
    this.props = new PropField(this.field, this.zone, palette, this.preset.propDensity, this.rng, 15)
    this.colliders.push(...this.props.colliders)
    this.group.add(this.props.group)
    this.motes = new MoteField(this.preset.motes, palette.mote, this.zone.index === 3 ? 0.75 : 0.5)
    this.group.add(this.motes.points)
  }

  private findFlatSpot(minRadius: number): { x: number; z: number } | null {
    let best: { x: number; z: number; score: number } | null = null
    for (let i = 0; i < 220; i++) {
      const angle = this.rng() * Math.PI * 2
      const radius = minRadius + this.rng() * (this.zone.islandRadius * 0.38)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const y = this.field.height(x, z)
      if (y < 1.5) continue
      const slope = this.field.slope(x, z)
      if (slope > 0.22) continue
      const score = y - slope * 30
      if (!best || score > best.score) best = { x, z, score }
    }
    return best ? { x: best.x, z: best.z } : null
  }

  heightAt(x: number, z: number): number {
    return this.field.height(x, z)
  }

  resolveCollision(pos: THREE.Vector3, radius: number): void {
    for (const c of this.colliders) {
      const dx = pos.x - c.x
      const dz = pos.z - c.z
      const minDist = c.r + radius
      const distSq = dx * dx + dz * dz
      if (distSq >= minDist * minDist || distSq < 1e-6) continue
      const dist = Math.sqrt(distSq)
      const push = (minDist - dist) / dist
      pos.x += dx * push
      pos.z += dz * push
    }
  }

  update(dt: number, time: number, playerPos: THREE.Vector3): void {
    this.sky.update(dt, playerPos)
    this.water?.update(time)
    this.props?.update(time)
    this.motes?.update(dt, time, playerPos)
    // Keep the shadow frustum tight around the player.
    this.sun.position.set(
      playerPos.x + this.sunDir.x * 70,
      playerPos.y + this.sunDir.y * 70,
      playerPos.z + this.sunDir.z * 70
    )
    this.sun.target.position.copy(playerPos)
    this.sun.target.updateMatrixWorld()
  }

  setShadows(enabled: boolean): void {
    this.sun.castShadow = enabled
  }

  setShadowQuality(size: number): void {
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size)
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null
    }
  }

  dispose(): void {
    this.terrain?.dispose()
    this.water?.dispose()
    this.props?.dispose()
    this.motes?.dispose()
    this.sky.dispose()
    this.colliders.length = 0
    this.group.clear()
  }
}

export async function buildZone(
  zone: ZoneDef,
  preset: QualityPreset,
  onProgress: (pct: number, label: string) => void
): Promise<ZoneWorld> {
  const rng = mulberry32(zone.seed * 7919 + 13)
  onProgress(0.05, 'Calibrating the sky')
  await nextFrame()
  const world = new ZoneWorld(zone, preset, rng)
  onProgress(0.3, 'Raising the landmass')
  await nextFrame()
  world.buildGround()
  onProgress(0.72, 'Scattering relics')
  await nextFrame()
  world.buildScenery()
  onProgress(1, 'Ready')
  await nextFrame()
  return world
}
