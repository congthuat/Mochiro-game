// Mochiro — the runner runtime: renderer, endless world, run flow, scoring.
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import { Emitter, clamp, clamp01, damp, formatScore, makeRng, randRange } from './utils'
import { RushAudio } from './audio'
import { RushInput, type RushAction } from './input'
import { RunnerAvatar } from './player'
import { ModelAvatar, preloadModel } from './model'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  BIOMES,
  CHARACTERS,
  CHARACTER_IDS,
  PURSUIT,
  biomeMix,
  difficulty,
  powerTakesHold,
  rollMissions,
  type CharacterId,
  type DifficultySpec,
  type MissionRoll,
  type PerkId,
} from './config'
import { ObstacleManager, type Obstacle, type ObstacleKind } from './obstacles'
import { PickupManager, type Coin, type PowerUp } from './pickups'
import { Scenery } from './scenery'
import { FlyCoins, ShockRings, SparkSystem, SpeedLines, speedLevel } from './effects'
import { Track } from './track'
import { buildCoinTexture, loadArcBrand, loadArcMark, type ArcMark } from './arc'
import {
  BODY,
  CAMERA,
  LANES,
  PALETTE,
  PHYSICS,
  POWERS,
  POWER_BY_KIND,
  QUALITY_PRESETS,
  RUN,
  gapTimeAt,
  resolveQuality,
  speedAt,
  tierFor,
  type QualityPreset,
} from './config'
import type {
  ArcBrand,
  HudState,
  Phase,
  PickupEvent,
  PowerKind,
  ProgressState,
  ResolvedQuality,
  RunSummary,
  Settings,
  ToastMsg,
} from './types'

const MAX_DT = 0.05

/** Scratch colours for the zone blend — reused every frame instead of allocated. */
const BIOME_A = new THREE.Color()
const BIOME_B = new THREE.Color()
const BIOME_OUT = new THREE.Color()

function blendColor(from: string, to: string, t: number, into: THREE.Color): THREE.Color {
  return into.copy(BIOME_OUT.copy(BIOME_A.set(from)).lerp(BIOME_B.set(to), t))
}

interface RunState {
  elapsed: number
  speed: number
  topSpeed: number
  distance: number
  score: number
  coins: number
  combo: number
  bestCombo: number
  multiplier: number
  shield: number
  magnetUntil: number
  boostUntil: number
  invulnUntil: number
  doubleUntil: number
  ghostUntil: number
  invertUntil: number
  fogUntil: number
  heavyUntil: number
  lane: number
  laneX: number
  laneVelocity: number
  y: number
  vy: number
  onGround: boolean
  sliding: boolean
  /** Height at the start of the current step — see checkObstacles. */
  previousY: number
  slideUntil: number
  slidePending: boolean
  coyote: number
  jumpBuffer: number
  spawnCursor: number
  lineCounter: number
  powerTimer: number
  tierIndex: number
  hits: number
  jumps: number
  slides: number
  powers: number
  nearMisses: number
  /** Coins picked off the road, which is what the coin mission counts. */
  pickedCoins: number
  missionCoins: number
  missions: Array<{ id: MissionRoll['id']; target: number; reward: number; progress: number; done: boolean }>
  heat: number
  busted: boolean
  revived: boolean
}

interface LineTracker {
  total: number
  collected: number
}

type PatternKind =
  | 'single'
  | 'jumpLine'
  | 'double'
  | 'gate'
  | 'slalom'
  | 'gauntlet'
  | 'tunnel'
  | 'traffic'
  | 'rampCar'
  | 'slideGate'

export class Runner {
  readonly events = new Emitter<{
    phase: Phase
    hud: HudState
    toast: ToastMsg
    progress: ProgressState
    damage: { shield: boolean; hits: number }
    result: RunSummary
    power: PowerKind
    brand: ArcBrand
    pauseKey: undefined,
    pickup: PickupEvent
    action: RushAction
  }>()

  /** Shop upgrade levels (0–5) per helpful power; each level stretches it by `upgradeStep`. */
  private upgrades: Partial<Record<PowerKind, number>> = {}
  private upgradeStep = 0.15

  private container: HTMLElement
  private settings: Settings
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private frozen = false
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer | null = null
  private bloom: UnrealBloomPass | null = null
  private renderPass: RenderPass | null = null
  private outputPass: OutputPass | null = null

  private track: Track
  private scenery: Scenery | null = null
  private obstacles: ObstacleManager
  private pickups: PickupManager | null = null
  private sparks: SparkSystem
  private speedLines: SpeedLines
  private avatar: RunnerAvatar | ModelAvatar
  private character: CharacterId
  private input: RushInput
  private audio = new RushAudio()

  private brand: ArcBrand | null = null
  private quality: ResolvedQuality = 'medium'
  private preset: QualityPreset = QUALITY_PRESETS.medium

  private phase: Phase = 'boot'
  private rafId: number | null = null
  private lastTime = 0
  private clockTime = 0
  private hudTimer = 0
  private fpsSamples: number[] = []
  private fps = 60
  private lowFpsTime = 0
  private highFpsTime = 0
  private adaptiveCooldown = 0
  private shake = 0
  private cameraShakeOffset = new THREE.Vector3()
  private cameraPos = new THREE.Vector3()
  private cameraLook = new THREE.Vector3()
  private menuOrbit = 0
  private rng: () => number = makeRng(Math.floor(Math.random() * 0xffffffff))
  private toastId = 1
  private disposed = false
  private gameOverAt = 0
  private bestScore = 0
  private spawnFrozen = false
  private portrait = false
  private coinShowcase: THREE.Mesh | null = null
  private powerShowcase: THREE.Group | null = null
  private rings: ShockRings | null = null
  private flyCoins: FlyCoins | null = null
  private hitStop = 0
  private camKick = 0
  private pickupId = 1
  private hudAnchor = new THREE.Vector3()
  private camFwd = new THREE.Vector3()
  private camRight = new THREE.Vector3()
  private camUp = new THREE.Vector3()
  private studio = false
  private stashedComposer: EffectComposer | null = null

  private run: RunState = this.freshRun()
  private lineTrackers = new Map<number, LineTracker>()
  private target = new THREE.Vector3()

