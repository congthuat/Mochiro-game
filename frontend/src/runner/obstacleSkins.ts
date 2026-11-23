// Zone-themed looks for the four "verb" obstacles: the barrier you jump (low), the
// block you dodge (tall), the gate you slide under (tunnel) and the launch ramp.
//
// A skin is only a look. Every skin is built inside its kind's collision box from
// config.ts (OBSTACLES) — same footprint, same top, same clearance under a gate — so a
// hay-bale wall on the farm kills you exactly where the striped barricade in the city
// does. scripts/obstacle-fit.ts measures every skin against its box.
//
// Most of it is built here from simple blocks. A few props come from Kenney's CC0 kits
// (packed by scripts/build-obstacles.ts into obstacle-props.glb, ~75 KB): hay bales,
// carved pumpkins, gravestones, a coffin, a snowman, barrels, rocks and logs. Until
// that pack has loaded the procedural skins carry the road on their own.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { OBSTACLES } from './config'

export type Theme = 'city' | 'dock' | 'farm' | 'forest' | 'ice' | 'desert' | 'haunted' | 'asian' | 'future'
export const THEMES: Theme[] = ['city', 'dock', 'farm', 'forest', 'ice', 'desert', 'haunted', 'asian', 'future']

/** Which obstacle set each of the 31 zones uses. Unknown zones fall back to the city. */
export const THEME_OF: Record<string, Theme> = {
  city: 'city', suburb: 'city', tunnel: 'city',
  beach: 'dock', seabridge: 'dock', port: 'dock', windcoast: 'dock',
  plains: 'farm', farm: 'farm', dawn: 'farm',
  forest: 'forest', river: 'forest', waterfall: 'forest', jungle: 'forest',
  snow: 'ice', icecave: 'ice', icelake: 'ice',
  desert: 'desert', redcanyon: 'desert', oasis: 'desert', savanna: 'desert', volcano: 'desert',
  haunted: 'haunted',
  blossom: 'asian', temple: 'asian', terraces: 'asian', halong: 'asian', floatmarket: 'asian',
  future: 'future', neon: 'future', highway: 'future',
}

export const themeOf = (zone: string): Theme => THEME_OF[zone] ?? 'city'

export const SKIN_KINDS = ['low', 'tall', 'tunnel', 'ramp'] as const
export type SkinKind = (typeof SKIN_KINDS)[number]
export type SkinBook = Record<Theme, Record<SkinKind, THREE.BufferGeometry[]>>

/** Kit props, baked: float position + linear colour + glow, centred, standing on y = 0. */
export type PropMap = Map<string, THREE.BufferGeometry>

type V3 = [number, number, number]
type Geo = THREE.BufferGeometry

// ---------------------------------------------------------------------------------
// Building blocks. Every part ends up non-indexed with exactly position, color and
// glow, so any mix of them merges into one geometry (one draw call per obstacle).

const colour = new THREE.Color()

function finish(source: Geo, hex: number, glow = 0): Geo {
  const geo = source.index ? source.toNonIndexed() : source
  if (geo !== source) source.dispose()
  geo.deleteAttribute('normal')
  geo.deleteAttribute('uv')
  const count = geo.attributes.position.count
  const rgb = new Float32Array(count * 3)
  colour.set(hex)
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = colour.r
    rgb[i * 3 + 1] = colour.g
    rgb[i * 3 + 2] = colour.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
  geo.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(count).fill(glow), 1))
  return geo
}

/** Brings an existing vertex-coloured geometry (the city gate) into the skin format. */
function adopt(source: Geo): Geo {
  const geo = source.index ? source.toNonIndexed() : source
  if (geo !== source) source.dispose()
  geo.deleteAttribute('normal')
  geo.deleteAttribute('uv')
  geo.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1))
  return geo
}

/** Box by its centre. */
const box = (w: number, h: number, d: number, hex: number, at: V3, glow = 0): Geo =>
  finish(new THREE.BoxGeometry(w, h, d).translate(at[0], at[1], at[2]), hex, glow)

/** Box standing on `y0`. */
const slab = (w: number, h: number, d: number, hex: number, x: number, y0: number, z: number, glow = 0): Geo =>
  box(w, h, d, hex, [x, y0 + h / 2, z], glow)

/** Rounded box by its centre — the soft bevel is what makes a block read as a toy. */
const rbox = (w: number, h: number, d: number, r: number, hex: number, at: V3, glow = 0, segments = 2): Geo =>
  finish(new RoundedBoxGeometry(w, h, d, segments, Math.min(r, w / 2, h / 2, d / 2) - 1e-4).translate(at[0], at[1], at[2]), hex, glow)

/** Cylinder along `axis`, by its centre. `scale` squashes the cross-section. */
function cyl(r: number, length: number, segments: number, hex: number, at: V3, axis: 'x' | 'y' | 'z' = 'y', glow = 0, rTop = r, scale?: V3): Geo {
  const geo = new THREE.CylinderGeometry(rTop, r, length, segments)
  if (axis === 'x') geo.rotateZ(-Math.PI / 2)
  if (axis === 'z') geo.rotateX(Math.PI / 2)
  if (scale) geo.scale(scale[0], scale[1], scale[2])
  return finish(geo.translate(at[0], at[1], at[2]), hex, glow)
}

/** A profile drawn in the (z, y) side view, extruded across the road (x). */
function prism(profile: Array<[number, number]>, length: number, hex: number, at: V3 = [0, 0, 0], glow = 0): Geo {
  const shape = new THREE.Shape()
  shape.moveTo(profile[0][0], profile[0][1])
  for (const [z, y] of profile.slice(1)) shape.lineTo(z, y)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false })
  // Shape x becomes world z; the extrusion runs along -x, so slide it back to centre.
  geo.rotateY(-Math.PI / 2)
  geo.translate(length / 2 + at[0], at[1], at[2])
  return finish(geo, hex, glow)
}

/** Any part, turned. */
function turned(geo: Geo, rx: number, ry: number, rz: number, at: V3): Geo {
  geo.translate(-at[0], -at[1], -at[2])
  if (rx) geo.rotateX(rx)
  if (ry) geo.rotateY(ry)
  if (rz) geo.rotateZ(rz)
  return geo.translate(at[0], at[1], at[2])
}

