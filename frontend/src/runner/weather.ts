// Weather: snow on the snowfields, falling leaves in the mountain forest, blowing
// dust in the desert, ash and rising embers by the volcano. Each is one Points cloud whose motion is worked out entirely in
// the vertex shader from the run's clock and distance, so a frame costs a handful of
// uniform writes however many flakes are falling. The cloud is a box around the
// runner; particles wrap through it as the world scrolls, fading at the box's ends so
// nobody sees one pop.
import * as THREE from 'three'
import type { QualityPreset } from './config'
import { makeRng } from './utils'

export type WeatherKind = 'snow' | 'leaves' | 'dust' | 'ash' | 'embers'
export const WEATHER_KINDS: WeatherKind[] = ['snow', 'leaves', 'dust', 'ash', 'embers']

interface Spec {
  /** Particles at full quality; scaled down with the preset. */
  count: number
  /** Box: half-width, height, and z range (far end negative). */
  half: number
  height: number
  near: number
  far: number
  /** Fall speed (m/s, along -y), sideways drift (m/s, along x), sway amplitude (m). */
  fall: number
  drift: number
  sway: number
  /** World size of a particle (m). */
  size: number
  colors: number[]
  opacity: number
  /** Leaves tumble (a flat ellipse that turns); flakes and dust are round. */
  tumble: boolean
  /** Dust clings to the ground. */
  low: boolean
}

const SPECS: Record<WeatherKind, Spec> = {
  snow: { count: 1400, half: 34, height: 22, near: 14, far: -90, fall: 1.7, drift: 0.5, sway: 0.7, size: 0.13, colors: [0xffffff, 0xf2f7ff], opacity: 0.92, tumble: false, low: false },
  leaves: { count: 260, half: 26, height: 14, near: 12, far: -70, fall: 1.1, drift: 0.9, sway: 1.4, size: 0.3, colors: [0xe8742a, 0xd94e1f, 0xf2b33d, 0x9bbf3f, 0xc9561e], opacity: 1, tumble: true, low: false },
  ash: { count: 900, half: 34, height: 20, near: 14, far: -90, fall: 0.8, drift: 1.1, sway: 0.9, size: 0.11, colors: [0x8d8580, 0x6f6863, 0xa49b94], opacity: 0.8, tumble: false, low: false },
  // Embers rise (a negative fall) from the lava fields.
  embers: { count: 260, half: 30, height: 12, near: 14, far: -80, fall: -1.6, drift: 0.4, sway: 0.8, size: 0.1, colors: [0xff7a2a, 0xffb347, 0xff4f1a], opacity: 1, tumble: false, low: true },
  dust: { count: 520, half: 38, height: 7, near: 14, far: -90, fall: 0, drift: 7.5, sway: 0.5, size: 0.75, colors: [0xf2cf9a, 0xe9b77d, 0xfbe2bb], opacity: 0.32, tumble: false, low: true },
}

const VERTEX = /* glsl */ `
attribute vec3 seed;
attribute vec3 tint;
uniform float uTime;
uniform float uDistance;
uniform vec3 uBox;      // half-width, height, length
uniform float uNear;
uniform vec3 uMotion;   // fall, drift, sway
uniform float uSize;
uniform float uScale;
uniform float uAmount;
varying vec3 vTint;
varying float vFade;
varying float vSpin;
#include <fog_pars_vertex>

void main() {
  float t = uTime;
  vec3 p = position;
  // Falling, drifting sideways and swaying, each particle on its own phase.
  p.y = mod(p.y - uMotion.x * t * (0.75 + seed.x * 0.5), uBox.y);
  p.x = mod(p.x + uBox.x + uMotion.y * t * (0.6 + seed.y * 0.8) + sin(t * (0.6 + seed.z) + seed.x * 6.28) * uMotion.z, uBox.x * 2.0) - uBox.x;
  p.z = p.z + cos(t * (0.5 + seed.y) + seed.z * 6.28) * uMotion.z * 0.6;
  // The world scrolls towards +z by the run distance.
  p.z = uNear - mod(uNear - p.z - uDistance, uBox.z);
  // Only part of the cloud shows while the weather blends in.
  float on = step(seed.x, uAmount);
  float ends = smoothstep(0.0, 10.0, uNear - p.z) * smoothstep(0.0, 18.0, p.z - (uNear - uBox.z));
  float top = 1.0 - smoothstep(uBox.y - 2.0, uBox.y, p.y);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  // Nothing right in front of the lens: a flake there would be a blot on the screen.
  vFade = on * ends * top * smoothstep(1.5, 4.5, -mvPosition.z);
  vTint = tint;
  vSpin = seed.z * 6.28 + t * (1.5 + seed.y * 2.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = vFade > 0.0 ? min(uSize * (0.7 + seed.y * 0.6) * uScale / max(0.5, -mvPosition.z), 96.0) : 0.0;
  #include <fog_vertex>
}
`

const FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform float uTumble;
varying vec3 vTint;
varying float vFade;
varying float vSpin;
#include <fog_pars_fragment>

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float alpha;
  if (uTumble > 0.5) {
    // A leaf: an ellipse turning in the air, its width breathing as it flips.
    float s = sin(vSpin), k = cos(vSpin);
    vec2 r = vec2(c.x * k - c.y * s, c.x * s + c.y * k);
    float flip = 0.3 + 0.7 * abs(sin(vSpin * 0.7));
    float d = length(vec2(r.x / (0.5 * flip), r.y / 0.22));
    alpha = 1.0 - smoothstep(0.8, 1.0, d);
  } else {
    float d = length(c) * 2.0;
    alpha = 1.0 - smoothstep(0.35, 1.0, d);
  }
  alpha *= vFade * uOpacity;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(vTint, alpha);
  #include <fog_fragment>
}
`

class Cloud {
  readonly points: THREE.Points
  readonly material: THREE.ShaderMaterial
  private readonly geometry: THREE.BufferGeometry
  private readonly full: number

  constructor(readonly spec: Spec, seed: number) {
    const rng = makeRng(seed)
    const count = spec.count
    this.full = count
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count * 3)
    const tints = new Float32Array(count * 3)
    const colour = new THREE.Color()
    const length = spec.near - spec.far
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rng() * 2 - 1) * spec.half
      // Dust hugs the ground: most of it in the bottom metre or two.
      positions[i * 3 + 1] = spec.low ? Math.pow(rng(), 2.2) * spec.height : rng() * spec.height
      positions[i * 3 + 2] = spec.near - rng() * length
      // seed.x doubles as the "on" threshold, so it must spread evenly in the
      // order the draw count cuts the list: shuffle-free, i is already random.
      seeds[i * 3] = rng()
      seeds[i * 3 + 1] = rng()
      seeds[i * 3 + 2] = rng()
      colour.set(spec.colors[Math.floor(rng() * spec.colors.length)])
      tints[i * 3] = colour.r
      tints[i * 3 + 1] = colour.g
      tints[i * 3 + 2] = colour.b
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 3))
    this.geometry.setAttribute('tint', new THREE.BufferAttribute(tints, 3))
    // The shader moves everything; the box it can reach is the bound.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, spec.height / 2, (spec.near + spec.far) / 2), Math.hypot(spec.half, spec.height, length) / 2 + 4)
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uDistance: { value: 0 },
          uBox: { value: new THREE.Vector3(spec.half, spec.height, length) },
          uNear: { value: spec.near },
          uMotion: { value: new THREE.Vector3(spec.fall, spec.drift, spec.sway) },
          uSize: { value: spec.size },
          uScale: { value: 600 },
          uAmount: { value: 0 },
          uOpacity: { value: spec.opacity },
          uTumble: { value: spec.tumble ? 1 : 0 },
        },
      ]),
    })
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = true
    this.points.visible = false
    this.points.renderOrder = 3
  }

  setShare(share: number): void {
    this.geometry.setDrawRange(0, Math.max(1, Math.round(this.full * share)))
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export class Weather {
  readonly group = new THREE.Group()
  private clouds: Record<WeatherKind, Cloud>

  constructor(quality: QualityPreset) {
    this.group.name = 'weather'
    this.clouds = {
      snow: new Cloud(SPECS.snow, 71),
      leaves: new Cloud(SPECS.leaves, 72),
      dust: new Cloud(SPECS.dust, 73),
      ash: new Cloud(SPECS.ash, 74),
      embers: new Cloud(SPECS.embers, 75),
    }
    for (const cloud of Object.values(this.clouds)) this.group.add(cloud.points)
    this.setQuality(quality)
  }

  /** Fewer particles on the cheaper presets (the shader cost is per particle drawn). */
  setQuality(quality: QualityPreset): void {
    const share = quality.cityBlocks >= 160 ? 1 : quality.cityBlocks >= 100 ? 0.6 : 0.32
    for (const cloud of Object.values(this.clouds)) cloud.setShare(share)
  }

  /**
   * `amounts` 0..1 per kind (the zone blend); `scale` turns world size into pixels:
   * the viewport height over 2·tan(fov/2).
   */
  update(time: number, distance: number, amounts: Record<WeatherKind, number>, scale: number): void {
    for (const kind of Object.keys(this.clouds) as WeatherKind[]) {
      const cloud = this.clouds[kind]
      const amount = amounts[kind]
      cloud.points.visible = amount > 0.01
      if (!cloud.points.visible) continue
      const u = cloud.material.uniforms
      u.uTime.value = time
      u.uDistance.value = distance
      u.uAmount.value = amount
      u.uScale.value = scale
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const cloud of Object.values(this.clouds)) cloud.dispose()
  }
}
