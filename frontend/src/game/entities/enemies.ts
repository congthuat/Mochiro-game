// Enemies: shadow wisps, sentries, brutes and the Shadow Colossus boss.
import * as THREE from 'three'
import { SCORE } from '../config'
import type { ZoneDef } from '../zones'
import type { WorldRef } from '../world/zone'
import type { EffectsSystem } from '../effects'
import type { AudioEngine } from '../audio'
import type { ProjectileManager } from './projectiles'
import { findGroundSpot, type Collider } from '../world/props'
import { clamp, damp } from '../utils'

export type EnemyKind = 'wisp' | 'sentry' | 'brute' | 'boss'

export interface EnemyContext {
  playerPos: THREE.Vector3
  playerAlive: boolean
  playerRadius: number
  world: WorldRef
  effects: EffectsSystem
  audio: AudioEngine
  projectiles: ProjectileManager
  damagePlayer: (amount: number, from: THREE.Vector3) => void
  spawnMinion: (kind: EnemyKind, position: THREE.Vector3) => void
}

interface KindSpec {
  hp: number
  speed: number
  radius: number
  hover: number
  contact: number
  score: number
  flying: boolean
}

const SPECS: Record<EnemyKind, KindSpec> = {
  wisp: { hp: 34, speed: 5.4, radius: 0.75, hover: 1.35, contact: 12, score: SCORE.wisp, flying: true },
  sentry: { hp: 46, speed: 4.4, radius: 0.8, hover: 2.6, contact: 8, score: SCORE.sentry, flying: true },
  brute: { hp: 105, speed: 3.6, radius: 1.15, hover: 0.1, contact: 22, score: SCORE.brute, flying: false },
  boss: { hp: 680, speed: 3.0, radius: 2.6, hover: 3.2, contact: 26, score: SCORE.boss, flying: true },
}

let enemyIdCounter = 1

export class Enemy {
  readonly id = enemyIdCounter++
  readonly group = new THREE.Group()
  readonly position = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()
  kind: EnemyKind
  hp: number
  maxHp: number
  radius: number
  speed: number
  contactDamage: number
  scoreValue: number
  flying: boolean
  hover: number
  alive = true
  dying = false
  deathTimer = 0
  phase = 1

  /** Vertical offset of the body centre relative to the entity origin. */
  private anchor = 0
  private flash = 0
  private bob = Math.random() * Math.PI * 2
  private attackCooldown = 2.4
  private state: 'idle' | 'windup' | 'charge' | 'recover' = 'idle'
  private stateTimer = 0
  private chargeDir = new THREE.Vector3()
  private core: THREE.Mesh | null = null
  private aura: THREE.Mesh | null = null
  private orbiters: THREE.Mesh[] = []
  private flashMats: { mat: THREE.MeshStandardMaterial; base: number }[] = []
  private baseScale = 1
  private strafeDir = Math.random() < 0.5 ? -1 : 1

  constructor(kind: EnemyKind, position: THREE.Vector3, hpScale: number, speedScale: number) {
    this.kind = kind
    const spec = SPECS[kind]
    this.hp = Math.round(spec.hp * hpScale)
    this.maxHp = this.hp
    this.radius = spec.radius
    this.speed = spec.speed * speedScale
    this.contactDamage = spec.contact
    this.scoreValue = spec.score
    this.flying = spec.flying
    this.hover = spec.hover
    this.position.copy(position)
    this.group.position.copy(position)
    this.buildVisual()
  }

  private addFlashMat(mat: THREE.MeshStandardMaterial, base = 0): void {
    this.flashMats.push({ mat, base })
  }

