// Aetherfall — game orchestrator: renderer, run flow, combat, objectives, HUD events.
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import { Emitter, formatScore } from './utils'
import { AudioEngine } from './audio'
import { InputManager } from './input'
import { CameraRig } from './camera'
import { EffectsSystem } from './effects'
import { BASE_STATS, PHYSICS, QUALITY_PRESETS, SCORE, pickUpgradeChoices, resolveQuality, toChoices, type PlayerStats } from './config'
import { ZONE_COUNT, zoneAt, type ZoneDef } from './zones'
import { buildZone, ZoneWorld } from './world/zone'
import { Player } from './entities/player'
import { EnemyManager, type Enemy, type EnemyKind } from './entities/enemies'
import { ProjectileManager } from './entities/projectiles'
import { PickupManager } from './entities/pickups'
import type {
  HudState,
  Phase,
  ProgressState,
  RadarBlip,
  RadarData,
  ResolvedQuality,
  RunSummary,
  Settings,
  UpgradeChoice,
  ZoneIntro,
} from './types'

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 16)
  })

interface RunState {
  zoneIndex: number
  zone: ZoneDef | null
  stats: PlayerStats
  score: number
  shardScore: number
  killScore: number
  zoneScore: number
  healthScore: number
  shards: number
  kills: number
  elapsed: number
  zonesCleared: number
  enemyTarget: number
  pending: ReturnType<typeof pickUpgradeChoices>
}

export class Game {
  private emitter = new Emitter()
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private rig: CameraRig
  private input: InputManager
  private audio = new AudioEngine()
  private effects: EffectsSystem
  private projectiles: ProjectileManager
  private player: Player
  private composer: EffectComposer | null = null
  private bloomPass: UnrealBloomPass | null = null
  private resizeObserver: ResizeObserver | null = null

  private world: ZoneWorld | null = null
  private enemies: EnemyManager | null = null
  private pickups: PickupManager | null = null

  private phase: Phase = 'boot'
  private settings: Settings
  private quality: ResolvedQuality
  private rng = Math.random
  private rafId = 0
  private lastTime = 0
  private time = 0
  private fps = 60
  private fpsAccum = 0
  private fpsFrames = 0
  private hudTimer = 0
  private timeScale = 1
  private slowMoTimer = 0
  private disposed = false
  private zoneToken = 0
  private menuMode = true
  private menuYaw = 0
  private toastId = 1
  private qualityWatch = 0
  private qualityAdjustments = 0
  private lowFpsTime = 0
  private highFpsTime = 0
  private intensityTimer = 0

  private run: RunState = {
    zoneIndex: 0,
    zone: null,
    stats: { ...BASE_STATS },
    score: 0,
    shardScore: 0,
    killScore: 0,
    zoneScore: 0,
    healthScore: 0,
    shards: 0,
    kills: 0,
    elapsed: 0,
    zonesCleared: 0,
    enemyTarget: 0,
    pending: [],
  }

