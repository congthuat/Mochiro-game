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
import { recolorTexture } from './recolor'

export type PersonaId = 'sam' | 'bobbilee' | 'teddyz'

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
const USDC_BLUE = '#2775ca'
const PRINT_BLUE = '#2f6fe0'

/** What the camera behind the runner mostly sees of each persona (kit-check compares backs). */
export const PERSONA_BACK: Record<PersonaId, number> = { sam: TEE, bobbilee: SWEATER, teddyz: WHITE_TEE }

/** Order matters: a colour's index is its palette cell. */
const PALETTE = [TEE, JEANS, SKIN, STEEL, SHOE, SOLE, SWEATER, RIB, TROUSER, SNEAKER, SNEAKER_SOLE, FAIR, WHITE_TEE, BLACK_TROUSER, TAN] as const
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

  // Eyes screwed shut with laughing: two arches.
  ctx.strokeStyle = '#1a110d'
  ctx.lineWidth = 0.026 * unit
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(...at(side * 0.19, 1.582), 0.06 * unit, 0.045 * unit, 0, Math.PI * 1.08, Math.PI * 1.92)
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

// Smallest ellipsoid (searched on the mesh) that holds every head vertex above the
// band line with 3% to spare.
const CAP_CENTRE = new THREE.Vector3(0, 1.82, 0.02)
const CAP_RADII = new THREE.Vector3(0.6, 0.62, 0.62)
/** The band sits just above the brows — the eyes top out at y 1.67. */
const CAP_BAND = 1.79
const CAP_THETA = Math.acos((CAP_BAND - CAP_CENTRE.y) / CAP_RADII.y)
/** How much higher the front panel stands than a plain dome: a structured cap. */
const CAP_FRONT_RISE = 0.14

const BRIM = {
  /** Half the arc of the band the brim is sewn to, in radians either side of the face. */
  span: 1.22,
  /** How far it sticks out at the middle. */
  reach: 0.44,
  thickness: 0.03,
  /** Slope down and away from the band, and the extra bend at the sides (pre-curved). */
  tilt: 0.12,
  curve: 0.24,
}

function buildBrim(): THREE.Mesh {
  const columns = 40
  const rows = 8
  const ring = Math.sin(CAP_THETA) * 0.985
  const rx = CAP_RADII.x * ring
  const rz = CAP_RADII.z * ring
  const point = (i: number, j: number, lift: number): THREE.Vector3 => {
    const side = (i / columns) * 2 - 1
    const phi = side * BRIM.span
    // Out from the band, but swept forward: a brim shades the eyes, not the ears.
    const normal = new THREE.Vector2(Math.sin(phi) / rx, Math.cos(phi) / rz).normalize().multiplyScalar(0.4)
    normal.y += 0.6
    normal.normalize()
    const reach = BRIM.reach * Math.pow(Math.cos((side * Math.PI) / 2), 0.85)
    const out = reach * (j / rows)
    return new THREE.Vector3(
      CAP_CENTRE.x + rx * Math.sin(phi) + normal.x * out,
      CAP_BAND - out * (BRIM.tilt + BRIM.curve * side * side) + lift,
      CAP_CENTRE.z + rz * Math.cos(phi) + normal.y * out
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

function buildCap(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'persona:cap'
  const geometry = new THREE.SphereGeometry(1, 56, 24, 0, Math.PI * 2, 0, CAP_THETA)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i)
    const z = position.getZ(i)
    if (y > 0 && z > 0) position.setY(i, y * (1 + CAP_FRONT_RISE * z))
  }
  const crown = new THREE.Mesh(geometry, litMaterial({ map: capTexture(CAP_THETA) }))
  ;(crown.material as THREE.Material).side = THREE.DoubleSide
  crown.name = 'persona:cap-crown'
  crown.scale.copy(CAP_RADII)
  crown.position.copy(CAP_CENTRE)
  group.add(crown)
  group.add(buildBrim())

  const button = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), litMaterial({ color: CAP }))
  button.scale.y = 0.6
  button.position.set(CAP_CENTRE.x, CAP_CENTRE.y + CAP_RADII.y, CAP_CENTRE.z)
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

const MIC_TILT = -Math.PI / 2

