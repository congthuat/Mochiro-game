// Rigged runner built from an external glTF model.
//
// Model: "KayKit — Adventurers Character Pack (1.0)" by Kay Lousberg, released
// under CC0 (public domain): https://kaylousberg.itch.io/kaykit-adventurers
// The 76 shipped clips are stripped down to the ten the runner needs by
// scripts/build-models.ts; every state is entered with an animation crossfade so
// movement blends instead of popping.
import * as THREE from 'three'
import { attachGear, type GearSpec } from './gear'
import { applyPersona, type PersonaId } from './persona'
import { recolorTexture, type RecolorSpec } from './recolor'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { AvatarFx } from './avatarFx'
import { damp } from './utils'

export interface AvatarState {
  speed01: number
  onGround: boolean
  sliding: boolean
  boosting: boolean
  /** Sideways velocity, used for the lean. */
  laneVelocity: number
  time: number
  /** 'menu' keeps the runner idle, 'gameover' plays the crash. */
  mode?: 'menu' | 'playing' | 'gameover'
}

interface LoadedModel {
  scene: THREE.Group
  animations: THREE.AnimationClip[]
}

const cache = new Map<string, LoadedModel>()

/**
 * glTF loader sanitises node names (`Knife_Offhand` survives, `hand.l` does not).
 * Matching is by substring, so one entry can retire a whole family of baked-in
 * weapons — the rogue rig ships a knife *and* two crossbows.
 */
function findByName(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const wanted = name.replace(/[\[\].:/]/g, '').toLowerCase()
  const found: THREE.Object3D[] = []
  root.traverse((object) => {
    if (object.name.replace(/[\[\].:/]/g, '').toLowerCase().includes(wanted)) found.push(object)
  })
  return found
}
const loader = new GLTFLoader()

/** Warms the cache so swapping heroes is instant. */
export async function preloadModel(url: string): Promise<void> {
  if (cache.has(url)) return
  const gltf = await loader.loadAsync(url)
  cache.set(url, { scene: gltf.scene as THREE.Group, animations: gltf.animations })
}

export interface ModelAvatarOptions {
  url: string
  /** World height of the character in metres. */
  height?: number
  /** Yaw applied so the model looks down -z, the direction the runner travels. */
  facing?: number
  /** Optional costume palette swap applied to the model's atlas. */
  recolor?: RecolorSpec
  /** Extra kit parented to the skeleton (quiver). */
  gear?: GearSpec
  /**
   * Meshes baked into the rig that this class should not be carrying — the KayKit
   * rogues ship with a knife in hand, which is wrong for an archer.
   */
  hideNodes?: string[]
  /** Dresses the rig as a real person (see persona.ts) instead of its fantasy class. */
  persona?: PersonaId
}

const RUN_FADE = 0.22
const ACTION_FADE = 0.14

/**
 * The slide, as a body transform rather than a clip.
 *
 * The KayKit rigs ship ten clips and not one of them gets low: measured through
 * `Dodge_Forward` — the clip the state machine reaches for — the head drops 0.10 m,
 * while the run cycle itself bounces 0.16 m, so a sliding runner looked *taller*
 * than a running one while the collision box shrank from 1.70 m to 0.86 m. The rig
 * simply has no duck in it.
 *
 * So the slide is applied to the body instead, as a real lie-down: the runner tips
 * over the feet, lands on their back and slides with their feet leading.
 *
 * The clip matters as much as the angle. `Dodge_Forward` looks like the obvious
 * choice, but its pose already curls the body 31° forward, so tipping it 89° only gets
 * the torso to 25° above the road — the runner looks like they are sitting up, and
 * their legs are tucked under them. `SLIDE_CLIP` is `Idle` instead: a straight,
 * upright pose, which tipped 89° gives a body **1° off horizontal**, chest to the sky,
 * legs out front. `scripts/slide-pose.ts --clips` compares them.
 *
 * Nothing is squashed. Compressing the model along its own length makes the runner
 * *stubbier* rather than lower — "bẹp dí" — so `SLIDE_SQUASH` stays at 1 and the check
 * fails if it is ever lowered again. The tip does all of the work.
 *
 * And the lift is what puts the body *on* the road rather than in it. It is measured,
 * not eyeballed: the chibi head is 0.81 m across on a 1.74 m runner, so a body lying
 * flat is only 0.44–0.50 m tall once it is down. The check measures the skinned mesh
 * — not the bones — so the head's own bulk counts, and it names the mesh that owns
 * the highest vertex when a rig does not fit.
 */
