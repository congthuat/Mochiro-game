// Arc project branding: the collectible coin and the trackside billboards carry
// the real Arc project mark, resolved live from the Surf project catalog. The
// artwork is proxied through our own backend so its pixels can be read and
// re-composited on a canvas without cross-origin tainting. A hand-drawn emblem
// keeps the game branded if the catalog is unreachable.
import * as THREE from 'three'
import { api } from '../lib/api'
import { PALETTE } from './config'
import type { ArcBrand } from './types'

const FALLBACK_BRAND: ArcBrand = {
  name: 'Arc',
  symbol: null,
  description: '',
  tags: [],
  website: null,
  x_handle: null,
  followers: null,
  logo: null,
  degraded: true,
}

const TAU = Math.PI * 2

/** Dev-only: the last artwork drawn, so checks can eyeball the canvas. */
export const arcArtwork: { coin?: HTMLCanvasElement; billboard?: HTMLCanvasElement; mark?: HTMLCanvasElement } = {}
const GOLD_LIGHT = '#fff4c9'
const GOLD = '#f8c637'
const GOLD_DEEP = '#d9901a'
const NAVY_LIGHT = '#1d4d80'
const NAVY = '#0d2a4c'
const NAVY_DEEP = '#061630'

export async function loadArcBrand(): Promise<ArcBrand> {
  try {
    const response = await fetch(api('arc/project'))
    if (!response.ok) throw new Error(`status ${response.status}`)
    const data = (await response.json()) as Partial<ArcBrand> & { logo?: string | null }
    return {
      name: data.name?.trim() || 'Arc',
      symbol: data.symbol ?? null,
      description: data.description ?? '',
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 4) : [],
      website: data.website ?? null,
      x_handle: data.x_handle ?? null,
      followers: typeof data.followers === 'number' ? data.followers : null,
      logo: data.logo ? api('arc/logo') : null,
      degraded: Boolean(data.degraded) || !data.logo,
    }
  } catch (error) {
    console.warn('[arcrush] Arc brand lookup failed, using fallback emblem', error)
    return { ...FALLBACK_BRAND }
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`failed to load ${url}`))
    image.src = url
  })
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return { canvas, ctx }
}

/* ------------------------------------------------------------------ *
 * Mark extraction
 * ------------------------------------------------------------------ */

/** The project logo with its plate removed: transparent, tightly bounded. */
export interface ArcMark {
  canvas: HTMLCanvasElement
  box: { x: number; y: number; width: number; height: number }
}

/** Otsu's method — splits a two-tone image at the most separable luminance. */
function otsuThreshold(lum: Float32Array): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < lum.length; i++) hist[Math.max(0, Math.min(255, Math.round(lum[i])))]++
  const total = lum.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = -1
  let threshold = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

/**
 * Cuts the logo out of its backing plate. Project artwork is usually a flat
 * square (the Arc mark ships as a JPEG), so we threshold it, flood the plate in
 * from the border and keep whatever the plate cannot reach — that preserves
 * enclosed shapes and survives gradients across the artwork.
 */
