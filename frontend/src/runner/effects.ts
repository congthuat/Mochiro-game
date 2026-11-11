// Runtime effects: pooled sparks/particles and the speed streaks that sell the
// velocity of the run.
import * as THREE from 'three'
import { RUN } from './config'

export interface BurstOptions {
  count: number
  color: number
  speed: number
  spread?: number
  life?: number
  size?: number
  gravity?: number
  rise?: number
}

const HIDDEN_Y = -999

export class SparkSystem {
  readonly points: THREE.Points

  private capacity: number
  private positions: Float32Array
  private colors: Float32Array
  private velocities: Float32Array
  private life: Float32Array
  private maxLife: Float32Array
  private gravity: Float32Array
  private cursor = 0
  private geometry: THREE.BufferGeometry
  private material: THREE.PointsMaterial
  private color = new THREE.Color()

  constructor(capacity: number, size = 0.34) {
    this.capacity = capacity
    this.positions = new Float32Array(capacity * 3)
    this.colors = new Float32Array(capacity * 3)
    this.velocities = new Float32Array(capacity * 3)
    this.life = new Float32Array(capacity)
    this.maxLife = new Float32Array(capacity)
    this.gravity = new Float32Array(capacity)
    for (let i = 0; i < capacity; i++) this.positions[i * 3 + 1] = HIDDEN_Y

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    this.material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
  }

  setSize(size: number): void {
    this.material.size = size
  }

