// Pickups: Arc coins (the real project icon on a glowing disc) and power-ups.
import * as THREE from 'three'
import { LANES, PALETTE, POWERS, POWER_BY_KIND, RUN, type QualityPreset } from './config'
import { powerGlyph } from './glyphs'
import { glowTexture } from './textures'
import type { PowerKind } from './types'

export interface Coin {
  mesh: THREE.Mesh
  active: boolean
  x: number
  y: number
  z: number
  spin: number
  line: number
  collected: boolean
}

export interface PowerUp {
  mesh: THREE.Group
  kind: PowerKind
  active: boolean
  x: number
  y: number
  z: number
  spin: number
}

const COIN_RADIUS = 0.42
const COIN_SPACING = 2.45
const POWER_COLORS: Record<PowerKind, number> = POWERS.reduce(
  (map, spec) => {
    map[spec.kind] = new THREE.Color(spec.colour).getHex()
    return map
  },
  {} as Record<PowerKind, number>
)

/** Good pickups wear a smooth halo, hazards wear a spiked collar. */
const HAZARD_COLOUR = new THREE.Color('#ff4d6a').getHex()

export class PickupManager {
  /**
   * Reach of the magnet, in metres. The Runner writes this every frame from the
   * hero's perk, so the archer's field is wider than everyone else's.
   */
  magnetRadius = RUN.magnetRadius
  /** Pull that works with no magnet running (Mike's perk); 0 for everyone else. */
  passiveReach = 0

  readonly group = new THREE.Group()

  coins: Coin[] = []
  powers: PowerUp[] = []

  private coinCap: number
  private powerCap: number
  private coinGeometry: THREE.CylinderGeometry
  private coinRim: THREE.MeshStandardMaterial
  private coinFace: THREE.MeshStandardMaterial
  private glowTex: THREE.CanvasTexture
  private glowMat: THREE.MeshBasicMaterial
  private glowGeo: THREE.PlaneGeometry
  private disposables: Array<{ dispose: () => void }> = []
  private powerMaterials: Record<PowerKind, THREE.MeshStandardMaterial>

  constructor(preset: QualityPreset, coinTexture: THREE.Texture) {
    this.coinCap = preset.maxCoins
    this.powerCap = 6

    this.coinGeometry = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, 0.08, 36, 1)
    this.coinRim = new THREE.MeshStandardMaterial({
      color: 0xffd45e,
      emissive: new THREE.Color(0xffb02e),
      emissiveIntensity: 0.35,
      metalness: 0.85,
      roughness: 0.25,
    })
    this.coinFace = new THREE.MeshStandardMaterial({
      map: coinTexture,
      emissiveMap: coinTexture,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.24,
      metalness: 0.3,
      roughness: 0.42,
    })

    this.glowTex = glowTexture('rgba(255, 226, 150, 0.85)', 'rgba(255, 170, 40, 0)')
    this.glowMat = new THREE.MeshBasicMaterial({
      map: this.glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.75,
    })
    this.glowGeo = new THREE.PlaneGeometry(1.7, 1.7)

    // One tinted material per pickup kind; the glyph's vertex colours supply the
    // shading, so white bodies take the tint and the accents stay dark.
    this.powerMaterials = POWERS.reduce(
      (map, spec) => {
        map[spec.kind] = new THREE.MeshStandardMaterial({
          color: new THREE.Color(spec.colour).getHex(),
          emissive: new THREE.Color(spec.colour),
          emissiveIntensity: spec.harmful ? 1.15 : 1.4,
          metalness: 0.45,
          roughness: 0.34,
          vertexColors: true,
        })
        return map
      },
      {} as Record<PowerKind, THREE.MeshStandardMaterial>
    )