  private buildVisual(): void {
    const scale = this.kind === 'boss' ? 1 : 1
    this.baseScale = scale

    if (this.kind === 'wisp') {
      const shell = new THREE.MeshStandardMaterial({
        color: 0x1b1030,
        emissive: new THREE.Color(0x4b1e9c),
        emissiveIntensity: 0.75,
        roughness: 0.6,
        flatShading: true,
      })
      const inner = new THREE.MeshStandardMaterial({
        color: 0xc79cff,
        emissive: new THREE.Color(0x9a5cff),
        emissiveIntensity: 2.6,
        roughness: 0.3,
      })
      const shellMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.44, 1), shell)
      const innerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), inner)
      this.core = shellMesh
      const aura = new THREE.Mesh(
        new THREE.SphereGeometry(0.72, 12, 10),
        new THREE.MeshBasicMaterial({
          color: 0x9a5cff,
          transparent: true,
          opacity: 0.18,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
      this.aura = aura
      this.group.add(shellMesh, innerMesh, aura)
      this.addFlashMat(shell, 0.75)
      this.addFlashMat(inner, 2.6)
    } else if (this.kind === 'sentry') {
      const metal = new THREE.MeshStandardMaterial({
        color: 0x8d97ad,
        emissive: new THREE.Color(0x000000),
        roughness: 0.35,
        metalness: 0.75,
        flatShading: true,
      })
      const eyeMat = new THREE.MeshStandardMaterial({
        color: 0xffb066,
        emissive: new THREE.Color(0xff6a2c),
        emissiveIntensity: 2.8,
        roughness: 0.2,
      })
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), metal)
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), eyeMat)
      eye.position.z = 0.42
      const ringGeo = new THREE.TorusGeometry(0.78, 0.06, 6, 22)
      const ring1 = new THREE.Mesh(ringGeo, metal)
      ring1.rotation.x = Math.PI / 2
      const ring2 = new THREE.Mesh(ringGeo, metal)
      ring2.rotation.set(Math.PI / 2, 0, Math.PI / 3)
      ring2.scale.setScalar(1.18)
      this.orbiters.push(ring1, ring2)
      this.core = core
      this.group.add(core, eye, ring1, ring2)
      this.addFlashMat(metal, 0)
      this.addFlashMat(eyeMat, 2.8)
    } else if (this.kind === 'brute') {
      this.anchor = 0.85
      const rock = new THREE.MeshStandardMaterial({
        color: 0x2f2a3d,
        emissive: new THREE.Color(0x000000),
        roughness: 0.9,
        flatShading: true,
      })
      const crack = new THREE.MeshStandardMaterial({
        color: 0xff8a4c,
        emissive: new THREE.Color(0xff5a1e),
        emissiveIntensity: 2.2,
        roughness: 0.4,
      })
      const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 0), rock)
      body.scale.set(1.15, 0.95, 1.15)
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), crack)
      eye.position.set(0, 0.18, 0.86)
      const spikeGeo = new THREE.ConeGeometry(0.18, 0.6, 5)
      const rig = new THREE.Group()
      rig.position.y = this.anchor
      for (let i = 0; i < 4; i++) {
        const spike = new THREE.Mesh(spikeGeo, rock)
        const angle = (i / 4) * Math.PI * 2
        spike.position.set(Math.cos(angle) * 0.8, 0.5, Math.sin(angle) * 0.8)
        spike.rotation.set(-0.4, 0, 0)
        rig.add(spike)
      }
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.09, 6, 18), crack)
      band.rotation.x = Math.PI / 2
      band.position.y = 0.1
      this.core = body
      rig.add(body, eye, band)
      this.group.add(rig)
      this.addFlashMat(rock, 0)
      this.addFlashMat(crack, 2.2)
    } else {
      const shell = new THREE.MeshStandardMaterial({
        color: 0x140b26,
        emissive: new THREE.Color(0x4a1f8f),
        emissiveIntensity: 0.9,
        roughness: 0.65,
        flatShading: true,
      })
      const inner = new THREE.MeshStandardMaterial({
        color: 0xd0b0ff,
        emissive: new THREE.Color(0xa15cff),
        emissiveIntensity: 2.4,
        roughness: 0.25,
      })
      const shellMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 1), shell)
      const innerMesh = new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 12), inner)
      this.core = shellMesh
      const aura = new THREE.Mesh(
        new THREE.SphereGeometry(3.1, 16, 12),
        new THREE.MeshBasicMaterial({
          color: 0x9a5cff,
          transparent: true,
          opacity: 0.16,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
      this.aura = aura
      this.group.add(shellMesh, innerMesh, aura)
      const shardMat = new THREE.MeshStandardMaterial({
        color: 0x8f7dff,
        emissive: new THREE.Color(0x6a3cff),
        emissiveIntensity: 1.8,
        roughness: 0.3,
        flatShading: true,
      })
      for (let i = 0; i < 6; i++) {
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), shardMat)
        this.orbiters.push(shard)
        this.group.add(shard)
      }
      this.addFlashMat(shell, 0.9)
      this.addFlashMat(inner, 2.4)
    }

    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && this.kind !== 'boss') obj.castShadow = true
    })
  }

  takeDamage(amount: number, from?: THREE.Vector3): boolean {
    if (!this.alive || this.dying) return false
    this.hp -= amount
    this.flash = 0.22
    if (from && this.kind !== 'boss') {
      const push = this.kind === 'brute' ? 0.6 : 2.2
      const dir = new THREE.Vector3(this.position.x - from.x, 0, this.position.z - from.z)
      if (dir.lengthSq() > 0.0001) {
        dir.normalize().multiplyScalar(push)
        this.velocity.add(dir)
      }
    }
    if (this.hp <= 0) {
      this.hp = 0
      this.dying = true
      this.deathTimer = 0
      return true
    }
    return false
  }

  private updateFacing(target: THREE.Vector3, dt: number): void {
    const desired = Math.atan2(target.x - this.position.x, target.z - this.position.z)
    let diff = ((desired - this.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI
    if (diff < -Math.PI) diff += Math.PI * 2
    this.group.rotation.y += diff * Math.min(1, dt * 4)
  }

  update(dt: number, time: number, ctx: EnemyContext): void {
    if (this.dying) {
      this.deathTimer += dt
      const t = clamp(this.deathTimer / 0.4, 0, 1)
      this.group.scale.setScalar(Math.max(0.001, this.baseScale * (1 - t)))
      this.group.rotation.y += dt * 9
      if (this.deathTimer >= 0.4) {
        this.alive = false
        this.group.visible = false
      }
      return
    }
    if (!this.alive) return

    this.flash = Math.max(0, this.flash - dt)
    this.bob += dt * (this.kind === 'boss' ? 0.8 : 2.2)
    const toPlayer = new THREE.Vector3().subVectors(ctx.playerPos, this.position)
    const distance = Math.hypot(toPlayer.x, toPlayer.z)
    const dirX = distance > 0.001 ? toPlayer.x / distance : 0
    const dirZ = distance > 0.001 ? toPlayer.z / distance : 0

    let targetVX = 0
    let targetVZ = 0

    if (ctx.playerAlive) {
      switch (this.kind) {
        case 'wisp': {
          targetVX = dirX * this.speed
          targetVZ = dirZ * this.speed
          break
        }
        case 'sentry': {
          const ideal = 11
          const approach = distance > ideal + 2 ? 1 : distance < ideal - 2 ? -1 : 0
          targetVX = dirX * this.speed * approach + -dirZ * this.speed * 0.55 * this.strafeDir
          targetVZ = dirZ * this.speed * approach + dirX * this.speed * 0.55 * this.strafeDir
          this.attackCooldown -= dt
          if (this.attackCooldown <= 0 && distance < 26) {
            this.attackCooldown = 2.5 + Math.random() * 0.9
            const aim = new THREE.Vector3(
              ctx.playerPos.x - this.position.x,
              ctx.playerPos.y + 1 - this.position.y,
              ctx.playerPos.z - this.position.z
            ).normalize()
            ctx.projectiles.spawn(this.position.clone().addScaledVector(aim, 0.7), aim, {
              speed: 14,
              damage: 10,
              life: 3.4,
              homing: 0.9,
            })
            ctx.audio.play('attack')
          }
          break
        }
        case 'brute': {
          this.stateTimer -= dt
          if (this.state === 'idle') {
            targetVX = dirX * this.speed
            targetVZ = dirZ * this.speed
            if (distance < 15 && this.stateTimer <= 0) {
              this.state = 'windup'
              this.stateTimer = 0.75
              ctx.audio.play('telegraph')
            }
          } else if (this.state === 'windup') {
            this.chargeDir.set(dirX, 0, dirZ)
            if (this.stateTimer <= 0) {
              this.state = 'charge'
              this.stateTimer = 1.1
              ctx.audio.play('dash')
            }
          } else if (this.state === 'charge') {
            targetVX = this.chargeDir.x * this.speed * 3.1
            targetVZ = this.chargeDir.z * this.speed * 3.1
            if (this.stateTimer <= 0) {
              this.state = 'recover'
              this.stateTimer = 1.4
            }
          } else {
            if (this.stateTimer <= 0) {
              this.state = 'idle'
              this.stateTimer = 2.2 + Math.random() * 1.6
            }
          }
          break
        }
        case 'boss': {
          const ideal = 13
          const approach = distance > ideal ? 1 : distance < ideal - 4 ? -0.8 : 0
          targetVX = dirX * this.speed * approach
          targetVZ = dirZ * this.speed * approach
          this.attackCooldown -= dt
          if (this.attackCooldown <= 0) {
            this.attackCooldown = this.phase === 3 ? 1.7 : this.phase === 2 ? 2.2 : 2.8
            const roll = Math.random()
            if (roll < 0.4) {
              // Ground slam telegraphs
              const rings = this.phase === 3 ? 4 : this.phase === 2 ? 3 : 2
              for (let i = 0; i < rings; i++) {
                const offset = i * 0.32
                const target = new THREE.Vector3(
                  ctx.playerPos.x + (Math.random() - 0.5) * (i === 0 ? 0 : 5),
                  ctx.world.heightAt(ctx.playerPos.x, ctx.playerPos.z),
                  ctx.playerPos.z + (Math.random() - 0.5) * (i === 0 ? 0 : 5)
                )
                setTimeout(() => {
                  if (!this.alive || !ctx.playerAlive) return
                  ctx.effects.telegraph(target, 4.6, 1.05, 0xff4d6d, () => {
                    ctx.audio.play('explode')
                    const d = Math.hypot(ctx.playerPos.x - target.x, ctx.playerPos.z - target.z)
                    if (d < 5.4) ctx.damagePlayer(24, target)
                  })
                }, offset * 1000)
              }
              ctx.audio.play('telegraph')
            } else if (roll < 0.72) {
              // Summon minions
              const count = this.phase === 3 ? 4 : 3
              for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2 + Math.random()
                const spawn = new THREE.Vector3(
                  this.position.x + Math.cos(angle) * 6,
                  this.position.y,
                  this.position.z + Math.sin(angle) * 6
                )
                spawn.y = ctx.world.heightAt(spawn.x, spawn.z) + 1.2
                ctx.spawnMinion('wisp', spawn)
              }
              ctx.audio.play('roar')
            } else {
              // Radial spread shot
              const shots = this.phase === 3 ? 14 : this.phase === 2 ? 11 : 9
              const base = Math.random() * Math.PI * 2
              for (let i = 0; i < shots; i++) {
                const angle = base + (i / shots) * Math.PI * 2
                const dir = new THREE.Vector3(Math.cos(angle), -0.06, Math.sin(angle))
                ctx.projectiles.spawn(this.position.clone().setY(this.position.y - 0.4), dir, {
                  speed: 12,
                  damage: 12,
                  life: 4,
                  homing: 0.35,
                })
              }
              ctx.audio.play('attack')
            }
          }
          break
        }
        default:
          break
      }
    }

    if (this.flying) {
      const targetY = ctx.world.heightAt(this.position.x, this.position.z) + this.hover + Math.sin(this.bob) * 0.22
      this.velocity.y = damp(this.velocity.y, (targetY - this.position.y) * 3.2, 4, dt)
    } else {
      this.velocity.y -= 26 * dt
    }

    this.velocity.x = damp(this.velocity.x, targetVX, this.state === 'charge' ? 2.4 : 4.2, dt)
    this.velocity.z = damp(this.velocity.z, targetVZ, this.state === 'charge' ? 2.4 : 4.2, dt)
    this.position.x += this.velocity.x * dt
    this.position.z += this.velocity.z * dt
    this.position.y += this.velocity.y * dt

    if (!this.flying) {
      const groundY = ctx.world.heightAt(this.position.x, this.position.z)
      if (this.position.y < groundY) {
        this.position.y = groundY
        this.velocity.y = 0
      }
    }

    ctx.world.resolveCollision(this.position, this.radius * 0.8)

    // Contact damage
    if (ctx.playerAlive) {
      const dx = this.position.x - ctx.playerPos.x
      const dy = this.position.y + this.anchor - (ctx.playerPos.y + 0.9)
      const dz = this.position.z - ctx.playerPos.z
      const reach = this.radius + ctx.playerRadius + 0.35
      if (dx * dx + dy * dy + dz * dz < reach * reach) {
        ctx.damagePlayer(this.contactDamage, this.position)
        this.velocity.x -= dirX * 3.4
        this.velocity.z -= dirZ * 3.4
      }
    }

    this.updateFacing(ctx.playerPos, dt)

    // Presentation
    this.group.position.copy(this.position)
    const flash = this.flash / 0.22
    for (const { mat, base } of this.flashMats) {
      mat.emissiveIntensity = base + flash * 3.4
    }
    if (this.aura) {
      const pulse = 1 + Math.sin(time * 3 + this.bob) * 0.06
      this.aura.scale.setScalar(pulse)
      ;(this.aura.material as THREE.MeshBasicMaterial).opacity = 0.14 + flash * 0.3
    }
    if (this.core) {
      const punch = 1 + flash * 0.16
      this.core.scale.setScalar(punch)
    }
    if (this.orbiters.length > 0) {
      const spin = time * (this.kind === 'boss' ? 0.9 : 2.6)
      this.orbiters.forEach((obj, i) => {
        if (this.kind === 'sentry') {
          obj.rotation.z += dt * (i === 0 ? 1.4 : -1.1)
          obj.rotation.y += dt * 0.6
        } else {
          const angle = spin + (i / this.orbiters.length) * Math.PI * 2
          obj.position.set(Math.cos(angle) * 3.1, Math.sin(spin * 1.7 + i) * 0.7, Math.sin(angle) * 3.1)
          obj.rotation.y += dt * 2
          obj.rotation.x += dt * 1.2
        }
      })
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const mat = obj.material as THREE.Material | THREE.Material[]
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat.dispose()
      }
    })
  }
}

