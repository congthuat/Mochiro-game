// The mountain tunnel: a lit concrete tube through a rock face, between the forest
// and the snowfields. It is one fixed piece of world laid at the tunnel's distance
// on every lap (config.ts tunnelSpan), so it needs no pooling — the group is moved to
// where its entrance is and hidden while it is out of sight.
//
// Clearance: walls at ±8.6 m, a vaulted roof 9.5 m up. The highest anything in the
// run gets is a ramp jump off a truck roof (~5.5 m), so nothing can touch the roof.
import * as THREE from 'three'
import { BIOME_LAP, tunnelSpan, type QualityPreset } from './config'
import { makeRng, randRange } from './utils'

const GROUND_Y = -0.4
const HALF = 8.6
const SPRING = 4.2
const CROWN = 9.5
/** Length of one wall section (the concrete pours show as bands). */
const SECTION = 8
const LIGHT_SPACING = 8

const CONCRETE = new THREE.Color(0xc9c3b6)
const DADO = new THREE.Color(0x7a756c)
const ROCK_LOW = new THREE.Color(0xb3a28c)
const ROCK_HIGH = new THREE.Color(0xc4bdb2)

/** The tube's cross-section, right wall foot → crown → left wall foot. */
function profile(inset = 0, foot = GROUND_Y): THREE.Vector2[] {
  const half = HALF + inset
  const points: THREE.Vector2[] = [new THREE.Vector2(half, foot), new THREE.Vector2(half, 1.1), new THREE.Vector2(half, 1.5), new THREE.Vector2(half, SPRING)]
  const steps = 10
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI
    points.push(new THREE.Vector2(Math.cos(a) * half, SPRING + Math.sin(a) * (CROWN - SPRING + inset)))
  }
  points.push(new THREE.Vector2(-half, 1.5), new THREE.Vector2(-half, 1.1), new THREE.Vector2(-half, foot))
  return points
}

/** The inside of the tube as flat-shaded quads, each pour a shade off its neighbours. */
function tubeGeometry(length: number): THREE.BufferGeometry {
  const ring = profile()
  const sections = Math.ceil(length / SECTION)
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const colour = new THREE.Color()
  for (let s = 0; s < sections; s++) {
    const z0 = -s * SECTION
    const z1 = Math.max(-length, z0 - SECTION)
    const shade = s % 2 === 0 ? 1 : 0.92
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]
      const b = ring[i + 1]
      const midY = (a.y + b.y) / 2
      if (midY < 1.1) colour.copy(DADO)
      else if (midY < 1.5) colour.copy(DADO).multiplyScalar(0.82)
      else colour.copy(CONCRETE)
      colour.multiplyScalar(shade)
      // Inward normal: the profile runs anticlockwise seen from +z, so the inside is
      // on the left of each step.
      const nx = -(b.y - a.y)
      const ny = b.x - a.x
      const len = Math.hypot(nx, ny) || 1
      const quad = [
        [a.x, a.y, z0], [b.x, b.y, z0], [b.x, b.y, z1],
        [a.x, a.y, z0], [b.x, b.y, z1], [a.x, a.y, z1],
      ]
      for (const v of quad) {
        positions.push(v[0], v[1], v[2])
        normals.push(nx / len, ny / len, 0)
        colors.push(colour.r, colour.g, colour.b)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

/** The arch opening as a 2D path (for holes and the exit glow). */
function archShape(inset: number, foot = GROUND_Y): THREE.Shape {
  const ring = profile(inset, foot)
  const shape = new THREE.Shape()
  shape.moveTo(ring[0].x, ring[0].y)
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i].x, ring[i].y)
  shape.closePath()
  return shape
}

/**
 * Rock: strata and a snow line worked out per pixel from the world position, so the
 * big flat portal face and the boulders share one look without a texture.
 */
function rockMaterial(origin: THREE.Vector3): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, flatShading: true })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRockLow = { value: ROCK_LOW }
    shader.uniforms.uRockHigh = { value: ROCK_HIGH }
    shader.uniforms.uRockOrigin = { value: origin }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRockOrigin;\nvarying vec3 vRockPos;\nvarying float vRockUp;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz - uRockOrigin;
vRockUp = normalize(mat3(modelMatrix) * objectNormal).y;`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRockLow;\nuniform vec3 uRockHigh;\nvarying vec3 vRockPos;\nvarying float vRockUp;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 p = vRockPos;
  float wobble = sin(p.x * 0.21) * 1.6 + sin(p.x * 0.067 + p.z * 0.3) * 2.6;
  float h = p.y + wobble;
  float strata = 0.84 + 0.16 * sin(h * 0.85 + sin(p.x * 0.13) * 2.2);
  vec3 rock = mix(uRockLow, uRockHigh, smoothstep(0.0, 40.0, p.y)) * strata;
  // Moss on the low ledges facing the sky, snow above the snow line and on top of
  // anything high enough.
  rock = mix(rock, vec3(0.42, 0.55, 0.3), smoothstep(0.55, 0.85, vRockUp) * (1.0 - smoothstep(10.0, 24.0, p.y)));
  float snow = max(smoothstep(33.0, 37.0, h), smoothstep(0.6, 0.9, vRockUp) * smoothstep(20.0, 30.0, h));
  diffuseColor.rgb *= mix(rock, vec3(0.94, 0.97, 1.0), snow);
}`
      )
  }
  material.customProgramCacheKey = () => 'tunnel-rock'
  return material
}

