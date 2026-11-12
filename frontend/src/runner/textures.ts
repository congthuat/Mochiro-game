// Procedural canvas textures for the runner (no external image assets).
import * as THREE from 'three'
import { PALETTE, type CharacterSpec } from './config'

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return { canvas, ctx }
}

function finish(canvas: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeat[0], repeat[1])
  }
  return texture
}

let blobShadow: THREE.CanvasTexture | null = null

/**
 * Soft contact shadow: a dark core that fades to nothing, so anything standing on
 * the road looks planted on it instead of hovering. Shared by every caster; the
 * texture is never disposed (it lives as long as the page).
 */
export function blobShadowTexture(): THREE.CanvasTexture {
  if (blobShadow) return blobShadow
  const { canvas, ctx } = canvas2d(128, 128)
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)')
  gradient.addColorStop(0.35, 'rgba(0, 0, 0, 0.85)')
  gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.32)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  blobShadow = new THREE.CanvasTexture(canvas)
  return blobShadow
}

/**
 * Asphalt with painted markings — the road you actually drive on.
 *
 * The surface used to be pale grey, which read as a runway: on a real carriageway
 * everything is near-black and the only bright thing is the paint. So the base is a
 * dark aggregate with a slight crown down the middle, and the markings do all the
 * work — a **solid white edge line** either side of the carriageway, which is what a
 * driver steers by, and (in `track.ts`) dashed white dividers between the three
 * lanes. At speed the white edge line streaming past is the strongest motion cue in
 * the whole scene, and it costs nothing but a change of colour.
 */
export function roadTexture(): THREE.CanvasTexture {
  const w = 256
  const h = 256
  const { canvas, ctx } = canvas2d(w, h)

  // Asphalt is never one flat tone: the crown down the middle catches the light and
  // the wheel tracks either side stay darker.
  const base = ctx.createLinearGradient(0, 0, w, 0)
  base.addColorStop(0, PALETTE.roadDark)
  base.addColorStop(0.5, PALETTE.road)
  base.addColorStop(1, PALETTE.roadDark)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  // Aggregate: pale stone chips sitting in the bitumen, and darker patches where it
  // has been laid thicker. This is the grain that stops a dark surface reading flat.
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    if (Math.random() < 0.62) {
      ctx.fillStyle = `rgba(158, 166, 178, ${(Math.random() * 0.14).toFixed(3)})`
    } else {
      ctx.fillStyle = `rgba(10, 12, 16, ${(Math.random() * 0.22).toFixed(3)})`
    }
    ctx.fillRect(x, y, Math.random() < 0.8 ? 2 : 3, 2)
  }

  // Tar seams running with the road, the way a repaired surface looks.
  ctx.strokeStyle = 'rgba(12, 14, 18, 0.3)'
  ctx.lineWidth = 2
  for (let i = 0; i < 3; i++) {
    const x = 34 + Math.random() * (w - 68)
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + (Math.random() - 0.5) * 12, h)
    ctx.stroke()
  }

  // Solid white edge lines. The road plane is 9.6 world units across 256 px, so the
  // 7 px band sits at ±4.54 — just inside the drivable ±4.6, where a real edge line
  // is painted. Off-white rather than pure white: pure white blows out under the
  // tone mapping and turns into a glowing stripe at speed.
  const EDGE_X = 7
  const EDGE_W = 7
  ctx.globalAlpha = 0.94
  ctx.fillStyle = PALETTE.grid
  ctx.fillRect(EDGE_X, 0, EDGE_W, h)
  ctx.fillRect(w - EDGE_X - EDGE_W, 0, EDGE_W, h)
  ctx.globalAlpha = 1

  // No dashed dividers here: `track.ts` lays them as real geometry so they can be
  // worn unevenly and so they scroll with the road rather than repeating with the
  // texture tile.

  // Scroll cue for the bare asphalt between the paint: a faint band every tile, and
  // the brand's colour flashing past once per tile on top of it.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'
  ctx.fillRect(0, 0, w, 5)
  ctx.fillStyle = 'rgba(95, 216, 255, 0.18)'
  ctx.fillRect(0, 9, w, 3)

  return finish(canvas, [1, 40])
}

/** Orange / white striped barrier face. */
export function hazardTexture(): THREE.CanvasTexture {
  const w = 128
  const h = 128
  const { canvas, ctx } = canvas2d(w, h)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.save()
  ctx.translate(-w, 0)
  ctx.rotate(-Math.PI / 4)
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 === 0 ? PALETTE.hazard : '#ffffff'
    ctx.fillRect(i * 44, -h, 22, h * 3)
  }
  ctx.restore()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.fillRect(0, 0, w, 8)
  ctx.fillRect(0, h - 8, w, 8)
  return finish(canvas)
}

