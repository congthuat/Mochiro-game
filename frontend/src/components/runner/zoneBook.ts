// The player's book of places: every zone they have run through, kept on this device.

const KEY = 'mochiro.zones.v1'

let cache: Set<string> | null = null

export function visitedZones(): Set<string> {
  if (cache) return cache
  cache = new Set()
  try {
    const raw = window.localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    if (Array.isArray(list)) for (const name of list) if (typeof name === 'string') cache.add(name)
  } catch {
    // Private mode or a broken entry: start an empty book.
  }
  return cache
}

export function markZoneVisited(name: string): void {
  if (!name) return
  const seen = visitedZones()
  if (seen.has(name)) return
  seen.add(name)
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...seen]))
  } catch {
    // Storage full or blocked: the book still works for this session.
  }
}
