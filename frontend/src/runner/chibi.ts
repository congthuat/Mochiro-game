// Chibi character construction kit.
//
// Techniques referenced from open-source projects:
//   - three.js `RoundedBoxGeometry` / `CapsuleGeometry` (mrdoob/three.js, MIT) for
//     beveled, smooth body forms instead of raw boxes.
//   - The inverted-hull outline used by three.js `OutlinePass` demos and by every
//     stylised character pipeline (cel look): duplicate geometry, BackSide, slight
//     scale-up.
//   - MeshToonMaterial + gradient ramp ("banded lighting") as in the three.js
//     toon examples and the stylised-character guides.
//   - Spring-bone style lag for hair, following the approach popularised by
//     pixiv/three-vrm's VRMSpringBone (inertia + stiffness + drag).
//
// Everything is generated at runtime: no external model files, no licence baggage.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { type CharacterSpec } from './config'

export const OUTLINE_COLOR = 0x3b3355

// ---------------------------------------------------------------- materials --

/** Banded lighting ramp for the cel-shaded character. */
export function toonRamp(): THREE.DataTexture {
  const steps = 4
  const data = new Uint8Array(steps)
  const bands = [0.56, 0.74, 0.88, 1]
  for (let i = 0; i < steps; i++) data[i] = Math.round(bands[i] * 255)
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

/**
 * Cel material. A small self-emissive lift keeps the character bright and
 * readable in the daylight rig without touching the rest of the scene lighting.
 */
export function toon(color: THREE.ColorRepresentation, ramp: THREE.DataTexture, extra: Partial<THREE.MeshToonMaterialParameters> = {}) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: ramp,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.24,
    ...extra,
  })
}

const outlineMaterial = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide, fog: true })

/** Adds the inverted-hull outline shell for a part (skipped for transparent parts). */
export function withOutline(mesh: THREE.Mesh, scale = 1.055): THREE.Mesh {
  const shell = new THREE.Mesh(mesh.geometry, outlineMaterial)
  shell.scale.setScalar(scale)
  shell.castShadow = false
  shell.receiveShadow = false
  shell.matrixAutoUpdate = false
  shell.updateMatrix()
  mesh.add(shell)
  return mesh
}

// ----------------------------------------------------------------- geometry --

export function rounded(w: number, h: number, d: number, radius = 0.05, segments = 3): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, segments, Math.min(radius, Math.min(w, h, d) / 2.05))
}

export function capsule(radius: number, length: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(radius, length, 5, 14)
}

export function ball(radius: number, w = 22, h = 16): THREE.BufferGeometry {
  return new THREE.SphereGeometry(radius, w, h)
}

export interface StrandOptions {
  length: number
  /** Half-width of the root cross section. */
  width: number
  /** Half-depth of the root cross section. */
  thickness: number
  /** How far the tip sweeps sideways (+z in local space). */
  bend: number
  rootRadius?: number
  tipRadius?: number
  segments?: number
  radial?: number
}

/**
 * A tapered, curved hair strand. Built as a tube along a curve, then each ring is
 * rescaled so the strand tapers to a point and flattens into a ribbon.
 */
export function strand(opts: StrandOptions): THREE.BufferGeometry {
  const { length, width, thickness, bend } = opts
  const rootRadius = opts.rootRadius ?? 0.42
  const tipRadius = opts.tipRadius ?? 0.06
  const segments = opts.segments ?? 8
  const radial = opts.radial ?? 8

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, length * 0.34, bend * 0.3),
    new THREE.Vector3(0, length * 0.7, bend * 0.78),
    new THREE.Vector3(0, length, bend * 1.3),
  ])
  const geo = new THREE.TubeGeometry(curve, segments, 1, radial, false)
  const position = geo.attributes.position as THREE.BufferAttribute
  const ringCount = segments + 1
  const perRing = radial + 1
  const centre = new THREE.Vector3()
  for (let ring = 0; ring < ringCount; ring++) {
    const t = ring / (ringCount - 1)
    const taper = rootRadius + (tipRadius - rootRadius) * t * t
    const swell = 1 - Math.pow(Math.abs(t - 0.35) * 1.35, 2) * 0.18
    curve.getPointAt(t, centre)
    for (let i = 0; i < perRing; i++) {
      const index = ring * perRing + i
      const x = (position.getX(index) - centre.x) * width * taper * swell
      const y = (position.getY(index) - centre.y) * taper
      const z = (position.getZ(index) - centre.z) * thickness * taper * swell
      position.setXYZ(index, centre.x + x, centre.y + y, centre.z + z)
    }
  }
  position.needsUpdate = true
  geo.computeVertexNormals()
  geo.translate(0, 0, 0)
  return geo
}

