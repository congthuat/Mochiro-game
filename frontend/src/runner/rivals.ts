// Mochiro — the other racers in a live race, drawn on the road beside you.
//
// Every racer runs the same road on their own device, so a rival is never simulated
// here: their game sends where they are ten times a second, and this layer plays that
// back a beat late (so there is always a sample on each side to blend between) at the
// right distance from the local runner. Rivals never collide with you or each other.
import * as THREE from 'three'
import { CHARACTERS, LANES, type CharacterId } from './config'
import { RunnerAvatar } from './player'
import { ModelAvatar } from './model'
import { speedLevel } from './effects'
import type { ResolvedQuality } from './types'

/** Bit flags a racer sends with each sample: what protected them on that frame. */
export const RIVAL_FLAG = { shield: 1, boost: 2, ghost: 4, invuln: 8 } as const
/** Any of these means an obstacle could not have stopped them on that frame. */
export const PROTECTED = RIVAL_FLAG.shield | RIVAL_FLAG.boost | RIVAL_FLAG.ghost | RIVAL_FLAG.invuln

export interface RivalSample {
  /** Seconds since the race's "go" on the sender's clock. */
  t: number
  /** Metres run. */
  d: number
  x: number
  y: number
  sl: boolean
  f: number
}

export interface RivalPose {
  d: number
  x: number
  y: number
  sliding: boolean
  flags: number
  /** Metres per second along the road. */
  speed: number
  onGround: boolean
}

export interface RivalInfo {
  id: string
  name: string
  character: CharacterId
}

/** How far behind the newest sample a rival is played back, in seconds. */
const DELAY = 0.14
/** Never guess more than this far past the last sample (a dropped packet or two). */
const EXTRAPOLATE = 0.3
/** Drawn only within this window around the local runner (metres, +z is behind). */
const AHEAD = 170
const BEHIND = 14

interface FadeMaterial {
  material: THREE.Material & { opacity: number }
  transparent: boolean
  opacity: number
  depthWrite: boolean
}

interface Rival {
  info: RivalInfo
  avatar: RunnerAvatar | ModelAvatar
  tag: THREE.Sprite
  samples: RivalSample[]
  /** Local seconds minus sender seconds, tracked as the lowest seen (the least-delayed packet). */
  offset: number | null
  out: boolean
  outAt: number
  pose: RivalPose
  lastX: number
  fades: FadeMaterial[]
  faded: number
  disposed: boolean
}

function nameTag(name: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const label = name.length > 16 ? `${name.slice(0, 15)}…` : name
    ctx.font = '700 30px system-ui, -apple-system, Segoe UI, sans-serif'
    const width = Math.min(248, ctx.measureText(label).width + 34)
    const left = (256 - width) / 2
    ctx.fillStyle = 'rgba(6, 10, 28, 0.78)'
    ctx.beginPath()
    ctx.roundRect(left, 8, width, 48, 24)
    ctx.fill()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(left + 20, 32, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, left + 32, 33)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(2.2, 0.55, 1)
  sprite.renderOrder = 5
  return sprite
}

/** A stable colour per player for the tag dot and the HUD list. */
export function rivalColor(id: string): string {
  const palette = ['#ff6b9a', '#5ad1ff', '#ffd45e', '#8cff8a', '#c59bff', '#ff9f5a']
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return palette[Math.abs(hash) % palette.length]
}

export class RivalLayer {
  private readonly scene: THREE.Scene
  private readonly quality: ResolvedQuality
  private readonly rivals = new Map<string, Rival>()

  constructor(scene: THREE.Scene, quality: ResolvedQuality) {
    this.scene = scene
    this.quality = quality
  }

  has(id: string): boolean {
    return this.rivals.has(id)
  }

  add(info: RivalInfo): void {
    if (this.rivals.has(info.id)) return
    const spec = CHARACTERS[info.character] ?? CHARACTERS.kai
    const avatar = new RunnerAvatar(spec)
    avatar.root.visible = false
    this.scene.add(avatar.root)
    const tag = nameTag(info.name, rivalColor(info.id))
    tag.visible = false
    this.scene.add(tag)
    const rival: Rival = {
      info,
      avatar,
      tag,
      samples: [],
      offset: null,
      out: false,
      outAt: 0,
      pose: { d: 0, x: 0, y: 0, sliding: false, flags: 0, speed: 0, onGround: true },
      lastX: 0,
      fades: [],
      faded: 1,
      disposed: false,
    }
    this.collectFades(rival)
    this.rivals.set(info.id, rival)
    // Weak devices keep the light procedural runner; everyone else gets the real model.
    if (this.quality !== 'low' && spec.model) void this.upgrade(rival)
  }

