// Menu line-up. The six heroes stand on a lit stage and are rendered live, so
// the player picks a character by looking at it — clicking the model itself
// selects it, the way a character-select screen in a console game works.
import * as THREE from 'three'
import { CHARACTERS, CHARACTER_IDS, type CharacterId } from './config'
import { ModelAvatar } from './model'

export type StageQuality = 'low' | 'medium' | 'high'

export interface StageOptions {
  canvas: HTMLCanvasElement
  quality?: StageQuality
  /** Fires once every hero has loaded (or failed) so the UI can stop spinning. */
  onReady?: () => void
  /** Fires when the player clicks a hero on the stage. */
  onSelect?: (id: CharacterId) => void
}

const SPACING = 1.42

/**
 * Half the width of the six-hero line-up, and the half-height the tallest hero needs.
 * The stage camera is fitted to these on every resize so the characters fill whatever
 * shape the panel gives them, instead of standing at a fixed distance and leaving a
 * wide strip of empty background above and below.
 */
export const LINEUP_HALF_WIDTH = 3.95
export const LINEUP_HALF_HEIGHT = 1.05

/** The hero's height, for the fit check. */
export const HERO_HEIGHT = 1.74

/** How wide the view opens on a narrow stage. */
export function stageFov(aspect: number): number {
  return aspect < 1.7 ? 44 : 36
}

/**
 * Where the line-up camera stands for a given stage shape.
 *
 * Fit by width, but never closer than the tallest hero needs: a very wide and short
 * stage would otherwise push the camera in far enough to distort the faces. Exported so
 * `scripts/feature-check.ts` can verify the six of them fill the frame at every shape
 * without a browser — the old fixed distance left them standing in a wide strip of
 * empty background, which is exactly the kind of thing nobody notices until a
 * screenshot.
 */
export function stageCameraZ(fovDeg: number, aspect: number): number {
  const tan = Math.tan((fovDeg * Math.PI) / 360)
  const byWidth = (LINEUP_HALF_WIDTH * 1.04) / (tan * aspect)
  const byHeight = LINEUP_HALF_HEIGHT / tan
  return Math.max(byWidth, byHeight, 3.4)
}
const SELECT_LIFT = 0.42

