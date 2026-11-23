// The ground under the run: grass in town and on the farms, pine needles in the forest,
// snow, sand, basalt. The ground plane and the verge strips are single long meshes that
// stay put under the camera, so their colour cannot simply be swapped when a zone
// changes — half the visible road would flip at once. Instead the shader works out, per
// pixel, how far down the road that pixel is and blends the colours of the zone
// handovers it falls in. Two handovers are carried, so a short zone (the tunnel) still
// reads right with the next one already in view.
//
// The same per-pixel distance draws the water (config.ts WATERS): lakes, the river and
// the sea beside the road are painted onto the ground itself — shallows, a lapping foam
// line, wet sand, waves and glints — and under a bridge the ground is cut away so the
// deep water below (water.ts) shows through.
import * as THREE from 'three'
import { WATER_CURL, WATER_TAPER, biomeSpan, watersBetween } from './config'

const ground = [new THREE.Color(), new THREE.Color(), new THREE.Color()]
const verge = [new THREE.Color(), new THREE.Color(), new THREE.Color()]

const shared = {
  uSurfDist: { value: 0 },
  /** start/end of the next handover, then of the one after it (absolute run distance). */
  uSurfSpan: { value: new THREE.Vector4(1e6, 1e6 + 1, 1e6 + 2, 1e6 + 3) },
  uSurfTime: { value: 0 },
  /** Two side-water spans in view: start, end (absolute), side (0 = none), shore. */
  uSideA: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSideB: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSideColA: { value: new THREE.Color(0x3a9ab4) },
  uSideColB: { value: new THREE.Color(0x3a9ab4) },
  /** Two bridge crossings in view: startA, endA, startB, endB (absolute). */
  uCross: { value: new THREE.Vector4(-1e6, -1e6, -1e6, -1e6) },
  uCrossCol: { value: new THREE.Color(0x1f8cc2) },
  /** Side water frozen over (A, B): 1 = ice. */
  uSideIce: { value: new THREE.Vector2(0, 0) },
  /** What lies under the first crossing: 0 water, 1 the lit streets under a skyway. */
  uCrossKind: { value: 0 },
}

/** The world position, for every material here (instancing aware). */
const VERTEX_WORLD = /* glsl */ `#include <project_vertex>
{
  vec4 surfWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  surfWorld = instanceMatrix * surfWorld;
  #endif
  surfWorld = modelMatrix * surfWorld;
  vSurfZ = surfWorld.z;
  vSurfX = surfWorld.x;
}`

/** Uniforms and the water shapes, mirroring sideWaterDepth() in config.ts. */
const WATER_COMMON = /* glsl */ `
uniform float uSurfDist;
uniform float uSurfTime;
uniform vec4 uSideA;
uniform vec4 uSideB;
uniform vec3 uSideColA;
uniform vec3 uSideColB;
uniform vec4 uCross;
uniform vec3 uCrossCol;
uniform vec2 uSideIce;
uniform float uCrossKind;
varying float vSurfZ;
varying float vSurfX;

float sideDepth(vec4 s, float at, float x) {
  if (s.z == 0.0) return -1e4;
  float rel = at - s.x;
  float into = min(rel, s.y - at);
  if (into <= 0.0) return -1e4;
  float t = clamp(1.0 - into / ${WATER_TAPER.toFixed(1)}, 0.0, 1.0);
  float shore = s.w + t * t * ${WATER_CURL.toFixed(1)} + sin(rel * 0.031) * 3.0 + sin(rel * 0.087 + 1.3) * 1.4;
  return x * s.z - shore;
}

/** Metres inside the nearest bridge crossing (negative: outside it). */
float crossInto(float at) {
  return max(min(at - uCross.x, uCross.y - at), min(at - uCross.z, uCross.w - at));
}

/** Waves: a world-space slope (x, z) for the normal, and a ripple for the colour. */
vec3 waterWaves(float x, float at, float t) {
  float a = sin(x * 0.37 + at * 0.23 + t * 1.3);
  float b = sin(x * -0.29 + at * 0.41 - t * 1.7);
  float c = sin((x + at) * 0.83 + t * 2.3);
  vec2 slope = vec2(cos(x * 0.37 + at * 0.23 + t * 1.3) * 0.37 - cos(x * -0.29 + at * 0.41 - t * 1.7) * 0.29 + cos((x + at) * 0.83 + t * 2.3) * 0.3,
                    cos(x * 0.37 + at * 0.23 + t * 1.3) * 0.23 + cos(x * -0.29 + at * 0.41 - t * 1.7) * 0.41 + cos((x + at) * 0.83 + t * 2.3) * 0.3);
  return vec3(slope, (a + b) * 0.25 + c * 0.15);
}

/** Sun glitter: sparse twinkles, fading with distance so the far water does not shimmer. */
float waterGlint(float x, float at, float t, float dist) {
  float g = sin(x * 1.9 + t * 2.7) * sin(at * 1.6 - t * 2.1) * sin((x - at) * 0.7 + t * 1.3);
  return smoothstep(0.82, 0.98, g) * (1.0 - smoothstep(40.0, 160.0, dist));
}
`