export function cutOutMark(image: HTMLImageElement): ArcMark | null {
  const natural = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height)
  const scale = Math.min(1, 512 / Math.max(1, natural))
  const w = Math.max(8, Math.round((image.naturalWidth || image.width) * scale))
  const h = Math.max(8, Math.round((image.naturalHeight || image.height) * scale))
  const { canvas, ctx } = makeCanvas(w, h)
  ctx.drawImage(image, 0, 0, w, h)

  const imageData = ctx.getImageData(0, 0, w, h)
  const px = imageData.data

  // Artwork that already ships with transparency is used exactly as drawn.
  let seeThrough = 0
  let edgeCount = 0
  for (let x = 0; x < w; x += 2) {
    if (px[x * 4 + 3] < 24) seeThrough++
    if (px[((h - 1) * w + x) * 4 + 3] < 24) seeThrough++
    edgeCount += 2
  }
  for (let y = 0; y < h; y += 2) {
    if (px[y * w * 4 + 3] < 24) seeThrough++
    if (px[(y * w + w - 1) * 4 + 3] < 24) seeThrough++
    edgeCount += 2
  }
  const preCut = seeThrough > edgeCount * 0.4

  const lum = new Float32Array(w * h)
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2]
  }

  if (!preCut) {
    const threshold = otsuThreshold(lum)
    // Which side of the split is the plate? Whatever the border is made of.
    let borderSum = 0
    let borderN = 0
    for (let x = 0; x < w; x++) {
      borderSum += lum[x] + lum[(h - 1) * w + x]
      borderN += 2
    }
    for (let y = 0; y < h; y++) {
      borderSum += lum[y * w] + lum[y * w + w - 1]
      borderN += 2
    }
    const brightMark = borderSum / borderN < threshold
    const plateTest = (l: number) => (brightMark ? l <= threshold : l >= threshold)

    // Flood the plate in from every border pixel.
    const plate = new Uint8Array(w * h)
    const stack = new Int32Array(w * h)
    let top = 0
    const push = (i: number) => {
      if (plate[i] || !plateTest(lum[i])) return
      plate[i] = 1
      stack[top++] = i
    }
    for (let x = 0; x < w; x++) {
      push(x)
      push((h - 1) * w + x)
    }
    for (let y = 0; y < h; y++) {
      push(y * w)
      push(y * w + w - 1)
    }
    while (top > 0) {
      const i = stack[--top]
      const x = i % w
      const y = (i - x) / w
      if (x > 0) push(i - 1)
      if (x < w - 1) push(i + 1)
      if (y > 0) push(i - w)
      if (y < h - 1) push(i + w)
    }

    const soft = 16
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      if (plate[i]) {
        px[p + 3] = 0
        continue
      }
      const distance = brightMark ? lum[i] - threshold : threshold - lum[i]
      const alpha = Math.max(0, Math.min(1, distance / soft))
      // Marks that read bright on a plate are minted in white so they stay crisp
      // at coin size; dark marks keep their own ink.
      if (brightMark) {
        px[p] = 255
        px[p + 1] = 255
        px[p + 2] = 255
      }
      px[p + 3] = Math.round(alpha * 255)
    }
  }

  // Tight bounds so the mark can be centred and scaled on any surface.
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] < 20) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < x0 || y1 < y0) return null

  ctx.putImageData(imageData, 0, 0)
  arcArtwork.mark = canvas
  const box = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
  // A mark that fills the whole frame means the cut failed — fall back to the
  // artwork as-is rather than shipping a solid square.
  if (box.width < w * 0.06 || box.height < h * 0.06) return null
  return { canvas, box }
}