/** Soft radial vignette used for the stage floor. */
function floorTexture(): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(150,178,220,0.26)')
    gradient.addColorStop(0.62, 'rgba(150,178,220,0.14)')
    gradient.addColorStop(1, 'rgba(150,178,220,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function shadowTexture(): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(38,50,72,0.42)')
    gradient.addColorStop(0.6, 'rgba(38,50,72,0.16)')
    gradient.addColorStop(1, 'rgba(38,50,72,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

interface Slot {
  id: CharacterId
  avatar: ModelAvatar
  root: THREE.Group
  ring: THREE.Mesh
  ringMaterial: THREE.MeshBasicMaterial
  shadow: THREE.Mesh
  home: THREE.Vector3
  spin: number
  ready: boolean
}

export class CharacterStage {
  readonly ready: Promise<void>

  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private clock = new THREE.Clock()
  private slots: Slot[] = []
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private frame = 0
  private disposed = false
  private selected: CharacterId
  private hovered: CharacterId | null = null
  private canvas: HTMLCanvasElement
  private shadowMap: THREE.Texture
  private onReady?: () => void
  private time = 0

  constructor(options: StageOptions, selected: CharacterId) {
    this.canvas = options.canvas
    this.selected = selected
    this.onReady = options.onReady
    this.onSelect = options.onSelect
    const quality: StageQuality = options.quality ?? 'medium'

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.5))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.camera = new THREE.PerspectiveCamera(36, 2, 0.1, 60)
    this.camera.position.set(0, 1.66, 6.05)
    this.camera.lookAt(0, 0.94, 0)

    this.shadowMap = shadowTexture()
    this.buildLights()
    this.buildFloor()
    this.ready = this.buildRoster()
    this.attachPointer()
    this.loop()
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xdff0ff, 0x5c6b80, 1.05))
    const key = new THREE.DirectionalLight(0xfff3da, 1.85)
    key.position.set(3.2, 6.4, 4.6)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x9fd8ff, 0.85)
    rim.position.set(-3.4, 3.2, -5.2)
    this.scene.add(rim)
    const fill = new THREE.DirectionalLight(0xffffff, 0.4)
    fill.position.set(-2.4, 1.6, 4)
    this.scene.add(fill)
  }

  private buildFloor(): void {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(7.4, 48),
      new THREE.MeshBasicMaterial({ map: floorTexture(), transparent: true, depthWrite: false })
    )
    disc.rotation.x = -Math.PI / 2
    disc.position.y = -0.01
    this.scene.add(disc)
  }

  private async buildRoster(): Promise<void> {
    const count = CHARACTER_IDS.length
    for (let i = 0; i < count; i++) {
      const id = CHARACTER_IDS[i]
      const spec = CHARACTERS[id]
      const root = new THREE.Group()
      const offset = i - (count - 1) / 2
      const home = new THREE.Vector3(offset * SPACING, 0, -Math.abs(offset) * 0.42)
      root.position.copy(home)
      // The outer heroes turn slightly inwards, like a squad posing for a poster.
      root.rotation.y = -offset * 0.16
      this.scene.add(root)

      // The rigs look down -z by default (correct in-game); on the stage they
      // must face the player, so add half a turn.
      const avatar = new ModelAvatar({
        url: spec.model,
        height: spec.modelHeight,
        facing: spec.modelFacing + Math.PI,
        recolor: spec.recolor,
        gear: spec.gear,
        hideNodes: spec.hideNodes,
      })
      root.add(avatar.root)

      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.5),
        new THREE.MeshBasicMaterial({ map: this.shadowMap, transparent: true, depthWrite: false })
      )
      shadow.rotation.x = -Math.PI / 2
      shadow.position.y = 0.012
      root.add(shadow)

      const ringMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(spec.accent),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.66, 48, 1), ringMaterial)
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.02
      root.add(ring)

      const slot: Slot = { id, avatar, root, ring, ringMaterial, shadow, home, spin: 0, ready: false }
      this.slots.push(slot)
      void avatar.ready.then((ok) => {
        slot.ready = ok
        if (this.slots.every((item) => item.ready)) this.onReady?.()
      })
    }
  }

  private attachPointer(): void {
    this.canvas.addEventListener('pointermove', this.handleMove)
    this.canvas.addEventListener('pointerdown', this.handleDown)
    this.canvas.addEventListener('pointerleave', this.handleLeave)
  }

  private pick(event: PointerEvent): CharacterId | null {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    let best: CharacterId | null = null
    let bestDistance = Infinity
    for (const slot of this.slots) {
      if (!slot.ready) continue
      const hits = this.raycaster.intersectObject(slot.avatar.root, true)
      if (hits.length && hits[0].distance < bestDistance) {
        bestDistance = hits[0].distance
        best = slot.id
      }
    }
    return best
  }

  private handleMove = (event: PointerEvent): void => {
    const id = this.pick(event)
    this.hovered = id
    this.canvas.style.cursor = id ? 'pointer' : 'default'
  }

  private handleLeave = (): void => {
    this.hovered = null
    this.canvas.style.cursor = 'default'
  }

  private handleDown = (event: PointerEvent): void => {
    const id = this.pick(event)
    if (id) this.select(id)
  }

  /** Highlight a hero; also called when the HTML buttons pick one. */
  select(id: CharacterId, notify = true): void {
    this.selected = id
    for (const slot of this.slots) if (slot.id === id) slot.spin = Math.PI * 2
    if (notify) this.onSelect?.(id)
  }

  private onSelect?: (id: CharacterId) => void

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const width = Math.max(1, Math.floor(rect.width))
    const height = Math.max(1, Math.floor(rect.height))
    const current = this.renderer.getSize(new THREE.Vector2())
    if (current.x === width && current.y === height) return
    this.renderer.setSize(width, height, false)
    const aspect = width / height
    this.camera.aspect = aspect
    this.camera.fov = stageFov(aspect)
    this.camera.position.z = stageCameraZ(this.camera.fov, aspect)
    this.camera.updateProjectionMatrix()
  }

  private loop = (): void => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, this.clock.getDelta())
    this.time += dt
    this.resize()
    for (const slot of this.slots) {
      if (!slot.ready) continue
      const active = slot.id === this.selected
      const hovered = slot.id === this.hovered
      // Step forward when chosen, and give a small bob while hovering.
      const targetZ = slot.home.z + (active ? SELECT_LIFT : 0) + (hovered && !active ? 0.16 : 0)
      slot.root.position.z = THREE.MathUtils.damp(slot.root.position.z, targetZ, 8, dt)
      slot.root.position.y = THREE.MathUtils.damp(slot.root.position.y, active ? 0.02 : 0, 8, dt)
      const targetScale = active ? 1.06 : hovered ? 1.02 : 0.98
      const scale = THREE.MathUtils.damp(slot.root.scale.x, targetScale, 8, dt)
      slot.root.scale.setScalar(scale)

      if (slot.spin > 0.001) {
        // A quick flourish when a hero is picked.
        const step = Math.min(slot.spin, dt * 6)
        slot.root.rotation.y -= step
        slot.spin -= step
      } else {
        const target = -slot.home.x * 0.16 + (active ? 0 : 0)
        slot.root.rotation.y = THREE.MathUtils.damp(slot.root.rotation.y, target, 6, dt)
      }

      slot.ringMaterial.opacity = active ? 0.55 + Math.sin(this.time * 3.2) * 0.16 : hovered ? 0.24 : 0
      slot.ring.scale.setScalar(active ? 1 + Math.sin(this.time * 3.2) * 0.03 : 1)
      ;(slot.shadow.material as THREE.MeshBasicMaterial).opacity = active ? 1 : 0.72

      slot.avatar.update(dt, {
        speed01: 0,
        onGround: true,
        sliding: false,
        boosting: false,
        laneVelocity: 0,
        time: this.time,
        mode: 'menu',
      })
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.canvas.removeEventListener('pointermove', this.handleMove)
    this.canvas.removeEventListener('pointerdown', this.handleDown)
    this.canvas.removeEventListener('pointerleave', this.handleLeave)
    this.shadowMap.dispose()
    for (const slot of this.slots) {
      slot.avatar.dispose?.()
      slot.ringMaterial.dispose()
      slot.ring.geometry.dispose()
      ;(slot.shadow.material as THREE.MeshBasicMaterial).dispose()
      slot.shadow.geometry.dispose()
    }
    this.renderer.dispose()
  }
}
