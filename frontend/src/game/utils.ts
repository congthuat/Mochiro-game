// Tiny event emitter + math helpers used across the game runtime.

export type Listener = (...args: any[]) => void

export class Emitter {
  private map = new Map<string, Set<Listener>>()

  on(event: string, fn: Listener): () => void {
    let set = this.map.get(event)
    if (!set) {
      set = new Set()
      this.map.set(event, set)
    }
    set.add(fn)
    return () => set!.delete(fn)
  }

  emit(event: string, ...args: any[]): void {
    const set = this.map.get(event)
    if (!set) return
    for (const fn of Array.from(set)) {
      try {
        fn(...args)
      } catch (err) {
        // A broken listener must never kill the render loop.
        console.error('[game] listener error', event, err)
      }
    }
  }

  clear(): void {
    this.map.clear()
  }
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt))

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export const randRange = (rng: () => number, min: number, max: number): number =>
  min + rng() * (max - min)

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const rest = s % 60
  return `${m}:${rest.toString().padStart(2, '0')}`
}

export function formatScore(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}