  private async upgrade(rival: Rival): Promise<void> {
    const spec = CHARACTERS[rival.info.character] ?? CHARACTERS.kai
    if (!spec.model) return
    const model = new ModelAvatar({
      url: spec.model,
      height: spec.modelHeight,
      facing: spec.modelFacing,
      recolor: spec.recolor,
      gear: spec.gear,
      hideNodes: spec.hideNodes,
      persona: spec.persona,
      sleeve: spec.persona ? spec.outfit : undefined,
    })
    const ok = await model.ready
    if (!ok || rival.disposed) {
      model.dispose()
      return
    }
    const old = rival.avatar
    model.root.position.copy(old.root.position)
    model.root.visible = old.root.visible
    this.scene.remove(old.root)
    this.restoreFades(rival)
    old.dispose()
    rival.avatar = model
    this.scene.add(model.root)
    this.collectFades(rival)
  }

  private collectFades(rival: Rival): void {
    rival.fades = []
    rival.faded = 1
    rival.avatar.root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of list) {
        if (!material || rival.fades.some((item) => item.material === material)) continue
        const m = material as THREE.Material & { opacity: number }
        rival.fades.push({ material: m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite })
      }
    })
  }

  private restoreFades(rival: Rival): void {
    this.setFade(rival, 1)
  }

  private setFade(rival: Rival, k: number): void {
    if (Math.abs(rival.faded - k) < 0.01) return
    rival.faded = k
    for (const item of rival.fades) {
      const solid = k >= 0.999
      item.material.transparent = solid ? item.transparent : true
      item.material.opacity = item.opacity * k
      item.material.depthWrite = solid ? item.depthWrite : false
      item.material.needsUpdate = true
    }
  }

  remove(id: string): void {
    const rival = this.rivals.get(id)
    if (!rival) return
    rival.disposed = true
    this.scene.remove(rival.avatar.root)
    this.scene.remove(rival.tag)
    this.restoreFades(rival)
    rival.avatar.dispose()
    rival.tag.material.map?.dispose()
    rival.tag.material.dispose()
    this.rivals.delete(id)
  }

  /** A racer is out: they stop on the road and fade away a moment later. */
  setOut(id: string, out: boolean): void {
    const rival = this.rivals.get(id)
    if (!rival || rival.out === out) return
    rival.out = out
    rival.outAt = performance.now() / 1000
  }

  push(id: string, sample: RivalSample): void {
    const rival = this.rivals.get(id)
    if (!rival) return
    const now = performance.now() / 1000
    const o = now - sample.t
    // Track the least-delayed packet, letting the estimate creep up slowly so a clock
    // that drifts (or one lucky early packet) cannot freeze playback forever.
    rival.offset = rival.offset === null ? o : Math.min(rival.offset + 0.01, o)
    const list = rival.samples
    const last = list[list.length - 1]
    if (last && sample.t <= last.t) return
    list.push(sample)
    if (list.length > 40) list.splice(0, list.length - 40)
  }

  /** Where a racer is right now, as played back (null before their first sample). */
  pose(id: string): RivalPose | null {
    const rival = this.rivals.get(id)
    if (!rival || !rival.samples.length) return null
    this.sample(rival)
    return rival.pose
  }

  private sample(rival: Rival): void {
    const list = rival.samples
    const now = performance.now() / 1000
    const at = now - (rival.offset ?? 0) - DELAY
    const pose = rival.pose
    let i = list.length - 1
    while (i > 0 && list[i - 1].t > at) i--
    const b = list[i]
    const a = i > 0 ? list[i - 1] : b
    if (at >= b.t) {
      // Past the newest sample: carry on at its speed for a moment, then hold.
      const prev = list[list.length - 2]
      const speed = prev && b.t > prev.t ? (b.d - prev.d) / (b.t - prev.t) : pose.speed
      const ahead = rival.out ? 0 : Math.min(EXTRAPOLATE, at - b.t)
      pose.d = b.d + speed * ahead
      pose.x = b.x
      pose.y = b.y
      pose.sliding = b.sl
      pose.flags = b.f
      pose.speed = rival.out ? 0 : speed
    } else if (a === b || at <= a.t) {
      pose.d = a.d
      pose.x = a.x
      pose.y = a.y
      pose.sliding = a.sl
      pose.flags = a.f
    } else {
      const k = (at - a.t) / (b.t - a.t)
      pose.d = a.d + (b.d - a.d) * k
      pose.x = a.x + (b.x - a.x) * k
      pose.y = a.y + (b.y - a.y) * k
      pose.sliding = k < 0.5 ? a.sl : b.sl
      // Either neighbour protected means this frame may have been protected too.
      pose.flags = a.f | b.f
      pose.speed = (b.d - a.d) / (b.t - a.t)
    }
    pose.onGround = pose.y < 0.05 || Math.abs((b.y ?? 0) - (a.y ?? 0)) < 0.01
  }

  /**
   * Places every rival at its distance from the local runner (`origin` is the local
   * runner's distance) and animates it. `localX` is where the local runner stands, so
   * a rival right on top of them can step aside visually; null while spectating.
   */
  update(dt: number, origin: number, localX: number | null, time: number): void {
    const now = performance.now() / 1000
    for (const rival of this.rivals.values()) {
      if (!rival.samples.length) {
        rival.avatar.root.visible = false
        rival.tag.visible = false
        continue
      }
      this.sample(rival)
      const pose = rival.pose
      const z = origin - pose.d
      const gone = rival.out && now - rival.outAt > 0.9
      const visible = !gone && z > -AHEAD && z < BEHIND
      rival.avatar.root.visible = visible
      rival.tag.visible = visible
      if (!visible) continue
      const laneVelocity = dt > 0 ? (pose.x - rival.lastX) / dt : 0
      rival.lastX = pose.x
      rival.avatar.root.position.set(pose.x, pose.y, z)
      rival.avatar.setShieldLevel(pose.flags & RIVAL_FLAG.shield ? 1 : 0)
      rival.avatar.update(dt, {
        speed01: speedLevel(Math.max(8, pose.speed)),
        onGround: pose.onGround,
        sliding: pose.sliding,
        boosting: Boolean(pose.flags & RIVAL_FLAG.boost),
        laneVelocity: Math.max(-30, Math.min(30, laneVelocity)),
        time,
        mode: rival.out ? 'gameover' : 'playing',
      })
      rival.tag.position.set(pose.x, pose.y + (pose.sliding ? 1.5 : 2.45), z)
      // Only a rival right on top of the local runner (in the camera's way) fades.
      const inTheWay = localX !== null && z > -2.5 && z < 2.5 && Math.abs(pose.x - localX) < 1.4
      this.setFade(rival, inTheWay ? 0.38 : 1)
      const fadeTag = rival.tag.material
      fadeTag.opacity = inTheWay ? 0.5 : 1
    }
  }

  /**
   * Before the start: everyone stands at the line beside the local runner (who is in the
   * middle lane), so the countdown shows who you race and their models are drawn once
   * before the clock starts.
   */
  lineUp(dt: number, time: number): void {
    const spots: [number, number][] = [[LANES[0], -1.6], [LANES[2], -1.6], [LANES[1], -5]]
    let i = 0
    for (const rival of this.rivals.values()) {
      const [x, z] = spots[i % spots.length]
      const row = Math.floor(i / spots.length)
      i++
      rival.avatar.root.visible = true
      rival.tag.visible = true
      rival.avatar.root.position.set(x, 0, z - row * 3)
      rival.avatar.update(dt, { speed01: 0, onGround: true, sliding: false, boosting: false, laneVelocity: 0, time, mode: 'playing' })
      rival.tag.position.set(x, 2.45, z - row * 3)
      this.setFade(rival, 1)
    }
  }

  dispose(): void {
    for (const id of [...this.rivals.keys()]) this.remove(id)
  }
}