/** Loads the project logo and returns the cut-out mark (null if unavailable). */
export async function loadArcMark(brand: ArcBrand): Promise<ArcMark | null> {
  if (!brand.logo) return null
  try {
    const image = await loadImage(brand.logo)
    const mark = cutOutMark(image)
    if (!mark) console.warn('[arcrush] Arc mark extraction came back empty, using the emblem')
    return mark
  } catch (error) {
    console.warn('[arcrush] Arc mark could not be loaded', error)
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Coin face
 * ------------------------------------------------------------------ */

/** The Arc arch mark, drawn as vector art. Used when no logo is available. */
function drawArchEmblem(ctx: CanvasRenderingContext2D, size: number, radius: number, ink: string): void {
  const c = size / 2
  const r = radius * 0.66
  ctx.save()
  ctx.strokeStyle = ink
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  ctx.lineWidth = radius * 0.19
  // The arch: a wide, open curve.
  ctx.beginPath()
  ctx.moveTo(c - r, c + r * 0.86)
  ctx.quadraticCurveTo(c, c - r * 1.5, c + r, c + r * 0.86)
  ctx.stroke()
  // The crossbar.
  ctx.beginPath()
  ctx.moveTo(c - r * 0.52, c + r * 0.24)
  ctx.lineTo(c + r * 0.52, c + r * 0.24)
  ctx.stroke()
  ctx.restore()
}

/** Mints the coin face: a reeded gold rim around a navy field carrying the mark. */
export async function buildCoinTexture(brand: ArcBrand, mark: ArcMark | null): Promise<THREE.Texture> {
  const size = 512
  const { canvas, ctx } = makeCanvas(size, size)
  const c = size / 2
  const outer = size * 0.495
  const field = outer * 0.855
  ctx.clearRect(0, 0, size, size)

  // 1 — Gold rim.
  const rimGradient = ctx.createLinearGradient(0, 0, size, size)
  rimGradient.addColorStop(0, GOLD_LIGHT)
  rimGradient.addColorStop(0.34, GOLD)
  rimGradient.addColorStop(0.66, GOLD_DEEP)
  rimGradient.addColorStop(1, '#9c6208')
  ctx.beginPath()
  ctx.arc(c, c, outer, 0, TAU)
  ctx.fillStyle = rimGradient
  ctx.fill()

  // 1b — Reeded edge: the fine ridges of a struck coin.
  ctx.save()
  ctx.beginPath()
  ctx.arc(c, c, outer, 0, TAU)
  ctx.arc(c, c, field, 0, TAU, true)
  ctx.clip()
  const ridges = 144
  for (let i = 0; i < ridges; i++) {
    const angle = (i / ridges) * TAU
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 245, 205, 0.5)' : 'rgba(146, 88, 8, 0.34)'
    ctx.lineWidth = (outer - field) * 0.46
    ctx.beginPath()
    ctx.moveTo(c + Math.cos(angle) * field, c + Math.sin(angle) * field)
    ctx.lineTo(c + Math.cos(angle) * outer * 1.05, c + Math.sin(angle) * outer * 1.05)
    ctx.stroke()
  }
  ctx.restore()

  // 2 — Navy field, lit from the upper left.
  const fieldGradient = ctx.createRadialGradient(c - outer * 0.3, c - outer * 0.36, outer * 0.04, c, c, field)
  fieldGradient.addColorStop(0, NAVY_LIGHT)
  fieldGradient.addColorStop(0.58, NAVY)
  fieldGradient.addColorStop(1, NAVY_DEEP)
  ctx.beginPath()
  ctx.arc(c, c, field, 0, TAU)
  ctx.fillStyle = fieldGradient
  ctx.fill()

  // 3 — Bevel where the field meets the rim.
  ctx.beginPath()
  ctx.arc(c, c, field, 0, TAU)
  ctx.lineWidth = size * 0.019
  ctx.strokeStyle = '#ffe9a8'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(c, c, field * 0.975, 0, TAU)
  ctx.lineWidth = size * 0.008
  ctx.strokeStyle = 'rgba(6, 22, 48, 0.6)'
  ctx.stroke()

  // 4 — Halo behind the mark so it lifts off the field.
  const halo = ctx.createRadialGradient(c, c, field * 0.1, c, c, field * 0.92)
  halo.addColorStop(0, 'rgba(126, 214, 255, 0.3)')
  halo.addColorStop(1, 'rgba(126, 214, 255, 0)')
  ctx.beginPath()
  ctx.arc(c, c, field, 0, TAU)
  ctx.fillStyle = halo
  ctx.fill()

  // 5 — The mark itself.
  if (mark) {
    const target = field * 1.16
    const ratio = Math.min(target / mark.box.width, target / mark.box.height)
    const dw = mark.box.width * ratio
    const dh = mark.box.height * ratio
    ctx.save()
    ctx.shadowColor = 'rgba(3, 14, 30, 0.6)'
    ctx.shadowBlur = size * 0.024
    ctx.shadowOffsetY = size * 0.008
    ctx.drawImage(mark.canvas, mark.box.x, mark.box.y, mark.box.width, mark.box.height, c - dw / 2, c - dh / 2, dw, dh)
    ctx.restore()
  } else {
    drawArchEmblem(ctx, size, field, '#f4fbff')
  }

  // 6 — Specular sheen across the struck face.
  ctx.save()
  ctx.beginPath()
  ctx.arc(c, c, outer, 0, TAU)
  ctx.clip()
  const sheen = ctx.createLinearGradient(0, 0, size * 0.85, size)
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.28)')
  sheen.addColorStop(0.38, 'rgba(255, 255, 255, 0.05)')
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, size, size)
  // Outer contour so the coin keeps a defined silhouette in daylight.
  ctx.beginPath()
  ctx.arc(c, c, outer - size * 0.006, 0, TAU)
  ctx.lineWidth = size * 0.012
  ctx.strokeStyle = 'rgba(255, 226, 150, 0.75)'
  ctx.stroke()
  ctx.restore()

  arcArtwork.coin = canvas
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

