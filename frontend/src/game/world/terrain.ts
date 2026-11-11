// Heightfield terrain mesh with biome vertex colours (flat-shaded low-poly look).
import * as THREE from 'three'
import type { TerrainField } from '../noise'
import type { ZonePalette } from '../zones'

export class Terrain {
  readonly mesh: THREE.Mesh
  private geometry: THREE.PlaneGeometry
  private material: THREE.MeshStandardMaterial

  constructor(field: TerrainField, palette: ZonePalette, segments: number, size: number) {
    this.geometry = new THREE.PlaneGeometry(size, size, segments, segments)
    this.geometry.rotateX(-Math.PI / 2)

    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute
    const count = position.count
    const colors = new Float32Array(count * 3)

    const cGrass = new THREE.Color(palette.grass)
    const cGrassAlt = new THREE.Color(palette.grassAlt)
    const cRock = new THREE.Color(palette.rock)
    const cSand = new THREE.Color(palette.sand)
    const cPeak = new THREE.Color(palette.peak)
    const cDeep = new THREE.Color(palette.waterDeep)
    const tmp = new THREE.Color()

    const eps = size / segments
    for (let i = 0; i < count; i++) {
      const x = position.getX(i)
      const z = position.getZ(i)
      const y = field.height(x, z)
      position.setY(i, y)

      const slope =
        1 -
        Math.min(
          1,
          Math.max(
            0,
            Math.hypot(
              field.height(x + eps, z) - y,
              field.height(x, z + eps) - y
            ) /
              eps /
              2.2
          )
        )
      const steep = 1 - slope

      const noiseVar = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1
      tmp.copy(cGrass).lerp(cGrassAlt, noiseVar)

      // Sand at the shoreline
      tmp.lerp(cSand, smoothstep(2.2, 0.45, y))
      // Rock on steep faces
      tmp.lerp(cRock, smoothstep(0.32, 0.78, steep))
      // Peaks
      tmp.lerp(cPeak, smoothstep(18, 30, y))
      // Deep water floor darkening
      tmp.lerp(cDeep, smoothstep(-0.2, -2.4, y))
      // Subtle per-vertex tint variation keeps large areas from looking flat.
      const tint = 0.93 + noiseVar * 0.14
      tmp.multiplyScalar(tint)

      colors[i * 3] = tmp.r
      colors[i * 3 + 1] = tmp.g
      colors[i * 3 + 2] = tmp.b
    }

    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.geometry.computeVertexNormals()
    this.geometry.computeBoundingSphere()

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.94,
      metalness: 0.03,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.receiveShadow = true
    this.mesh.castShadow = false
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