function merge(parts: Array<Geo | null>): Geo {
  const list = parts.filter((part): part is Geo => part !== null)
  const merged = mergeGeometries(list, false) as Geo
  for (const part of list) part.dispose()
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

/** Low and tall obstacles are positioned by their centre, like the boxes they replace. */
function centred(kind: 'low' | 'tall', geo: Geo): Geo {
  geo.translate(0, -OBSTACLES[kind].height / 2, 0)
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

// ---------------------------------------------------------------------------------
// Kit props.

/** Keeps each vertex's own shading but moves the prop onto a new base colour. */
function retint(geo: Geo, hex: number): void {
  const rgb = geo.attributes.color as THREE.BufferAttribute
  let sum = 0
  for (let i = 0; i < rgb.count; i++) sum += rgb.getX(i) * 0.2126 + rgb.getY(i) * 0.7152 + rgb.getZ(i) * 0.0722
  const mean = sum / Math.max(1, rgb.count) || 1
  colour.set(hex)
  for (let i = 0; i < rgb.count; i++) {
    const k = (rgb.getX(i) * 0.2126 + rgb.getY(i) * 0.7152 + rgb.getZ(i) * 0.0722) / mean
    rgb.setXYZ(i, Math.min(1, colour.r * k), Math.min(1, colour.g * k), Math.min(1, colour.b * k))
  }
}

interface Place {
  /** Exact size to stretch to (after turning), w × h × d. */
  fit?: V3
  /** Uniform scale instead of a fit. */
  scale?: number
  rx?: number
  ry?: number
  /** Footprint centre x, z and the y it stands on. */
  at: V3
  tint?: number
}

/** A copy of a kit prop, turned, sized and stood in place — or null if the pack lacks it. */
function prop(props: PropMap | null, name: string, place: Place): Geo | null {
  const source = props?.get(name)
  if (!source) return null
  const geo = source.clone()
  if (place.rx) geo.rotateX(place.rx)
  if (place.ry) geo.rotateY(place.ry)
  geo.computeBoundingBox()
  const b = geo.boundingBox as THREE.Box3
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2)
  const size = b.getSize(new THREE.Vector3())
  if (place.fit) geo.scale(place.fit[0] / size.x, place.fit[1] / size.y, place.fit[2] / size.z)
  else if (place.scale) geo.scale(place.scale, place.scale, place.scale)
  geo.translate(place.at[0], place.at[1], place.at[2])
  if (place.tint !== undefined) retint(geo, place.tint)
  return geo
}

/** Is this (linear) vertex colour a lit flame / carved-pumpkin face? */
function glowing(r: number, g: number, b: number): boolean {
  const s = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
  return s(r) > 0.97 && s(g) > 0.6 && s(b) < 0.45
}

/**
 * Bakes each `prop.<kit>.<model>` node of the pack into one float geometry: centred on
 * its footprint, standing on y = 0. Pure — no loading, no GPU — so the fit check can
 * run it too.
 */
export function bakeProps(root: THREE.Object3D): PropMap {
  root.updateMatrixWorld(true)
  const props: PropMap = new Map()
  for (const child of root.children) {
    const key = (child.userData?.name as string | undefined) ?? child.name
    const match = /^prop\.[^.]+\.(.+)$/.exec(key)
    if (!match) continue
    const parts: Geo[] = []
    child.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const source = mesh.geometry
      const position = source.getAttribute('position')
      const color = source.getAttribute('color')
      if (!position) return
      const index = source.index ? (source.index.array as ArrayLike<number>) : null
      const count = index ? index.length : position.count
      const pos = new Float32Array(count * 3)
      const rgb = new Float32Array(count * 3)
      const glow = new Float32Array(count)
      for (let n = 0; n < count; n++) {
        const i = index ? index[n] : n
        pos[n * 3] = position.getComponent(i, 0)
        pos[n * 3 + 1] = position.getComponent(i, 1)
        pos[n * 3 + 2] = position.getComponent(i, 2)
        const r = color ? color.getComponent(i, 0) : 0.8
        const g = color ? color.getComponent(i, 1) : 0.8
        const b = color ? color.getComponent(i, 2) : 0.8
        rgb[n * 3] = r
        rgb[n * 3 + 1] = g
        rgb[n * 3 + 2] = b
        glow[n] = glowing(r, g, b) ? 1.3 : 0
      }
      const part = new THREE.BufferGeometry()
      part.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      part.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
      part.setAttribute('glow', new THREE.BufferAttribute(glow, 1))
      part.applyMatrix4(mesh.matrixWorld)
      parts.push(part)
    })
    if (!parts.length) continue
    const geometry = parts.length === 1 ? parts[0] : (mergeGeometries(parts, false) as Geo)
    if (parts.length > 1) for (const part of parts) part.dispose()
    geometry.computeBoundingBox()
    const b = geometry.boundingBox as THREE.Box3
    geometry.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2)
    props.set(match[1], geometry)
  }
  return props
}

let pending: Promise<PropMap> | null = null

/** Loads (once) the obstacle prop pack. */
export function loadObstacleProps(url: string): Promise<PropMap> {
  if (!pending) {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    pending = loader.loadAsync(url).then((gltf) => {
      const props = bakeProps(gltf.scene)
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      })
      return props
    })
    pending.catch(() => {
      pending = null
    })
  }
  return pending
}

/**
 * One flat-shaded, vertex-coloured material for every skin. The `glow` attribute lifts
 * lamps, flames and carved faces into emission, so a haunted pumpkin still reads at
 * dusk without a single extra light.
 */
export function skinMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.04 })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow;')
  }
  material.customProgramCacheKey = () => 'obstacle-skin-glow'
  return material
}

// ---------------------------------------------------------------------------------
// The launch ramp. The old one was a wedge extruded *across* the lane with stripes on
// its face — from behind it read as a staircase. This one rises along the run: the
// lip sits on the road at the near end, the top edge 1.3 m up at the far end, with
// boards running up the slope, trimmed edges and arrows pointing up it.

interface RampStyle {
  body: number
  deck: number[]
  planks: number
  trim: number
  trimGlow?: number
  arrow: number
  arrowGlow?: number
  lip: number
}

export function rampSkin(style: RampStyle): Geo {
  const spec = OBSTACLES.ramp
  const w = spec.width
  const h = spec.height
  const d = spec.depth
  const angle = Math.atan2(h, d)
  const length = Math.hypot(h, d)
  // Local slope frame: x across, y off the surface, -z up the slope from the lip.
  const onSlope = (geo: Geo): Geo => geo.rotateX(angle).translate(0, 0, d / 2)
  const parts: Geo[] = []
  parts.push(prism([[d / 2, 0], [-d / 2, 0], [-d / 2, h]], w - 0.04, style.body))
  // Boards up the slope, a hair apart so the seams read as planks (or one plate).
  const inner = w - 0.3
  const pitch = inner / style.planks
  for (let i = 0; i < style.planks; i++) {
    const x = -inner / 2 + pitch * (i + 0.5)
    const plank = new THREE.BoxGeometry(pitch - (style.planks > 1 ? 0.035 : 0), 0.05, length - 0.08)
    parts.push(finish(onSlope(plank.translate(x, 0.025, -length / 2)), style.deck[i % style.deck.length]))
  }
  // Raised edge trim down both sides and a cross bar at the top.
  for (const side of [-1, 1]) {
    parts.push(finish(onSlope(new THREE.BoxGeometry(0.15, 0.1, length).translate(side * (w / 2 - 0.075), 0.05, -length / 2)), style.trim, style.trimGlow ?? 0))
  }
  parts.push(finish(onSlope(new THREE.BoxGeometry(w, 0.1, 0.14).translate(0, 0.05, -length + 0.07)), style.trim, style.trimGlow ?? 0))
  // Steel lip where the slope meets the road.
  parts.push(finish(onSlope(new THREE.BoxGeometry(w - 0.3, 0.03, 0.26).translate(0, 0.065, -0.17)), style.lip))
  // Three chevrons pointing up the slope.
  for (const u of [0.3, 0.52, 0.74]) {
    for (const side of [-1, 1]) {
      const bar = new THREE.BoxGeometry(0.62, 0.03, 0.14)
      bar.rotateY(side * Math.PI / 4)
      bar.translate(side * 0.19, 0.07, -length * u + 0.03)
      parts.push(finish(onSlope(bar), style.arrow, style.arrowGlow ?? 0))
    }
  }
  return merge(parts)
}

