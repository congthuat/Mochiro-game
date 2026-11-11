// Gradient sky dome, sun disc, star field and drifting cloud layer.
import * as THREE from 'three'
import type { ZonePalette } from '../zones'

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = clamp(dir.y, -1.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
    col = mix(col, uHorizon * 0.82, smoothstep(0.0, -0.35, h));
    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(sd, 260.0) * 2.2 + pow(sd, 9.0) * 0.28);
    gl_FragColor = vec4(col, 1.0);
  }
`

function makeCloudTexture(): THREE.Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, size, size)
    for (let i = 0; i < 26; i++) {
      const r = 18 + Math.random() * 52
      const x = size * 0.5 + (Math.random() - 0.5) * size * 0.62
      const y = size * 0.5 + (Math.random() - 0.5) * size * 0.5
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, 'rgba(255,255,255,0.5)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class SkyDome {
  readonly group = new THREE.Group()
  private dome: THREE.Mesh
  private skyMaterial: THREE.ShaderMaterial
  private stars: THREE.Points
  private starMaterial: THREE.PointsMaterial
  private sun: THREE.Sprite
  private clouds: THREE.Mesh[] = []
  private cloudMaterial: THREE.MeshBasicMaterial

  constructor() {
    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTop: { value: new THREE.Color(0x1e5fb4) },
        uHorizon: { value: new THREE.Color(0xc6e6ff) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3).normalize() },
        uSunColor: { value: new THREE.Color(0xfff4d6) },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), this.skyMaterial)
    this.dome.frustumCulled = false
    this.group.add(this.dome)

    // Stars
    const starCount = 900
    const positions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i++) {
      const u = Math.random()
      const v = Math.random()
      const theta = 2 * Math.PI * u
      const phi = Math.acos(2 * v - 1)
      const r = 780
      const y = Math.abs(Math.cos(phi)) * r
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    })
    this.stars = new THREE.Points(starGeo, this.starMaterial)
    this.stars.frustumCulled = false
    this.group.add(this.stars)

    // Sun sprite
    const sunCanvas = document.createElement('canvas')
    sunCanvas.width = 128
    sunCanvas.height = 128
    const sctx = sunCanvas.getContext('2d')
    if (sctx) {
      const grad = sctx.createRadialGradient(64, 64, 0, 64, 64, 64)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(0.25, 'rgba(255,246,214,0.85)')
      grad.addColorStop(0.6, 'rgba(255,232,180,0.25)')
      grad.addColorStop(1, 'rgba(255,220,160,0)')
      sctx.fillStyle = grad
      sctx.fillRect(0, 0, 128, 128)
    }
    const sunTex = new THREE.CanvasTexture(sunCanvas)
    sunTex.colorSpace = THREE.SRGBColorSpace
    this.sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sunTex,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
      })
    )
    this.sun.scale.setScalar(170)
    this.group.add(this.sun)

    // Cloud layer
    const cloudTex = makeCloudTexture()
    this.cloudMaterial = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    })
    const cloudGeo = new THREE.PlaneGeometry(320, 320)
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(cloudGeo, this.cloudMaterial)
      const angle = (i / 14) * Math.PI * 2 + Math.random()
      const radius = 120 + Math.random() * 480
      mesh.position.set(Math.cos(angle) * radius, 90 + Math.random() * 110, Math.sin(angle) * radius)
      mesh.rotation.x = -Math.PI / 2
      mesh.rotation.z = Math.random() * Math.PI
      mesh.userData.speed = 1.5 + Math.random() * 2.5
      mesh.userData.spin = (Math.random() - 0.5) * 0.02
      mesh.renderOrder = -5
      this.clouds.push(mesh)
      this.group.add(mesh)
    }
  }

  configure(palette: ZonePalette, sunDir: THREE.Vector3): void {
    ;(this.skyMaterial.uniforms.uTop.value as THREE.Color).setHex(palette.skyTop)
    ;(this.skyMaterial.uniforms.uHorizon.value as THREE.Color).setHex(palette.skyHorizon)
    ;(this.skyMaterial.uniforms.uSunColor.value as THREE.Color).setHex(palette.sunColor)
    ;(this.skyMaterial.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir).normalize()
    this.starMaterial.opacity = palette.starOpacity
    this.sun.position.copy(sunDir).normalize().multiplyScalar(700)
    this.sun.material.color.setHex(palette.sunColor)
    this.cloudMaterial.color.setHex(palette.cloud)
    this.cloudMaterial.opacity = palette.starOpacity > 0.5 ? 0.32 : 0.5
  }

  update(dt: number, center: THREE.Vector3): void {
    this.group.position.set(center.x, 0, center.z)
    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.speed * dt
      cloud.rotation.z += cloud.userData.spin * dt
      if (cloud.position.x > 700) cloud.position.x = -700
    }
  }

  dispose(): void {
    this.dome.geometry.dispose()
    this.skyMaterial.dispose()
    this.stars.geometry.dispose()
    this.starMaterial.dispose()
    this.sun.material.map?.dispose()
    this.sun.material.dispose()
    this.cloudMaterial.map?.dispose()
    this.cloudMaterial.dispose()
    for (const cloud of this.clouds) cloud.geometry.dispose()
  }
}
