// Collectible shards, health orbs and the exit portal.
import * as THREE from 'three'
import type { ZoneDef } from '../zones'
import type { WorldRef } from '../world/zone'
import type { EffectsSystem } from '../effects'
import type { AudioEngine } from '../audio'
import { findGroundSpot, type Collider } from '../world/props'
import { clamp } from '../utils'

interface Shard {
  group: THREE.Group
  position: THREE.Vector3
  active: boolean
  bob: number
  velocity: THREE.Vector3
}

interface Orb {
  group: THREE.Group
  position: THREE.Vector3
  active: boolean
  bob: number
}

function makeGlowTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(255,255,255,0.95)')
    grad.addColorStop(0.35, 'rgba(180,240,255,0.5)')
    grad.addColorStop(1, 'rgba(120,220,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class PickupManager {
  readonly group = new THREE.Group()
  private shards: Shard[] = []
  private orbs: Orb[] = []
  private glowTexture: THREE.Texture
  private shardMat: THREE.MeshStandardMaterial
  private orbMat: THREE.MeshStandardMaterial
  private beamMat: THREE.MeshBasicMaterial
  private glowMat: THREE.SpriteMaterial
  private orbGlowMat: THREE.SpriteMaterial
  private orbGlowTexture: THREE.Texture
  private portalGroup: THREE.Group | null = null
  private portalLight: THREE.PointLight | null = null
  private portalActive = false
  private portalTimer = 0
  readonly portalPosition = new THREE.Vector3()

  totalShards = 0
  totalOrbs = 0
  collectedShards = 0
  collectedOrbs = 0

  constructor(
    private world: WorldRef,
    private zone: ZoneDef,
    private rng: () => number,
    private effects: EffectsSystem
  ) {
    this.glowTexture = makeGlowTexture()
    this.orbGlowTexture = makeGlowTexture()

    this.shardMat = new THREE.MeshStandardMaterial({
      color: 0xbdf6ff,
      emissive: new THREE.Color(0x4fd8ff),
      emissiveIntensity: 2.4,
      roughness: 0.15,
      metalness: 0.2,
      flatShading: true,
    })
    this.orbMat = new THREE.MeshStandardMaterial({
      color: 0xb6ffd0,
      emissive: new THREE.Color(0x2ee07a),
      emissiveIntensity: 2.2,
      roughness: 0.2,
      flatShading: true,
    })
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0x66e6ff,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.glowMat = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0x9fe9ff,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.orbGlowMat = new THREE.SpriteMaterial({
      map: this.orbGlowTexture,
      color: 0x8dffb8,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    this.spawnShards()
    this.spawnOrbs()
  }

  private spawnShards(): void {
    const geo = new THREE.OctahedronGeometry(0.44, 0)
    const beamGeo = new THREE.CylinderGeometry(0.11, 0.11, 30, 6, 1, true)
    const placed: { x: number; z: number }[] = []
    for (let i = 0; i < this.zone.shards; i++) {
      let spot: { x: number; y: number; z: number } | null = null
      for (let attempt = 0; attempt < 40 && !spot; attempt++) {
        const candidate = findGroundSpot(this.world.field, this.rng, {
          islandRadius: this.zone.islandRadius,
          maxSlope: 0.4,
          minY: 0.8,
          minRadius: 14,
          maxRadius: this.zone.islandRadius * 0.9,
          avoid: this.world.colliders as Collider[],
          avoidRadius: 1.6,
          clearance: [
            { x: 0, z: 0, r: 10 },
            ...placed.map((p) => ({ x: p.x, z: p.z, r: 11 })),
          ],
          attempts: 60,
        })
        if (candidate) spot = candidate
      }
      if (!spot) continue
      placed.push({ x: spot.x, z: spot.z })

      const group = new THREE.Group()
      group.position.set(spot.x, spot.y + 1.15, spot.z)
      const crystal = new THREE.Mesh(geo, this.shardMat)
      const glow = new THREE.Sprite(this.glowMat)
      glow.scale.setScalar(2.6)
      const beam = new THREE.Mesh(beamGeo, this.beamMat)
      beam.position.y = 13
      group.add(crystal, glow, beam)
      this.group.add(group)
      this.shards.push({
        group,
        position: group.position.clone(),
        active: true,
        bob: this.rng() * Math.PI * 2,
        velocity: new THREE.Vector3(),
      })
    }
    this.totalShards = this.shards.length
  }

  private spawnOrbs(): void {
    const geo = new THREE.SphereGeometry(0.4, 12, 10)
    for (let i = 0; i < this.zone.orbs; i++) {
      const spot = findGroundSpot(this.world.field, this.rng, {
        islandRadius: this.zone.islandRadius,
        maxSlope: 0.4,
        minY: 0.8,
        minRadius: 16,
        maxRadius: this.zone.islandRadius * 0.9,
        avoid: this.world.colliders as Collider[],
        avoidRadius: 1.6,
        clearance: [{ x: 0, z: 0, r: 12 }],
        attempts: 80,
      })
      if (!spot) continue
      const group = new THREE.Group()
      group.position.set(spot.x, spot.y + 1, spot.z)
      const mesh = new THREE.Mesh(geo, this.orbMat)
      const glow = new THREE.Sprite(this.orbGlowMat)
      glow.scale.setScalar(2.4)
      group.add(mesh, glow)
      this.group.add(group)
      this.orbs.push({
        group,
        position: group.position.clone(),
        active: true,
        bob: this.rng() * Math.PI * 2,
      })
    }
    this.totalOrbs = this.orbs.length
  }

  get remainingShards(): number {
    return this.shards.filter((s) => s.active).length
  }

  get remainingOrbs(): number {
    return this.orbs.filter((o) => o.active).length
  }

  get portalOpen(): boolean {
    return this.portalActive
  }

  openPortal(): void {
    if (this.portalActive) return
    this.portalActive = true
    this.portalTimer = 0
    const spot = this.world.portalSpot
    this.portalPosition.set(spot.x, spot.y, spot.z)

    const group = new THREE.Group()
    group.position.set(spot.x, spot.y + 2.6, spot.z)

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xa6f0ff,
      emissive: new THREE.Color(0x3fd0ff),
      emissiveIntensity: 2.6,
      roughness: 0.2,
      metalness: 0.4,
      flatShading: true,
    })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.26, 10, 40), ringMat)
    ring.castShadow = false
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(2.3, 40),
      new THREE.MeshBasicMaterial({
        color: 0x7ce8ff,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    )
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.6, 60, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x8fe9ff,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    )
    beam.position.y = 28
    const light = new THREE.PointLight(0x6fe0ff, 30, 26, 2)
    light.position.set(0, 0.4, 0)
    group.add(ring, disc, beam, light)
    this.portalGroup = group
    this.portalLight = light
    this.group.add(group)
  }

  update(
    dt: number,
    time: number,
    playerPos: THREE.Vector3,
    pickupRadius: number,
    callbacks: { onShard: (remaining: number) => void; onOrb: () => void }
  ): void {
    const magnetRange = pickupRadius + 2.4

    for (const shard of this.shards) {
      if (!shard.active) continue
      shard.bob += dt * 2
      const targetY = shard.position.y + Math.sin(shard.bob) * 0.22
      shard.group.position.y = targetY
      shard.group.rotation.y += dt * 1.6
      shard.group.rotation.x = Math.sin(shard.bob * 0.6) * 0.2

      const dx = playerPos.x - shard.group.position.x
      const dz = playerPos.z - shard.group.position.z
      const dy = playerPos.y + 1 - shard.group.position.y
      const dist = Math.hypot(dx, dy, dz)
      if (dist < magnetRange) {
        const pull = clamp((magnetRange - dist) / magnetRange, 0, 1)
        shard.group.position.x += dx * pull * Math.min(1, dt * 9)
        shard.group.position.y += dy * pull * Math.min(1, dt * 9)
        shard.group.position.z += dz * pull * Math.min(1, dt * 9)
      }
      if (dist < 1.15) {
        shard.active = false
        shard.group.visible = false
        this.collectedShards++
        this.effects.burst(shard.group.position.clone(), {
          count: 30,
          color: [0x8ef6ff, 0xffffff, 0x4fd8ff],
          speed: 7,
          life: 0.7,
          size: 0.85,
          gravity: -3,
          drag: 2.4,
        })
        this.effects.shockwave(shard.group.position.clone(), 3.2, 0x7ce8ff, 0.5, -0.9)
        callbacks.onShard(this.remainingShards)
      }
    }

    for (const orb of this.orbs) {
      if (!orb.active) continue
      orb.bob += dt * 2.4
      orb.group.position.y = orb.position.y + Math.sin(orb.bob) * 0.18
      orb.group.rotation.y += dt * 0.8
      const scale = 1 + Math.sin(orb.bob * 1.6) * 0.08
      orb.group.scale.setScalar(scale)
      const dist = orb.group.position.distanceTo(new THREE.Vector3(playerPos.x, playerPos.y + 1, playerPos.z))
      if (dist < 1.5) {
        orb.active = false
        orb.group.visible = false
        this.collectedOrbs++
        this.effects.burst(orb.group.position.clone(), {
          count: 26,
          color: [0x8dffb8, 0xffffff],
          speed: 6,
          life: 0.75,
          size: 0.85,
          gravity: -2,
          drag: 2.4,
        })
        callbacks.onOrb()
      }
    }

    if (this.portalActive && this.portalGroup) {
      this.portalTimer += dt
      this.portalGroup.rotation.y += dt * 0.55
      const ring = this.portalGroup.children[0] as THREE.Mesh
      const disc = this.portalGroup.children[1] as THREE.Mesh
      const pulse = 1 + Math.sin(time * 2.2) * 0.05
      ring.scale.setScalar(pulse)
      ;(disc.material as THREE.MeshBasicMaterial).opacity = 0.24 + Math.sin(time * 3) * 0.08
      if (this.portalLight) this.portalLight.intensity = 26 + Math.sin(time * 4) * 8
      // Swirl of particles rising into the ring
      for (let i = 0; i < 2; i++) {
        const angle = Math.random() * Math.PI * 2
        const radius = 2.2 + Math.random() * 1.2
        const spawn = new THREE.Vector3(
          this.portalPosition.x + Math.cos(angle) * radius,
          this.portalPosition.y + 0.2 + Math.random() * 1.2,
          this.portalPosition.z + Math.sin(angle) * radius
        )
        this.effects.burst(spawn, {
          count: 1,
          color: [0x8fe9ff, 0xc9b0ff],
          speed: 0.8,
          life: 1.6,
          size: 0.7,
          gravity: 1.6,
          drag: 0.4,
          spreadY: 0.3,
        })
      }
    }
  }

  /** QA helper: instantly sweep every remaining pickup (used by automated checks). */
  debugCollectAll(onShard: (remaining: number) => void): void {
    for (const shard of this.shards) {
      if (!shard.active) continue
      shard.active = false
      shard.group.visible = false
      this.collectedShards++
      onShard(this.remainingShards)
    }
    for (const orb of this.orbs) {
      if (!orb.active) continue
      orb.active = false
      orb.group.visible = false
      this.collectedOrbs++
    }
  }

  /** Radar blips for active pickups and the portal. */
  blips(): { x: number; z: number; kind: 'shard' | 'orb' | 'portal' }[] {
    const out: { x: number; z: number; kind: 'shard' | 'orb' | 'portal' }[] = []
    for (const shard of this.shards) {
      if (shard.active) out.push({ x: shard.group.position.x, z: shard.group.position.z, kind: 'shard' })
    }
    for (const orb of this.orbs) {
      if (orb.active) out.push({ x: orb.group.position.x, z: orb.group.position.z, kind: 'orb' })
    }
    if (this.portalActive) {
      out.push({ x: this.portalPosition.x, z: this.portalPosition.z, kind: 'portal' })
    }
    return out
  }

  /** Distance from the player to the open portal, or Infinity when closed. */
  portalDistance(playerPos: THREE.Vector3): number {
    if (!this.portalActive) return Infinity
    return Math.hypot(
      playerPos.x - this.portalPosition.x,
      playerPos.z - this.portalPosition.z
    )
  }

  dispose(): void {
    this.glowTexture.dispose()
    this.orbGlowTexture.dispose()
    this.shardMat.dispose()
    this.orbMat.dispose()
    this.beamMat.dispose()
    this.glowMat.dispose()
    this.orbGlowMat.dispose()
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const mat = obj.material as THREE.Material | THREE.Material[]
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat.dispose()
      }
    })
    this.shards = []
    this.orbs = []
    this.portalGroup = null
  }
}