export const RAMPS: Record<'metal' | 'wood' | 'snow' | 'sand' | 'haunted' | 'lacquer' | 'neon', RampStyle> = {
  metal: { body: 0x3b4557, deck: [0x56627a], planks: 1, trim: 0xf7c33c, arrow: 0xf7c33c, arrowGlow: 0.35, lip: 0x9aa6b8 },
  wood: { body: 0x6b4630, deck: [0xc08a55, 0xa9733f, 0xb98048], planks: 5, trim: 0x5a3a24, arrow: 0xfff3d6, arrowGlow: 0.15, lip: 0x8c959c },
  snow: { body: 0x9fc6de, deck: [0xf2f8fc], planks: 1, trim: 0x5aa7d8, arrow: 0x3d8fd0, arrowGlow: 0.25, lip: 0xcfe6f4 },
  sand: { body: 0xb98a55, deck: [0xe8c48c, 0xdcb57a], planks: 4, trim: 0x8a5a36, arrow: 0xc8553d, lip: 0x9d7b52 },
  haunted: { body: 0x2c2733, deck: [0x4a3f4f, 0x3e3444, 0x463b4b], planks: 5, trim: 0x1d1a22, arrow: 0xb46cff, arrowGlow: 1.2, lip: 0x6a6f84 },
  lacquer: { body: 0x5c3a28, deck: [0xc8945a, 0xb9844c], planks: 4, trim: 0xc8362c, arrow: 0xf0c050, arrowGlow: 0.3, lip: 0x2a2a2e },
  neon: { body: 0x161c29, deck: [0x2a3346], planks: 1, trim: 0x2ee6ff, trimGlow: 1.1, arrow: 0x2ee6ff, arrowGlow: 1.4, lip: 0x8a94a8 },
}

// ---------------------------------------------------------------------------------
// Shared pieces.

const GATE = OBSTACLES.tunnel
const G0 = GATE.bottom
const G1 = GATE.bottom + GATE.height
const GW = GATE.width
const GD = GATE.depth
const POST_X = 5.4
const POST_W = 1.5
const POST_TOP = G1 + 0.7

const LOW = OBSTACLES.low
const TALL = OBSTACLES.tall

/** Wooden crate: a box with darker edge boards and a cross brace on the face. */
function crate(w: number, h: number, d: number, x: number, y0: number, z: number, wood = 0xc08a55, edge = 0x7a4e2e): Geo[] {
  const t = Math.min(0.09, w * 0.1)
  const y = y0 + h / 2
  const parts = [slab(w - 0.04, h - 0.04, d - 0.04, wood, x, y0 + 0.02, z)]
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(t, h, t, edge, [x + sx * (w / 2 - t / 2), y, z + sz * (d / 2 - t / 2)]))
  for (const sy of [-1, 1]) parts.push(box(w, t, t, edge, [x, y + sy * (h / 2 - t / 2), z + d / 2 - t / 2]))
  const diag = Math.hypot(w - 2 * t, h - 2 * t)
  parts.push(turned(box(diag, t * 0.9, 0.04, edge, [x, y, z + d / 2]), 0, 0, Math.atan2(h - 2 * t, w - 2 * t), [x, y, z + d / 2]))
  return parts
}

/** Barrel with hoops, standing on `y0`. */
function barrel(r: number, h: number, x: number, y0: number, z: number, body: number, hoop = 0x4b4f57): Geo[] {
  return [
    cyl(r, h, 12, body, [x, y0 + h / 2, z]),
    cyl(r * 1.04, 0.06, 12, hoop, [x, y0 + h * 0.2, z]),
    cyl(r * 1.04, 0.06, 12, hoop, [x, y0 + h * 0.8, z]),
    cyl(r * 0.8, 0.02, 12, hoop, [x, y0 + h + 0.005, z]),
  ]
}

/** Log along x with lighter cut ends. */
function log(r: number, length: number, x: number, y: number, z: number, bark = 0x7a4e2e, cut = 0xe3c79c): Geo[] {
  return [
    cyl(r, length, 10, bark, [x, y, z], 'x'),
    cyl(r * 0.88, 0.03, 10, cut, [x - length / 2 - 0.01, y, z], 'x'),
    cyl(r * 0.88, 0.03, 10, cut, [x + length / 2 + 0.01, y, z], 'x'),
  ]
}

/** Little pumpkin (procedural), standing on `y0`. */
function pumpkin(r: number, x: number, y0: number, z: number, body = 0xe8862e, face = false): Geo[] {
  const geo = new THREE.SphereGeometry(r, 8, 6)
  geo.scale(1, 0.72, 1)
  const parts = [finish(geo.translate(x, y0 + r * 0.72, z), body), cyl(r * 0.12, r * 0.4, 5, 0x4f7a2e, [x, y0 + r * 1.55, z])]
  if (face) parts.push(box(r * 0.9, r * 0.35, 0.04, 0xffc44d, [x, y0 + r * 0.72, z + r * 0.97], 1.4))
  return parts
}

/** Present with a ribbon cross, standing on `y0`. */
function present(s: number, h: number, x: number, y0: number, z: number, paper: number, ribbon: number): Geo[] {
  return [
    slab(s, h, s, paper, x, y0, z),
    slab(s + 0.02, h + 0.02, 0.1, ribbon, x, y0, z),
    slab(0.1, h + 0.02, s + 0.02, ribbon, x, y0, z),
  ]
}

/** Life ring in the x-y plane, red and white quarters. */
function lifeRing(r: number, tube: number, at: V3): Geo[] {
  const parts: Geo[] = []
  for (let i = 0; i < 4; i++) {
    const arc = new THREE.TorusGeometry(r, tube, 6, 6, Math.PI / 2)
    arc.rotateZ((i * Math.PI) / 2 + Math.PI / 4)
    parts.push(finish(arc.translate(at[0], at[1], at[2]), i % 2 ? 0xf4f4f0 : 0xe2412f))
  }
  return parts
}

const posts = (make: (x: number) => Geo[]): Geo[] => [...make(-POST_X), ...make(POST_X)]

// ---------------------------------------------------------------------------------
// The themes. Each builder returns one variant; builders that need kit props return
// null until the pack is there.

type Builder = (props: PropMap | null) => Geo | null

const CITY: Record<SkinKind, Builder[]> = {
  low: [
    // Striped road barricade on A-frame legs, amber lamps on the ends.
    () => {
      const p: Geo[] = []
      for (const x of [-0.8, 0.8]) {
        for (const s of [-1, 1]) p.push(turned(box(0.09, 0.92, 0.09, 0x3a414d, [x, 0.44, s * 0.26]), s * 0.42, 0, 0, [x, 0.44, s * 0.26]))
        p.push(slab(0.14, 0.05, 1.1, 0x2b3242, x, 0, 0))
      }
      for (const [y0, offset] of [[0.66, 0], [0.34, 1]] as const) {
        for (let i = 0; i < 5; i++) p.push(slab(0.4, 0.26, 0.12, (i + offset) % 2 ? 0xf4f4f0 : 0xe8463c, -0.8 + i * 0.4, y0, 0))
      }
      for (const x of [-0.82, 0.82]) p.push(slab(0.15, 0.12, 0.15, 0xffb22e, x, 0.92, 0, 1.3))
      return centred('low', merge(p))
    },
    // Concrete jersey barrier with a red-and-white top and amber reflectors.
    () => {
      const p: Geo[] = [prism([[0.55, 0], [0.55, 0.12], [0.36, 0.32], [0.17, 0.88], [-0.17, 0.88], [-0.36, 0.32], [-0.55, 0.12], [-0.55, 0]], 2.0, 0xc9ccd1)]
      for (let i = 0; i < 4; i++) p.push(slab(0.5, 0.05, 0.34, i % 2 ? 0xf4f4f0 : 0xe8463c, -0.75 + i * 0.5, 0.87, 0))
      for (const x of [-0.6, 0, 0.6]) p.push(turned(box(0.22, 0.1, 0.04, 0xffa21a, [x, 0.55, 0.29], 1.2), -0.33, 0, 0, [x, 0.55, 0.29]))
      return centred('low', merge(p))
    },
  ],
  tall: [
    // Chevron detour sign on a steel frame with concrete feet and warning lamps.
    () => {
      const p: Geo[] = []
      for (const x of [-0.72, 0.72]) p.push(rbox(0.5, 0.5, 1.12, 0.06, 0xbfc3c8, [x, 0.25, 0]))
      for (const x of [-0.94, 0.94]) p.push(slab(0.12, 2.55, 0.12, 0x3a414d, x, 0, 0))
      p.push(slab(1.9, 2.25, 0.14, 0xf28c28, 0, 0.32, 0))
      p.push(slab(1.96, 0.1, 0.18, 0x3a414d, 0, 2.5, 0))
      for (const x of [-0.56, 0, 0.56]) {
        for (const s of [-1, 1]) p.push(turned(box(0.56, 0.15, 0.04, 0xf7f7f2, [x + 0.08, 1.45 + s * 0.17, 0.09], 0.25), 0, 0, s * 0.72, [x + 0.08, 1.45 + s * 0.17, 0.09]))
      }
      for (const x of [-0.8, 0.8]) p.push(slab(0.18, 0.15, 0.18, 0xffb22e, x, 2.5, 0, 1.3))
      return centred('tall', merge(p))
    },
    // Two stacked site containers seen end-on.
    () => centred('tall', merge(containers([0x2f6db3, 0xe2652b]))),
  ],
  tunnel: [],
  ramp: [() => rampSkin(RAMPS.metal)],
}