/* ------------------------------------------------------------------ *
 * Trackside billboard
 * ------------------------------------------------------------------ */

/** Wide branded panel used on the billboards lining the track. */
export function buildWordmarkTexture(brand: ArcBrand, mark: ArcMark | null): THREE.Texture {
  const width = 1024
  const height = 512
  const { canvas, ctx } = makeCanvas(width, height)
  const name = (brand.name || 'ARC').toUpperCase()

  // Panel.
  const panel = ctx.createLinearGradient(0, 0, width, height)
  // A backlit sign in daylight: a saturated brand blue that survives tone mapping.
  // The old near-black navy rendered as a dead black hole beside a sunny road.
  panel.addColorStop(0, '#1f6fc4')
  panel.addColorStop(0.55, '#14559e')
  panel.addColorStop(1, '#0c3c78')
  ctx.fillStyle = panel
  ctx.fillRect(0, 0, width, height)

  // Sheen + grid so the panel reads as printed board, not a flat rectangle.
  const sheen = ctx.createLinearGradient(0, 0, width * 0.7, height)
  sheen.addColorStop(0, 'rgba(120, 205, 255, 0.16)')
  sheen.addColorStop(0.6, 'rgba(120, 205, 255, 0.02)')
  sheen.addColorStop(1, 'rgba(120, 205, 255, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, width, height)

  // Gold frame.
  ctx.strokeStyle = 'rgba(248, 198, 55, 0.85)'
  ctx.lineWidth = 6
  ctx.strokeRect(14, 14, width - 28, height - 28)
  ctx.strokeStyle = 'rgba(255, 236, 170, 0.35)'
  ctx.lineWidth = 2
  ctx.strokeRect(26, 26, width - 52, height - 52)

  // The project mark, left of the wordmark.
  const markBox = 190
  const markX = 74
  const markY = (height - markBox) / 2
  if (mark) {
    const ratio = Math.min(markBox / mark.box.width, markBox / mark.box.height)
    const dw = mark.box.width * ratio
    const dh = mark.box.height * ratio
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = 18
    ctx.drawImage(
      mark.canvas,
      mark.box.x,
      mark.box.y,
      mark.box.width,
      mark.box.height,
      markX + (markBox - dw) / 2,
      markY + (markBox - dh) / 2,
      dw,
      dh
    )
    ctx.restore()
  } else {
    ctx.save()
    ctx.translate(markX + markBox / 2, height / 2)
    drawArchEmblem(ctx, markBox, markBox / 2, '#f4fbff')
    ctx.restore()
  }

  // Divider.
  ctx.fillStyle = 'rgba(248, 198, 55, 0.7)'
  ctx.fillRect(markX + markBox + 22, 118, 4, height - 236)

  // Wordmark, tagline and site — stacked with room to breathe.
  const textX = markX + markBox + 62
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#f2f9ff'
  ctx.font = `700 ${Math.round(height * 0.3)}px Orbitron, Rajdhani, system-ui, sans-serif`
  ctx.fillText(name.slice(0, 10), textX, height * 0.47)

  const tagline = (brand.tags[0] ?? 'Layer 1').toUpperCase()
  ctx.fillStyle = GOLD
  ctx.font = `600 ${Math.round(height * 0.1)}px Rajdhani, system-ui, sans-serif`
  ctx.fillText(tagline.slice(0, 26), textX + 4, height * 0.66)

  const site = (brand.website ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (site) {
    ctx.fillStyle = 'rgba(168, 214, 255, 0.9)'
    ctx.font = `500 ${Math.round(height * 0.082)}px Rajdhani, system-ui, sans-serif`
    ctx.fillText(site.slice(0, 28), textX + 4, height * 0.84)
  }

  // Corner ticks.
  ctx.strokeStyle = 'rgba(126, 214, 255, 0.5)'
  ctx.lineWidth = 4
  const corner = 34
  for (const [cx, cy, sx, sy] of [
    [34, 34, 1, 1],
    [width - 34, 34, -1, 1],
    [34, height - 34, 1, -1],
    [width - 34, height - 34, -1, -1],
  ]) {
    ctx.beginPath()
    ctx.moveTo(cx + sx * corner, cy)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx, cy + sy * corner)
    ctx.stroke()
  }

  arcArtwork.billboard = canvas
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
