/**
 * Does the slide look like a slide? — measured, not judged.
 *
 * The KayKit rigs ship ten clips and not one of them gets low. Measured through
 * `Dodge_Forward`, the clip the state machine used to reach for, the head drops 0.10 m
 * while the run cycle itself bounces 0.16 m: a sliding runner read as *taller* than a
 * running one, while the collision box quietly shrank from 1.70 m to 0.86 m.
 *
 * So the slide is a body transform (`SLIDE_LEAN` / `SLIDE_SQUASH` / `SLIDE_LIFT` in
 * `model.ts`) on top of a clip that holds a straight pose. This script holds the
 * result to the numbers that matter, and it measures the **skinned mesh**, not the
 * bones: the rigs are skinned, so a bone position says nothing about where the body
 * actually is — the chibi head and the torso are both much bigger than their bones,
 * and they are what decides where the top lands.
 *
 *  1. the top of the body must come down to the box the game collides with, so what
 *     the player sees is what the game uses;
 *  2. nothing may sink into the road;
 *  3. the runner must actually lie down — the body's own axis near horizontal, and
 *     the chest turned up, so it reads as a slide on the back and not a dive;
 *  4. the feet must lead, which is the direction the collision box is drawn for;
 *  5. the runner must keep their proportions. Squashing the body along its own
 *     length makes them *stubbier* rather than lower — that is a crouch wearing a
 *     slide's clothes, and it is what made the character look like a flattened
 *     cut-out.
 *
 *   bun run scripts/slide-pose.ts            assert
 *   bun run scripts/slide-pose.ts --sweep    every angle, to choose one
 *   bun run scripts/slide-pose.ts --clips    every clip, to choose one
 */
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { BODY, CHARACTERS, CHARACTER_IDS, RUN } from '../src/runner/config'
import { SLIDE_CLIP, SLIDE_LEAN, SLIDE_LIFT, SLIDE_SQUASH } from '../src/runner/model'

/** The top of the model has to fit the box the game collides with. */
const VISIBLE_BUDGET = BODY.slideHeight + BODY.forgiveness
/** How far off horizontal the body's own axis may sit and still read as lying down. */
const LYING_MAX_SLOPE = 25
/** What the player has to notice. */
const DROP_MIN = 0.6
/** How far the body has to reach back from the feet, so the feet are plainly leading. */
const LEAD_MIN = 0.3
/**
 * How far a hanging bit of cloth may pass through the road. A cape or a hat tip lying
 * on the ground would flatten, so a little clipping is correct; more than this and the
 * body itself is under the road.
 */
const CLOTH_CLIP = 0.35

interface Rig {
  nodes: any[]
  gltf: any
  bin: Buffer
  hide: string[]
  height: number
  posed: Map<string, THREE.Vector3[]>
}

const COMPONENT: Record<number, { bytes: number; read: (b: Buffer, o: number) => number; max: number }> = {
  5120: { bytes: 1, read: (b, o) => b.readInt8(o), max: 127 },
  5121: { bytes: 1, read: (b, o) => b.readUInt8(o), max: 255 },
  5122: { bytes: 2, read: (b, o) => b.readInt16LE(o), max: 32767 },
  5123: { bytes: 2, read: (b, o) => b.readUInt16LE(o), max: 65535 },
  5125: { bytes: 4, read: (b, o) => b.readUInt32LE(o), max: 4294967295 },
  5126: { bytes: 4, read: (b, o) => b.readFloatLE(o), max: 1 },
}
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

function readAccessor(rig: Rig, index: number): number[][] {
  const a = rig.gltf.accessors[index]
  const view = rig.gltf.bufferViews[a.bufferView]
  const comp = COMPONENT[a.componentType]
  const size = TYPE_SIZE[a.type]
  const stride = view.byteStride ?? comp.bytes * size
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const out: number[][] = []
  for (let i = 0; i < a.count; i += 1) {
    const v: number[] = []
    for (let c = 0; c < size; c += 1) {
      const raw = comp.read(rig.bin, base + i * stride + c * comp.bytes)
      v.push(a.normalized ? raw / comp.max : raw)
    }
    out.push(v)
  }
  return out
}

