// City districts: real streets of buildings along the run, one district per zone —
// and, between the cities, the countryside (wilds.ts plans it, this layer places it).
//
// Models: Kenney "City Kit (Commercial) 2.1", "City Kit (Suburban) 2.0" and
// "City Kit (Industrial) 2.0" — all CC0 (public domain), https://www.kenney.nl.
// scripts/build-districts.ts packs the pieces we use into one meshopt-compressed GLB
// (no normals: everything here is drawn flat-shaded), one 512² colour atlas per kit.
//
//   city   → downtown:   shop fronts and offices, café parasols, towers behind.
//   suburb → suburb:     houses with front fences and garden trees, a wooded edge.
//   port   → industrial: warehouses and works, container yards and tanks, chimneys,
//                         water towers and wind turbines on the skyline (the crane
//                         district of zones.ts sits on top of this).
//   neon   → night city: a canyon of tall blocks and skyscrapers, windows lit.
//   plains, forest, snow, desert, tunnel → the countryside of wilds.ts, plus a far
//                         ring of mountains, hills or dunes.
//
// Every building stands on its own street "lot" (a paved/lawn plot) in the front row,
// facing the road, with a sparser skyline row further out. Lots are spawned for the zone
// the road will be in when they arrive, so a district builds up out of the fog. The
// whole layer scrolls as one group; instance buffers are only rewritten when a lot is
// added or retired.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { DEEP_WATER_Y, shoreAt, tunnelAround, waterAt, zoneAt, type QualityPreset } from './config'
import { makeRng, pick, randRange } from './utils'
import { WILDS, buildGeneratedModels, planWild, wildCapacity, type ModelSize, type Tier, type WildOptions, type WildPlacer } from './wilds'

/** Kenney units → metres: a two-storey shop lands at ~9 m, the tallest tower at ~38 m. */
export const DISTRICT_SCALE = 7
/** Where the front row's facades stand, measured from the road's centre line. */
export const FRONT_X = 17
/** Top of the lot plots; the verge grass sits at -0.34. */
const PLOT_TOP = 0.02
const GROUND_Y = -0.34
/** Behind the camera: lots are retired once their near edge passes this. */
const DESPAWN_Z = 40
/** Metres before a tunnel portal where the countryside rows stop (tunnel.ts dresses them). */
const TUNNEL_CLEAR = 10
/** Nearest a countryside part's edge may come to the road's centre line (the pavement ends at 7.4). */
const WILD_CLEAR = 8
/** The group's scroll offset is folded back into the lots past this. */
const REBASE_AT = 2000

/** City kits (atlas-textured), the Nature Kit and the runtime shapes (both vertex-coloured). */
export type Kit = 'com' | 'sub' | 'ind' | 'nat' | 'gen'
export type District = 'downtown' | 'industrial' | 'suburb' | 'neon'

export const ZONE_DISTRICT: Record<string, District> = {
  city: 'downtown',
  suburb: 'suburb',
  port: 'industrial',
  neon: 'neon',
}

export interface DistrictModel {
  key: string
  kit: Kit
  geometry: THREE.BufferGeometry
  /** Extent along the model's own x (runs along the road once turned to face it). */
  width: number
  /** Extent along the model's own z (front is -z). */
  depth: number
  height: number
}

const range = (prefix: string, from: string, to: string): string[] => {
  const out: string[] = []
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(`${prefix}${String.fromCharCode(c)}`)
  return out
}

/** Window-light palettes, encoded as the integer part of the per-instance light value. */
const WARM = 0
const COOL = 1
const CYAN = 2
const MAGENTA = 3

interface Plan {
  front: string[]
  frontScale: [number, number]
  gap: [number, number]
  /** Paved strip in front of the facades (m). */
  forecourt: number
  sky: string[]
  skyScale: [number, number]
  skyGap: [number, number]
  /** Inner edge of the skyline row (m from the centre line). */
  skyX: [number, number]
  plot: number
  windows: number[]
  /** Share of buildings with their lights on after dark. */
  lit: number
}