// -------------------------------------------------------------------- colour --

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
}

function mixHex(hex: number, target: number, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex)
  const [r2, g2, b2] = hexToRgb(target)
  const r = Math.round(r1 + (r2 - r1) * amount)
  const g = Math.round(g1 + (g2 - g1) * amount)
  const b = Math.round(b1 + (b2 - b1) * amount)
  return `rgb(${r}, ${g}, ${b})`
}

const lighten = (hex: number, amount: number): string => mixHex(hex, 0xffffff, amount)
const darken = (hex: number, amount: number): string => mixHex(hex, 0x1a1424, amount)

// ---------------------------------------------------------------- face plate --

/**
 * Anime face painted onto the head sphere's equirectangular UVs (2048x1024).
 * Canvas row 0 is the top of the head, row 512 the widest point (equator).
 */
export function faceTexture(spec: CharacterSpec): THREE.CanvasTexture {
  const W = 2048
  const H = 1024
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

  // Skin base + soft shading so the face is not a flat decal.
  ctx.fillStyle = mixHex(spec.skin, 0xffffff, 0)
  ctx.fillRect(0, 0, W, H)
  const jaw = ctx.createLinearGradient(0, 260, 0, H)
  jaw.addColorStop(0, 'rgba(150, 92, 78, 0)')
  jaw.addColorStop(0.72, 'rgba(150, 92, 78, 0.05)')
  jaw.addColorStop(1, 'rgba(150, 92, 78, 0.13)')
  ctx.fillStyle = jaw
  ctx.fillRect(0, 260, W, H - 260)
  const crown = ctx.createLinearGradient(0, 0, 0, 470)
  crown.addColorStop(0, 'rgba(120, 70, 60, 0.2)')
  crown.addColorStop(1, 'rgba(120, 70, 60, 0)')
  ctx.fillStyle = crown
  ctx.fillRect(0, 0, W, 470)

  const cx = W / 2
  const eyeY = 572
  const eyeDX = 104

  drawBrow(ctx, cx - eyeDX, eyeY - 132, -1, spec)
  drawBrow(ctx, cx + eyeDX, eyeY - 132, 1, spec)
  drawEye(ctx, cx - eyeDX, eyeY, -1, spec)
  drawEye(ctx, cx + eyeDX, eyeY, 1, spec)

  // Blush.
  for (const side of [-1, 1]) {
    const bx = cx + side * 214
    const blush = ctx.createRadialGradient(bx, eyeY + 104, 4, bx, eyeY + 104, 96)
    blush.addColorStop(0, 'rgba(255, 128, 148, 0.42)')
    blush.addColorStop(1, 'rgba(255, 128, 148, 0)')
    ctx.fillStyle = blush
    ctx.beginPath()
    ctx.ellipse(bx, eyeY + 104, 96, 62, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(240, 110, 130, 0.32)'
    ctx.lineWidth = 5
    for (let i = 0; i < 3; i++) {
      const ox = bx - 42 + i * 42
      ctx.beginPath()
      ctx.moveTo(ox - 16, eyeY + 136)
      ctx.lineTo(ox + 6, eyeY + 74)
      ctx.stroke()
    }
  }

  // Nose: a soft dot.
  ctx.beginPath()
  ctx.ellipse(cx, eyeY + 104, 11, 7, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(150, 92, 78, 0.42)'
  ctx.fill()

  // Mouth: a small open smile.
  const mouthY = eyeY + 158
  ctx.beginPath()
  ctx.moveTo(cx - 44, mouthY - 6)
  ctx.quadraticCurveTo(cx, mouthY + 44, cx + 44, mouthY - 6)
  ctx.quadraticCurveTo(cx, mouthY + 12, cx - 44, mouthY - 6)
  ctx.closePath()
  ctx.fillStyle = 'rgba(126, 44, 62, 0.9)'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx - 26, mouthY + 12)
  ctx.quadraticCurveTo(cx, mouthY + 34, cx + 26, mouthY + 12)
  ctx.quadraticCurveTo(cx, mouthY + 20, cx - 26, mouthY + 12)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255, 158, 176, 0.85)'
  ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function drawBrow(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, spec: CharacterSpec) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(side * 0.16)
  ctx.beginPath()
  ctx.moveTo(-46, 10)
  ctx.quadraticCurveTo(-6, -22, 48, -6)
  ctx.quadraticCurveTo(-4, -4, -46, 22)
  ctx.closePath()
  ctx.fillStyle = darken(spec.hair, 0.22)
  ctx.fill()
  ctx.restore()
}

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, spec: CharacterSpec) {
  const ew = 88
  const eh = 116
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(side * 0.07)

  // Sclera.
  ctx.beginPath()
  ctx.ellipse(0, 0, ew, eh, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#fdfbff'
  ctx.fill()

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(0, 0, ew, eh, 0, 0, Math.PI * 2)
  ctx.clip()

  // Iris.
  const iris = ctx.createRadialGradient(0, -10, 4, 0, 0, 66)
  iris.addColorStop(0, lighten(spec.eye, 0.55))
  iris.addColorStop(0.42, mixHex(spec.eye, 0xffffff, 0))
  iris.addColorStop(0.85, darken(spec.eye, 0.4))
  iris.addColorStop(1, darken(spec.eye, 0.62))
  ctx.beginPath()
  ctx.arc(0, -4, 64, 0, Math.PI * 2)
  ctx.fillStyle = iris
  ctx.fill()

  // Radial iris fibres.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.lineWidth = 3
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * 22, Math.sin(a) * 22 - 4)
    ctx.lineTo(Math.cos(a) * 60, Math.sin(a) * 60 - 4)
    ctx.stroke()
  }

  // Pupil.
  ctx.beginPath()
  ctx.ellipse(0, -4, 25, 29, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(26, 16, 38, 0.96)'
  ctx.fill()

  // Light pooling at the bottom of the iris.
  ctx.beginPath()
  ctx.ellipse(0, 30, 34, 20, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.fill()

  // Upper lid shadow.
  const lid = ctx.createLinearGradient(0, -eh, 0, 4)
  lid.addColorStop(0, 'rgba(38, 22, 48, 0.92)')
  lid.addColorStop(0.55, 'rgba(38, 22, 48, 0.28)')
  lid.addColorStop(1, 'rgba(38, 22, 48, 0)')
  ctx.fillStyle = lid
  ctx.fillRect(-ew, -eh, ew * 2, eh + 4)

  // Specular highlights.
  ctx.beginPath()
  ctx.arc(-26, -34, 22, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(28, 24, 11, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)'
  ctx.fill()
  ctx.restore()

  // Upper lash line + outer lash spikes.
  const lash = darken(spec.hair, 0.3)
  ctx.strokeStyle = lash
  ctx.lineCap = 'round'
  ctx.lineWidth = 19
  ctx.beginPath()
  ctx.moveTo(-ew - 6, -10)
  ctx.quadraticCurveTo(-ew * 0.35, -eh - 16, ew * 0.52, -eh * 0.86)
  ctx.stroke()
  ctx.lineWidth = 15
  ctx.beginPath()
  ctx.moveTo(ew * 0.4, -eh * 0.88)
  ctx.quadraticCurveTo(ew * 1.15, -eh * 0.95, ew * 1.42, -eh * 0.3)
  ctx.stroke()

  // Eyelid crease.
  ctx.strokeStyle = 'rgba(120, 78, 82, 0.32)'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(-ew * 0.8, -eh - 16)
  ctx.quadraticCurveTo(0, -eh - 36, ew * 0.86, -eh - 6)
  ctx.stroke()

  // Lower lid.
  ctx.strokeStyle = 'rgba(140, 96, 100, 0.3)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(-ew * 0.6, eh * 0.86)
  ctx.quadraticCurveTo(0, eh + 6, ew * 0.72, eh * 0.6)
  ctx.stroke()

  ctx.restore()
}
