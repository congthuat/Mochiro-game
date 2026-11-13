/**
 * What each hero carries and how their back reads — straight from the rig files, no browser.
 *
 * Two things are checked:
 *
 *  1. **Kit.** The KayKit rigs ship every prop in the pack and the game switches off
 *     the ones a class should not have. That switch is easy to lose when a rig is
 *     swapped, so this replays each character's `hideNodes` and reports the survivors.
 *  2. **The view from behind.** The gameplay camera sits behind the runner, so the
 *     back is what the player actually looks at. Every rig ships the same teal cape,
 *     which made the roster read as five copies — this decodes the texture atlas,
 *     applies the character's palette swap exactly as `recolor.ts` does, samples the
 *     vertices that face the camera, and fails if two heroes end up looking alike.
 *
 *   bun run scripts/kit-check.ts
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import * as THREE from 'three'
import { CHARACTERS, CHARACTER_IDS } from '../src/runner/config'
import { PERSONA_BACK } from '../src/runner/persona'

const HEIGHT = 1.74
const WEAPON = /(knife|crossbow|sword|staff|axe|shield)/i

// ------------------------------------------------------------------ glTF ---

interface Rig {
  gltf: any
  bin: Buffer
  nodeWorld: THREE.Matrix4[]
}

function load(path: string): Rig {
  const buffer = readFileSync(path)
  const jsonLength = buffer.readUInt32LE(12)
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
  const bin = buffer.subarray(20 + jsonLength + 8)
  const nodeWorld: THREE.Matrix4[] = []
  const walk = (index: number, parent: THREE.Matrix4): void => {
    const node = gltf.nodes[index]
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1])
    )
    const world = new THREE.Matrix4().multiplyMatrices(parent, local)
    nodeWorld[index] = world
    for (const child of node.children ?? []) walk(child, world)
  }
  const identity = new THREE.Matrix4()
  for (const scene of gltf.scenes) for (const index of scene.nodes) walk(index, identity)
  return { gltf, bin, nodeWorld }
}

function accessor(rig: Rig, index: number): number[][] {
  const a = rig.gltf.accessors[index]
  const view = rig.gltf.bufferViews[a.bufferView]
  const size = { VEC3: 3, VEC2: 2 }[a.type as 'VEC3' | 'VEC2']
  const stride = view.byteStride ?? 4 * size
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const out: number[][] = []
  for (let i = 0; i < a.count; i += 1) {
    const values: number[] = []
    for (let c = 0; c < size; c += 1) values.push(rig.bin.readFloatLE(base + i * stride + c * 4))
    out.push(values)
  }
  return out
}

// ------------------------------------------------------------------- png ---

interface Bitmap {
  width: number
  height: number
  channels: number
  pixels: Uint8Array
}

/** Minimal PNG reader: the atlases are 8-bit non-interlaced, so this is enough. */
function readPng(bytes: Buffer): Bitmap | null {
  if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) return null
  let at = 8
  let width = 0
  let height = 0
  let depth = 8
  let colorType = 6
  const chunks: Buffer[] = []
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('ascii', at + 4, at + 8)
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colorType = body[9]
      if (body[12] !== 0) return null
    } else if (type === 'IDAT') chunks.push(body)
    else if (type === 'IEND') break
    at += 12 + length
  }
  if (!width || !height || depth !== 8) return null
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!channels) return null
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const pixels = new Uint8Array(height * stride)
  let prev = new Uint8Array(stride)
  let cursor = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor]
    cursor += 1
    const line = new Uint8Array(raw.subarray(cursor, cursor + stride))
    cursor += stride
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      if (filter === 1) line[i] = (line[i] + a) & 255
      else if (filter === 2) line[i] = (line[i] + b) & 255
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
    }
    pixels.set(line, y * stride)
    prev = line
  }
  return { width, height, channels, pixels }
}

// -------------------------------------------------------------- palette ---

type Rgb = [number, number, number]

function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return 0
  let hue: number
  if (max === r) hue = (((g - b) / delta) % 6) * 60
  else if (max === g) hue = ((b - r) / delta + 2) * 60
  else hue = ((r - g) / delta + 4) * 60
  return (hue + 360) % 360
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    let value = t
    if (value < 0) value += 1
    if (value > 1) value -= 1
    if (value < 1 / 6) return p + (q - p) * 6 * value
    if (value < 1 / 2) return q
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
    return p
  }
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
}