  burst(x: number, y: number, z: number, options: BurstOptions): void {
    const count = Math.min(options.count, this.capacity)
    const spread = options.spread ?? 1
    const life = options.life ?? 0.6
    const gravity = options.gravity ?? 14
    const rise = options.rise ?? 0
    this.color.setHex(options.color)
    for (let i = 0; i < count; i++) {
      const index = this.cursor
      this.cursor = (this.cursor + 1) % this.capacity
      const i3 = index * 3
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      const magnitude = options.speed * (0.4 + Math.random() * 0.8)
      this.positions[i3] = x + (Math.random() - 0.5) * 0.2
      this.positions[i3 + 1] = y + (Math.random() - 0.5) * 0.2
      this.positions[i3 + 2] = z + (Math.random() - 0.5) * 0.2
      this.velocities[i3] = Math.sin(phi) * Math.cos(theta) * magnitude * spread
      this.velocities[i3 + 1] = Math.abs(Math.sin(phi)) * magnitude * 0.7 + rise
      this.velocities[i3 + 2] = Math.sin(phi) * Math.sin(theta) * magnitude * spread
      const tint = 0.75 + Math.random() * 0.45
      this.colors[i3] = this.color.r * tint
      this.colors[i3 + 1] = this.color.g * tint
      this.colors[i3 + 2] = this.color.b * tint
      this.life[index] = life * (0.6 + Math.random() * 0.7)
      this.maxLife[index] = this.life[index]
      this.gravity[index] = gravity
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.color.needsUpdate = true
  }

  update(dt: number, dz: number): void {
    let dirty = false
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue
      const i3 = i * 3
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.positions[i3 + 1] = HIDDEN_Y
        dirty = true
        continue
      }
      this.velocities[i3 + 1] -= this.gravity[i] * dt
      this.positions[i3] += this.velocities[i3] * dt
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt + dz
      const fade = this.life[i] / this.maxLife[i]
      this.colors[i3] *= 0.94 + fade * 0.06
      this.colors[i3 + 1] *= 0.94 + fade * 0.06
      this.colors[i3 + 2] *= 0.94 + fade * 0.06
      dirty = true
    }
    if (dirty) {
      this.geometry.attributes.position.needsUpdate = true
      this.geometry.attributes.color.needsUpdate = true
    }
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

/**
 * Soft tapered streak sprite. A hard-edged bar (a bare PlaneGeometry) reads as a
 * rendering glitch once it is stretched across the frame, so every streak gets a
 * gradient that fades out at both ends and along its long edges.
 */
function streakTexture(): THREE.Texture {
  const width = 32
  const height = 256
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const along = ctx.createLinearGradient(0, 0, 0, height)
    along.addColorStop(0, 'rgba(255,255,255,0)')
    along.addColorStop(0.3, 'rgba(255,255,255,0.32)')
    along.addColorStop(0.5, 'rgba(255,255,255,1)')
    along.addColorStop(0.7, 'rgba(255,255,255,0.32)')
    along.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = along
    ctx.fillRect(0, 0, width, height)
    // Erase the long edges so the streak has no hard vertical seam either.
    const across = ctx.createLinearGradient(0, 0, width, 0)
    across.addColorStop(0, 'rgba(0,0,0,1)')
    across.addColorStop(0.5, 'rgba(0,0,0,0)')
    across.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = across
    ctx.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'source-over'
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Ground rush. At speed the road itself starts streaking past the runner: soft
 * tapered dashes lying flat on the tarmac that swell and fly by the camera.
 * They live on the road surface, so the effect always reads as motion — unlike
 * billboarded bars, which the eye reads as a rendering fault.
 */
export class SpeedLines {
  readonly mesh: THREE.InstancedMesh

  private count: number
  private z: Float32Array
  private x: Float32Array
  private length: Float32Array
  private width: Float32Array
  private material: THREE.MeshBasicMaterial
  private geometry: THREE.PlaneGeometry
  private texture: THREE.Texture
  private matrix = new THREE.Matrix4()
  private quat = new THREE.Quaternion()
  private pos = new THREE.Vector3()
  private scale = new THREE.Vector3()
  private tint = new THREE.Color()

  constructor(capacity: number) {
    this.count = capacity
    this.geometry = new THREE.PlaneGeometry(1, 1)
    this.geometry.rotateX(-Math.PI / 2)
    this.texture = streakTexture()
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      color: 0xfff2d8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, Math.max(1, capacity))
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.visible = capacity > 0
    this.mesh.renderOrder = 3
    this.z = new Float32Array(Math.max(1, capacity))
    this.x = new Float32Array(Math.max(1, capacity))
    this.length = new Float32Array(Math.max(1, capacity))
    this.width = new Float32Array(Math.max(1, capacity))
    for (let i = 0; i < capacity; i++) this.reset(i, -6 - Math.random() * 46)
  }

  private reset(index: number, z = -6 - Math.random() * 46): void {
    // Spread across the tarmac, biased towards the lanes the runner is not in,
    // so the dashes never sit on top of the character.
    const side = Math.random() < 0.5 ? -1 : 1
    this.x[index] = side * (1.4 + Math.random() * 3.1)
    this.z[index] = z
    this.length[index] = 2.4 + Math.random() * 4.2
    this.width[index] = 0.07 + Math.random() * 0.1
    const fade = 0.45 + Math.random() * 0.55
    this.tint.setRGB(fade, fade * 0.97, fade * 0.88)
    this.mesh.setColorAt(index, this.tint)
  }

  update(dt: number, speed: number, intensity: number): void {
    // Only visible once the run is genuinely fast.
    this.material.opacity = Math.max(0, intensity - 0.45) * 0.5
    if (this.count === 0) return
    const dz = speed * dt * 1.2
    const stretch = 0.6 + intensity * 0.9
    for (let i = 0; i < this.count; i++) {
      this.z[i] += dz
      // Recycle before the camera so nothing flashes past the lens.
      if (this.z[i] > 3) this.reset(i, -40 - Math.random() * 22)
      this.pos.set(this.x[i], 0.012, this.z[i])
      this.scale.set(this.width[i], this.length[i] * stretch, 1)
      this.matrix.compose(this.pos, this.quat, this.scale)
      this.mesh.setMatrixAt(i, this.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
  }
}

/** Small helper so callers can pass either the raw speed or a 0..1 level. */
export const speedLevel = (speed: number): number =>
  Math.max(0, Math.min(1, (speed - RUN.startSpeed) / (RUN.maxSpeed - RUN.startSpeed)))

// ---------------------------------------------------------------- pickups --
export interface RingOptions {
  color: number
  radius: number
  life?: number
  spin?: number
  /** Ring thickness as a fraction of the radius. */
  thickness?: number
}

/**
 * Billboarding shockwave rings. Every pickup punches one out: a small tight ring
 * for a coin, a pair of wide ones for a power-up, so the pickup reads instantly
 * even in the corner of the eye.
 */
export class ShockRings {
  readonly group = new THREE.Group()

  private rings: {
    mesh: THREE.Mesh
    material: THREE.MeshBasicMaterial
    life: number
    maxLife: number
    radius: number
    spin: number
    tilt: number
  }[] = []
  private cursor = 0

  constructor(capacity = 10) {
    const geometry = new THREE.RingGeometry(0.7, 1, 48, 1)
    for (let i = 0; i < capacity; i++) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.renderOrder = 6
      this.group.add(mesh)
      this.rings.push({ mesh, material, life: 0, maxLife: 1, radius: 1, spin: 0, tilt: 0 })
    }
  }

  burst(x: number, y: number, z: number, options: RingOptions): void {
    const ring = this.rings[this.cursor]
    this.cursor = (this.cursor + 1) % this.rings.length
    ring.maxLife = options.life ?? 0.42
    ring.life = ring.maxLife
    ring.radius = options.radius
    ring.spin = options.spin ?? 0
    ring.tilt = Math.random() * Math.PI * 2
    ring.material.color.setHex(options.color)
    ring.material.opacity = 1
    ring.mesh.position.set(x, y, z)
    ring.mesh.scale.setScalar(options.radius * 0.3)
    ring.mesh.visible = true
  }

  get activeCount(): number {
    let count = 0
    for (const ring of this.rings) if (ring.life > 0) count++
    return count
  }

  update(dt: number, dz: number, camera: THREE.Camera): void {
    for (const ring of this.rings) {
      if (ring.life <= 0) continue
      ring.life -= dt
      if (ring.life <= 0) {
        ring.mesh.visible = false
        continue
      }
      const t = 1 - ring.life / ring.maxLife
      const eased = 1 - (1 - t) * (1 - t) * (1 - t)
      ring.mesh.position.z += dz
      ring.mesh.scale.setScalar(ring.radius * (0.3 + 0.7 * eased))
      ring.material.opacity = (1 - t) * (1 - t) * 0.9
      ring.mesh.quaternion.copy(camera.quaternion)
      ring.mesh.rotateZ(ring.tilt + ring.spin * t)
    }
  }

  dispose(): void {
    for (const ring of this.rings) ring.material.dispose()
    this.rings[0]?.mesh.geometry.dispose()
  }
}

/**
 * Ghost coins that pop off a collected pickup and fly into the HUD counter. This
 * is the trick that makes collecting feel like a reward instead of a deletion:
 * the coin is not removed, it is *banked*.
 */
export class FlyCoins {
  readonly group = new THREE.Group()

  private coins: {
    sprite: THREE.Sprite
    material: THREE.SpriteMaterial
    life: number
    maxLife: number
    size: number
    spin: number
    rise: number
  }[] = []
  private cursor = 0
  private origin = new THREE.Vector3()
  private target = new THREE.Vector3()

  constructor(texture: THREE.Texture | null, capacity = 28) {
    for (let i = 0; i < capacity; i++) {
      const material = new THREE.SpriteMaterial({
        map: texture ?? undefined,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      })
      const sprite = new THREE.Sprite(material)
      sprite.visible = false
      sprite.frustumCulled = false
      sprite.renderOrder = 20
      this.group.add(sprite)
      this.coins.push({ sprite, material, life: 0, maxLife: 1, size: 0.5, spin: 0, rise: 0 })
    }
  }

  pop(x: number, y: number, z: number, size = 0.5): void {
    const coin = this.coins[this.cursor]
    this.cursor = (this.cursor + 1) % this.coins.length
    coin.maxLife = 0.46
    coin.life = coin.maxLife
    coin.size = size
    coin.spin = 6 + Math.random() * 5
    coin.rise = 0.5 + Math.random() * 0.35
    coin.material.rotation = Math.random() * Math.PI
    coin.material.opacity = 1
    coin.sprite.position.set(x, y, z)
    coin.sprite.scale.setScalar(size)
    coin.sprite.visible = true
  }

  get activeCount(): number {
    let count = 0
    for (const coin of this.coins) if (coin.life > 0) count++
    return count
  }

  update(dt: number, dz: number, camera: THREE.Camera, anchor: THREE.Vector3): void {
    for (const coin of this.coins) {
      if (coin.life <= 0) continue
      coin.life -= dt
      const sprite = coin.sprite
      if (coin.life <= 0) {
        sprite.visible = false
        continue
      }
      const t = 1 - coin.life / coin.maxLife
      this.origin.copy(sprite.position)
      this.origin.z += dz
      sprite.position.copy(this.origin)
      sprite.material.rotation += coin.spin * dt

      if (t < 0.22) {
        // Pop: a quick swell upward before the coin is banked.
        const p = t / 0.22
        sprite.scale.setScalar(coin.size * (1 + p * 0.55))
        sprite.position.y += coin.rise * p * dt * 6
      } else {
        const p = (t - 0.22) / 0.78
        const eased = p * p * (3 - 2 * p)
        this.target.copy(anchor)
        sprite.position.lerp(this.target, 1 - Math.exp(-(6 + 16 * eased) * dt))
        sprite.scale.setScalar(coin.size * (1.55 - 1.15 * eased))
        coin.material.opacity = p > 0.78 ? Math.max(0, (1 - p) / 0.22) : 1
      }
    }
  }

  dispose(): void {
    for (const coin of this.coins) coin.material.dispose()
  }
}