    this.disposables.push(
      this.coinGeometry,
      this.coinRim,
      this.coinFace,
      this.glowTex,
      this.glowMat,
      this.glowGeo,
      ...Object.values(this.powerMaterials)
    )
  }

  setQuality(preset: QualityPreset): void {
    this.coinCap = preset.maxCoins
  }

  reset(): void {
    for (const coin of this.coins) {
      coin.active = false
      coin.collected = false
      coin.mesh.visible = false
    }
    for (const power of this.powers) {
      power.active = false
      power.mesh.visible = false
    }
  }

  /** The minted coin face, shared with the ghost coins that fly into the HUD. */
  get faceTexture(): THREE.Texture | null {
    return this.coinFace.map
  }

  /** QA: one coin parked in world space so the mint artwork can be reviewed. */
  showcase(): THREE.Mesh {
    const mesh = new THREE.Mesh(this.coinGeometry, [this.coinRim, this.coinFace, this.coinFace])
    mesh.position.set(0, 1.05, -2.6)
    mesh.rotation.set(Math.PI / 2, 0.34, 0)
    this.group.add(mesh)
    return mesh
  }

  /** QA: park a pickup in front of the camera so its glyph can be reviewed. */
  showcasePower(kind: PowerKind): THREE.Group | null {
    const power = this.acquirePower(kind)
    if (!power) return null
    power.active = false
    power.mesh.visible = true
    power.mesh.position.set(0, 1.15, -2.6)
    return power.mesh
  }

  /** QA: is the Arc coin texture attached to the visible coin meshes? */
  get debugInfo(): { textureReady: boolean; active: number; powers: number } {
    return {
      textureReady: Boolean(this.coinFace.map?.image),
      active: this.activeCoins,
      powers: this.powers.filter((item) => item.active).length,
    }
  }

  get activeCoins(): number {
    let count = 0
    for (const coin of this.coins) if (coin.active) count++
    return count
  }

  /**
   * Spawn a run of coins. `style` shapes the run:
   *  - flat: straight line down the lane
   *  - arc:  a jump arc (rewards clearing a low obstacle)
   *  - wave: sine wave across the lane (keeps the player weaving)
   */
  spawnLine(lane: number, z: number, count: number, style: 'flat' | 'arc' | 'wave' | 'roof', line: number): void {
    const baseX = LANES[Math.max(0, Math.min(LANES.length - 1, lane))]
    for (let i = 0; i < count; i++) {
      const coin = this.acquireCoin()
      if (!coin) return
      const t = count > 1 ? i / (count - 1) : 0
      let y = 0.95
      let x = baseX
      if (style === 'arc') y = 0.95 + Math.sin(Math.PI * t) * 1.75
      if (style === 'wave') x = baseX + Math.sin(t * Math.PI * 2) * 0.55
      // Roof line: floats at car-roof height so the ramp launch pays out.
      if (style === 'roof') y = 1.95 + Math.sin(Math.PI * t) * 0.35
      coin.active = true
      coin.collected = false
      coin.line = line
      coin.x = x
      coin.y = y
      coin.z = z - i * COIN_SPACING
      coin.spin = Math.random() * Math.PI * 2
      coin.mesh.visible = true
      coin.mesh.position.set(coin.x, coin.y, coin.z)
    }
  }

  spawnPower(kind: PowerKind, lane: number, z: number): void {
    const power = this.acquirePower(kind)
    if (!power) return
    power.active = true
    power.kind = kind
    power.x = LANES[Math.max(0, Math.min(LANES.length - 1, lane))]
    power.y = 1.15
    power.z = z
    power.spin = 0
    power.mesh.visible = true
    power.mesh.position.set(power.x, power.y, power.z)
  }

  update(dt: number, speed: number, time: number, magnet: boolean, target: THREE.Vector3): void {
    const dz = speed * dt
    for (const coin of this.coins) {
      if (!coin.active) continue
      coin.z += dz
      coin.spin += dt * 2.6

      const reach = magnet ? this.magnetRadius : this.passiveReach
      if (reach > 0) {
        const dx = target.x - coin.x
        const dy = target.y + 0.9 - coin.y
        const dzTo = target.z - coin.z
        const distance = Math.hypot(dx, dy, dzTo)
        if (distance < reach) {
          const closeness = 1 - distance / reach
          const pull = Math.min(1, 1 - Math.exp(-(18 + 22 * closeness) * dt))
          coin.x += dx * pull
          coin.y += dy * pull
          coin.z += dzTo * pull * 0.85
        }
      }

      if (coin.z > RUN.despawnZ) {
        coin.active = false
        coin.mesh.visible = false
        continue
      }
      coin.mesh.position.set(coin.x, coin.y + Math.sin(time * 3 + coin.spin) * 0.06, coin.z)
      coin.mesh.rotation.set(Math.PI / 2, coin.spin, 0)
    }

    for (const power of this.powers) {
      if (!power.active) continue
      power.z += dz
      power.spin += dt * 1.8
      if (power.z > RUN.despawnZ) {
        power.active = false
        power.mesh.visible = false
        continue
      }
      power.mesh.position.set(power.x, power.y + Math.sin(time * 2.4 + power.spin) * 0.12, power.z)
      const spinner = power.mesh.children[0]
      spinner.rotation.y = power.spin
      spinner.rotation.x = Math.sin(time * 1.3) * 0.18
    }
  }

  /** Hides a collected coin (the runner picks it up). */
  take(coin: Coin): void {
    coin.active = false
    coin.collected = true
    coin.mesh.visible = false
  }

  takePower(power: PowerUp): void {
    power.active = false
    power.mesh.visible = false
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose()
    this.group.clear()
    this.coins.length = 0
    this.powers.length = 0
  }

  private acquireCoin(): Coin | null {
    for (const coin of this.coins) if (!coin.active) return coin
    if (this.coins.length >= this.coinCap) return null
    const mesh = new THREE.Mesh(this.coinGeometry, [this.coinRim, this.coinFace, this.coinFace])
    mesh.visible = false
    this.group.add(mesh)
    const coin: Coin = { mesh, active: false, x: 0, y: 0.95, z: 0, spin: 0, line: -1, collected: false }
    this.coins.push(coin)
    return coin
  }

  private acquirePower(kind: PowerKind): PowerUp | null {
    for (const power of this.powers) {
      if (!power.active && power.kind === kind) return power
    }
    if (this.powers.length >= this.powerCap) return null

    const group = new THREE.Group()
    const spinner = new THREE.Group()
    group.add(spinner)

    const spec = POWER_BY_KIND[kind]
    const harmful = spec.harmful
    const tint = POWER_COLORS[kind]

    // The icon: an extruded silhouette of the effect itself.
    const core = new THREE.Mesh(powerGlyph(kind), this.powerMaterials[kind])
    core.scale.setScalar(0.86)
    spinner.add(core)

    // The collar: smooth halo for a boon, spiked ring for a hazard.
    const ringGeo = new THREE.TorusGeometry(0.52, harmful ? 0.055 : 0.038, 8, 26)
    const ringMat = new THREE.MeshStandardMaterial({
      color: harmful ? HAZARD_COLOUR : tint,
      emissive: new THREE.Color(harmful ? HAZARD_COLOUR : tint),
      emissiveIntensity: harmful ? 1.6 : 1.1,
      metalness: 0.5,
      roughness: 0.3,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    spinner.add(ring)
    this.disposables.push(ringGeo, ringMat)

    if (harmful) {
      const spikeGeo = new THREE.ConeGeometry(0.075, 0.26, 6)
      const spikes: THREE.Mesh[] = []
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2
        const spike = new THREE.Mesh(spikeGeo, ringMat)
        spike.position.set(Math.cos(angle) * 0.62, Math.sin(angle) * 0.62, 0)
        spike.rotation.z = angle - Math.PI / 2
        spinner.add(spike)
        spikes.push(spike)
      }
      this.disposables.push(spikeGeo)
    }

    const glow = new THREE.Mesh(this.glowGeo, this.glowMat.clone())
    ;(glow.material as THREE.MeshBasicMaterial).color = new THREE.Color(harmful ? HAZARD_COLOUR : tint)
    ;(glow.material as THREE.MeshBasicMaterial).opacity = harmful ? 0.6 : 0.75
    glow.position.z = 0.05
    group.add(glow)

    group.visible = false
    this.group.add(group)
    const power: PowerUp = { mesh: group, kind, active: false, x: 0, y: 1.15, z: 0, spin: 0 }
    this.powers.push(power)
    return power
  }
}