export class EnemyManager {
  readonly group = new THREE.Group()
  enemies: Enemy[] = []
  spawnedTotal = 0
  killedTotal = 0
  boss: Enemy | null = null
  private zone: ZoneDef

  constructor(zone: ZoneDef) {
    this.zone = zone
  }

  get aliveCount(): number {
    return this.enemies.filter((e) => e.alive && !e.dying).length
  }

  get remaining(): number {
    return this.enemies.filter((e) => e.alive).length
  }

  spawnZone(world: WorldRef, rng: () => number, playerPos: THREE.Vector3): void {
    const zone = this.zone
    const spawnOne = (kind: EnemyKind): void => {
      const spot = findGroundSpot(world.field, rng, {
        islandRadius: zone.islandRadius,
        maxSlope: kind === 'brute' ? 0.28 : 0.42,
        minY: 1.2,
        minRadius: 18,
        maxRadius: zone.islandRadius * 0.92,
        avoid: world.colliders as Collider[],
        avoidRadius: 2.4,
        clearance: [{ x: playerPos.x, z: playerPos.z, r: 22 }],
        attempts: 120,
      })
      if (!spot) return
      const height = kind === 'sentry' ? spot.y + 2.6 : spot.y + 1.2
      this.add(new Enemy(kind, new THREE.Vector3(spot.x, height, spot.z), zone.hpScale, zone.speedScale))
    }

    for (let i = 0; i < zone.enemies.wisp; i++) spawnOne('wisp')
    for (let i = 0; i < zone.enemies.sentry; i++) spawnOne('sentry')
    for (let i = 0; i < zone.enemies.brute; i++) spawnOne('brute')

    if (zone.boss) {
      const spot = world.portalSpot
      const boss = new Enemy('boss', new THREE.Vector3(spot.x, spot.y + 4, spot.z), zone.hpScale, zone.speedScale)
      this.boss = boss
      this.add(boss)
    }
  }

