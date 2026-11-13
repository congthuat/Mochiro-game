// Personas: a hero dressed as a real person instead of as a fantasy class.
//
// Sam is drawn from a photo of the man himself: a black cap with the white Arc mark, a
// black tee printed "YOU CAN'T VIBE CODE USDC." over the USDC coin, black jeans, a steel
// watch on the left wrist, a goatee, and darker skin than the rig ships with. He keeps the
// knight's skeleton and every one of its animations; only the dressing changes.
//
// How the dressing is done:
//
//   - Clothes. The KayKit atlas packs every class's colours into shared swatches — the
//     same pixels colour a sleeve, a boot and a belt — so a costume cannot be repainted
//     in the atlas without repainting the wrong parts too. Instead each limb mesh gets
//     its own copy of the geometry, one colour per triangle, chosen by where the triangle
//     sits on the body (sleeve ends here, watch strap there). The colours live in a tiny
//     palette texture, so the material keeps the same map + self-lit lift every other hero
//     uses and Sam is lit exactly like his teammates.
//   - Skin. The head keeps the artist's painted face; only its skin tones are re-hued.
//   - Prints. The tee's front and back prints are skinned to the same skeleton with the
//     weights of the nearest body vertex, so they bend with the torso rather than floating
//     in front of it on the run.
//   - Cap, beard. Rigid, so they ride the head bone. Everything is built in the rig's own
//     bind-pose space (the numbers below are measured from the mesh: the head spans
//     y 1.22–2.31, the eyes sit at y 1.54–1.67, the nose tip at z 0.53) and dropped into
//     the bone with its inverse bind matrix, which makes it follow the bone exactly like
//     a vertex weighted 100% to it.
//   - The shield becomes a USDC coin: same hand, same place, so the shield perk still
//     reads as what it is.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { recolorTexture } from './recolor'

export type PersonaId = 'sam' | 'bobbilee' | 'teddyz' | 'lecter'

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

const TEE = 0x1f2127
const JEANS = 0x2a2f3a
const SKIN = 0x6f4733
const STEEL = 0xc9ced6
const SHOE = 0x1a1b1f
const SOLE = 0xeef0f3
const CAP = 0x18191d
const BEARD = 0x1b1411
const HAIR = 0x17110e
// Bobbilee, from a photo of her on stage: ivory high-neck fleece, hair pulled back.
/** Bobbilee's backpack: caramel canvas, so the white puppy in it reads from behind. */
const BACKPACK = 0xb5824f
const SWEATER = 0xdfd8cc
const RIB = 0xccc3b4
const TROUSER = 0x33353c
const SNEAKER = 0xf2f1ee
const SNEAKER_SOLE = 0xbfc0c4
const FAIR = 0xf1bf9c
// Teddyz: a plain white crew tee, black trousers, white sneakers, warm light-tan skin.
const WHITE_TEE = 0xf8f9fb
const BLACK_TROUSER = 0x1c1d22
const TAN = 0xe1a078
// Lecter: a brown corduroy shirt with the sleeves rolled to the wrist, beige chinos,
// white sneakers, fair skin.
const CORD = 0x6e4628
const CORD_ROLL = 0x5a381f
const CHINO = 0xc9b592
const USDC_BLUE = '#2775ca'
const PRINT_BLUE = '#2f6fe0'

/** What the camera behind the runner mostly sees of each persona (kit-check compares backs). */
export const PERSONA_BACK: Record<PersonaId, number> = { sam: TEE, bobbilee: BACKPACK, teddyz: WHITE_TEE, lecter: CORD }
/**
 * …and what it sees below that: the trousers. Two people in black tops are still told
 * apart from behind by their legs (kit-check uses this when the tops are close).
 */
export const PERSONA_LEGS: Record<PersonaId, number> = { sam: JEANS, bobbilee: TROUSER, teddyz: BLACK_TROUSER, lecter: CHINO }

/** Order matters: a colour's index is its palette cell. */
const PALETTE = [TEE, JEANS, SKIN, STEEL, SHOE, SOLE, SWEATER, RIB, TROUSER, SNEAKER, SNEAKER_SOLE, FAIR, WHITE_TEE, BLACK_TROUSER, TAN, CORD, CORD_ROLL, CHINO] as const
const enum Cell {
  Tee = 0,
  Jeans = 1,
  Skin = 2,
  Steel = 3,
  Shoe = 4,
  Sole = 5,
  Sweater = 6,
  Rib = 7,
  Trouser = 8,
  Sneaker = 9,
  SneakerSole = 10,
  Fair = 11,
  WhiteTee = 12,
  BlackTrouser = 13,
  Tan = 14,
  Cord = 15,
  CordRoll = 16,
  Chino = 17,
}

/** Skin re-hue for the painted head: the artist's peach becomes a warm deep brown. */
const HEAD_SKIN = { from: [8, 52] as [number, number], to: 21, sat: 0.55, light: 0.47, threshold: 0.08 }

/** The lift every rigged hero gets (model.ts), so Sam is lit like his teammates. */
const SELF_LIT = 0.26

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function canvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  const ctx = element.getContext('2d')
  if (!ctx) throw new Error('2d canvas unavailable')
  return { canvas: element, ctx }
}

function textureOf(element: HTMLCanvasElement, nearest = false): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(element)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  if (nearest) {
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
  }
  texture.needsUpdate = true
  return texture
}

/** A material lit the same way as the rigged heroes: its colour also glows a little. */
function litMaterial(options: { color?: number; map?: THREE.Texture; transparent?: boolean }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: options.map ? 0xffffff : (options.color ?? 0xffffff),
    map: options.map ?? null,
    roughness: 0.82,
    metalness: 0.02,
    transparent: options.transparent ?? false,
  })
  if (options.map) {
    material.emissiveMap = options.map
    material.emissive = new THREE.Color(0xffffff)
  } else {
    material.emissive = new THREE.Color(options.color ?? 0xffffff)
  }
  material.emissiveIntensity = SELF_LIT
  return material
}

const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`

/* ------------------------------------------------------------------ *
 * Artwork
 * ------------------------------------------------------------------ */

/**
 * The Arc mark, traced from the official logo (the one /api/arc/logo serves) and
 * simplified to 38 points — it covers the original with 96% overlap. A thick arch whose
 * left leg runs straight to the ground, and whose right leg is joined low down by a bar
 * reaching in from the middle, the foot of the leg sweeping off to the right.
 * Coordinates are in thousandths of the mark's box; the box is 0.96 wide per unit tall.
 */
const ARC_OUTLINE = [
  0, 1000, 12, 815, 47, 596, 91, 438, 150, 287, 213, 177, 303, 75, 394, 19, 465, 0, 535, 0, 571, 8, 661, 49, 752, 132,
  831, 249, 890, 381, 949, 581, 988, 815, 1000, 992, 984, 992, 925, 955, 858, 925, 720, 883, 654, 872, 409, 868, 433,
  698, 783, 694, 736, 498, 681, 358, 598, 230, 559, 196, 520, 177, 469, 181, 409, 223, 339, 321, 287, 430, 248, 551, 217,
  687, 193, 853, 185, 992,
]
const ARC_ASPECT = 0.96

function drawArcMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, width: number, height: number, ink: string): void {
  ctx.save()
  ctx.fillStyle = ink
  ctx.beginPath()
  for (let i = 0; i < ARC_OUTLINE.length; i += 2) {
    const x = cx + (ARC_OUTLINE[i] / 1000 - 0.5) * width
    const y = cy + (ARC_OUTLINE[i + 1] / 1000 - 0.5) * height
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** The USDC coin: blue disc, white "$" between two open brackets. */
function drawUsdc(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, ring: string | null): void {
  ctx.save()
  ctx.fillStyle = USDC_BLUE
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
  if (ring) {
    ctx.strokeStyle = ring
    ctx.lineWidth = radius * 0.08
    ctx.stroke()
  }
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = radius * 0.1
  ctx.lineCap = 'round'
  const bracket = radius * 0.7
  for (const side of [-1, 1]) {
    ctx.beginPath()
    const mid = side < 0 ? Math.PI : 0
    ctx.arc(cx, cy, bracket, mid - 0.95, mid + 0.95)
    ctx.stroke()
  }
  // The "$": an S with a bar through it, in the same block letters as the print.
  ctx.fillStyle = '#ffffff'
  const tall = radius * 0.86
  blockText(ctx, 'S', cx, cy, tall * 0.8, radius)
  ctx.lineWidth = radius * 0.1
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.moveTo(cx, cy - tall / 2)
  ctx.lineTo(cx, cy + tall / 2)
  ctx.stroke()
  ctx.restore()
}

/*
 * Shirt lettering. The print is drawn with its own heavy block letters rather than a
 * font: phones ship wildly different font sets (and headless renderers ship none), and
 * a chest print that silently comes out blank or in a thin fallback face is worse than
 * none. Each glyph is a stroke path in a unit box — x across 0..w, y down 0..1 — and
 * is drawn with a fat stroke, which is how a heavy grotesque reads at this size.
 */
type Glyph = { w: number; draw: (pen: Pen) => void }
interface Pen {
  move: (x: number, y: number) => void
  line: (x: number, y: number) => void
  /** Elliptical arc around (cx, cy), angles as in canvas (0 = right, π/2 = down). */
  arc: (cx: number, cy: number, rx: number, ry: number, from: number, to: number, ccw?: boolean) => void
  stroke: () => void
  dot: (x: number, y: number) => void
}
const PI = Math.PI
const GLYPHS: Record<string, Glyph> = {
  Y: { w: 0.78, draw: (p) => { p.move(0, 0); p.line(0.39, 0.52); p.line(0.78, 0); p.move(0.39, 0.52); p.line(0.39, 1); p.stroke() } },
  O: { w: 0.8, draw: (p) => { p.arc(0.4, 0.5, 0.4, 0.5, 0, 2 * PI); p.stroke() } },
  U: { w: 0.74, draw: (p) => { p.move(0, 0); p.line(0, 0.6); p.arc(0.37, 0.6, 0.37, 0.4, PI, 0, true); p.line(0.74, 0); p.stroke() } },
  C: { w: 0.74, draw: (p) => { p.arc(0.4, 0.5, 0.4, 0.5, -0.24 * PI, 0.24 * PI, true); p.stroke() } },
  A: { w: 0.8, draw: (p) => { p.move(0, 1); p.line(0.4, 0); p.line(0.8, 1); p.move(0.17, 0.66); p.line(0.63, 0.66); p.stroke() } },
  N: { w: 0.74, draw: (p) => { p.move(0, 1); p.line(0, 0); p.line(0.74, 1); p.line(0.74, 0); p.stroke() } },
  T: { w: 0.72, draw: (p) => { p.move(0, 0); p.line(0.72, 0); p.move(0.36, 0); p.line(0.36, 1); p.stroke() } },
  V: { w: 0.8, draw: (p) => { p.move(0, 0); p.line(0.4, 1); p.line(0.8, 0); p.stroke() } },
  I: { w: 0, draw: (p) => { p.move(0, 0); p.line(0, 1); p.stroke() } },
  B: {
    w: 0.7,
    draw: (p) => {
      p.move(0.3, 0.48); p.line(0, 0.48); p.line(0, 0); p.line(0.42, 0)
      p.arc(0.42, 0.24, 0.26, 0.24, -PI / 2, PI / 2)
      p.line(0, 0.48); p.line(0, 1); p.line(0.44, 1)
      p.arc(0.44, 0.74, 0.26, 0.26, PI / 2, -PI / 2, true)
      p.line(0.3, 0.48); p.stroke()
    },
  },
  E: { w: 0.62, draw: (p) => { p.move(0.62, 0); p.line(0, 0); p.line(0, 1); p.line(0.62, 1); p.move(0, 0.5); p.line(0.52, 0.5); p.stroke() } },
  D: { w: 0.76, draw: (p) => { p.move(0, 0); p.line(0, 1); p.line(0.3, 1); p.arc(0.3, 0.5, 0.46, 0.5, PI / 2, -PI / 2, true); p.line(0, 0); p.stroke() } },
  S: {
    w: 0.7,
    draw: (p) => {
      p.arc(0.35, 0.26, 0.35, 0.26, -0.12 * PI, PI / 2, true)
      p.arc(0.35, 0.74, 0.35, 0.26, -PI / 2, 1.12 * PI)
      p.stroke()
    },
  },
  "'": { w: 0, draw: (p) => { p.move(0, 0); p.line(0, 0.3); p.stroke() } },
  '.': { w: 0, draw: (p) => p.dot(0, 1) },
  ' ': { w: 0.3, draw: () => undefined },
}

/** Draws a line of block capitals centred on (cx, cy), `height` tall, fitted into `maxWidth`. */
function blockText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, height: number, maxWidth: number): void {
  const weight = 0.22
  const gap = 0.16
  const glyphs = [...text].map((char) => GLYPHS[char] ?? GLYPHS[' '])
  // Advance in units of letter height: drawn width + stroke + gap.
  const advance = (glyph: Glyph): number => glyph.w + weight + gap
  const total = glyphs.reduce((sum, glyph) => sum + advance(glyph), 0) - gap
  const size = Math.min(height, maxWidth / total)
  const t = weight * size
  const inner = size - t
  let x = cx - (total * size) / 2
  const top = cy - size / 2
  ctx.save()
  ctx.lineWidth = t
  ctx.lineJoin = 'miter'
  ctx.miterLimit = 2.2
  ctx.lineCap = 'butt'
  for (const glyph of glyphs) {
    const left = x
    const px = (u: number): number => left + t / 2 + u * inner
    const py = (v: number): number => top + t / 2 + v * inner
    ctx.beginPath()
    const pen: Pen = {
      move: (u, v) => ctx.moveTo(px(u), py(v)),
      line: (u, v) => ctx.lineTo(px(u), py(v)),
      arc: (cu, cv, ru, rv, from, to, ccw) => ctx.ellipse(px(cu), py(cv), ru * inner, rv * inner, 0, from, to, ccw ?? false),
      stroke: () => ctx.stroke(),
      dot: (u, v) => ctx.fillRect(px(u) - t / 2, py(v) - t / 2, t, t),
    }
    glyph.draw(pen)
    x += advance(glyph) * size
  }
  ctx.restore()
}

/** Front print: YOU CAN'T / VIBE CODE (on a blue swipe) / USDC. / the coin. */
function frontPrint(): THREE.CanvasTexture {
  const size = 512
  const { canvas: element, ctx } = canvas(size, size)
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  const wide = size * 0.92
  blockText(ctx, "YOU CAN'T", size / 2, 64, 84, wide)
  // The blue swipe behind the middle line, slightly skewed like a marker stroke.
  ctx.save()
  ctx.fillStyle = PRINT_BLUE
  ctx.translate(size / 2, 170)
  ctx.transform(1, -0.02, -0.08, 1, 0, 0)
  ctx.fillRect(-size * 0.48, -50, size * 0.96, 100)
  ctx.restore()
  ctx.fillStyle = '#ffffff'
  blockText(ctx, 'VIBE CODE', size / 2, 170, 74, wide * 0.94)
  blockText(ctx, 'USDC.', size / 2, 276, 84, wide)
  drawUsdc(ctx, size / 2, 414, 72, null)
  return textureOf(element)
}

/** Back print: the Arc mark, white — the hero is mostly seen from behind. */
function backPrint(): THREE.CanvasTexture {
  const size = 256
  const { canvas: element, ctx } = canvas(size, size)
  drawArcMark(ctx, size / 2, size / 2, size * 0.7 * ARC_ASPECT, size * 0.7, '#ffffff')
  return textureOf(element)
}

/** The cap's crown, unwrapped: black panels with the Arc mark on the front one. */
function capTexture(thetaLength: number): THREE.CanvasTexture {
  const width = 1024
  const height = 512
  const { canvas: element, ctx } = canvas(width, height)
  ctx.fillStyle = hex(CAP)
  ctx.fillRect(0, 0, width, height)
  const pxPerRad = height / thetaLength
  // Six panel seams and the stitching above the sweatband, a shade lighter than the
  // cloth so the panels still read on black.
  ctx.strokeStyle = '#2e3037'
  ctx.lineWidth = 3
  for (let i = 0; i < 6; i += 1) {
    const x = ((i + 0.5) / 6) * width
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  ctx.setLineDash([10, 8])
  ctx.beginPath()
  ctx.moveTo(0, height - 0.08 * pxPerRad)
  ctx.lineTo(width, height - 0.08 * pxPerRad)
  ctx.stroke()
  ctx.setLineDash([])
  // SphereGeometry puts +z (the face) at u = 0.25 and spreads theta over the full
  // canvas height. A radian of longitude is shorter than one of latitude by sin(theta),
  // so the mark is widened by that much to come out the logo's own shape.
  const centreTheta = 1.04
  const markRad = 0.72
  const pxPerRadU = width / (Math.PI * 2)
  const markWidth = ((markRad * ARC_ASPECT) / Math.sin(centreTheta)) * pxPerRadU
  drawArcMark(ctx, width * 0.25, centreTheta * pxPerRad, markWidth, markRad * pxPerRad, '#f4f5f7')
  return textureOf(element)
}

/** The coin face for the hand-held USDC. */
function coinFace(): THREE.CanvasTexture {
  const size = 256
  const { canvas: element, ctx } = canvas(size, size)
  ctx.fillStyle = '#e7edf6'
  ctx.fillRect(0, 0, size, size)
  drawUsdc(ctx, size / 2, size / 2, size * 0.45, '#dfe7f2')
  return textureOf(element)
}

function paletteTexture(): THREE.CanvasTexture {
  const cell = 4
  const { canvas: element, ctx } = canvas(PALETTE.length * cell, cell)
  PALETTE.forEach((color, index) => {
    ctx.fillStyle = hex(color)
    ctx.fillRect(index * cell, 0, cell, cell)
  })
  const texture = textureOf(element, true)
  texture.flipY = false
  return texture
}

/* ------------------------------------------------------------------ *
 * Rig access
 * ------------------------------------------------------------------ */

function findMesh(root: THREE.Object3D, suffix: string): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh
    if (!found && mesh.isSkinnedMesh && mesh.name.toLowerCase().endsWith(suffix.toLowerCase())) found = mesh
  })
  return found
}

/**
 * A node inside `bone` whose space is the rig's bind-pose space: anything placed in it
 * with bind-pose coordinates follows the bone exactly as a skinned vertex would.
 */
function bindSpaceOf(skinned: THREE.SkinnedMesh, boneName: string): THREE.Group | null {
  const bones = skinned.skeleton.bones
  const index = bones.findIndex((bone) => bone.name.toLowerCase() === boneName)
  if (index < 0) return null
  const holder = new THREE.Group()
  holder.name = `persona:${boneName}`
  holder.matrixAutoUpdate = false
  holder.matrix.copy(skinned.skeleton.boneInverses[index]).multiply(skinned.bindMatrix)
  bones[index].add(holder)
  return holder
}

/* ------------------------------------------------------------------ *
 * Clothes: one palette colour per triangle
 * ------------------------------------------------------------------ */

type Classifier = (x: number, y: number, z: number) => Cell

function dress(mesh: THREE.SkinnedMesh | null, palette: THREE.Texture, classify: Classifier): void {
  if (!mesh) return
  // The geometry is shared with the cached rig (and with Tim, who wears the same one),
  // so dress a copy. Unindexed, so a colour edge follows the mesh's own edges cleanly.
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i + 2 < position.count; i += 3) {
    const x = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3
    const y = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3
    const z = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3
    const u = (classify(x, y, z) + 0.5) / PALETTE.length
    for (let k = 0; k < 3; k += 1) {
      uv[(i + k) * 2] = u
      uv[(i + k) * 2 + 1] = 0.5
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  mesh.geometry = geometry
  const material = mesh.material as THREE.MeshStandardMaterial
  material.map = palette
  material.emissiveMap = palette
  material.needsUpdate = true
}

// Measured on the knight rig (bind pose, arms out along x): the upper arm runs from
// x 0.21 to the elbow at 0.45, the wrist bone sits at 0.71 and the hand at 0.79. The
// body's hip line is the edge loop at y 0.57; the boot loop is at y 0.13.
const SLEEVE_END = 0.385
const WATCH: [number, number] = [0.7, 0.765]
const WAIST = 0.575
const SHOE_TOP = 0.125
const SOLE_TOP = 0.035

const arm =
  (watch: boolean): Classifier =>
  (x) => {
    const reach = Math.abs(x)
    if (reach < SLEEVE_END) return Cell.Tee
    if (watch && reach >= WATCH[0] && reach <= WATCH[1]) return Cell.Steel
    return Cell.Skin
  }

const body: Classifier = (_x, y) => (y > WAIST ? Cell.Tee : Cell.Jeans)

const leg: Classifier = (_x, y) => {
  if (y < SOLE_TOP) return Cell.Sole
  if (y < SHOE_TOP) return Cell.Shoe
  return Cell.Jeans
}

/**
 * The head keeps its painted face (eyes, brows, nose shading) with the skin re-hued.
 * The rig has no hair of its own under a helmet, so the back and sides of the skull
 * would read as bald under the cap: those triangles are pointed at a small patch of
 * close-cropped dark hair painted into a corner of this head's private texture copy —
 * a corner the head's own UVs never touch (they live in x 11–336, y 18–202).
 */
/**
 * The rig's head is a rounded box: as wide at the jaw as at the cheekbones, and tall
 * under the cap. Sam's face in the photo is an oval, so the lower face is drawn in to
 * an egg in front view (and its front corners rounded off in plan), and the crown is
 * lowered so the cap sits on a skull rather than a tower. Moved vertices get smooth
 * normals of their new shape.
 */
function reshapeSamHead(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  const soft = (value: number, limit: number): number => {
    const knee = 0.82 * limit
    if (value <= knee) return value
    return knee + (limit - knee) * Math.tanh((value - knee) / (limit - knee))
  }
  const moved = new Set<number>()
  for (let i = 0; i < position.count; i += 1) {
    let x = position.getX(i)
    let y = position.getY(i)
    const z = position.getZ(i)
    const before = [x, y]
    if (y < 1.62) {
      // Front view: an egg narrowing to the chin.
      const t = Math.min(1, (1.62 - y) / 0.4)
      let limit = 0.53 * Math.sqrt(Math.max(0.04, 1 - t * t))
      // Plan view: the front corners of the jaw rounded off.
      if (z > 0.05) limit *= Math.sqrt(Math.max(0.3, 1 - ((z - 0.05) / 0.62) ** 2)) * 0.12 + 0.88
      x = Math.sign(x) * soft(Math.abs(x), limit)
    }
    if (y > 1.86) y = 1.86 + (y - 1.86) * 0.8
    if (x !== before[0] || y !== before[1]) {
      position.setXY(i, x, y)
      moved.add(i - (i % 3))
    }
  }
  const sums = new Map<string, THREE.Vector3>()
  const key = (i: number) =>
    `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    const face = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b))
    for (let k = 0; k < 3; k += 1) {
      const id = key(i + k)
      sums.set(id, (sums.get(id) ?? new THREE.Vector3()).add(face))
    }
  }
  for (const i of moved) {
    for (let k = 0; k < 3; k += 1) {
      const n = sums.get(key(i + k))
      if (n && n.lengthSq() > 0) {
        n.normalize()
        normal.setXYZ(i + k, n.x, n.y, n.z)
      }
    }
  }
  position.needsUpdate = true
  normal.needsUpdate = true
  geometry.computeBoundingSphere()
}

