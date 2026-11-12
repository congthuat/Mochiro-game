// Shared runner FX (boost flame, trails, shield bubble, contact shadow) used by
// both the rigged GLB runner and the procedural fallback character.
import * as THREE from 'three'
import { blobShadowTexture } from './textures'

export class AvatarFx {
  readonly group = new THREE.Group()

  private flame: THREE.Mesh
  private trails: THREE.Mesh[] = []
  private shieldBubble: THREE.Mesh
  private shieldWire: THREE.Mesh
  private shadow: THREE.Mesh
  private shieldLevel = 0
  private disposables: Array<{ dispose: () => void }> = []

  constructor(shadowRadius = 0.46, shieldCenterY = 0.85) {
    const flameGeo = new THREE.ConeGeometry(0.16, 0.52, 14, 1, true)
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xffd07a,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.flame = new THREE.Mesh(flameGeo, flameMat)
    this.flame.rotation.x = Math.PI
    this.flame.position.set(0, 0.35, 0.42)
    this.flame.visible = false
    this.group.add(this.flame)
    this.disposables.push(flameGeo, flameMat)

    const bubbleGeo = new THREE.SphereGeometry(0.78, 22, 16)
    const bubbleMat = new THREE.MeshBasicMaterial({
      color: 0x6fe0ff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.shieldBubble = new THREE.Mesh(bubbleGeo, bubbleMat)
    this.shieldBubble.position.set(0, shieldCenterY, 0)
    this.shieldBubble.visible = false
    this.group.add(this.shieldBubble)
    this.disposables.push(bubbleGeo, bubbleMat)

    const wireGeo = new THREE.SphereGeometry(0.8, 12, 8)
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x9df0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    })
    this.shieldWire = new THREE.Mesh(wireGeo, wireMat)
    this.shieldWire.position.set(0, shieldCenterY, 0)
    this.shieldWire.visible = false
    this.group.add(this.shieldWire)
    this.disposables.push(wireGeo, wireMat)

    // Soft-edged and stretched front-to-back like a runner's footprint; the old
    // flat disc was a pale green coin that made the hero look pasted on the road.
    const shadowGeo = new THREE.PlaneGeometry(shadowRadius * 2.6, shadowRadius * 3.1)
    const shadowMat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      color: 0x000000,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    })
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.02
    this.shadow.renderOrder = 1
    this.group.add(this.shadow)
    this.disposables.push(shadowGeo, shadowMat)

    const trailGeo = new THREE.PlaneGeometry(0.16, 1.5)
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    for (const side of [-1, 1]) {
      const trail = new THREE.Mesh(trailGeo, trailMat)
      trail.rotation.x = -Math.PI / 2
      trail.position.set(side * 0.16, 0.06, -2.2)
      trail.visible = false
      this.group.add(trail)
      this.trails.push(trail)
    }
    this.disposables.push(trailGeo, trailMat)
  }

  setShield(active: boolean): void {
    this.shieldBubble.visible = active
    this.shieldWire.visible = active
  }

  setShieldLevel(level: number): void {
    this.shieldLevel = Math.min(1, Math.max(0, level))
    const active = this.shieldLevel > 0.01
    this.shieldBubble.visible = active
    this.shieldWire.visible = active
    if (!active) return
    const bubble = this.shieldBubble.material as THREE.MeshBasicMaterial
    const wire = this.shieldWire.material as THREE.MeshBasicMaterial
    bubble.opacity = 0.16 * this.shieldLevel
    wire.opacity = 0.32 * this.shieldLevel
    const scale = 0.9 + this.shieldLevel * 0.14
    this.shieldBubble.scale.setScalar(scale)
    this.shieldWire.scale.setScalar(scale)
    this.shieldWire.rotation.y += 0.02
  }

  /** `height` is how far the runner is above the track. */
  update(boosting: boolean, height: number): void {
    this.flame.visible = boosting
    if (boosting) {
      const flicker = 0.8 + Math.random() * 0.5
      this.flame.scale.set(1, flicker, 1)
      ;(this.flame.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.random() * 0.35
    }
    for (const trail of this.trails) {
      trail.visible = boosting
      if (trail.visible) {
        const material = trail.material as THREE.MeshBasicMaterial
        material.opacity = 0.2 + Math.random() * 0.16
        trail.position.z = -1.8 - Math.random() * 0.8
      }
    }
    const scale = Math.min(1.15, Math.max(0.45, 1.15 - height * 0.2))
    this.shadow.scale.setScalar(scale)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.min(0.6, Math.max(0.12, 0.6 - height * 0.12))
    this.shadow.position.y = -height + 0.03
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose()
    this.group.clear()
    this.trails.length = 0
  }
}
