/**
 * Geometry check for the archer's kit, with no browser involved.
 *
 * Two questions, both asked against the rig's rest pose (the pose `attachGear` runs
 * in) and both about the view that matters — the one from behind the runner:
 *
 *  1. Does the bolt quiver, placed by the same maths `gear.ts` uses, cover the head?
 *  2. Does the crossbow the rig ships on its own hand slot cover the head?
 *
 * The crossbow is the rig's own prop, so it is measured straight out of the GLB
 * rather than replayed: every vertex of the mesh, in world space, after the fit.
 *
 *   bun run scripts/carry-geometry.ts
 */
import { readFileSync } from 'node:fs'
import * as THREE from 'three'

interface GltfNode {
  name?: string
  children?: number[]
  mesh?: number
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  skin?: number
}
interface Gltf {
  nodes: GltfNode[]
  scenes: { nodes: number[] }[]
  meshes: { primitives: { attributes: { POSITION: number }; material?: number }[] }[]
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[]
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[]
  buffers: { byteLength: number }[]
}

function parseGlb(path: string): { gltf: Gltf; bin: Buffer } {
  const buffer = readFileSync(path)
  const jsonLength = buffer.readUInt32LE(12)
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf
  const binStart = 20 + jsonLength + 8
  return { gltf, bin: buffer.subarray(binStart) }
}

const HEIGHT = 1.74
const MODEL = 'src/assets/models/rogue_hooded.glb'
const { gltf, bin } = parseGlb(MODEL)

const nodeWorld: THREE.Matrix4[] = []
const local = new THREE.Matrix4()
const position = new THREE.Vector3()
const quaternion = new THREE.Quaternion()
const scale = new THREE.Vector3()

const walk = (index: number, parent: THREE.Matrix4): void => {
  const node = gltf.nodes[index]
  position.fromArray(node.translation ?? [0, 0, 0])
  quaternion.fromArray(node.rotation ?? [0, 0, 0, 1])
  scale.fromArray(node.scale ?? [1, 1, 1])
  local.compose(position, quaternion, scale)
  const world = new THREE.Matrix4().multiplyMatrices(parent, local)
  nodeWorld[index] = world
  for (const child of node.children ?? []) walk(child, world)
}
const identity = new THREE.Matrix4()
for (const scene of gltf.scenes) for (const index of scene.nodes) walk(index, identity)

const positions = (index: number): THREE.Vector3[] => {
  const node = gltf.nodes[index]
  if (node.mesh === undefined) return []
  const out: THREE.Vector3[] = []
  for (const primitive of gltf.meshes[node.mesh].primitives) {
    const accessor = gltf.accessors[primitive.attributes.POSITION]
    if (!accessor.bufferView || accessor.componentType !== 5126) continue
    const view = gltf.bufferViews[accessor.bufferView]
    const stride = view.byteStride ?? 12
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const vector = new THREE.Vector3()
    for (let i = 0; i < accessor.count; i += 1) {
      const at = start + i * stride
      vector.set(bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8))
      out.push(vector.clone().applyMatrix4(nodeWorld[index]))
    }
  }
  return out
}

const isHead = (node: GltfNode): boolean => /_head/i.test(node.name ?? '')
const headPoints: THREE.Vector3[] = []
const bodyPoints: THREE.Vector3[] = []
gltf.nodes.forEach((node, index) => {
  if (node.mesh === undefined) return
  const points = positions(index)
  if (isHead(node)) headPoints.push(...points)
  else bodyPoints.push(...points)
})

const box = (points: THREE.Vector3[]): THREE.Box3 => {
  const b = new THREE.Box3()
  for (const p of points) b.expandByPoint(p)
  return b
}
const bodyBox = box([...bodyPoints, ...headPoints])
const fit = HEIGHT / (bodyBox.max.y - bodyBox.min.y)
const world = new THREE.Matrix4().makeScale(fit, fit, fit)

const head = headPoints.map((p) => p.clone().applyMatrix4(world))
const headBox = box(head)
const headAt = new THREE.Vector3()
const chestAt = new THREE.Vector3()
const chestIndex = gltf.nodes.findIndex((n) => (n.name ?? '').toLowerCase() === 'chest')
const headIndex = gltf.nodes.findIndex((n) => (n.name ?? '').toLowerCase() === 'head')
headAt.setFromMatrixPosition(nodeWorld[headIndex]).multiplyScalar(fit)
chestAt.setFromMatrixPosition(nodeWorld[chestIndex]).multiplyScalar(fit)

// --- the placement gear.ts uses ----------------------------------------------
const rootQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0))
const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQuat) // the rig faces +z locally
const behind = forward.clone().negate()

const desired = new THREE.Matrix4().compose(chestAt, rootQuat, new THREE.Vector3(1, 1, 1))