const PLANS: Record<District, Plan> = {
  downtown: {
    front: range('com.building-', 'a', 'n'),
    frontScale: [1, 1.08],
    gap: [0.4, 1.6],
    forecourt: 3.2,
    sky: [...range('com.low-detail-building-', 'a', 'm'), 'com.low-detail-building-wide-a', 'com.low-detail-building-wide-b', ...range('com.building-skyscraper-', 'a', 'e')],
    skyScale: [1, 1.45],
    skyGap: [2, 9],
    skyX: [36, 92],
    plot: 0xd3cfc5,
    windows: [WARM, WARM, COOL],
    lit: 0.8,
  },
  industrial: {
    front: range('ind.building-', 'a', 't'),
    frontScale: [1, 1.1],
    gap: [2, 5],
    forecourt: 2.6,
    sky: ['ind.chimney-large', 'ind.chimney-medium', 'ind.chimney-large', 'ind.water-tower', 'ind.windmill', 'ind.windmill', 'ind.detail-tank-large', 'ind.building-a', 'ind.building-e', 'ind.building-l', 'ind.building-r'],
    skyScale: [1.15, 1.6],
    skyGap: [5, 14],
    skyX: [40, 96],
    plot: 0x8a8c8f,
    windows: [WARM],
    lit: 0.6,
  },
  suburb: {
    front: range('sub.building-type-', 'a', 'u'),
    frontScale: [1, 1.1],
    gap: [3, 6.5],
    forecourt: 2.4,
    sky: ['sub.tree-large', 'sub.tree-large', 'sub.tree-small', 'sub.tree-large', 'sub.tree-small', 'sub.building-type-b', 'sub.building-type-n', 'sub.building-type-u'],
    skyScale: [1.3, 2.1],
    skyGap: [0.5, 4],
    skyX: [34, 70],
    plot: 0x9cc36b,
    windows: [WARM],
    lit: 0.75,
  },
  neon: {
    front: ['com.building-e', 'com.building-i', 'com.building-j', 'com.building-k', 'com.building-l', 'com.building-m', 'com.building-n', ...range('com.building-skyscraper-', 'a', 'e')],
    frontScale: [1, 1.12],
    gap: [1, 3],
    forecourt: 2.6,
    sky: [...range('com.building-skyscraper-', 'a', 'e'), ...range('com.building-skyscraper-', 'a', 'e'), 'com.low-detail-building-a', 'com.low-detail-building-f', 'com.low-detail-building-h'],
    skyScale: [1.35, 2.2],
    skyGap: [2, 8],
    skyX: [36, 100],
    plot: 0x3b4157,
    windows: [CYAN, MAGENTA, COOL, CYAN, WARM],
    lit: 0.92,
  },
}

/** Every model the districts place; anything missing from the pack is simply skipped. */
export const DISTRICT_KEYS: string[] = [
  ...new Set([
    ...Object.values(PLANS).flatMap((plan) => [...plan.front, ...plan.sky]),
    'com.detail-parasol-a',
    'com.detail-parasol-b',
    'sub.fence-1x4',
    'sub.planter',
    'sub.tree-small',
    'ind.shipping-container-a',
    'ind.shipping-container-b',
    'ind.shipping-container-c',
    'ind.detail-tank',
    'ind.solar-panel-landscape-group',
  ]),
]

/** Dequantises a (possibly normalised int) attribute into plain floats. */
function toFloat(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const size = attribute.itemSize
  const out = new Float32Array(attribute.count * size)
  for (let i = 0; i < attribute.count; i++) {
    for (let c = 0; c < size; c++) out[i * size + c] = attribute.getComponent(i, c)
  }
  return new THREE.BufferAttribute(out, size)
}

/**
 * Bakes each `kit.model` node of the pack into one float geometry in metres: centred
 * on its footprint, standing on y = 0, front still facing -z. Pure: no loading, no GPU.
 */
export function bakeDistrictModels(root: THREE.Object3D): Map<string, DistrictModel> {
  root.updateMatrixWorld(true)
  const scale = new THREE.Matrix4().makeScale(DISTRICT_SCALE, DISTRICT_SCALE, DISTRICT_SCALE)
  const models = new Map<string, DistrictModel>()
  for (const child of root.children) {
    // GLTFLoader strips '.' from object names; the original survives in userData.
    const key = (child.userData?.name as string | undefined) ?? child.name
    const match = /^(com|sub|ind|nat)\.(.+)$/.exec(key)
    if (!match) continue
    const parts: THREE.BufferGeometry[] = []
    child.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const source = mesh.geometry
      const position = source.getAttribute('position')
      if (!position) return
      const part = new THREE.BufferGeometry()
      part.setAttribute('position', toFloat(position))
      const color = source.getAttribute('color')
      if (color) {
        // The Nature Kit is vertex-coloured (quantised, possibly RGBA): keep plain RGB.
        const rgb = new Float32Array(position.count * 3)
        for (let i = 0; i < position.count; i++) {
          rgb[i * 3] = color.getComponent(i, 0)
          rgb[i * 3 + 1] = color.getComponent(i, 1)
          rgb[i * 3 + 2] = color.getComponent(i, 2)
        }
        part.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
      } else {
        const uv = source.getAttribute('uv')
        part.setAttribute('uv', uv ? toFloat(uv) : new THREE.BufferAttribute(new Float32Array(position.count * 2), 2))
      }
      const index = source.index
        ? Array.from(source.index.array as ArrayLike<number>)
        : Array.from({ length: position.count }, (_, i) => i)
      part.setIndex(index)
      part.applyMatrix4(new THREE.Matrix4().multiplyMatrices(scale, mesh.matrixWorld))
      parts.push(part)
    })
    if (!parts.length) continue
    const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)
    if (parts.length > 1) for (const part of parts) part.dispose()
    if (!geometry) continue
    geometry.computeBoundingBox()
    const box = geometry.boundingBox as THREE.Box3
    geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const fit = geometry.boundingBox as THREE.Box3
    models.set(key, {
      key,
      kit: match[1] as Kit,
      geometry,
      width: fit.max.x - fit.min.x,
      depth: fit.max.z - fit.min.z,
      height: fit.max.y - fit.min.y,
    })
  }
  return models
}

/** Shared by every kit material: 0 by day, 1 deep in the neon night. */
const nightUniform = { value: 0 }