export type SurfaceKind = 'ground' | 'verge' | 'bank'

/**
 * Makes `material`'s colour a multiplier on the zone's ground (or verge) colour. Call
 * once per material; set its own `color` to white for the plain zone colour, or to a
 * grey to keep it a shade darker (kerb edges, paving joints). The ground also carries
 * the water; a bank is ground that the bridge cut-out leaves alone.
 */
export function applySurface(material: THREE.MeshStandardMaterial, kind: SurfaceKind): void {
  const colours = kind === 'verge' ? verge : ground
  const water = kind === 'ground'
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared)
    shader.uniforms.uSurfA = { value: colours[0] }
    shader.uniforms.uSurfB = { value: colours[1] }
    shader.uniforms.uSurfC = { value: colours[2] }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSurfZ;\nvarying float vSurfX;')
      .replace('#include <project_vertex>', VERTEX_WORLD)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec4 uSurfSpan;\nuniform vec3 uSurfA;\nuniform vec3 uSurfB;\nuniform vec3 uSurfC;\n${WATER_COMMON}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float surfAt = uSurfDist - vSurfZ;
float surfWater = 0.0;
vec3 surfWave = vec3(0.0);
${water ? 'if (crossInto(surfAt) > 0.0) discard;' : ''}
{
  vec3 surf = mix(mix(uSurfA, uSurfB, smoothstep(uSurfSpan.x, uSurfSpan.y, surfAt)), uSurfC, smoothstep(uSurfSpan.z, uSurfSpan.w, surfAt));
  // Snow is the one ground brighter than paper: lift it past white so it reads as
  // snow under the same lights that keep grass green.
  surf *= 1.0 + 0.32 * smoothstep(0.82, 0.94, dot(surf, vec3(0.299, 0.587, 0.114)));
  ${
    water
      ? `float dA = sideDepth(uSideA, surfAt, vSurfX);
  float dB = sideDepth(uSideB, surfAt, vSurfX);
  float d = max(dA, dB);
  if (d > -5.0) {
    vec3 waterCol = dA > dB ? uSideColA : uSideColB;
    float ice = dA > dB ? uSideIce.x : uSideIce.y;
    surfWave = waterWaves(vSurfX, surfAt, uSurfTime) * (1.0 - ice);
    // Wet sand along the waterline, then the shallows (lighter, a touch of sand
    // showing through) going deep.
    surf *= mix(1.0, 0.74, smoothstep(-5.0, 0.0, d));
    vec3 shallow = mix(waterCol * 1.35 + vec3(0.04, 0.08, 0.06), surf, 0.25);
    vec3 deep = waterCol * 0.8;
    vec3 sea = mix(shallow, deep, smoothstep(1.0, 26.0, d)) * (1.0 + 0.08 * surfWave.z);
    surfWater = smoothstep(0.0, 0.9, d);
    // Ice: pale and still, with long cracks and a ridge of snow along the bank.
    float crack = 1.0 - smoothstep(0.0, 0.12, abs(sin(vSurfX * 0.21 + surfAt * 0.07) + sin(surfAt * 0.13 - vSurfX * 0.05) * 0.6));
    vec3 frozen = mix(waterCol * 1.08, waterCol * 0.82, smoothstep(2.0, 40.0, d)) * (1.0 - crack * 0.16);
    sea = mix(sea, frozen, ice);
    surf = mix(surf, sea, surfWater);
    // The foam line laps in and out (on ice it lies still: a drift of snow).
    float swash = mix(0.9 + 0.8 * sin(uSurfTime * 0.9 + surfAt * 0.045), 0.9, ice);
    float foam = 1.0 - smoothstep(0.0, 0.7 + swash * 0.4, abs(d - swash * 0.7));
    foam = max(foam, (1.0 - smoothstep(0.0, 0.35, abs(d - swash * 2.2 - 1.2))) * 0.55);
    surf = mix(surf, vec3(0.97, 0.99, 1.0), foam * 0.85);
  }`
      : ''
  }
  diffuseColor.rgb *= surf;
}`
      )
    if (water) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.2, surfWater);\nsurfWater *= 1.0 - 0.85 * max(uSideIce.x, uSideIce.y);')
        .replace(
          '#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\nnormal = normalize(normal + surfWater * (viewMatrix * vec4(surfWave.x, 0.0, surfWave.y, 0.0)).xyz * 0.22);'
        )
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += surfWater * waterGlint(vSurfX, surfAt, uSurfTime, length(vViewPosition)) * vec3(1.0, 0.97, 0.88) * 0.9;'
        )
    }
  }
  material.customProgramCacheKey = () => `surface-${kind}`
  material.needsUpdate = true
}

/**
 * For the bridge parts that follow the camera (deck girder, railings, piers): they
 * exist only over a crossing, cut off cleanly where it starts and ends. `margin`
 * extends (or with a negative value, trims) the crossing.
 */
export function applyCrossingClip(material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial, margin = 0): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared)
    shader.uniforms.uClipMargin = { value: margin }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSurfZ;\nvarying float vSurfX;')
      .replace('#include <project_vertex>', VERTEX_WORLD)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uClipMargin;\n${WATER_COMMON}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (crossInto(uSurfDist - vSurfZ) + uClipMargin < 0.0) discard;')
  }
  material.customProgramCacheKey = () => `crossing-clip-${margin}`
  material.needsUpdate = true
}

/**
 * The deep water under a bridge: the crossing's colour, waves, glitter and a foam line
 * where it laps against the banks at either end.
 */
export function applyDeepWater(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSurfZ;\nvarying float vSurfX;')
      .replace('#include <project_vertex>', VERTEX_WORLD)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_COMMON}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float surfAt = uSurfDist - vSurfZ;
vec3 vCityGlow = vec3(0.0);
vec3 surfWave = waterWaves(vSurfX * 0.6, surfAt * 0.6, uSurfTime * 0.8);
{
  float into = crossInto(surfAt);
  if (into < 4.0) discard;
  if (uCrossKind > 0.5) {
    // Under the skyway: the night city's street grid, lamps strung along it, car lights.
    surfWave = vec3(0.0);
    vec2 cell = vec2(vSurfX, surfAt) / vec2(34.0, 46.0);
    vec2 f = abs(fract(cell) - 0.5);
    float street = 1.0 - smoothstep(0.42, 0.47, max(f.x, f.y));
    float lamp = street * step(0.82, fract(dot(floor(vec2(vSurfX, surfAt) / 3.0), vec2(0.37, 0.71)) * 7.13));
    float block = fract(sin(dot(floor(cell), vec2(12.9898, 78.233))) * 43758.5453);
    vec3 roof = uCrossCol * (0.8 + block * 0.6);
    diffuseColor.rgb *= mix(roof, vec3(0.16, 0.16, 0.2), street);
    vCityGlow = lamp * mix(vec3(1.0, 0.72, 0.38), vec3(0.5, 0.85, 1.0), step(0.6, block)) * 1.6;
  } else {
  vec3 sea = uCrossCol * (1.0 + 0.1 * surfWave.z);
  // Lighter in the shallows by the banks, and a band of foam where the water meets them.
  sea = mix(sea * 1.3 + vec3(0.03, 0.07, 0.05), sea, smoothstep(8.0, 30.0, into));
  float swash = 0.6 * sin(uSurfTime * 0.9 + vSurfX * 0.05);
  float foam = 1.0 - smoothstep(0.0, 1.1, abs(into - 7.9 - swash));
  diffuseColor.rgb *= mix(sea, vec3(0.97, 0.99, 1.0), foam * 0.8);
  }
}`
      )
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(surfWave.x, 0.0, surfWave.y, 0.0)).xyz * 0.25);'
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vCityGlow + waterGlint(vSurfX, surfAt, uSurfTime, length(vViewPosition)) * vec3(1.0, 0.97, 0.88) * (1.0 - uCrossKind);'
      )
  }
  material.customProgramCacheKey = () => 'deep-water'
  material.needsUpdate = true
}