/** The staff becomes a handheld microphone: same hand, same grip. */
function addMicrophone(root: THREE.Object3D): void {
  let wand: THREE.Object3D | null = null
  root.traverse((object) => {
    if (!wand && object.name.replace(/[\[\].:/]/g, '').toLowerCase() === '1h_wand') wand = object
  })
  const anchor = wand as THREE.Object3D | null
  if (!anchor?.parent) return
  const mic = new THREE.Group()
  mic.name = 'persona:mic'
  const body = litMaterial({ color: 0x1c1d21 })
  const ring = litMaterial({ color: 0xc4c8cf })
  const grille = litMaterial({ color: 0x55585f })
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.034, 0.36, 18), body)
  handle.position.y = 0.04
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.05, 0.06, 18), ring)
  collar.position.y = 0.245
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 14), grille)
  head.position.y = 0.31
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.087, 0.087, 0.022, 20), ring)
  band.position.y = 0.31
  // The wand's grip points the prop straight ahead; a microphone is held upright.
  const grip = new THREE.Group()
  grip.rotation.z = MIC_TILT
  for (const part of [handle, collar, head, band]) {
    part.castShadow = true
    grip.add(part)
  }
  mic.add(grip)
  mic.position.copy(anchor.position)
  mic.quaternion.copy(anchor.quaternion)
  mic.scale.copy(anchor.scale)
  anchor.parent.add(mic)
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
  addMicrophone(root)
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
      else if (y >= line - 0.012) cover = 0.4 + 0.5 * smooth(line, top, y) + (noise() - 0.5) * 0.16
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

  // The pulled-in jaw gets smooth normals of its own new shape.
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
  const nose = ctx.createRadialGradient(u(0), v(1.458), 0, u(0), v(1.458), 0.055 * s)
  nose.addColorStop(0, rgb(0.78, 0.55))
  nose.addColorStop(1, rgb(0.78, 0))
  ctx.fillStyle = nose
  ctx.fillRect(u(0) - 0.06 * s, v(1.458) - 0.06 * s, 0.12 * s, 0.12 * s)

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

  // Mouth: closed and relaxed; a defined upper lip line and a fuller lower lip.
  const mouthY = 1.388
  ctx.fillStyle = '#b8735f'
  ctx.beginPath()
  ctx.moveTo(u(-0.085), v(mouthY))
  ctx.quadraticCurveTo(u(-0.04), v(mouthY - 0.03), u(0), v(mouthY - 0.026))
  ctx.quadraticCurveTo(u(0.04), v(mouthY - 0.03), u(0.085), v(mouthY))
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#a5614f'
  ctx.beginPath()
  ctx.moveTo(u(-0.085), v(mouthY))
  ctx.quadraticCurveTo(u(-0.04), v(mouthY + 0.016), u(0), v(mouthY + 0.012))
  ctx.quadraticCurveTo(u(0.04), v(mouthY + 0.016), u(0.085), v(mouthY))
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#5e2f26'
  ctx.lineWidth = 0.007 * s
  ctx.beginPath()
  ctx.moveTo(u(-0.088), v(mouthY + 0.002))
  ctx.quadraticCurveTo(u(0), v(mouthY - 0.006), u(0.088), v(mouthY + 0.002))
  ctx.stroke()
  const lip = ctx.createRadialGradient(u(0), v(mouthY - 0.05), 0, u(0), v(mouthY - 0.05), 0.05 * s)
  lip.addColorStop(0, rgb(0.84, 0.5))
  lip.addColorStop(1, rgb(0.84, 0))
  ctx.fillStyle = lip
  ctx.fillRect(u(0) - 0.06 * s, v(mouthY - 0.05) - 0.06 * s, 0.12 * s, 0.12 * s)
}

/** Short dark hair with volume on top, swept up and back off the forehead. */
function buildQuiff(): THREE.Mesh {
  const { canvas: element, ctx } = canvas(256, 128)
  ctx.fillStyle = BLACK_HAIR
  ctx.fillRect(0, 0, 256, 128)
  let seed = 11
  const noise = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  // Strands run from the crown (v = 0) down to the rim.
  for (let i = 0; i < 260; i += 1) {
    const x = noise() * 256
    const light = noise() < 0.3
    ctx.strokeStyle = light ? 'rgba(92,78,70,0.55)' : 'rgba(54,45,40,0.6)'
    ctx.lineWidth = light ? 1 : 1.6
    ctx.beginPath()
    ctx.moveTo(x, noise() * 30)
    ctx.lineTo(x + (noise() - 0.5) * 10, 60 + noise() * 68)
    ctx.stroke()
  }
  const map = textureOf(element)
  map.wrapS = THREE.RepeatWrapping

  const geometry = new THREE.SphereGeometry(1, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.6)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const centre = new THREE.Vector3(0, 1.98, 0)
  const radii = new THREE.Vector3(0.42, 0.24, 0.46)
  for (let i = 0; i < position.count; i += 1) {
    const px = position.getX(i)
    const py = position.getY(i)
    const pz = position.getZ(i)
    // The quiff: the front of the top lifts up and a little forward.
    const front = Math.max(0, pz)
    const lift = 0.15 * front * front * smooth(-0.2, 0.7, py)
    position.setXYZ(
      i,
      centre.x + px * radii.x * (1 - 0.06 * smooth(0, 1, py)),
      centre.y + py * radii.y + lift,
      centre.z + pz * radii.z + 0.05 * front * smooth(0, 0.6, py),
    )
  }
  geometry.computeVertexNormals()
  const material = litMaterial({ map })
  material.roughness = 0.62
  const quiff = new THREE.Mesh(geometry, material)
  quiff.name = 'persona:quiff'
  quiff.castShadow = true
  return quiff
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
  if (torso) {
    // On his right hip (the rig's −x), just below the hem of the untucked tee.
    const keys = buildKeys()
    keys.position.set(-0.13, 0.58, 0.375)
    keys.scale.setScalar(1.2)
    bindSpaceOf(torso, 'hips')?.add(keys)
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
      space.add(buildCap())
    }
  }
  addCoin(root)
}
