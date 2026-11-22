// The ground under the run: grass in town and on the farms, pine needles in the forest,
// snow, sand. The ground plane and the verge strips are single long meshes that stay
// put under the camera, so their colour cannot simply be swapped when a zone changes —
// half the visible road would flip at once. Instead the shader works out, per pixel,
// how far down the road that pixel is and blends the colours of the zone handovers it
// falls in. Two handovers are carried, so a short zone (the tunnel) still reads right
// with the next one already in view.
import * as THREE from 'three'
import { biomeSpan } from './config'

const ground = [new THREE.Color(), new THREE.Color(), new THREE.Color()]
const verge = [new THREE.Color(), new THREE.Color(), new THREE.Color()]

const shared = {
  uSurfDist: { value: 0 },
  /** start/end of the next handover, then of the one after it (absolute run distance). */
  uSurfSpan: { value: new THREE.Vector4(1e6, 1e6 + 1, 1e6 + 2, 1e6 + 3) },
}

export type SurfaceKind = 'ground' | 'verge'

/**
 * Makes `material`'s colour a multiplier on the zone's ground (or verge) colour. Call
 * once per material; set its own `color` to white for the plain zone colour, or to a
 * grey to keep it a shade darker (kerb edges, paving joints).
 */
export function applySurface(material: THREE.MeshStandardMaterial, kind: SurfaceKind): void {
  const colours = kind === 'ground' ? ground : verge
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSurfDist = shared.uSurfDist
    shader.uniforms.uSurfSpan = shared.uSurfSpan
    shader.uniforms.uSurfA = { value: colours[0] }
    shader.uniforms.uSurfB = { value: colours[1] }
    shader.uniforms.uSurfC = { value: colours[2] }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSurfZ;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 surfWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  surfWorld = instanceMatrix * surfWorld;
  #endif
  vSurfZ = (modelMatrix * surfWorld).z;
}`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSurfDist;\nuniform vec4 uSurfSpan;\nuniform vec3 uSurfA;\nuniform vec3 uSurfB;\nuniform vec3 uSurfC;\nvarying float vSurfZ;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float surfAt = uSurfDist - vSurfZ;
  vec3 surf = mix(mix(uSurfA, uSurfB, smoothstep(uSurfSpan.x, uSurfSpan.y, surfAt)), uSurfC, smoothstep(uSurfSpan.z, uSurfSpan.w, surfAt));
  // Snow is the one ground brighter than paper: lift it past white so it reads as
  // snow under the same lights that keep grass green.
  surf *= 1.0 + 0.32 * smoothstep(0.82, 0.94, dot(surf, vec3(0.299, 0.587, 0.114)));
  diffuseColor.rgb *= surf;
}`
      )
  }
  material.customProgramCacheKey = () => 'surface'
  material.needsUpdate = true
}

/** Points the shared uniforms at the run's distance. Cheap; call every frame. */
export function updateSurface(distance: number): void {
  const first = biomeSpan(distance)
  const second = biomeSpan(first.end + 0.01)
  shared.uSurfDist.value = distance
  shared.uSurfSpan.value.set(first.start, first.end, second.start, second.end)
  ground[0].set(first.from.ground)
  ground[1].set(first.to.ground)
  ground[2].set(second.to.ground)
  verge[0].set(first.from.verge)
  verge[1].set(first.to.verge)
  verge[2].set(second.to.verge)
}