/**
 * Shared by every material here, via the per-instance `aLit` value:
 *  - aLit > 0: lit windows after dark — texels in the kits' glass blues glow in the
 *    instance's light colour (integer part = palette, fraction = brightness), scaled by
 *    the night uniform;
 *  - aLit < 0: snow — the up-facing faces turn white (amount = -aLit), with a light
 *    frost over the rest. The same pines and cabins serve the forest and the snowfields.
 */
function addInstanceLight(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightUniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vLit;')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
if (vLit < -0.001) {
  float upness = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
  float cover = -vLit * smoothstep(0.2, 0.5, upness);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 0.99), max(cover, -vLit * 0.14));
}
#ifndef USE_MAP
// Countryside glow (lava, a lighthouse lamp, lanterns): only the bright warm faces light up.
// Cyan faces (the future city's light strips) light up too.
if (vLit > 0.001) totalEmissiveRadiance += diffuseColor.rgb * max(smoothstep(0.35, 0.7, diffuseColor.r - diffuseColor.b), smoothstep(0.3, 0.6, min(diffuseColor.g, diffuseColor.b) - diffuseColor.r)) * vLit;
#endif
#ifdef USE_MAP
{
  float lum = vLit > 0.0 ? fract(vLit) : 0.0;
  if (uNight > 0.001 && lum > 0.001) {
    vec3 glass = pow(max(texture2D(map, vMapUv).rgb, vec3(0.0)), vec3(0.4545));
    float pane = step(0.25, glass.b - glass.r) * step(0.6, glass.b);
    float palette = floor(vLit + 0.0001);
    vec3 tint = palette < 0.5 ? vec3(1.0, 0.72, 0.4)
      : palette < 1.5 ? vec3(0.82, 0.9, 1.0)
      : palette < 2.5 ? vec3(0.25, 0.95, 1.0)
      : vec3(1.0, 0.3, 0.85);
    totalEmissiveRadiance += pane * uNight * lum * tint * 1.7;
  }
}
#endif`
      )
  }
  return material
}

/** The kit atlas, flat-shaded, with lit windows and snow. */
function kitMaterial(map: THREE.Texture | null): THREE.MeshStandardMaterial {
  return addInstanceLight(new THREE.MeshStandardMaterial({ map, roughness: 0.84, metalness: 0.04, flatShading: true }))
}

let natureShared: THREE.MeshStandardMaterial | null = null

/** One material for the whole countryside: vertex colours × the instance tint, flat-shaded. */
function natureMaterial(): THREE.MeshStandardMaterial {
  if (!natureShared) natureShared = addInstanceLight(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true }))
  return natureShared
}

let landscape: Promise<Map<string, DistrictModel>> | null = null

/** Loads (once) the Nature Kit pack. */
export function loadLandscapeModels(url: string): Promise<Map<string, DistrictModel>> {
  if (!landscape) {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    landscape = loader.loadAsync(url).then((gltf) => {
      const models = bakeDistrictModels(gltf.scene)
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      })
      return models
    })
    landscape.catch(() => {
      landscape = null
    })
  }
  return landscape
}

/** Wraps a runtime-built `gen.*` geometry as a model (footprint centred, on y = 0). */
function generatedModel(key: string, geometry: THREE.BufferGeometry): DistrictModel {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox as THREE.Box3
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const fit = geometry.boundingBox as THREE.Box3
  return { key, kit: 'gen', geometry, width: fit.max.x - fit.min.x, depth: fit.max.z - fit.min.z, height: fit.max.y - fit.min.y }
}

let pending: Promise<{ models: Map<string, DistrictModel>; materials: Record<Kit, THREE.MeshStandardMaterial> }> | null = null

/** Loads (once) the district pack and builds one material per kit atlas. */
export function loadDistrictModels(url: string): NonNullable<typeof pending> {
  if (!pending) {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    pending = loader.loadAsync(url).then((gltf) => {
      const models = bakeDistrictModels(gltf.scene)
      const maps: Partial<Record<Kit, THREE.Texture>> = {}
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        const material = mesh.material as THREE.MeshStandardMaterial
        const kit = material.name as Kit
        if (material.map && !maps[kit]) maps[kit] = material.map
      })
      const materials = {} as Record<Kit, THREE.MeshStandardMaterial>
      for (const kit of ['com', 'sub', 'ind'] as const) {
        const map = maps[kit] ?? null
        if (map) {
          map.colorSpace = THREE.SRGBColorSpace
          map.anisotropy = 4
        }
        materials[kit] = kitMaterial(map)
      }
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.dispose()
        const material = mesh.material as THREE.Material
        if (!Object.values(materials).includes(material as THREE.MeshStandardMaterial)) material.dispose()
      })
      return { models, materials }
    })
    pending.catch(() => {
      pending = null
    })
  }
  return pending
}

/** One pooled InstancedMesh per model. */
interface Slot {
  model: DistrictModel
  geometry: THREE.BufferGeometry
  mesh: THREE.InstancedMesh
  lit: THREE.InstancedBufferAttribute
  capacity: number
  count: number
  /** Countryside slots carry a per-instance colour (desert rock, crop colours). */
  tinted: boolean
}

interface Placement {
  slot: Slot
  x: number
  y: number
  /** Offset from the lot's centre along the road. */
  dz: number
  rot: number
  scale: number
  lit: number
  /** Non-uniform stretch (countryside shapes), on top of `scale`. */
  sx?: number
  sy?: number
  sz?: number
  tint?: number
  /** Countryside, while planning: half its footprint, and how it relates to water. */
  reach?: number
  water?: 'float' | 'island' | 'wade'
}

