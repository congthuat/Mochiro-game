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

export type PersonaId = 'sam'

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
const USDC_BLUE = '#2775ca'
const PRINT_BLUE = '#2f6fe0'

/** What the camera behind the runner mostly sees of each persona (kit-check compares backs). */
export const PERSONA_BACK: Record<PersonaId, number> = { sam: TEE }

/** Order matters: a colour's index is its palette cell. */
const PALETTE = [TEE, JEANS, SKIN, STEEL, SHOE, SOLE] as const
const enum Cell {
  Tee = 0,
  Jeans = 1,
  Skin = 2,
  Steel = 3,
  Shoe = 4,
  Sole = 5,
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
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Dresses a freshly cloned rig as the persona. Runs after the rig's own props have been
 * hidden, so the shield it replaces is already out of sight.
 */
export function applyPersona(root: THREE.Object3D, id: PersonaId): void {
  if (id !== 'sam' || typeof document === 'undefined') return
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