function dressHead(head: THREE.SkinnedMesh): void {
  const material = head.material as THREE.MeshStandardMaterial
  if (!material.map) return
  const map = recolorTexture(material.map, HEAD_SKIN)
  const image = map.image as HTMLCanvasElement | undefined
  const ctx = map !== material.map && image?.getContext ? image.getContext('2d') : null
  material.map = map
  material.emissiveMap = map
  material.needsUpdate = true
  if (!ctx || !image) return

  const geometry = head.geometry.index ? head.geometry.toNonIndexed() : head.geometry.clone()
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv || !normal) return

  reshapeSamHead(geometry)

  const patch = 24
  ctx.fillStyle = hex(HAIR)
  // Both corners, so the patch is found whichever way up the texture is sampled.
  ctx.fillRect(image.width - patch, image.height - patch, patch, patch)
  ctx.fillRect(image.width - patch, 0, patch, patch)
  const hairU = 1 - patch / 2 / image.width
  const hairV = 1 - patch / 2 / image.height

  // The face is painted onto its own patch of the texture, front-projected: the skin
  // colour is read off the cheek so the patch meets the rest of the head without a seam.
  let cheek = -1
  let best = Infinity
  for (let i = 0; i < position.count; i += 1) {
    const d = Math.hypot(position.getX(i) - 0.32, position.getY(i) - 1.46, position.getZ(i) - 0.4)
    if (d < best) [best, cheek] = [d, i]
  }
  const [sr, sg, sb] = ctx.getImageData(
    Math.min(image.width - 1, Math.floor(uv.getX(cheek) * image.width)),
    Math.min(image.height - 1, Math.floor(uv.getY(cheek) * image.height)),
    1,
    1
  ).data
  paintFace(ctx, `rgb(${sr},${sg},${sb})`)
  map.needsUpdate = true

  for (let i = 0; i + 2 < position.count; i += 3) {
    let x = 0
    let y = 0
    let z = 0
    let nz = 0
    for (let k = 0; k < 3; k += 1) {
      x += position.getX(i + k) / 3
      y += position.getY(i + k) / 3
      z += position.getZ(i + k) / 3
      nz += normal.getZ(i + k) / 3
    }
    const eye = Math.abs(x) > 0.1 && Math.abs(x) < 0.28 && y > 1.52 && y < 1.7 && z > 0.36
    const face = (nz > 0.3 && z > 0.2 && y > FACE.bottom && y < FACE.top && Math.abs(x) < FACE.half) || eye
    if (face) {
      for (let k = 0; k < 3; k += 1) {
        uv.setXY(i + k, faceU(position.getX(i + k)) / image.width, faceV(position.getY(i + k)) / image.height)
      }
      continue
    }
    // Back of the skull from the nape up, and the sides from just above the eyes: the
    // rig has no hair of its own under a helmet, so it would read as bald under the cap.
    const hair = (z < -0.05 && y > 1.38) || (z < 0.18 && y > 1.58)
    if (hair) for (let k = 0; k < 3; k += 1) uv.setXY(i + k, hairU, hairV)
  }
  uv.needsUpdate = true
  head.geometry = geometry
}

/**
 * Where the face patch lives in the head texture: a free block of the 1024² atlas (the
 * rig's own UVs stay inside x 11–336, y 18–202), at 480 px per bind-space unit.
 */
const FACE = { left: 400, top: 320, scale: 480, half: 0.6, bottom: 1.18, ceiling: 1.92 } as const
const faceU = (x: number): number => FACE.left + (x + FACE.half) * FACE.scale
const faceV = (y: number): number => FACE.top + (FACE.ceiling - y) * FACE.scale

/**
 * Sam as in the photos: laughing so hard his eyes have closed to arcs, a wide open grin
 * full of teeth, and a thin moustache that runs down round the mouth into a goatee.
 * Drawn in bind-space units (y up, +x his left) through faceU/faceV.
 */