  constructor(container: HTMLElement, settings: Settings, bestScore = 0) {
    this.container = container
    this.settings = settings
    this.bestScore = bestScore
    this.rng = makeRng(Math.floor(Math.random() * 0xffffffff))

    this.quality = resolveQuality(settings.quality, 60)
    this.preset = QUALITY_PRESETS[this.quality]

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.preset.antialias,
      powerPreference: 'high-performance',
      alpha: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio))
    this.renderer.setSize(container.clientWidth || 1280, container.clientHeight || 720, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.92
    this.renderer.shadowMap.enabled = this.preset.shadows
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      (container.clientWidth || 1280) / (container.clientHeight || 720),
      0.1,
      900
    )
    this.camera.position.set(0, RUN.camHeight, RUN.camDistance)

    this.scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog).getHex(), this.preset.fogNear, this.preset.fogFar)
    this.scene.background = new THREE.Color(PALETTE.skyMid)

    this.character = settings.character ?? 'kai'
    this.avatar = new RunnerAvatar(CHARACTERS[this.character])
    this.setupLights()
    this.buildComposer()

    this.track = new Track(this.preset, 20261110)
    this.scene.add(this.track.group)
    this.obstacles = new ObstacleManager(this.preset)
    this.scene.add(this.obstacles.group)
    this.sparks = new SparkSystem(this.preset.particles)
    this.scene.add(this.sparks.points)
    this.rings = new ShockRings(12)
    this.scene.add(this.rings.group)
    this.speedLines = new SpeedLines(this.preset.speedLines)
    this.scene.add(this.speedLines.mesh)
    this.scene.add(this.avatar.root)
    this.avatar.root.position.set(LANES[1], 0, 0)

    this.input = new RushInput(container)
    // Escape / P are forwarded to the shell, which owns panel + pause state.
    this.input.onPause(() => this.events.emit('pauseKey', undefined))
    // The first-run coach listens for the moves it asks for.
    this.input.onAction((action) => this.events.emit('action', action))

    window.addEventListener('resize', this.onResize)
  }

  // ------------------------------------------------------------------ setup --
  private sunLight!: THREE.DirectionalLight

  private hemiLight!: THREE.HemisphereLight

  private fillLight!: THREE.DirectionalLight

  /** The zone the run is currently in, for the HUD chip and the snapshot. */
  private biomeNow = BIOMES[0].name


  /** The project mark, set once the artwork has loaded. */
  private arcMark: ArcMark | null = null

  /** Difficulty for the run in progress — see DIFFICULTIES in config.ts. */
  private diff: DifficultySpec = difficulty('normal')

  /** Missions are rolled at the start of a run; `run.missions` holds the progress. */
  private missionRolls: MissionRoll[] = []

  private envDispose: (() => void) | null = null

  private setupLights(): void {
    // Bright midday rig: warm sun + sky/ground bounce.
    const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x9fd08a, 0.45)
    this.scene.add(hemi)
    this.hemiLight = hemi

    // Image-based lighting so PBR assets (the rigged character, glTF materials)
    // pick up ambient colour instead of reading flat and dark in the sun.
    if (this.preset.environment) {
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      this.scene.environment = envTexture
      this.scene.environmentIntensity = 0.3
      this.envDispose = () => envTexture.dispose()
      pmrem.dispose()
    }

    const sun = new THREE.DirectionalLight(0xfff3d6, 1.0)
    sun.position.set(14, 26, 12)
    sun.castShadow = this.preset.shadows
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 90
    sun.shadow.camera.left = -18
    sun.shadow.camera.right = 18
    sun.shadow.camera.top = 22
    sun.shadow.camera.bottom = -14
    sun.shadow.bias = -0.0012
    sun.shadow.normalBias = 0.03
    this.scene.add(sun)
    this.scene.add(sun.target)
    this.sunLight = sun

    // Cool bounce from the front so faces are never fully shadowed.
    const fill = new THREE.DirectionalLight(0xdcf0ff, 0.38)
    fill.position.set(-10, 8, -14)
    this.scene.add(fill)
    this.fillLight = fill
  }

  /** Keeps the shadow volume centred on the runner. */
  private updateSun(): void {
    if (this.portrait) return
    const x = this.avatar.root.position.x
    const z = this.avatar.root.position.z
    this.sunLight.position.set(x + 14, 26, z + 12)
    this.sunLight.target.position.set(x, 0, z - 6)
    this.sunLight.target.updateMatrixWorld()
  }

  /** Dev-only: bypass post-processing to check the raw render. */
  debugNoFx(on: boolean): void {
    if (on) {
      this.stashedComposer = this.composer
      this.composer = null
    } else if (this.stashedComposer) {
      this.composer = this.stashedComposer
      this.stashedComposer = null
    }
  }

  /** Dev-only: renderer statistics — proves whether geometry is drawn. */
  debugStats(): Record<string, unknown> {
    const info = this.renderer.info
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      sceneChildren: this.scene.children.length,
      avatarInScene: this.scene.children.includes(this.avatar.root),
      avatarParent: this.avatar.root.parent?.type ?? null,
      avatarWorld: this.avatar.root.position.toArray().map((v) => +v.toFixed(2)),
      camera: this.camera.position.toArray().map((v) => +v.toFixed(2)),
      portrait: this.portrait,
      studio: this.studio,
    }
  }

  /** Dev-only: where the rig's attachment bones actually sit, in world metres. */
  debugBones(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const point = new THREE.Vector3()
    this.avatar.root.traverse((object) => {
      const name = object.name.replace(/[\[\].:/]/g, '').toLowerCase()
      if (!['chest', 'spine', 'hips', 'head', 'neck', 'handl', 'handsl otl'].includes(name)) return
      object.getWorldPosition(point)
      out[object.name] = [+point.x.toFixed(2), +point.y.toFixed(2), +point.z.toFixed(2)]
    })
    return out
  }

  /** Dev-only: hold the simulation still for pixel-accurate screenshots. */
  debugFreezeFrame(frozen: boolean): void {
    this.frozen = frozen
  }

  /**
   * Dev-only: how much of the head is actually painted over by the carried kit.
   * Renders the same frame three times into an offscreen buffer — everything, then
   * with the head hidden, then with the kit hidden — and intersects the two
   * silhouettes. Deterministic, unlike diffing screenshots.
   */
  debugOverlap(): Record<string, unknown> {
    if (!(this.avatar instanceof ModelAvatar)) return { ok: false }
    const width = 480
    const height = 320
    const target = new THREE.WebGLRenderTarget(width, height)
    const pixel = new Uint8Array(width * height * 4)
    const read = (): Uint8Array => {
      this.renderer.setRenderTarget(target)
      this.renderer.render(this.scene, this.camera)
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixel)
      this.renderer.setRenderTarget(null)
      return pixel.slice()
    }
    const shadows = this.renderer.shadowMap.enabled
    // Shadows would change the whole frame the moment a mesh is hidden.
    this.renderer.shadowMap.enabled = false
    const all = read()
    this.avatar.maskNodes('head', true)
    const noHead = read()
    this.avatar.maskNodes('head', false)
    this.avatar.maskNodes('gear', true)
    this.avatar.maskNodes('weapons', true)
    const noKit = read()
    this.avatar.maskNodes('gear', false)
    this.avatar.maskNodes('weapons', false)
    this.renderer.shadowMap.enabled = shadows
    target.dispose()

    let head = 0
    let kit = 0
    let both = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    for (let i = 0; i < width * height; i += 1) {
      const p = i * 4
      const dHead = Math.abs(all[p] - noHead[p]) + Math.abs(all[p + 1] - noHead[p + 1]) + Math.abs(all[p + 2] - noHead[p + 2])
      const dKit = Math.abs(all[p] - noKit[p]) + Math.abs(all[p + 1] - noKit[p + 1]) + Math.abs(all[p + 2] - noKit[p + 2])
      const isHead = dHead > 30
      const isKit = dKit > 30
      if (isHead) {
        head += 1
        const x = i % width
        const y = Math.floor(i / width)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      if (isKit) kit += 1
      if (isHead && isKit) both += 1
    }
    return {
      ok: true,
      headPixels: head,
      kitPixels: kit,
      covered: both,
      ratio: head ? +(both / head).toFixed(3) : 0,
      headBox: head ? [minX, minY, maxX, maxY] : null,
      viewport: [width, height],
    }
  }

  /** Dev-only: hide a class of nodes for silhouette measurement. */
  debugMask(part: string, hidden: boolean): string[] {
    return this.avatar instanceof ModelAvatar ? this.avatar.maskNodes(part, hidden) : []
  }

  /**
   * Dev-only: how much of the head is hidden behind the carried kit, as seen from
   * the gameplay camera. Anything above zero means kit is drawn over the face or
   * the back of the head.
   */
  debugCarry(): Record<string, unknown> {
    const probe = this.avatar instanceof ModelAvatar ? this.avatar.carryProbe() : null
    if (!probe) return { ok: false, gear: [] }
    const camera = this.camera
    camera.updateMatrixWorld()
    // The head *mesh* box also covers the hood's drape and the collar, which would
    // flag kit that legitimately sits on the shoulders. Measure against the head
    // bone instead, with the radius taken from the skull above it.
    const headSize = probe.head.getSize(new THREE.Vector3())
    const headTop = probe.head.max.y
    const headCentre = probe.headBone.clone()
    const headCam = headCentre.clone().applyMatrix4(camera.matrixWorldInverse)
    const headRadius = Math.max(0.16, (headTop - headCentre.y) * 0.62)
    const floor = headCentre.y - 0.12
    const size = this.renderer.getSize(new THREE.Vector2())
    const toScreen = (point: THREE.Vector3): [number, number] => {
      const ndc = point.clone().project(camera)
      return [Math.round(((ndc.x + 1) / 2) * size.x), Math.round(((1 - ndc.y) / 2) * size.y)]
    }
    const gear = probe.gear.map((item) => {
      let cover = 0
      let nearest = -Infinity
      const corners = boxSamples(item.box)
      for (const point of corners) {
        const cam = point.clone().applyMatrix4(camera.matrixWorldInverse)
        nearest = Math.max(nearest, cam.z)
        // Camera space looks down -z, so a larger z is nearer to the viewer.
        if (cam.z <= headCam.z) continue
        if (point.y < floor) continue
        const gap = Math.hypot(cam.x - headCam.x, cam.y - headCam.y)
        if (gap < headRadius) cover = Math.max(cover, 1 - gap / headRadius)
      }
      const size = item.box.getSize(new THREE.Vector3())
      return {
        name: item.name,
        cover: +cover.toFixed(2),
        nearer: +(nearest - headCam.z).toFixed(2),
        size: +Math.max(size.x, size.y, size.z).toFixed(2),
        px: toScreen(item.box.getCenter(new THREE.Vector3())),
      }
    })
    return {
      ok: true,
      head: [
        +headCentre.x.toFixed(2),
        +headCentre.y.toFixed(2),
        +headCentre.z.toFixed(2),
      ],
      headTop: +headTop.toFixed(2),
      headPx: toScreen(headCentre),
      viewport: [size.x, size.y],
      headRadius: +headRadius.toFixed(2),
      headSize: [+headSize.x.toFixed(2), +headSize.y.toFixed(2), +headSize.z.toFixed(2)],
      headDepth: +headCam.z.toFixed(2),
      gear,
      worst: +Math.max(0, ...gear.map((g) => g.cover)).toFixed(2),
    }
  }

  /** Dev-only: set the shield count directly (perk-proof crash tests). */
  debugSetShield(count: number): void {
    this.run.shield = Math.max(0, Math.min(RUN.maxShields, count))
    this.avatar.setShieldLevel(this.run.shield)
  }

  /** Dev-only: which weapon meshes on the rig are switched on. */
  debugWeapons(): Record<string, boolean> {
    const out: Record<string, boolean> = {}
    this.avatar.root.traverse((object) => {
      if (!/knife|sword|crossbow|dagger|axe|staff|wand|shield|^gear:/i.test(object.name)) return
      out[object.name] = object.visible
    })
    return out
  }

  /** Dev-only: world bounds of any gear parented to the rig (bow, quiver). */
  debugGear(): Record<string, unknown>[] {
    const found: Record<string, unknown>[] = []
    const box = new THREE.Box3()
    this.avatar.root.traverse((object) => {
      if (!object.name.startsWith('gear:')) return
      box.setFromObject(object)
      const size = new THREE.Vector3()
      const centre = new THREE.Vector3()
      box.getSize(size)
      box.getCenter(centre)
      const quat = new THREE.Quaternion()
      object.getWorldQuaternion(quat)
      const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ')
      const parentQuat = new THREE.Quaternion()
      object.parent?.getWorldQuaternion(parentQuat)
      const parentEuler = new THREE.Euler().setFromQuaternion(parentQuat, 'XYZ')
      const degrees = (e: THREE.Euler) => [e.x, e.y, e.z].map((v) => Math.round((v * 180) / Math.PI))
      found.push({
        name: object.name,
        size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)],
        centre: [+centre.x.toFixed(2), +centre.y.toFixed(2), +centre.z.toFixed(2)],
        localEuler: degrees(object.rotation),
        worldEuler: degrees(euler),
        holderEuler: degrees(parentEuler),
      })
    })
    return found
  }

  /** Dev-only: dump every part of the avatar rig with world positions. */
  debugParts(): Record<string, unknown> {
    const parts: Record<string, unknown>[] = []
    const box = new THREE.Box3()
    const size = new THREE.Vector3()
    this.avatar.root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      box.setFromObject(mesh)
      box.getSize(size)
      const world = new THREE.Vector3()
      mesh.getWorldPosition(world)
      parts.push({
        geo: (mesh.geometry as THREE.BufferGeometry)?.type,
        visible: mesh.visible,
        world: world.toArray().map((v) => +v.toFixed(2)),
        size: [size.x, size.y, size.z].map((v) => +v.toFixed(2)),
        colour: (mesh.material as THREE.MeshStandardMaterial)?.color?.getHexString?.() ?? '?',
      })
    })
    return { count: parts.length, parts: parts.slice(0, 40) }
  }

  /** Dev-only: isolate the runner model on a plain backdrop for inspection. */
  debugStudio(on: boolean): void {
    this.studio = on
    if (this.scenery) this.scenery.group.visible = !on
    this.track.group.visible = !on
    this.obstacles.group.visible = !on
    if (this.pickups) this.pickups.group.visible = !on
    this.speedLines.mesh.visible = !on && this.preset.speedLines > 0
    this.sparks.points.visible = !on
    this.scene.background = new THREE.Color(on ? 0xeef4fb : PALETTE.skyMid)
    this.debugPortrait(on)
  }

  /** Dev-only: where is the avatar on screen right now? */
  debugProbe(): Record<string, unknown> {
    const box = new THREE.Box3().setFromObject(this.avatar.root)
    const size = new THREE.Vector3()
    box.getSize(size)
    const corners: THREE.Vector3[] = []
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z))
      }
    }
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const corner of corners) {
      const projected = corner.clone().project(this.camera)
      const sx = (projected.x * 0.5 + 0.5) * this.container.clientWidth
      const sy = (-projected.y * 0.5 + 0.5) * this.container.clientHeight
      x0 = Math.min(x0, sx)
      y0 = Math.min(y0, sy)
      x1 = Math.max(x1, sx)
      y1 = Math.max(y1, sy)
    }
    return {
      box: { x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) },
      size: { x: +size.x.toFixed(2), y: +size.y.toFixed(2), z: +size.z.toFixed(2) },
      rootY: +this.avatar.root.position.y.toFixed(2),
      visible: this.avatar.root.visible,
      camera: this.camera.position.toArray().map((v) => +v.toFixed(2)),
      viewport: [this.container.clientWidth, this.container.clientHeight],
    }
  }

  /** Dev-only: park the camera in front of the runner to inspect the model. */
  debugPortrait(on: boolean): void {
    this.portrait = on
    if (!on) return
    this.avatar.root.position.set(0, 0, 0)
    this.avatar.root.rotation.set(0, 0, 0)
    this.camera.fov = 40
    this.camera.updateProjectionMatrix()
    // The runner travels down -z, so the inspection camera stands in front of it.
    this.camera.position.set(1.55, 1.32, -2.95)
    this.camera.lookAt(0, 0.9, 0)
    // Light the model from the inspection camera's side.
    this.sunLight.position.set(3.4, 6.2, -9)
    this.sunLight.target.position.set(0, 0.9, 0)
    this.sunLight.target.updateMatrixWorld()
  }

  /** Dev-only: park the camera on the street so the town can be inspected. */
  debugStreet(on: boolean): void {
    if (!on) {
      this.debugPortrait(false)
      return
    }
    this.portrait = true
    this.camera.fov = 48
    this.camera.updateProjectionMatrix()
    this.camera.position.set(-1.6, 3.6, 7.5)
    this.camera.lookAt(14, 3.4, -14)
    this.sunLight.position.set(-8, 12, 14)
    this.sunLight.target.position.set(14, 3, -14)
    this.sunLight.target.updateMatrixWorld()
  }

  /** Dev-only: toggle the runner's hair. */
  debugHair(on: boolean): void {
    this.avatar.debugHair(on)
  }

  /** Dev-only: re-point a rigged model to verify which way it faces. */
  debugFacing(radians: number): void {
    if (this.avatar instanceof ModelAvatar) this.avatar.debugFacing(radians)
  }

  /** Swap the runner model (menu character picker). */
  setCharacter(id: CharacterId): void {
    if (id === this.character) return
    this.character = id
    this.swapAvatar(new RunnerAvatar(CHARACTERS[id]))
    void this.loadCharacterModel()
  }

  /** Replaces the current runner, keeping its place in the world. */
  private swapAvatar(next: RunnerAvatar | ModelAvatar): void {
    const position = this.avatar.root.position.clone()
    const rotation = this.avatar.root.rotation.clone()
    const visible = this.avatar.root.visible
    this.scene.remove(this.avatar.root)
    this.avatar.dispose()
    this.avatar = next
    next.root.position.copy(position)
    next.root.rotation.copy(rotation)
    next.root.visible = visible
    this.scene.add(next.root)
  }

  /** Loads the rigged character; silently keeps the procedural rig on failure. */
  private async loadCharacterModel(): Promise<void> {
    const spec = CHARACTERS[this.character]
    if (!spec.model) return
    const model = new ModelAvatar({
      url: spec.model,
      height: spec.modelHeight,
      facing: spec.modelFacing,
      recolor: spec.recolor,
      gear: spec.gear,
      hideNodes: spec.hideNodes,
    })
    const ok = await model.ready
    if (this.disposed || !ok) {
      model.dispose()
      return
    }
    if (this.character !== spec.id) {
      model.dispose()
      return
    }
    this.swapAvatar(model)
  }

  private buildComposer(): void {
    this.composer?.dispose()
    this.composer = null
    this.bloom = null
    this.renderPass = null
    this.outputPass = null
    if (!this.preset.bloom) return
    const size = new THREE.Vector2()
    this.renderer.getSize(size)
    const composer = new EffectComposer(this.renderer)
    const renderPass = new RenderPass(this.scene, this.camera)
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, size.x), Math.max(1, size.y)),
      this.preset.bloomStrength,
      0.6,
      1.15
    )
    const output = new OutputPass()
    composer.addPass(renderPass)
    composer.addPass(bloom)
    composer.addPass(output)
    this.composer = composer
    this.renderPass = renderPass
    this.bloom = bloom
    this.outputPass = output
  }

  async boot(): Promise<void> {
    this.emitProgress(0.12, 'Contacting the Arc network')
    const brand = await loadArcBrand()
    if (this.disposed) return
    this.brand = brand
    this.events.emit('brand', brand)

    this.emitProgress(0.45, 'Minting coin art')
    const mark = await loadArcMark(brand)
    if (this.disposed) return
    this.arcMark = mark
    const coinTexture = await buildCoinTexture(brand, mark)
    if (this.disposed) return

    this.emitProgress(0.7, 'Building the skyline')
    this.pickups = new PickupManager(this.preset, coinTexture)
    this.scene.add(this.pickups.group)
    this.flyCoins = new FlyCoins(this.pickups.faceTexture, 30)
    this.scene.add(this.flyCoins.group)
    this.scenery = new Scenery(this.preset, brand, mark, 90210)
    this.scene.add(this.scenery.group)

    this.emitProgress(0.86, 'Suiting up the runner')
    await this.loadCharacterModel()
    if (this.disposed) return

    this.emitProgress(0.95, 'Warming the engines')
    this.audio.setVolumes(this.settings.master, this.settings.music, this.settings.sfx)

    this.setPhase('menu')
    // Warm the other hero's rig in the background so the picker is instant.
    const other = CHARACTERS[CHARACTER_IDS.find((id) => id !== this.character) ?? 'kai']
    if (other.model) void preloadModel(other.model)
    this.emitHud(true)
    this.lastTime = performance.now()
    this.loop()
  }

  // ----------------------------------------------------------------- perks --
  /** Multiplier for the active hero's perk, or `fallback` for a different perk. */
  private perkScale(id: PerkId, fallback = 1): number {
    const perk = CHARACTERS[this.character]?.perk
    return perk && perk.id === id ? perk.value : fallback
  }

  private get laneScale(): number {
    return this.perkScale('quickLane')
  }

  /** Applies the levels bought in the shop; takes effect from the next pickup. */
  setUpgrades(levels: Partial<Record<PowerKind, number>>, step = 0.15): void {
    this.upgrades = { ...levels }
    this.upgradeStep = step
  }

  private upgradeScale(kind: PowerKind): number {
    const level = Math.max(0, Math.min(5, Math.floor(this.upgrades[kind] ?? 0)))
    return 1 + level * this.upgradeStep
  }

  private get powerScale(): number {
    return this.perkScale('longPower')
  }

  /** Magnet reach, widened by the archer's perk. */
  private get magnetReach(): number {
    return RUN.magnetRadius * this.perkScale('wideMagnet')
  }

  /** The duelist's rush: Overdrive is the one power they make their own. */
  private get boostScale(): number {
    return this.perkScale('longBoost')
  }

  // ------------------------------------------------------------------ flow --
  startRun(): void {
    this.run = this.freshRun()
    this.diff = difficulty(this.settings.difficulty)
    this.missionRolls = rollMissions(() => Math.random())
    this.run.missions = this.missionRolls.map((roll) => ({
      id: roll.id,
      target: roll.target,
      reward: roll.reward,
      progress: 0,
      done: false,
    }))
    // Sam's perk: the knight walks in with a shield already up.
    this.run.shield = this.perkScale('shieldStart', 0)
    if (this.run.shield > 0) this.avatar.setShieldLevel(this.run.shield)
    this.lineTrackers.clear()
    this.rng = makeRng(Math.floor(Math.random() * 0xffffffff))
    this.obstacles.reset()
    this.pickups?.reset()
    this.avatar.root.visible = true
    this.avatar.root.position.set(LANES[1], 0, 0)
    this.avatar.root.rotation.set(0, 0, 0)
    this.avatar.setShieldLevel(0)
    this.shake = 0
    void this.audio.unlock().then(() => {
      this.audio.setVolumes(this.settings.master, this.settings.music, this.settings.sfx)
      this.audio.setIntensity(0)
      this.audio.startMusic()
      this.audio.play('start')
    })
    this.toast('GO!', 'good')
    this.setPhase('playing')
    this.emitHud(true)
  }

  pause(): void {
    if (this.phase !== 'playing') return
    this.setPhase('paused')
    this.audio.setIntensity(0)
  }

  resume(): void {
    if (this.phase !== 'paused') return
    this.setPhase('playing')
    this.lastTime = performance.now()
    void this.audio.unlock()
  }

  restartRun(): void {
    this.startRun()
  }

  quitToMenu(): void {
    this.obstacles.reset()
    this.pickups?.reset()
    this.avatar.root.visible = true
    this.avatar.root.rotation.set(0, 0, 0)
    this.setPhase('menu')
    this.audio.setIntensity(0)
    this.emitHud(true)
  }

  applySettings(settings: Settings): void {
    this.settings = settings
    this.setCharacter(settings.character ?? 'kai')
    this.audio.setVolumes(settings.master, settings.music, settings.sfx)
    this.setQuality(resolveQuality(settings.quality, settings.quality === 'auto' ? this.fps : 60))
  }

  setBestScore(value: number): void {
    this.bestScore = value
    this.emitHud(true)
  }

  /** Direct action trigger from the on-screen touch buttons. */
  pressAction(action: RushAction): void {
    this.input.press(action)
  }

  /** Plays a UI blip (buttons call this so audio unlocks on first interaction). */
  uiSound(kind: 'click' | 'hover'): void {
    void this.audio.unlock().then(() => this.audio.play(kind === 'click' ? 'uiClick' : 'uiHover'))
  }

  dispose(): void {
    this.disposed = true
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.envDispose?.()
    window.removeEventListener('resize', this.onResize)
    this.input.dispose()
    this.audio.dispose()
    this.track.dispose()
    this.scenery?.dispose()
    this.obstacles.dispose()
    this.pickups?.dispose()
    this.sparks.dispose()
    this.rings?.dispose()
    this.flyCoins?.dispose()
    this.speedLines.dispose()
    this.avatar.dispose()
    this.composer?.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    this.events.clear()
  }

  // ------------------------------------------------------------------ loop --
  private loop = (): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.loop)
    const now = performance.now()
    let dt = (now - this.lastTime) / 1000
    this.lastTime = now
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60
    dt = Math.min(MAX_DT, dt)
    this.clockTime += dt

    this.measureFps(dt)

    // Dev-only: hold the frame still so screenshot diffs measure silhouettes and
    // not motion.
    if (this.frozen) {
      this.render()
      return
    }

    if (this.phase === 'playing') this.updatePlaying(dt)
    else if (this.phase === 'menu') this.updateMenu(dt)
    else if (this.phase === 'gameover') this.updateCrash(dt)

    this.render()
  }

  private render(): void {
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  private measureFps(dt: number): void {
    if (dt <= 0) return
    this.fpsSamples.push(1 / dt)
    if (this.fpsSamples.length > 45) this.fpsSamples.shift()
    if (this.fpsSamples.length < 20) return
    const average = this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length
    this.fps = this.fps
      ? this.fps + (average - this.fps) * 0.1
      : average
    if (this.settings.quality !== 'auto' || this.adaptiveCooldown > 0) {
      this.adaptiveCooldown = Math.max(0, this.adaptiveCooldown - dt)
      return
    }
    if (this.fps < 40) {
      this.lowFpsTime += dt
      this.highFpsTime = 0
    } else if (this.fps > 57) {
      this.highFpsTime += dt
      this.lowFpsTime = 0
    } else {
      this.lowFpsTime = Math.max(0, this.lowFpsTime - dt * 0.5)
      this.highFpsTime = Math.max(0, this.highFpsTime - dt * 0.5)
    }
    if (this.lowFpsTime > 2.5 && this.quality !== 'low') {
      this.setQuality(this.quality === 'high' ? 'medium' : 'low')
      this.lowFpsTime = 0
      this.adaptiveCooldown = 6
      this.toast('Graphics quality lowered to keep the pace', 'warn')
    } else if (this.highFpsTime > 6 && this.quality !== 'high') {
      this.setQuality(this.quality === 'low' ? 'medium' : 'high')
      this.highFpsTime = 0
      this.adaptiveCooldown = 8
    }
  }

  private setQuality(quality: ResolvedQuality): void {
    if (quality === this.quality) return
    this.quality = quality
    this.preset = QUALITY_PRESETS[quality]
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio))
    this.scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog).getHex(), this.preset.fogNear, this.preset.fogFar)
    this.buildComposer()
    this.track.setQuality(this.preset)
    this.scenery?.setQuality(this.preset)
    this.obstacles.setQuality(this.preset)
    this.pickups?.setQuality(this.preset)
    this.sparks.setSize(quality === 'high' ? 0.36 : 0.3)
    this.renderer.shadowMap.enabled = this.preset.shadows
    this.sunLight.castShadow = this.preset.shadows
    // Toggling shadow maps requires materials to recompile.
    this.scene.traverse((object) => {
      const material = (object as THREE.Mesh).material
      if (Array.isArray(material)) material.forEach((item) => (item.needsUpdate = true))
      else if (material) material.needsUpdate = true
    })
    this.speedLines.mesh.visible = this.preset.speedLines > 0
    this.onResize()
  }

  private onResize = (): void => {
    const width = this.container.clientWidth || 1280
    const height = this.container.clientHeight || 720
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.composer?.setSize(width, height)
    this.bloom?.setSize(width, height)
  }

  // ------------------------------------------------------------------ menu --
  private updateMenu(dt: number): void {
    this.menuOrbit += dt * 0.16
    this.run.speed = 9
    this.track.update(dt, 9, this.clockTime)
    this.scenery?.update(dt, 9, this.clockTime)
    this.pickups?.update(dt, 9, this.clockTime, false, this.target)
    this.sparks.update(dt, 9 * dt)
    this.updatePickupFx(dt, 9 * dt)
    this.speedLines.update(dt, 9, 0)

    this.avatar.root.position.set(LANES[1], 0, 0)
    this.avatar.update(dt, {
      speed01: 0.25,
      onGround: true,
      sliding: false,
      boosting: false,
      laneVelocity: 0,
      time: this.clockTime,
      mode: 'menu',
    })

    const radius = 7.4
    const angle = this.menuOrbit
    this.camera.position.set(Math.sin(angle) * radius, 3.4 + Math.sin(angle * 0.6) * 0.7, Math.cos(angle) * radius + 1.4)
    this.camera.lookAt(0, 1.25, 0)
    this.camera.fov = CAMERA.fov
    this.camera.updateProjectionMatrix()
    this.audio.setIntensity(0)
  }

  // --------------------------------------------------------------- gameplay --
  private updatePlaying(dt: number): void {
    const run = this.run
    run.elapsed += dt

    // Speed ramp (boost adds a multiplier on top).
    const boosting = run.boostUntil > run.elapsed
    const baseSpeed = speedAt(run.elapsed) * this.diff.speed
    run.speed = baseSpeed * (boosting ? RUN.boostSpeedMult : 1)
    run.topSpeed = Math.max(run.topSpeed, run.speed)
    // Hit-stop: a power-up freezes the world for a beat so the impact lands,
    // while the FX and camera keep running at full speed.
    const realDt = dt
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - realDt)
      dt *= 0.12
    }

    run.distance += run.speed * dt
    run.score += run.speed * dt * RUN.distancePoints * run.multiplier

    this.audio.setIntensity(speedLevel(baseSpeed))

    // Tier call-outs.
    const tier = tierFor(baseSpeed)
    const tierIndex = tier.at
    if (tierIndex > run.tierIndex) {
      run.tierIndex = tierIndex
      this.toast(`${tier.name} — ${Math.round(baseSpeed * 3.6)} km/h`, 'info')
    }

    // The collision sweep needs the height the runner had when the step began. At
    // full speed one frame covers more ground than a small obstacle is deep, so an
    // obstacle can cross the runner between two frames, and it has to be judged by
    // the height they had during that crossing rather than the one they have a step
    // further down the road.
    run.previousY = run.y
    this.applyBiome(run.distance)
    this.updatePursuit(dt)
    this.updateMissions()
    this.applyInput(dt, boosting)
    this.updatePhysics(dt)
    this.spawnIfNeeded(dt)

    const dz = run.speed * dt
    this.target.set(run.laneX, run.y, 0)
    this.track.update(dt, run.speed, this.clockTime)
    this.scenery?.update(dt, run.speed, this.clockTime)
    this.obstacles.update(dt, run.speed)
    if (this.pickups) this.pickups.magnetRadius = this.magnetReach
    this.pickups?.update(dt, run.speed, this.clockTime, run.magnetUntil > run.elapsed, this.target)
    this.sparks.update(realDt, dz)
    this.updatePickupFx(realDt, dz)
    // Streaks follow the *actual* speed, so overdrive pushes them to full tilt.
    this.speedLines.update(dt, run.speed, speedLevel(run.speed))

    this.checkCoins(dz)
    this.checkPowers()
    this.checkObstacles(dz)

    if (run.ghostUntil > run.elapsed) {
      this.sparks.burst(this.avatar.root.position.x, run.y + 0.85, 0.2, {
        count: 2,
        color: new THREE.Color('#6ef0d4').getHex(),
        speed: 1.1,
        life: 0.42,
        gravity: 0,
        rise: 0.7,
      })
    }
    if (boosting) {
      this.sparks.burst(
        this.avatar.root.position.x,
        run.y + 0.7,
        this.avatar.root.position.z + 0.4,
        { count: 3, color: new THREE.Color(PALETTE.boost).getHex(), speed: 3, life: 0.35, gravity: 0, rise: 1.2 }
      )
    }

    this.updateAvatar(dt, boosting)
    this.updateCamera(dt, boosting)

    this.avatar.setShieldLevel(run.shield > 0 ? 1 : 0)

    this.hudTimer += dt
    if (this.hudTimer > 0.08) {
      this.hudTimer = 0
      this.emitHud(false)
    }
  }

  /** Drives the shockwave rings and the coins that fly into the HUD counter. */
  private updatePickupFx(dt: number, dz: number): void {
    this.rings?.update(dt, dz, this.camera)
    if (!this.flyCoins) return
    // Bank into the bottom-left corner of the viewport, where the counter sits.
    this.camera.getWorldDirection(this.camFwd)
    this.camRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion)
    this.camUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion)
    this.hudAnchor
      .copy(this.camera.position)
      .addScaledVector(this.camFwd, 1.6)
      .addScaledVector(this.camRight, -0.86)
      .addScaledVector(this.camUp, -0.62)
    this.flyCoins.update(dt, dz, this.camera, this.hudAnchor)
  }

  private applyInput(dt: number, boosting: boolean): void {
    const run = this.run
    // Lane changes keep a long buffer: a dropped frame must never eat a dodge.
    // Jammed controls mirror the steering — the hazard is legible, not random.
    const mirrored = run.invertUntil > run.elapsed
    if (this.input.consume('left', 1200)) this.shiftLane(mirrored ? 1 : -1)
    if (this.input.consume('right', 1200)) this.shiftLane(mirrored ? -1 : 1)

    if (this.input.consume('jump', 900)) run.jumpBuffer = PHYSICS.jumpBuffer
    if (this.input.consume('slide', 1000)) {
      if (run.onGround) this.startSlide()
      else {
        // Dive: fast-fall now, slide on touchdown.
        run.vy = Math.min(run.vy, -6)
        run.slidePending = true
      }
    }

    run.jumpBuffer = Math.max(0, run.jumpBuffer - dt)
    run.coyote = Math.max(0, run.coyote - dt)

    if (run.jumpBuffer > 0 && (run.onGround || run.coyote > 0) && !run.sliding) {
      run.vy = PHYSICS.jumpVelocity * (run.heavyUntil > run.elapsed ? 0.6 : 1)
      run.jumps += 1
      run.onGround = false
      run.coyote = 0
      run.jumpBuffer = 0
      this.audio.play('jump')
      this.sparks.burst(run.laneX, 0.08, 0, {
        count: 8,
        color: new THREE.Color(PALETTE.rail).getHex(),
        speed: 4,
        life: 0.35,
        gravity: 10,
        rise: 1.4,
      })
    }

    void boosting
  }

  private shiftLane(direction: number): void {
    const run = this.run
    const next = clamp(run.lane + direction, 0, LANES.length - 1)
    if (next === run.lane) {
      this.sparks.burst(run.laneX + direction * 0.5, 0.2, 0, {
        count: 5,
        color: new THREE.Color(PALETTE.danger).getHex(),
        speed: 2.5,
        life: 0.3,
        gravity: 8,
      })
      return
    }
    run.lane = next
    this.audio.play('land', 0)
  }

  private startSlide(): void {
    const run = this.run
    const wasSliding = run.sliding
    run.sliding = true
    run.slides += 1
    run.slideUntil = run.elapsed + PHYSICS.slideTime + (wasSliding ? PHYSICS.slideGrace : 0)
    if (wasSliding) return
    this.audio.play('slide')
    this.sparks.burst(run.laneX, 0.12, 0.3, {
      count: 10,
      color: 0x9fd8ff,
      speed: 5,
      life: 0.4,
      gravity: 6,
      spread: 1.4,
    })
  }

  /** Highest walkable surface under the runner: car roofs and ramp decks. */
  private groundHeight(): number {
    const run = this.run
    let best = 0
    for (const obstacle of this.obstacles.pool) {
      if (!obstacle.active || obstacle.smashing) continue
      const top = obstacle.spec.platformTop
      if (!top) continue
      if (Math.abs(obstacle.z) > obstacle.spec.depth / 2 + 0.5) continue
      if (Math.abs(obstacle.mesh.position.x - run.laneX) > obstacle.spec.width / 2 + BODY.halfWidth * 0.5) continue
      if (top > best) best = top
    }
    return best
  }

  private updatePhysics(dt: number): void {
    const run = this.run
    const ground = this.groundHeight()
    if (!run.onGround) {
      run.vy -= PHYSICS.gravity * dt
      run.y += run.vy * dt
      if (run.y <= ground && run.vy <= 0) {
        run.y = ground
        if (run.vy < -8) {
          this.audio.play('land')
          this.sparks.burst(run.laneX, 0.05, 0, {
            count: 12,
            color: 0xbcd8ff,
            speed: 4.5,
            life: 0.42,
            gravity: 12,
            spread: 1.6,
          })
          this.shake = Math.min(1, this.shake + Math.abs(run.vy) * 0.02)
        }
        run.vy = 0
        run.onGround = true
        if (run.slidePending) {
          run.slidePending = false
          this.startSlide()
        }
      }
    } else if (ground > run.y + 0.12) {
      // A roof rose up under the runner: that is a body hit, not a step up, so
      // leave the height alone and let the obstacle sweep decide.
    } else if (ground < run.y - 0.06) {
      // Ran off the back of a car — drop.
      run.onGround = false
      run.vy = 0
    } else {
      run.y = ground
      run.coyote = PHYSICS.coyoteTime
    }

    if (run.sliding && run.elapsed >= run.slideUntil) run.sliding = false

    // Smooth lane interpolation with a slight overshoot for weight.
    const targetX = LANES[run.lane]
    const previous = run.laneX
    run.laneX = damp(run.laneX, targetX, RUN.laneSwitchRate * this.laneScale, dt)
    run.laneVelocity = (run.laneX - previous) / Math.max(dt, 0.0001)
  }

  private updateAvatar(dt: number, boosting: boolean): void {
    const run = this.run
    if (!this.portrait) this.avatar.root.position.set(run.laneX, run.y, 0)
    this.avatar.update(dt, {
      speed01: speedLevel(run.speed),
      onGround: run.onGround,
      sliding: run.sliding,
      boosting,
      laneVelocity: run.laneVelocity,
      time: this.clockTime,
      mode: 'playing',
    })
  }

  private updateCamera(dt: number, boosting: boolean): void {
    this.updateSun()
    if (this.portrait) return
    const run = this.run
    const targetFov = (boosting ? CAMERA.boostFov : CAMERA.fov) + this.camKick
    this.camKick = Math.max(0, this.camKick - dt * 11)
    this.camera.fov = damp(this.camera.fov, targetFov, CAMERA.fovRate, dt)
    this.camera.updateProjectionMatrix()

    this.cameraPos.set(run.laneX * 0.42, RUN.camHeight + run.y * 0.3, RUN.camDistance)
    this.camera.position.lerp(this.cameraPos, 1 - Math.exp(-9 * dt))

    this.cameraLook.set(run.laneX * 0.22, 1.35 + run.y * 0.42, -8)
    this.camera.lookAt(this.cameraLook)

    // Impact shake.
    if (this.shake > 0.001) {
      const amp = this.settings.shake ? this.shake * 0.32 : 0
      this.cameraShakeOffset.set(
        (Math.random() - 0.5) * amp,
        (Math.random() - 0.5) * amp,
        (Math.random() - 0.5) * amp * 0.6
      )
      this.camera.position.add(this.cameraShakeOffset)
      this.camera.rotation.z += (Math.random() - 0.5) * amp * 0.25
      this.shake = Math.max(0, this.shake - dt * CAMERA.shakeDecay)
    }
  }

  // --------------------------------------------------------------- spawning --
  private spawnIfNeeded(dt: number): void {
    const run = this.run
    if (this.spawnFrozen) return
    run.spawnCursor -= run.speed * dt
    if (run.spawnCursor > 0) return
    const difficulty = clamp01((run.elapsed - 5) / 130)
    const pattern = this.pickPattern(difficulty)
    const length = this.spawnPattern(pattern, -RUN.spawnAhead, difficulty)
    run.spawnCursor = length + run.speed * gapTimeAt(run.elapsed) * this.diff.gaps

    run.powerTimer -= 1
    if (run.powerTimer <= 0) {
      run.powerTimer = Math.round(randRange(this.rng, 5, 9))
      const kind = this.pickPowerKind()
      this.pickups?.spawnPower(kind, Math.floor(this.rng() * LANES.length), -RUN.spawnAhead - length - 6)
    }
  }

  /** Weighted draw from the pickup catalogue; hazards wait for a warm-up. */
  private pickPowerKind(): PowerKind {
    const pool = this.run.elapsed < 22 ? POWERS.filter((spec) => !spec.harmful) : POWERS
    const total = pool.reduce((sum, spec) => sum + spec.weight, 0)
    let roll = this.rng() * total
    for (const spec of pool) {
      roll -= spec.weight
      if (roll <= 0) return spec.kind
    }
    return 'shield'
  }

  private pickPattern(difficulty: number): PatternKind {
    const roll = this.rng()
    if (difficulty < 0.12) return roll < 0.7 ? 'single' : 'jumpLine'
    if (difficulty < 0.3) {
      if (roll < 0.3) return 'single'
      if (roll < 0.55) return 'jumpLine'
      if (roll < 0.8) return 'double'
      return 'gate'
    }
    if (roll < 0.16) return 'single'
    if (roll < 0.32) return 'jumpLine'
    if (roll < 0.5) return 'double'
    if (roll < 0.62) return 'gate'
    if (roll < 0.74) return 'traffic'
    if (roll < 0.84) return 'rampCar'
    if (roll < 0.94) return 'slideGate'
    // Every branch above returns a pattern `spawnPattern` actually implements. The old
    // chain was out of order — `roll < 0.84` sat after `roll < 0.9` — so `slalom` could
    // never be picked and two branches were dead, which quietly made the game repeat
    // itself more than the weights suggest.
    return difficulty > 0.6 ? 'tunnel' : 'gate'
  }

  /** Spawns one pattern at `z` (negative, ahead of the player) and returns its length. */
  private spawnPattern(kind: PatternKind, z: number, difficulty: number): number {
    const lanes = [0, 1, 2]
    const free = () => lanes[Math.floor(this.rng() * lanes.length)]
    const spawn = (type: ObstacleKind, lane: number, at: number) => this.obstacles.spawn(type, lane, at)
    const line = (lane: number, at: number, count: number, style: 'flat' | 'arc' | 'wave' | 'roof') => {
      const id = this.run.lineCounter++
      this.lineTrackers.set(id, { total: count, collected: 0 })
      this.pickups?.spawnLine(lane, at, count, style, id)
    }

    switch (kind) {
      case 'single': {
        const lane = free()
        const type: ObstacleKind = this.rng() < 0.62 ? 'low' : 'tall'
        spawn(type, lane, z)
        const safe = lanes.filter((item) => item !== lane)
        const coinLane = safe[Math.floor(this.rng() * safe.length)]
        line(coinLane, z + 1.5, 5, 'flat')
        return 6
      }
      case 'jumpLine': {
        const lane = free()
        spawn('low', lane, z)
        line(lane, z + 2.2, 6, 'arc')
        return 8
      }
      case 'double': {
        const shuffled = [...lanes].sort(() => this.rng() - 0.5)
        const [a, b] = shuffled
        spawn(this.rng() < 0.6 ? 'low' : 'tall', a, z)
        spawn(this.rng() < 0.5 ? 'tall' : 'low', b, z)
        line(shuffled[2], z + 1.4, 5, 'flat')
        return 6
      }
      case 'gate': {
        spawn('tunnel', 1, z)
        line(free(), z + 2.6, 4, 'flat')
        return 6
      }
      case 'slalom': {
        const order = [...lanes].sort(() => this.rng() - 0.5)
        const span = 13
        order.forEach((lane, index) => {
          const at = z - index * (span / 3)
          spawn(index === 1 ? 'low' : 'tall', lane, at)
          line(order[(index + 2) % 3], at + 2.4, 3, 'flat')
        })
        return span + 6
      }
      case 'gauntlet': {
        spawn('tunnel', 1, z)
        const lane = free()
        spawn('low', lane, z - 7)
        const safe = lanes.filter((item) => item !== lane)
        line(safe[0], z + 2.5, 3, 'flat')
        line(lane, z - 4.5, 4, 'arc')
        return 13
      }
      case 'tunnel': {
        spawn('tunnel', 1, z)
        spawn('low', free(), z - 5.5)
        spawn('low', free(), z - 5.5)
        line(1, z + 2.4, 5, 'flat')
        return 12
      }
      case 'traffic': {
        // Two lanes blocked by traffic: hop the car, swerve the bus.
        const order = [...lanes].sort(() => this.rng() - 0.5)
        const [first, second, clear] = order
        spawn(this.rng() < 0.5 ? 'car' : 'bus', first, z)
        spawn(this.rng() < 0.5 ? 'bus' : 'car', second, z - (this.rng() < 0.5 ? 0 : 2.5))
        line(clear, z + 1.6, 5, 'flat')
        return 9
      }
      case 'rampCar': {
        // The signature set piece: hit the ramp, land on the roof, keep running.
        const lane = free()
        spawn('ramp', lane, z)
        spawn('car', lane, z - 6.6)
        line(lane, z - 3.4, 5, 'roof')
        return 12
      }
      case 'slideGate': {
        // Tunnel mouth: slide under the lintel, collect the line inside.
        spawn('tunnel', 1, z)
        line(1, z + 1.8, 4, 'flat')
        if (this.rng() < 0.5) spawn('car', free(), z - 7)
        return 11
      }
      default:
        return 6
    }
    void difficulty
  }

  // ------------------------------------------------------------- collisions --
  private checkCoins(dz: number): void {
    const pickups = this.pickups
    if (!pickups) return
    const run = this.run
    const centerY = run.y + (run.sliding ? 0.5 : 0.85)
    const sweep = Math.min(2.2, dz * 0.5)
    for (const coin of pickups.coins) {
      if (!coin.active) continue
      if (Math.abs(coin.z) > 1.05 + sweep) continue
      if (Math.abs(coin.x - run.laneX) > 1.0) continue
      if (Math.abs(coin.y - centerY) > 1.25) continue
      this.collectCoin(coin)
    }
  }

  private collectCoin(coin: Coin): void {
    const run = this.run
    this.pickups?.take(coin)
    run.coins += 1
    run.pickedCoins += 1
    run.combo += 1
    run.bestCombo = Math.max(run.bestCombo, run.combo)
    const multiplier = Math.min(RUN.maxMultiplier, 1 + Math.floor(run.combo / RUN.comboStep))
    const previousMultiplier = run.multiplier
    const doubled = run.doubleUntil > run.elapsed
    const gained = RUN.coinValue * run.multiplier * (doubled ? 2 : 1)
    run.score += gained
    run.multiplier = multiplier

    // Pickup juice: the coin bursts, a ring punches out, sparks scale with the
    // streak and a ghost coin is banked into the HUD counter.
    const heat = Math.min(1, run.combo / 26)
    this.audio.play('coin', Math.min(14, run.combo % 15))
    this.sparks.burst(coin.x, coin.y, coin.z, {
      count: 7 + Math.round(heat * 9),
      color: new THREE.Color(PALETTE.coinGlow).getHex(),
      speed: 3.4 + heat * 2.6,
      life: 0.42,
      gravity: 4,
      rise: 0.8,
    })
    this.rings?.burst(coin.x, coin.y, coin.z, {
      color: new THREE.Color(PALETTE.coinGlow).getHex(),
      radius: 0.8 + heat * 0.55,
      life: 0.34 + heat * 0.08,
    })
    this.flyCoins?.pop(coin.x, coin.y, coin.z, 0.46 + heat * 0.14)
    this.camKick = Math.min(1.1, this.camKick + 0.32)
    this.events.emit('pickup', {
      id: this.pickupId++,
      kind: 'coin',
      amount: gained,
      combo: run.combo,
      multiplier,
      warded: false,
      multiplierUp: multiplier > previousMultiplier,
      power: null,
      harmful: false,
    })

    const tracker = this.lineTrackers.get(coin.line)
    if (tracker) {
      tracker.collected += 1
      if (tracker.collected >= tracker.total) {
        run.score += RUN.perfectLineBonus * run.multiplier
        this.lineTrackers.delete(coin.line)
        this.toast(`Perfect line +${formatScore(RUN.perfectLineBonus * run.multiplier)}`, 'good')
        this.audio.play('power')
      }
    }
  }

  private checkPowers(): void {
    const pickups = this.pickups
    if (!pickups) return
    const run = this.run
    for (const power of pickups.powers) {
      if (!power.active) continue
      if (Math.abs(power.z) > 1.35) continue
      if (Math.abs(power.x - run.laneX) > 1.2) continue
      if (Math.abs(power.y - (run.y + 0.9)) > 1.5) continue
      run.powers += 1
      this.takePower(power)
    }
  }

  private takePower(power: PowerUp): void {
    const run = this.run
    const spec = POWER_BY_KIND[power.kind]
    // Teddyz's perk. The hazard is still collected and still flashes, it just never
    // takes hold — and because the ward is decided here, before the effect, nothing
    // can leak in through a branch added to `applyPower` later.
    const warded = !powerTakesHold(CHARACTERS[this.character]?.perk, spec.harmful)
    this.pickups?.takePower(power)
    this.audio.play(warded ? 'shield' : 'power')
    this.events.emit('power', power.kind)
    const colour = warded
      ? PALETTE.shield
      : power.kind === 'shield' ? PALETTE.shield : power.kind === 'magnet' ? PALETTE.magnet : PALETTE.boost
    // Power-ups get the full treatment: a beat of hit-stop, two shockwaves, a
    // spark fountain and a camera punch, so they never feel like a big coin.
    this.hitStop = 0.09
    this.camKick = 3.4
    this.shake = Math.max(this.shake, 0.5)
    this.sparks.burst(power.x, power.y, power.z, {
      count: 22,
      color: new THREE.Color(colour).getHex(),
      speed: 7,
      life: 0.68,
      gravity: 3,
      rise: 1.8,
    })
    this.rings?.burst(power.x, power.y, power.z, {
      color: new THREE.Color(colour).getHex(),
      radius: 2.7,
      life: 0.55,
      spin: 1.6,
    })
    this.rings?.burst(power.x, power.y, power.z, { color: 0xffffff, radius: 1.4, life: 0.34, spin: -2.2 })
    this.events.emit('pickup', {
      id: this.pickupId++,
      kind: 'power',
      amount: 0,
      combo: run.combo,
      multiplier: run.multiplier,
      multiplierUp: false,
      power: power.kind,
      harmful: spec.harmful && !warded,
      warded,
    })
    this.applyPower(power.kind, power, warded)
  }

  /**
   * The effect of a power-up, and the only place one is ever applied. `warded` means
   * the hero shrugged it off: the pickup still lands and still answers back, but the
   * hazard never touches the run.
   */
  private applyPower(kind: PowerKind, at: { x: number; y: number; z: number }, warded = false): void {
    const run = this.run
    const spec = POWER_BY_KIND[kind]
    if (warded) {
      this.rings?.burst(at.x, at.y, at.z, {
        color: new THREE.Color(PALETTE.shield).getHex(),
        radius: 3.4,
        life: 0.62,
        spin: -3.4,
      })
      this.toast('WARD — hazard shrugged off', 'power')
      return
    }
    // Bobbilee's perk stretches everything helpful; the hazards stay as nasty.
    // Bobbilee stretches every reward; Tim stretches only Overdrive, and further.
    const duration = spec.harmful
      ? spec.duration
      : spec.duration * this.powerScale * (kind === 'boost' ? this.boostScale : 1) * this.upgradeScale(kind)
    if (kind === 'shield') {
      run.shield = Math.min(RUN.maxShields, run.shield + 1)
      this.toast('Shield up — one free hit', 'power')
    } else if (kind === 'magnet') {
      const magnetTime = RUN.magnetTime * this.powerScale * this.upgradeScale('magnet')
      run.magnetUntil = run.elapsed + magnetTime
      this.audio.play('boost')
      this.toast(`Magnet online — ${magnetTime.toFixed(0)}s`, 'power')
    } else if (kind === 'double') {
      run.doubleUntil = run.elapsed + duration
      this.toast(`Double Arc — ${duration.toFixed(0)}s`, 'power')
    } else if (kind === 'ghost') {
      run.ghostUntil = run.elapsed + duration
      this.toast(`Phase shift — ${duration.toFixed(0)}s`, 'power')
    } else if (kind === 'invert') {
      run.invertUntil = run.elapsed + duration
      this.audio.play('hit')
      this.shake = Math.min(1.2, this.shake + 0.5)
      this.toast(`Controls jammed — ${spec.duration}s`, 'warn')
    } else if (kind === 'fog') {
      run.fogUntil = run.elapsed + duration
      this.toast(`Smoke screen — ${spec.duration}s`, 'warn')
    } else if (kind === 'heavy') {
      run.heavyUntil = run.elapsed + duration
      this.toast(`Heavy load — jumps fall short`, 'warn')
    } else {
      run.boostUntil = run.elapsed + duration
      run.invulnUntil = Math.max(run.invulnUntil, run.boostUntil)
      this.audio.play('boost')
      this.shake = Math.min(1, this.shake + 0.4)
      this.toast('OVERDRIVE — smash through!', 'power')
    }
  }

  /**
   * Blends the sky, the fog and the two lights between the zones the run is between.
   * A zone is a palette, not new geometry, so the whole world changes mood for the
   * cost of five colours and two intensities.
   */
  private applyBiome(distance: number): void {
    const { from, to, t } = biomeMix(distance)
    const background = this.scene.background
    const sky = blendColor(from.sky, to.sky, t, BIOME_OUT)
    if (background instanceof THREE.Color) background.copy(sky)
    else this.scene.background = sky.clone()
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(blendColor(from.fog, to.fog, t, BIOME_OUT))
    }
    this.hemiLight.color.copy(blendColor(from.skyBounce, to.skyBounce, t, BIOME_OUT))
    this.hemiLight.groundColor.copy(blendColor(from.groundBounce, to.groundBounce, t, BIOME_OUT))
    this.hemiLight.intensity = from.hemiIntensity + (to.hemiIntensity - from.hemiIntensity) * t
    this.sunLight.color.copy(blendColor(from.sun, to.sun, t, BIOME_OUT))
    this.sunLight.intensity = from.sunIntensity + (to.sunIntensity - from.sunIntensity) * t
    // The fill light is the cool bounce; it follows the sky so nothing reads warm at
    // dusk. It never goes dark enough to lose the runner's face.
    this.fillLight.intensity = 0.38 - t * 0.1
    this.renderer.toneMappingExposure = from.exposure + (to.exposure - from.exposure) * t
    this.biomeNow = t < 0.5 ? from.name : to.name
  }

  private checkObstacles(dz: number): void {
    const run = this.run
    const height = run.sliding ? BODY.slideHeight : BODY.standHeight
    const boosting = run.boostUntil > run.elapsed
    for (const obstacle of this.obstacles.pool) {
      if (!obstacle.active || obstacle.smashing) continue
      const spec = obstacle.spec
      // Two ways to be in contact: beside the runner right now, or swept past them
      // during this frame. The window used to be widened instead — `depth/2 + 0.55 +
      // min(2.4, dz/2)` — which at full speed reached 2.75 m up the road, so the
      // height test was applied while the obstacle was still metres away and judged
      // a jump by where the runner had been a step earlier. That is what let a
      // runner pass through an obstacle their body was still inside.
      const reach = spec.depth / 2 + 0.55
      const previousZ = obstacle.z - dz
      const alongside = Math.abs(obstacle.z) <= reach
      const crossed = previousZ > reach && obstacle.z < -reach
      if (!alongside && !crossed) continue
      const y = crossed ? run.previousY : run.y
      // Surface-to-surface air on the lateral axis. Negative means the two boxes
      // overlap; the forgiveness band is what stops a graze counting as a hit.
      const lateralGap = Math.abs(obstacle.mesh.position.x - run.laneX) - (spec.width / 2 + BODY.halfWidth)
      if (lateralGap > -BODY.forgiveness) {
        // Out of reach — but a hazard that swept past with almost nothing between the
        // boxes is a close call, and it is worth points. A clean pass in the next lane
        // leaves about 0.9 m, so only a deliberate graze earns this.
        if (crossed && lateralGap < BODY.nearMiss) this.awardNearMiss(obstacle)
        continue
      }
      // Ramps never hit: they kick the runner skyward instead.
      if (spec.launch) {
        if (run.onGround && !run.sliding && run.vy <= 0.01) {
          run.vy = spec.launch
          run.onGround = false
          run.jumpBuffer = 0
          run.score += spec.points * run.multiplier
          this.audio.play('boost')
          this.sparks.burst(obstacle.mesh.position.x, 0.35, obstacle.z, {
            count: 14,
            color: new THREE.Color(0xffd45e).getHex(),
            speed: 6,
            life: 0.45,
            gravity: 6,
            rise: 2.2,
          })
          this.rings?.burst(obstacle.mesh.position.x, 0.5, obstacle.z, {
            color: new THREE.Color(0xffd45e).getHex(),
            radius: 1.6,
            life: 0.36,
            spin: 2,
          })
          this.camKick = Math.min(3, this.camKick + 1.6)
        }
        continue
      }
      const bottom = spec.bottom
      const top = spec.bottom + spec.height
      if (y + height <= bottom + BODY.forgiveness) {
        if (crossed && bottom - (y + height) < BODY.nearMiss) this.awardNearMiss(obstacle)
        continue
      }
      // No forgiveness on this edge. A runner whose feet are still below the top of
      // a solid obstacle is inside it, and a wall with no `platformTop` cannot be
      // stood on, so there is no landing to forgive — forgiving it is exactly what
      // let a runner pass through a low wall while barely off the ground.
      if (y >= top) {
        // A jump that barely clears: the satisfying one.
        if (crossed && y - top < BODY.nearMiss) this.awardNearMiss(obstacle)
        continue
      }
      // Phase shift: traffic passes straight through the runner.
      if (run.ghostUntil > run.elapsed) {
        this.sparks.burst(run.laneX, run.y + 0.8, 0, {
          count: 8,
          color: new THREE.Color('#6ef0d4').getHex(),
          speed: 4,
          life: 0.35,
          gravity: 0,
          rise: 0.4,
        })
        continue
      }
      if (boosting) {
        this.obstacles.smash(obstacle)
        run.score += spec.points * run.multiplier
        this.audio.play('smash')
        this.sparks.burst(obstacle.mesh.position.x, obstacle.mesh.position.y, obstacle.z, {
          count: 14,
          color: new THREE.Color(PALETTE.danger).getHex(),
          speed: 7,
          life: 0.55,
          gravity: 12,
          spread: 1.3,
        })
        this.shake = Math.min(1, this.shake + 0.25)
        continue
      }
      this.hit(obstacle)
      break
    }
  }

  private hit(obstacle: Obstacle): void {
    const run = this.run
    if (run.invulnUntil > run.elapsed) return
    this.shake = Math.min(1.4, this.shake + 0.9)
    // Every contact adds danger, shield or not: a ward absorbs the impact, not the
    // attention. This is what makes the meter a rule rather than a decoration — and it
    // is the line the feature check is written around.
    run.heat = Math.min(PURSUIT.bustedAt, run.heat + PURSUIT.crashHeat)

    if (run.shield > 0) {
      run.shield -= 1
      run.invulnUntil = run.elapsed + RUN.hitInvuln
      run.combo = Math.floor(run.combo * 0.5)
      run.multiplier = Math.min(RUN.maxMultiplier, 1 + Math.floor(run.combo / RUN.comboStep))
      this.audio.play('shield')
      this.sparks.burst(run.laneX, run.y + 0.9, 0, {
        count: 22,
        color: new THREE.Color(PALETTE.shield).getHex(),
        speed: 7,
        life: 0.6,
        gravity: 4,
      })
      this.obstacles.smash(obstacle)
      this.toast('Shield absorbed the hit', 'warn')
      this.events.emit('damage', { shield: true, hits: run.hits })
      return
    }

    run.hits += 1
    this.audio.play('hit')
    this.audio.stopMusic()
    this.sparks.burst(run.laneX, run.y + 0.9, 0, {
      count: 34,
      color: new THREE.Color(PALETTE.dangerAlt).getHex(),
      speed: 9,
      life: 0.8,
      gravity: 10,
    })
    this.obstacles.smash(obstacle)
    this.events.emit('damage', { shield: false, hits: run.hits })
    this.finishRun()
  }

  /** A hazard swept past with almost no air between the boxes. */
  private awardNearMiss(obstacle: Obstacle): void {
    const run = this.run
    run.nearMisses += 1
    run.score += RUN.nearMissBonus * run.multiplier
    this.toast('CLOSE!', 'good')
    this.audio.play('coin')
    this.sparks.burst(obstacle.mesh.position.x, run.y + 0.9, obstacle.z, {
      count: 10,
      color: new THREE.Color(PALETTE.coinGlow).getHex(),
      speed: 7,
      life: 0.4,
      gravity: 0,
      rise: 0.7,
    })
    this.camKick = Math.min(3, this.camKick + 0.7)
  }

  /**
   * The danger meter.
   *
   * A crash adds heat and clean running sheds it, so one mistake is survivable and two
   * in quick succession are not: the run is decided by how cleanly you drive rather
   * than by a single bad frame. There is no car on screen any more, so this is the
   * whole of the system — the bar jumping is the only feedback a crash gets, which is
   * why the meter is drawn the moment any heat exists at all.
   */
  private updatePursuit(dt: number): void {
    const run = this.run
    run.heat = clamp01(run.heat - PURSUIT.coolPerSecond * dt)
    if (run.heat >= PURSUIT.bustedAt) this.bust()
  }

  /** Heat reaches its ceiling: the run is over. */
  private bust(): void {
    this.run.busted = true
    this.run.heat = PURSUIT.bustedAt
    this.camKick = Math.min(4, this.camKick + 3)
    this.avatar.setShieldLevel(0)
    this.finishRun(true)
  }

  /**
   * Ticks the three missions and banks each reward the moment it completes.
   *
   * Progress is read straight off the run's own counters, so a mission can never
   * disagree with what the HUD is showing. The coin mission counts coins *picked off
   * the road* rather than the purse, or completing a mission would progress it.
   */
  private updateMissions(): void {
    const run = this.run
    for (const mission of run.missions) {
      if (mission.done) continue
      let progress = 0
      switch (mission.id) {
        case 'distance': progress = Math.floor(run.distance); break
        case 'coins': progress = run.pickedCoins; break
        case 'combo': progress = run.bestCombo; break
        case 'powers': progress = run.powers; break
        case 'slides': progress = run.slides; break
        case 'jumps': progress = run.jumps; break
        case 'nearMiss': progress = run.nearMisses; break
        default: progress = 0
      }
      mission.progress = Math.min(mission.target, progress)
      if (progress >= mission.target) {
        mission.done = true
        run.coins += mission.reward
        run.missionCoins += mission.reward
        this.toast('MISSION!', 'good')
        this.audio.play('coin')
      }
    }
  }

  /**
   * Spends coins to carry on. The meter is cleared, the runner is briefly
   * untouchable, and the score is kept — the one thing coins buy, which is what makes
   * them worth collecting at all.
   */
  revive(): boolean {
    const run = this.run
    if (this.phase !== 'gameover' || run.revived || run.coins < this.diff.reviveCost) return false
    run.coins -= this.diff.reviveCost
    run.revived = true
    run.busted = false
    run.heat = 0
    run.invulnUntil = run.elapsed + 2.6
    run.y = 0
    run.vy = 0
    run.onGround = true
    run.sliding = false
    run.slideUntil = 0
    this.gameOverAt = 0
    this.hitStop = 0
    this.camKick = 0
    this.avatar.root.visible = true
    void this.audio.unlock().then(() => {
      this.audio.play('start')
      this.audio.startMusic()
    })
    this.toast('GO!', 'good')
    this.setPhase('playing')
    this.emitHud(true)
    return true
  }

  private finishRun(busted = false): void {
    // The meter can fill in the same frame a hazard lands. Whichever gets there first
    // owns the result screen.
    if (this.phase === 'gameover') return
    const run = this.run
    run.busted = busted
    const record = run.score > this.bestScore
    if (record) this.bestScore = run.score
    const summary: RunSummary = {
      score: Math.floor(run.score),
      coins: run.coins,
      distance: Math.floor(run.distance),
      topSpeed: run.topSpeed,
      bestCombo: run.bestCombo,
      duration: run.elapsed,
      shieldHits: run.shield,
      record,
      nearMisses: run.nearMisses,
      missions: run.missions.map((m) => ({ ...m })),
      missionCoins: run.missionCoins,
      busted,
      difficulty: this.diff.id,
      revived: run.revived,
      reviveCost: this.diff.reviveCost,
    }
    this.gameOverAt = this.clockTime
    this.audio.play('gameover')
    this.setPhase('gameover')
    this.emitHud(true)
    this.events.emit('result', summary)
  }

  private updateCrash(dt: number): void {
    // Keep the world drifting while the result screen settles.
    const run = this.run
    const slow = clamp(1 - (this.clockTime - this.gameOverAt) * 1.6, 0.05, 1)
    const dz = run.speed * slow * dt
    this.track.update(dt, run.speed * slow, this.clockTime)
    this.scenery?.update(dt, run.speed * slow, this.clockTime)
    this.obstacles.update(dt, run.speed * slow)
    this.pickups?.update(dt, run.speed * slow, this.clockTime, false, this.target)
    this.sparks.update(dt, dz)
    this.speedLines.update(dt, run.speed * slow, 0)
    this.avatar.root.position.y = Math.max(0, this.avatar.root.position.y)
    if (!this.avatar.hasDeathAnimation) this.avatar.root.rotation.x = damp(this.avatar.root.rotation.x, -0.9, 3, dt)
    this.avatar.root.position.z = damp(this.avatar.root.position.z, 1.6, 3, dt)
    this.avatar.update(dt, {
      speed01: 0,
      onGround: true,
      sliding: false,
      boosting: false,
      laneVelocity: 0,
      time: this.clockTime,
      mode: 'gameover',
    })
    this.camera.position.z = damp(this.camera.position.z, RUN.camDistance + 2.4, 2, dt)
    this.camera.position.y = damp(this.camera.position.y, RUN.camHeight + 0.8, 2, dt)
    this.camera.lookAt(this.avatar.root.position.x, 1.1, 0)
    this.camera.fov = damp(this.camera.fov, CAMERA.fov + 4, 2, dt)
    this.camera.updateProjectionMatrix()
  }

  // ------------------------------------------------------------------ misc --
  private freshRun(): RunState {
    return {
      elapsed: 0,
      speed: RUN.startSpeed,
      topSpeed: RUN.startSpeed,
      distance: 0,
      score: 0,
      coins: 0,
      pickedCoins: 0,
      missionCoins: 0,
      missions: [],
      heat: 0,
      busted: false,
      revived: false,
      jumps: 0,
      slides: 0,
      powers: 0,
      nearMisses: 0,
      combo: 0,
      bestCombo: 0,
      multiplier: 1,
      shield: 0,
      magnetUntil: 0,
      boostUntil: 0,
      invulnUntil: 0,
      doubleUntil: 0,
      ghostUntil: 0,
      invertUntil: 0,
      fogUntil: 0,
      heavyUntil: 0,
      lane: 1,
      laneX: LANES[1],
      laneVelocity: 0,
      y: 0,
      vy: 0,
      onGround: true,
      sliding: false,
      previousY: 0,
      slideUntil: 0,
      slidePending: false,
      coyote: PHYSICS.coyoteTime,
      jumpBuffer: 0,
      spawnCursor: 18,
      lineCounter: 1,
      powerTimer: Math.round(randRange(this.rng, 4, 8)),
      tierIndex: 0,
      hits: 0,
    }
  }

  private setPhase(phase: Phase): void {
    if (this.phase === phase) return
    this.phase = phase
    this.input.setEnabled(phase === 'playing')
    this.events.emit('phase', phase)
  }

  private emitProgress(pct: number, label: string): void {
    this.events.emit('progress', { pct, label })
  }

  private toast(text: string, kind: ToastMsg['kind']): void {
    this.events.emit('toast', { id: this.toastId++, text, kind })
  }

  private emitHud(force: boolean): void {
    const run = this.run
    const baseSpeed = this.phase === 'menu' ? 0 : speedAt(run.elapsed)
    const tier = tierFor(baseSpeed)
    const hud: HudState = {
      score: Math.floor(run.score),
      best: Math.floor(this.bestScore),
      coins: run.coins,
      distance: Math.floor(run.distance),
      speed: run.speed,
      topSpeed: run.topSpeed,
      multiplier: run.multiplier,
      combo: run.combo,
      bestCombo: run.bestCombo,
      shield: run.shield > 0,
      magnet: Math.max(0, run.magnetUntil - run.elapsed),
      boost: Math.max(0, run.boostUntil - run.elapsed),
      shieldHits: run.shield,
      double: Math.max(0, run.doubleUntil - run.elapsed),
      ghost: Math.max(0, run.ghostUntil - run.elapsed),
      invert: Math.max(0, run.invertUntil - run.elapsed),
      fog: Math.max(0, run.fogUntil - run.elapsed),
      heavy: Math.max(0, run.heavyUntil - run.elapsed),
      fps: Math.round(this.fps),
      tierName: tier.name,
      biome: this.biomeNow,
      heat: this.run.heat,
      canRevive: !this.run.revived && this.run.coins >= this.diff.reviveCost,
      reviveCost: this.diff.reviveCost,
      missions: this.run.missions,
    }
    void force
    this.events.emit('hud', hud)
  }

  // --------------------------------------------------------------- QA hooks --
  /** QA: how much pickup juice is alive right now. */
  debugJuice(): Record<string, number> {
    return {
      ground: this.groundHeight(),
      rings: this.rings?.activeCount ?? 0,
      flyCoins: this.flyCoins?.activeCount ?? 0,
      hitStop: this.hitStop,
      camKick: this.camKick,
    }
  }

  debugSnapshot(): Record<string, unknown> {
    const run = this.run
    return {
      phase: this.phase,
      score: Math.floor(run.score),
      coins: run.coins,
      distance: Math.floor(run.distance),
      speed: run.speed,
      multiplier: run.multiplier,
      combo: run.combo,
      lane: run.lane,
      laneX: run.laneX,
      y: run.y,
      onGround: run.onGround,
      sliding: run.sliding,
      shield: run.shield,
      boosting: run.boostUntil > run.elapsed,
      magnet: run.magnetUntil > run.elapsed,
      double: Math.max(0, run.doubleUntil - run.elapsed),
      ghost: Math.max(0, run.ghostUntil - run.elapsed),
      invert: Math.max(0, run.invertUntil - run.elapsed),
      fog: Math.max(0, run.fogUntil - run.elapsed),
      heavy: Math.max(0, run.heavyUntil - run.elapsed),
      activePowers: this.pickups?.powers.filter((power) => power.active).length ?? 0,
      animWeight: this.avatar.animWeight,
      animTime: this.avatar.animTime,
      slideBlend: +this.avatar.slideBlend.toFixed(2),
      obstacles: this.obstacles.activeCount,
      activeCoins: this.pickups?.activeCoins ?? 0,
      coinTextureReady: this.pickups?.debugInfo.textureReady ?? false,
      avatarVisible: this.avatar.root.visible,
      avatarY: +this.avatar.root.position.y.toFixed(2),
      character: this.character,
      perk: {
        id: CHARACTERS[this.character]?.perk?.id ?? null,
        value: CHARACTERS[this.character]?.perk?.value ?? 0,
        jumpVelocity: +PHYSICS.jumpVelocity.toFixed(2),
        laneRate: +(RUN.laneSwitchRate * this.laneScale).toFixed(2),
        magnetRadius: +this.magnetReach.toFixed(2),
        boostScale: this.boostScale,
        powerScale: this.powerScale,
        shieldAtStart: this.perkScale('shieldStart', 0),
      },
      avatar: this.avatar instanceof ModelAvatar ? 'rigged' : 'procedural',
      anim: this.avatar.animName ?? 'rig',
      fps: Math.round(this.fps),
      quality: this.quality,
      biome: this.biomeNow,
      brand: this.brand?.name ?? null,
      logo: Boolean(this.brand?.logo),
    }
  }

  debugGrant(kind: PowerKind): void {
    // Routed through the real rule rather than setting timers by hand, so a check
    // that grants a hazard measures what the game would actually do with it.
    const spec = POWER_BY_KIND[kind]
    this.applyPower(kind, { x: 0, y: 0, z: 0 }, !powerTakesHold(CHARACTERS[this.character]?.perk, spec.harmful))
  }

  /** QA helper: place an obstacle at an exact z (platform tests need control). */
  debugPlaceObstacle(kind: ObstacleKind, lane: number, z: number): void {
    this.obstacles.spawn(kind, lane, z)
  }

  /** QA helper: fast-forward the run clock so late-game speeds can be reviewed. */
  debugAdvance(seconds: number): void {
    if (!import.meta.env.DEV) return
    this.run.elapsed += seconds
    this.run.tierIndex = tierFor(speedAt(this.run.elapsed)).at
  }

  /** QA helper: toggle the speed streaks so their look can be isolated. */
  debugSpeedLines(on: boolean): void {
    if (!import.meta.env.DEV) return
    this.speedLines.mesh.visible = on && this.preset.speedLines > 0
  }

  /** QA helper: hold the camera on a pickup glyph (good or hazard). */
  debugPower(kind: PowerKind | null): void {
    if (!import.meta.env.DEV) return
    if (this.powerShowcase) this.powerShowcase.visible = false
    this.powerShowcase = null
    this.portrait = kind !== null
    if (!kind) {
      this.camera.fov = CAMERA.fov
      this.camera.updateProjectionMatrix()
      return
    }
    this.powerShowcase = this.pickups?.showcasePower(kind) ?? null
    this.camera.fov = 30
    this.camera.updateProjectionMatrix()
    this.camera.position.set(0.5, 1.34, -0.55)
    this.camera.lookAt(0, 1.15, -2.6)
  }

  /** QA helper: wipe the road clean (lets a check undo its own spawns). */
  debugClearObstacles(): void {
    this.obstacles.reset()
  }

  /** QA helper: drop the runner from a height to test landing surfaces. */
  debugDrop(height = 2.6): void {
    this.run.y = height
    this.run.vy = 0
    this.run.onGround = false
  }

  /** QA helper: drop a real power-up just ahead so the pickup runs end to end. */
  debugSpawnPower(kind: PowerKind = 'shield', lane?: number): void {
    this.pickups?.spawnPower(kind, lane ?? this.run.lane, -11)
  }

  /** QA helper: pause the automatic pattern spawner for deterministic tests. */
  /** QA helper: park the camera next to a coin so its artwork can be reviewed. */
  debugCoin(on: boolean): void {
    if (!import.meta.env.DEV) return
    this.portrait = on
    if (!on) {
      if (this.coinShowcase) this.coinShowcase.visible = false
      this.camera.fov = CAMERA.fov
      this.camera.updateProjectionMatrix()
      return
    }
    if (this.coinShowcase) this.coinShowcase.visible = true
    this.coinShowcase ??= this.pickups?.showcase() ?? null
    this.camera.fov = 30
    this.camera.updateProjectionMatrix()
    this.camera.position.set(0.62, 1.38, -0.55)
    this.camera.lookAt(0, 1.05, -2.6)
  }

  /** QA helper: park the camera in front of a trackside billboard. */
  debugBillboard(on: boolean): void {
    if (!import.meta.env.DEV) return
    this.portrait = on
    if (!on) {
      this.camera.fov = CAMERA.fov
      this.camera.updateProjectionMatrix()
      return
    }
    if (!this.scenery?.showcaseBillboard()) return
    this.camera.fov = 40
    this.camera.updateProjectionMatrix()
    this.camera.position.set(0, 3.05, -3.6)
    this.camera.lookAt(0, 3.2, -9.5)
  }

  debugFreezeSpawns(freeze: boolean): void {
    this.spawnFrozen = freeze
  }

  /** QA helper: drop a straight coin line just ahead of the runner. */
  debugSpawnCoins(count = 5, lane?: number): void {
    const line = this.run.lineCounter++
    this.lineTrackers.set(line, { total: count, collected: 0 })
    this.pickups?.spawnLine(lane ?? this.run.lane, -14, count, 'flat', line)
  }

  /** QA helper: place an obstacle directly in front of the runner. */
  debugSpawnObstacle(kind: ObstacleKind = 'low', lane?: number): void {
    const targetLane = lane ?? this.run.lane
    this.obstacles.spawn(kind, targetLane, -8)
  }
}

/** Corner + edge samples of a box, dense enough to catch a thin limb crossing it. */
function boxSamples(box: THREE.Box3): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  const min = box.min
  const max = box.max
  const steps = 4
  for (let axis = 0; axis < 3; axis += 1) {
    const a = (axis + 1) % 3
    const b = (axis + 2) % 3
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps; j += 1) {
        const t = i / steps
        const u = j / steps
        const point = new THREE.Vector3()
        const set = (index: number, value: number) => {
          if (index === 0) point.x = value
          else if (index === 1) point.y = value
          else point.z = value
        }
        set(axis, min.getComponent(axis))
        set(a, min.getComponent(a) + (max.getComponent(a) - min.getComponent(a)) * t)
        set(b, min.getComponent(b) + (max.getComponent(b) - min.getComponent(b)) * u)
        points.push(point)
        const far = point.clone()
        far.setComponent(axis, max.getComponent(axis))
        points.push(far)
      }
    }
  }
  return points
}
