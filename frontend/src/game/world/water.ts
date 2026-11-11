// Animated water / cloud-sea plane with fresnel shading and manual fog blending.
import * as THREE from 'three'
import type { ZonePalette } from '../zones'

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vWave;

  void main() {
    vec3 pos = position;
    float t = uTime;
    float w1 = sin(pos.x * 0.075 + t * 0.85);
    float w2 = sin(pos.z * 0.11 + t * 1.15);
    float w3 = sin((pos.x + pos.z) * 0.045 + t * 0.55);
    float h = (w1 * 0.34 + w2 * 0.26 + w3 * 0.22) * uAmp;
    pos.y += h;

    float dx = (cos(pos.x * 0.075 + t * 0.85) * 0.075 * 0.34 +
                cos((pos.x + pos.z) * 0.045 + t * 0.55) * 0.045 * 0.22) * uAmp;
    float dz = (cos(pos.z * 0.11 + t * 1.15) * 0.11 * 0.26 +
                cos((pos.x + pos.z) * 0.045 + t * 0.55) * 0.045 * 0.22) * uAmp;
    vec3 n = normalize(vec3(-dx, 1.0, -dz));

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    vNormalW = n;
    vWave = h;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const WATER_FRAG = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uOpacity;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vWave;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - clamp(dot(V, n), 0.0, 1.0), 3.0);

    vec3 col = mix(uShallow, uDeep, clamp(fres * 1.35, 0.0, 1.0));
    vec3 H = normalize(normalize(uSunDir) + V);
    float spec = pow(max(dot(n, H), 0.0), 90.0);
    col += uSunColor * spec * 0.9;

    float crest = smoothstep(0.35, 0.95, vWave);
    col += vec3(crest * 0.14);

    float dist = length(cameraPosition - vWorldPos);
    float fog = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFogColor, fog);

    float alpha = mix(uOpacity * 0.78, uOpacity, fres);
    gl_FragColor = vec4(col, alpha);
  }
`

export class Water {
  readonly mesh: THREE.Mesh
  private geometry: THREE.PlaneGeometry
  private material: THREE.ShaderMaterial

  constructor(size: number, palette: ZonePalette, sunDir: THREE.Vector3, fogNear: number, fogFar: number) {
    this.geometry = new THREE.PlaneGeometry(size * 2.6, size * 2.6, 96, 96)
    this.geometry.rotateX(-Math.PI / 2)

    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uAmp: { value: 1 },
        uDeep: { value: new THREE.Color(palette.waterDeep) },
        uShallow: { value: new THREE.Color(palette.waterShallow) },
        uSunDir: { value: sunDir.clone().normalize() },
        uSunColor: { value: new THREE.Color(palette.sunColor) },
        uFogColor: { value: new THREE.Color(palette.fog) },
        uFogNear: { value: fogNear },
        uFogFar: { value: fogFar },
        uOpacity: { value: 0.86 },
      },
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.position.y = 0
    this.mesh.renderOrder = 2
    this.mesh.frustumCulled = false
  }

  configure(palette: ZonePalette, sunDir: THREE.Vector3, fogNear: number, fogFar: number, calm = false): void {
    const u = this.material.uniforms
    ;(u.uDeep.value as THREE.Color).setHex(palette.waterDeep)
    ;(u.uShallow.value as THREE.Color).setHex(palette.waterShallow)
    ;(u.uSunColor.value as THREE.Color).setHex(palette.sunColor)
    ;(u.uFogColor.value as THREE.Color).setHex(palette.fog)
    ;(u.uSunDir.value as THREE.Vector3).copy(sunDir).normalize()
    u.uFogNear.value = fogNear
    u.uFogFar.value = fogFar
    u.uAmp.value = calm ? 0.55 : 1
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
