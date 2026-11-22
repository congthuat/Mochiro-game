// City traffic models.
//
// Cars: "KayKit — City Builder Bits (1.0)" by Kay Lousberg, released under CC0
// (public domain): https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0
// The five cars (sedan, hatchback, station wagon, taxi, police) are packed into one
// GLB by scripts/build-cars.ts. Here each one is baked — body and wheels, node
// transforms applied — into a single float geometry at game scale, wheels on the
// road at y = 0 and the bonnet facing +z (towards the runner), so a pooled obstacle
// mesh can swap between them for free.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBSTACLES, type ObstacleSpec } from './config'

/** KayKit units → metres. Keeps the proportions; the roof lands at ~1.48 m. */
export const CAR_SCALE = 4
export const CAR_NAMES = ['car_sedan', 'car_hatchback', 'car_stationwagon', 'car_taxi', 'car_police'] as const

export interface CarModel {
  name: string
  geometry: THREE.BufferGeometry
  /** Bumper positions along z (front is +z). */
  front: number
  back: number
  width: number
  /** Collision box for this body: its own length, the shared roof height. */
  spec: ObstacleSpec
}

/** Lamp layout measured off the KayKit bodies (all five share one chassis). */
export const CAR_LAMPS = {
  /** Headlight centres: x, y. */
  head: [0.56, 0.5] as const,
  /** Indicator corners: x, y. */
  blink: [0.78, 0.52] as const,
}

/** Dequantises a (possibly normalised int) attribute into plain floats. */
function toFloat(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const size = attribute.itemSize
  const out = new Float32Array(attribute.count * size)
  for (let i = 0; i < attribute.count; i++) {
    for (let c = 0; c < size; c++) out[i * size + c] = attribute.getComponent(i, c)
  }
  return new THREE.BufferAttribute(out, size)
}

/** Bakes every car found under `root` into game-ready geometry. Pure: no loading, no GPU. */
export function bakeCars(root: THREE.Object3D): CarModel[] {
  root.updateMatrixWorld(true)
  const scale = new THREE.Matrix4().makeScale(CAR_SCALE, CAR_SCALE, CAR_SCALE)
  const models: CarModel[] = []
  for (const name of CAR_NAMES) {
    const car = root.getObjectByName(name)
    if (!car) continue
    const parts: THREE.BufferGeometry[] = []
    car.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const source = mesh.geometry
      const part = new THREE.BufferGeometry()
      for (const key of ['position', 'normal', 'uv']) {
        const attribute = source.getAttribute(key)
        if (attribute) part.setAttribute(key, toFloat(attribute))
      }
      if (source.index) part.setIndex(Array.from(source.index.array as ArrayLike<number>))
      part.applyMatrix4(new THREE.Matrix4().multiplyMatrices(scale, mesh.matrixWorld))
      parts.push(part)
    })
    if (!parts.length) continue
    const geometry = mergeGeometries(parts, false)
    for (const part of parts) part.dispose()
    if (!geometry) continue
    geometry.computeBoundingBox()
    const box = geometry.boundingBox as THREE.Box3
    // Tyres on the tarmac; centred across the lane.
    geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, 0)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const fit = geometry.boundingBox as THREE.Box3
    const reach = Math.max(fit.max.z, -fit.min.z)
    models.push({
      name,
      geometry,
      front: fit.max.z,
      back: fit.min.z,
      width: fit.max.x - fit.min.x,
      spec: Object.freeze({ ...OBSTACLES.car, depth: +(reach * 2).toFixed(2) }),
    })
  }
  return models
}

let pending: Promise<{ models: CarModel[]; material: THREE.MeshStandardMaterial }> | null = null

/** Loads (once) the car pack (`kaykit-cars.glb`) and its shared atlas material. */
export function loadCarModels(url: string): Promise<{ models: CarModel[]; material: THREE.MeshStandardMaterial }> {
  if (!pending) {
    pending = new GLTFLoader().loadAsync(url).then((gltf) => {
      const models = bakeCars(gltf.scene)
      let map: THREE.Texture | null = null
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        const material = mesh.isMesh ? (mesh.material as THREE.MeshStandardMaterial) : null
        if (!map && material?.map) map = material.map
      })
      const texture = map as THREE.Texture | null
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 4
      }
      // A touch of clear-coat sheen over the flat KayKit palette.
      const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.42, metalness: 0.16 })
      // Source geometries are no longer needed once baked.
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (mesh.isMesh) mesh.geometry.dispose()
      })
      return { models, material }
    })
    pending.catch(() => {
      pending = null
    })
  }
  return pending
}