interface Lot {
  /** Centre along the road, in the group's (scrolling) frame. */
  z: number
  /** Half its length along the road, gap included. */
  half: number
  /** The city district, or the countryside zone (wilds.ts). */
  district: string
  parts: Placement[]
  plot: { x: number; width: number; length: number; dz: number; color: number; top?: number } | null
}

interface Row {
  side: -1 | 1
  /** Facades by the road, the skyline behind, and the far ring (mountains, dunes). */
  tier: Tier
  /** Far edge of the furthest lot, in the group frame. */
  cursor: number
  lots: Lot[]
}

const CAPACITY = 44
const PROP_CAPACITY = 140
const PLOT_CAPACITY = 140

export class Districts {
  readonly group = new THREE.Group()
  ready = false
  /** Resolves once the pack is in (true) or has failed to load (false). */
  readonly whenReady: Promise<boolean>
  /** Called once when the buildings are up, so the placeholder town can stand down. */
  onReady: (() => void) | null = null

  private rng: () => number
  private quality: QualityPreset
  private slots = new Map<string, Slot>()
  private rows: Row[] = [
    { side: -1, tier: 'front', cursor: DESPAWN_Z, lots: [] },
    { side: 1, tier: 'front', cursor: DESPAWN_Z, lots: [] },
    { side: -1, tier: 'sky', cursor: DESPAWN_Z, lots: [] },
    { side: 1, tier: 'sky', cursor: DESPAWN_Z, lots: [] },
    { side: -1, tier: 'far', cursor: DESPAWN_Z, lots: [] },
    { side: 1, tier: 'far', cursor: DESPAWN_Z, lots: [] },
  ]
  /** The countryside lot being planned, and the placer the planners drive. */
  private wildLot: Lot | null = null
  /** Run distance at the near edge of the lot being planned. */
  private wildAt = 0
  private placer: WildPlacer
  private generated: THREE.BufferGeometry[] = []
  private plots: THREE.InstancedMesh
  private plotGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0)
  private plotMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 })
  /** How far the group has scrolled since the last rebase. */
  private offset = 0
  private lastDistance = 0
  private needsFill = true
  private dirty = true
  private disposed = false
  private matrix = new THREE.Matrix4()
  private quat = new THREE.Quaternion()
  private pos = new THREE.Vector3()
  private size = new THREE.Vector3()
  private colour = new THREE.Color()
  private up = new THREE.Vector3(0, 1, 0)

  constructor(quality: QualityPreset, url: string, landscapeUrl: string | null = null, seed = 20261123) {
    this.quality = quality
    this.rng = makeRng(seed)
    this.placer = {
      rng: this.rng,
      density: this.density(),
      put: (keys, x, dz, options) => this.putWild(keys, x, dz, options),
      plot: (x, width, length, dz, color) => {
        if (this.wildLot) this.wildLot.plot = { x, width, length, dz, color, top: GROUND_Y + 0.05 }
      },
      water: (side) => (waterAt(this.wildAt, 0) === 'deep' ? 0 : shoreAt(this.wildAt, side)),
    }
    for (const [key, geometry] of buildGeneratedModels()) {
      this.generated.push(geometry)
      this.addSlot(generatedModel(key, geometry), natureMaterial(), wildCapacity(key), true)
    }
    if (landscapeUrl) {
      loadLandscapeModels(landscapeUrl).then(
        (models) => {
          if (this.disposed) return
          for (const model of models.values()) this.addSlot(model, natureMaterial(), wildCapacity(model.key), true)
          this.needsFill = true
        },
        (error: unknown) => console.warn('[districts] countryside pack failed to load', error)
      )
    }
    this.plots = new THREE.InstancedMesh(this.plotGeometry, this.plotMaterial, PLOT_CAPACITY)
    this.plots.frustumCulled = false
    this.plots.receiveShadow = true
    this.plots.count = 0
    this.plots.setColorAt(0, this.colour.set(0xffffff))
    this.group.add(this.plots)
    this.whenReady = loadDistrictModels(url).then(
      ({ models, materials }) => {
        if (this.disposed) return false
        for (const model of models.values()) {
          const capacity = /container|tree|fence|planter|parasol|tank/.test(model.key) ? PROP_CAPACITY : CAPACITY
          this.addSlot(model, materials[model.kit as 'com' | 'sub' | 'ind'], capacity, false)
        }
        this.ready = models.size > 0
        this.needsFill = true
        if (this.ready) this.onReady?.()
        return this.ready
      },
      (error: unknown) => {
        console.warn('[districts] city pack failed to load; keeping the procedural town', error)
        return false
      }
    )
  }

  /** One pooled InstancedMesh for `model`. */
  private addSlot(model: DistrictModel, material: THREE.Material, capacity: number, tinted: boolean): void {
    if (this.slots.has(model.key)) return
    // The baked packs are shared (module cache); each street gets its own copy to carry
    // its per-instance light values.
    const geometry = model.kit === 'gen' ? model.geometry : model.geometry.clone()
    const lit = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
    geometry.setAttribute('aLit', lit)
    const mesh = new THREE.InstancedMesh(geometry, material, capacity)
    mesh.name = model.key
    mesh.frustumCulled = false
    mesh.castShadow = this.casts(model)
    mesh.count = 0
    mesh.visible = false
    if (tinted) mesh.setColorAt(0, this.colour.setHex(0xffffff))
    this.group.add(mesh)
    this.slots.set(model.key, { model, geometry, mesh, lit, capacity, count: 0, tinted })
  }

  /** The far ring never casts: it is outside the shadow camera, and huge. */
  private casts(model: DistrictModel): boolean {
    return this.quality.shadows && !/^gen\.(mountain|hill|dune|pond|cropRow)/.test(model.key)
  }

  private density(): number {
    return Math.min(1, Math.max(0.4, this.quality.cityBlocks / 170))
  }

  /** Night factor (the biome blend's star level): windows light up as it rises. */
  setNight(amount: number): void {
    nightUniform.value = Math.min(1, Math.max(0, amount * 1.15))
  }

  setQuality(quality: QualityPreset): void {
    this.quality = quality
    for (const slot of this.slots.values()) slot.mesh.castShadow = this.casts(slot.model)
    this.placer.density = this.density()
    this.needsFill = true
  }

  /** Clears the street; it is rebuilt for the current distance on the next update. */
  reset(): void {
    this.needsFill = true
  }

  /**
   * Scrolls the districts with the world. `distance` is how far the run has gone; a
   * jump in it that the scroll cannot explain (a new run, the menu, a debug seek)
   * rebuilds the street for wherever the run now is.
   */
  update(dt: number, speed: number, distance: number): void {
    if (!this.ready) return
    const dz = speed * dt
    if (Math.abs(distance - this.lastDistance - dz) > 40 && Math.abs(distance - this.lastDistance) > 40) this.needsFill = true
    this.lastDistance = distance
    if (this.needsFill) {
      this.fill(distance)
      return
    }
    this.offset += dz
    const spawnZ = this.spawnZ()
    for (const row of this.rows) {
      // Retire lots whose far edge has gone behind the camera.
      while (row.lots.length && row.lots[0].z + this.offset - row.lots[0].half > DESPAWN_Z) {
        const gone = row.lots.shift() as Lot
        for (const part of gone.parts) part.slot.count -= 1
        this.dirty = true
      }
      while (row.cursor + this.offset > spawnZ) {
        this.place(row, distance)
      }
    }
    if (this.offset > REBASE_AT) this.rebase()
    this.group.position.z = this.offset
    if (this.dirty) this.write()
  }

  /** QA: what is standing along the street right now. */
  debug(): Record<string, unknown> {
    const districts: Record<string, number> = {}
    let lots = 0
    for (const row of this.rows) {
      for (const lot of row.lots) {
        lots += 1
        if (row.tier === 'front') districts[lot.district] = (districts[lot.district] ?? 0) + 1
      }
    }
    let instances = 0
    let meshes = 0
    for (const slot of this.slots.values()) {
      instances += slot.count
      if (slot.count) meshes += 1
    }
    const used: Record<string, number> = {}
    for (const slot of this.slots.values()) if (slot.count) used[slot.model.key] = slot.count
    return { ready: this.ready, models: this.slots.size, lots, instances, meshes, plots: this.plots.count, front: districts, night: nightUniform.value, used }
  }

  dispose(): void {
    this.disposed = true
    // The kit materials and baked models stay in the module cache for the next game.
    for (const slot of this.slots.values()) {
      slot.geometry.dispose()
      slot.mesh.dispose()
    }
    for (const geometry of this.generated) geometry.dispose()
    this.generated.length = 0
    this.plotGeometry.dispose()
    this.plotMaterial.dispose()
    this.plots.dispose()
    this.slots.clear()
    this.group.clear()
  }

  private spawnZ(): number {
    return -Math.min(330, Math.max(200, this.quality.fogFar - 20))
  }

  private fill(distance: number): void {
    this.needsFill = false
    this.offset = 0
    this.group.position.z = 0
    const spawnZ = this.spawnZ()
    for (const slot of this.slots.values()) slot.count = 0
    for (const row of this.rows) {
      row.lots.length = 0
      // Start a little behind the camera so the street is already built around it.
      row.cursor = DESPAWN_Z - randRange(this.rng, 0, 6)
      while (row.cursor > spawnZ) this.place(row, distance)
    }
    this.dirty = true
    this.write()
  }

  /** Folds the scroll offset back into the lots so the numbers stay small. */
  private rebase(): void {
    for (const row of this.rows) {
      row.cursor += this.offset
      for (const lot of row.lots) lot.z += this.offset
    }
    this.offset = 0
    this.dirty = true
  }

  private slot(key: string): Slot | null {
    const slot = this.slots.get(key)
    return slot && slot.count < slot.capacity ? slot : null
  }

  /** A free model from `keys`, trying a few before giving up. */
  private pickSlot(keys: string[]): Slot | null {
    for (let attempt = 0; attempt < 6; attempt++) {
      const slot = this.slot(pick(this.rng, keys))
      if (slot) return slot
    }
    return null
  }

  private lightFor(plan: Plan): number {
    if (this.rng() > plan.lit) return 0
    return pick(this.rng, plan.windows) + randRange(this.rng, 0.45, 0.98)
  }

  /** Appends the next lot to the far end of `row`. */
  private place(row: Row, distance: number): void {
    const worldFar = row.cursor + this.offset
    // The zone the road will be in when this spot reaches the runner.
    const at = distance - worldFar
    // Nothing stands in the mountain the tunnel runs through, nor just in front of its
    // portal (tunnel.ts dresses that with boulders): a lot that started before the face
    // could reach through the wall. The row jumps straight to the far portal.
    const tunnel = tunnelAround(at)
    if (at >= tunnel.start - TUNNEL_CLEAR && at < tunnel.end) {
      this.advance(row, { z: 0, half: 0, district: 'tunnel', parts: [], plot: null }, tunnel.end - at + 0.5)
      return
    }
    let zone = zoneAt(at)
    // The tunnel owns a few metres past its exit portal (zones hand over at their
    // midpoint); out there it is already the next zone.
    if (zone === tunnel.zone) zone = zoneAt(tunnel.end + 40)
    if (WILDS.includes(zone)) {
      this.placeWild(row, zone, at)
      return
    }
    const district = ZONE_DISTRICT[zone] ?? 'downtown'
    const plan = PLANS[district]
    const side = row.side
    const lot: Lot = { z: 0, half: 0, district, parts: [], plot: null }

    if (row.tier === 'far') {
      // The city's own skyline fills the distance.
      this.advance(row, lot, 40)
      return
    }
    if (row.tier === 'sky') {
      const sparse = this.quality.cityBlocks < 100 ? 1.6 : 1
      const gap = randRange(this.rng, plan.skyGap[0], plan.skyGap[1]) * sparse
      const slot = this.pickSlot(plan.sky)
      if (!slot) {
        this.advance(row, lot, 8 + gap)
        return
      }
      const scale = randRange(this.rng, plan.skyScale[0], plan.skyScale[1])
      const length = slot.model.width * scale
      const across = slot.model.depth * scale
      const x = side * (randRange(this.rng, plan.skyX[0], plan.skyX[1]) + across / 2)
      lot.parts.push({ slot, x, y: GROUND_Y, dz: 0, rot: side * (Math.PI / 2) + randRange(this.rng, -0.25, 0.25), scale, lit: this.lightFor(plan) })
      this.advance(row, lot, length + gap)
      return
    }

    const gap = randRange(this.rng, plan.gap[0], plan.gap[1])
    // Industrial streets break up into container yards and tank farms now and then.
    if (district === 'industrial' && this.rng() < 0.28) {
      this.yard(row, lot, gap)
      return
    }
    const slot = this.pickSlot(plan.front)
    if (!slot) {
      this.advance(row, lot, 10 + gap)
      return
    }
    const scale = randRange(this.rng, plan.frontScale[0], plan.frontScale[1])
    const length = slot.model.width * scale
    const across = slot.model.depth * scale
    lot.parts.push({
      slot,
      x: side * (FRONT_X + across / 2),
      y: PLOT_TOP,
      dz: 0,
      rot: side * (Math.PI / 2) + randRange(this.rng, -0.02, 0.02),
      scale,
      lit: this.lightFor(plan),
    })
    lot.plot = { x: side * (FRONT_X - plan.forecourt + (across + plan.forecourt + 2) / 2), width: across + plan.forecourt + 2, length: length + gap, dz: -gap / 2, color: plan.plot }
    this.dress(lot, district, side, length, gap)
    this.advance(row, lot, length + gap)
  }

  /**
   * Appends a stretch of countryside to `row`: wilds.ts decides what stands on it, the
   * parts are counted into their pools as they are placed.
   */
  private placeWild(row: Row, zone: string, at: number): void {
    const lot: Lot = { z: 0, half: 0, district: zone, parts: [], plot: null }
    this.wildLot = lot
    this.wildAt = at
    const span = Math.max(4, planWild(zone, row.tier, row.side, this.placer))
    this.wildLot = null
    this.settle(lot, at + span / 2)
    lot.z = row.cursor - span / 2
    lot.half = span
    row.cursor -= span
    row.lots.push(lot)
    this.dirty = true
  }

  /**
   * Sorts a planned countryside lot against the water (config.ts WATERS): nothing on dry
   * land stands in the water, nothing that floats sits on grass, and under a bridge the
   * boats and islets go down to the river. `centre` is the run distance at the lot's centre.
   */
  private settle(lot: Lot, centre: number): void {
    const wet = (dz: number, x: number) => waterAt(centre - dz, x) !== 'land'
    const sink = DEEP_WATER_Y - GROUND_Y
    if (lot.plot && wet(lot.plot.dz, lot.plot.x)) lot.plot = null
    lot.parts = lot.parts.filter((part) => {
      const r = (part.reach ?? 0) * 0.7
      const kind = part.water
      const middle = waterAt(centre - part.dz, part.x)
      let keep: boolean
      if (kind === 'wade') keep = middle !== 'deep'
      else if (kind === 'island') keep = true
      else {
        const points = [wet(part.dz, part.x), wet(part.dz, part.x - r), wet(part.dz, part.x + r), wet(part.dz - r, part.x), wet(part.dz + r, part.x)]
        keep = kind === 'float' ? points.every(Boolean) : !points.some(Boolean)
      }
      if (!keep) {
        part.slot.count -= 1
        return false
      }
      if (middle === 'deep' && (kind === 'float' || kind === 'island')) part.y += sink
      part.reach = undefined
      part.water = undefined
      return true
    })
  }

  private putWild(keys: string | readonly string[], x: number, dz: number, options: WildOptions = {}): ModelSize | null {
    const lot = this.wildLot
    if (!lot) return null
    const slot = typeof keys === 'string' ? this.slot(keys) : this.pickSlot(keys as string[])
    if (!slot) return null
    const scale = options.scale ?? 1
    // Keep everything clear of the pavement: a planner picks a spot before it knows
    // which model (and how wide) the pool hands it, so a big crag or cliff aimed at
    // 13 m could still lean over the kerb. Push the part out until its near edge is.
    const rot = options.rot ?? 0
    const reach = (Math.abs(Math.cos(rot)) * slot.model.width * (options.sx ?? 1) + Math.abs(Math.sin(rot)) * slot.model.depth * (options.sz ?? 1)) * scale / 2
    if (Math.abs(x) - reach < WILD_CLEAR) x = (x < 0 ? -1 : 1) * (WILD_CLEAR + reach)
    const part: Placement = {
      slot,
      x,
      y: GROUND_Y + (options.y ?? 0),
      dz,
      rot: options.rot ?? 0,
      scale,
      lit: options.glow ? options.glow : options.snow ? -Math.min(1, options.snow) : 0,
      sx: options.sx,
      sy: options.sy,
      sz: options.sz,
      tint: options.tint,
      reach,
      water: options.onWater ? 'float' : options.island ? 'island' : options.wade ? 'wade' : undefined,
    }
    lot.parts.push(part)
    slot.count += 1
    return { width: slot.model.width * scale * (options.sx ?? 1), depth: slot.model.depth * scale * (options.sz ?? 1), height: slot.model.height * scale * (options.sy ?? 1) }
  }

  /** Small things around a building: café parasols, garden fences and trees. */
  private dress(lot: Lot, district: District, side: number, length: number, gap: number): void {
    if (district === 'downtown' && this.rng() < 0.45) {
      const count = this.rng() < 0.5 ? 1 : 2
      for (let i = 0; i < count; i++) {
        const slot = this.slot(this.rng() < 0.5 ? 'com.detail-parasol-a' : 'com.detail-parasol-b')
        if (!slot) break
        const dz = (count === 1 ? 0 : i === 0 ? -0.22 : 0.22) * length + randRange(this.rng, -0.6, 0.6)
        lot.parts.push({ slot, x: side * (FRONT_X - 1.7), y: PLOT_TOP, dz, rot: this.rng() * Math.PI * 2, scale: randRange(this.rng, 0.9, 1.05), lit: 0 })
      }
    } else if (district === 'suburb') {
      const fence = this.slots.get('sub.fence-1x4')
      if (fence && this.rng() < 0.7) {
        const along = Math.max(fence.model.width, fence.model.depth)
        const rot = fence.model.width >= fence.model.depth ? Math.PI / 2 : 0
        const pieces = Math.max(1, Math.floor((length + gap * 0.5) / along))
        const start = -(pieces * along) / 2 + along / 2 - gap * 0.25
        for (let i = 0; i < pieces; i++) {
          const slot = this.slot('sub.fence-1x4')
          if (!slot) break
          lot.parts.push({ slot, x: side * (FRONT_X - 1.3), y: PLOT_TOP, dz: start + i * along, rot, scale: 1, lit: 0 })
        }
      }
      // A garden tree in the gap beyond the house.
      const tree = this.slot(this.rng() < 0.6 ? 'sub.tree-large' : 'sub.tree-small')
      if (tree) {
        lot.parts.push({ slot: tree, x: side * (FRONT_X + randRange(this.rng, 0.5, 4)), y: PLOT_TOP, dz: -length / 2 - gap / 2, rot: this.rng() * Math.PI * 2, scale: randRange(this.rng, 0.9, 1.25), lit: 0 })
      }
      const planter = this.rng() < 0.35 ? this.slot('sub.planter') : null
      if (planter) {
        lot.parts.push({ slot: planter, x: side * (FRONT_X - 0.6), y: PLOT_TOP, dz: randRange(this.rng, -length / 3, length / 3), rot: 0, scale: 1, lit: 0 })
      }
    } else if (district === 'neon' && this.rng() < 0.3) {
      const slot = this.slot('com.detail-parasol-b')
      if (slot) lot.parts.push({ slot, x: side * (FRONT_X - 1.6), y: PLOT_TOP, dz: randRange(this.rng, -length / 3, length / 3), rot: this.rng() * 6.28, scale: 1, lit: 0 })
    }
  }

  /** Container yard or tank farm: a lot without a building. */
  private yard(row: Row, lot: Lot, gap: number): void {
    const side = row.side
    let length = 0
    let across = 0
    if (this.rng() < 0.65) {
      // Containers, long side along the road, in columns stacked one or two high.
      const sample = this.slots.get('ind.shipping-container-a')
      if (!sample) {
        this.advance(row, lot, 8 + gap)
        return
      }
      const lengthwise = sample.model.width >= sample.model.depth
      const along = lengthwise ? sample.model.width : sample.model.depth
      const wide = lengthwise ? sample.model.depth : sample.model.width
      const rot = lengthwise ? Math.PI / 2 : 0
      const columns = 2 + Math.floor(this.rng() * 3)
      const rowsAlong = this.rng() < 0.5 ? 1 : 2
      for (let r = 0; r < rowsAlong; r++) {
        for (let c = 0; c < columns; c++) {
          const stack = this.rng() < 0.45 ? 2 : 1
          for (let level = 0; level < stack; level++) {
            const slot = this.pickSlot(['ind.shipping-container-a', 'ind.shipping-container-b', 'ind.shipping-container-c'])
            if (!slot) break
            lot.parts.push({
              slot,
              x: side * (FRONT_X + 0.4 + wide / 2 + c * (wide + 0.35)),
              y: PLOT_TOP + level * slot.model.height,
              dz: (r - (rowsAlong - 1) / 2) * (along + 0.5) + randRange(this.rng, -0.15, 0.15),
              rot: rot + (this.rng() < 0.5 ? Math.PI : 0) + randRange(this.rng, -0.02, 0.02),
              scale: 1,
              lit: 0,
            })
          }
        }
      }
      length = rowsAlong * along + (rowsAlong - 1) * 0.5
      across = 0.4 + columns * (wide + 0.35)
    } else {
      // Tank farm: one big tank with small ones round it, or a solar field.
      const big = this.slot(this.rng() < 0.75 ? 'ind.detail-tank-large' : 'ind.solar-panel-landscape-group')
      if (!big) {
        this.advance(row, lot, 8 + gap)
        return
      }
      const scale = big.model.key.includes('solar') ? 1.4 : 1
      length = big.model.width * scale
      across = big.model.depth * scale
      lot.parts.push({ slot: big, x: side * (FRONT_X + 1 + across / 2), y: PLOT_TOP, dz: 0, rot: side * (Math.PI / 2), scale, lit: 0 })
      const smalls = Math.floor(this.rng() * 3)
      for (let i = 0; i < smalls; i++) {
        const tank = this.slot('ind.detail-tank')
        if (!tank) break
        lot.parts.push({ slot: tank, x: side * (FRONT_X + 0.2 + tank.model.depth / 2), y: PLOT_TOP, dz: (i === 0 ? -1 : 1) * (length / 2 - tank.model.width / 2), rot: this.rng() * 6.28, scale: 1, lit: 0 })
      }
      length += 1
      across += 1
    }
    lot.plot = { x: side * (FRONT_X - 2.6 + (across + 2.6 + 2) / 2), width: across + 2.6 + 2, length: length + gap, dz: -gap / 2, color: PLANS.industrial.plot }
    this.advance(row, lot, length + gap)
  }

  /**
   * Puts `lot` at the row's far end. It spans `span` metres along the road: the
   * building at the near end, its gap (half of `-2 * plot.dz`) beyond it.
   */
  private advance(row: Row, lot: Lot, span: number): void {
    const gap = lot.plot ? -2 * lot.plot.dz : 0
    lot.z = row.cursor - (span - gap) / 2
    lot.half = span
    for (const part of lot.parts) part.slot.count += 1
    row.cursor -= span
    row.lots.push(lot)
    this.dirty = true
  }

  /** Rewrites the instance buffers from the lots that are standing. */
  private write(): void {
    this.dirty = false
    for (const slot of this.slots.values()) slot.count = 0
    let plots = 0
    for (const row of this.rows) {
      for (const lot of row.lots) {
        for (const part of lot.parts) {
          const slot = part.slot
          if (slot.count >= slot.capacity) continue
          this.pos.set(part.x, part.y, lot.z + part.dz)
          this.quat.setFromAxisAngle(this.up, part.rot)
          this.size.set(part.scale * (part.sx ?? 1), part.scale * (part.sy ?? 1), part.scale * (part.sz ?? 1))
          this.matrix.compose(this.pos, this.quat, this.size)
          slot.mesh.setMatrixAt(slot.count, this.matrix)
          slot.lit.setX(slot.count, part.lit)
          if (slot.tinted) slot.mesh.setColorAt(slot.count, this.colour.setHex(part.tint ?? 0xffffff))
          slot.count += 1
        }
        if (lot.plot && plots < PLOT_CAPACITY) {
          const top = lot.plot.top ?? PLOT_TOP
          this.pos.set(lot.plot.x, top, lot.z + lot.plot.dz)
          this.quat.identity()
          this.size.set(lot.plot.width, top - GROUND_Y + 0.06, lot.plot.length)
          this.matrix.compose(this.pos, this.quat, this.size)
          this.plots.setMatrixAt(plots, this.matrix)
          this.plots.setColorAt(plots, this.colour.setHex(lot.plot.color))
          plots += 1
        }
      }
    }
    for (const slot of this.slots.values()) {
      slot.mesh.count = slot.count
      slot.mesh.visible = slot.count > 0
      if (slot.count) {
        slot.mesh.instanceMatrix.needsUpdate = true
        slot.lit.needsUpdate = true
        if (slot.mesh.instanceColor) slot.mesh.instanceColor.needsUpdate = true
      }
    }
    this.plots.count = plots
    this.plots.instanceMatrix.needsUpdate = true
    if (this.plots.instanceColor) this.plots.instanceColor.needsUpdate = true
  }
}