export const SLIDE_CLIP = 'Idle'
export const SLIDE_LEAN = 1.55
export const SLIDE_SQUASH = 1
export const SLIDE_LIFT = 0.45
const SLIDE_BLEND = 14

export class ModelAvatar {
  readonly root = new THREE.Group()
  readonly ready: Promise<boolean>
  /** Rigged characters play Death_A on a crash, so no extra root tumble. */
  readonly hasDeathAnimation = true
  animName = 'none'

  private fx = new AvatarFx(0.5, 0.85)
  private mixer: THREE.AnimationMixer | null = null
  private actions = new Map<string, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  private container = new THREE.Group()
  private model: THREE.Object3D | null = null
  private height = 1.72
  private facing = Math.PI
  private recolor?: RecolorSpec
  private gear?: GearSpec
  private hideNodes: string[] = []
  private persona?: PersonaId
  private maskState = new Map<THREE.Object3D, boolean>()
  private lean = 0
  private yaw = 0
  private lastMode: AvatarState['mode'] = 'menu'
  /** Set once the one-shot landing clip has reported "finished". */
  private landPlayed = false
  /** Seconds spent airborne in the current hop. */
  private airTime = 0
  private crashed = false
  private wasAirborne = false
  private airStage: 'none' | 'start' | 'idle' | 'air' = 'none'
  private slidePlayed = false
  /** 0 = upright, 1 = full slide. Drives the body squash. */
  slideBlend = 0
  /** The fit scale applied to the model, so the squash can be relative to it. */
  private fitScale = 1

  constructor(options: ModelAvatarOptions) {
    this.height = options.height ?? 1.72
    this.facing = options.facing ?? Math.PI
    this.recolor = options.recolor
    this.gear = options.gear
    this.hideNodes = options.hideNodes ?? []
    this.persona = options.persona
    this.root.add(this.container)
    this.root.add(this.fx.group)
    this.ready = this.load(options.url)
  }

  private async load(url: string): Promise<boolean> {
    try {
      await preloadModel(url)
      const loaded = cache.get(url)
      if (!loaded) return false
      const scene = cloneSkinned(loaded.scene) as THREE.Object3D
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        // Every clone gets its own material instance. Two heroes can share a rig —
        // Sam and Tim are both knights — and the cached original is shared by every
        // clone of it, so mutating a material in place (a palette swap, a metalness
        // tweak) would silently repaint whichever hero happened to be built last.
        const source = mesh.material as THREE.MeshStandardMaterial
        if (source && !Array.isArray(source)) {
          const material = source.clone()
          if (this.recolor && source.map) {
            material.map = recolorTexture(source.map, this.recolor)
            material.emissiveMap = material.map
          }
          mesh.material = material
        }
        mesh.castShadow = true
        mesh.receiveShadow = false
        // Skinned bounds are computed from the rest pose; keep them on screen.
        mesh.frustumCulled = false
        const material = mesh.material as THREE.MeshStandardMaterial
        if (material && 'metalness' in material) {
          material.metalness = Math.min(0.15, material.metalness ?? 0)
          material.roughness = Math.max(0.5, material.roughness ?? 1)
          // A gentle self-lit lift keeps the runner readable against the bright
          // daylight street, the same trick the procedural rig uses.
          if (material.map && !material.emissiveMap) {
            material.emissiveMap = material.map
            material.emissive = new THREE.Color(0xffffff)
            material.emissiveIntensity = 0.26
            material.needsUpdate = true
          }
        }
      })
      // Normalise size and put the feet on the track.
      const box = new THREE.Box3().setFromObject(scene)
      const size = new THREE.Vector3()
      box.getSize(size)
      const scale = size.y > 0.001 ? this.height / size.y : 1
      this.fitScale = scale
      scene.scale.setScalar(scale)
      scene.position.y = -box.min.y * scale
      scene.rotation.y = this.facing
      for (const name of this.hideNodes) {
        for (const node of findByName(scene, name)) node.visible = false
      }
      if (this.persona) applyPersona(scene, this.persona)
      if (this.gear) {
        attachGear(scene, this.gear, { height: this.height })
      }
      this.container.add(scene)
      this.model = scene