function containers(colours: number[]): Geo[] {
  const p: Geo[] = []
  const h = TALL.height / 2
  colours.forEach((hex, row) => {
    const y0 = row * (h + 0.01)
    p.push(slab(1.98, h - 0.02, 1.1, hex, 0, y0, 0))
    // Corrugation, door bars and the corner castings.
    for (let i = 0; i < 6; i++) p.push(slab(0.08, h - 0.2, 0.05, row ? 0x1f4f86 : 0xb44a1c, -0.78 + i * 0.312, y0 + 0.1, 0.56))
    for (const x of [-0.25, 0.25]) p.push(slab(0.05, h - 0.26, 0.05, 0xd0d4d8, x, y0 + 0.13, 0.6))
    for (const x of [-0.93, 0.93]) for (const y of [y0 + 0.06, y0 + h - 0.08]) p.push(box(0.14, 0.12, 0.14, 0x5d636b, [x, y, 0.5]))
  })
  return p
}

const FARM: Record<SkinKind, Builder[]> = {
  low: [
    // Golden hay bales, three across and two high.
    (k) => {
      const p: Array<Geo | null> = []
      for (const [row, y0] of [[0, 0], [1, 0.46]] as const) {
        for (const x of [-0.66, 0, 0.66]) {
          p.push(prop(k, 'hay-bale', { fit: [0.66, 0.46, 1.08], ry: Math.PI / 2 + (row ? 0.0 : Math.PI), at: [x, y0, 0], tint: row ? 0xe9c46a : 0xd9b25a }))
        }
      }
      return p.some((part) => part === null) ? null : centred('low', merge(p))
    },
    // Pumpkin crate.
    () => {
      const p: Geo[] = [...crate(2.0, 0.52, 1.1, 0, 0, 0, 0xb37b4a, 0x6b4630)]
      p.push(...pumpkin(0.26, -0.62, 0.52, 0.08), ...pumpkin(0.28, 0.1, 0.52, -0.1, 0xf09a32), ...pumpkin(0.25, 0.68, 0.52, 0.14, 0xdf7a28))
      return centred('low', merge(p))
    },
  ],
  tall: [
    // Red barn wall: white trim, cross-braced door, a hay-loft window, a dark eave.
    () => {
      const p: Geo[] = [slab(1.96, 2.53, 1.0, 0xb8352b, 0, 0, 0)]
      for (const x of [-0.92, 0.92]) p.push(slab(0.14, 2.53, 0.08, 0xf4efe6, x, 0, 0.52))
      for (const y of [0, 1.42]) p.push(slab(1.96, 0.12, 0.08, 0xf4efe6, 0, y, 0.52))
      for (const s of [-1, 1]) p.push(turned(box(1.95, 0.12, 0.05, 0xf4efe6, [0, 0.71, 0.56]), 0, 0, s * Math.atan2(1.3, 1.7), [0, 0.71, 0.56]))
      p.push(slab(0.72, 0.62, 0.06, 0x3a2418, 0, 1.68, 0.52), slab(0.84, 0.08, 0.08, 0xf4efe6, 0, 2.3, 0.53), slab(0.84, 0.08, 0.08, 0xf4efe6, 0, 1.62, 0.53))
      p.push(prism([[0.6, 0], [-0.6, 0], [-0.6, 0.06], [0, 0.12], [0.6, 0.06]], 2.06, 0x5a4a42, [0, 2.53, 0]))
      return centred('tall', merge(p))
    },
  ],
  tunnel: [
    // Plank hay-loft bridge on rough log posts, bales up on top.
    (k) => {
      const p: Array<Geo | null> = []
      const tones = [0xb98048, 0xa9733f, 0xc08a55, 0x9c6a3a]
      const band = (G1 - G0) / 4
      for (let i = 0; i < 4; i++) p.push(slab(GW, band - 0.03, GD, tones[i], 0, G0 + i * band, 0))
      p.push(slab(GW + 0.1, 0.14, GD + 0.1, 0x6b4630, 0, G1 - 0.14, 0))
      for (const s of [-1, 1]) p.push(turned(box(Math.hypot(4.2, G1 - G0 - 0.3), 0.18, 0.08, 0x6b4630, [s * 2.3, (G0 + G1) / 2, GD / 2 + 0.04]), 0, 0, s * Math.atan2(G1 - G0 - 0.3, 4.2), [s * 2.3, (G0 + G1) / 2, GD / 2 + 0.04]))
      p.push(...posts((x) => [cyl(0.62, POST_TOP, 9, 0x7a5236, [x, POST_TOP / 2, 0]), cyl(0.66, 0.08, 9, 0x5a3a24, [x, POST_TOP, 0])]))
      for (const x of [-3.2, 3.0]) p.push(prop(k, 'hay-bale', { fit: [1.25, 0.6, 0.9], at: [x, G1, 0], tint: 0xe9c46a }))
      return merge(p)
    },
  ],
  ramp: [() => rampSkin(RAMPS.wood)],
}

