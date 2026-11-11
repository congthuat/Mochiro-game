// The Aether Guardian: procedurally modelled hero with hand-animated joints.
import * as THREE from 'three'
import { BASE_STATS, PHYSICS, type PlayerStats } from '../config'
import type { WorldRef } from '../world/zone'
import type { EffectsSystem } from '../effects'
import type { AudioEngine } from '../audio'
import { clamp, damp } from '../utils'

export interface PlayerIntent {
  moveX: number
  moveZ: number
  sprint: boolean
  jump: boolean
  attack: boolean
  dash: boolean
  cameraYaw: number
}

export class Player {
  readonly group = new THREE.Group()
  readonly position = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()
  readonly radius = 0.5
  stats: PlayerStats
  hp: number
  energy: number
  facing = 0
  onGround = true
  invuln = 0
  attackCooldown = 0
  dashCooldown = 0
  dead = false
  deathTimer = 0
  sprinting = false

  private effects: EffectsSystem
  private audio: AudioEngine
  private rng: () => number

  private body = new THREE.Group()
  private head = new THREE.Group()
  private armL = new THREE.Group()
  private armR = new THREE.Group()
  private foreL = new THREE.Group()
  private foreR = new THREE.Group()
  private legL = new THREE.Group()
  private legR = new THREE.Group()
  private shinL = new THREE.Group()
  private shinR = new THREE.Group()
  private core!: THREE.Mesh
  private companion!: THREE.Mesh
  private companionLight!: THREE.PointLight
  private cape!: THREE.Mesh
  private capeGeo!: THREE.PlaneGeometry
  private capeBase!: Float32Array
  private armorMats: THREE.MeshStandardMaterial[] = []
  private accentMats: THREE.MeshStandardMaterial[] = []

  private walkPhase = 0
  private airTime = 0
  private coyote = 0
  private jumpBuffer = 0
  private airJumpsLeft = 0
  private attackAnim = 0
  private dashTimer = 0
  private dashDir = new THREE.Vector3()
  private hitFlash = 0
  private landSquash = 0
  private stepTimer = 0
  private lastY = 0
  private spawnPoint = new THREE.Vector3()

