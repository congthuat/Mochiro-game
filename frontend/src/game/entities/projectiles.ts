// Pooled enemy projectiles.
import * as THREE from 'three'
import type { WorldRef } from '../world/zone'

export interface ProjectileSpawnOptions {
  speed?: number
  life?: number
  damage?: number
  color?: number
  homing?: number
  radius?: number
}

export interface ProjectileContext {
  world: WorldRef
  playerPos: THREE.Vector3
  playerRadius: number
  playerAlive: boolean
  onPlayerHit: (damage: number, from: THREE.Vector3) => void
}

interface Projectile {
  mesh: THREE.Mesh
  glow: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  damage: number
  homing: number
  radius: number
  active: boolean
  spin: number
}

export class ProjectileManager {
  readonly group = new THREE.Group()
  private pool: Projectile[] = []
  private geo: THREE.SphereGeometry
  private glowGeo: THREE.SphereGeometry
  private material: THREE.MeshStandardMaterial
  private glowMaterial: THREE.MeshBasicMaterial

  constructor(count = 44) {
    this.geo = new THREE.SphereGeometry(0.22, 10, 8)
    this.glowGeo = new THREE.SphereGeometry(0.46, 10, 8)
    this.material = new THREE.MeshStandardMaterial({
      color: 0xff8a6b,
      emissive: new THREE.Color(0xff5a3c),
      emissiveIntensity: 2.4,
      roughness: 0.3,
    })
    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff7a55,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.geo, this.material)
      const glow = new THREE.Mesh(this.glowGeo, this.glowMaterial)
      const wrapper = mesh
      wrapper.visible = false
      mesh.add(glow)
      this.group.add(mesh)
      this.pool.push({
        mesh,
        glow,
        velocity: new THREE.Vector3(),
        life: 0,
        damage: 0,
        homing: 0,
        radius: 0.5,
        active: false,
        spin: 0,
      })
    }
  }

  spawn(position: THREE.Vector3, direction: THREE.Vector3, opts: ProjectileSpawnOptions = {}): void {
    const p = this.pool.find((item) => !item.active)
    if (!p) return
    const speed = opts.speed ?? 15
    p.active = true
    p.life = opts.life ?? 3.2
    p.damage = opts.damage ?? 10
    p.homing = opts.homing ?? 0
    p.radius = opts.radius ?? 0.55
    p.velocity.copy(direction).normalize().multiplyScalar(speed)
    p.mesh.position.copy(position)
    p.mesh.visible = true
    p.mesh.scale.setScalar(1)
    p.spin = Math.random() * Math.PI
  }

  update(dt: number, ctx: ProjectileContext): void {
    for (const p of this.pool) {
      if (!p.active) continue
      p.life -= dt
      if (p.homing > 0 && ctx.playerAlive) {
        const desired = new THREE.Vector3()
          .subVectors(ctx.playerPos, p.mesh.position)
          .setY(ctx.playerPos.y + 1 - p.mesh.position.y)
          .normalize()
          .multiplyScalar(p.velocity.length())
        p.velocity.lerp(desired, Math.min(1, p.homing * dt))
      }
      p.mesh.position.addScaledVector(p.velocity, dt)
      p.spin += dt * 6
      p.mesh.rotation.set(p.spin, p.spin * 0.7, 0)
      const pulse = 1 + Math.sin(p.spin * 2) * 0.08
      p.glow.scale.setScalar(pulse)

      const groundY = ctx.world.heightAt(p.mesh.position.x, p.mesh.position.z)
      if (p.mesh.position.y < groundY + 0.05) {
        p.active = false
        p.mesh.visible = false
        continue
      }
      if (p.life <= 0) {
        p.active = false
        p.mesh.visible = false
        continue
      }
      if (ctx.playerAlive) {
        const dx = p.mesh.position.x - ctx.playerPos.x
        const dy = p.mesh.position.y - (ctx.playerPos.y + 0.9)
        const dz = p.mesh.position.z - ctx.playerPos.z
        if (dx * dx + dy * dy + dz * dz < (p.radius + ctx.playerRadius) * (p.radius + ctx.playerRadius)) {
          ctx.onPlayerHit(p.damage, p.mesh.position.clone())
          p.active = false
          p.mesh.visible = false
        }
      }
    }
  }

  clear(): void {
    for (const p of this.pool) {
      p.active = false
      p.mesh.visible = false
    }
  }

  dispose(): void {
    this.geo.dispose()
    this.glowGeo.dispose()
    this.material.dispose()
    this.glowMaterial.dispose()
    this.pool = []
  }
}