const HAUNTED: Record<SkinKind, Builder[]> = {
  low: [
    // Mossy graveyard wall with glowing jack-o'-lanterns in front.
    (k) => {
      const p: Array<Geo | null> = [slab(2.0, 0.8, 0.66, 0x4a4f63, 0, 0, -0.22), slab(2.06, 0.12, 0.76, 0x6b7088, 0, 0.8, -0.22)]
      for (let i = 0; i < 4; i++) p.push(slab(0.04, 0.78, 0.02, 0x383c4d, -0.75 + i * 0.5, 0.01, 0.12))
      for (const x of [-0.52, 0.5]) {
        const kit = prop(k, 'pumpkin-carved', { fit: [0.5, 0.42, 0.5], at: [x, 0, 0.32] })
        if (kit) p.push(kit)
        else p.push(...pumpkin(0.24, x, 0, 0.32, 0xe07a2a, true))
      }
      return centred('low', merge(p))
    },
    // Headstone on a fresh grave, pumpkins either side.
    (k) => {
      const stone = prop(k, 'gravestone-wide', { fit: [1.92, 0.92, 0.4], at: [0, 0, -0.08] })
      if (!stone) return null
      const p: Array<Geo | null> = [stone, rbox(1.7, 0.2, 0.52, 0.09, 0x4a3a2e, [0, 0.09, 0.3])]
      for (const x of [-0.76, 0.76]) p.push(prop(k, 'pumpkin-carved', { fit: [0.44, 0.38, 0.44], at: [x, 0, 0.34], ry: x < 0 ? 0.3 : -0.3 }))
      return centred('low', merge(p))
    },
  ],
  tall: [
    // A coffin stood on end, pumpkins at its feet.
    (k) => {
      const coffin = prop(k, 'coffin', { fit: [1.5, 2.65, 0.6], rx: Math.PI / 2, at: [0, 0, 0.16] })
      if (!coffin) return null
      // Propped against a mausoleum wall so the whole lane reads as blocked.
      const p: Array<Geo | null> = [coffin, slab(2.0, 2.42, 0.42, 0x4a4f63, 0, 0, -0.34), slab(2.06, 0.14, 0.5, 0x6b7088, 0, 2.42, -0.34)]
      for (const x of [-0.74, 0.74]) p.push(slab(0.3, 2.3, 0.08, 0x3a3e50, x, 0.06, -0.1), slab(0.3, 0.06, 0.1, 0xb46cff, x, 1.7, -0.08, 1.1))
      for (const x of [-0.8, 0.8]) p.push(prop(k, 'pumpkin-carved', { fit: [0.38, 0.32, 0.38], at: [x, 0, 0.36] }))
      return centred('tall', merge(p))
    },
    // Crypt front: gabled stone with an arched door edged in ghost light.
    () => {
      const p: Geo[] = [slab(2.0, 2.25, 1.0, 0x4a4f63, 0, 0, 0), slab(2.08, 0.16, 1.08, 0x6b7088, 0, 0, 0)]
      p.push(finish(new THREE.CylinderGeometry(0.01, 1.18, 0.4, 4, 1).rotateY(Math.PI / 4).scale(1.18, 1, 0.62).translate(0, 2.45, 0), 0x3a3e50))
      p.push(slab(0.86, 1.3, 0.06, 0x1a1622, 0, 0.16, 0.51), cyl(0.43, 0.06, 10, 0x1a1622, [0, 1.46, 0.51], 'z'))
      for (const x of [-0.47, 0.47]) p.push(slab(0.07, 1.3, 0.05, 0xb46cff, x, 0.16, 0.54, 1.1))
      p.push(finish(new THREE.TorusGeometry(0.47, 0.035, 4, 10, Math.PI).translate(0, 1.46, 0.545), 0xb46cff, 1.1))
      p.push(slab(0.12, 0.5, 0.06, 0x8a90a8, 0, 1.75, 0.52), slab(0.36, 0.1, 0.06, 0x8a90a8, 0, 1.97, 0.52))
      return centred('tall', merge(p))
    },
  ],
  tunnel: [
    (k) => {
      const p: Array<Geo | null> = [slab(GW, G1 - G0 - 0.18, GD, 0x3e4254, 0, G0, 0), slab(GW + 0.2, 0.2, GD + 0.16, 0x5a5f74, 0, G1 - 0.2, 0)]
      // Ghost-light seam along the underside and blocks drawn into the face.
      p.push(slab(GW, 0.09, 0.06, 0xb46cff, 0, G0 + 0.02, GD / 2 + 0.02, 1.2))
      for (let i = -3; i <= 3; i++) p.push(slab(0.05, G1 - G0 - 0.5, 0.04, 0x2e3142, i * 1.3 + 0.65, G0 + 0.2, GD / 2 + 0.01))
      for (const x of [-2.4, 2.4]) p.push(prop(k, 'iron-fence', { fit: [2.6, 0.8, 0.12], at: [x, G1, 0] }))
      for (const x of [-4.2, 4.2]) p.push(prop(k, 'pumpkin-carved', { fit: [0.6, 0.5, 0.6], at: [x, G1, 0.25] }))
      p.push(
        ...posts((x) => [
          slab(POST_W - 0.1, POST_TOP - 0.25, 1.5, 0x4a4f63, x, 0, 0),
          slab(POST_W, 0.25, 1.6, 0x6b7088, x, POST_TOP - 0.25, 0),
          slab(0.34, 0.4, 0.34, 0xffb24a, x, POST_TOP, 0, 1.2),
          slab(0.46, 0.08, 0.46, 0x2a2733, x, POST_TOP + 0.4, 0),
        ])
      )
      return merge(p)
    },
  ],
  ramp: [() => rampSkin(RAMPS.haunted)],
}

const ICE: Record<SkinKind, Builder[]> = {
  low: [
    // Ice blocks under a snow cap.
    () => {
      const p: Geo[] = []
      ;[0x9fd8f2, 0x7cc4ea, 0x9fd8f2].forEach((hex, i) => {
        const x = -0.67 + i * 0.67
        p.push(rbox(0.64, 0.7, 1.04, 0.08, hex, [x, 0.35, 0], 0.12))
        p.push(rbox(0.7, 0.28, 1.1, 0.12, 0xf4fbff, [x, 0.78, 0], 0.05))
      })
      return centred('low', merge(p))
    },
    // Snowbank with presents.
    () => {
      const p: Geo[] = [rbox(2.0, 0.5, 1.1, 0.2, 0xeef6fb, [0, 0.25, 0], 0.05)]
      p.push(...present(0.5, 0.46, -0.58, 0.44, 0.05, 0xe2412f, 0xf6d36b), ...present(0.56, 0.48, 0.02, 0.44, -0.05, 0x2f8a5b, 0xf4f4f0), ...present(0.46, 0.4, 0.6, 0.44, 0.1, 0x3d7fd0, 0xf6d36b))
      return centred('low', merge(p))
    },
  ],
  tall: [
    (k) => {
      const snowman = prop(k, 'snowman-hat', { fit: [1.45, 2.65, 0.56], at: [0, 0, 0.05] })
      if (!snowman) return null
      // A packed-snow wall behind the snowman fills the lane; brick joints drawn on.
      const p: Array<Geo | null> = [snowman, rbox(2.0, 2.36, 0.38, 0.08, 0xe4f1f8, [0, 1.18, -0.35], 0.04), rbox(2.04, 0.18, 0.44, 0.08, 0xf8fdff, [0, 2.36, -0.35], 0.04)]
      for (let row = 1; row < 5; row++) p.push(slab(2.0, 0.03, 0.02, 0xb8d8ea, 0, row * 0.47, -0.155))
      for (let row = 0; row < 5; row++) for (const x of row % 2 ? [-0.75, -0.25, 0.25, 0.75] : [-0.5, 0, 0.5]) p.push(slab(0.03, 0.44, 0.02, 0xb8d8ea, x, row * 0.47 + 0.02, -0.155))
      return centred('tall', merge(p))
    },
    // Frozen slab with a snow cap.
    () => {
      const p: Geo[] = [rbox(1.96, 2.42, 1.0, 0.12, 0x8fd0ef, [0, 1.21, 0], 0.14)]
      for (const [x, y, s] of [[-0.45, 0.9, 0.5], [0.4, 1.6, 0.42], [0.1, 0.5, 0.3]] as const) p.push(rbox(s, s * 1.6, 0.06, 0.02, 0xd6f1fb, [x, y, 0.5], 0.25))
      p.push(rbox(2.0, 0.3, 1.1, 0.14, 0xf4fbff, [0, 2.5, 0], 0.05))
      return centred('tall', merge(p))
    },
  ],
  tunnel: [
    () => {
      const p: Geo[] = [slab(GW, G1 - G0 - 0.27, GD, 0xa9dcf3, 0, G0, 0, 0.12)]
      p.push(rbox(GW + 0.3, 0.32, GD + 0.2, 0.14, 0xf4fbff, [0, G1 - 0.16, 0], 0.05))
      // Frost crystals on the face — all above the clearance.
      for (let i = 0; i < 9; i++) {
        const x = -4 + i
        const h = 0.32 + ((i * 37) % 5) * 0.06
        p.push(finish(new THREE.ConeGeometry(0.16, h, 4).rotateX(Math.PI).translate(x, G0 + 0.32 + h / 2, GD / 2 + 0.06), 0xe3f6ff, 0.3))
      }
      p.push(...posts((x) => [slab(POST_W - 0.14, POST_TOP - 0.3, 1.48, 0x8fd0ef, x, 0, 0, 0.12), rbox(POST_W, 0.34, 1.6, 0.14, 0xf4fbff, [x, POST_TOP - 0.17, 0], 0.05)]))
      return merge(p)
    },
  ],
  ramp: [() => rampSkin(RAMPS.snow)],
}