/** The same palette swap recolor.ts performs on the atlas. */
function repaint(rgb: Rgb, spec: any | undefined): Rgb {
  if (!spec) return rgb
  const [r, g, b] = rgb.map((value) => value / 255) as Rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const plain = delta < (spec.threshold ?? 0.06)
  if (plain && !spec.grey) return rgb
  if (!plain) {
    const hue = hueOf(r, g, b)
    const [lo, hi] = spec.from
    const inside = lo <= hi ? hue >= lo && hue <= hi : hue >= lo || hue <= hi
    if (!inside) return rgb
  }
  const lightness = (max + min) / 2
  const saturation = plain ? 0.55 : delta / (1 - Math.abs(2 * lightness - 1) || 1)
  const out = hslToRgb(
    spec.to / 360,
    Math.min(1, saturation * (spec.sat ?? 1)),
    Math.min(0.8, lightness * (spec.light ?? 1))
  )
  return out.map((value) => Math.round(value * 255)) as Rgb
}

// ---------------------------------------------------------------- report ---

interface Report {
  id: string
  name: string
  shown: string[]
  crossing: string[]
  cape: boolean
  capeHue: number | null
  back: Rgb | null
  backHex: string
}

/** The surfaces the camera behind the runner actually reads. */
const GARMENT = /(_body|_cape|_hat)/i

const reports: Report[] = []

