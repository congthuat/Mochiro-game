// Small math / formatting helpers shared by the runner runtime.
import { getLang } from '../lib/i18n'

// Numbers follow the interface language: 5.444.623 and 58,25 km in Vietnamese, 5,444,623
// and 58.25 km in English. The menu used to mix both — "5,444,623" beside "26.093 Arc".
const formatters = new Map<string, Intl.NumberFormat>()
function fmt(digits: number): Intl.NumberFormat {
  const lang = getLang()
  const key = `${lang}:${digits}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    formatters.set(key, f)
  }
  return f
}

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value

export const clamp01 = (value: number): number => clamp(value, 0, 1)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Frame-rate independent exponential smoothing. */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt))

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1))
  return t * t * (3 - 2 * t)
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2

/** Deterministic 32-bit PRNG (mulberry32) so runs can be replayed from a seed. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const randRange = (rng: () => number, min: number, max: number): number => min + rng() * (max - min)

export const randInt = (rng: () => number, min: number, max: number): number =>
  Math.floor(randRange(rng, min, max + 1))

export const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]

export function formatScore(value: number): string {
  return fmt(0).format(Math.max(0, Math.round(value)))
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${fmt(2).format(value / 1_000_000)}M`
  if (value >= 10_000) return `${fmt(1).format(value / 1000)}k`
  return formatScore(value)
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${fmt(2).format(meters / 1000)} km`
  return `${Math.round(meters)} m`
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatSpeed(unitsPerSecond: number): number {
  // 1 world unit ≈ 1 metre; show km/h for a familiar "speed" read-out.
  return Math.round(unitsPerSecond * 3.6)
}

/** Tiny typed event emitter. */
export class Emitter<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<(payload: never) => void>>()

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler as (payload: never) => void)
    return () => {
      set?.delete(handler as (payload: never) => void)
    }
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event)
    if (!set) return
    for (const handler of set) {
      try {
        ;(handler as (value: Events[K]) => void)(payload)
      } catch (error) {
        console.error(`[arcrush] listener for "${String(event)}" failed`, error)
      }
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}