const DESERT: Record<SkinKind, Builder[]> = {
  low: [
    // Sandstone boulders.
    (k) => {
      const p = [
        prop(k, 'rock-sand-b', { fit: [1.25, 0.92, 1.1], at: [0, 0, 0] }),
        prop(k, 'rock-sand-b', { fit: [0.72, 0.56, 0.84], ry: Math.PI, at: [-0.66, 0, 0.08] }),
        prop(k, 'rock-sand-b', { fit: [0.68, 0.46, 0.76], ry: Math.PI / 2, at: [0.68, 0, -0.05] }),
      ]
      return p.some((part) => part === null) ? null : centred('low', merge(p))
    },
    // A fallen column on its plinth stones.
    () => {
      const p: Geo[] = [cyl(0.46, 1.9, 12, 0xe2b77c, [0, 0.46, 0], 'x')]
      for (const x of [-0.6, 0, 0.6]) p.push(cyl(0.475, 0.07, 12, 0xc9965a, [x, 0.46, 0], 'x'))
      for (const x of [-0.95, 0.95]) p.push(cyl(0.5, 0.1, 12, 0xd0a36a, [x, 0.46, 0], 'x'))
      p.push(slab(0.5, 0.18, 0.9, 0xb98a55, 0.55, 0, 0.12), slab(0.42, 0.14, 0.7, 0xb98a55, -0.62, 0, -0.18))
      return centred('low', merge(p))
    },
  ],
  tall: [
    (k) => {
      const rock = prop(k, 'rock_tallA', { fit: [2.0, 2.65, 1.12], at: [0, 0, 0], tint: 0xd9a066 })
      // Solid core so the crag never shows daylight where the hitbox is.
      return rock ? centred('tall', merge([rock, rbox(1.7, 2.62, 0.74, 0.22, 0xc48f55, [0, 1.31, 0])])) : null
    },
    // Carved sandstone pier with cacti.
    (k) => {
      const p: Array<Geo | null> = [slab(1.86, 2.25, 0.96, 0xe0b072, 0, 0, 0), slab(2.0, 0.16, 1.1, 0xc9965a, 0, 0, 0)]
      p.push(slab(2.0, 0.18, 1.1, 0xc9965a, 0, 2.25, 0), slab(1.7, 0.22, 0.9, 0xe7c08a, 0, 2.43, 0))
      p.push(slab(1.6, 0.12, 0.04, 0x2f9c95, 0, 1.75, 0.49), slab(1.6, 0.06, 0.04, 0xc8553d, 0, 1.6, 0.49))
      for (const x of [-0.5, 0, 0.5]) p.push(slab(0.18, 0.9, 0.04, 0xa8763f, x, 0.45, 0.49))
      for (const x of [-0.82, 0.8]) p.push(prop(k, 'cactus_tall', { fit: [0.36, 1.05, 0.36], at: [x, 0, 0.36], tint: 0x5f9e4a }))
      return centred('tall', merge(p))
    },
  ],
  tunnel: [
    () => {
      const p: Geo[] = [slab(GW, G1 - G0 - 0.4, GD, 0xe0b072, 0, G0, 0)]
      p.push(slab(GW + 0.3, 0.18, GD + 0.2, 0xc9965a, 0, G1 - 0.4, 0), slab(GW, 0.22, GD - 0.1, 0xe7c08a, 0, G1 - 0.22, 0))
      p.push(slab(GW - 0.6, 0.16, 0.04, 0x2f9c95, 0, G0 + 1.0, GD / 2 + 0.01), slab(GW - 0.6, 0.07, 0.04, 0xc8553d, 0, G0 + 0.84, GD / 2 + 0.01))
      for (let i = 0; i < 11; i++) p.push(slab(0.22, 0.42, 0.04, 0xa8763f, -4 + i * 0.8, G0 + 0.24, GD / 2 + 0.01))
      p.push(...posts((x) => [cyl(0.66, POST_TOP - 0.3, 12, 0xe2b77c, [x, (POST_TOP - 0.3) / 2, 0]), slab(POST_W, 0.3, 1.6, 0xc9965a, x, POST_TOP - 0.3, 0), slab(POST_W, 0.2, 1.6, 0xc9965a, x, 0, 0), cyl(0.69, 0.08, 12, 0xc9965a, [x, 1.2, 0])]))
      return merge(p)
    },
  ],
  ramp: [() => rampSkin(RAMPS.sand)],
}