function paintFace(ctx: CanvasRenderingContext2D, skin: string): void {
  const unit = FACE.scale
  const at = (x: number, y: number): [number, number] => [faceU(x), faceV(y)]
  ctx.save()
  ctx.fillStyle = skin
  ctx.fillRect(faceU(-FACE.half) - 8, faceV(FACE.ceiling) - 8, FACE.half * 2 * unit + 16, (FACE.ceiling - FACE.bottom) * unit + 16)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Laugh lines from the nose down to the corners of the grin.
  ctx.strokeStyle = 'rgba(40, 22, 14, 0.45)'
  ctx.lineWidth = 0.014 * unit
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(...at(side * 0.13, 1.5))
    ctx.quadraticCurveTo(...at(side * 0.2, 1.47), ...at(side * 0.19, 1.405))
    ctx.stroke()
  }

  const top = 1.432
  const half = 0.15
  const depth = 0.075
  const beard = hex(BEARD)
  // Goatee: from under the grin down over the chin, joined to the moustache by two
  // strokes that run round the corners of the mouth.
  ctx.fillStyle = beard
  ctx.beginPath()
  ctx.moveTo(...at(-half + 0.005, top - 0.03))
  ctx.bezierCurveTo(...at(-0.13, 1.31), ...at(-0.06, 1.265), ...at(0, 1.265))
  ctx.bezierCurveTo(...at(0.06, 1.265), ...at(0.13, 1.31), ...at(half - 0.005, top - 0.03))
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = beard
  ctx.lineWidth = 0.024 * unit
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(...at(side * (half + 0.004), top + 0.012))
    ctx.quadraticCurveTo(...at(side * (half + 0.012), top - 0.04), ...at(side * (half - 0.02), top - depth - 0.01))
    ctx.stroke()
  }

  // The grin: a wide D, corners turned up, the top row of teeth showing.
  const grin = (): void => {
    ctx.beginPath()
    ctx.moveTo(...at(-half, top + 0.006))
    ctx.quadraticCurveTo(...at(0, top - 0.012), ...at(half, top + 0.006))
    ctx.bezierCurveTo(...at(half * 0.8, top - depth * 1.25), ...at(-half * 0.8, top - depth * 1.25), ...at(-half, top + 0.006))
    ctx.closePath()
  }
  ctx.fillStyle = '#3a1311'
  grin()
  ctx.fill()
  ctx.save()
  grin()
  ctx.clip()
  ctx.fillStyle = '#f3efe7'
  ctx.beginPath()
  ctx.moveTo(...at(-half, top + 0.01))
  ctx.quadraticCurveTo(...at(0, top - 0.008), ...at(half, top + 0.01))
  ctx.lineTo(...at(half, top - 0.02))
  ctx.quadraticCurveTo(...at(0, top - 0.042), ...at(-half, top - 0.02))
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#a2443b'
  ctx.beginPath()
  ctx.ellipse(...at(0, top - depth * 0.92), 0.07 * unit, 0.022 * unit, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Moustache along the top lip.
  ctx.strokeStyle = beard
  ctx.lineWidth = 0.022 * unit
  ctx.beginPath()
  ctx.moveTo(...at(-half - 0.004, top + 0.014))
  ctx.quadraticCurveTo(...at(0, top + 0.002), ...at(half + 0.004, top + 0.014))
  ctx.stroke()

  // Eyes open and smiling, as in the photo: an almond of white narrowed from below by
  // the lifted cheek, a big dark-brown iris with a black pupil and a catch-light, a heavy
  // upper lash line, and the smile creases under and beside each eye.
  const eyeY = 1.592
  const eyeW = 0.066
  const eyeH = 0.04
  const almond = (side: number): void => {
    const cx = side * 0.19
    ctx.beginPath()
    ctx.moveTo(...at(cx - eyeW, eyeY - 0.004))
    ctx.bezierCurveTo(...at(cx - eyeW * 0.55, eyeY + eyeH * 1.25), ...at(cx + eyeW * 0.55, eyeY + eyeH * 1.25), ...at(cx + eyeW, eyeY - 0.002))
    // The lower lid rises with the grin: a flatter, upward-curving bottom edge.
    ctx.bezierCurveTo(...at(cx + eyeW * 0.5, eyeY - eyeH * 0.55), ...at(cx - eyeW * 0.5, eyeY - eyeH * 0.55), ...at(cx - eyeW, eyeY - 0.004))
    ctx.closePath()
  }
  for (const side of [-1, 1]) {
    const cx = side * 0.19
    // A soft shadow round the socket so the eye sits in the face.
    ctx.fillStyle = 'rgba(35, 18, 10, 0.28)'
    ctx.beginPath()
    ctx.ellipse(...at(cx, eyeY + 0.006), (eyeW + 0.02) * unit, (eyeH + 0.024) * unit, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#efe8dc'
    almond(side)
    ctx.fill()
    ctx.save()
    almond(side)
    ctx.clip()
    // Looking straight ahead, a touch inward.
    const ix = cx - side * 0.006
    ctx.fillStyle = '#3b2216'
    ctx.beginPath()
    ctx.arc(...at(ix, eyeY + 0.004), 0.034 * unit, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#24130b'
    ctx.beginPath()
    ctx.arc(...at(ix, eyeY + 0.004), 0.026 * unit, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#070403'
    ctx.beginPath()
    ctx.arc(...at(ix, eyeY + 0.004), 0.014 * unit, 0, Math.PI * 2)
    ctx.fill()
    // The upper lid's shadow across the top of the iris.
    ctx.fillStyle = 'rgba(20, 10, 6, 0.35)'
    ctx.fillRect(faceU(cx - eyeW), faceV(eyeY + eyeH * 1.3), eyeW * 2 * unit, 0.014 * unit)
    ctx.restore()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(...at(ix + 0.012, eyeY + 0.016), 0.009 * unit, 0, Math.PI * 2)
    ctx.fill()
    // Heavy upper lash line, flicked out at the corner.
    ctx.strokeStyle = '#140b07'
    ctx.lineWidth = 0.014 * unit
    ctx.beginPath()
    ctx.moveTo(...at(cx - side * eyeW * 1.02, eyeY - 0.004))
    ctx.bezierCurveTo(
      ...at(cx - side * eyeW * 0.55, eyeY + eyeH * 1.28),
      ...at(cx + side * eyeW * 0.55, eyeY + eyeH * 1.28),
      ...at(cx + side * (eyeW + 0.012), eyeY + 0.006)
    )
    ctx.stroke()
    // Lower lid and the smile crease beneath it, pushed up by the cheek.
    ctx.strokeStyle = 'rgba(30, 15, 9, 0.6)'
    ctx.lineWidth = 0.007 * unit
    ctx.beginPath()
    ctx.moveTo(...at(cx - eyeW * 0.9, eyeY - 0.006))
    ctx.bezierCurveTo(...at(cx - eyeW * 0.5, eyeY - eyeH * 0.5), ...at(cx + eyeW * 0.5, eyeY - eyeH * 0.5), ...at(cx + eyeW * 0.9, eyeY - 0.004))
    ctx.stroke()
    ctx.strokeStyle = 'rgba(30, 15, 9, 0.42)'
    ctx.lineWidth = 0.008 * unit
    ctx.beginPath()
    ctx.moveTo(...at(cx - eyeW * 0.7, eyeY - eyeH * 1.1))
    ctx.quadraticCurveTo(...at(cx, eyeY - eyeH * 1.75), ...at(cx + eyeW * 0.8, eyeY - eyeH * 1.0))
    ctx.stroke()
    // Crow's feet at the outer corner.
    ctx.beginPath()
    ctx.moveTo(...at(cx + side * (eyeW + 0.016), eyeY + 0.002))
    ctx.lineTo(...at(cx + side * (eyeW + 0.04), eyeY - 0.012))
    ctx.stroke()
    // Brow: thick, dark, a gentle arch, lifted with the smile.
    ctx.strokeStyle = '#140b07'
    ctx.lineWidth = 0.026 * unit
    ctx.beginPath()
    ctx.moveTo(...at(side * 0.1, eyeY + 0.075))
    ctx.quadraticCurveTo(...at(side * 0.19, eyeY + 0.11), ...at(side * 0.285, eyeY + 0.078))
    ctx.stroke()
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ *
 * Prints: skinned decals that hug the torso
 * ------------------------------------------------------------------ */

interface PrintSpec {
  name: string
  texture: THREE.Texture
  /** Centre and size in bind-pose units. */
  x: number
  y: number
  width: number
  height: number
  /** +1 prints on the chest, -1 on the back. */
  side: 1 | -1
}

function addPrint(torso: THREE.SkinnedMesh, spec: PrintSpec): void {
  const source = torso.geometry
  const position = source.getAttribute('position')
  const normal = source.getAttribute('normal')
  const skinIndex = source.getAttribute('skinIndex')
  const skinWeight = source.getAttribute('skinWeight')
  if (!position || !normal || !skinIndex || !skinWeight) return

  // Only the vertices facing the print's way count as "the surface".
  const facing: number[] = []
  for (let i = 0; i < position.count; i += 1) if (normal.getZ(i) * spec.side > 0.2) facing.push(i)
  if (!facing.length) return

  const columns = 14
  const rows = 14
  const geometry = new THREE.PlaneGeometry(spec.width, spec.height, columns, rows)
  if (spec.side < 0) geometry.rotateY(Math.PI)
  geometry.translate(spec.x, spec.y, 0)
  const grid = geometry.getAttribute('position') as THREE.BufferAttribute

  // Depth of the surface under each grid point: the most-forward vertex nearby. On a
  // convex torso the faces between vertices never stand proud of their corners, so
  // this never puts the print behind the cloth.
  const reach = 0.06
  const depth = new Float32Array(grid.count)
  const nearestOf = new Int32Array(grid.count)
  for (let g = 0; g < grid.count; g += 1) {
    const gx = grid.getX(g)
    const gy = grid.getY(g)
    let best = -Infinity
    let nearest = facing[0]
    let nearestDistance = Infinity
    for (const i of facing) {
      const dx = position.getX(i) - gx
      const dy = position.getY(i) - gy
      const along = position.getZ(i) * spec.side
      const planar = dx * dx + dy * dy
      if (Math.abs(dx) < reach && Math.abs(dy) < reach && along > best) best = along
      if (planar < nearestDistance) {
        nearestDistance = planar
        nearest = i
      }
    }
    depth[g] = Number.isFinite(best) ? best : position.getZ(nearest) * spec.side
    nearestOf[g] = nearest
  }
  // Smooth the sheet so it reads as cloth, never dipping under the raw surface.
  const smoothed = new Float32Array(depth)
  for (let pass = 0; pass < 2; pass += 1) {
    const from = new Float32Array(smoothed)
    for (let r = 0; r <= rows; r += 1) {
      for (let c = 0; c <= columns; c += 1) {
        let sum = 0
        let count = 0
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const rr = r + dr
            const cc = c + dc
            if (rr < 0 || rr > rows || cc < 0 || cc > columns) continue
            sum += from[rr * (columns + 1) + cc]
            count += 1
          }
        }
        const g = r * (columns + 1) + c
        smoothed[g] = Math.max(depth[g], sum / count)
      }
    }
  }
  const lift = 0.012
  for (let g = 0; g < grid.count; g += 1) grid.setZ(g, (smoothed[g] + lift) * spec.side)
  geometry.computeVertexNormals()

  // Borrow the skin weights of the nearest torso vertex so the print bends with it.
  const indices = new Uint16Array(grid.count * 4)
  const weights = new Float32Array(grid.count * 4)
  for (let g = 0; g < grid.count; g += 1) {
    const i = nearestOf[g]
    for (let k = 0; k < 4; k += 1) {
      indices[g * 4 + k] = skinIndex.getComponent(i, k)
      weights[g * 4 + k] = skinWeight.getComponent(i, k)
    }
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(indices, 4))
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4))

  const material = litMaterial({ map: spec.texture, transparent: true })
  material.depthWrite = false
  material.polygonOffset = true
  material.polygonOffsetFactor = -2
  material.polygonOffsetUnits = -2
  const print = new THREE.SkinnedMesh(geometry, material)
  print.name = spec.name
  print.frustumCulled = false
  print.castShadow = false
  print.position.copy(torso.position)
  print.quaternion.copy(torso.quaternion)
  print.scale.copy(torso.scale)
  torso.parent?.add(print)
  print.bind(torso.skeleton, torso.bindMatrix)
}

/* ------------------------------------------------------------------ *
 * Cap, beard, coin
 * ------------------------------------------------------------------ */

/** The band sits just above the brows — the eyes top out at y 1.67. */
const CAP_BAND = 1.79
const CAP_CENTRE = new THREE.Vector3(0, CAP_BAND, 0.02)
/** How far the crown stands off the skull: a cap that fits, not a helmet. */
const CAP_EASE = 0.03
/** How much higher the front panel stands than the skull: a structured cap. */
const CAP_FRONT_RISE = 0.07

/**
 * The crown's radius in every direction from the band centre, shrink-wrapped onto the
 * skull: for each direction, the farthest head vertex within a wide cone, so the
 * crown follows the head's own shape with a little ease instead of being one big
 * ellipsoid wide enough for the tallest point.
 */
type CapShape = (dx: number, dy: number, dz: number) => number

function capShape(head: THREE.SkinnedMesh | null): CapShape {
  const fallback: CapShape = (dx, dy, dz) => 1 / Math.hypot(dx / 0.52, dy / 0.46, dz / 0.52)
  const position = head?.geometry.getAttribute('position')
  if (!position) return fallback
  const points: THREE.Vector3[] = []
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i)
    if (y < CAP_BAND - 0.03) continue
    points.push(new THREE.Vector3(position.getX(i), y, position.getZ(i)).sub(CAP_CENTRE))
  }
  if (points.length < 20) return fallback
  const cone = Math.cos(0.32)
  const unit = points.map((p) => p.clone().normalize())
  const length = points.map((p) => p.length())
  const cache = new Map<string, number>()
  return (dx, dy, dz) => {
    const key = `${dx.toFixed(3)},${dy.toFixed(3)},${dz.toFixed(3)}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const norm = Math.hypot(dx, dy, dz) || 1
    let reach = 0
    let weight = 0
    let sum = 0
    for (let i = 0; i < points.length; i += 1) {
      const cos = (unit[i].x * dx + unit[i].y * dy + unit[i].z * dz) / norm
      if (cos < cone) continue
      reach = Math.max(reach, length[i] * cos)
      const w = (cos - cone) ** 2
      weight += w
      sum += w * length[i]
    }
    // Mostly the farthest point (so nothing pokes through), a little of the average
    // (so the crown is smooth rather than faceted by the skull's own polygons).
    const radius = (weight ? Math.max(reach, 0.75 * reach + 0.25 * (sum / weight)) : 0.5) + CAP_EASE
    cache.set(key, radius)
    return radius
  }
}

const BRIM = {
  /** Half the arc of the band the brim is sewn to, in radians either side of the face. */
  span: 1.22,
  /** How far it sticks out at the middle. */
  reach: 0.42,
  thickness: 0.03,
  /** Slope down and away from the band, and the extra bend at the sides (pre-curved). */
  tilt: 0.12,
  curve: 0.24,
}

function buildBrim(shape: CapShape): THREE.Mesh {
  const columns = 40
  const rows = 8
  const ring = (phi: number): number => shape(Math.sin(phi), 0, Math.cos(phi)) * 0.985
  const point = (i: number, j: number, lift: number): THREE.Vector3 => {
    const side = (i / columns) * 2 - 1
    const phi = side * BRIM.span
    const r = ring(phi)
    // Out from the band (the ring's own normal, from its neighbours), but swept forward:
    // a brim shades the eyes, not the ears.
    const step = 0.02
    const a = new THREE.Vector2(Math.sin(phi - step) * ring(phi - step), Math.cos(phi - step) * ring(phi - step))
    const b = new THREE.Vector2(Math.sin(phi + step) * ring(phi + step), Math.cos(phi + step) * ring(phi + step))
    const normal = new THREE.Vector2(b.y - a.y, -(b.x - a.x)).normalize().multiplyScalar(0.4)
    normal.y += 0.6
    normal.normalize()
    const reach = BRIM.reach * Math.pow(Math.cos((side * Math.PI) / 2), 0.85)
    const out = reach * (j / rows)
    return new THREE.Vector3(
      CAP_CENTRE.x + r * Math.sin(phi) + normal.x * out,
      CAP_BAND - out * (BRIM.tilt + BRIM.curve * side * side) + lift,
      CAP_CENTRE.z + r * Math.cos(phi) + normal.y * out
    )
  }
  const positions: number[] = []
  const indices: number[] = []
  const groups: [number, number][] = []
  const grid = (lift: number, flip: boolean): void => {
    const base = positions.length / 3
    const start = indices.length
    for (let i = 0; i <= columns; i += 1) for (let j = 0; j <= rows; j += 1) positions.push(...point(i, j, lift).toArray())
    const at = (i: number, j: number): number => base + i * (rows + 1) + j
    for (let i = 0; i < columns; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)]
        if (flip) indices.push(a, b, c, b, d, c)
        else indices.push(a, c, b, b, c, d)
      }
    }
    groups.push([start, indices.length - start])
  }
  grid(0, false) // top, facing up
  grid(-BRIM.thickness, true) // underside, facing down
  // The rim joining the two along the outer edge.
  const base = positions.length / 3
  const start = indices.length
  for (let i = 0; i <= columns; i += 1) {
    positions.push(...point(i, rows, 0).toArray(), ...point(i, rows, -BRIM.thickness).toArray())
  }
  for (let i = 0; i < columns; i += 1) {
    const top = base + i * 2
    indices.push(top, top + 1, top + 2, top + 2, top + 1, top + 3)
  }
  groups.push([start, indices.length - start])

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  groups.forEach(([from, count], material) => geometry.addGroup(from, count, material))
  geometry.computeVertexNormals()
  const top = litMaterial({ color: CAP })
  // The underside a shade lighter, so the brim reads as its own plane from below.
  const under = litMaterial({ color: 0x2f3138 })
  const brim = new THREE.Mesh(geometry, [top, under, top])
  for (const material of [top, under]) material.side = THREE.DoubleSide
  brim.name = 'persona:cap-brim'
  return brim
}

function buildCap(head: THREE.SkinnedMesh | null): THREE.Group {
  const group = new THREE.Group()
  group.name = 'persona:cap'
  const shape = capShape(head)
  const theta = Math.PI / 2
  const geometry = new THREE.SphereGeometry(1, 56, 24, 0, Math.PI * 2, 0, theta)
  const position = geometry.getAttribute('position')
  const direction = new THREE.Vector3()
  for (let i = 0; i < position.count; i += 1) {
    direction.fromBufferAttribute(position, i)
    const r = shape(direction.x, direction.y, direction.z)
    const rise = direction.y > 0 && direction.z > 0 ? CAP_FRONT_RISE * direction.z * Math.sin(Math.PI * direction.y) : 0
    position.setXYZ(i, direction.x * r, direction.y * r + rise, direction.z * r)
  }
  geometry.computeVertexNormals()
  const crown = new THREE.Mesh(geometry, litMaterial({ map: capTexture(theta) }))
  ;(crown.material as THREE.Material).side = THREE.DoubleSide
  crown.name = 'persona:cap-crown'
  crown.position.copy(CAP_CENTRE)
  group.add(crown)
  group.add(buildBrim(shape))

  const button = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), litMaterial({ color: CAP }))
  button.scale.y = 0.6
  button.position.set(CAP_CENTRE.x, CAP_CENTRE.y + shape(0, 1, 0) - 0.005, CAP_CENTRE.z)
  group.add(button)
  return group
}

/** Swaps the round shield for a USDC coin of the same size, in the same grip. */
function addCoin(root: THREE.Object3D): void {
  let shield: THREE.Object3D | null = null
  root.traverse((object) => {
    if (!shield && object.name.replace(/[\[\].:/]/g, '').toLowerCase() === 'round_shield') shield = object
  })
  const anchor = shield as THREE.Object3D | null
  if (!anchor?.parent) return
  const face = litMaterial({ map: coinFace() })
  const rim = litMaterial({ color: 0xdfe6f0 })
  const geometry = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 40)
  geometry.rotateX(Math.PI / 2)
  const coin = new THREE.Mesh(geometry, [rim, face, face])
  coin.name = 'persona:usdc-shield'
  coin.position.copy(anchor.position)
  coin.position.z += 0.02
  coin.quaternion.copy(anchor.quaternion)
  coin.scale.copy(anchor.scale)
  coin.castShadow = true
  anchor.parent.add(coin)
}

/* ------------------------------------------------------------------ *
 * Bobbilee
 * ------------------------------------------------------------------ */

// Measured on the mage rig (bind pose, arms out along x): the sleeve runs to x 0.70,
// the cuff to 0.80, the hand beyond; the robe's skirt starts under the belt at y 0.73
// and its high back collar sits at y 1.2–1.3; the boots reach y 0.33.
const SWEATER_CUFF: [number, number] = [0.7, 0.8]
const SWEATER_HEM: [number, number] = [0.6, 0.66]
const SWEATER_NECK = 1.17
const SNEAKER_TOP = 0.13
const SNEAKER_SOLE_TOP = 0.03

const sweaterArm: Classifier = (x) => {
  const reach = Math.abs(x)
  if (reach < SWEATER_CUFF[0]) return Cell.Sweater
  if (reach < SWEATER_CUFF[1]) return Cell.Rib
  return Cell.Fair
}

const sweaterBody: Classifier = (_x, y) => {
  if (y > SWEATER_NECK) return Cell.Rib
  if (y > SWEATER_HEM[1]) return Cell.Sweater
  if (y > SWEATER_HEM[0]) return Cell.Rib
  return Cell.Trouser
}

const sneakerLeg: Classifier = (_x, y) => {
  if (y < SNEAKER_SOLE_TOP) return Cell.SneakerSole
  if (y < SNEAKER_TOP) return Cell.Sneaker
  return Cell.Trouser
}

/** A private, writable copy of a glTF texture, sampled exactly like the original. */
function editableCopy(source: THREE.Texture): { texture: THREE.CanvasTexture; ctx: CanvasRenderingContext2D } | null {
  const image = source.image as (CanvasImageSource & { width?: number; height?: number }) | undefined
  const width = image?.width ?? 0
  const height = image?.height ?? 0
  if (!image || !width || !height) return null
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  const ctx = element.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  try {
    ctx.drawImage(image, 0, 0, width, height)
  } catch {
    return null
  }
  const texture = new THREE.CanvasTexture(element)
  texture.colorSpace = source.colorSpace
  texture.flipY = source.flipY
  texture.wrapS = source.wrapS
  texture.wrapT = source.wrapT
  texture.magFilter = source.magFilter
  texture.minFilter = source.minFilter
  texture.anisotropy = source.anisotropy
  texture.needsUpdate = true
  return { texture, ctx }
}

// Her hair in the photo: a mid brown, pulled straight back off the forehead.
const BROWN_HAIR = { dark: [62, 40, 27], light: [146, 104, 70] } as const
const HAIR_TIE = [42, 42, 46] as const

/**
 * Bobbilee's head. The mage already wears her hair the right way — swept back off the
 * forehead into a ponytail — so the hair keeps its sculpt and its painted shading and
 * only turns from near-black to brown. The face is redrawn on a front-projected patch:
 * straight dark brows, brown eyes, nude-rose lips.
 */
function dressBobbileeHead(head: THREE.SkinnedMesh): void {
  const material = head.material as THREE.MeshStandardMaterial
  if (!material.map) return
  const copy = editableCopy(material.map)
  if (!copy) return
  const { texture, ctx } = copy
  const { width, height } = ctx.canvas
  const pixels = ctx.getImageData(0, 0, width, height)
  const data = pixels.data
  const texel = (u: number, v: number): [number, number, number] => {
    const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)))
    const py = Math.min(height - 1, Math.max(0, Math.floor(v * height)))
    const at = (py * width + px) * 4
    return [data[at], data[at + 1], data[at + 2]]
  }
  const isEyeInk = ([r, g, b]: [number, number, number]) => b > r + 6 && Math.max(r, g, b) < 60
  const isSkin = ([r, g, b]: [number, number, number]) => r > 200 && g > 140 && b > 100

  const geometry = head.geometry.index ? head.geometry.toNonIndexed() : head.geometry.clone()
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv || !normal) return

  // Skin tone of the face, top and bottom, so the patch blends into the ears and neck.
  const forehead = [0, 0, 0, 0]
  const chin = [0, 0, 0, 0]
  const faceTriangles: number[] = []
  for (let i = 0; i + 2 < position.count; i += 3) {
    let x = 0
    let y = 0
    let z = 0
    let nz = 0
    let u = 0
    let v = 0
    for (let k = 0; k < 3; k += 1) {
      x += position.getX(i + k) / 3
      y += position.getY(i + k) / 3
      z += position.getZ(i + k) / 3
      nz += normal.getZ(i + k) / 3
      u += uv.getX(i + k) / 3
      v += uv.getY(i + k) / 3
    }
    const colour = texel(u, v)
    // The rig's brows are raised blocks (y 1.69–1.77) in hair colour; they take the
    // painted brows instead, so their shape is the one drawn below.
    const brow = y > 1.675 && y < 1.778 && Math.abs(x) < 0.325 && z > 0.3 && Math.max(...colour) < 60
    const inFace = nz > 0.3 && z > 0.2 && y > FACE.bottom && y < FACE.top && Math.abs(x) < FACE.half
    const eye = isEyeInk(colour) && z > 0.2
    if (brow || eye || (inFace && isSkin(colour))) {
      faceTriangles.push(i)
      if (isSkin(colour) && Math.abs(x) < 0.3) {
        const into = y > 1.68 ? forehead : y < 1.36 ? chin : null
        if (into) {
          into[0] += colour[0]
          into[1] += colour[1]
          into[2] += colour[2]
          into[3] += 1
        }
      }
    }
  }
  const tone = (sum: number[], fallback: string) =>
    sum[3] ? `rgb(${Math.round(sum[0] / sum[3])},${Math.round(sum[1] / sum[3])},${Math.round(sum[2] / sum[3])})` : fallback

  // Hair: every near-black texel turns brown, keeping its own shade; the bluish band
  // round the ponytail becomes a plain dark tie. Face texels are redrawn below anyway.
  for (let at = 0; at < data.length; at += 4) {
    const r = data[at]
    const g = data[at + 1]
    const b = data[at + 2]
    const max = Math.max(r, g, b)
    if (b > r + 30 && max < 130) {
      data[at] = HAIR_TIE[0]
      data[at + 1] = HAIR_TIE[1]
      data[at + 2] = HAIR_TIE[2]
    } else if (max < 90) {
      const t = Math.min(1, Math.max(0, (max - 14) / 40))
      for (let c = 0; c < 3; c += 1) data[at + c] = BROWN_HAIR.dark[c] + (BROWN_HAIR.light[c] - BROWN_HAIR.dark[c]) * t
    }
  }
  ctx.putImageData(pixels, 0, 0)

  paintBobbileeFace(ctx, tone(forehead, '#f6c6a2'), tone(chin, '#f2b48c'))
  texture.needsUpdate = true

  for (const i of faceTriangles) {
    for (let k = 0; k < 3; k += 1) {
      uv.setXY(i + k, faceU(position.getX(i + k)) / width, faceV(position.getY(i + k)) / height)
    }
  }
  uv.needsUpdate = true
  head.geometry = geometry
  material.map = texture
  material.emissiveMap = texture
  material.needsUpdate = true
}

/**
 * Bobbilee as in the photo: strong straight brows, warm brown eyes with a defined lash
 * line, a soft flush, and a closed nude-rose mouth. Drawn in bind-space units (y up,
 * +x her left) through faceU/faceV.
 */
function paintBobbileeFace(ctx: CanvasRenderingContext2D, top: string, bottom: string): void {
  const u = faceU
  const v = faceV
  const s = FACE.scale
  const left = u(-FACE.half)
  const right = u(FACE.half)
  const skin = ctx.createLinearGradient(0, v(1.75), 0, v(1.3))
  skin.addColorStop(0, top)
  skin.addColorStop(1, bottom)
  ctx.fillStyle = skin
  ctx.fillRect(left, v(FACE.ceiling + 0.05), right - left, v(FACE.bottom - 0.05) - v(FACE.ceiling + 0.05))

  // A faint flush on the cheeks and a soft shadow under the nose.
  for (const side of [-1, 1]) {
    const blush = ctx.createRadialGradient(u(side * 0.27), v(1.47), 0, u(side * 0.27), v(1.47), 0.11 * s)
    blush.addColorStop(0, 'rgba(232,128,120,0.32)')
    blush.addColorStop(1, 'rgba(232,128,120,0)')
    ctx.fillStyle = blush
    ctx.fillRect(u(side * 0.27) - 0.12 * s, v(1.47) - 0.12 * s, 0.24 * s, 0.24 * s)
  }
  const nose = ctx.createRadialGradient(u(0), v(1.455), 0, u(0), v(1.455), 0.05 * s)
  nose.addColorStop(0, 'rgba(176,104,80,0.32)')
  nose.addColorStop(1, 'rgba(176,104,80,0)')
  ctx.fillStyle = nose
  ctx.fillRect(u(0) - 0.06 * s, v(1.455) - 0.06 * s, 0.12 * s, 0.12 * s)

  // Brows: straight and full, a little thicker at the inner end.
  ctx.fillStyle = '#3d2a1e'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(u(side * 0.09), v(1.69))
    ctx.lineTo(u(side * 0.09), v(1.728))
    ctx.lineTo(u(side * 0.24), v(1.735))
    ctx.lineTo(u(side * 0.315), v(1.715))
    ctx.lineTo(u(side * 0.3), v(1.698))
    ctx.lineTo(u(side * 0.2), v(1.694))
    ctx.closePath()
    ctx.fill()
  }

  // Eyes: brown iris filling most of the opening, dark pupil, a highlight, and an upper
  // lash line that flicks out at the corner.
  for (const side of [-1, 1]) {
    const cx = u(side * 0.203)
    const cy = v(1.616)
    ctx.fillStyle = '#fbf6f1'
    ctx.beginPath()
    ctx.ellipse(cx, cy, 0.062 * s, 0.05 * s, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#5a3a26'
    ctx.beginPath()
    ctx.ellipse(cx + side * -0.004 * s, cy + 0.002 * s, 0.043 * s, 0.047 * s, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1c120d'
    ctx.beginPath()
    ctx.ellipse(cx + side * -0.004 * s, cy + 0.004 * s, 0.022 * s, 0.025 * s, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(cx + side * 0.012 * s, cy - 0.016 * s, 0.011 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#20140f'
    ctx.lineCap = 'round'
    ctx.lineWidth = 0.014 * s
    ctx.beginPath()
    ctx.ellipse(cx, cy + 0.006 * s, 0.064 * s, 0.056 * s, 0, Math.PI * 1.08, Math.PI * 1.92)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(u(side * 0.262), v(1.632))
    ctx.lineTo(u(side * 0.29), v(1.648))
    ctx.stroke()
    ctx.strokeStyle = 'rgba(120,70,50,0.45)'
    ctx.lineWidth = 0.006 * s
    ctx.beginPath()
    ctx.ellipse(cx, cy - 0.002 * s, 0.06 * s, 0.05 * s, 0, Math.PI * 0.15, Math.PI * 0.85)
    ctx.stroke()
  }

  // Lips: closed, full lower lip, nude rose.
  const mouthY = 1.403
  ctx.fillStyle = '#b86c66'
  ctx.beginPath()
  ctx.moveTo(u(-0.078), v(mouthY))
  ctx.quadraticCurveTo(u(-0.04), v(mouthY + 0.024), u(0), v(mouthY + 0.014))
  ctx.quadraticCurveTo(u(0.04), v(mouthY + 0.024), u(0.078), v(mouthY))
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#cd847b'
  ctx.beginPath()
  ctx.moveTo(u(-0.078), v(mouthY))
  ctx.quadraticCurveTo(u(0), v(mouthY - 0.042), u(0.078), v(mouthY))
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#7c3d38'
  ctx.lineWidth = 0.007 * s
  ctx.beginPath()
  ctx.moveTo(u(-0.08), v(mouthY + 0.002))
  ctx.quadraticCurveTo(u(0), v(mouthY - 0.004), u(0.08), v(mouthY + 0.002))
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,236,226,0.5)'
  ctx.beginPath()
  ctx.ellipse(u(0.012), v(mouthY - 0.02), 0.02 * s, 0.006 * s, 0, 0, Math.PI * 2)
  ctx.fill()
}

/* Backpack with a puppy ------------------------------------------------ */

const BACKPACK_DARK = 0x8f6038
const LEATHER = 0x4e3322
const BUCKLE = 0xd8d2c4
const PUPPY = 0xfbf9f5
const PUPPY_SHADE = 0xece5da

/**
 * Measured on the mage rig (bind pose): her back is at z −0.33 from y 0.6 to 0.8, and
 * the ponytail hangs down the middle to y 1.05 (x ±0.15, z −0.43 to −0.75). So the pack
 * sits low between the shoulder blades, below the ponytail. It is a pet-carrier pack:
 * the puppy looks out of a round window on its outer face — straight at the camera that
 * follows her, framed by the dark inside of the bag so the white fur reads.
 */
const PACK = { width: 0.46, height: 0.44, depth: 0.2, y: 0.775, front: -0.355 }
const PACK_WINDOW = { y: PACK.y + 0.01, radius: 0.118 }
const PUPPY_AT = new THREE.Vector3(0, PACK_WINDOW.y + 0.005, PACK.front - PACK.depth - 0.035)

function ellipsoid(radius: [number, number, number], material: THREE.Material, detail = 18): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, detail, Math.round(detail * 0.7)), material)
  mesh.scale.set(...radius)
  mesh.castShadow = true
  return mesh
}

function buildPuppy(): THREE.Group {
  const puppy = new THREE.Group()
  puppy.name = 'persona:puppy'
  const fur = litMaterial({ color: PUPPY })
  const shade = litMaterial({ color: PUPPY_SHADE })
  const black = litMaterial({ color: 0x111012 })
  const pink = litMaterial({ color: 0xec8f9a })
  const shine = litMaterial({ color: 0xffffff })

  // A round puppy head, a little wider than tall, with a fluffy tuft on top.
  puppy.add(ellipsoid([0.088, 0.08, 0.082], fur, 24))
  for (const [x, y, z, r] of [
    [0, 0.072, 0.01, 0.034],
    [-0.028, 0.066, -0.01, 0.026],
    [0.03, 0.064, 0.0, 0.027],
    [0.008, 0.068, -0.03, 0.024],
  ]) {
    const tuft = ellipsoid([r, r * 0.85, r], fur, 12)
    tuft.position.set(x, y, z)
    puppy.add(tuft)
  }
  // Cheeks and muzzle: the muzzle points back (−z), a touch below the eyes.
  const muzzle = ellipsoid([0.046, 0.034, 0.04], fur, 18)
  muzzle.position.set(0, -0.026, -0.064)
  puppy.add(muzzle)
  const nose = ellipsoid([0.017, 0.012, 0.012], black, 12)
  nose.position.set(0, -0.012, -0.102)
  puppy.add(nose)
  const tongue = ellipsoid([0.014, 0.008, 0.012], pink, 10)
  tongue.position.set(0.004, -0.058, -0.088)
  tongue.rotation.x = -0.4
  puppy.add(tongue)
  for (const side of [-1, 1]) {
    // Round black eyes with a catch-light.
    const eye = ellipsoid([0.0145, 0.016, 0.01], black, 12)
    eye.position.set(side * 0.036, 0.016, -0.075)
    puppy.add(eye)
    const glint = ellipsoid([0.0045, 0.0045, 0.003], shine, 8)
    glint.position.set(side * 0.036 + 0.005, 0.022, -0.084)
    puppy.add(glint)
    // Floppy ears, hanging down the sides of the head.
    const ear = ellipsoid([0.024, 0.058, 0.036], shade, 14)
    ear.position.set(side * 0.084, -0.012, 0.004)
    ear.rotation.z = side * 0.32
    ear.rotation.x = 0.12
    puppy.add(ear)
    // Front paws hooked over the rim of the pack.
    const paw = ellipsoid([0.026, 0.02, 0.03], fur, 12)
    paw.position.set(side * 0.052, -0.098, -0.04)
    puppy.add(paw)
    for (const toe of [-1, 0, 1]) {
      const line = ellipsoid([0.0016, 0.007, 0.002], shade, 6)
      line.position.set(side * 0.052 + toe * 0.009, -0.1, -0.069)
      puppy.add(line)
    }
  }
  // A little red collar just inside the window.
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.01, 8, 24), litMaterial({ color: 0xd8423c }))
  collar.position.set(0, -0.06, 0.035)
  collar.rotation.x = 0.5
  puppy.add(collar)
  const tag = ellipsoid([0.011, 0.011, 0.004], litMaterial({ color: 0xf2c94c }), 10)
  tag.position.set(0, -0.098, 0.002)
  puppy.add(tag)
  // Head cocked a little, as puppies do.
  puppy.rotation.z = -0.16
  puppy.rotation.y = 0.18
  return puppy
}

function strap(points: [number, number, number][], material: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.016, 6, false), material)
  mesh.castShadow = true
  return mesh
}

function buildBackpack(): THREE.Group {
  const pack = new THREE.Group()
  pack.name = 'persona:backpack'
  const canvasColour = litMaterial({ color: BACKPACK })
  const dark = litMaterial({ color: BACKPACK_DARK })
  const leather = litMaterial({ color: LEATHER })
  const metal = litMaterial({ color: BUCKLE })
  const z = PACK.front - PACK.depth / 2

  const body = new THREE.Mesh(new RoundedBoxGeometry(PACK.width, PACK.height, PACK.depth, 4, 0.06), canvasColour)
  body.position.set(0, PACK.y, z)
  body.castShadow = true
  pack.add(body)

  const face = PACK.front - PACK.depth
  // The window: a dark opening ringed by a padded leather rim, the puppy in it.
  const inside = new THREE.Mesh(new THREE.CircleGeometry(PACK_WINDOW.radius, 32), litMaterial({ color: 0x24170f }))
  inside.position.set(0, PACK_WINDOW.y, face - 0.004)
  inside.rotation.y = Math.PI
  pack.add(inside)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(PACK_WINDOW.radius, 0.022, 10, 36), leather)
  rim.position.set(0, PACK_WINDOW.y, face - 0.006)
  rim.castShadow = true
  pack.add(rim)
  // Stitched piping round the rim.
  const piping = new THREE.Mesh(new THREE.TorusGeometry(PACK_WINDOW.radius + 0.034, 0.006, 6, 40), dark)
  piping.position.set(0, PACK_WINDOW.y, face - 0.002)
  pack.add(piping)

  // The lid over the top, its strap buckled down onto the face above the window.
  const lid = new THREE.Mesh(new RoundedBoxGeometry(PACK.width + 0.02, 0.06, PACK.depth + 0.03, 3, 0.026), dark)
  lid.position.set(0, PACK.y + PACK.height / 2 - 0.005, z - 0.012)
  lid.castShadow = true
  pack.add(lid)
  for (const x of [-0.15, 0.15]) {
    const buckleStrap = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.1, 0.01), leather)
    buckleStrap.position.set(x, PACK.y + PACK.height / 2 - 0.06, face - 0.016)
    pack.add(buckleStrap)
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.032, 0.012), metal)
    buckle.position.set(x, PACK.y + PACK.height / 2 - 0.1, face - 0.02)
    pack.add(buckle)
  }
  // A small zip pocket under the window.
  const pocket = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.07, 0.04, 3, 0.016), dark)
  pocket.position.set(0, PACK.y - PACK.height / 2 + 0.06, face - 0.01)
  pack.add(pocket)
  const pull = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.03, 0.008), metal)
  pull.position.set(0.08, PACK.y - PACK.height / 2 + 0.07, face - 0.034)
  pack.add(pull)

  // Shoulder straps: up the back from the pack's top corners, over the shoulders.
  for (const side of [-1, 1]) {
    const x = side * 0.15
    pack.add(
      strap(
        [
          [side * 0.16, PACK.y + 0.12, PACK.front + 0.01],
          [x, 1.08, -0.3],
          [x, 1.24, -0.39],
          [x, 1.31, -0.24],
          [x, 1.32, -0.02],
          [x, 1.27, 0.18],
        ],
        leather
      )
    )
  }
  // A grab loop on top.
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 16, Math.PI), leather)
  loop.position.set(0, PACK.y + PACK.height / 2 + 0.03, PACK.front - 0.04)
  pack.add(loop)

  const puppy = buildPuppy()
  puppy.position.copy(PUPPY_AT)
  pack.add(puppy)
  return pack
}

function dressBobbilee(root: THREE.Object3D): void {
  const head = findMesh(root, '_head')
  const palette = paletteTexture()
  if (head) dressBobbileeHead(head)
  dress(findMesh(root, '_body'), palette, sweaterBody)
  dress(findMesh(root, '_armleft'), palette, sweaterArm)
  dress(findMesh(root, '_armright'), palette, sweaterArm)
  dress(findMesh(root, '_legleft'), palette, sneakerLeg)
  dress(findMesh(root, '_legright'), palette, sneakerLeg)
  const torso = findMesh(root, '_body')
  if (torso) bindSpaceOf(torso, 'chest')?.add(buildBackpack())
}

/* ------------------------------------------------------------------ *
 * Teddyz
 * ------------------------------------------------------------------ */

// Measured on the barbarian rig (bind pose, arms out along x): the shoulder block ends
// at x 0.34 where the upper arm narrows, and the hand wraps start at 0.79. The body's
// belt runs y 0.48–0.70, the neck rises above y 1.27, the boots reach y 0.22.
const TEE_SLEEVE = 0.345
const TEE_HEM = 0.6
const TEE_NECK = 1.3

const teeArm: Classifier = (x) => (Math.abs(x) < TEE_SLEEVE ? Cell.WhiteTee : Cell.Tan)

const teeBody: Classifier = (_x, y) => {
  if (y > TEE_NECK) return Cell.Tan
  if (y > TEE_HEM) return Cell.WhiteTee
  return Cell.BlackTrouser
}

const teddyLeg: Classifier = (_x, y) => {
  if (y < SNEAKER_SOLE_TOP) return Cell.SneakerSole
  if (y < SNEAKER_TOP) return Cell.Sneaker
  return Cell.BlackTrouser
}

/** Warms the artist's peach skin to his light tan (multipliers per channel). */
const TAN_SHIFT = [0.92, 0.86, 0.8] as const
const BLACK_HAIR = '#1a1513'

/**
 * A clean-shaven jaw: a rounded box under the cheekbones that narrows toward the chin.
 * The barbarian's beard is its own shell and the face behind it is open, so the beard
 * itself is pulled in onto this shape and becomes the jaw.
 */
const JAW = { x: 0.47, y: 0.31, z: 0.42, taperX: 0.21, taperZ: 0.03, cx: 0, cy: 1.53, cz: 0.02 }

function jawExtent(x: number, y: number, z: number): number {
  const dy = y - JAW.cy
  const s = dy < 0 ? Math.min(1, -dy / JAW.y) : 0
  const rx = JAW.x - JAW.taperX * s * s
  const rz = JAW.z - JAW.taperZ * s * s
  return (x / rx) ** 4 + (dy / JAW.y) ** 4 + ((z - JAW.cz) / rz) ** 4
}

function intoJaw(p: THREE.Vector3): void {
  if (jawExtent(p.x, p.y, p.z) <= 1) return
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i += 1) {
    const t = (lo + hi) / 2
    if (jawExtent(JAW.cx + (p.x - JAW.cx) * t, JAW.cy + (p.y - JAW.cy) * t, JAW.cz + (p.z - JAW.cz) * t) > 1) hi = t
    else lo = t
  }
  p.set(JAW.cx + (p.x - JAW.cx) * lo, JAW.cy + (p.y - JAW.cy) * lo, JAW.cz + (p.z - JAW.cz) * lo)
}

/**
 * The scalp is mapped round the head (angle about the vertical axis × height) onto a
 * strip of the head's private texture copy that its own UVs never touch, and painted
 * with his cut: dark on top, a short fade down the sides and back.
 */
const SCALP = { left: 12, width: 1000, top: 704, height: 300, from: -Math.PI, to: Math.PI + 1.4, high: 2.3, low: 1.2 }
const scalpU = (angle: number): number =>
  SCALP.left + ((Math.min(SCALP.to, Math.max(SCALP.from, angle)) - SCALP.from) / (SCALP.to - SCALP.from)) * SCALP.width
const scalpV = (y: number): number => SCALP.top + ((SCALP.high - Math.min(SCALP.high, Math.max(SCALP.low, y))) / (SCALP.high - SCALP.low)) * SCALP.height

const smooth = (from: number, to: number, t: number): number => {
  const k = Math.min(1, Math.max(0, (t - from) / (to - from)))
  return k * k * (3 - 2 * k)
}

/** Where hair starts, by angle round the head (0 = straight ahead). */
function hairline(angle: number): number {
  const a = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)))
  // Straight across the forehead, a squared corner at the temples, low over the ears,
  // and down to the nape behind.
  return 1.88 - 0.22 * smooth(0.8, 1.3, a) - 0.24 * smooth(2.2, 2.9, a)
}

/** Where the short faded sides give way to the full-length top. */
function fadeTop(angle: number): number {
  const a = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)))
  return 1.88 + 0.06 * smooth(0.8, 1.3, a) - 0.12 * smooth(2.2, 2.9, a)
}

function paintScalp(ctx: CanvasRenderingContext2D, skin: [number, number, number]): void {
  const x0 = SCALP.left - 8
  const y0 = SCALP.top - 4
  const w = SCALP.width + 16
  const h = SCALP.height + 8
  const image = ctx.getImageData(x0, y0, w, h)
  const data = image.data
  const dark = [26, 21, 19]
  let seed = 7
  const noise = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let py = 0; py < h; py += 1) {
    const y = SCALP.high - ((py + y0 - SCALP.top) / SCALP.height) * (SCALP.high - SCALP.low)
    for (let px = 0; px < w; px += 1) {
      const angle = SCALP.from + ((px + x0 - SCALP.left) / SCALP.width) * (SCALP.to - SCALP.from)
      const line = hairline(angle)
      const top = fadeTop(angle)
      // 0 = bare skin, 1 = full hair; the fade climbs from a shadow to near-black.
      let cover = 0
      if (y >= top) cover = 1
      else if (y >= line - 0.012) cover = 0.26 + 0.6 * smooth(line, top, y) ** 1.6 + (noise() - 0.5) * 0.16
      else if (y >= line - 0.03) cover = 0.25 * smooth(line - 0.03, line - 0.012, y)
      const grain = cover >= 1 ? (noise() - 0.5) * 10 : 0
      const at = (py * w + px) * 4
      for (let c = 0; c < 3; c += 1) {
        data[at + c] = Math.max(0, Math.min(255, skin[c] + (dark[c] - skin[c]) * Math.min(1, cover) + grain))
      }
      data[at + 3] = 255
    }
  }
  ctx.putImageData(image, x0, y0)
}

/**
 * Teddyz's head: the bearded barbarian, shaved. The beard shell becomes a square jaw,
 * the face is redrawn on a front-projected patch (straight dark brows, dark brown eyes,
 * a closed mouth), and the bald scalp gets his short dark cut, with a swept-up quiff
 * modelled on top (see buildQuiff).
 */
function dressTeddyzHead(head: THREE.SkinnedMesh): void {
  const material = head.material as THREE.MeshStandardMaterial
  if (!material.map) return
  const copy = editableCopy(material.map)
  if (!copy) return
  const { texture, ctx } = copy
  const { width, height } = ctx.canvas
  const pixels = ctx.getImageData(0, 0, width, height)
  const data = pixels.data
  const isSkin = (r: number, g: number, b: number) => r > 200 && g > 140 && b > 100 && r > b + 50
  for (let at = 0; at < data.length; at += 4) {
    if (!isSkin(data[at], data[at + 1], data[at + 2])) continue
    for (let c = 0; c < 3; c += 1) data[at + c] = Math.round(data[at + c] * TAN_SHIFT[c])
  }
  ctx.putImageData(pixels, 0, 0)
  const texel = (u: number, v: number): [number, number, number] => {
    const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)))
    const py = Math.min(height - 1, Math.max(0, Math.floor(v * height)))
    const at = (py * width + px) * 4
    return [data[at], data[at + 1], data[at + 2]]
  }
  const tanned = (r: number, g: number, b: number) => r > 180 && g > 120 && b > 90 && r > b + 45

  const geometry = head.geometry.index ? head.geometry.toNonIndexed() : head.geometry.clone()
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv || !normal) return

  const tone = [0, 0, 0, 0]
  const faceTriangles: number[] = []
  const scalpTriangles: number[] = []
  const jawTriangles: number[] = []
  const p = new THREE.Vector3()
  for (let i = 0; i + 2 < position.count; i += 3) {
    let x = 0
    let y = 0
    let z = 0
    let nz = 0
    let u = 0
    let v = 0
    let peak = -Infinity
    let reach = 0
    for (let k = 0; k < 3; k += 1) {
      x += position.getX(i + k) / 3
      y += position.getY(i + k) / 3
      z += position.getZ(i + k) / 3
      nz += normal.getZ(i + k) / 3
      u += uv.getX(i + k) / 3
      v += uv.getY(i + k) / 3
      peak = Math.max(peak, position.getY(i + k) - hairline(Math.atan2(position.getX(i + k), position.getZ(i + k))))
      reach = Math.max(reach, position.getY(i + k))
    }
    const [r, g, b] = texel(u, v)
    const grey = Math.abs(r - b) < 40 && r > 95 && r < 175 && Math.max(r, g, b) - Math.min(r, g, b) < 45
    const ink = Math.max(r, g, b) < 60
    const skin = tanned(r, g, b)
    if (grey && y < 1.58) {
      // Beard → jaw.
      for (let k = 0; k < 3; k += 1) {
        p.fromBufferAttribute(position, i + k)
        intoJaw(p)
        position.setXYZ(i + k, p.x, p.y, p.z)
      }
      jawTriangles.push(i)
      faceTriangles.push(i)
    } else if (grey && z > 0.2) {
      // The barbarian's bushy brows are raised blocks with the forehead whole behind
      // them: they fold away, and his own straight brows are painted on the patch.
      for (let k = 0; k < 3; k += 1) position.setXYZ(i + k, x, y, z - 0.02)
    } else if (ink && z > 0.2) {
      faceTriangles.push(i)
    } else if (skin && nz > 0.3 && z > 0.2 && Math.abs(x) < 0.42 && y > FACE.bottom && reach < FACE.ceiling + 0.03) {
      faceTriangles.push(i)
      if (Math.abs(x) < 0.3 && y > 1.45 && y < 1.85) {
        tone[0] += r
        tone[1] += g
        tone[2] += b
        tone[3] += 1
      }
    } else if (skin && peak > -0.06) {
      scalpTriangles.push(i)
    }
  }
  const base: [number, number, number] = tone[3]
    ? [Math.round(tone[0] / tone[3]), Math.round(tone[1] / tone[3]), Math.round(tone[2] / tone[3])]
    : [225, 161, 121]

  // His nose is straight and fine, not the barbarian's bulb (x ±0.137 at the tip): the
  // tip is narrowed and pulled back a little, the bridge between the eyes kept.
  for (const i of faceTriangles) {
    let touched = false
    for (let k = 0; k < 3; k += 1) {
      p.fromBufferAttribute(position, i + k)
      if (Math.abs(p.x) > 0.17 || p.y < 1.42 || p.y > 1.6 || p.z < 0.43) continue
      const w = smooth(1.42, 1.46, p.y) * (1 - smooth(1.54, 1.6, p.y)) * (1 - smooth(0.13, 0.17, Math.abs(p.x)))
      p.x *= 1 - 0.34 * w
      // …and the ridge of it stands a little prouder, so it reads in profile.
      p.z += 0.018 * w * (1 - smooth(0.02, 0.09, Math.abs(p.x)))
      position.setXYZ(i + k, p.x, p.y, p.z)
      touched = true
    }
    if (touched) jawTriangles.push(i)
  }

  paintScalp(ctx, base)
  paintTeddyzFace(ctx, base)
  texture.needsUpdate = true

  for (const i of faceTriangles) {
    for (let k = 0; k < 3; k += 1) {
      uv.setXY(i + k, faceU(position.getX(i + k)) / width, faceV(position.getY(i + k)) / height)
    }
  }
  for (const i of scalpTriangles) {
    const angles = [0, 1, 2].map((k) => Math.atan2(position.getX(i + k), position.getZ(i + k)))
    // A triangle straddling the seam behind the head is unwrapped past +π.
    const wrap = Math.max(...angles) - Math.min(...angles) > Math.PI
    for (let k = 0; k < 3; k += 1) {
      const angle = wrap && angles[k] < 0 ? angles[k] + Math.PI * 2 : angles[k]
      uv.setXY(i + k, scalpU(angle) / width, scalpV(position.getY(i + k)) / height)
    }
  }
  uv.needsUpdate = true

  // The pulled-in jaw and the refined nose get smooth normals of their new shape.
  const sums = new Map<string, THREE.Vector3>()
  const key = (i: number) =>
    `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (const i of jawTriangles) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    const face = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b))
    for (let k = 0; k < 3; k += 1) {
      const id = key(i + k)
      const sum = sums.get(id) ?? new THREE.Vector3()
      sums.set(id, sum.add(face))
    }
  }
  for (const i of jawTriangles) {
    for (let k = 0; k < 3; k += 1) {
      const n = sums.get(key(i + k))
      if (n && n.lengthSq() > 0) {
        n.normalize()
        normal.setXYZ(i + k, n.x, n.y, n.z)
      }
    }
  }
  normal.needsUpdate = true
  position.needsUpdate = true
  geometry.computeBoundingSphere()

  head.geometry = geometry
  material.map = texture
  material.emissiveMap = texture
  material.needsUpdate = true
}