      this.mixer = new THREE.AnimationMixer(scene)
      for (const clip of loaded.animations) {
        const action = this.mixer.clipAction(clip)
        action.enabled = true
        action.setEffectiveWeight(1)
        this.actions.set(clip.name, action)
      }
      this.mixer.addEventListener('finished', this.handleFinished)
      this.play('Idle', 0)
      return true
    } catch (error) {
      console.warn('[arcrush] character model failed to load, using the built-in runner', error)
      return false
    }
  }

  private handleFinished = (event: { action: THREE.AnimationAction }): void => {
    const name = this.actionName(event.action)
    if (name === 'Jump_Start') {
      if (this.airStage === 'start') {
        this.airStage = 'idle'
        this.play('Jump_Idle', ACTION_FADE)
      }
    } else if (name === 'Jump_Land') {
      this.landPlayed = true
    } else if (name === 'Dodge_Forward') {
      this.slidePlayed = true
    } else if (name === 'Death_A') {
      this.crashed = true
    }
  }

  /** Effective weight of the clip currently driving the skeleton (0 = frozen). */
  get animWeight(): number {
    return this.current?.getEffectiveWeight() ?? 0
  }

  /** Playhead of the clip currently driving the skeleton, in seconds. */
  get animTime(): number {
    return this.current?.time ?? 0
  }

  private actionName(action: THREE.AnimationAction): string {
    for (const [name, candidate] of this.actions) if (candidate === action) return name
    return ''
  }

  private play(name: string, fade = RUN_FADE, once = false, timeScale = 1): void {
    const next = this.actions.get(name)
    if (!next) return
    if (next === this.current && !once) {
      next.setEffectiveTimeScale(timeScale)
      return
    }
    next.reset()
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity)
    next.clampWhenFinished = once
    next.enabled = true
    next.setEffectiveWeight(1)
    next.setEffectiveTimeScale(timeScale)
    if (this.current && this.current !== next && fade > 0) {
      next.crossFadeFrom(this.current, fade, true)
    }
    next.play()
    this.current = next
    this.animName = name
  }

  setShield(active: boolean): void {
    this.fx.setShield(active)
  }

  setShieldLevel(level: number): void {
    this.fx.setShieldLevel(level)
  }

  /** Dev-only: hide/show the character mesh (used by the model inspector). */
  debugHair(on: boolean): void {
    if (this.model) this.model.visible = on
  }

  /** Dev-only: re-point the model so the correct forward can be verified. */
  debugFacing(radians: number): void {
    this.facing = radians
    if (this.model) this.model.rotation.y = radians
  }

  update(dt: number, state: AvatarState): void {
    const speed01 = Math.min(1, Math.max(0, state.speed01))
    const mode = state.mode ?? 'playing'

    // --- state machine -----------------------------------------------------
    if (mode === 'gameover') {
      if (this.lastMode !== 'gameover') {
        this.crashed = false
        this.play('Death_A', 0.12, true)
      }
    } else if (mode === 'menu') {
      this.play('Idle', RUN_FADE, false, 0.9 + speed01 * 0.2)
    } else if (state.sliding) {
      if (this.airStage !== 'none') this.airStage = 'none'
      if (this.current !== this.actions.get(SLIDE_CLIP)) {
        this.slidePlayed = false
        this.play(SLIDE_CLIP, 0.1, false, 1)
      }
    } else if (!state.onGround) {
      if (!this.wasAirborne) {
        this.airStage = 'start'
        this.airTime = 0
        this.play('Jump_Start', 0.08, true, 1.1)
      }
      this.airTime += dt
      // A ramp launch hangs in the air far longer than a hop. Keep the run
      // cycle going through the flight so the runner never freezes mid-air.
      if (this.airStage !== 'air' && this.airTime > 0.42) {
        this.airStage = 'air'
        this.play('Running_A', 0.2, false, 0.9 + speed01 * 0.5)
      }
      if (this.airStage === 'air') {
        const airRun = this.actions.get('Running_A')
        if (airRun && this.current === airRun) airRun.setEffectiveTimeScale(0.9 + speed01 * 0.5)
      }
    } else {
      if (this.airStage !== 'none') {
        this.airStage = 'none'
        this.landPlayed = false
        this.play('Jump_Land', 0.06, true, 1.6 + speed01 * 0.8)
      }
      const land = this.actions.get('Jump_Land')
      const landing = land !== undefined && this.current === land
      // The landing clip is a one-shot: control must return to the run cycle as
      // soon as it plays out, otherwise the runner freezes mid-landing and the
      // legs never move again. The clip's own clock is the authority (plus the
      // mixer's "finished" event as a belt-and-braces signal).
      const landDone = landing && (this.landPlayed || land.time >= land.getClip().duration * 0.5)
      if (landDone) {
        this.landPlayed = false
        this.play('Running_A', RUN_FADE, false, 0.85 + speed01 * 0.95)
      } else if (this.slidePlayed) {
        this.slidePlayed = false
        this.play('Running_A', RUN_FADE, false, 0.85 + speed01 * 0.95)
      } else if (!landing && this.current !== this.actions.get('Running_A')) {
        this.play('Running_A', RUN_FADE, false, 0.85 + speed01 * 0.95)
      }
      const run = this.actions.get('Running_A')
      if (run && this.current === run) run.setEffectiveTimeScale(0.85 + speed01 * 0.95 + (state.boosting ? 0.18 : 0))
    }
    this.wasAirborne = !state.onGround
    this.lastMode = mode

    // --- steering feedback --------------------------------------------------
    this.lean = damp(this.lean, Math.max(-0.4, Math.min(0.4, -state.laneVelocity * 0.05)), 12, dt)
    this.yaw = damp(this.yaw, Math.max(-0.2, Math.min(0.2, -state.laneVelocity * 0.022)), 10, dt)
    this.root.rotation.z = this.lean
    this.root.rotation.y = this.yaw

    this.mixer?.update(dt)

    // --- the slide, applied to the body -------------------------------------
    // Damped rather than switched, so going down and standing back up are both a
    // movement instead of a pop. The tip is on the root, which pivots at the feet, so
    // the soles stay on the road while the body swings over them.
    this.slideBlend = damp(this.slideBlend, state.sliding ? 1 : 0, SLIDE_BLEND, dt)
    if (this.model) {
      this.model.scale.y = this.fitScale * (1 - (1 - SLIDE_SQUASH) * this.slideBlend)
    }
    // The runner's height belongs to the game, not to the model: the Runner writes
    // `run.y` into `root.position.y` every frame, immediately before this call. The
    // slide therefore *adds* its lift. Assigning instead pins the avatar to the road —
    // and no jump, hop or ramp launch ever leaves the ground again.
    this.root.position.y += SLIDE_LIFT * this.slideBlend
    this.root.rotation.x = SLIDE_LEAN * this.slideBlend

    this.fx.update(state.boosting && mode === 'playing', Math.max(0, this.root.position.y))
  }

  /**
   * Dev-only: hide one class of nodes so a screenshot diff can measure its
   * silhouette. Returns the names that were touched.
   */
  maskNodes(part: string, hidden: boolean): string[] {
    const model = this.model
    if (!model) return []
    const touched: string[] = []
    const weapons = /(knife|crossbow|sword|staff|axe|shield)/i
    model.traverse((object) => {
      const mesh = object as THREE.Mesh
      let match = false
      if (part === 'head') match = Boolean(mesh.isMesh && /_head/i.test(mesh.name))
      else if (part === 'gear') match = object.name.startsWith('gear:')
      else if (part === 'weapons') {
        match = Boolean(mesh.isMesh && weapons.test(mesh.name) && !mesh.name.startsWith('gear:'))
      }
      if (!match) return
      if (hidden) {
        if (!this.maskState.has(object)) this.maskState.set(object, object.visible)
        object.visible = false
      } else {
        const original = this.maskState.get(object)
        if (original !== undefined) object.visible = original
      }
      touched.push(object.name)
    })
    return touched
  }

  /**
   * Dev-only: the character's head box and the boxes of everything it carries,
   * in world space. Used to prove that kit never sits over the head from behind.
   */
  carryProbe(): { head: THREE.Box3; headBone: THREE.Vector3; gear: { name: string; box: THREE.Box3 }[] } | null {
    const model = this.model
    if (!model) return null
    model.updateWorldMatrix(true, true)
    // A node is only on screen if every ancestor is visible too — the pack ships
    // every weapon in the file and switches most of them off.
    const shown = (object: THREE.Object3D): boolean => {
      let node: THREE.Object3D | null = object
      while (node) {
        if (!node.visible) return false
        node = node.parent
      }
      return true
    }
    const head = new THREE.Box3()
    const gear: { name: string; box: THREE.Box3 }[] = []
    model.traverse((object) => {
      if (!shown(object)) return
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && /_head/i.test(mesh.name)) {
        head.union(worldBoxOf(mesh))
      } else if (object.name.startsWith('gear:')) {
        gear.push({ name: object.name, box: new THREE.Box3().setFromObject(object) })
      } else if (mesh.isMesh && /(knife|crossbow|sword|staff|axe|shield)/i.test(mesh.name)) {
        // Weapons baked into the rig count too — that is what the barbarian and the
        // knight actually carry.
        gear.push({ name: mesh.name, box: worldBoxOf(mesh) })
      }
    })
    if (head.isEmpty()) return null
    // Exact bone match: "head" alone would also catch the helmet/hair meshes.
    let bone: THREE.Object3D | undefined
    model.traverse((object) => {
      if (bone) return
      if (object.name.replace(/[\[\].:/]/g, '').toLowerCase() === 'head') bone = object
    })
    const headBone = new THREE.Vector3()
    if (bone) bone.getWorldPosition(headBone)
    else head.getCenter(headBone)
    return { head, headBone, gear }
  }

  dispose(): void {
    this.mixer?.removeEventListener('finished', this.handleFinished)
    this.mixer?.stopAllAction()
    this.mixer = null
    this.actions.clear()
    this.model = null
    this.container.clear()
    this.fx.dispose()
    this.root.clear()
  }
}

/** World-space bounds of a mesh; skinned meshes are posed first. */
function worldBoxOf(mesh: THREE.Mesh): THREE.Box3 {
  const skinned = mesh as THREE.SkinnedMesh
  if (skinned.isSkinnedMesh) {
    skinned.computeBoundingBox()
    const box = skinned.boundingBox?.clone() ?? new THREE.Box3().setFromObject(mesh)
    return box.applyMatrix4(skinned.matrixWorld)
  }
  return new THREE.Box3().setFromObject(mesh)
}