const FOREST: Record<SkinKind, Builder[]> = {
  low: [
    (k) => {
      const trunk = prop(k, 'log_large', { fit: [2.0, 0.92, 1.0], at: [0, 0, 0] })
      return trunk ? centred('low', merge([trunk, slab(0.7, 0.05, 0.36, 0x4f9a3c, 0.2, 0.86, 0)])) : null
    },
    // Mossy fallen log with toadstools.
    () => {
      const p: Geo[] = [...log(0.44, 2.0, 0, 0.44, 0)]
      p.push(rbox(1.3, 0.1, 0.52, 0.04, 0x4f9a3c, [-0.15, 0.87, 0]), rbox(0.5, 0.08, 0.4, 0.03, 0x3f8a34, [0.62, 0.84, 0.05]))
      for (const [x, z, s] of [[-0.62, 0.5, 1], [-0.42, 0.52, 0.7], [0.55, 0.5, 0.85]] as const) {
        p.push(cyl(0.035 * s, 0.2 * s, 5, 0xf1e6d0, [x, 0.1 * s, z]), finish(new THREE.SphereGeometry(0.1 * s, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, 0.2 * s, z), 0xd8402f))
      }
      return centred('low', merge(p))
    },
  ],
  tall: [
    // Timber stack held by stakes.
    () => {
      const p: Geo[] = []
      for (const [i, y] of [0.44, 1.32, 2.2].entries()) p.push(...log(0.44, 1.92 - i * 0.04, 0, y, 0, i % 2 ? 0x6b4630 : 0x7a4e2e))
      for (const x of [-0.98, 0.98]) for (const z of [-0.36, 0.36]) p.push(slab(0.1, 2.62, 0.1, 0x5a3a24, x, 0, z))
      p.push(rbox(1.0, 0.08, 0.5, 0.03, 0x4f9a3c, [0.3, 2.66, 0]))
      return centred('tall', merge(p))
    },
    (k) => {
      const rock = prop(k, 'rock_tallA', { fit: [2.0, 2.65, 1.12], ry: Math.PI, at: [0, 0, 0], tint: 0x8f9a8a })
      return rock ? centred('tall', merge([rock, rbox(1.7, 2.6, 0.74, 0.22, 0x7f8a7a, [0, 1.3, 0]), rbox(0.9, 0.08, 0.66, 0.03, 0x4f9a3c, [0.15, 2.61, 0])])) : null
    },
  ],
  tunnel: [
    // A fallen giant across the road, resting on two stumps.
    () => {
      const ry = (G1 - G0) / 2
      const cy = G0 + ry
      const p: Geo[] = [
        cyl(1, GW + 0.6, 14, 0x6b4630, [0, cy, 0], 'x', 0, 1, [1, ry, GD / 2]),
        cyl(0.9, 0.04, 14, 0xe3c79c, [-(GW + 0.6) / 2 - 0.02, cy, 0], 'x', 0, 0.9, [1, ry, GD / 2]),
        cyl(0.9, 0.04, 14, 0xe3c79c, [(GW + 0.6) / 2 + 0.02, cy, 0], 'x', 0, 0.9, [1, ry, GD / 2]),
      ]
      for (const [x, w] of [[-2.6, 2.4], [1.2, 1.6], [3.6, 1.1]] as const) p.push(rbox(w, 0.12, 0.7, 0.05, 0x4f9a3c, [x, G1 - 0.02, 0]))
      p.push(turned(cyl(0.12, 0.9, 6, 0x5a3a24, [1.8, G1 + 0.3, 0], 'y', 0, 0.06), 0, 0, -0.5, [1.8, G1, 0]))
      p.push(...posts((x) => [cyl(0.7, POST_TOP - 0.2, 10, 0x7a5236, [x, (POST_TOP - 0.2) / 2, 0], 'y', 0, 0.62), cyl(0.62, 0.05, 10, 0xe3c79c, [x, POST_TOP - 0.18, 0]), cyl(0.75, 0.5, 10, 0x6b4630, [x, 0.25, 0], 'y', 0, 0.7)]))
      return merge(p)
    },
  ],
  ramp: [() => rampSkin(RAMPS.wood)],
}

const ASIAN: Record<SkinKind, Builder[]> = {
  low: [
    // Whitewashed garden wall under a grey tiled cap.
    () => {
      const p: Geo[] = [slab(2.0, 0.14, 0.86, 0x8b8f96, 0, 0, 0), slab(1.96, 0.54, 0.74, 0xf1ebe0, 0, 0.14, 0)]
      p.push(prism([[0.52, 0], [0.52, 0.04], [0, 0.2], [-0.52, 0.04], [-0.52, 0]], 2.1, 0x4a5058, [0, 0.68, 0]))
      p.push(cyl(0.05, 2.1, 6, 0x3a3f46, [0, 0.87, 0], 'x'))
      p.push(slab(0.62, 0.32, 0.04, 0x2f6b52, 0, 0.25, 0.37), slab(0.5, 0.2, 0.05, 0xf1ebe0, 0, 0.31, 0.38))
      for (const x of [-0.12, 0.12]) p.push(slab(0.04, 0.32, 0.06, 0x2f6b52, x, 0.25, 0.38))
      return centred('low', merge(p))
    },
    // Lacquered planter with cherry blossom.
    () => {
      const p: Geo[] = [slab(2.0, 0.48, 1.0, 0x5a3a28, 0, 0, 0), slab(2.04, 0.07, 1.04, 0xd9a441, 0, 0.42, 0)]
      for (const [x, y, w, hex] of [[-0.55, 0.66, 0.8, 0xf4a6c0], [0.05, 0.7, 0.9, 0xf8c3d4], [0.6, 0.66, 0.76, 0xe98aa9]] as const) p.push(rbox(w, 0.44, 0.9, 0.18, hex, [x, y, 0], 0.08))
      return centred('low', merge(p))
    },
  ],
  tall: [
    // Vermilion gate panel: black lattice, gold studs, a little tiled roof.
    () => {
      const p: Geo[] = [slab(1.9, 2.22, 0.9, 0xc8362c, 0, 0, 0)]
      for (const x of [-0.45, 0, 0.45]) p.push(slab(0.06, 1.6, 0.04, 0x231a1a, x, 0.4, 0.46))
      for (const y of [0.4, 0.93, 1.46, 2.0]) p.push(slab(1.6, 0.06, 0.04, 0x231a1a, 0, y, 0.46))
      for (const x of [-0.7, 0.7]) for (const y of [0.7, 1.2, 1.7]) p.push(box(0.08, 0.08, 0.05, 0xe8b64c, [x, y, 0.47], 0.35))
      p.push(slab(2.0, 0.12, 1.0, 0x231a1a, 0, 2.18, 0))
      p.push(prism([[0.6, 0], [0.6, 0.06], [0, 0.32], [-0.6, 0.06], [-0.6, 0]], 2.16, 0x4a5058, [0, 2.3, 0]))
      p.push(cyl(0.05, 2.16, 6, 0x3a3f46, [0, 2.6, 0], 'x'))
      return centred('tall', merge(p))
    },
  ],
  tunnel: [
    // Torii: red pillars, the black kasagi on top, a plaque in the middle.
    () => {
      const red = 0xd23a2c
      const p: Geo[] = [
        slab(11.8, 0.48, 0.6, red, 0, G0, 0),
        slab(12.6, 0.26, 0.9, red, 0, G1 - 0.5, 0),
        slab(13.2, 0.24, GD, 0x231a1a, 0, G1 - 0.24, 0),
        slab(0.36, G1 - G0 - 0.98, 0.4, red, 0, G0 + 0.48, 0),
        slab(1.2, 0.74, 0.22, 0x231a1a, 0, G0 + 0.6, 0.18),
        slab(1.0, 0.56, 0.06, 0xe8b64c, 0, G0 + 0.69, 0.3, 0.25),
      ]
      for (const s of [-1, 1]) p.push(turned(slab(1.3, 0.24, GD, 0x231a1a, s * 6.75, G1 - 0.24, 0), 0, 0, s * 0.22, [s * 6.1, G1 - 0.12, 0]))
      p.push(...posts((x) => [cyl(0.6, G1 - 0.5, 12, red, [x, (G1 - 0.5) / 2, 0]), cyl(0.7, 0.42, 12, 0x231a1a, [x, 0.21, 0])]))
      return merge(p)
    },
  ],
  ramp: [() => rampSkin(RAMPS.lacquer)],
}