/**
 * Teddyz as in the photo: straight, heavy dark brows, dark brown eyes, a clean-shaven
 * square jaw and a relaxed closed mouth; hair starts straight across the forehead.
 */
function paintTeddyzFace(ctx: CanvasRenderingContext2D, skin: [number, number, number]): void {
  const u = faceU
  const v = faceV
  const s = FACE.scale
  const left = u(-FACE.half)
  const right = u(FACE.half)
  const rgb = (k: number, alpha = 1) =>
    `rgba(${Math.round(skin[0] * k)},${Math.round(skin[1] * k)},${Math.round(skin[2] * k)},${alpha})`
  const top = v(FACE.ceiling + 0.05)
  const bottom = v(FACE.bottom - 0.05)
  ctx.fillStyle = rgb(1)
  ctx.fillRect(left, top, right - left, bottom - top)

  // Soft modelling: a touch darker under the cheekbones and along the jaw, and a
  // shadow under the nose and the lower lip.
  for (const side of [-1, 1]) {
    const hollow = ctx.createRadialGradient(u(side * 0.4), v(1.36), 0, u(side * 0.4), v(1.36), 0.2 * s)
    hollow.addColorStop(0, rgb(0.86, 0.5))
    hollow.addColorStop(1, rgb(0.86, 0))
    ctx.fillStyle = hollow
    ctx.fillRect(u(side * 0.4) - 0.2 * s, v(1.36) - 0.2 * s, 0.4 * s, 0.4 * s)
  }
  const under = ctx.createLinearGradient(0, v(1.3), 0, v(1.2))
  under.addColorStop(0, rgb(1, 0))
  under.addColorStop(1, rgb(0.84, 1))
  ctx.fillStyle = under
  ctx.fillRect(left, v(1.3), right - left, v(1.15) - v(1.3))
  // The nose: a straight, defined bridge (a soft light down the middle between two
  // side shadows), a rounded tip with its own highlight, and the nostrils beneath.
  for (const side of [-1, 1]) {
    const flank = ctx.createLinearGradient(u(side * 0.02), 0, u(side * 0.075), 0)
    flank.addColorStop(0, rgb(0.9, 0))
    flank.addColorStop(1, rgb(0.76, 0.7))
    ctx.fillStyle = flank
    ctx.beginPath()
    ctx.moveTo(u(side * 0.03), v(1.66))
    ctx.lineTo(u(side * 0.075), v(1.62))
    ctx.lineTo(u(side * 0.085), v(1.5))
    ctx.lineTo(u(side * 0.035), v(1.5))
    ctx.closePath()
    ctx.fill()
  }
  const bridge = ctx.createLinearGradient(u(-0.025), 0, u(0.025), 0)
  bridge.addColorStop(0, rgb(1.06, 0))
  bridge.addColorStop(0.5, rgb(1.08, 0.7))
  bridge.addColorStop(1, rgb(1.06, 0))
  ctx.fillStyle = bridge
  ctx.fillRect(u(-0.025), v(1.63), 0.05 * s, v(1.5) - v(1.63))
  const tip = ctx.createRadialGradient(u(0.005), v(1.497), 0, u(0.005), v(1.497), 0.03 * s)
  tip.addColorStop(0, rgb(1.1, 0.75))
  tip.addColorStop(1, rgb(1.1, 0))
  ctx.fillStyle = tip
  ctx.fillRect(u(0) - 0.035 * s, v(1.497) - 0.035 * s, 0.07 * s, 0.07 * s)
  // Shadow under the tip and round the wings of the nose.
  const base = ctx.createRadialGradient(u(0), v(1.462), 0, u(0), v(1.462), 0.07 * s)
  base.addColorStop(0, rgb(0.74, 0.6))
  base.addColorStop(1, rgb(0.74, 0))
  ctx.fillStyle = base
  ctx.beginPath()
  ctx.ellipse(u(0), v(1.462), 0.075 * s, 0.03 * s, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = rgb(0.68, 0.7)
  ctx.lineWidth = 0.007 * s
  ctx.lineCap = 'round'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(u(side * 0.05), v(1.5))
    ctx.quadraticCurveTo(u(side * 0.072), v(1.478), u(side * 0.05), v(1.462))
    ctx.stroke()
    ctx.fillStyle = 'rgba(70,36,28,0.75)'
    ctx.beginPath()
    ctx.ellipse(u(side * 0.026), v(1.466), 0.014 * s, 0.007 * s, side * 0.35, 0, Math.PI * 2)
    ctx.fill()
  }

  // Hairline: straight across, with a softened edge.
  const hair = ctx.createLinearGradient(0, v(1.865), 0, v(1.885))
  hair.addColorStop(0, 'rgba(26,21,19,0)')
  hair.addColorStop(1, BLACK_HAIR)
  ctx.fillStyle = hair
  ctx.fillRect(left, top, right - left, v(1.865) - top)

  // Brows: straight, heavy, squared at the inner end and tapering outward.
  ctx.fillStyle = '#1d1613'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(u(side * 0.085), v(1.702))
    ctx.lineTo(u(side * 0.085), v(1.738))
    ctx.lineTo(u(side * 0.22), v(1.746))
    ctx.lineTo(u(side * 0.3), v(1.727))
    ctx.lineTo(u(side * 0.292), v(1.713))
    ctx.lineTo(u(side * 0.2), v(1.71))
    ctx.closePath()
    ctx.fill()
  }

  // Eyes: a narrower, calmer opening than Bobbilee's; dark brown iris, firm upper lid.
  for (const side of [-1, 1]) {
    const cx = u(side * 0.204)
    const cy = v(1.612)
    ctx.fillStyle = '#f6efe8'
    ctx.beginPath()
    ctx.ellipse(cx, cy, 0.06 * s, 0.04 * s, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#3a2417'
    ctx.beginPath()
    ctx.ellipse(cx - side * 0.004 * s, cy + 0.002 * s, 0.036 * s, 0.04 * s, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#120b08'
    ctx.beginPath()
    ctx.ellipse(cx - side * 0.004 * s, cy + 0.003 * s, 0.019 * s, 0.021 * s, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(cx + side * 0.008 * s, cy - 0.013 * s, 0.009 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#1a110c'
    ctx.lineCap = 'round'
    ctx.lineWidth = 0.013 * s
    ctx.beginPath()
    ctx.ellipse(cx, cy + 0.008 * s, 0.062 * s, 0.05 * s, 0, Math.PI * 1.1, Math.PI * 1.9)
    ctx.stroke()
    ctx.strokeStyle = rgb(0.72, 0.6)
    ctx.lineWidth = 0.006 * s
    ctx.beginPath()
    ctx.ellipse(cx, cy - 0.004 * s, 0.058 * s, 0.045 * s, 0, Math.PI * 0.2, Math.PI * 0.8)
    ctx.stroke()
    // The crease of the upper lid.
    ctx.strokeStyle = rgb(0.75, 0.55)
    ctx.beginPath()
    ctx.ellipse(cx, cy + 0.01 * s, 0.064 * s, 0.07 * s, 0, Math.PI * 1.2, Math.PI * 1.8)
    ctx.stroke()
  }

  // Mouth as in the photo: closed, full and natural — a defined cupid's bow, a full
  // rosy lower lip with a soft highlight, the corners tucked in with a little shadow.
  const mouthY = 1.386
  const half = 0.098
  const philtrum = ctx.createLinearGradient(u(-0.02), 0, u(0.02), 0)
  philtrum.addColorStop(0, rgb(0.86, 0.45))
  philtrum.addColorStop(0.5, rgb(1, 0))
  philtrum.addColorStop(1, rgb(0.86, 0.45))
  ctx.fillStyle = philtrum
  ctx.fillRect(u(-0.02), v(1.452), 0.04 * s, v(mouthY + 0.03) - v(1.452))
  // Upper lip: the bow peaks either side of the middle.
  ctx.fillStyle = '#b86a5f'
  ctx.beginPath()
  ctx.moveTo(u(-half), v(mouthY + 0.002))
  ctx.bezierCurveTo(u(-0.07), v(mouthY + 0.014), u(-0.04), v(mouthY + 0.032), u(-0.017), v(mouthY + 0.033))
  ctx.quadraticCurveTo(u(0), v(mouthY + 0.026), u(0.017), v(mouthY + 0.033))
  ctx.bezierCurveTo(u(0.04), v(mouthY + 0.032), u(0.07), v(mouthY + 0.014), u(half), v(mouthY + 0.002))
  ctx.quadraticCurveTo(u(0), v(mouthY - 0.004), u(-half), v(mouthY + 0.002))
  ctx.closePath()
  ctx.fill()
  // Lower lip: fuller, a shade pinker.
  ctx.fillStyle = '#c47a6c'
  ctx.beginPath()
  ctx.moveTo(u(-half + 0.006), v(mouthY))
  ctx.quadraticCurveTo(u(0), v(mouthY - 0.006), u(half - 0.006), v(mouthY))
  ctx.bezierCurveTo(u(0.07), v(mouthY - 0.03), u(0.035), v(mouthY - 0.042), u(0), v(mouthY - 0.042))
  ctx.bezierCurveTo(u(-0.035), v(mouthY - 0.042), u(-0.07), v(mouthY - 0.03), u(-half + 0.006), v(mouthY))
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255,226,214,0.45)'
  ctx.beginPath()
  ctx.ellipse(u(0.008), v(mouthY - 0.02), 0.032 * s, 0.009 * s, 0, 0, Math.PI * 2)
  ctx.fill()
  // The line between the lips, darkest in the middle and at the corners.
  ctx.strokeStyle = '#5a2b24'
  ctx.lineWidth = 0.008 * s
  ctx.beginPath()
  ctx.moveTo(u(-half - 0.004), v(mouthY + 0.004))
  ctx.quadraticCurveTo(u(-0.04), v(mouthY - 0.004), u(0), v(mouthY - 0.001))
  ctx.quadraticCurveTo(u(0.04), v(mouthY - 0.004), u(half + 0.004), v(mouthY + 0.004))
  ctx.stroke()
  for (const side of [-1, 1]) {
    const corner = ctx.createRadialGradient(u(side * (half + 0.006)), v(mouthY + 0.002), 0, u(side * (half + 0.006)), v(mouthY + 0.002), 0.022 * s)
    corner.addColorStop(0, 'rgba(90,45,36,0.5)')
    corner.addColorStop(1, 'rgba(90,45,36,0)')
    ctx.fillStyle = corner
    ctx.fillRect(u(side * (half + 0.006)) - 0.025 * s, v(mouthY + 0.002) - 0.025 * s, 0.05 * s, 0.05 * s)
  }
  // Shadow under the lower lip, above the chin.
  const lip = ctx.createRadialGradient(u(0), v(mouthY - 0.06), 0, u(0), v(mouthY - 0.06), 0.06 * s)
  lip.addColorStop(0, rgb(0.82, 0.55))
  lip.addColorStop(1, rgb(0.82, 0))
  ctx.fillStyle = lip
  ctx.beginPath()
  ctx.ellipse(u(0), v(mouthY - 0.062), 0.07 * s, 0.022 * s, 0, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * His cut in the photo: very short faded sides (painted on the scalp), and on top a
 * short, textured crop with real volume, pushed up and a little forward at the front.
 * Built as a close-fitting shell for the mass of the top, with tapered clumps rising
 * out of it — swept back over the crown, up and forward along the front — so it reads
 * as hair from any angle rather than a smooth helmet.
 */
const QUIFF_CENTRE = new THREE.Vector3(0, 1.965, 0.005)
const QUIFF_RADII = new THREE.Vector3(0.415, 0.23, 0.455)

/** A point on the shell for a unit-sphere direction (y up, z forward). */
function quiffPoint(px: number, py: number, pz: number): THREE.Vector3 {
  const front = Math.max(0, pz)
  const lift = 0.13 * front * front * smooth(-0.2, 0.7, py)
  return new THREE.Vector3(
    QUIFF_CENTRE.x + px * QUIFF_RADII.x * (1 - 0.07 * smooth(0, 1, py)),
    QUIFF_CENTRE.y + py * QUIFF_RADII.y + lift,
    QUIFF_CENTRE.z + pz * QUIFF_RADII.z + 0.06 * front * smooth(0, 0.6, py)
  )
}

function hairStrands(base: string, light: string, dark: string, seed: number): THREE.CanvasTexture {
  const { canvas: element, ctx } = canvas(128, 128)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 128, 128)
  let state = seed
  const noise = () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
  for (let i = 0; i < 140; i += 1) {
    const x = noise() * 128
    const isLight = noise() < 0.35
    ctx.strokeStyle = isLight ? light : dark
    ctx.lineWidth = isLight ? 1 : 1.8
    ctx.beginPath()
    ctx.moveTo(x, 128)
    ctx.quadraticCurveTo(x + (noise() - 0.5) * 8, 64, x + (noise() - 0.5) * 14, noise() * 20)
    ctx.stroke()
  }
  const map = textureOf(element)
  map.wrapS = THREE.RepeatWrapping
  return map
}

function buildQuiff(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'persona:quiff'
  const shellMap = hairStrands(BLACK_HAIR, 'rgba(84,70,62,0.5)', 'rgba(8,6,5,0.6)', 11)
  const shellMaterial = litMaterial({ map: shellMap })
  shellMaterial.roughness = 0.7
  const clumpMaterial = litMaterial({ map: hairStrands('#211a17', 'rgba(96,80,70,0.55)', 'rgba(10,8,7,0.6)', 29) })
  clumpMaterial.roughness = 0.6

  const geometry = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.6)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < position.count; i += 1) {
    const point = quiffPoint(position.getX(i), position.getY(i), position.getZ(i))
    position.setXYZ(i, point.x, point.y, point.z)
  }
  geometry.computeVertexNormals()
  const shell = new THREE.Mesh(geometry, shellMaterial)
  shell.castShadow = true
  group.add(shell)

  // Clumps: tapered cones sunk into the shell, each leaning along the way the hair is
  // styled — up and forward at the front edge, back over the crown.
  let state = 5
  const noise = () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
  const cone = new THREE.ConeGeometry(1, 1, 7, 1)
  cone.translate(0, 0.5, 0)
  const up = new THREE.Vector3(0, 1, 0)
  const place = (theta: number, phi: number, length: number, radius: number, forward: number): void => {
    // theta: angle round from straight ahead; phi: down from the top of the head.
    const dir = new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta))
    const root = quiffPoint(dir.x, dir.y, dir.z)
    const step = 0.02
    const normal = quiffPoint(dir.x * (1 + step), dir.y * (1 + step), dir.z * (1 + step)).sub(root).normalize()
    // Sweep: at the front, up and forward; further back, along the head toward the crown.
    const sweep = new THREE.Vector3(0, 0.75, forward).normalize()
    const axis = normal.clone().multiplyScalar(0.55).add(sweep.multiplyScalar(0.45)).normalize()
    const clump = new THREE.Mesh(cone, clumpMaterial)
    clump.quaternion.setFromUnitVectors(up, axis)
    clump.scale.set(radius, length, radius * 0.8)
    clump.position.copy(root).addScaledVector(axis, -length * 0.45)
    clump.castShadow = true
    group.add(clump)
  }
  // The front edge: a row of tufts flicked up and forward over the forehead.
  for (let i = 0; i < 9; i += 1) {
    const theta = -0.75 + (i / 8) * 1.5 + (noise() - 0.5) * 0.08
    place(theta, 1.05 + (noise() - 0.5) * 0.12, 0.15 + noise() * 0.05, 0.06 + noise() * 0.015, 0.75)
  }
  // The top: rings of clumps, leaning back toward the crown.
  for (const [phi, count, lean, length] of [
    [0.75, 13, 0.25, 0.14],
    [0.5, 10, -0.15, 0.13],
    [0.25, 6, -0.45, 0.11],
  ] as const) {
    for (let i = 0; i < count; i += 1) {
      const theta = (i / count) * Math.PI * 2 + noise() * 0.3
      // Shorter toward the back, where the top blends into the fade.
      const back = smooth(1.6, 2.8, Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))))
      place(theta, phi + (noise() - 0.5) * 0.1, length * (1 - 0.35 * back) + noise() * 0.03, 0.065 + noise() * 0.02, lean - 0.4 * back)
    }
  }
  return group
}