/** glTF strips the punctuation out of node names, so matching is by substring. */
const shown = (rig: Rig, name: string): boolean =>
  !rig.hide.map((n) => n.replace(/[\[\].:/]/g, '').toLowerCase()).some((h) => name.toLowerCase().includes(h))

function load(path: string, hide: string[], height: number): Rig {
  const buffer = readFileSync(path)
  const jsonLength = buffer.readUInt32LE(12)
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
  return { nodes: gltf.nodes, gltf, bin: buffer.subarray(20 + jsonLength + 8), hide, height, posed: new Map() }
}

type Pose = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }[]

function basePose(rig: Rig): Pose {
  return rig.nodes.map((n) => ({
    position: new THREE.Vector3().fromArray(n.translation ?? [0, 0, 0]),
    quaternion: new THREE.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]),
    scale: new THREE.Vector3().fromArray(n.scale ?? [1, 1, 1]),
  }))
}

function worldMatrices(rig: Rig, pose: Pose): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = []
  const walk = (index: number, parent: THREE.Matrix4): void => {
    const p = pose[index]
    out[index] = new THREE.Matrix4().multiplyMatrices(
      parent,
      new THREE.Matrix4().compose(p.position, p.quaternion, p.scale)
    )
    for (const child of rig.nodes[index].children ?? []) walk(child, out[index])
  }
  const identity = new THREE.Matrix4()
  for (const scene of rig.gltf.scenes) for (const index of scene.nodes) walk(index, identity)
  return out
}

/**
 * The real, skinned body: every vertex moved by its bones. Bone positions are not
 * enough — the head and torso are far bigger than the joints inside them, and it is
 * the surface, not the skeleton, that has to clear the barrier.
 */
function skinnedPoints(rig: Rig, pose: Pose, keep?: (name: string) => boolean): THREE.Vector3[] {
  const world = worldMatrices(rig, pose)
  const out: THREE.Vector3[] = []
  rig.nodes.forEach((node, index) => {
    if (node.mesh === undefined || node.skin === undefined) return
    if (keep && !keep(node.name ?? '')) return
    const skin = rig.gltf.skins[node.skin]
    const ibm = readAccessor(rig, skin.inverseBindMatrices)
    const mats = skin.joints.map((joint: number, j: number) =>
      new THREE.Matrix4().multiplyMatrices(world[joint], new THREE.Matrix4().fromArray(ibm[j]))
    )
    for (const primitive of rig.gltf.meshes[node.mesh].primitives) {
      const positions = readAccessor(rig, primitive.attributes.POSITION)
      const joints = readAccessor(rig, primitive.attributes.JOINTS_0)
      const weights = readAccessor(rig, primitive.attributes.WEIGHTS_0)
      for (let i = 0; i < positions.length; i += 1) {
        const p = new THREE.Vector3().fromArray(positions[i])
        const acc = new THREE.Vector3()
        for (let k = 0; k < 4; k += 1) {
          const w = weights[i][k]
          if (!w) continue
          acc.addScaledVector(p.clone().applyMatrix4(mats[joints[i][k]]), w)
        }
        out.push(acc)
      }
    }
  })
  return out
}