const sideColour = new THREE.Color()

/**
 * Points the shared uniforms at the run's distance. Cheap; call every frame. Returns
 * whether a bridge crossing is in view (the deep water and the bridge parts are only
 * drawn then).
 */
export function updateSurface(distance: number, time: number, ahead = 420): boolean {
  const first = biomeSpan(distance)
  const second = biomeSpan(first.end + 0.01)
  shared.uSurfDist.value = distance
  shared.uSurfTime.value = time % 2000
  shared.uSurfSpan.value.set(first.start, first.end, second.start, second.end)
  ground[0].set(first.from.ground)
  ground[1].set(first.to.ground)
  ground[2].set(second.to.ground)
  verge[0].set(first.from.verge)
  verge[1].set(first.to.verge)
  verge[2].set(second.to.verge)

  const sides = [shared.uSideA.value, shared.uSideB.value]
  const sideColours = [shared.uSideColA.value, shared.uSideColB.value]
  sides[0].set(0, 0, 0, 0)
  sides[1].set(0, 0, 0, 0)
  const ice = shared.uSideIce.value
  ice.set(0, 0)
  const cross = shared.uCross.value
  cross.set(-1e6, -1e6, -1e6, -1e6)
  let nSide = 0
  let nCross = 0
  for (const here of watersBetween(distance - 80, distance + ahead)) {
    if (here.span.side === 0) {
      if (nCross === 0) {
        cross.x = here.start
        cross.y = here.end
        shared.uCrossCol.value.set(here.span.color)
        shared.uCrossKind.value = here.span.bridge === 'skyway' ? 1 : 0
      } else if (nCross === 1) {
        cross.z = here.start
        cross.w = here.end
      }
      nCross += 1
    } else if (nSide < 2) {
      sides[nSide].set(here.start, here.end, here.span.side, here.span.shore)
      sideColours[nSide].copy(sideColour.set(here.span.color))
      if (here.span.ice) ice.setComponent(nSide, 1)
      nSide += 1
    }
  }
  return nCross > 0
}

/** Absolute run distances of the first bridge crossing in view, if any. */
export function crossingInView(): { start: number; end: number } | null {
  const c = shared.uCross.value
  return c.x > -1e5 ? { start: c.x, end: c.y } : null
}