for (const id of CHARACTER_IDS) {
  const spec = CHARACTERS[id]
  const rig = load(`src/assets/models/${spec.model.split('/').pop()}`)
  const hiddenPatterns = (spec.hideNodes ?? []).map((name) => name.replace(/[\[\].:/]/g, '').toLowerCase())
  const shown = (name: string): boolean => !hiddenPatterns.some((pattern) => name.toLowerCase().includes(pattern))

  const meshes = rig.gltf.nodes
    .map((node: any, index: number) => ({ node, index }))
    .filter(({ node }) => node.mesh !== undefined && !/_head/i.test(node.name ?? ''))

  const body = new THREE.Box3()
  for (const { index } of meshes) {
    for (const p of accessor(rig, rig.gltf.meshes[rig.gltf.nodes[index].mesh].primitives[0].attributes.POSITION)) {
      body.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(rig.nodeWorld[index]))
    }
  }
  const fit = HEIGHT / (body.max.y - body.min.y)
  const scale = new THREE.Matrix4().makeScale(fit, fit, fit)

  // The head has to come from the *whole* node list: `meshes` deliberately excludes
  // head meshes so the body box is not measured through them, which left this list
  // empty and the crossing test below silently doing nothing.
  const headPoints = rig.gltf.nodes
    .map((node: any, index: number) => ({ node, index }))
    .filter(({ node }) => node.mesh !== undefined && /_head/i.test(node.name ?? ''))
    .flatMap(({ index }) =>
      rig.gltf.meshes[rig.gltf.nodes[index].mesh].primitives.flatMap((primitive: any) =>
        accessor(rig, primitive.attributes.POSITION).map((p) =>
          new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(rig.nodeWorld[index]).applyMatrix4(scale)
        )
      )
    )
  const headBox = new THREE.Box3()
  for (const point of headPoints) headBox.expandByPoint(point)
  const headIndex = rig.gltf.nodes.findIndex((node: any) => (node.name ?? '').toLowerCase() === 'head')
  const headAt = new THREE.Vector3().setFromMatrixPosition(rig.nodeWorld[headIndex]).multiplyScalar(fit)
  const bands = new Map<number, number>()
  for (const point of headPoints) {
    const key = Math.round(point.y / 0.04)
    bands.set(key, Math.max(bands.get(key) ?? 0, Math.abs(point.x - headAt.x)))
  }
  const halfWidth = (y: number): number | null => {
    const key = Math.round(y / 0.04)
    for (let d = 0; d <= 2; d += 1) {
      for (const probe of [key - d, key + d]) {
        const value = bands.get(probe)
        if (value !== undefined) return value
      }
    }
    return null
  }

  const textures = new Map<number, Bitmap | null>()
  const bitmapFor = (materialIndex: number): Bitmap | null => {
    if (textures.has(materialIndex)) return textures.get(materialIndex)!
    const pbr = rig.gltf.materials[materialIndex]?.pbrMetallicRoughness ?? {}
    let bitmap: Bitmap | null = null
    if (pbr.baseColorTexture) {
      const source = rig.gltf.textures[pbr.baseColorTexture.index].source
      const view = rig.gltf.bufferViews[rig.gltf.images[source].bufferView]
      const start = view.byteOffset ?? 0
      bitmap = readPng(rig.bin.subarray(start, start + view.byteLength))
    }
    textures.set(materialIndex, bitmap)
    return bitmap
  }

  const report: Report = { id, name: spec.name, shown: [], crossing: [], cape: false, capeHue: null, back: null, backHex: '—' }
  const backColours: Rgb[] = []
  const capeColours: Rgb[] = []

  for (const { node, index } of meshes) {
    const name: string = node.name ?? ''
    const isCape = /cape/i.test(name)
    if (isCape && shown(name)) report.cape = true
    if (WEAPON.test(name) && shown(name)) report.shown.push(name)
    if (isCape && !shown(name)) continue

    const primitives = rig.gltf.meshes[node.mesh].primitives
    for (const primitive of primitives) {
      const position = accessor(rig, primitive.attributes.POSITION)
      const uv = primitive.attributes.TEXCOORD_0 !== undefined ? accessor(rig, primitive.attributes.TEXCOORD_0) : null
      const bitmap = bitmapFor(primitive.material ?? 0)

      if (WEAPON.test(name) && shown(name)) {
        let over = 0
        for (const p of position) {
          const point = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(rig.nodeWorld[index]).applyMatrix4(scale)
          if (point.y < headBox.min.y || point.y > headBox.max.y) continue
          const half = halfWidth(point.y)
          if (half === null) continue
          if (Math.abs(point.x - headAt.x) < half && point.z < headAt.z) over += 1
        }
        if (over > 0) report.crossing.push(`${name} (${over} verts)`)
      }

      // What the camera behind the runner sees: this rig's back is -z.
      if (!bitmap || !uv || !GARMENT.test(name)) continue
      for (let i = 0; i < position.length; i += 1) {
        const point = new THREE.Vector3(position[i][0], position[i][1], position[i][2])
          .applyMatrix4(rig.nodeWorld[index])
          .applyMatrix4(scale)
        if (point.z > -0.04) continue
        const x = Math.floor(((uv[i][0] % 1) + 1) % 1 * bitmap.width) % bitmap.width
        const y = Math.floor((1 - (((uv[i][1] % 1) + 1) % 1)) * bitmap.height) % bitmap.height
        const at = (y * bitmap.width + x) * bitmap.channels
        const rgb = repaint([bitmap.pixels[at], bitmap.pixels[at + 1], bitmap.pixels[at + 2]], spec.recolor)
        backColours.push(rgb)
        if (isCape) capeColours.push(rgb)
      }
    }
  }

  const tally = new Map<string, { count: number; rgb: Rgb }>()
  for (const rgb of backColours) {
    const key = rgb.map((value) => Math.round(value / 24)).join(',')
    const entry = tally.get(key)
    if (entry) entry.count += 1
    else tally.set(key, { count: 1, rgb })
  }
  const top = [...tally.values()].sort((a, b) => b.count - a.count)[0]
  if (top) {
    report.back = top.rgb
    report.backHex = `#${top.rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  }
  // A persona is dressed at load time (persona.ts), not through the atlas: its back is
  // the garment it is given, whatever the rig's texture says.
  if (spec.persona) {
    const colour = PERSONA_BACK[spec.persona]
    report.back = [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255]
    report.backHex = `#${colour.toString(16).padStart(6, '0')}`
  }
  if (capeColours.length) {
    const capeTally = new Map<string, { count: number; rgb: Rgb }>()
    for (const rgb of capeColours) {
      const key = rgb.map((value) => Math.round(value / 24)).join(',')
      const entry = capeTally.get(key)
      if (entry) entry.count += 1
      else capeTally.set(key, { count: 1, rgb })
    }
    const capeTop = [...capeTally.values()].sort((a, b) => b.count - a.count)[0]
    report.capeHue = Math.round(hueOf(capeTop.rgb[0] / 255, capeTop.rgb[1] / 255, capeTop.rgb[2] / 255))
  }
  reports.push(report)
}

let failed = 0
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
}

console.log('What the camera behind the runner sees\n')
for (const report of reports) {
  console.log(
    `  ${report.id.padEnd(5)} ${report.name.padEnd(9)} back ${report.backHex}${report.cape ? ` · cape ${report.capeHue}°` : ' · no cape'}  kit ${report.shown.join(', ') || '— none —'}`
  )
}
console.log('')