/** The same skinning, but grouped by mesh name, so an outlier can be named. */
function skinnedByMesh(rig: Rig, pose: Pose, keep?: (name: string) => boolean): Map<string, THREE.Vector3[]> {
  const grouped = new Map<string, THREE.Vector3[]>()
  rig.nodes.forEach((node, index) => {
    if (node.mesh === undefined || node.skin === undefined) return
    const name = node.name ?? `node${index}`
    if (keep && !keep(name)) return
    grouped.set(name, [])
  })
  const world = worldMatrices(rig, pose)
  const out = new Map<string, THREE.Vector3[]>()
  for (const [name, list] of grouped) out.set(name, list)
  rig.nodes.forEach((node, index) => {
    if (node.mesh === undefined || node.skin === undefined) return
    const name = node.name ?? `node${index}`
    if (!out.has(name)) return
    const skin = rig.gltf.skins[node.skin]
    const ibm = readAccessor(rig, skin.inverseBindMatrices)
    const mats = skin.joints.map((joint: number, j: number) =>
      new THREE.Matrix4().multiplyMatrices(world[joint], new THREE.Matrix4().fromArray(ibm[j]))
    )
    for (const primitive of rig.gltf.meshes[node.mesh].primitives) {
      const positions = readAccessor(rig, primitive.attributes.POSITION)
      const joints = readAccessor(rig, primitive.attributes.JOINTS_0)
      const weights = readAccessor(rig, primitive.attributes.WEIGHTS_0)
      for (let i = 0; i < positions.length; i += 1) {
        const p = new THREE.Vector3().fromArray(positions[i])
        const acc = new THREE.Vector3()
        for (let k = 0; k < 4; k += 1) {
          const w = weights[i][k]
          if (!w) continue
          acc.addScaledVector(p.clone().applyMatrix4(mats[joints[i][k]]), w)
        }
        out.get(name)!.push(acc)
      }
    }
  })
  return out
}

/** The pose a clip holds. Every clip here is a one-shot, so it clamps on its last frame. */
function clipPose(rig: Rig, clipName: string): Pose {
  const key = `${clipName}`
  const pose = basePose(rig)
  const clip = (rig.gltf.animations ?? []).find((a: any) => a.name === clipName)
  if (!clip) throw new Error(`no ${clipName} in the rig`)
  for (const channel of clip.channels) {
    const values = readAccessor(rig, clip.samplers[channel.sampler].output)
    const node = channel.target.node
    const last = values.length - 1
    if (channel.target.path === 'translation') pose[node].position.fromArray(values[last])
    else if (channel.target.path === 'rotation') pose[node].quaternion.fromArray(values[last])
  }
  rig.posed.set(key, [])
  return pose
}

function boneIndex(rig: Rig, name: string): number {
  return rig.nodes.findIndex((n) => (n.name ?? '').toLowerCase() === name)
}

/**
 * The scale `model.ts` applies: the character is fitted to its world height using the
 * box of the *loaded* scene, before any clip plays. Measuring the fit from the posed
 * box instead would quietly resize the runner every time a clip spread their legs.
 */
function fitOf(rig: Rig, height: number): number {
  const box = new THREE.Box3()
  for (const p of skinnedPoints(rig, basePose(rig))) box.expandByPoint(p)
  return height / (box.max.y - box.min.y)
}

/**
 * The slide transform from `model.ts`, in the root's frame.
 *
 * three.js composes `T · R · S`, so the squash happens first, then the tip over the
 * feet, then the lift. The model scene is turned to face the runner's forward, so its
 * local +z is the root's -z — which is why the z term reads the way it does here.
 */
function slid(point: THREE.Vector3, lean: number, squash: number, lift: number): THREE.Vector3 {
  const cos = Math.cos(lean)
  const sin = Math.sin(lean)
  const y = point.y * squash
  return new THREE.Vector3(point.x, y * cos + point.z * sin + lift, y * sin - point.z * cos)
}

/** Everything that has to be true of a slide pose, for one rig at one set of numbers. */
interface Reading {
  name: string
  tallest: string
  boneLow: number
  standing: number
  top: number
  lowest: number
  slope: number
  chestUp: number
  lead: number
  drop: number
}