/** Bright shipping-crate panel for tall blockers. */
export function panelTexture(): THREE.CanvasTexture {
  const w = 128
  const h = 128
  const { canvas, ctx } = canvas2d(w, h)
  const base = ctx.createLinearGradient(0, 0, 0, h)
  base.addColorStop(0, '#4a9bf0')
  base.addColorStop(1, '#2f6fd0')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.lineWidth = 6
  ctx.strokeRect(9, 9, w - 18, h - 18)
  ctx.beginPath()
  ctx.moveTo(12, 12)
  ctx.lineTo(w - 12, h - 12)
  ctx.moveTo(w - 12, 12)
  ctx.lineTo(12, h - 12)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.fillRect(0, 0, w, 10)
  return finish(canvas)
}


/** Radial glow used for pickup halos and the coin aura. */
export function glowTexture(inner = 'rgba(255, 255, 255, 0.95)', outer = 'rgba(90, 190, 255, 0)'): THREE.CanvasTexture {
  const size = 128
  const { canvas, ctx } = canvas2d(size, size)
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, inner)
  gradient.addColorStop(0.45, 'rgba(140, 210, 255, 0.28)')
  gradient.addColorStop(1, outer)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Soft cloud puff sprite. */
export function cloudTexture(): THREE.CanvasTexture {
  const size = 256
  const { canvas, ctx } = canvas2d(size, size)
  const puff = (cx: number, cy: number, r: number, alpha: number) => {
    const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r)
    g.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
    g.addColorStop(0.55, `rgba(252, 254, 255, ${alpha * 0.8})`)
    g.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  puff(96, 140, 78, 0.95)
  puff(150, 120, 88, 0.95)
  puff(190, 150, 62, 0.9)
  puff(70, 158, 56, 0.85)
  puff(130, 168, 66, 0.9)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Bright blue day sky with a sun and fluffy clouds. */
export function skyTexture(): THREE.CanvasTexture {
  const w = 1024
  const h = 512
  const { canvas, ctx } = canvas2d(w, h)

  // Vertical gradient: zenith at the top, warm haze at the horizon (y = h/2).
  const gradient = ctx.createLinearGradient(0, 0, 0, h * 0.56)
  gradient.addColorStop(0, PALETTE.skyTop)
  gradient.addColorStop(0.45, PALETTE.skyMid)
  gradient.addColorStop(1, PALETTE.skyHorizon)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h * 0.56)

  // Below the horizon: soft haze that the ground plane covers.
  const below = ctx.createLinearGradient(0, h * 0.5, 0, h)
  below.addColorStop(0, PALETTE.skyHorizon)
  below.addColorStop(0.25, '#eef8ff')
  below.addColorStop(1, '#dceaf5')
  ctx.fillStyle = below
  ctx.fillRect(0, h * 0.5, w, h * 0.5)

  // Sun with a wide halo.
  const sunX = w * 0.24
  const sunY = h * 0.13
  const halo = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 150)
  halo.addColorStop(0, 'rgba(255, 250, 220, 0.95)')
  halo.addColorStop(0.25, 'rgba(255, 246, 200, 0.35)')
  halo.addColorStop(1, 'rgba(255, 246, 200, 0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, w, h * 0.5)
  ctx.fillStyle = PALETTE.sun
  ctx.beginPath()
  ctx.arc(sunX, sunY, 26, 0, Math.PI * 2)
  ctx.fill()

  // Clouds: soft clusters of circles in the upper band.
  const rng = mulberry(20261110)
  for (let i = 0; i < 34; i++) {
    const cx = rng() * w
    const cy = h * (0.05 + rng() * 0.3)
    const scale = 0.32 + rng() * 0.55
    const alpha = 0.4 + rng() * 0.4
    const puffs = 3 + Math.floor(rng() * 4)
    for (let p = 0; p < puffs; p++) {
      const px = cx + (rng() - 0.5) * 60 * scale
      const py = cy + (rng() - 0.5) * 16 * scale
      const radius = (14 + rng() * 20) * scale
      const g = ctx.createRadialGradient(px, py, radius * 0.15, px, py, radius)
      g.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
      g.addColorStop(0.6, `rgba(255, 255, 255, ${alpha * 0.75})`)
      g.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(px, py, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Distant mountain ranges with atmospheric perspective.
  const horizon = h * 0.5 + 4
  const ranges = [
    { color: 'rgba(188, 214, 238, 0.55)', peak: 34, step: 96 },
    { color: 'rgba(156, 193, 225, 0.72)', peak: 60, step: 138 },
    { color: 'rgba(124, 169, 209, 0.88)', peak: 88, step: 196 },
  ]
  for (const range of ranges) {
    ctx.beginPath()
    ctx.moveTo(0, horizon)
    let x = 0
    while (x < w) {
      const span = range.step * (0.6 + rng() * 0.9)
      const peak = range.peak * (0.45 + rng() * 0.75)
      ctx.lineTo(x + span * 0.5, horizon - peak)
      x += span
      ctx.lineTo(x, horizon - range.peak * 0.14 * rng())
    }
    ctx.lineTo(w, horizon)
    ctx.closePath()
    ctx.fillStyle = range.color
    ctx.fill()
  }

  return finish(canvas)
}

/** Small star decal (jacket, shoes, UI accents). */
export function starDecalTexture(color = '#ffd447'): THREE.CanvasTexture {
  const size = 128
  const { canvas, ctx } = canvas2d(size, size)
  ctx.translate(size / 2, size / 2)
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? size * 0.46 : size * 0.19
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Face for the head cap: big anime eyes, brows, smile and blush on a
 * transparent canvas. `flipY` is disabled so v=0 is the top of the canvas
 * (the forehead) which matches the sphere cap orientation.
 */
export function faceTexture(spec: CharacterSpec): THREE.CanvasTexture {
  const size = 512
  const { canvas, ctx } = canvas2d(size, size)
  const cx = size / 2
  const eyeY = size * 0.55
  const eyeDX = size * 0.19
  const eyeW = size * 0.135
  const eyeH = size * 0.175
  const eyeColor = `#${spec.eye.toString(16).padStart(6, '0')}`

  const drawEye = (x: number) => {
    // White of the eye.
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(x, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.clip()
    // Iris.
    ctx.beginPath()
    ctx.ellipse(x, eyeY + eyeH * 0.08, eyeW * 0.82, eyeH * 0.92, 0, 0, Math.PI * 2)
    ctx.fillStyle = eyeColor
    ctx.fill()
    // Pupil + shine.
    ctx.beginPath()
    ctx.ellipse(x, eyeY + eyeH * 0.16, eyeW * 0.44, eyeH * 0.52, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#140c08'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x - eyeW * 0.32, eyeY - eyeH * 0.42, eyeW * 0.3, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x + eyeW * 0.3, eyeY + eyeH * 0.34, eyeW * 0.16, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.fill()
    ctx.restore()
    // Upper lash.
    ctx.beginPath()
    ctx.ellipse(x, eyeY - eyeH * 0.52, eyeW * 1.02, eyeH * 0.34, 0, Math.PI, Math.PI * 2)
    ctx.fillStyle = '#20130c'
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#20130c'
    ctx.beginPath()
    ctx.ellipse(x, eyeY, eyeW, eyeH, 0, Math.PI * 0.92, Math.PI * 2.08)
    ctx.stroke()
  }

  drawEye(cx - eyeDX)
  drawEye(cx + eyeDX)

  // Brows.
  ctx.strokeStyle = '#3a2415'
  ctx.lineWidth = 11
  ctx.lineCap = 'round'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(cx + side * eyeDX - eyeW * 0.9, eyeY - eyeH * 1.5)
    ctx.quadraticCurveTo(cx + side * eyeDX, eyeY - eyeH * 1.95, cx + side * eyeDX + eyeW * 0.9, eyeY - eyeH * 1.42)
    ctx.stroke()
  }

  // Smile.
  ctx.strokeStyle = '#8c3b2e'
  ctx.lineWidth = 12
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.075, size * 0.815)
  ctx.quadraticCurveTo(cx, size * 0.885, cx + size * 0.075, size * 0.815)
  ctx.stroke()

  // Blush.
  for (const side of [-1, 1]) {
    const g = ctx.createRadialGradient(cx + side * size * 0.29, size * 0.72, 2, cx + side * size * 0.29, size * 0.72, size * 0.075)
    g.addColorStop(0, 'rgba(255, 138, 150, 0.55)')
    g.addColorStop(1, 'rgba(255, 138, 150, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx + side * size * 0.29, size * 0.72, size * 0.075, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  return texture
}

/** Tiny deterministic RNG so textures are stable between reloads. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