  constructor(effects: EffectsSystem, audio: AudioEngine, rng: () => number, stats: PlayerStats = BASE_STATS) {
    this.effects = effects
    this.audio = audio
    this.rng = rng
    this.stats = { ...stats }
    this.hp = this.stats.maxHp
    this.energy = this.stats.maxEnergy
    this.airJumpsLeft = this.stats.airJumps

    this.buildModel()
    this.group.add(this.body)
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true
        obj.receiveShadow = false
      }
    })
  }

  private buildModel(): void {
    const armor = new THREE.MeshStandardMaterial({
      color: 0x2b3557,
      roughness: 0.48,
      metalness: 0.42,
      flatShading: true,
    })
    const trim = new THREE.MeshStandardMaterial({
      color: 0xdfe8f7,
      roughness: 0.35,
      metalness: 0.55,
      flatShading: true,
    })
    const accent = new THREE.MeshStandardMaterial({
      color: 0x66f0ff,
      emissive: new THREE.Color(0x35d8ff),
      emissiveIntensity: 1.6,
      roughness: 0.3,
      metalness: 0.1,
    })
    const dark = new THREE.MeshStandardMaterial({
      color: 0x1a2038,
      roughness: 0.7,
      metalness: 0.3,
      flatShading: true,
    })
    this.armorMats.push(armor, trim, dark)
    this.accentMats.push(accent)

    // Torso
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.62, 8), armor)
    torso.position.y = 1.16
    this.body.add(torso)

    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.28, 0.36), trim)
    chestPlate.position.set(0, 1.34, 0.1)
    this.body.add(chestPlate)

    // Glowing core
    this.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), accent)
    this.core.position.set(0, 1.3, 0.24)
    this.body.add(this.core)

    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 6, 14), dark)
    belt.position.y = 0.92
    belt.rotation.x = Math.PI / 2
    this.body.add(belt)

    // Head
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 1), armor)
    skull.position.y = 0.1
    this.head.add(skull)

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.14), accent)
    visor.position.set(0, 0.1, 0.16)
    this.head.add(visor)

    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 5), trim)
    crest.position.set(0, 0.3, -0.02)
    crest.rotation.x = -0.25
    this.head.add(crest)

    this.head.position.y = 1.62
    this.body.add(this.head)

    // Shoulders + arms
    const shoulderGeo = new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6)
    const shoulderL = new THREE.Mesh(shoulderGeo, trim)
    shoulderL.position.set(-0.36, 1.42, 0)
    this.body.add(shoulderL)
    const shoulderR = new THREE.Mesh(shoulderGeo, trim)
    shoulderR.position.set(0.36, 1.42, 0)
    this.body.add(shoulderR)

    const upperGeo = new THREE.CylinderGeometry(0.085, 0.075, 0.4, 6)
    upperGeo.translate(0, -0.2, 0)
    const foreGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.36, 6)
    foreGeo.translate(0, -0.18, 0)
    const handGeo = new THREE.IcosahedronGeometry(0.085, 0)
    handGeo.translate(0, -0.38, 0)

    for (const [pivot, fore, side] of [
      [this.armL, this.foreL, -1],
      [this.armR, this.foreR, 1],
    ] as [THREE.Group, THREE.Group, number][]) {
      pivot.position.set(side * 0.38, 1.4, 0)
      const upper = new THREE.Mesh(upperGeo, armor)
      pivot.add(upper)
      fore.position.set(0, -0.4, 0)
      const forearm = new THREE.Mesh(foreGeo, armor)
      const hand = new THREE.Mesh(handGeo, accent)
      fore.add(forearm)
      fore.add(hand)
      pivot.add(fore)
      this.body.add(pivot)
    }

    // Legs
    const thighGeo = new THREE.CylinderGeometry(0.11, 0.095, 0.46, 6)
    thighGeo.translate(0, -0.23, 0)
    const shinGeo = new THREE.CylinderGeometry(0.09, 0.075, 0.44, 6)
    shinGeo.translate(0, -0.22, 0)
    const footGeo = new THREE.BoxGeometry(0.16, 0.09, 0.28)
    footGeo.translate(0, -0.46, 0.04)

    for (const [pivot, shin, side] of [
      [this.legL, this.shinL, -1],
      [this.legR, this.shinR, 1],
    ] as [THREE.Group, THREE.Group, number][]) {
      pivot.position.set(side * 0.17, 0.92, 0)
      const thigh = new THREE.Mesh(thighGeo, armor)
      pivot.add(thigh)
      shin.position.set(0, -0.46, 0)
      const shinMesh = new THREE.Mesh(shinGeo, dark)
      const foot = new THREE.Mesh(footGeo, trim)
      shin.add(shinMesh)
      shin.add(foot)
      pivot.add(shin)
      this.body.add(pivot)
    }

    // Cape
    this.capeGeo = new THREE.PlaneGeometry(0.95, 1.25, 4, 6)
    const capeMat = new THREE.MeshStandardMaterial({
      color: 0x4a6bff,
      emissive: new THREE.Color(0x2136a8),
      emissiveIntensity: 0.35,
      roughness: 0.75,
      side: THREE.DoubleSide,
      flatShading: true,
    })
    this.cape = new THREE.Mesh(this.capeGeo, capeMat)
    this.cape.position.set(0, 1.46, -0.2)
    this.cape.rotation.x = 0.12
    this.capeBase = Float32Array.from((this.capeGeo.getAttribute('position') as THREE.BufferAttribute).array)
    this.body.add(this.cape)

    // Floating companion crystal
    this.companion = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshStandardMaterial({
        color: 0xa8f4ff,
        emissive: new THREE.Color(0x4fd8ff),
        emissiveIntensity: 2.2,
        roughness: 0.2,
      })
    )
    this.companion.position.set(0.62, 1.5, 0.28)
    this.body.add(this.companion)

    this.companionLight = new THREE.PointLight(0x59e6ff, 6, 9, 2)
    this.companionLight.position.copy(this.companion.position)
    this.body.add(this.companionLight)
  }

  get maxHp(): number {
    return this.stats.maxHp
  }

  get maxEnergy(): number {
    return this.stats.maxEnergy
  }

  spawnAt(point: THREE.Vector3, world: WorldRef): void {
    this.position.copy(point)
    this.position.y = world.heightAt(point.x, point.z) + 0.05
    this.spawnPoint.copy(this.position)
    this.velocity.set(0, 0, 0)
    this.group.position.copy(this.position)
    this.dead = false
    this.deathTimer = 0
    this.hp = this.stats.maxHp
    this.energy = this.stats.maxEnergy
    this.body.rotation.set(0, 0, 0)
  }

  applyUpgrades(stats: PlayerStats): void {
    const hpRatio = this.hp / Math.max(1, this.stats.maxHp)
    this.stats = stats
    this.hp = Math.max(1, Math.round(stats.maxHp * hpRatio))
  }

  canAttack(): boolean {
    return !this.dead && this.attackCooldown <= 0 && this.energy >= PHYSICS.attackEnergy
  }

  beginAttack(): void {
    this.attackCooldown = this.stats.attackCooldown
    this.energy = Math.max(0, this.energy - PHYSICS.attackEnergy)
    this.attackAnim = 0.26
    this.audio.play('attack')
  }

  canDash(): boolean {
    return !this.dead && this.dashCooldown <= 0 && this.dashTimer <= 0 && this.energy >= PHYSICS.dashEnergy
  }

  beginDash(dir: THREE.Vector3): void {
    this.dashCooldown = this.stats.dashCooldown
    this.dashTimer = PHYSICS.dashDuration
    this.energy = Math.max(0, this.energy - PHYSICS.dashEnergy)
    this.invuln = Math.max(this.invuln, PHYSICS.dashInvuln)
    if (dir.lengthSq() > 0.001) {
      this.dashDir.copy(dir).setY(0).normalize()
    } else {
      this.dashDir.set(Math.sin(this.facing), 0, Math.cos(this.facing))
    }
    if (this.velocity.y < 0) this.velocity.y *= 0.2
    this.audio.play('dash')
    this.effects.burst(
      new THREE.Vector3(this.position.x, this.position.y + 0.8, this.position.z),
      {
        count: 22,
        color: [0x8ef6ff, 0xffffff],
        speed: 4,
        life: 0.42,
        size: 0.7,
        gravity: -1,
        drag: 3.4,
        spreadY: 0.5,
      }
    )
  }

  takeDamage(amount: number, from?: THREE.Vector3): number {
    if (this.dead || this.invuln > 0) return 0
    const dealt = Math.max(1, Math.round(amount * this.stats.damageMult))
    this.hp -= dealt
    this.invuln = PHYSICS.hitInvuln
    this.hitFlash = 0.32
    this.audio.play('hurt')
    if (from) {
      const dir = new THREE.Vector3(this.position.x - from.x, 0, this.position.z - from.z)
      if (dir.lengthSq() > 0.001) {
        dir.normalize().multiplyScalar(PHYSICS.knockback)
        this.velocity.x += dir.x
        this.velocity.z += dir.z
      }
    }
    this.effects.burst(new THREE.Vector3(this.position.x, this.position.y + 1, this.position.z), {
      count: 18,
      color: [0xff5a6e, 0xffd0d6],
      speed: 5,
      life: 0.5,
      size: 0.8,
      gravity: -4,
      drag: 2.6,
    })
    if (this.hp <= 0) {
      this.hp = 0
      this.die()
    }
    return dealt
  }

  heal(amount: number): number {
    const before = this.hp
    this.hp = Math.min(this.stats.maxHp, this.hp + amount)
    return this.hp - before
  }

  private die(): void {
    this.dead = true
    this.deathTimer = 0
    this.audio.play('defeat')
    this.effects.burst(new THREE.Vector3(this.position.x, this.position.y + 1, this.position.z), {
      count: 60,
      color: [0x66f0ff, 0x4a6bff, 0xffffff],
      speed: 8,
      life: 1.1,
      size: 1.1,
      gravity: -3,
      drag: 1.6,
    })
  }

  update(dt: number, intent: PlayerIntent, world: WorldRef, time: number): void {
    if (this.dead) {
      this.deathTimer += dt
      const t = Math.min(1, this.deathTimer / 1.1)
      this.body.rotation.x = -t * Math.PI * 0.48
      this.body.position.y = -t * 0.35
      this.group.position.copy(this.position)
      this.updateCape(time, 0)
      return
    }

    this.attackCooldown = Math.max(0, this.attackCooldown - dt)
    this.dashCooldown = Math.max(0, this.dashCooldown - dt)
    this.invuln = Math.max(0, this.invuln - dt)
    this.hitFlash = Math.max(0, this.hitFlash - dt)
    this.attackAnim = Math.max(0, this.attackAnim - dt)
    this.landSquash = Math.max(0, this.landSquash - dt * 3.4)

    if (this.dashTimer <= 0) {
      this.energy = Math.min(this.stats.maxEnergy, this.energy + this.stats.energyRegen * dt)
    }

    // Camera-relative movement basis.
    const forwardX = -Math.sin(intent.cameraYaw)
    const forwardZ = -Math.cos(intent.cameraYaw)
    const rightX = Math.cos(intent.cameraYaw)
    const rightZ = -Math.sin(intent.cameraYaw)
    const wishX = forwardX * -intent.moveZ + rightX * intent.moveX
    const wishZ = forwardZ * -intent.moveZ + rightZ * intent.moveX
    const wishLen = Math.hypot(wishX, wishZ)
    const wish = new THREE.Vector3(wishLen > 0.001 ? wishX / wishLen : 0, 0, wishLen > 0.001 ? wishZ / wishLen : 0)
    const wishAmount = Math.min(1, wishLen)

    // Jump handling (coyote time + buffer + air jumps).
    this.coyote = this.onGround ? PHYSICS.coyoteTime : Math.max(0, this.coyote - dt)
    this.jumpBuffer = intent.jump ? PHYSICS.jumpBuffer : Math.max(0, this.jumpBuffer - dt)
    if (this.jumpBuffer > 0) {
      if (this.coyote > 0 || this.onGround) {
        this.velocity.y = this.stats.jumpVelocity
        this.onGround = false
        this.coyote = 0
        this.jumpBuffer = 0
        this.audio.play('jump')
        this.effects.burst(new THREE.Vector3(this.position.x, this.position.y + 0.1, this.position.z), {
          count: 14,
          color: 0xbfe9ff,
          speed: 3.4,
          life: 0.45,
          size: 0.7,
          gravity: -5,
          drag: 3,
          spreadY: 0.25,
        })
      } else if (this.airJumpsLeft > 0) {
        this.airJumpsLeft--
        this.velocity.y = this.stats.jumpVelocity * 0.92
        this.jumpBuffer = 0
        this.audio.play('jump')
        this.effects.shockwave(new THREE.Vector3(this.position.x, this.position.y + 0.2, this.position.z), 2.4, 0x8ef6ff, 0.36, 0.05)
      }
    }

    // Dash movement overrides normal control.
    if (this.dashTimer > 0) {
      this.dashTimer -= dt
      const dashSpeed = this.stats.dashDistance / PHYSICS.dashDuration
      this.velocity.x = this.dashDir.x * dashSpeed
      this.velocity.z = this.dashDir.z * dashSpeed
      this.velocity.y *= 0.4
      if (this.rng() < 0.7) {
        this.effects.burst(
          new THREE.Vector3(this.position.x, this.position.y + 0.85, this.position.z),
          {
            count: 2,
            color: [0x8ef6ff, 0x4a6bff],
            speed: 1.2,
            life: 0.4,
            size: 0.85,
            gravity: 0,
            drag: 3,
            spreadY: 0.4,
          }
        )
      }
    } else {
      const speed = this.stats.moveSpeed * (intent.sprint && wishAmount > 0.1 ? this.stats.sprintMult : 1)
      const targetVX = wish.x * speed * wishAmount
      const targetVZ = wish.z * speed * wishAmount
      const accel = this.onGround ? PHYSICS.groundAccel : PHYSICS.airAccel * PHYSICS.airControl
      this.velocity.x = damp(this.velocity.x, targetVX, accel / Math.max(1, speed) * 2.2, dt)
      this.velocity.z = damp(this.velocity.z, targetVZ, accel / Math.max(1, speed) * 2.2, dt)
      if (wishAmount < 0.05 && this.onGround) {
        this.velocity.x = damp(this.velocity.x, 0, 12, dt)
        this.velocity.z = damp(this.velocity.z, 0, 12, dt)
      }
    }

    this.sprinting = intent.sprint && wishAmount > 0.4 && this.onGround && this.dashTimer <= 0

    // Gravity + integration
    this.velocity.y = Math.max(-PHYSICS.maxFallSpeed, this.velocity.y - PHYSICS.gravity * dt)
    this.position.x += this.velocity.x * dt
    this.position.z += this.velocity.z * dt
    this.position.y += this.velocity.y * dt

    world.resolveCollision(this.position, this.radius)

    // Ground collision
    const groundY = world.heightAt(this.position.x, this.position.z)
    const wasAir = !this.onGround
    const groundedAtStart = this.onGround
    if (
      wasAir &&
      groundedAtStart &&
      this.velocity.y <= 0 &&
      this.dashTimer <= 0 &&
      this.position.y > groundY &&
      this.position.y - groundY < 1.1
    ) {
      // Slope snap: keep the guardian glued to the ground while running downhill.
      this.position.y = groundY
      this.velocity.y = 0
      this.onGround = true
      this.airTime = 0
    }
    if (this.position.y <= groundY + 0.02) {
      this.position.y = groundY
      if (wasAir && this.velocity.y < -4) {
        this.landSquash = Math.min(1, -this.velocity.y / 18)
        this.audio.play('land')
        this.effects.burst(
          new THREE.Vector3(this.position.x, this.position.y + 0.08, this.position.z),
          {
            count: 14,
            color: 0xdfe8f7,
            speed: 3.2,
            life: 0.45,
            size: 0.75,
            gravity: -6,
            drag: 3.2,
            spreadY: 0.25,
          }
        )
      }
      if (this.velocity.y <= 0) {
        this.velocity.y = 0
        this.onGround = true
        this.airJumpsLeft = this.stats.airJumps
      }
    } else {
      this.onGround = false
    }

    if (!this.onGround) this.airTime += dt
    else this.airTime = 0

    // Falling out of the world safety net.
    if (this.position.y < -40) {
      this.position.set(this.spawnPoint.x, world.heightAt(this.spawnPoint.x, this.spawnPoint.z) + 0.4, this.spawnPoint.z)
      this.velocity.set(0, 0, 0)
      this.takeDamage(12)
    }

    // Facing
    if (wishAmount > 0.08 && this.dashTimer <= 0) {
      const targetFacing = Math.atan2(wish.x, wish.z)
      this.facing = angleLerp(this.facing, targetFacing, 1 - Math.exp(-PHYSICS.turnRate * dt))
    } else if (this.dashTimer > 0) {
      this.facing = Math.atan2(this.dashDir.x, this.dashDir.z)
    }

    // Footsteps
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z)
    if (this.onGround && horizontalSpeed > 1.2) {
      this.stepTimer -= dt * horizontalSpeed
      if (this.stepTimer <= 0) {
        this.stepTimer = 6.2
        this.audio.play('step')
        if (this.rng() < 0.4) {
          this.effects.burst(
            new THREE.Vector3(this.position.x, this.position.y + 0.08, this.position.z),
            {
              count: 3,
              color: 0xe6f2ff,
              speed: 1.4,
              life: 0.4,
              size: 0.55,
              gravity: -3,
              drag: 3.6,
              spreadY: 0.25,
            }
          )
        }
      }
    }

    this.group.position.copy(this.position)
    this.group.rotation.y = this.facing
    this.animate(dt, time, horizontalSpeed)
  }

  private animate(dt: number, time: number, speed: number): void {
    const runAmt = clamp(speed / (this.stats.moveSpeed * this.stats.sprintMult), 0, 1)
    this.walkPhase += dt * (4 + speed * 1.15)
    const phase = this.walkPhase
    const air = !this.onGround

    // Body bob + lean
    const bob = Math.abs(Math.sin(phase)) * 0.06 * runAmt
    const squash = this.landSquash * 0.18
    this.body.position.y = bob - squash
    this.body.rotation.x = damp(this.body.rotation.x, runAmt * 0.16 + (air ? -0.12 : 0), 8, dt)
    this.body.rotation.z = damp(this.body.rotation.z, 0, 6, dt)
    this.body.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5)

    if (air) {
      const rising = this.velocity.y > 0
      this.legL.rotation.x = damp(this.legL.rotation.x, rising ? -0.55 : -0.15, 8, dt)
      this.legR.rotation.x = damp(this.legR.rotation.x, rising ? 0.35 : 0.25, 8, dt)
      this.shinL.rotation.x = damp(this.shinL.rotation.x, rising ? 0.95 : 0.4, 8, dt)
      this.shinR.rotation.x = damp(this.shinR.rotation.x, rising ? 0.5 : 0.6, 8, dt)
      this.armL.rotation.x = damp(this.armL.rotation.x, rising ? -1.4 : -0.7, 6, dt)
      this.armR.rotation.x = damp(this.armR.rotation.x, rising ? -1.2 : -0.6, 6, dt)
      this.armL.rotation.z = damp(this.armL.rotation.z, 0.35, 6, dt)
      this.armR.rotation.z = damp(this.armR.rotation.z, -0.35, 6, dt)
      this.foreL.rotation.x = damp(this.foreL.rotation.x, -0.4, 6, dt)
      this.foreR.rotation.x = damp(this.foreR.rotation.x, -0.5, 6, dt)
    } else {
      const swing = Math.sin(phase) * (0.35 + runAmt * 0.5)
      const swingAlt = Math.sin(phase + Math.PI) * (0.35 + runAmt * 0.5)
      const kneeBend = (p: number): number => Math.max(0, -Math.sin(p + 0.7)) * (0.5 + runAmt * 0.75)
      this.legL.rotation.x = damp(this.legL.rotation.x, swing, 16, dt)
      this.legR.rotation.x = damp(this.legR.rotation.x, swingAlt, 16, dt)
      this.shinL.rotation.x = damp(this.shinL.rotation.x, kneeBend(phase), 16, dt)
      this.shinR.rotation.x = damp(this.shinR.rotation.x, kneeBend(phase + Math.PI), 16, dt)

      const armSwing = Math.sin(phase + Math.PI) * (0.22 + runAmt * 0.6)
      const armSwingAlt = Math.sin(phase) * (0.22 + runAmt * 0.6)
      this.armL.rotation.x = damp(this.armL.rotation.x, armSwing, 14, dt)
      this.armR.rotation.x = damp(this.armR.rotation.x, armSwingAlt, 14, dt)
      this.armL.rotation.z = damp(this.armL.rotation.z, 0.12 + runAmt * 0.1, 8, dt)
      this.armR.rotation.z = damp(this.armR.rotation.z, -0.12 - runAmt * 0.1, 8, dt)
      this.foreL.rotation.x = damp(this.foreL.rotation.x, -0.25 - runAmt * 0.35, 10, dt)
      this.foreR.rotation.x = damp(this.foreR.rotation.x, -0.25 - runAmt * 0.35, 10, dt)
    }

    // Attack swing overrides the right arm.
    if (this.attackAnim > 0) {
      const t = 1 - this.attackAnim / 0.26
      const swing = Math.sin(t * Math.PI) * 1.5
      this.armR.rotation.x = -1.9 + swing * 1.5
      this.armR.rotation.z = -0.5 + swing * 0.3
      this.foreR.rotation.x = -0.9 + swing * 0.7
      this.core.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.8)
    } else {
      this.core.scale.setScalar(1 + Math.sin(time * 2.4) * 0.08)
    }

    // Idle breathing
    if (runAmt < 0.05 && this.onGround) {
      const breath = Math.sin(time * 1.6) * 0.02
      this.body.position.y += breath
      this.head.rotation.x = Math.sin(time * 0.8) * 0.04
      this.armL.rotation.x += Math.sin(time * 1.6) * 0.03
      this.armR.rotation.x += Math.sin(time * 1.6 + 0.6) * 0.03
    } else {
      this.head.rotation.x = damp(this.head.rotation.x, -runAmt * 0.1, 6, dt)
    }

    // Companion crystal orbit
    const orbit = time * 1.4
    this.companion.position.set(
      0.6 + Math.sin(orbit) * 0.12,
      1.5 + Math.sin(time * 2.1) * 0.08,
      0.26 + Math.cos(orbit) * 0.14
    )
    this.companion.rotation.y += dt * 1.8
    this.companion.rotation.x += dt * 0.9
    this.companionLight.position.copy(this.companion.position)
    const pulse = this.attackAnim > 0 ? 2.4 : 1.4 + Math.sin(time * 3) * 0.25
    this.companionLight.intensity = pulse * 5

    // Hit flash
    const flash = this.hitFlash > 0 ? this.hitFlash / 0.32 : 0
    for (const mat of this.armorMats) {
      mat.emissive.setRGB(flash * 0.9, flash * 0.06, flash * 0.12)
    }
    for (const mat of this.accentMats) {
      mat.emissiveIntensity = 1.6 + flash * 2.4
    }
    this.group.visible = true
    if (this.invuln > 0 && !this.dead) {
      const blink = Math.sin(time * 40) > -0.3
      this.group.visible = blink || this.dashTimer > 0
    }

    this.updateCape(time, speed)
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
    this.armorMats = []
    this.accentMats = []
  }

  private updateCape(time: number, speed: number): void {
    const pos = this.capeGeo.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const base = this.capeBase
    const flare = clamp(speed / 12, 0, 1) * 0.55
    for (let i = 0; i < pos.count; i++) {
      const i3 = i * 3
      const x = base[i3]
      const y = base[i3 + 1]
      const t = clamp((0.62 - y) / 1.25, 0, 1)
      const wave = Math.sin(time * 5.2 + x * 3.4 + t * 5) * 0.075 * t
      arr[i3] = x * (1 + t * 0.22)
      arr[i3 + 2] = base[i3 + 2] + wave - flare * t
    }
    pos.needsUpdate = true
    this.capeGeo.computeVertexNormals()
  }
}

function angleLerp(from: number, to: number, t: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI
  if (diff < -Math.PI) diff += Math.PI * 2
  return from + diff * t
}