  add(enemy: Enemy): void {
    this.enemies.push(enemy)
    this.group.add(enemy.group)
    this.spawnedTotal++
  }

  spawnMinion(kind: EnemyKind, position: THREE.Vector3): void {
    if (this.enemies.filter((e) => e.alive && e.kind !== 'boss').length > 10) return
    const enemy = new Enemy(kind, position, this.zone.hpScale * 0.85, this.zone.speedScale)
    this.add(enemy)
  }

  update(dt: number, time: number, ctx: EnemyContext): void {
    for (const enemy of this.enemies) {
      enemy.update(dt, time, ctx)
    }

    // Soft separation so packs do not stack into a single blob.
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i]
      if (!a.alive || a.dying || a.kind === 'boss') continue
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j]
        if (!b.alive || b.dying || b.kind === 'boss') continue
        const dx = b.position.x - a.position.x
        const dz = b.position.z - a.position.z
        const minDist = a.radius + b.radius
        const distSq = dx * dx + dz * dz
        if (distSq >= minDist * minDist || distSq < 1e-5) continue
        const dist = Math.sqrt(distSq)
        const push = ((minDist - dist) / dist) * 0.5
        a.position.x -= dx * push
        a.position.z -= dz * push
        b.position.x += dx * push
        b.position.z += dz * push
      }
    }

    // Retire dead enemies.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i]
      if (enemy.alive) continue
      if (enemy === this.boss) this.boss = null
      this.group.remove(enemy.group)
      enemy.dispose()
      this.enemies.splice(i, 1)
    }
  }

  /** Damage every enemy inside a forward arc. Returns the number of kills. */
  damageInArc(origin: THREE.Vector3, facingDir: THREE.Vector3, radius: number, halfArcCos: number, damage: number): { hits: number; kills: Enemy[] } {
    let hits = 0
    const kills: Enemy[] = []
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.dying) continue
      const dx = enemy.position.x - origin.x
      const dz = enemy.position.z - origin.z
      const dist = Math.hypot(dx, dz)
      if (dist > radius + enemy.radius) continue
      if (dist > 0.001) {
        const dot = (dx / dist) * facingDir.x + (dz / dist) * facingDir.z
        if (dot < halfArcCos && dist > 1.6) continue
      }
      hits++
      const killed = enemy.takeDamage(damage, origin)
      if (killed) kills.push(enemy)
    }
    return { hits, kills }
  }

  damageInRadius(origin: THREE.Vector3, radius: number, damage: number): { hits: number; kills: Enemy[] } {
    let hits = 0
    const kills: Enemy[] = []
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.dying) continue
      const dx = enemy.position.x - origin.x
      const dz = enemy.position.z - origin.z
      const dy = enemy.position.y - origin.y
      if (Math.hypot(dx, dz) > radius + enemy.radius) continue
      if (Math.abs(dy) > 6) continue
      hits++
      if (enemy.takeDamage(damage, origin)) kills.push(enemy)
    }
    return { hits, kills }
  }

  clear(): void {
    for (const enemy of this.enemies) {
      // Mark dead first so pending boss timers become no-ops.
      enemy.alive = false
      enemy.dying = false
      this.group.remove(enemy.group)
      enemy.dispose()
    }
    this.enemies = []
    this.boss = null
    this.spawnedTotal = 0
    this.killedTotal = 0
  }

  dispose(): void {
    this.clear()
  }
}
