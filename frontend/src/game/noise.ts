// Deterministic value-noise + terrain height field.
// Pure math (no three.js dependency) so it can be unit-tested in isolation.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123
  return s - Math.floor(s)
}

export class Noise2D {
  constructor(private seed: number) {}

  value(x: number, y: number): number {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
    const a = hash2(xi, yi, this.seed)
    const b = hash2(xi + 1, yi, this.seed)
    const c = hash2(xi, yi + 1, this.seed)
    const d = hash2(xi + 1, yi + 1, this.seed)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }

  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1
    let freq = 1
    let sum = 0
    let norm = 0
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.value(x * freq, y * freq)
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return sum / norm
  }
}

export interface TerrainOptions {
  seed: number
  maxHeight: number
  islandRadius: number
  /** Higher = flatter valleys, sharper peaks. */
  sharpness?: number
  /** Base water plane offset. */
  baseDrop?: number
}

export class TerrainField {
  readonly size: number
  private coarse: Noise2D
  private detail: Noise2D
  private o: Required<TerrainOptions>

  constructor(options: TerrainOptions, size = 240) {
    this.o = {
      sharpness: 1.65,
      baseDrop: 2.4,
      ...options,
    }
    this.size = size
    this.coarse = new Noise2D(options.seed)
    this.detail = new Noise2D(options.seed + 1013)
  }

  height(x: number, z: number): number {
    const o = this.o
    const base = this.coarse.fbm(x * 0.0065, z * 0.0065, 5, 2.05, 0.5)
    let h = Math.pow(base, o.sharpness) * 1.9
    const ridge = 1 - Math.abs(this.detail.value(x * 0.019, z * 0.019) * 2 - 1)
    h += ridge * 0.24 * h
    const d = Math.sqrt(x * x + z * z) / o.islandRadius
    const falloff = 1 - smoothstepLocal(0.58, 1.02, d)
    h *= falloff
    return h * o.maxHeight - o.baseDrop
  }

  /** Approximate surface normal via finite differences. */
  normal(x: number, z: number, eps = 0.75): [number, number, number] {
    const hL = this.height(x - eps, z)
    const hR = this.height(x + eps, z)
    const hD = this.height(x, z - eps)
    const hU = this.height(x, z + eps)
    const nx = hL - hR
    const nz = hD - hU
    const ny = 2 * eps
    const len = Math.hypot(nx, ny, nz) || 1
    return [nx / len, ny / len, nz / len]
  }

  /** 0 = flat ground, 1 = vertical wall. */
  slope(x: number, z: number, eps = 0.75): number {
    const [, ny] = this.normal(x, z, eps)
    return 1 - Math.min(1, Math.max(0, ny))
  }
}

function smoothstepLocal(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