  constructor(private container: HTMLElement, settings: Settings) {
    this.settings = settings
    const nav = navigator as Navigator & { deviceMemory?: number }
    this.quality = resolveQuality(
      settings.quality,
      typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 8,
      typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 8
    )

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.quality !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_PRESETS[this.quality].pixelRatio))
    this.renderer.setSize(container.clientWidth || 1, container.clientHeight || 1)
    this.renderer.shadowMap.enabled = QUALITY_PRESETS[this.quality].shadows
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.renderer.domElement.style.touchAction = 'none'
    container.appendChild(this.renderer.domElement)

    this.rig = new CameraRig((container.clientWidth || 1) / (container.clientHeight || 1))
    this.scene.fog = new THREE.Fog(0x0b1020, 60, 240)

    this.effects = new EffectsSystem(QUALITY_PRESETS[this.quality].particles, this.rng)
    this.scene.add(this.effects.group)
    this.projectiles = new ProjectileManager()
    this.scene.add(this.projectiles.group)

    this.player = new Player(this.effects, this.audio, this.rng, { ...BASE_STATS })
    this.player.group.visible = false
    this.scene.add(this.player.group)

    this.input = new InputManager(
      this.renderer.domElement,
      () => this.handlePauseRequest(),
      () => this.audio.unlock()
    )
    this.input.setEnabled(false)

    this.setupComposer()
    this.audio.setVolumes(settings.master, settings.music, settings.sfx)

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(container)

    this.lastTime = performance.now()
    this.rafId = requestAnimationFrame(this.loop)
  }

  // ------------------------------------------------------------- lifecycle --

  on(event: string, listener: (...args: any[]) => void): () => void {
    return this.emitter.on(event, listener)
  }

  private setupComposer(): void {
    if (this.quality === 'low') return
    try {
      const size = new THREE.Vector2()
      this.renderer.getSize(size)
      const composer = new EffectComposer(this.renderer)
      composer.addPass(new RenderPass(this.scene, this.rig.camera))
      const bloom = new UnrealBloomPass(size, this.quality === 'high' ? 0.34 : 0.26, 0.72, 0.88)
      composer.addPass(bloom)
      composer.addPass(new OutputPass())
      composer.setSize(size.x, size.y)
      this.composer = composer
      this.bloomPass = bloom
    } catch (err) {
      console.warn('[game] post-processing unavailable, falling back to direct render', err)
      this.composer = null
      this.bloomPass = null
    }
  }

  private handleResize(): void {
    const width = this.container.clientWidth || 1
    const height = this.container.clientHeight || 1
    this.renderer.setSize(width, height)
    this.rig.resize(width / height)
    this.composer?.setSize(width, height)
  }

  async boot(): Promise<void> {
    await this.loadMenuBackdrop()
  }

  private async loadMenuBackdrop(): Promise<void> {
    const token = ++this.zoneToken
    this.phase = 'loading'
    this.emitter.emit('phase', 'loading')
    const zone = zoneAt(0)
    this.emitter.emit('progress', { pct: 0.04, label: `Entering ${zone.name}`, tip: zone.tip })
    this.disposeZone()
    this.menuMode = true
    this.player.group.visible = false
    const world = await buildZone(zone, QUALITY_PRESETS[this.quality], (pct, label) => {
      this.emitter.emit('progress', { pct: pct * 0.9, label, tip: zone.tip })
    })
    if (token !== this.zoneToken) {
      world.dispose()
      return
    }
    this.world = world
    this.scene.add(world.group)
    this.scene.background = new THREE.Color(zone.palette.fog)
    this.scene.fog = new THREE.Fog(zone.palette.fog, world.fogNear, world.fogFar)
    this.emitter.emit('progress', { pct: 1, label: 'Ready', tip: zone.tip })
    await nextFrame()
    this.phase = 'menu'
    this.emitter.emit('phase', 'menu')
  }

  async startRun(): Promise<void> {
    this.run = {
      zoneIndex: 0,
      zone: null,
      stats: { ...BASE_STATS },
      score: 0,
      shardScore: 0,
      killScore: 0,
      zoneScore: 0,
      healthScore: 0,
      shards: 0,
      kills: 0,
      elapsed: 0,
      zonesCleared: 0,
      enemyTarget: 0,
      pending: [],
    }
    this.player.applyUpgrades({ ...BASE_STATS })
    this.timeScale = 1
    this.slowMoTimer = 0
    this.audio.unlock()

    const zone = zoneAt(0)
    const reusable = this.world !== null && this.menuMode && this.world.zone.index === 0
    this.menuMode = false
    this.emitter.emit('toast', { id: this.toastId++, text: 'Run started — good luck, Guardian', tone: 'good' })
    if (reusable && this.world) {
      this.setupZoneEntities(zone, this.world)
      this.phase = 'playing'
      this.emitter.emit('phase', 'playing')
      this.emitter.emit('zone-intro', this.zoneIntro(zone))
      this.emitHud(true)
      return
    }
    await this.enterZone(0)
  }

  private async enterZone(index: number): Promise<void> {
    const token = ++this.zoneToken
    const zone = zoneAt(index)
    this.phase = 'loading'
    this.emitter.emit('phase', 'loading')
    this.emitter.emit('progress', { pct: 0.03, label: `Entering ${zone.name}`, tip: zone.tip } as ProgressState)
    this.disposeZone()
    await nextFrame()
    const world = await buildZone(zone, QUALITY_PRESETS[this.quality], (pct, label) => {
      this.emitter.emit('progress', { pct: pct * 0.92, label, tip: zone.tip } as ProgressState)
    })
    if (token !== this.zoneToken) {
      world.dispose()
      return
    }
    this.world = world
    this.scene.add(world.group)
    this.scene.background = new THREE.Color(zone.palette.fog)
    this.scene.fog = new THREE.Fog(zone.palette.fog, world.fogNear, world.fogFar)
    this.emitter.emit('progress', { pct: 0.96, label: 'Waking the guardian', tip: zone.tip } as ProgressState)
    await nextFrame()
    this.setupZoneEntities(zone, world)
    this.emitter.emit('progress', { pct: 1, label: 'Ready', tip: zone.tip } as ProgressState)
    this.phase = 'playing'
    this.emitter.emit('phase', 'playing')
    this.emitter.emit('zone-intro', this.zoneIntro(zone))
    this.emitHud(true)
  }

  private setupZoneEntities(zone: ZoneDef, world: ZoneWorld): void {
    this.run.zone = zone
    this.run.zoneIndex = zone.index
    this.run.enemyTarget = zone.enemies.wisp + zone.enemies.sentry + zone.enemies.brute + (zone.boss ? 1 : 0)

    this.player.spawnAt(world.spawnPoint, world)
    this.player.applyUpgrades(this.run.stats)
    this.player.group.visible = true
    this.input.setEnabled(true)
    this.effects.clearTelegraphs()
    this.projectiles.clear()

    this.enemies = new EnemyManager(zone)
    this.enemies.spawnZone(world, this.rng, this.player.position)
    this.scene.add(this.enemies.group)

    this.pickups = new PickupManager(world, zone, this.rng, this.effects)
    this.scene.add(this.pickups.group)

    this.rig.yaw = Math.PI * 0.75
    this.rig.pitch = 0.34
    this.rig.snap(this.player.position, world)

    this.audio.unlock()
    this.audio.playMusic(zone.music)
    this.audio.setIntensity(0.2)
  }

  private zoneIntro(zone: ZoneDef): ZoneIntro {
    return {
      zone: zone.index + 1,
      zoneCount: ZONE_COUNT,
      name: zone.name,
      subtitle: zone.subtitle,
      objective: `${zone.shards} shards · ${zone.enemies.wisp + zone.enemies.sentry + zone.enemies.brute + (zone.boss ? 1 : 0)} hostiles`,
    }
  }

  private disposeZone(): void {
    if (this.enemies) {
      this.scene.remove(this.enemies.group)
      this.enemies.dispose()
      this.enemies = null
    }
    if (this.pickups) {
      this.scene.remove(this.pickups.group)
      this.pickups.dispose()
      this.pickups = null
    }
    if (this.world) {
      this.scene.remove(this.world.group)
      this.world.dispose()
      this.world = null
    }
    this.effects.clearTelegraphs()
    this.projectiles.clear()
  }

  // ------------------------------------------------------------ run control --

  pause(): void {
    if (this.phase !== 'playing') return
    this.phase = 'paused'
    this.input.setEnabled(false)
    this.emitter.emit('phase', 'paused')
  }

  resume(): void {
    if (this.phase !== 'paused') return
    this.phase = 'playing'
    this.input.setEnabled(true)
    this.audio.unlock()
    this.emitter.emit('phase', 'playing')
  }

  private handlePauseRequest(): void {
    if (this.phase === 'playing') this.pause()
    else if (this.phase === 'paused') this.resume()
  }

  async restartRun(): Promise<void> {
    this.emitter.emit('toast', { id: this.toastId++, text: 'Restarting run', tone: 'info' })
    await this.startRun()
  }

  quitToMenu(): void {
    this.audio.stopMusic()
    void this.loadMenuBackdrop()
  }

  chooseUpgrade(id: string): void {
    if (this.phase !== 'upgrade') return
    const def = this.run.pending.find((d) => d.id === id)
    if (def) {
      const next = { ...this.run.stats }
      def.apply(next)
      this.run.stats = next
      this.player.applyUpgrades(next)
      this.emitter.emit('toast', { id: this.toastId++, text: `${def.name} acquired`, tone: 'good' })
    }
    this.run.pending = []
    this.audio.play('upgrade')
    this.phase = 'loading'
    this.emitter.emit('phase', 'loading')
    void this.enterZone(this.run.zoneIndex)
  }

  applySettings(settings: Settings): void {
    const previousQuality = this.quality
    this.settings = settings
    this.audio.setVolumes(settings.master, settings.music, settings.sfx)
    this.quality = resolveQuality(settings.quality, 8, 8)
    if (this.quality !== previousQuality) {
      const preset = QUALITY_PRESETS[this.quality]
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio))
      this.renderer.shadowMap.enabled = preset.shadows
      this.world?.setShadows(preset.shadows)
      this.world?.setShadowQuality(preset.shadowMapSize)
      this.renderer.shadowMap.needsUpdate = true
      this.composer = null
      this.bloomPass = null
      this.setupComposer()
      this.handleResize()
      this.emitter.emit('toast', {
        id: this.toastId++,
        text: `Graphics set to ${this.quality}`,
        tone: 'info',
      })
    }
  }

  getRadar(): RadarData | null {
    if (!this.world || !this.player) return null
    const blips: RadarBlip[] = []
    if (this.pickups) {
      blips.push(...this.pickups.blips())
    }
    if (this.enemies) {
      for (const enemy of this.enemies.enemies) {
        if (!enemy.alive || enemy.dying) continue
        blips.push({
          x: enemy.position.x,
          z: enemy.position.z,
          kind: enemy.kind === 'boss' ? 'boss' : 'enemy',
        })
      }
    }
    return {
      rot: this.player.facing,
      range: 72,
      x: this.player.position.x,
      z: this.player.position.z,
      blips,
    }
  }

  // ------------------------------------------------------------- main loop --

  private loop = (now: number): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.loop)
    const rawDt = Math.min(0.05, Math.max(0.0005, (now - this.lastTime) / 1000))
    this.lastTime = now
    this.time += rawDt

    this.fpsAccum += rawDt
    this.fpsFrames++
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum
      this.fpsAccum = 0
      this.fpsFrames = 0
      this.watchPerformance()
    }

    if (this.slowMoTimer > 0) {
      this.slowMoTimer -= rawDt
      if (this.slowMoTimer <= 0) this.timeScale = 1
    }

    const dt = rawDt * this.timeScale

    if (this.phase === 'playing') {
      this.updatePlaying(dt, rawDt)
    } else if (this.phase === 'menu' || this.phase === 'boot') {
      this.updateMenuCamera(rawDt)
    } else if (this.phase === 'paused' || this.phase === 'upgrade' || this.phase === 'gameover' || this.phase === 'victory') {
      if (this.world) {
        this.world.update(rawDt, this.time, this.player.position)
        this.effects.update(rawDt * 0.4)
        this.projectiles.update(rawDt * 0.25, this.projectileContext())
        if (this.phase === 'paused' || this.phase === 'upgrade') {
          this.rig.update(
            rawDt,
            this.player.position,
            { x: 0, z: 0, active: false },
            { x: 0, y: 0 },
            0,
            this.settings.sensitivity,
            this.world,
            false,
            false
          )
        }
      }
    }

    if (this.phase === 'loading') {
      // Keep the scene alive while assets stream in.
      this.effects.update(rawDt * 0.3)
    }

    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.rig.camera)
  }

  private updateMenuCamera(dt: number): void {
    if (!this.world) return
    this.menuYaw += dt * 0.055
    const target = this.world.portalSpot
    const head = new THREE.Vector3(target.x, target.y + 5, target.z)
    const distance = 48
    const pitch = 0.42
    const desired = new THREE.Vector3(
      head.x + Math.sin(this.menuYaw) * Math.cos(pitch) * distance,
      head.y + Math.sin(pitch) * distance,
      head.z + Math.cos(this.menuYaw) * Math.cos(pitch) * distance
    )
    const ground = this.world.heightAt(desired.x, desired.z) + 6
    if (desired.y < ground) desired.y = ground
    this.rig.camera.position.lerp(desired, Math.min(1, dt * 1.6))
    this.rig.camera.lookAt(head)
    this.world.update(dt, this.time, this.rig.camera.position)
    this.effects.update(dt)
  }

  private projectileContext() {
    return {
      world: this.world as ZoneWorld,
      playerPos: this.player.position,
      playerRadius: this.player.radius,
      playerAlive: !this.player.dead && this.phase === 'playing',
      onPlayerHit: (damage: number, from: THREE.Vector3) => {
        if (this.phase !== 'playing') return
        this.damagePlayer(damage, from)
      },
    }
  }

  private updatePlaying(dt: number, rawDt: number): void {
    const world = this.world
    const enemies = this.enemies
    const pickups = this.pickups
    if (!world || !enemies || !pickups) return

    this.run.elapsed += rawDt

    const move = this.input.sample()
    const look = this.input.consumeLook()
    const zoom = this.input.consumeZoom()
    const attack = this.input.consumeAttack()
    const dash = this.input.consumeDash()
    const jump = this.input.consumeJump() || this.input.jumpHeld

    if (this.player.dead) {
      this.player.update(dt, {
        moveX: 0,
        moveZ: 0,
        sprint: false,
        jump: false,
        attack: false,
        dash: false,
        cameraYaw: this.rig.yaw,
      }, world, this.time)
    } else {
      if (attack && this.player.canAttack()) {
        this.player.beginAttack()
        this.resolveAttack()
      }
      if (dash && this.player.canDash()) {
        const forwardX = -Math.sin(this.rig.yaw)
        const forwardZ = -Math.cos(this.rig.yaw)
        const rightX = Math.cos(this.rig.yaw)
        const rightZ = -Math.sin(this.rig.yaw)
        const dirX = forwardX * -move.z + rightX * move.x
        const dirZ = forwardZ * -move.z + rightZ * move.x
        const dir = new THREE.Vector3(dirX, 0, dirZ)
        if (dir.lengthSq() < 0.01) dir.set(Math.sin(this.player.facing), 0, Math.cos(this.player.facing))
        this.player.beginDash(dir)
      }
      this.player.update(
        dt,
        {
          moveX: move.x,
          moveZ: move.z,
          sprint: this.input.sprint,
          jump,
          attack,
          dash,
          cameraYaw: this.rig.yaw,
        },
        world,
        this.time
      )
    }

    const enemyCtx = {
      playerPos: this.player.position,
      playerAlive: !this.player.dead,
      playerRadius: this.player.radius,
      world,
      effects: this.effects,
      audio: this.audio,
      projectiles: this.projectiles,
      damagePlayer: (amount: number, from: THREE.Vector3) => this.damagePlayer(amount, from),
      spawnMinion: (kind: EnemyKind, position: THREE.Vector3) => enemies.spawnMinion(kind, position),
    }
    enemies.update(dt, this.time, enemyCtx)
    this.projectiles.update(dt, this.projectileContext())

    pickups.update(dt, this.time, this.player.position, this.player.stats.pickupRadius, {
      onShard: (remaining) => {
        this.run.shards++
        this.run.shardScore += SCORE.shard
        this.audio.play('collect')
        this.emitter.emit('toast', {
          id: this.toastId++,
          text: `Shard secured · ${this.run.shards} collected${remaining > 0 ? ` · ${remaining} left` : ' · all found!'}`,
          tone: 'good',
        })
        this.rig.shake(0.08)
      },
      onOrb: () => {
        const healed = this.player.heal(28)
        this.audio.play('orb')
        this.emitter.emit('toast', {
          id: this.toastId++,
          text: healed > 0 ? `Vitality orb · +${healed} health` : 'Vitality orb absorbed',
          tone: 'good',
        })
      },
    })

    this.effects.update(dt)
    world.update(dt, this.time, this.player.position)

    this.rig.update(
      dt,
      this.player.position,
      { x: move.x, z: move.z, active: Math.hypot(move.x, move.z) > 0.15 && !this.player.dead },
      look,
      zoom,
      this.settings.sensitivity,
      world,
      this.player.sprinting,
      this.input.isDragging
    )
    this.rig.setFovBoost(this.player.dashCooldown > 0 && this.player.stats.dashCooldown - this.player.dashCooldown < 0.3 ? 6 : 0)

    // Objectives
    if (!this.player.dead) {
      if (!pickups.portalOpen && pickups.remainingShards === 0 && enemies.remaining === 0) {
        pickups.openPortal()
        this.audio.play('portal')
        this.rig.shake(0.35)
        this.emitter.emit('toast', {
          id: this.toastId++,
          text: 'Beacon online — reach the portal to advance',
          tone: 'warn',
        })
      }
      if (pickups.portalOpen && pickups.portalDistance(this.player.position) < 2.8) {
        this.completeZone()
      }
    }

    if (this.player.dead && this.player.deathTimer > 1.9) {
      this.finishRun(false)
    }

    // Combat intensity drives the adaptive music layer.
    this.intensityTimer -= rawDt
    if (this.intensityTimer <= 0) {
      this.intensityTimer = 0.6
      let nearest = Infinity
      for (const enemy of enemies.enemies) {
        if (!enemy.alive || enemy.dying) continue
        const d = enemy.position.distanceTo(this.player.position)
        if (d < nearest) nearest = d
      }
      const target = nearest < 18 ? 1 : nearest < 34 ? 0.55 : 0.15
      this.audio.setIntensity(target)
    }

    this.hudTimer -= rawDt
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.09
      this.emitHud(false)
    }
  }

  private resolveAttack(): void {
    const player = this.player
    const enemies = this.enemies
    if (!enemies) return
    const facing = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing))
    const origin = player.position.clone()
    const radius = player.stats.attackRadius
    const { hits, kills } = enemies.damageInArc(origin, facing, radius, Math.cos(Math.PI * 0.42), player.stats.attackDamage)

    const center = origin.clone().addScaledVector(facing, radius * 0.4)
    center.y += 1.1
    this.effects.shockwave(center, radius, 0x7ce8ff, 0.4, -1.0)
    this.effects.burst(center, {
      count: 20,
      color: [0x8ef6ff, 0xffffff, 0x4a6bff],
      speed: radius * 1.7,
      life: 0.42,
      size: 0.85,
      gravity: -2,
      drag: 3.2,
      spreadY: 0.5,
      velocity: new THREE.Vector3(facing.x * 5, 0, facing.z * 5),
    })
    this.rig.shake(hits > 0 ? 0.3 : 0.1)
    if (hits > 0) {
      this.audio.play('hit')
    }
    this.handleKills(kills)
  }

  private handleKills(kills: Enemy[]): void {
    for (const enemy of kills) {
      this.run.kills++
      this.run.killScore += enemy.scoreValue
      const isBoss = enemy.kind === 'boss'
      this.effects.burst(enemy.position.clone(), {
        count: isBoss ? 140 : 34,
        color: isBoss ? [0xa15cff, 0xffffff, 0x4a6bff] : [0x9a5cff, 0xd0b0ff],
        speed: isBoss ? 16 : 8,
        life: isBoss ? 1.4 : 0.8,
        size: isBoss ? 1.6 : 1,
        gravity: -3,
        drag: 1.9,
      })
      this.effects.shockwave(enemy.position.clone(), isBoss ? 16 : 4, isBoss ? 0xa15cff : 0x9a5cff, isBoss ? 1.2 : 0.45, -0.2)
      this.audio.play('enemyDie')
      if (this.player.stats.lifeSteal > 0) {
        const healed = this.player.heal(this.player.stats.lifeSteal)
        if (healed > 0) {
          this.emitter.emit('toast', { id: this.toastId++, text: `Siphon +${healed}`, tone: 'good' })
        }
      }
      if (isBoss) {
        this.rig.shake(1.2)
        this.timeScale = 0.32
        this.slowMoTimer = 2.2
        this.emitter.emit('toast', { id: this.toastId++, text: 'The Shadow Colossus falls!', tone: 'good' })
      } else {
        this.rig.shake(0.12)
      }
    }
  }

  private damagePlayer(amount: number, from: THREE.Vector3): void {
    if (this.phase !== 'playing' || this.player.dead) return
    const dealt = this.player.takeDamage(amount, from)
    if (dealt <= 0) return
    this.rig.shake(0.5)
    this.emitter.emit('damage', dealt)
    this.emitter.emit('toast', { id: this.toastId++, text: `-${dealt} health`, tone: 'bad' })
  }

  private completeZone(): void {
    const player = this.player
    const zone = this.run.zone
    if (!zone) return
    const hpBonus = Math.round(player.hp * SCORE.hpBonus)
    this.run.healthScore += hpBonus
    this.run.zoneScore += SCORE.zoneClear
    this.run.zonesCleared++
    this.audio.play('zoneClear')
    this.effects.burst(player.position.clone(), {
      count: 90,
      color: [0x8ef6ff, 0xffffff, 0xc9b0ff],
      speed: 12,
      life: 1.2,
      size: 1.3,
      gravity: -2,
      drag: 1.6,
    })
    this.rig.shake(0.6)

    if (zone.boss) {
      this.finishRun(true)
      return
    }

    this.run.zoneIndex = Math.min(ZONE_COUNT - 1, zone.index + 1)
    this.run.pending = pickUpgradeChoices(this.rng, 3)
    this.phase = 'upgrade'
    this.input.setEnabled(false)
    this.emitter.emit('phase', 'upgrade')
    const choices: UpgradeChoice[] = toChoices(this.run.pending)
    this.emitter.emit('upgrades', choices)
    this.emitter.emit('toast', { id: this.toastId++, text: `${zone.name} cleared!`, tone: 'good' })
    this.emitHud(true)
  }

  private finishRun(victory: boolean): void {
    if (this.phase === 'gameover' || this.phase === 'victory') return
    // Make sure the very last bonuses are part of the final total.
    this.run.score = this.run.shardScore + this.run.killScore + this.run.zoneScore + this.run.healthScore
    this.phase = victory ? 'victory' : 'gameover'
    this.input.setEnabled(false)
    this.timeScale = 1
    this.slowMoTimer = 0
    if (victory) {
      this.audio.play('victory')
    }
    const summary: RunSummary = {
      score: this.run.score,
      zoneReached: Math.min(ZONE_COUNT, this.run.zoneIndex + 1),
      zonesCleared: this.run.zonesCleared,
      shards: this.run.shards,
      kills: this.run.kills,
      duration: this.run.elapsed,
      victory,
      lines: [
        { label: 'Shards', value: this.run.shardScore },
        { label: 'Hostiles defeated', value: this.run.killScore },
        { label: 'Zone bonuses', value: this.run.zoneScore },
        { label: 'Vitality bonus', value: this.run.healthScore },
      ],
    }
    this.emitter.emit('phase', this.phase)
    this.emitter.emit('result', summary)
    this.emitHud(true)
  }

  get score(): number {
    return this.run.score
  }

  // Touch UI bridge (virtual stick + buttons rendered by React).
  touchMove(x: number, z: number): void {
    this.input.setTouchMove(x, z)
  }

  touchMoveEnd(): void {
    this.input.clearTouchMove()
  }

  touchSprint(value: boolean): void {
    this.input.setTouchSprint(value)
  }

  touchJump(): void {
    this.input.triggerJump()
  }

  touchAttack(): void {
    this.input.triggerAttack()
  }

  touchDash(): void {
    this.input.triggerDash()
  }

  /** Lightweight state probe used by automated browser checks. */
  debugSnapshot(): Record<string, unknown> {
    return {
      phase: this.phase,
      zone: this.run.zoneIndex + 1,
      zoneName: this.run.zone?.name ?? '',
      score: this.run.score,
      time: this.run.elapsed,
      hp: this.player.hp,
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      onGround: this.player.onGround,
      shards: this.run.shards,
      enemies: this.enemies?.remaining ?? 0,
      portalOpen: this.pickups?.portalOpen ?? false,
      fps: Math.round(this.fps),
    }
  }

  /** QA helper: clear the current zone objectives and open the beacon. */
  debugClearObjectives(): void {
    const pickups = this.pickups
    const enemies = this.enemies
    if (!pickups || !enemies) return
    pickups.debugCollectAll(() => {
      this.run.shards++
      this.run.shardScore += SCORE.shard
    })
    const kills: Enemy[] = []
    for (const enemy of enemies.enemies) {
      if (!enemy.alive || enemy.dying) continue
      if (enemy.takeDamage(1e6)) kills.push(enemy)
    }
    this.handleKills(kills)
    if (!pickups.portalOpen && pickups.remainingShards === 0 && enemies.remaining === 0) {
      pickups.openPortal()
      this.audio.play('portal')
    }
  }

  /** QA helper: drop the guardian onto the open portal. */
  debugTeleportToPortal(): void {
    const pickups = this.pickups
    const world = this.world
    if (!pickups || !world || !pickups.portalOpen) return
    const { x, z } = pickups.portalPosition
    this.player.position.set(x, world.heightAt(x, z) + 0.4, z)
    this.player.velocity.set(0, 0, 0)
  }

  private emitHud(force: boolean): void {
    const player = this.player
    const zone = this.run.zone
    const total =
      this.run.shardScore + this.run.killScore + this.run.zoneScore + this.run.healthScore
    this.run.score = total
    const boss = this.enemies?.boss ?? null
    const hud: HudState = {
      hp: Math.round(player.hp),
      maxHp: Math.round(player.stats.maxHp),
      energy: Math.round(player.energy),
      maxEnergy: Math.round(player.stats.maxEnergy),
      score: total,
      shards: this.run.shards,
      shardsTotal: zone?.shards ?? 0,
      enemies: this.enemies?.remaining ?? 0,
      enemiesTotal: this.run.enemyTarget,
      zone: (zone?.index ?? 0) + 1,
      zoneCount: ZONE_COUNT,
      zoneName: zone?.name ?? '',
      time: this.run.elapsed,
      portalOpen: this.pickups?.portalOpen ?? false,
      dashReady: player.stats.dashCooldown > 0 ? 1 - player.dashCooldown / player.stats.dashCooldown : 1,
      sprinting: player.sprinting,
      fps: Math.round(this.fps),
      bossHp: boss && boss.alive ? Math.round(boss.hp) : 0,
      bossMax: boss ? boss.maxHp : 0,
    }
    if (force || this.phase === 'playing') this.emitter.emit('hud', hud)
  }

  private watchPerformance(): void {
    if (this.settings.quality !== 'auto') return
    if (this.phase !== 'playing') return
    this.qualityWatch += 0.5
    if (this.fps < 45) {
      this.lowFpsTime += 0.5
      this.highFpsTime = 0
    } else if (this.fps > 58) {
      this.highFpsTime += 0.5
      this.lowFpsTime = 0
    } else {
      this.lowFpsTime = Math.max(0, this.lowFpsTime - 0.5)
    }
    if (this.lowFpsTime >= 3 && this.quality !== 'low' && this.qualityAdjustments < 3) {
      const next: ResolvedQuality = this.quality === 'high' ? 'medium' : 'low'
      this.quality = next
      this.qualityAdjustments++
      this.lowFpsTime = 0
      const preset = QUALITY_PRESETS[next]
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio))
      this.renderer.shadowMap.enabled = preset.shadows
      this.world?.setShadows(preset.shadows)
      this.world?.setShadowQuality(preset.shadowMapSize)
      this.composer = null
      this.bloomPass = null
      this.setupComposer()
      this.handleResize()
      this.emitter.emit('toast', {
        id: this.toastId++,
        text: `Performance mode: ${next} graphics`,
        tone: 'info',
      })
    } else if (this.highFpsTime >= 22 && this.qualityAdjustments > 0 && this.quality !== 'high') {
      const next: ResolvedQuality = this.quality === 'low' ? 'medium' : 'high'
      this.quality = next
      this.qualityAdjustments--
      this.highFpsTime = 0
      const preset = QUALITY_PRESETS[next]
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio))
      this.renderer.shadowMap.enabled = preset.shadows
      this.world?.setShadows(preset.shadows)
      this.world?.setShadowQuality(preset.shadowMapSize)
      this.composer = null
      this.bloomPass = null
      this.setupComposer()
      this.handleResize()
      this.emitter.emit('toast', { id: this.toastId++, text: `Graphics restored to ${next}`, tone: 'info' })
    }
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.resizeObserver?.disconnect()
    this.input.dispose()
    this.audio.dispose()
    this.disposeZone()
    this.effects.dispose()
    this.projectiles.dispose()
    this.player.dispose()
    this.composer = null
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    this.emitter.clear()
  }
}

export function formatHudScore(value: number): string {
  return formatScore(value)
}
