// Palette swap for the rigged heroes.
//
// Each KayKit character ships as one texture atlas, so a new costume colour means
// repainting part of the atlas. We only touch pixels whose hue falls inside a
// window, which leaves skin, leather and metal exactly as the artist painted them
// while the fabric band takes on a new hue. The result is a fresh CanvasTexture,
// so the cached original in the module loader is never disturbed.
import * as THREE from 'three'

export interface RecolorSpec {
  /** Hue window in degrees that gets repainted. Wraps when from[0] > from[1]. */
  from: [number, number]
  /** Target hue in degrees. */
  to: number
  /** Saturation multiplier (1 keeps the artist's value). */
  sat?: number
  /** Lightness multiplier. */
  light?: number
  /** Minimum colour spread before a pixel counts as "coloured". */
  threshold?: number
  /**
   * Also repaint near-grey pixels (armour, fur, plain cloth). Without this the
   * window only catches fabric that already has a hue, which leaves steel and hide
   * stuck in their original grey.
   */
  grey?: boolean
}

function hueOf(r: number, g: number, b: number, max: number, delta: number): number {
  let hue: number
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  return (hue * 60 + 360) % 360
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l]
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

/**
 * Repaints the hue window of a texture and returns a new texture. Returns the
 * original untouched when the image cannot be read (e.g. a tainted canvas).
 */
export function recolorTexture(source: THREE.Texture, spec: RecolorSpec): THREE.Texture {
  const image = source.image as (CanvasImageSource & { width?: number; height?: number }) | undefined
  const width = image?.width ?? 0
  const height = image?.height ?? 0
  if (!image || !width || !height || typeof document === 'undefined') return source

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return source

  try {
    context.drawImage(image, 0, 0, width, height)
    const imageData = context.getImageData(0, 0, width, height)
    const pixels = imageData.data
    const [lo, hi] = spec.from
    const threshold = spec.threshold ?? 0.06
    const satMul = spec.sat ?? 1
    const lightMul = spec.light ?? 1
    let touched = 0

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] / 255
      const g = pixels[i + 1] / 255
      const b = pixels[i + 2] / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const delta = max - min
      const plain = delta < threshold
      if (plain && !spec.grey) continue
      const lightness = (max + min) / 2
      if (!plain) {
        const hue = hueOf(r, g, b, max, delta)
        const inWindow = lo <= hi ? hue >= lo && hue <= hi : hue >= lo || hue <= hi
        if (!inWindow) continue
      }
      // Grey pixels carry no hue of their own, so they take a fixed share of the
      // requested saturation instead of scaling from zero.
      const saturation = plain ? 0.55 : delta / (1 - Math.abs(2 * lightness - 1) || 1)
      // Cap the lightness: a near-white surface streaks past the camera as a
      // glitch stripe, which is the one thing this art direction must never ship.
      const [nr, ng, nb] = hslToRgb(
        spec.to / 360,
        Math.min(1, saturation * satMul),
        Math.min(0.8, lightness * lightMul)
      )
      pixels[i] = nr * 255
      pixels[i + 1] = ng * 255
      pixels[i + 2] = nb * 255
      touched += 1
    }

    if (!touched) return source
    context.putImageData(imageData, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = source.colorSpace
    // glTF textures are not flipped; keep that or the whole atlas lands upside down.
    texture.flipY = source.flipY
    texture.wrapS = source.wrapS
    texture.wrapT = source.wrapT
    texture.magFilter = source.magFilter
    texture.minFilter = source.minFilter
    texture.anisotropy = source.anisotropy
    texture.needsUpdate = true
    return texture
  } catch {
    return source
  }
}