function readRig(rig: Rig, spec: any, lean: number, squash: number, lift: number, clipName: string): Reading {
  const pose = clipPose(rig, clipName)
  const fit = fitOf(rig, spec.modelHeight ?? 1.74)
  const world = worldMatrices(rig, pose)
  const at = (index: number): THREE.Vector3 =>
    new THREE.Vector3().setFromMatrixPosition(world[index]).multiplyScalar(fit)

  const cos = Math.cos(lean)
  const sin = Math.sin(lean)
  const box = new THREE.Box3()
  const scratch = new THREE.Vector3()
  for (const raw of skinnedPoints(rig, pose, (name) => shown(rig, name))) {
    const p = raw.multiplyScalar(fit)
    const y = p.y * squash
    box.expandByPoint(scratch.set(p.x, y * cos + p.z * sin + lift, y * sin - p.z * cos))
  }

  const boneLow = Math.min(
    ...['hips', 'head', 'foot.l', 'foot.r', 'hand.l', 'hand.r']
      .map((n) => boneIndex(rig, n))
      .filter((i) => i >= 0)
      .map((i) => slid(at(i), lean, squash, lift).y)
  )

  const headGround = slid(at(boneIndex(rig, 'head')), lean, squash, lift)
  const hipsGround = slid(at(boneIndex(rig, 'hips')), lean, squash, lift)
  const footGround = slid(at(boneIndex(rig, 'foot.l')), lean, squash, lift)
  // The body's own axis, head to hips: lying down means that line is near horizontal,
  // not that the head is any particular distance from a foot a clip threw forward.
  const slope =
    (Math.atan2(Math.abs(headGround.y - hipsGround.y), Math.abs(headGround.z - hipsGround.z)) * 180) / Math.PI

  // Name the culprit rather than guessing: which mesh owns the highest vertex?
  let tallest = ''
  let tallestY = -Infinity
  for (const [name, points] of skinnedByMesh(rig, pose, (n) => shown(rig, n))) {
    for (const raw of points) {
      const p = raw.multiplyScalar(fit)
      const y = p.y * squash
      const world = y * cos + p.z * sin + lift
      if (world > tallestY) {
        tallestY = world
        tallest = name
      }
    }
  }

  const standing = spec.modelHeight ?? 1.74
  return {
    tallest,
    boneLow,
    name: spec.name,
    standing,
    top: box.max.y,
    lowest: box.min.y,
    slope,
    // The model faces -z in the runner's frame, so tipping by `lean` turns the chest
    // to face `sin(lean)` upward. Negative means face-down.
    chestUp: Math.sin(lean),
    lead: headGround.z - footGround.z,
    drop: standing - box.max.y,
  }
}

const NOCAPE = process.argv.includes('--nocape')

function loadAll(): { rig: Rig; spec: any }[] {
  return CHARACTER_IDS.map((id) => ({
    rig: load(
      `src/assets/models/${CHARACTERS[id].model.split('/').pop()}`,
      NOCAPE ? [...(CHARACTERS[id].hideNodes ?? []), 'Cape'] : (CHARACTERS[id].hideNodes ?? []),
      CHARACTERS[id].modelHeight ?? 1.74
    ),
    spec: CHARACTERS[id],
  }))
}

/** Every rig, at one set of numbers, with the lift chosen so no rig scrapes the road. */
function readAll(lean: number, squash: number, clipName: string): { lift: number; readings: Reading[] } {
  const rigs = loadAll()
  const probe = rigs.map(({ rig, spec }) => readRig(rig, spec, lean, squash, 0, clipName))
  const lift = Math.max(...probe.map((r) => -r.lowest), 0)
  return { lift, readings: rigs.map(({ rig, spec }) => readRig(rig, spec, lean, squash, lift, clipName)) }
}