const DOCK: Record<SkinKind, Builder[]> = {
  low: [
    // Barrels on a pallet.
    (k) => {
      const p: Array<Geo | null> = []
      for (const z of [-0.42, 0, 0.42]) p.push(slab(2.0, 0.05, 0.28, 0xb98a5c, 0, 0.1, z))
      for (const x of [-0.82, 0, 0.82]) p.push(slab(0.14, 0.1, 1.12, 0x8a6440, x, 0, 0))
      ;[0x2f6db3, 0xe2412f, 0x2f6db3].forEach((tint, i) => {
        const x = -0.66 + i * 0.66
        const kit = prop(k, 'barrel', { fit: [0.62, 0.77, 0.62], at: [x, 0.15, i === 1 ? -0.1 : 0.08], tint: i === 1 ? undefined : tint })
        p.push(...(kit ? [kit] : barrel(0.31, 0.77, x, 0.15, 0, tint)))
      })
      return centred('low', merge(p))
    },
    // Cargo crate with a barrel each side.
    () => {
      const p: Geo[] = [...crate(1.0, 0.92, 1.05, 0, 0, 0)]
      p.push(...barrel(0.25, 0.7, -0.75, 0, 0.18, 0x2f6db3), ...barrel(0.25, 0.64, 0.75, 0, -0.1, 0xe2412f))
      p.push(finish(new THREE.TorusGeometry(0.2, 0.07, 5, 10).rotateX(Math.PI / 2).translate(0.72, 0.71, -0.1), 0xd9c28f))
      return centred('low', merge(p))
    },
  ],
  tall: [
    // Crate stack.
    () => {
      const p: Geo[] = [...crate(1.04, 1.3, 1.1, -0.48, 0, 0), ...crate(1.04, 1.3, 1.1, 0.48, 0, 0, 0xb37b4a)]
      p.push(...crate(1.12, 1.35, 1.06, -0.04, 1.3, 0, 0xc9965a), ...barrel(0.22, 0.72, 0.76, 1.3, 0.1, 0xe2412f))
      return centred('tall', merge(p))
    },
    () => centred('tall', merge(containers([0xe2652b, 0x2fa38f]))),
  ],
  tunnel: [
    // Driftwood pier beam with rope and life rings, on rope-bound pilings.
    () => {
      const tones = [0x9b7b5c, 0x8a6c50, 0xa58565, 0x7f6248, 0x9b7b5c]
      const band = (G1 - G0) / 5
      const p: Geo[] = []
      for (let i = 0; i < 5; i++) p.push(slab(GW - (i % 2) * 0.12, band - 0.03, GD, tones[i], 0, G0 + i * band, 0))
      p.push(slab(GW + 0.2, 0.12, GD + 0.1, 0x6b5440, 0, G1 - 0.12, 0))
      p.push(cyl(0.07, GW, 6, 0xd9c28f, [0, G1 - 0.32, GD / 2 + 0.06], 'x'))
      for (const x of [-2.6, 2.6]) p.push(...lifeRing(0.42, 0.12, [x, (G0 + G1) / 2 - 0.05, GD / 2 + 0.14]))
      p.push(...posts((x) => [cyl(0.66, POST_TOP, 10, 0x7a5a3e, [x, POST_TOP / 2, 0]), cyl(0.69, 0.14, 10, 0xd9c28f, [x, 0.9, 0]), cyl(0.69, 0.14, 10, 0xd9c28f, [x, POST_TOP - 0.5, 0]), cyl(0.6, 0.06, 10, 0x5a4434, [x, POST_TOP + 0.03, 0])]))
      return merge(p)
    },
  ],
  ramp: [() => rampSkin(RAMPS.wood)],
}

const CYAN = 0x2ee6ff
const MAGENTA = 0xff3dbd

const FUTURE: Record<SkinKind, Builder[]> = {
  low: [
    // Dark block with a cyan light seam.
    () => {
      const p: Geo[] = [rbox(2.0, 0.84, 1.1, 0.1, 0x1b2230, [0, 0.42, 0]), rbox(1.9, 0.1, 1.0, 0.04, 0x323c52, [0, 0.87, 0])]
      p.push(slab(1.8, 0.07, 0.04, CYAN, 0, 0.5, 0.55, 1.5), slab(1.8, 0.03, 0.04, CYAN, 0, 0.78, 0.55, 1.2))
      for (const x of [-1.0, 1.0]) p.push(slab(0.04, 0.5, 0.5, MAGENTA, x, 0.2, 0, 1.3))
      return centred('low', merge(p))
    },
    // Wedge with arrows lit up its face.
    () => {
      const p: Geo[] = [prism([[0.56, 0], [0.56, 0.16], [0.1, 0.92], [-0.56, 0.92], [-0.56, 0]], 2.0, 0x1b2230)]
      const slope = Math.atan2(0.76, 0.46)
      for (const [i, t] of [0.22, 0.5, 0.78].entries()) {
        const y = 0.16 + 0.76 * t
        const z = 0.56 - 0.46 * t + 0.03
        p.push(turned(box(1.7 - i * 0.2, 0.06, 0.03, MAGENTA, [0, y, z], 1.4), -slope + Math.PI / 2, 0, 0, [0, y, z]))
      }
      p.push(slab(2.0, 0.04, 0.62, 0x323c52, 0, 0.9, -0.24))
      return centred('low', merge(p))
    },
  ],
  tall: [
    // Monolith with light bars.
    () => {
      const p: Geo[] = [rbox(2.0, 2.6, 1.0, 0.08, 0x151b28, [0, 1.3, 0]), slab(2.0, 0.05, 1.0, 0x323c52, 0, 2.6, 0)]
      for (const x of [-0.62, 0, 0.62]) p.push(slab(0.08, 1.8, 0.04, CYAN, x, 0.45, 0.51, 1.5))
      p.push(slab(1.9, 0.05, 0.04, MAGENTA, 0, 2.42, 0.51, 1.3), slab(1.9, 0.05, 0.04, MAGENTA, 0, 0.2, 0.51, 1.3))
      return centred('tall', merge(p))
    },
  ],
  tunnel: [
    () => {
      const p: Geo[] = [slab(GW, G1 - G0 - 0.12, GD, 0x1c2333, 0, G0, 0), slab(GW + 0.1, 0.12, GD + 0.1, 0x8a94a8, 0, G1 - 0.12, 0)]
      p.push(slab(GW, 0.1, 0.06, CYAN, 0, G0 + 0.04, GD / 2 + 0.02, 1.5), slab(GW - 0.8, 0.05, 0.05, MAGENTA, 0, G1 - 0.32, GD / 2 + 0.02, 1.3))
      for (let i = -3; i <= 3; i++) p.push(slab(0.8, 0.05, 0.05, CYAN, i * 1.2, (G0 + G1) / 2, GD / 2 + 0.02, 0.9))
      p.push(...posts((x) => [slab(POST_W, POST_TOP, 1.6, 0x1c2333, x, 0, 0), slab(0.1, POST_TOP - 0.6, 0.05, CYAN, x, 0.3, 0.81, 1.5), slab(POST_W, 0.08, 1.6, MAGENTA, x, POST_TOP - 0.08, 0, 1.2)]))
      return merge(p)
    },
  ],
  ramp: [() => rampSkin(RAMPS.neon)],
}

const BOOK: Record<Theme, Record<SkinKind, Builder[]>> = {
  city: CITY,
  dock: DOCK,
  farm: FARM,
  forest: FOREST,
  ice: ICE,
  desert: DESERT,
  haunted: HAUNTED,
  asian: ASIAN,
  future: FUTURE,
}

/**
 * Builds the skin book: every skin that can be built with what is there. Without the
 * prop pack the procedural skins cover every theme and kind on their own; once it has
 * loaded the book is rebuilt with the kit skins (and the kit upgrades) in it.
 * `cityGate` is the classic gantry, kept for the city.
 */
export function buildSkins(props: PropMap | null, cityGate?: () => Geo): SkinBook {
  const book = {} as SkinBook
  for (const theme of THEMES) {
    book[theme] = { low: [], tall: [], tunnel: [], ramp: [] }
    for (const kind of SKIN_KINDS) {
      for (const build of BOOK[theme][kind]) {
        const geo = build(props)
        if (geo) book[theme][kind].push(geo)
      }
    }
  }
  if (cityGate) book.city.tunnel.push(adopt(cityGate()))
  return book
}