// The quiver rides the torso holder gear.ts builds.
const waist = HEIGHT * 0.55 - chestAt.y
const quiverDrop = Number(process.env.QUIVER_DROP ?? 0.3)
const quiverTilt = Number(process.env.QUIVER_TILT ?? -0.5)
const quiverLocal = new THREE.Matrix4().compose(
  new THREE.Vector3(0.12, waist - quiverDrop, -0.32),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0, quiverTilt)),
  new THREE.Vector3(1, 1, 1)
)
const quiver = new THREE.Matrix4().multiplyMatrices(desired, quiverLocal)

/** Head silhouette seen from behind: for each height band, the widest |x|. */
const bands = new Map<number, number>()
const BAND = 0.04
for (const point of head) {
  const key = Math.round(point.y / BAND)
  bands.set(key, Math.max(bands.get(key) ?? 0, Math.abs(point.x - headAt.x)))
}
const headHalfWidth = (y: number): number | null => {
  const key = Math.round(y / BAND)
  for (let d = 0; d <= 2; d += 1) {
    for (const probe of [key - d, key + d]) {
      const value = bands.get(probe)
      if (value !== undefined) return value
    }
  }
  return null
}

// --- 1. the quiver, sampled along its length --------------------------------
let quiverOverlaps = 0
let samples = 0
let quiverWorst = ''
for (let i = 0; i <= 60; i += 1) {
  const t = i / 60
  const point = new THREE.Vector3(0, -0.25 + 0.5 * t, 0).applyMatrix4(quiver)
  samples += 1
  const half = headHalfWidth(point.y)
  if (half === null) continue
  if (point.y < headBox.min.y || point.y > headBox.max.y) continue
  const lateral = Math.abs(point.x - headAt.x)
  if (lateral < half && point.clone().sub(headAt).dot(behind) > 0) {
    quiverOverlaps += 1
    quiverWorst = `worst gap ${(half - lateral).toFixed(3)} at y ${point.y.toFixed(2)}`
  }
}

// --- 2. the crossbow, straight out of the rig --------------------------------
const crossbowIndex = gltf.nodes.findIndex((n) => /^2H_Crossbow$/i.test(n.name ?? ''))
if (crossbowIndex < 0) throw new Error('rogue_hooded.glb has no 2H_Crossbow')
const crossbow = positions(crossbowIndex).map((p) => p.clone().applyMatrix4(world))
const crossbowBox = box(crossbow)
let crossbowOverlaps = 0
let nearestGap = Infinity
for (const point of crossbow) {
  const half = headHalfWidth(point.y)
  if (half === null) continue
  if (point.y < headBox.min.y || point.y > headBox.max.y) continue
  if (point.clone().sub(headAt).dot(behind) <= 0) continue
  const lateral = Math.abs(point.x - headAt.x)
  nearestGap = Math.min(nearestGap, lateral - half)
  if (lateral < half) crossbowOverlaps += 1
}

const fmt = (v: THREE.Vector3): string => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`
console.log(`rig            ${MODEL}`)
console.log(`head bone      ${fmt(headAt)}   head box y ${headBox.min.y.toFixed(2)}..${headBox.max.y.toFixed(2)}  half-width ${Math.max(...bands.values()).toFixed(2)}`)
console.log(`chest bone     ${fmt(chestAt)}`)
console.log(`crossbow       ${crossbow.length} verts  x ${crossbowBox.min.x.toFixed(2)}..${crossbowBox.max.x.toFixed(2)}  y ${crossbowBox.min.y.toFixed(2)}..${crossbowBox.max.y.toFixed(2)}`)
console.log(`behind dir     ${fmt(behind)}`)
console.log('')

const checks: [string, boolean, string][] = [
  ['quiver never covers the head from behind', quiverOverlaps === 0, quiverOverlaps ? `${quiverOverlaps}/${samples} samples overlap (${quiverWorst})` : `0/${samples} samples overlap`],
  ['crossbow never covers the head from behind', crossbowOverlaps === 0, crossbowOverlaps ? `${crossbowOverlaps} verts overlap` : `0/${crossbow.length} verts overlap, closest approach ${nearestGap.toFixed(2)} m`],
  ['crossbow clears the road', crossbowBox.min.y > 0.2, `lowest point y ${crossbowBox.min.y.toFixed(2)}`],
  ['crossbow sits beside the body, not through it', Math.abs(crossbowBox.max.x) > 0.35 || Math.abs(crossbowBox.min.x) > 0.35, `reaches x ${crossbowBox.min.x.toFixed(2)}..${crossbowBox.max.x.toFixed(2)}`],
]

let failed = 0
for (const [label, ok, detail] of checks) {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
}
console.log(failed === 0 ? '\nCarry geometry check passed.' : `\n${failed} carry check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