// --- which clip makes the best slide? ----------------------------------------
if (process.argv.includes('--clips')) {
  const rig = load('src/assets/models/knight.glb', [], 1.74)
  const spec = { name: 'knight', modelHeight: 1.74 }
  console.log('clip             hip→foot  head up   body axis   at an 89° tip: top / screen height')
  for (const name of ['Idle', 'Jump_Idle', 'Jump_Land', 'Jump_Start', 'Dodge_Forward', 'Dodge_Left', 'Cheer']) {
    try {
      const up = readRig(rig, spec, 0.0001, 1, 0, name)
      const { lift } = readAll(1.55, 1, name)
      const down = readRig(rig, spec, 1.55, 1, lift, name)
      // A crouch folds the legs: the feet come up towards the hips. A pose that only
      // tips over keeps the legs long, and a long body pointed at the chase camera is
      // foreshortened into a blob — it does not read as "low" at all.
      const pose = clipPose(rig, name)
      const world = worldMatrices(rig, pose)
      const fit = fitOf(rig, spec.modelHeight ?? 1.74)
      const point = (bone: string): THREE.Vector3 =>
        new THREE.Vector3().setFromMatrixPosition(world[boneIndex(rig, bone)]).multiplyScalar(fit)
      const fold = Math.min(
        ...['foot.l', 'foot.r'].map((f) => point('hips').distanceTo(point(f)))
      )
      const headUp = point('head').y
      console.log(
        `${name.padEnd(16)} ${fold.toFixed(2)} m   ${headUp.toFixed(2)} m   ${up.slope.toFixed(0).padStart(3)}° off horizontal   ` +
          `top ${down.top.toFixed(2)}  screen ${(down.top / (spec.modelHeight ?? 1.74) * 100).toFixed(0)}% of standing`
      )
    } catch {
      console.log(`${name.padEnd(16)} —`)
    }
  }
  process.exit(0)
}

// --- the sweep that chooses the angle ----------------------------------------
if (process.argv.includes('--sweep') && !process.argv.includes('--view')) {
  console.log(`clip ${SLIDE_CLIP}`)
  console.log('lean  deg  squash   lift   worst top   worst lowest   body slope')
  for (const lean of [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8]) {
    for (const squash of [1, 0.9]) {
      const { lift, readings } = readAll(lean, squash, SLIDE_CLIP)
      const top = Math.max(...readings.map((r) => r.top))
      const low = Math.min(...readings.map((r) => r.lowest))
      const slope = Math.max(...readings.map((r) => r.slope))
      console.log(
        `${lean.toFixed(2)}  ${((lean * 180) / Math.PI).toFixed(0).padStart(3)}  ${squash.toFixed(2)}   ${lift.toFixed(3)}   ` +
          `${top.toFixed(2)} ${top <= VISIBLE_BUDGET ? '(fits)   ' : '(TOO TALL)'}  ${low.toFixed(3)}        ${slope.toFixed(0).padStart(2)}°`
      )
    }
  }
  process.exit(0)
}

// --- what the game camera actually sees ---------------------------------------
// A pose can measure perfectly and still read as a blob. This projects the real
// skinned body through the real game camera and prints the silhouette, so the shape
// can be looked at rather than argued about.
if (process.argv.includes('--view')) {
  const W = 74
  const H = 24
  const camera = new THREE.PerspectiveCamera(62, 1.7, 0.1, 200)
  camera.position.set(0, RUN.camHeight, RUN.camDistance)
  camera.lookAt(0, 1.35, -8)
  camera.updateMatrixWorld(true)

  const draw = (rig: Rig, spec: any, lean: number, label: string, lift = SLIDE_LIFT): void => {
    const pose = clipPose(rig, SLIDE_CLIP)
    const fit = fitOf(rig, spec.modelHeight ?? 1.74)
    const grid = Array.from({ length: H }, () => new Array<string>(W).fill(' '))
    const cos = Math.cos(lean)
    const sin = Math.sin(lean)
    for (const [name, points] of skinnedByMesh(rig, pose, (n) => shown(rig, n))) {
      const isHead = /_head/i.test(name)
      for (const raw of points) {
        const p = raw.multiplyScalar(fit)
        const y = p.y * SLIDE_SQUASH
        const world = new THREE.Vector3(
          p.x,
          y * cos + p.z * sin + lift,
          y * sin - p.z * cos
        ).project(camera)
        const col = Math.round(((world.x + 1) / 2) * (W - 1))
        const row = Math.round(((1 - world.y) / 2) * (H - 1))
        if (col < 0 || col >= W || row < 0 || row >= H) continue
        grid[row][col] = isHead ? '#' : 'o'
      }
    }
    console.log(`\n${spec.name} — ${label}   (# head   o body, as the chase camera sees it)`)
    for (const row of grid) console.log('|' + row.join('') + '|')
  }

  const all = loadAll()
  const rig = all[0].rig
  const spec = all[0].spec
  draw(rig, spec, 0.0001, 'standing, for comparison')
  const angles = process.argv.includes('--sweep') ? [1.2, 1.35, 1.5, 1.55, 1.65, 1.8] : [SLIDE_LEAN]
  for (const lean of angles) {
    const { lift } = readAll(lean, SLIDE_SQUASH, SLIDE_CLIP)
    draw(rig, spec, lean, `sliding (${SLIDE_CLIP}, ${((lean * 180) / Math.PI).toFixed(0)}°, lift ${lift.toFixed(2)})`, lift)
  }
  process.exit(0)
}

