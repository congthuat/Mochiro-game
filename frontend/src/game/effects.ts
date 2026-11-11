// Particle system, shockwave rings and telegraphed ground explosions.
import * as THREE from 'three'
import { randRange } from './utils'

const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`

const PARTICLE_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.06, d) * vAlpha;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(vColor, a);
  }
`

export interface BurstOptions {
  count: number
  color: number | number[]
  speed?: number
  speedVariance?: number
  life?: number
  lifeVariance?: number
  size?: number
  sizeEnd?: number
  gravity?: number
  drag?: number
  spreadY?: number
  velocity?: THREE.Vector3
}

export class ParticleSystem {
  readonly points: THREE.Points
  private capacity: number
  private positions: Float32Array
  private colors: Float32Array
  private sizes: Float32Array
  private alphas: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private maxLife: Float32Array
  private grav: Float32Array
  private drag: Float32Array
  private sizeStart: Float32Array
  private sizeEnd: Float32Array
  private cursor = 0
  private geometry: THREE.BufferGeometry
  private material: THREE.ShaderMaterial

  constructor(capacity: number) {
    this.capacity = capacity
    this.positions = new Float32Array(capacity * 3)
    this.colors = new Float32Array(capacity * 3)
    this.sizes = new Float32Array(capacity)
    this.alphas = new Float32Array(capacity)
    this.vel = new Float32Array(capacity * 3)
    this.life = new Float32Array(capacity)
    this.maxLife = new Float32Array(capacity)
    this.grav = new Float32Array(capacity)
    this.drag = new Float32Array(capacity)
    this.sizeStart = new Float32Array(capacity)
    this.sizeEnd = new Float32Array(capacity)

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3))
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1))
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)

    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }

  private colorAt(color: number | number[], rng: () => number): THREE.Color {
    if (Array.isArray(color)) {
      const hex = color[Math.floor(rng() * color.length)] ?? color[0]
      return new THREE.Color(hex)
    }
    return new THREE.Color(color)
  }

  burst(position: THREE.Vector3, opts: BurstOptions, rng: () => number = Math.random): void {
    const {
      count,
      speed = 6,
      speedVariance = 0.6,
      life = 0.7,
      lifeVariance = 0.4,
      size = 0.9,
      sizeEnd = 0.05,
      gravity = -6,
      drag = 1.6,
      spreadY = 1,
      velocity,
    } = opts

    for (let i = 0; i < count; i++) {
      const idx = this.cursor
      this.cursor = (this.cursor + 1) % this.capacity
      const p3 = idx * 3
      const c = this.colorAt(opts.color, rng)

      this.positions[p3] = position.x + randRange(rng, -0.25, 0.25)
      this.positions[p3 + 1] = position.y + randRange(rng, -0.25, 0.25)
      this.positions[p3 + 2] = position.z + randRange(rng, -0.25, 0.25)

      const theta = rng() * Math.PI * 2
      const phi = Math.acos(randRange(rng, -1, 1) * spreadY)
      const sp = speed * (1 + randRange(rng, -speedVariance, speedVariance))
      this.vel[p3] = Math.sin(phi) * Math.cos(theta) * sp + (velocity?.x ?? 0)
      this.vel[p3 + 1] = Math.cos(phi) * sp * 0.85 + (velocity?.y ?? 0)
      this.vel[p3 + 2] = Math.sin(phi) * Math.sin(theta) * sp + (velocity?.z ?? 0)

      const l = life * (1 + randRange(rng, -lifeVariance, lifeVariance))
      this.life[idx] = l
      this.maxLife[idx] = l
      this.grav[idx] = gravity
      this.drag[idx] = drag
      this.sizeStart[idx] = size * (1 + randRange(rng, -0.3, 0.6))
      this.sizeEnd[idx] = sizeEnd
      this.colors[p3] = c.r
      this.colors[p3 + 1] = c.g
      this.colors[p3 + 2] = c.b
      this.sizes[idx] = this.sizeStart[idx]
      this.alphas[idx] = 1
    }
  }

  update(dt: number): void {
    let alive = false
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        if (this.alphas[i] !== 0) this.alphas[i] = 0
        continue
      }
      alive = true
      const p3 = i * 3
      this.life[i] -= dt
      const t = Math.max(0, this.life[i] / this.maxLife[i])
      const damp = Math.exp(-this.drag[i] * dt)
      this.vel[p3] *= damp
      this.vel[p3 + 1] = this.vel[p3 + 1] * damp + this.grav[i] * dt
      this.vel[p3 + 2] *= damp
      this.positions[p3] += this.vel[p3] * dt
      this.positions[p3 + 1] += this.vel[p3 + 1] * dt
      this.positions[p3 + 2] += this.vel[p3 + 2] * dt
      this.sizes[i] = this.sizeEnd[i] + (this.sizeStart[i] - this.sizeEnd[i]) * t
      this.alphas[i] = t * t
      if (this.life[i] <= 0) this.alphas[i] = 0
    }
    if (!alive) return
    ;(this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

interface Ring {
  mesh: THREE.Mesh
  life: number
  maxLife: number
  from: number
  to: number
  active: boolean
}

interface Telegraph {
  mesh: THREE.Mesh
  delay: number
  duration: number
  radius: number
  position: THREE.Vector3
  color: THREE.Color
  onExplode: () => void
  exploded: boolean
  active: boolean
}

export class EffectsSystem {
  readonly group = new THREE.Group()
  private particles: ParticleSystem
  private rings: Ring[] = []
  private telegraphs: Telegraph[] = []
  private rng: () => number

  constructor(capacity: number, rng: () => number = Math.random) {
    this.rng = rng
    this.particles = new ParticleSystem(capacity)
    this.group.add(this.particles.points)

    const ringGeo = new THREE.RingGeometry(0.72, 1, 64)
    ringGeo.rotateX(-Math.PI / 2)
    const teleGeo = new THREE.RingGeometry(0.86, 1, 64)
    teleGeo.rotateX(-Math.PI / 2)

    for (let i = 0; i < 10; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(ringGeo, material)
      mesh.visible = false
      mesh.renderOrder = 4
      this.group.add(mesh)
      this.rings.push({ mesh, life: 0, maxLife: 1, from: 1, to: 1, active: false })
    }

    for (let i = 0; i < 8; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xff5566,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(teleGeo, material)
      mesh.visible = false
      mesh.renderOrder = 4
      this.group.add(mesh)
      this.telegraphs.push({
        mesh,
        delay: 0,
        duration: 1,
        radius: 4,
        position: new THREE.Vector3(),
        color: new THREE.Color(0xff5566),
        onExplode: () => undefined,
        exploded: false,
        active: false,
      })
    }
  }

  burst(position: THREE.Vector3, opts: BurstOptions): void {
    this.particles.burst(position, opts, this.rng)
  }

  shockwave(position: THREE.Vector3, radius: number, color: number, duration = 0.42, y = 0.12): void {
    const ring = this.rings.find((r) => !r.active)
    if (!ring) return
    ring.active = true
    ring.life = duration
    ring.maxLife = duration
    ring.from = radius * 0.25
    ring.to = radius * 1.05
    ring.mesh.visible = true
    ring.mesh.position.set(position.x, position.y + y, position.z)
    ring.mesh.scale.setScalar(ring.from)
    const mat = ring.mesh.material as THREE.MeshBasicMaterial
    mat.color.setHex(color)
    mat.opacity = 0.9
  }

  telegraph(
    position: THREE.Vector3,
    radius: number,
    delay: number,
    color: number,
    onExplode: () => void
  ): void {
    const t = this.telegraphs.find((item) => !item.active)
    if (!t) return
    t.active = true
    t.exploded = false
    t.delay = delay
    t.duration = delay
    t.radius = radius
    t.position.copy(position)
    t.color.setHex(color)
    t.onExplode = onExplode
    t.mesh.visible = true
    t.mesh.position.set(position.x, position.y + 0.1, position.z)
    t.mesh.scale.setScalar(radius * 0.1)
    const mat = t.mesh.material as THREE.MeshBasicMaterial
    mat.color.setHex(color)
    mat.opacity = 0.15
  }

  get activeTelegraphs(): number {
    return this.telegraphs.filter((t) => t.active).length
  }

  clearTelegraphs(): void {
    for (const t of this.telegraphs) {
      t.active = false
      t.exploded = false
      t.mesh.visible = false
    }
  }

  update(dt: number): void {
    this.particles.update(dt)

    for (const ring of this.rings) {
      if (!ring.active) continue
      ring.life -= dt
      const t = 1 - Math.max(0, ring.life) / ring.maxLife
      const scale = ring.from + (ring.to - ring.from) * t
      ring.mesh.scale.setScalar(scale)
      const mat = ring.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = 0.9 * Math.pow(1 - t, 1.6)
      if (ring.life <= 0) {
        ring.active = false
        ring.mesh.visible = false
      }
    }

    for (const t of this.telegraphs) {
      if (!t.active) continue
      t.delay -= dt
      const mat = t.mesh.material as THREE.MeshBasicMaterial
      if (t.delay > 0) {
        const progress = 1 - t.delay / t.duration
        t.mesh.scale.setScalar(t.radius * (0.1 + progress * 0.9))
        mat.opacity = 0.12 + progress * 0.45
      } else if (!t.exploded) {
        t.exploded = true
        mat.opacity = 0.75
        t.mesh.scale.setScalar(t.radius)
        this.burst(
          new THREE.Vector3(t.position.x, t.position.y + 0.6, t.position.z),
          {
            count: 46,
            color: [t.color.getHex(), 0xffffff],
            speed: t.radius * 4.2,
            life: 0.6,
            size: 1.1,
            gravity: -8,
            drag: 2.4,
            spreadY: 0.55,
          }
        )
        t.onExplode()
        t.delay = -0.22
      } else {
        mat.opacity = Math.max(0, mat.opacity - dt * 4)
        if (mat.opacity <= 0.01) {
          t.active = false
          t.mesh.visible = false
        }
      }
    }
  }

  dispose(): void {
    this.particles.dispose()
    for (const ring of this.rings) {
      ;(ring.mesh.material as THREE.Material).dispose()
      ring.mesh.geometry.dispose()
    }
    for (const t of this.telegraphs) {
      ;(t.mesh.material as THREE.Material).dispose()
      t.mesh.geometry.dispose()
    }
    this.rings = []
    this.telegraphs = []
  }
}

/** Drifting ambient motes that follow the player — pure atmosphere. */
export class MoteField {
  readonly points: THREE.Points
  private positions: Float32Array
  private geometry: THREE.BufferGeometry
  private material: THREE.PointsMaterial
  private count: number
  private range = 70
  private height = 34

  constructor(count: number, color: number, size = 0.55) {
    this.count = count
    this.positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * this.range * 2
      this.positions[i * 3 + 1] = Math.random() * this.height
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * this.range * 2
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    this.material = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
  }

  setColor(color: number): void {
    this.material.color.setHex(color)
  }

  update(dt: number, time: number, center: THREE.Vector3): void {
    const span = this.range * 2
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3
      this.positions[i3 + 1] += dt * (0.5 + (i % 5) * 0.12)
      this.positions[i3] += Math.sin(time * 0.3 + i) * dt * 0.4
      if (this.positions[i3 + 1] > this.height) this.positions[i3 + 1] = 0
      // Wrap around the moving centre so motes are always present.
      const dx = this.positions[i3] - (center.x - this.points.position.x)
      if (dx > this.range) this.positions[i3] -= span
      else if (dx < -this.range) this.positions[i3] += span
      const dz = this.positions[i3 + 2] - (center.z - this.points.position.z)
      if (dz > this.range) this.positions[i3 + 2] -= span
      else if (dz < -this.range) this.positions[i3 + 2] += span
    }
    this.points.position.set(center.x, 0, center.z)
    ;(this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