const byId = (id: string): Report => reports.find((report) => report.id === id)!
const assassin = byId('nyx')
const archer = byId('rin')

check('the assassin carries only the two knives', assassin.shown.length === 2 && assassin.shown.every((n) => /knife/i.test(n)), assassin.shown.join(', ') || 'nothing')
check('the assassin carries no crossbow', !assassin.shown.some((n) => /crossbow/i.test(n)), assassin.shown.filter((n) => /crossbow/i.test(n)).join(', ') || 'none')
check('the archer carries the arbalest and nothing else', archer.shown.length === 1 && /^2H_Crossbow$/i.test(archer.shown[0]), archer.shown.join(', ') || 'none')
check('the archer carries no light crossbow', !archer.shown.some((n) => /^1H_/i.test(n)), archer.shown.filter((n) => /^1H_/i.test(n)).join(', ') || 'none')
check('the archer carries no bow', !archer.shown.some((n) => /\bbow\b/i.test(n)), archer.shown.filter((n) => /\bbow\b/i.test(n)).join(', ') || 'none')
// Two heroes now share the knight rig, which is the one case where a `hideNodes`
// list has to be right for both of them at once: the shield knight keeps a blade
// and a shield, the duelist keeps only the two-handed sword.
const swordsman = byId('tim')
const shieldKnight = byId('kai')
check(
  'the swordsman carries the greatsword and nothing else',
  swordsman.shown.length === 1 && /^2H_Sword$/i.test(swordsman.shown[0]),
  swordsman.shown.join(', ') || 'none'
)
check(
  'the swordsman carries no shield',
  !swordsman.shown.some((n) => /shield/i.test(n)),
  swordsman.shown.filter((n) => /shield/i.test(n)).join(', ') || 'none'
)
check(
  'the swordsman carries no side sword',
  !swordsman.shown.some((n) => /^1H_/i.test(n)),
  swordsman.shown.filter((n) => /^1H_/i.test(n)).join(', ') || 'none'
)
// Sam is dressed as himself (persona.ts): the rig's blades and shields all go, and the
// round shield's grip holds a USDC coin instead.
check('Sam carries none of the rig\'s weapons', shieldKnight.shown.length === 0, shieldKnight.shown.join(', ') || 'none')
check(
  'Sam still has the shield grip the USDC coin rides on',
  /Round_Shield/.test(readFileSync(new URL('../src/assets/models/knight.glb', import.meta.url)).toString('latin1')),
  'Round_Shield node present in the knight rig'
)
for (const report of reports) {
  check(`${report.name}: nothing crosses the head from behind`, report.crossing.length === 0, report.crossing.join(', ') || 'clear')
}

console.log('\nBacks must not look alike')
const caped = reports.filter((report) => report.cape)
check('at most two heroes wear a cape', caped.length <= 2, caped.map((r) => r.name).join(' + ') || 'none')
if (caped.length === 2) {
  let gap = Math.abs((caped[0].capeHue ?? 0) - (caped[1].capeHue ?? 0))
  if (gap > 180) gap = 360 - gap
  check('the two capes are different colours', gap >= 40, `${caped[0].name} ${caped[0].capeHue}° vs ${caped[1].name} ${caped[1].capeHue}° — gap ${Math.round(gap)}°`)
}
for (let i = 0; i < reports.length; i += 1) {
  for (let j = i + 1; j < reports.length; j += 1) {
    const a = reports[i]
    const b = reports[j]
    if (!a.back || !b.back) continue
    const distance = Math.round(Math.hypot(a.back[0] - b.back[0], a.back[1] - b.back[1], a.back[2] - b.back[2]))
    // Either the body colours are far apart, or the two capes are — a light robe and
    // a light suit of plate can sit close in plain RGB while the capes give them away.
    let capeGap = 0
    if (a.capeHue !== null && b.capeHue !== null) {
      capeGap = Math.abs(a.capeHue - b.capeHue)
      if (capeGap > 180) capeGap = 360 - capeGap
    }
    const distinct = distance >= 60 || capeGap >= 40
    check(
      `${a.name} vs ${b.name} read differently from behind`,
      distinct,
      `${a.backHex} vs ${b.backHex} — colour distance ${distance}${capeGap ? `, cape gap ${Math.round(capeGap)}°` : ''}`
    )
  }
}

console.log(failed === 0 ? '\nKit check passed.' : `\n${failed} kit check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