// --- assertions ---------------------------------------------------------------
console.log(
  `slide · clip ${SLIDE_CLIP} · tips ${SLIDE_LEAN} rad (${((SLIDE_LEAN * 180) / Math.PI).toFixed(0)}°) · squash ${SLIDE_SQUASH} · lift ${SLIDE_LIFT} m`
)
console.log(
  `collision box ${BODY.slideHeight} m (+${BODY.forgiveness} forgiveness) = ${VISIBLE_BUDGET.toFixed(2)} m of visible budget\n`
)

let failed = 0
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
}

check(
  'the runner keeps their proportions',
  SLIDE_SQUASH >= 0.95,
  `squash ${SLIDE_SQUASH}${SLIDE_SQUASH >= 0.95 ? '' : ' — squashing the body along its own length makes the runner stubbier, not lower'}`
)

for (const { rig, spec } of loadAll()) {
  const r = readRig(rig, spec, SLIDE_LEAN, SLIDE_SQUASH, SLIDE_LIFT, SLIDE_CLIP)
  console.log(
    `${r.name.padEnd(10)} standing ${r.standing.toFixed(2)} → top ${r.top.toFixed(2)}  (drop ${r.drop.toFixed(2)})  ` +
      `body ${r.slope.toFixed(0)}° off horizontal  chest up ${r.chestUp.toFixed(2)}  lead ${r.lead.toFixed(2)}  lowest ${r.lowest.toFixed(2)}`
  )
  check(`${r.name}: the runner goes down, not just crouches`, r.drop > DROP_MIN, `${r.drop.toFixed(2)} m lower than standing`)
  check(
    `${r.name}: the body lies down`,
    r.slope < LYING_MAX_SLOPE,
    `head-to-hips line is ${r.slope.toFixed(0)}° off horizontal (want under ${LYING_MAX_SLOPE}°)`
  )
  check(
    `${r.name}: the runner lands on their back, not their face`,
    r.chestUp > 0.8,
    `chest faces up at ${r.chestUp.toFixed(2)} (a forward dive would be negative)`
  )
  check(
    `${r.name}: the feet lead`,
    r.lead > LEAD_MIN,
    `the body reaches ${r.lead.toFixed(2)} m back from the feet (want over ${LEAD_MIN} m)`
  )
  check(
    `${r.name}: the visible top matches the collision box`,
    r.top <= VISIBLE_BUDGET,
    `${r.top.toFixed(2)} m vs the ${VISIBLE_BUDGET.toFixed(2)} m budget`
  )
  check(
    `${r.name}: the body rests on the road`,
    r.lowest > -CLOTH_CLIP && r.lowest < 0.15,
    `lowest vertex ${r.lowest.toFixed(2)} m — above 0.15 the runner floats, below -${CLOTH_CLIP} even the cloth is buried`
  )
}

console.log(failed === 0 ? '\nSlide pose check passed.' : `\n${failed} slide check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