/** The keys on his front belt loop: a steel ring, two keys and a black car fob. */
function buildKeys(): THREE.Group {
  const keys = new THREE.Group()
  keys.name = 'persona:keys'
  const steel = litMaterial({ color: 0xcfd3da })
  const black = litMaterial({ color: 0x141518 })
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.014), steel)
  clip.position.set(0, 0.03, 0)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.007, 8, 22), steel)
  ring.position.set(0, -0.03, 0.006)
  const fob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.022), black)
  fob.position.set(-0.03, -0.1, 0.012)
  fob.rotation.z = -0.22
  const button = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.018, 0.004), steel)
  button.position.set(-0.033, -0.105, 0.025)
  button.rotation.z = -0.22
  const key = (x: number, tilt: number) => {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.075, 0.006), steel)
    blade.position.set(x, -0.1, 0.004)
    blade.rotation.z = tilt
    return blade
  }
  for (const part of [clip, ring, fob, button, key(0.018, 0.12), key(0.034, 0.3)]) {
    part.castShadow = true
    keys.add(part)
  }
  return keys
}

/**
 * Reshapes a dressed (non-indexed) mesh in bind space and gives the moved triangles
 * smooth normals of their new shape (shared corners are matched by position).
 */
function sculpt(mesh: THREE.SkinnedMesh | null, shape: (p: THREE.Vector3) => void): void {
  if (!mesh) return
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (!normal || geometry.index) return
  const p = new THREE.Vector3()
  const moved = new Set<number>()
  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i)
    const [x, y, z] = [p.x, p.y, p.z]
    shape(p)
    if (p.x !== x || p.y !== y || p.z !== z) {
      position.setXYZ(i, p.x, p.y, p.z)
      moved.add(i - (i % 3))
    }
  }
  const sums = new Map<string, THREE.Vector3>()
  const key = (i: number) =>
    `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    const face = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b))
    for (let k = 0; k < 3; k += 1) {
      const id = key(i + k)
      sums.set(id, (sums.get(id) ?? new THREE.Vector3()).add(face))
    }
  }
  for (const i of moved) {
    for (let k = 0; k < 3; k += 1) {
      const n = sums.get(key(i + k))
      if (n && n.lengthSq() > 0) {
        n.normalize()
        normal.setXYZ(i + k, n.x, n.y, n.z)
      }
    }
  }
  position.needsUpdate = true
  normal.needsUpdate = true
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
}

/**
 * A gym build, as in his photos. Arms (bind pose, out along x): the upper arm is a thin
 * tube (x 0.35–0.52, y 1.0–1.21) between the shoulder block and the forearm — it is
 * filled out into a round biceps and triceps, the deltoid capped, the forearm a touch
 * thicker. Body: the barbarian's belly (x ±0.41 at the waist) is drawn in and the chest
 * broadened with pecs under the tee, for the V of someone who trains.
 */
const ARM_AXIS_Y = 1.105

function gymArm(p: THREE.Vector3): void {
  const ax = Math.abs(p.x)
  const upper = smooth(0.3, 0.37, ax) * (1 - smooth(0.5, 0.57, ax))
  const fore = smooth(0.54, 0.6, ax) * (1 - smooth(0.72, 0.79, ax))
  const delt = smooth(0.1, 0.18, ax) * (1 - smooth(0.3, 0.37, ax))
  const peak = Math.exp(-(((ax - 0.43) / 0.065) ** 2))
  const dy = p.y - ARM_AXIS_Y
  let sy = 1 + 0.36 * upper + 0.06 * fore + 0.07 * delt
  let sz = 1 + 0.42 * upper + 0.08 * fore + 0.1 * delt
  // The biceps peaks on the front of the arm, the triceps fills the back.
  if (p.z > 0) sz += 0.22 * peak
  else sz += 0.08 * peak
  if (dy > 0) sy += 0.08 * peak
  p.y = ARM_AXIS_Y + dy * sy
  p.z *= sz
}

function gymBody(p: THREE.Vector3): void {
  const waist = smooth(0.6, 0.7, p.y) * (1 - smooth(0.86, 0.98, p.y))
  const chest = smooth(0.95, 1.06, p.y) * (1 - smooth(1.26, 1.33, p.y))
  p.x *= 1 - 0.13 * waist + 0.07 * chest
  p.z *= 1 - (p.z > 0 ? 0.14 : 0.08) * waist + 0.03 * chest
  if (p.z > 0) {
    // Pecs: two broad plates either side of the sternum, their lower edge the fullest.
    const ax = Math.abs(p.x)
    const pec = Math.exp(-(((p.y - 1.13) / 0.075) ** 2)) * smooth(0.015, 0.07, ax) * (1 - smooth(0.22, 0.31, ax))
    p.z += 0.05 * pec
  }
}

function dressTeddyz(root: THREE.Object3D): void {
  const head = findMesh(root, '_head')
  const torso = findMesh(root, '_body')
  const palette = paletteTexture()
  if (head) {
    dressTeddyzHead(head)
    bindSpaceOf(head, 'head')?.add(buildQuiff())
  }
  dress(torso, palette, teeBody)
  dress(findMesh(root, '_armleft'), palette, teeArm)
  dress(findMesh(root, '_armright'), palette, teeArm)
  dress(findMesh(root, '_legleft'), palette, teddyLeg)
  dress(findMesh(root, '_legright'), palette, teddyLeg)
  sculpt(torso, gymBody)
  sculpt(findMesh(root, '_armleft'), gymArm)
  sculpt(findMesh(root, '_armright'), gymArm)
  if (torso) {
    // On his right hip (the rig's −x), just below the hem of the untucked tee.
    const keys = buildKeys()
    keys.position.set(-0.13, 0.58, 0.375)
    keys.scale.setScalar(1.2)
    bindSpaceOf(torso, 'hips')?.add(keys)
  }
}

/* ------------------------------------------------------------------ *
 * Lecter
 * ------------------------------------------------------------------ */

// Lecter, from photos of him: copper-brown hair, thick and curly on top and pushed up
// off the forehead with a few curls falling onto it, the back and sides faded short
// above the ears; large clear glasses in thin champagne-gold frames; fair skin, dark
// brows. He runs in a brown corduroy shirt, untucked, with a pointed collar open over a
// white tee, a button placket, a patch pocket over his heart and the sleeves rolled to
// the wrist, with beige chinos and white sneakers. The rogue keeps its skeleton and every animation; its hood,
// cape, knives and bomb stay home.
//
// Measured on the rogue rig (bind pose, arms out along x): the tunic's shoulder band
// (x 0.28–0.38) is the fullest part of the upper arm, and the shirt's short sleeve covers
// it to the next loop at 0.45; the bracer and the glove's flared cuff (x 0.6–0.79) are drawn in to a
// bare forearm. The belt sits at y 0.43–0.67 with a pouch on either side, the boots
// reach y 0.15. The head: eyes y 1.54–1.67 (x ±0.14–0.27), brows are raised blocks at
// y 1.68–1.77, the nose a separate block down to its tip at z 0.52, the face flat across
// |x| < 0.22 and turning back hard beyond.
const SHIRT_HEM = 0.5
const ROGUE_SHOE_TOP = 0.145
const ROGUE_SOLE_TOP = 0.04
const ROGUE_ARM_AXIS = 1.107
/** The rolled sleeve: a turned-back band of cord, then the bare forearm and hand. */
const SLEEVE_ROLL: [number, number] = [0.655, 0.72]

const shirtArm: Classifier = (x) => {
  const reach = Math.abs(x)
  if (reach < SLEEVE_ROLL[0]) return Cell.Cord
  if (reach < SLEEVE_ROLL[1]) return Cell.CordRoll
  return Cell.Fair
}
const chinoLeg: Classifier = (_x, y) => {
  if (y < ROGUE_SOLE_TOP) return Cell.SneakerSole
  if (y < ROGUE_SHOE_TOP) return Cell.Sneaker
  return Cell.Chino
}

/** The rolled band stands a little proud of the forearm. */
function rolledSleeve(p: THREE.Vector3): void {
  const ax = Math.abs(p.x)
  const w = smooth(SLEEVE_ROLL[0] - 0.012, SLEEVE_ROLL[0] + 0.01, ax) * (1 - smooth(SLEEVE_ROLL[1] - 0.01, SLEEVE_ROLL[1] + 0.012, ax))
  if (w <= 0) return
  const k = 1 + 0.16 * w
  p.y = ROGUE_ARM_AXIS + (p.y - ROGUE_ARM_AXIS) * k
  p.z *= k
}

/** Bare forearms: the bracer and the glove's flared cuff come in to the wrist's size. */
function bareForearm(p: THREE.Vector3): void {
  const ax = Math.abs(p.x)
  const w = smooth(0.585, 0.62, ax) * (1 - smooth(0.77, 0.81, ax))
  if (w <= 0) return
  const dy = p.y - ROGUE_ARM_AXIS
  const r = Math.hypot(dy, p.z)
  const target = 0.104
  if (r <= target) return
  const k = 1 + (target / r - 1) * w
  p.y = ROGUE_ARM_AXIS + dy * k
  p.z *= k
}

/** No belt pouches: whatever stands proud of the waist is drawn back onto it. */
function flatWaist(p: THREE.Vector3): void {
  const w = smooth(0.4, 0.43, p.y) * (1 - smooth(0.665, 0.69, p.y))
  if (w <= 0) return
  const extent = (p.x / 0.386) ** 4 + (p.z / 0.33) ** 4
  if (extent <= 1.02) return
  const k = 1 + ((1.02 / extent) ** 0.25 - 1) * w
  p.x *= k
  p.z *= k
}

/** A soft oval face: the rogue's broad jaw is drawn in toward the chin. */
function ovalJaw(p: THREE.Vector3): void {
  const w = smooth(1.47, 1.24, p.y) * smooth(-0.25, 0.1, p.z)
  if (w <= 0) return
  p.x *= 1 - 0.13 * w
  p.z -= 0.015 * w * smooth(0.25, 0.45, p.z)
}

/** Connected pieces of a non-indexed mesh (corners matched by position), per triangle. */
function pieces(geometry: THREE.BufferGeometry): { piece: Int32Array; boxes: THREE.Box3[] } {
  const position = geometry.getAttribute('position')
  const triangles = Math.floor(position.count / 3)
  const parent = new Int32Array(triangles).map((_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  const owner = new Map<string, number>()
  for (let i = 0; i < position.count; i += 1) {
    const id = `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`
    const triangle = Math.floor(i / 3)
    const seen = owner.get(id)
    if (seen === undefined) owner.set(id, triangle)
    else parent[find(seen)] = find(triangle)
  }
  const index = new Map<number, number>()
  const piece = new Int32Array(triangles)
  const boxes: THREE.Box3[] = []
  const p = new THREE.Vector3()
  for (let t = 0; t < triangles; t += 1) {
    const rootOf = find(t)
    let id = index.get(rootOf)
    if (id === undefined) {
      id = boxes.length
      index.set(rootOf, id)
      boxes.push(new THREE.Box3())
    }
    piece[t] = id
    for (let k = 0; k < 3; k += 1) boxes[id].expandByPoint(p.fromBufferAttribute(position, t * 3 + k))
  }
  return { piece, boxes }
}

/** Ray-casts a bind-pose geometry: the first surface met from `origin` along `direction`. */
function prober(geometry: THREE.BufferGeometry): (origin: THREE.Vector3, direction: THREE.Vector3) => THREE.Vector3 | null {
  const probe = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  probe.updateMatrixWorld(true)
  const ray = new THREE.Raycaster()
  return (origin, direction) => {
    ray.set(origin, direction.clone().normalize())
    const hit = ray.intersectObject(probe, false)[0]
    return hit ? hit.point.clone() : null
  }
}

const LECTER_SKIN_SHIFT = [1.0, 1.07, 1.12] as const
/** His hair: a deep copper brown, a shade darker and redder than the rogue's auburn. */
const COPPER = { dark: [60, 20, 12], light: [146, 60, 36] } as const
/**
 * The faded back and sides, painted on a strip of the head's texture below the face patch.
 * Columns run from the front (centre) to the back by angle, the same on both sides, so no
 * triangle straddles a seam at the nape.
 */
const FADE = { top: 700, scale: 380, ceiling: 1.95, centre: 512, spread: 500 } as const
const fadeU = (x: number, z: number): number => FADE.centre + (Math.abs(Math.atan2(x, z)) / Math.PI) * FADE.spread
const fadeV = (y: number): number => FADE.top + (FADE.ceiling - y) * FADE.scale

type HeadPiece = 'main' | 'brow' | 'eye' | 'nose' | 'earring' | 'ear' | 'other'

/**
 * Lecter's head. The rogue's hair is already short and close to the skull, so it keeps
 * its sculpt and only deepens from auburn to copper brown; below the curls its back and
 * sides take a skin fade, painted on a strip of its own. The curly top goes over it
 * (see buildLecterHair). The face is redrawn on a front-projected
 * patch, the brow blocks fold away behind the forehead (his brows are painted), the
 * earrings go, and the jaw is drawn in to a soft oval. Returns a probe of the finished
 * head surface, for fitting the hair and the glasses to it.
 */
function dressLecterHead(head: THREE.SkinnedMesh): { probe: ReturnType<typeof prober>; earring: THREE.Vector3 | null } | null {
  const material = head.material as THREE.MeshStandardMaterial
  if (!material.map) return null
  const copy = editableCopy(material.map)
  if (!copy) return null
  const { texture, ctx } = copy
  const { width, height } = ctx.canvas
  const pixels = ctx.getImageData(0, 0, width, height)
  const data = pixels.data
  const hairMask = new Uint8Array(width * height)
  for (let at = 0; at < data.length; at += 4) {
    const r = data[at]
    const g = data[at + 1]
    const b = data[at + 2]
    if (r > 200 && g > 140 && b > 100) {
      // Skin: a little paler and less orange.
      for (let c = 0; c < 3; c += 1) data[at + c] = Math.min(255, Math.round(data[at + c] * LECTER_SKIN_SHIFT[c]))
    } else if (r > 100 && r < 190 && r - g > 40 && g - b > 5) {
      // Hair: the auburn gradient (r 120–175) becomes copper brown, keeping its shading.
      const t = Math.min(1, Math.max(0, (r - 120) / 55))
      for (let c = 0; c < 3; c += 1) data[at + c] = Math.round(COPPER.dark[c] + (COPPER.light[c] - COPPER.dark[c]) * t)
      hairMask[at / 4] = 1
    }
  }
  ctx.putImageData(pixels, 0, 0)
  const texel = (u: number, v: number): [number, number, number] => {
    const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)))
    const py = Math.min(height - 1, Math.max(0, Math.floor(v * height)))
    const at = (py * width + px) * 4
    return [data[at], data[at + 1], data[at + 2]]
  }
  const isSkin = ([r, g, b]: [number, number, number]) => r > 200 && g > 150 && b > 110
  const isHair = (u: number, v: number): boolean =>
    hairMask[
      Math.min(height - 1, Math.max(0, Math.floor(v * height))) * width +
        Math.min(width - 1, Math.max(0, Math.floor(u * width)))
    ] === 1

  const geometry = head.geometry.index ? head.geometry.toNonIndexed() : head.geometry.clone()
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv || !normal) return null

  const { piece, boxes } = pieces(geometry)
  const centre = new THREE.Vector3()
  const size = new THREE.Vector3()
  const kinds: HeadPiece[] = boxes.map((box) => {
    box.getCenter(centre)
    box.getSize(size)
    const ax = Math.abs(centre.x)
    if (size.x > 0.6) return 'main'
    if (centre.z > 0.3 && centre.y > 1.68 && centre.y < 1.78 && ax > 0.12 && ax < 0.28) return 'brow'
    if (centre.z > 0.3 && centre.y > 1.56 && centre.y < 1.65 && ax > 0.14 && ax < 0.27) return 'eye'
    if (centre.z > 0.3 && ax < 0.03) return 'nose'
    if (ax > 0.42 && centre.y < 1.5 && size.y < 0.15) return 'earring'
    if (ax > 0.4 && centre.y > 1.36 && centre.y < 1.7) return 'ear'
    return 'other'
  })

  const forehead = [0, 0, 0, 0]
  const chin = [0, 0, 0, 0]
  const faceTriangles: number[] = []
  const fadeTriangles: number[] = []
  // The rig's two earrings come off; he wears one small dark hoop, in his left ear.
  const earring = new THREE.Vector3()
  let earringCorners = 0
  for (let i = 0; i + 2 < position.count; i += 3) {
    const kind = kinds[piece[i / 3]]
    let x = 0
    let y = 0
    let z = 0
    let nz = 0
    let u = 0
    let v = 0
    for (let k = 0; k < 3; k += 1) {
      x += position.getX(i + k) / 3
      y += position.getY(i + k) / 3
      z += position.getZ(i + k) / 3
      nz += normal.getZ(i + k) / 3
      u += uv.getX(i + k) / 3
      v += uv.getY(i + k) / 3
    }
    if (kind === 'earring') {
      for (let k = 0; k < 3; k += 1) {
        // Where his own hoop goes: the left one's place, tucked in with the ear.
        if (x > 0) {
          earring.x += position.getX(i + k) - 0.05
          earring.y += position.getY(i + k)
          earring.z += position.getZ(i + k)
          earringCorners += 1
        }
        position.setXYZ(i + k, x - Math.sign(x) * 0.12, y, z)
      }
      continue
    }
    if (kind === 'ear') {
      // Ears tucked in against the closer crop.
      for (let k = 0; k < 3; k += 1) position.setX(i + k, position.getX(i + k) - Math.sign(x) * 0.05)
      continue
    }
    if (kind === 'brow') {
      for (let k = 0; k < 3; k += 1) position.setZ(i + k, position.getZ(i + k) - 0.07)
      continue
    }
    if (kind === 'eye' || kind === 'nose') {
      faceTriangles.push(i)
      continue
    }
    if (kind !== 'main') continue
    if (isHair(u, v) && y < 1.88) {
      // The rogue's fringe becomes forehead: his hair is swept up off a high, open brow.
      if (z > 0.28 && Math.abs(x) < 0.36 && y < 1.83) faceTriangles.push(i)
      // Below the curls the hair is faded short.
      else if (!(z > 0.28 && Math.abs(x) < 0.3)) fadeTriangles.push(i)
      continue
    }
    const colour = texel(u, v)
    if (isSkin(colour) && nz > 0.3 && z > 0.2 && Math.abs(x) < 0.45 && y > FACE.bottom && y < FACE.ceiling) {
      faceTriangles.push(i)
      if (Math.abs(x) < 0.3) {
        const into = y > 1.68 ? forehead : y < 1.36 ? chin : null
        if (into) {
          into[0] += colour[0]
          into[1] += colour[1]
          into[2] += colour[2]
          into[3] += 1
        }
      }
    }
  }
  const tone = (sum: number[], fallback: string) =>
    sum[3] ? `rgb(${Math.round(sum[0] / sum[3])},${Math.round(sum[1] / sum[3])},${Math.round(sum[2] / sum[3])})` : fallback
  paintLecterFace(ctx, tone(forehead, '#f6cdb0'), tone(chin, '#f1bf9f'))
  paintFade(ctx, forehead[3] ? [forehead[0] / forehead[3], forehead[1] / forehead[3], forehead[2] / forehead[3]] : [246, 205, 176])
  texture.needsUpdate = true

  for (const i of fadeTriangles) {
    for (let k = 0; k < 3; k += 1) {
      const at = i + k
      uv.setXY(at, fadeU(position.getX(at), position.getZ(at)) / width, fadeV(position.getY(at)) / height)
    }
  }

  for (const i of faceTriangles) {
    for (let k = 0; k < 3; k += 1) {
      uv.setXY(i + k, faceU(position.getX(i + k)) / width, faceV(position.getY(i + k)) / height)
    }
  }
  uv.needsUpdate = true
  position.needsUpdate = true
  head.geometry = geometry
  sculpt(head, ovalJaw)
  sculpt(head, shortCrop)
  material.map = texture
  material.emissiveMap = texture
  material.needsUpdate = true
  return { probe: prober(geometry), earring: earringCorners ? earring.divideScalar(earringCorners) : null }
}

/**
 * Cuts the rogue's long hair down to a short crop: the tall crown is pressed down toward
 * the skull, the back is drawn in, and the hair that hung over the nape is tapered into
 * the neck. A pure function of position, so seams between pieces stay closed.
 */
function shortCrop(p: THREE.Vector3): void {
  if (p.y > 1.84) p.y = 1.84 + (p.y - 1.84) * 0.4
  // A close crop like Tim's: the crown narrower, the back of the head drawn in tight.
  p.x *= 1 - 0.1 * smooth(1.74, 2.0, p.y)
  p.x *= 1 - 0.13 * smooth(0.15, -0.25, p.z) * smooth(1.25, 1.45, p.y)
  if (p.z < -0.1) p.z *= 1 - 0.2 * smooth(-0.1, -0.45, p.z)
  const nape = smooth(1.62, 1.2, p.y) * smooth(-0.05, -0.3, p.z)
  p.z *= 1 - 0.3 * nape
  p.x *= 1 - 0.16 * nape
}

/**
 * The undercut: the back and sides clippered right down, so they read as skin with a
 * faint copper shadow of stubble, up to a crisp line under the overhanging top, and
 * fading to clean skin at the nape and under the ears. Rows run with height (fadeV),
 * columns around the head (fadeU).
 */
function paintFade(ctx: CanvasRenderingContext2D, skin: number[]): void {
  const width = ctx.canvas.width
  const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((v, k) => v + (b[k] - v) * t)
  const shadow = mix(skin, [140, 108, 96], 0.3)
  // Clippered to a shadow: skin with a little of his copper through it.
  const buzz = mix(skin, COPPER.dark, 0.24)
  const hair = mix(COPPER.dark, COPPER.light, 0.2)
  // How far round toward the back a column is.
  const backness = (px: number) => smooth(0.45, 0.9, Math.abs(px - FADE.centre) / FADE.spread)
  // Where the shadow of stubble gives way to clean skin: low at the nape and round
  // under the ears.
  const start = (px: number) => 1.5 - 0.08 * backness(px)
  const top = Math.floor(fadeV(FADE.ceiling))
  const bottom = Math.min(ctx.canvas.height, Math.ceil(fadeV(1.1)))
  const image = ctx.getImageData(0, top, width, bottom - top)
  for (let px = 0; px < width; px += 1) {
    const lo = start(px)
    for (let row = top; row < bottom; row += 1) {
      const y = FADE.ceiling - (row - FADE.top) / FADE.scale
      const short = mix(shadow, buzz, smooth(lo - 0.04, lo + 0.08, y))
      // Under the top's overhang, the line of the undercut.
      const colour = mix(short, hair, smooth(1.88, 1.91, y))
      const at = ((row - top) * width + px) * 4
      image.data[at] = colour[0]
      image.data[at + 1] = colour[1]
      image.data[at + 2] = colour[2]
      image.data[at + 3] = 255
    }
  }
  ctx.putImageData(image, 0, top)
  // Stubble: fine dark specks, thicker toward the top of the fade.
  let state = 29
  const noise = () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
  for (let i = 0; i < 16000; i += 1) {
    const y = 1.35 + noise() * 0.55
    const x = FADE.centre + noise() * FADE.spread
    const lo = start(x)
    if (noise() > 0.1 + 0.9 * smooth(lo - 0.06, lo + 0.1, y)) continue
    ctx.fillStyle = `rgba(${COPPER.dark.join(',')},${(0.12 + noise() * 0.22).toFixed(2)})`
    ctx.fillRect(x, fadeV(y), 2, 2)
  }
}

/**
 * Lecter as in the portrait: soft dark-brown brows, big warm brown eyes, a small
 * straight nose, rosy cheeks and a wide smile showing his top teeth.
 */
function paintLecterFace(ctx: CanvasRenderingContext2D, top: string, bottom: string): void {
  const u = faceU
  const v = faceV
  const s = FACE.scale
  const left = u(-FACE.half)
  const right = u(FACE.half)
  const skin = ctx.createLinearGradient(0, v(1.75), 0, v(1.3))
  skin.addColorStop(0, top)
  skin.addColorStop(1, bottom)
  ctx.fillStyle = skin
  ctx.fillRect(left, v(FACE.ceiling + 0.05), right - left, v(FACE.bottom - 0.05) - v(FACE.ceiling + 0.05))

  const glow = (x: number, y: number, radius: number, colour: string, alpha: number) => {
    const g = ctx.createRadialGradient(u(x), v(y), 0, u(x), v(y), radius * s)
    g.addColorStop(0, `rgba(${colour},${alpha})`)
    g.addColorStop(1, `rgba(${colour},0)`)
    ctx.fillStyle = g
    ctx.fillRect(u(x) - radius * s, v(y) - radius * s, radius * 2 * s, radius * 2 * s)
  }
  // A faint warmth on the cheeks; shade under the nose and the lower lip.
  for (const side of [-1, 1]) glow(side * 0.28, 1.465, 0.11, '236,140,130', 0.3)
  glow(0, 1.452, 0.05, '176,108,88', 0.3)
  for (const side of [-1, 1]) glow(side * 0.033, 1.452, 0.014, '150,84,70', 0.45)
  glow(0, 1.318, 0.05, '190,120,100', 0.18)

  // Brows: dark brown, soft-edged, fuller at the inner end and lifting a little at the
  // outer third.
  ctx.fillStyle = '#33201a'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(u(side * 0.075), v(1.699))
    ctx.quadraticCurveTo(u(side * 0.07), v(1.72), u(side * 0.082), v(1.733))
    ctx.quadraticCurveTo(u(side * 0.2), v(1.75), u(side * 0.3), v(1.732))
    ctx.quadraticCurveTo(u(side * 0.312), v(1.722), u(side * 0.298), v(1.716))
    ctx.quadraticCurveTo(u(side * 0.19), v(1.71), u(side * 0.075), v(1.699))
    ctx.closePath()
    ctx.fill()
  }

  // Eyes: almond-shaped, dark brown irises under a defined upper lid, a soft fold below.
  for (const side of [-1, 1]) {
    const inner = side * 0.142
    const outer = side * 0.268
    const mid = side * 0.204
    const lid = () => {
      ctx.beginPath()
      ctx.moveTo(u(inner), v(1.598))
      ctx.quadraticCurveTo(u(mid - side * 0.01), v(1.664), u(outer), v(1.61))
      ctx.quadraticCurveTo(u(mid + side * 0.01), v(1.556), u(inner), v(1.598))
      ctx.closePath()
    }
    ctx.save()
    lid()
    ctx.fillStyle = '#f6f1ea'
    ctx.fill()
    ctx.clip()
    const cx = u(mid - side * 0.004)
    const cy = v(1.604)
    const iris = ctx.createRadialGradient(cx, cy - 0.012 * s, 0, cx, cy, 0.036 * s)
    iris.addColorStop(0, '#7a4a2c')
    iris.addColorStop(0.7, '#4a2b1a')
    iris.addColorStop(1, '#1d110a')
    ctx.fillStyle = iris
    ctx.beginPath()
    ctx.arc(cx, cy, 0.04 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#0a0706'
    ctx.beginPath()
    ctx.arc(cx, cy, 0.016 * s, 0, Math.PI * 2)
    ctx.fill()
    // The upper lid's shadow across the top of the eye.
    ctx.fillStyle = 'rgba(60,35,28,0.28)'
    ctx.fillRect(u(Math.min(inner, outer)) - 4, v(1.66), Math.abs(u(outer) - u(inner)) + 8, 0.022 * s)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(cx + side * 0.011 * s, cy - 0.013 * s, 0.009 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // Upper lash line, heavier toward the outer corner.
    ctx.strokeStyle = '#150f0c'
    ctx.lineCap = 'round'
    ctx.lineWidth = 0.011 * s
    ctx.beginPath()
    ctx.moveTo(u(inner), v(1.598))
    ctx.quadraticCurveTo(u(mid - side * 0.01), v(1.664), u(outer), v(1.61))
    ctx.stroke()
    ctx.lineWidth = 0.009 * s
    ctx.beginPath()
    ctx.moveTo(u(outer - side * 0.03), v(1.627))
    ctx.lineTo(u(outer + side * 0.012), v(1.614))
    ctx.stroke()
    // A thin lid crease above, and the soft lower lid.
    ctx.strokeStyle = 'rgba(150,92,74,0.4)'
    ctx.lineWidth = 0.005 * s
    ctx.beginPath()
    ctx.moveTo(u(inner + side * 0.012), v(1.626))
    ctx.quadraticCurveTo(u(mid), v(1.668), u(outer - side * 0.004), v(1.632))
    ctx.stroke()
    ctx.strokeStyle = 'rgba(110,64,52,0.5)'
    ctx.lineWidth = 0.005 * s
    ctx.beginPath()
    ctx.moveTo(u(inner + side * 0.01), v(1.594))
    ctx.quadraticCurveTo(u(mid + side * 0.01), v(1.571), u(outer - side * 0.004), v(1.606))
    ctx.stroke()
    // A soft fold under each eye.
    ctx.strokeStyle = 'rgba(170,108,92,0.18)'
    ctx.lineWidth = 0.006 * s
    ctx.beginPath()
    ctx.moveTo(u(inner + side * 0.02), v(1.574))
    ctx.quadraticCurveTo(u(mid + side * 0.01), v(1.551), u(outer - side * 0.01), v(1.583))
    ctx.stroke()
  }

  // A wide, warm smile showing his top teeth: the corners lifted, a full pink lower lip.
  const my = 1.372
  const hw = 0.1
  const mouth = () => {
    ctx.beginPath()
    ctx.moveTo(u(-hw), v(my + 0.014))
    ctx.quadraticCurveTo(u(0), v(my - 0.004), u(hw), v(my + 0.014))
    ctx.quadraticCurveTo(u(0), v(my - 0.078), u(-hw), v(my + 0.014))
    ctx.closePath()
  }
  // The lower lip, just under the opening.
  ctx.fillStyle = '#d88e86'
  ctx.beginPath()
  ctx.moveTo(u(-hw * 0.82), v(my))
  ctx.quadraticCurveTo(u(0), v(my - 0.098), u(hw * 0.82), v(my))
  ctx.quadraticCurveTo(u(0), v(my - 0.06), u(-hw * 0.82), v(my))
  ctx.closePath()
  ctx.fill()
  ctx.save()
  mouth()
  ctx.fillStyle = '#5a2421'
  ctx.fill()
  ctx.clip()
  // Top teeth across the upper part, a hint of tongue at the bottom.
  ctx.fillStyle = '#fbf7f1'
  ctx.beginPath()
  ctx.moveTo(u(-hw), v(my + 0.014))
  ctx.quadraticCurveTo(u(0), v(my - 0.004), u(hw), v(my + 0.014))
  ctx.quadraticCurveTo(u(0), v(my - 0.05), u(-hw), v(my + 0.014))
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(190,175,165,0.7)'
  ctx.lineWidth = 0.003 * s
  for (const x of [-0.06, -0.03, 0, 0.03, 0.06]) {
    ctx.beginPath()
    ctx.moveTo(u(x), v(my + 0.01))
    ctx.lineTo(u(x), v(my - 0.022 + Math.abs(x) * 0.2))
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(200,96,98,0.75)'
  ctx.beginPath()
  ctx.ellipse(u(0), v(my - 0.04), 0.045 * s, 0.012 * s, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  // The upper lip's line, and the lifted corners.
  ctx.strokeStyle = '#a65c55'
  ctx.lineCap = 'round'
  ctx.lineWidth = 0.006 * s
  mouth()
  ctx.stroke()
  ctx.strokeStyle = 'rgba(160,90,78,0.5)'
  ctx.lineWidth = 0.005 * s
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(u(side * (hw - 0.004)), v(my + 0.012))
    ctx.quadraticCurveTo(u(side * (hw + 0.016)), v(my + 0.018), u(side * (hw + 0.02)), v(my + 0.034))
    ctx.stroke()
  }
}

/* Hair, glasses, collar --------------------------------------------- */

const HAIR_CENTRE = new THREE.Vector3(0, 1.8, 0)
const HAIR_RADII = new THREE.Vector3(0.5, 0.39, 0.5)

/** Tapered locks of hair along paths, merged into one geometry. */
class Locks {
  private positions: number[] = []
  private uvs: number[] = []
  private indices: number[] = []

  add(path: THREE.Vector3[], width: number, thickness: number, rings = 10, sides = 6): void {
    const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal')
    const base = this.positions.length / 3
    const out = new THREE.Vector3()
    const side = new THREE.Vector3()
    for (let i = 0; i <= rings; i += 1) {
      const t = i / rings
      const p = curve.getPoint(t)
      const tangent = curve.getTangent(t)
      out.subVectors(p, HAIR_CENTRE).normalize()
      out.addScaledVector(tangent, -out.dot(tangent)).normalize()
      side.crossVectors(tangent, out).normalize()
      // Full at the root, swelling a touch, then tapering to a point.
      const taper = Math.min(1, 0.85 + t * 1.2) * (1 - t) ** 0.55
      const w = width * taper + 0.002
      const h = thickness * taper + 0.0015
      for (let j = 0; j <= sides; j += 1) {
        const a = (j / sides) * Math.PI * 2
        this.positions.push(
          p.x + side.x * Math.cos(a) * w + out.x * Math.sin(a) * h,
          p.y + side.y * Math.cos(a) * w + out.y * Math.sin(a) * h,
          p.z + side.z * Math.cos(a) * w + out.z * Math.sin(a) * h
        )
        this.uvs.push(j / sides, t)
      }
    }
    for (let i = 0; i < rings; i += 1) {
      for (let j = 0; j < sides; j += 1) {
        const a = base + i * (sides + 1) + j
        const b = a + sides + 1
        this.indices.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    geometry.setIndex(this.indices)
    geometry.computeVertexNormals()
    return geometry
  }
}

type Probe = ReturnType<typeof prober>

/**
 * His hair, as in the portrait: a full, textured top of thick auburn waves, swept up off
 * the forehead into a tousled quiff that leans toward his right, over an undercut (the
 * back and sides clippered right down: see dressLecterHead, paintFade and shortCrop).
 * Each wave is a chunky tapered lock rising off the scalp and arcing over, its root fitted
 * to the rogue's own hair by probing it; light and dark locks alternate for depth.
 */
function buildLecterHair(probe: Probe): THREE.Group {
  let state = 23
  const noise = () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
  const radial = (theta: number, phi: number, lift: number): THREE.Vector3 => {
    const dir = new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta))
    const fallback = new THREE.Vector3(dir.x * HAIR_RADII.x, dir.y * HAIR_RADII.y, dir.z * HAIR_RADII.z).add(HAIR_CENTRE)
    const hit = probe(dir.clone().multiplyScalar(1.5).add(HAIR_CENTRE), dir.clone().negate()) ?? fallback
    return hit.addScaledVector(dir, lift)
  }
  const light = new Locks()
  const dark = new Locks()
  const up = new THREE.Vector3()
  const along = new THREE.Vector3()
  const across = new THREE.Vector3()

  /**
   * A wave rooted at (theta, phi): up out of the scalp by `height`, then along `heading`
   * for `length`, rolling over at the tip, with a little sideways S in it.
   */
  const wave = (theta: number, phi: number, heading: THREE.Vector3, height: number, length: number, width: number): void => {
    const root = radial(theta, phi, -0.015)
    up.subVectors(root, HAIR_CENTRE).normalize()
    along.copy(heading).addScaledVector(up, -heading.dot(up))
    if (along.lengthSq() < 1e-6) along.set(0, 0, 1).addScaledVector(up, -up.z)
    along.normalize().applyAxisAngle(up, (noise() - 0.5) * 0.5)
    across.crossVectors(up, along).multiplyScalar((noise() - 0.5) * 0.5 * length)
    const at = (rise: number, run: number, side: number) =>
      root.clone().addScaledVector(up, rise * height).addScaledVector(along, run * length).addScaledVector(across, side)
    const path = [at(0, 0, 0), at(0.6, 0.18, 0.15), at(0.95, 0.5, 0.5), at(1, 0.78, 0.2), at(0.78, 1, -0.2)]
    ;(noise() < 0.4 ? light : dark).add(path, width, width * 0.62, 10, 6)
  }

  // Where the top ends and the undercut begins: low at the front hairline, high over the
  // ears and round the back.
  const reach = (theta: number) => 1.4 - 0.16 * smooth(0.5, 1.4, Math.abs(theta)) - 0.12 * smooth(1.8, 3.0, Math.abs(theta))
  const count = 230
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i += 1) {
    const phi = Math.acos(1 - ((i + 0.5) / count) * (1 - Math.cos(1.38)))
    const theta = Math.atan2(Math.sin(i * golden), Math.cos(i * golden))
    if (phi > reach(theta)) continue
    // Everything sweeps forward and up toward the front of the crown and over to his
    // right; the front stands tallest, the back lies flatter.
    const front = Math.max(0, Math.cos(theta))
    const heading = new THREE.Vector3(-0.4, 0.9, 0.35).multiplyScalar(front).add(new THREE.Vector3(-0.25, 0.4, 1).multiplyScalar(1 - front))
    const height = (0.026 + 0.04 * front * front) * (0.85 + noise() * 0.3)
    const length = (0.1 + 0.03 * front) * (0.85 + noise() * 0.35)
    wave(theta, phi, heading, height, length, 0.05 + noise() * 0.015)
  }
  // The quiff: a few bigger waves along the front hairline, standing up off the brow and
  // tumbling over toward his right.
  for (let x = -0.24; x <= 0.24; x += 0.08) {
    const theta = Math.asin(x / 0.47)
    wave(theta, 1.29 - 0.06 * Math.abs(x), new THREE.Vector3(-0.55, 1, 0.15), 0.075 + noise() * 0.015, 0.12 + noise() * 0.03, 0.062)
  }

  const group = new THREE.Group()
  group.name = 'persona:waves'
  for (const [locks, base, glint, shade, seed] of [
    [light, '#8a3d27', 'rgba(214,122,84,0.55)', 'rgba(62,20,10,0.5)', 41],
    [dark, '#5e2318', 'rgba(168,78,50,0.5)', 'rgba(30,8,4,0.6)', 43],
  ] as const) {
    const material = litMaterial({ map: hairStrands(base, glint, shade, seed) })
    material.roughness = 0.6
    const mesh = new THREE.Mesh(locks.build(), material)
    mesh.castShadow = true
    group.add(mesh)
  }
  return group
}

/** His one earring: a small dark steel hoop through the left lobe. */
function buildHoop(at: THREE.Vector3): THREE.Mesh {
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2b30, metalness: 0.7, roughness: 0.3 })
  steel.emissive = new THREE.Color(0x15161a)
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0065, 8, 24), steel)
  hoop.name = 'persona:earring'
  hoop.position.copy(at)
  // Hanging flat against the side of the head.
  hoop.rotation.y = Math.PI / 2
  return hoop
}

/** The clear lenses: faintly cool glass with a soft diagonal glint. */
function lensTexture(): THREE.CanvasTexture {
  const { canvas: element, ctx } = canvas(64, 64)
  ctx.fillStyle = 'rgba(226,238,250,0.13)'
  ctx.fillRect(0, 0, 64, 64)
  ctx.strokeStyle = 'rgba(255,255,255,0.42)'
  ctx.lineCap = 'round'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(14, 18)
  ctx.lineTo(30, 4)
  ctx.stroke()
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(22, 30)
  ctx.lineTo(44, 10)
  ctx.stroke()
  return textureOf(element)
}

/**
 * Clear glasses in thin champagne-gold frames: large soft squares with well-rounded corners, a fine
 * bridge over the nose and temples running back over the hair to the ears. Fitted to
 * the face by probing it, so the lenses clear the eyes and the temples clear the head.
 */
function buildGlasses(probe: Probe): THREE.Group {
  const group = new THREE.Group()
  group.name = 'persona:glasses'
  const frame = new THREE.MeshStandardMaterial({ color: 0xdccaa0, metalness: 0.55, roughness: 0.28 })
  frame.emissive = new THREE.Color(0xb39f78)
  frame.emissiveIntensity = 0.3
  const glass = new THREE.MeshStandardMaterial({
    map: lensTexture(),
    transparent: true,
    depthWrite: false,
    roughness: 0.05,
    metalness: 0,
    side: THREE.DoubleSide,
  })

  const lens = { y: 1.6, x: 0.208, hw: 0.112, hh: 0.084 }
  const faceZ = (x: number, y: number): number =>
    probe(new THREE.Vector3(x, y, 1.5), new THREE.Vector3(0, 0, -1))?.z ?? 0.44
  // A gentle wrap, and never closer than 3 cm to the face behind.
  const lensZ = (x: number, y: number): number =>
    Math.max(0.478 - 2.6 * Math.max(0, Math.abs(x) - 0.17) ** 2, faceZ(x, y) + 0.03)

  for (const side of [-1, 1]) {
    const cx = side * lens.x
    const outline: THREE.Vector3[] = []
    const count = 48
    for (let i = 0; i < count; i += 1) {
      // A rounded rectangle traced by angle (superellipse), top a little flatter.
      const a = (i / count) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      const px = Math.sign(c) * Math.abs(c) ** 0.5 * lens.hw
      const py = Math.sign(s) * Math.abs(s) ** (s > 0 ? 0.42 : 0.56) * lens.hh
      outline.push(new THREE.Vector3(cx + px, lens.y + py, 0))
    }
    for (const point of outline) point.z = lensZ(point.x, point.y)
    const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline, true), 72, 0.0085, 6, true), frame)
    rim.castShadow = true
    group.add(rim)

    const positions: number[] = [cx, lens.y, lensZ(cx, lens.y)]
    const uvs: number[] = [0.5, 0.5]
    for (const point of outline) {
      positions.push(point.x, point.y, point.z)
      uvs.push(0.5 + (point.x - cx) / (2 * lens.hw), 0.5 + (point.y - lens.y) / (2 * lens.hh))
    }
    const indices: number[] = []
    for (let i = 0; i < count; i += 1) indices.push(0, 1 + i, 1 + ((i + 1) % count))
    const pane = new THREE.BufferGeometry()
    pane.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    pane.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    pane.setIndex(indices)
    pane.computeVertexNormals()
    const paneMesh = new THREE.Mesh(pane, glass)
    paneMesh.renderOrder = 2
    group.add(paneMesh)

    // Temple: from the outer top corner, back along the side of the head.
    const y = lens.y + lens.hh * 0.62
    const corner = new THREE.Vector3(side * (lens.x + lens.hw - 0.004), y, lensZ(side * (lens.x + lens.hw), y))
    const path = [corner]
    for (const z of [corner.z - 0.05, 0.32, 0.22, 0.12, 0.03, -0.04]) {
      const hit = probe(new THREE.Vector3(side * 1.5, y, z), new THREE.Vector3(-side, 0, 0))
      const x = hit ? hit.x + side * 0.02 : side * 0.5
      path.push(new THREE.Vector3(side * Math.max(Math.abs(x), Math.abs(path[path.length - 1].x)), y - 0.004 * path.length, z))
    }
    const temple = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), 24, 0.008, 6, false), frame)
    temple.castShadow = true
    group.add(temple)
    const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.026, 0.03), frame)
    hinge.position.copy(corner).add(new THREE.Vector3(0, 0, -0.012))
    group.add(hinge)
  }
  // The bridge, arched a little over the nose.
  const bridgeY = lens.y + lens.hh * 0.55
  const inner = lens.x - lens.hw + 0.004
  const bridge = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-inner, bridgeY, lensZ(-inner, bridgeY)),
    new THREE.Vector3(0, bridgeY + 0.012, Math.max(0.49, faceZ(0, bridgeY + 0.012) + 0.03)),
    new THREE.Vector3(inner, bridgeY, lensZ(inner, bridgeY)),
  ])
  group.add(new THREE.Mesh(new THREE.TubeGeometry(bridge, 16, 0.0075, 6, false), frame))
  return group
}

/* The shirt -------------------------------------------------------- */

const CORD_BROWN = hex(CORD)
const CHINO_BEIGE = hex(CHINO)
/**
 * The shirt's texture: three planar panels, front (looking at him), back (from behind)
 * and side, each 480 px to the metre across x (or z) and down from y 1.4. The tops of
 * the chinos are painted below the shirt's hem on the same panels.
 */
const SHIRT_PANEL = { scale: 480, half: 0.53, ceiling: 1.4 } as const
type ShirtPanel = 'front' | 'back' | 'side'
const SHIRT_ORIGIN: Record<ShirtPanel, [number, number]> = { front: [0, 0], back: [512, 0], side: [0, 512] }
const shirtPx = (panel: ShirtPanel, across: number, y: number): [number, number] => [
  SHIRT_ORIGIN[panel][0] + (across + SHIRT_PANEL.half) * SHIRT_PANEL.scale,
  SHIRT_ORIGIN[panel][1] + (SHIRT_PANEL.ceiling - y) * SHIRT_PANEL.scale,
]

/** A dashed line of stitching. */
function stitch(ctx: CanvasRenderingContext2D, points: [number, number][], colour: string, width: number): void {
  ctx.save()
  ctx.strokeStyle = colour
  ctx.lineWidth = width
  ctx.setLineDash([width * 2.2, width * 1.6])
  ctx.beginPath()
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.stroke()
  ctx.restore()
}

/** Fine vertical ribs of corduroy over a rectangle: a dark groove and a lit crest each. */
function wales(ctx: CanvasRenderingContext2D, x0: number, y0: number, width: number, height: number): void {
  for (let x = x0; x < x0 + width; x += 6) {
    ctx.fillStyle = 'rgba(30,16,6,0.2)'
    ctx.fillRect(x, y0, 2, height)
    ctx.fillStyle = 'rgba(255,220,180,0.06)'
    ctx.fillRect(x + 3, y0, 2, height)
  }
}

function paintShirt(): THREE.CanvasTexture {
  const { canvas: element, ctx } = canvas(1024, 1024)
  ctx.fillStyle = CORD_BROWN
  ctx.fillRect(0, 0, 1024, 1024)
  const m = SHIRT_PANEL.scale
  const seam = 'rgba(40,22,10,0.55)'
  const thread = 'rgba(150,105,70,0.75)'
  for (const panel of ['front', 'back', 'side'] as const) {
    const [left, top] = SHIRT_ORIGIN[panel]
    const hem = shirtPx(panel, 0, SHIRT_HEM)[1]
    wales(ctx, left, top, 512, hem - top)
    // A soft fall of light down the shirt.
    const shade = ctx.createLinearGradient(0, top, 0, hem)
    shade.addColorStop(0, 'rgba(255,235,210,0.07)')
    shade.addColorStop(1, 'rgba(20,10,0,0.14)')
    ctx.fillStyle = shade
    ctx.fillRect(left, top, 512, hem - top)
    // Below the untucked hem: the chinos, in the shirt's shadow at first.
    ctx.fillStyle = CHINO_BEIGE
    ctx.fillRect(left, hem, 512, top + 512 - hem)
    const under = ctx.createLinearGradient(0, hem, 0, hem + 0.06 * m)
    under.addColorStop(0, 'rgba(40,25,10,0.4)')
    under.addColorStop(1, 'rgba(40,25,10,0)')
    ctx.fillStyle = under
    ctx.fillRect(left, hem, 512, 0.06 * m)
    // The hem itself, turned and stitched.
    ctx.fillStyle = 'rgba(35,18,6,0.35)'
    ctx.fillRect(left, hem - 0.01 * m, 512, 0.01 * m)
    stitch(ctx, [[left, hem - 0.018 * m], [left + 512, hem - 0.018 * m]], thread, 1.4)
    if (panel === 'side') {
      const [sx] = shirtPx(panel, 0, 0)
      const [, armpit] = shirtPx(panel, 0, 1.16)
      ctx.fillStyle = seam
      ctx.fillRect(sx - 1, armpit, 2, hem - armpit)
      // The chinos' side seam.
      ctx.fillStyle = 'rgba(90,70,40,0.45)'
      ctx.fillRect(sx - 1, hem, 2, top + 512 - hem)
    }
  }

  // Front: an open neck with a white tee showing, the button placket down the middle,
  // and a patch pocket over his heart (right of the picture).
  {
    const [cx, top] = shirtPx('front', 0, 1.27)
    const [, tip] = shirtPx('front', 0, 1.15)
    const w = 0.07 * m
    ctx.fillStyle = 'rgba(30,15,5,0.5)'
    ctx.beginPath()
    ctx.moveTo(cx - w - 3, top)
    ctx.lineTo(cx, tip + 3)
    ctx.lineTo(cx + w + 3, top)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#f2efe8'
    ctx.beginPath()
    ctx.moveTo(cx - w, top)
    ctx.lineTo(cx, tip)
    ctx.lineTo(cx + w, top)
    ctx.closePath()
    ctx.fill()
    // The tee's crew neck across the top of the V.
    ctx.fillStyle = 'rgba(200,190,175,0.9)'
    ctx.fillRect(cx - w * 0.8, top, w * 1.6, 0.012 * m)
  }
  {
    const [cx, top] = shirtPx('front', 0, 1.15)
    const [, bottom] = shirtPx('front', 0, SHIRT_HEM)
    const half = 0.018 * m
    ctx.fillStyle = 'rgba(255,225,190,0.05)'
    ctx.fillRect(cx - half, top, half * 2, bottom - top)
    ctx.fillStyle = seam
    ctx.fillRect(cx - half - 1, top, 2, bottom - top)
    ctx.fillRect(cx + half - 1, top, 2, bottom - top)
    stitch(ctx, [[cx + half - 5, top], [cx + half - 5, bottom]], thread, 1.2)
    for (let y = 1.13; y > SHIRT_HEM + 0.03; y -= 0.095) {
      const [bx, by] = shirtPx('front', 0, y)
      const r = 0.011 * m
      ctx.fillStyle = '#3a2414'
      ctx.beginPath()
      ctx.arc(bx, by, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,230,200,0.35)'
      ctx.beginPath()
      ctx.arc(bx - r * 0.3, by - r * 0.3, r * 0.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  {
    const [x0, y0] = shirtPx('front', 0.075, 1.05)
    const [x1, y1] = shirtPx('front', 0.205, 0.9)
    const mid = (x0 + x1) / 2
    const point = 0.012 * m
    const outline: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1 - point],
      [mid, y1],
      [x0, y1 - point],
      [x0, y0],
    ]
    const trace = (dx: number, dy: number): void => {
      ctx.beginPath()
      outline.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x + dx, y + dy) : ctx.lineTo(x + dx, y + dy)))
    }
    // Its shadow, its face a shade lighter, the stitching round it and across the top.
    ctx.fillStyle = 'rgba(25,12,4,0.45)'
    trace(2, 3)
    ctx.fill()
    ctx.save()
    trace(0, 0)
    ctx.clip()
    ctx.fillStyle = CORD_BROWN
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    wales(ctx, x0 + 1, y0, x1 - x0, y1 - y0)
    ctx.fillStyle = 'rgba(255,225,190,0.07)'
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    ctx.restore()
    const inset = outline.map(([x, y]) => [x + (x < mid ? 4 : x > mid ? -4 : 0), y + (y === y0 ? 0 : -4)] as [number, number])
    stitch(ctx, inset, thread, 1.3)
    stitch(ctx, [[x0, y0 + 0.016 * m], [x1, y0 + 0.016 * m]], thread, 1.3)
  }
  {
    // The chinos' fly below the hem.
    const [fx, fy] = shirtPx('front', 0.025, SHIRT_HEM)
    const [, crotch] = shirtPx('front', 0, 0.4)
    ctx.strokeStyle = 'rgba(90,70,40,0.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(fx, fy)
    ctx.lineTo(fx, crotch - 0.02 * m)
    ctx.quadraticCurveTo(fx, crotch, fx - 0.025 * m, crotch)
    ctx.stroke()
  }

  // Back: the yoke across the shoulders, and a box pleat under it.
  {
    const [lx, yoke] = shirtPx('back', -SHIRT_PANEL.half, 1.16)
    ctx.fillStyle = seam
    ctx.fillRect(lx, yoke, 512, 2)
    stitch(ctx, [[lx, yoke + 5], [lx + 512, yoke + 5]], thread, 1.2)
    const [cx] = shirtPx('back', 0, 0)
    const [, hem] = shirtPx('back', 0, SHIRT_HEM)
    const pleat = ctx.createLinearGradient(cx - 0.03 * m, 0, cx + 0.03 * m, 0)
    pleat.addColorStop(0, 'rgba(30,15,5,0)')
    pleat.addColorStop(0.5, 'rgba(30,15,5,0.25)')
    pleat.addColorStop(1, 'rgba(30,15,5,0)')
    ctx.fillStyle = pleat
    ctx.fillRect(cx - 0.03 * m, yoke + 2, 0.06 * m, (hem - yoke) * 0.35)
    // The collar band at the nape.
    const [, band] = shirtPx('back', 0, 1.3)
    ctx.fillStyle = 'rgba(30,15,5,0.35)'
    ctx.fillRect(lx, band, 512, 3)
  }

  const texture = textureOf(element)
  texture.flipY = false
  return texture
}

/**
 * The shirt (and the tops of the chinos) on the rogue's torso. The pouches come off the
 * belt first (flatWaist), then every triangle is projected onto the panel it faces most.
 */
function dressShirt(torso: THREE.SkinnedMesh): void {
  const geometry = torso.geometry.index ? torso.geometry.toNonIndexed() : torso.geometry.clone()
  torso.geometry = geometry
  sculpt(torso, flatWaist)
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const edge = new THREE.Vector3()
  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    n.subVectors(c, b).cross(edge.subVectors(a, b)).normalize()
    const panel: ShirtPanel = n.z > 0.4 ? 'front' : n.z < -0.4 ? 'back' : 'side'
    for (let k = 0; k < 3; k += 1) {
      const x = position.getX(i + k)
      const across = panel === 'front' ? x : panel === 'back' ? -x : position.getZ(i + k)
      const clamped = Math.min(SHIRT_PANEL.half - 0.01, Math.max(-SHIRT_PANEL.half + 0.01, across))
      const [px, py] = shirtPx(panel, clamped, Math.max(SHIRT_PANEL.ceiling - 1.05, position.getY(i + k)))
      uv[(i + k) * 2] = px / 1024
      uv[(i + k) * 2 + 1] = py / 1024
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  const texture = paintShirt()
  const material = torso.material as THREE.MeshStandardMaterial
  material.map = texture
  material.emissiveMap = texture
  // Corduroy is matte: no sheen across the chest.
  material.roughness = 1
  material.metalness = 0
  material.needsUpdate = true
}

/**
 * The shirt's collar: two pointed brown corduroy leaves lying open on the chest either
 * side of the neck, top-stitched near the edge. Fitted to the torso by probing it.
 */
function buildShirtCollar(probe: Probe): THREE.Group {
  const group = new THREE.Group()
  group.name = 'persona:shirt-collar'
  const { canvas: element, ctx } = canvas(64, 64)
  ctx.fillStyle = CORD_BROWN
  ctx.fillRect(0, 0, 64, 64)
  for (let y = 0; y < 64; y += 6) {
    ctx.fillStyle = 'rgba(30,16,6,0.22)'
    ctx.fillRect(0, y, 64, 2)
  }
  ctx.fillStyle = 'rgba(255,225,190,0.08)'
  ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = 'rgba(30,15,5,0.55)'
  ctx.fillRect(58, 0, 6, 64)
  ctx.fillRect(0, 58, 64, 6)
  stitch(ctx, [[53, 0], [53, 53], [0, 53]], 'rgba(150,105,70,0.85)', 1.5)
  const cloth = litMaterial({ map: textureOf(element) })
  cloth.side = THREE.DoubleSide
  let lastZ = 0.2
  const front = (x: number, y: number): number => {
    const hit = probe(new THREE.Vector3(x, y, 1.5), new THREE.Vector3(0, 0, -1))
    if (hit) lastZ = hit.z
    return lastZ
  }
  for (const side of [-1, 1]) {
    // Corners: inner top (at the neck), outer top, outer bottom, the point.
    const corners: [number, number][] = [
      [side * 0.06, 1.275],
      [side * 0.2, 1.255],
      [side * 0.165, 1.15],
      [side * 0.07, 1.115],
    ]
    const [p, q, r, t] = corners
    const steps = 8
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    for (let j = 0; j <= steps; j += 1) {
      for (let i = 0; i <= steps; i += 1) {
        const s = i / steps
        const w = j / steps
        const x = (p[0] * (1 - s) + q[0] * s) * (1 - w) + (t[0] * (1 - s) + r[0] * s) * w
        const y = (p[1] * (1 - s) + q[1] * s) * (1 - w) + (t[1] * (1 - s) + r[1] * s) * w
        // Rolled up off the chest along the fold at the neck, flatter toward the point.
        const fold = (1 - w) * (1 - w)
        positions.push(x, y, front(x, y) + 0.012 + 0.022 * fold * (1 - s * 0.5))
        uvs.push(s, w)
      }
    }
    for (let j = 0; j < steps; j += 1) {
      for (let i = 0; i < steps; i += 1) {
        const k = j * (steps + 1) + i
        indices.push(k, k + steps + 1, k + 1, k + 1, k + steps + 1, k + steps + 2)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const leaf = new THREE.Mesh(geometry, cloth)
    leaf.castShadow = true
    group.add(leaf)
  }
  return group
}

function dressLecter(root: THREE.Object3D): void {
  const head = findMesh(root, '_head')
  const torso = findMesh(root, '_body')
  const palette = paletteTexture()
  const dressed = head ? dressLecterHead(head) : null
  if (head && dressed) {
    const space = bindSpaceOf(head, 'head')
    space?.add(buildLecterHair(dressed.probe))
    space?.add(buildGlasses(dressed.probe))
    if (dressed.earring) space?.add(buildHoop(dressed.earring))
  }
  dress(findMesh(root, '_armleft'), palette, shirtArm)
  dress(findMesh(root, '_armright'), palette, shirtArm)
  dress(findMesh(root, '_legleft'), palette, chinoLeg)
  dress(findMesh(root, '_legright'), palette, chinoLeg)
  for (const side of ['_armleft', '_armright']) {
    sculpt(findMesh(root, side), bareForearm)
    sculpt(findMesh(root, side), rolledSleeve)
  }
  // Cord and cotton twill are matte.
  for (const part of ['_armleft', '_armright', '_legleft', '_legright']) {
    const material = findMesh(root, part)?.material as THREE.MeshStandardMaterial | undefined
    if (material) material.roughness = 1
  }
  if (torso) {
    dressShirt(torso)
    bindSpaceOf(torso, 'chest')?.add(buildShirtCollar(prober(torso.geometry)))
  }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Dresses a freshly cloned rig as the persona. Runs after the rig's own props have been
 * hidden, so the shield it replaces is already out of sight.
 */
export function applyPersona(root: THREE.Object3D, id: PersonaId): void {
  if (typeof document === 'undefined') return
  if (id === 'bobbilee') {
    dressBobbilee(root)
    return
  }
  if (id === 'teddyz') {
    dressTeddyz(root)
    return
  }
  if (id === 'lecter') {
    dressLecter(root)
    return
  }
  const head = findMesh(root, '_head')
  const torso = findMesh(root, '_body')
  const palette = paletteTexture()

  if (head) dressHead(head)

  if (torso) {
    // Prints first: they read the torso's original (indexed) surface.
    addPrint(torso, { name: 'persona:print-front', texture: frontPrint(), x: 0, y: 0.8, width: 0.38, height: 0.38, side: 1 })
    addPrint(torso, { name: 'persona:print-back', texture: backPrint(), x: 0, y: 0.88, width: 0.3, height: 0.3, side: -1 })
  }
  dress(torso, palette, body)
  // The watch goes on his left wrist, as in the photo. The rig's left is +x.
  dress(findMesh(root, '_armleft'), palette, arm(true))
  dress(findMesh(root, '_armright'), palette, arm(false))
  dress(findMesh(root, '_legleft'), palette, leg)
  dress(findMesh(root, '_legright'), palette, leg)

  const anchor = head ?? torso
  if (anchor) {
    const space = bindSpaceOf(anchor, 'head')
    if (space) {
      space.add(buildCap(head))
    }
  }
  addCoin(root)
}