export class Tunnel {
  readonly group = new THREE.Group()
  /** Run distance of the entrance and the exit within a lap. */
  private readonly span = tunnelSpan()
  private readonly length: number
  private readonly tubeMaterial: THREE.MeshStandardMaterial
  private readonly exitGlow: THREE.MeshBasicMaterial
  private readonly outside = { value: 1 }
  private fogFar: number
  private disposables: Array<{ dispose: () => void }> = []

  constructor(quality: QualityPreset, seed = 4242) {
    this.length = this.span.end - this.span.start
    this.fogFar = quality.fogFar
    const rng = makeRng(seed)
    this.group.visible = false
    this.group.name = 'tunnel'

    // --- the tube -----------------------------------------------------------
    const tube = tubeGeometry(this.length)
    this.tubeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true })
    // Seen from the forest the inside must read as a dark hole, not as a sunlit hall:
    // the walls darken with depth until the run is inside, where the zone's own dim
    // lighting takes over.
    const outside = this.outside
    this.tubeMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uOutside = outside
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vTubeDepth;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvTubeDepth = -transformed.z;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uOutside;\nvarying float vTubeDepth;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uOutside * 0.78 * smoothstep(2.0, 36.0, vTubeDepth);'
        )
    }
    this.tubeMaterial.customProgramCacheKey = () => 'tunnel-tube'
    const tubeMesh = new THREE.Mesh(tube, this.tubeMaterial)
    tubeMesh.name = 'tunnel-tube'
    tubeMesh.receiveShadow = false
    this.group.add(tubeMesh)
    this.disposables.push(tube, this.tubeMaterial)

    // --- lights, stripe, fans, exit signs -----------------------------------
    const glow = new THREE.MeshBasicMaterial({ color: 0xffd38a })
    const lamp = new THREE.BoxGeometry(0.5, 0.14, 2.6)
    const perRow = Math.floor(this.length / LIGHT_SPACING)
    const lamps = new THREE.InstancedMesh(lamp, glow, perRow * 2)
    const matrix = new THREE.Matrix4()
    const lampX = 2.7
    const lampY = SPRING + Math.sqrt(1 - (lampX / HALF) ** 2) * (CROWN - SPRING) - 0.12
    for (let i = 0; i < perRow; i++) {
      for (let s = 0; s < 2; s++) {
        matrix.makeTranslation((s ? 1 : -1) * lampX, lampY, -LIGHT_SPACING / 2 - i * LIGHT_SPACING)
        lamps.setMatrixAt(i * 2 + s, matrix)
      }
    }
    lamps.name = 'tunnel-lamps'
    this.group.add(lamps)

    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xff9440 })
    const stripe = new THREE.BoxGeometry(0.06, 0.16, this.length)
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(stripe, stripeMat)
      mesh.position.set(side * (HALF - 0.04), 1.3, -this.length / 2)
      this.group.add(mesh)
    }

    const fanMat = new THREE.MeshStandardMaterial({ color: 0x5d6168, roughness: 0.6, metalness: 0.4 })
    const fan = new THREE.CylinderGeometry(0.62, 0.62, 3.4, 12)
    fan.rotateX(Math.PI / 2)
    const fans = new THREE.InstancedMesh(fan, fanMat, 14)
    let fanCount = 0
    for (let z = -46; z > -this.length + 30 && fanCount < 14; z -= 58) {
      for (const side of [-1, 1]) {
        if (fanCount >= 14) break
        matrix.makeTranslation(side * 1.05, CROWN - 1.25, z)
        fans.setMatrixAt(fanCount++, matrix)
      }
    }
    fans.count = fanCount
    this.group.add(fans)

    const signMat = new THREE.MeshBasicMaterial({ color: 0x35d07f })
    const sign = new THREE.BoxGeometry(0.08, 0.36, 0.8)
    const signs = new THREE.InstancedMesh(sign, signMat, 30)
    let signCount = 0
    for (let z = -20; z > -this.length + 8 && signCount < 30; z -= 36) {
      for (const side of [-1, 1]) {
        if (signCount >= 30) break
        matrix.makeTranslation(side * (HALF - 0.05), 2.4, z - (side > 0 ? 18 : 0))
        signs.setMatrixAt(signCount++, matrix)
      }
    }
    signs.count = signCount
    this.group.add(signs)
    this.disposables.push(glow, lamp, lamps, stripeMat, stripe, fanMat, fan, fans, signMat, sign, signs)

    // --- the portal ---------------------------------------------------------
    const rock = rockMaterial(this.group.position)
    this.disposables.push(rock)
    this.group.add(this.mountainFace(rock, rng))
    const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.92, flatShading: true })
    const frame = archShape(1.5, GROUND_Y - 0.6)
    frame.holes.push(archShape(0) as unknown as THREE.Path)
    const frameGeo = new THREE.ExtrudeGeometry(frame, { depth: 2.4, bevelEnabled: false, curveSegments: 1 })
    frameGeo.translate(0, 0, -1.2)
    const frameMesh = new THREE.Mesh(frameGeo, concrete)
    frameMesh.name = 'tunnel-portal'
    this.group.add(frameMesh)
    this.disposables.push(concrete, frameGeo)

    // Boulders at the foot of the face, so it meets the ground in rubble rather than
    // a ruled line; none in front of the opening.
    const boulder = new THREE.IcosahedronGeometry(1, 0)
    this.disposables.push(boulder)
    for (let i = 0; i < 16; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const size = randRange(rng, 2.5, i < 4 ? 5 : 9)
      const mesh = new THREE.Mesh(boulder, rock)
      mesh.name = 'boulder'
      const x = side * randRange(rng, HALF + 4 + size * 0.6, 120)
      mesh.position.set(x, GROUND_Y + size * 0.35, randRange(rng, 0.5, 9))
      mesh.scale.set(size * randRange(rng, 1, 1.6), size * randRange(rng, 0.7, 1.1), size * randRange(rng, 0.9, 1.3))
      mesh.rotation.set(randRange(rng, 0, Math.PI), randRange(rng, 0, Math.PI), 0)
      this.group.add(mesh)
    }

    // --- the light at the end -------------------------------------------------
    // From inside, the far portal is a bright opening; it fades out over the last
    // stretch so the run bursts out into the snowfields.
    const exitShape = new THREE.ShapeGeometry(archShape(0), 1)
    this.exitGlow = new THREE.MeshBasicMaterial({ color: 0xf2f7ff, fog: false, transparent: true, depthWrite: false, toneMapped: false })
    const exit = new THREE.Mesh(exitShape, this.exitGlow)
    exit.name = 'tunnel-exit'
    exit.position.z = -this.length - 0.5
    exit.renderOrder = 2
    this.group.add(exit)
    this.disposables.push(exitShape, this.exitGlow)

    this.group.traverse((object) => {
      object.castShadow = false
      object.receiveShadow = false
      object.matrixAutoUpdate = object === this.group
      object.updateMatrix()
    })
  }

  /** A wide rock face with a jagged ridge, the opening cut out of it. */
  private mountainFace(material: THREE.Material, rng: () => number): THREE.Mesh {
    const width = 130
    const shape = new THREE.Shape()
    shape.moveTo(-width, GROUND_Y - 1)
    shape.lineTo(width, GROUND_Y - 1)
    const steps = 44
    for (let i = 0; i <= steps; i++) {
      const x = width - (i / steps) * width * 2
      const peak = 46 * Math.exp(-(((x + 18) / 46) ** 2)) + 30 * Math.exp(-(((x - 70) / 30) ** 2))
      const y = 20 + peak + randRange(rng, -3.5, 3.5) + (i % 3 === 0 ? randRange(rng, 0, 5) : 0)
      shape.lineTo(x, Math.max(y, Math.abs(x) < 30 ? 30 : 18))
    }
    shape.closePath()
    shape.holes.push(archShape(1.2) as unknown as THREE.Path)
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 26, bevelEnabled: false, curveSegments: 1 })
    geometry.translate(0, 0, -26)
    this.disposables.push(geometry)
    const face = new THREE.Mesh(geometry, material)
    face.name = 'mountain-face'
    return face
  }

  setQuality(quality: QualityPreset): void {
    this.fogFar = quality.fogFar
  }

  /** Places the tunnel that is next (or under way) relative to the runner. */
  update(distance: number): void {
    let lap = Math.floor(distance / BIOME_LAP) * BIOME_LAP
    if (distance > lap + this.span.end + 30) lap += BIOME_LAP
    const start = lap + this.span.start
    const end = lap + this.span.end
    // The entrance sits at world z = distance - start (negative while ahead).
    const z = distance - start
    const ahead = start - distance
    const visible = ahead < this.fogFar + 40 && distance < end + 30
    this.group.visible = visible
    if (!visible) return
    this.group.position.z = z
    // Outside until the run crosses the portal (the zone palette cuts at the same
    // spot, so the walls light up the moment the eyes would adjust).
    this.outside.value = distance < start + 10 ? 1 : 0
    const toExit = end - distance
    this.exitGlow.opacity = THREE.MathUtils.clamp((toExit - 6) / 16, 0, 1) * (distance > start ? 1 : 0.85)
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const item of this.disposables) item.dispose()
    this.disposables.length = 0
  }
}
