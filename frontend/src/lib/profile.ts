// Player profile + leaderboard client for the Aetherfall backend.
import { api } from './api'

export interface Profile {
  id: number
  client_id: string
  name: string
  best_score: number
  total_score: number
  total_shards: number
  total_kills: number
  runs: number
  victories: number
  best_zone: number
}

export interface LeaderboardEntry {
  id: number
  name: string
  score: number
  zone_reached: number
  shards: number
  kills: number
  duration_s: number
  victory: boolean
  created_at: string
}

export interface GlobalStats {
  runs: number
  shards: number
  victories: number
  best_score: number
}

export interface RunSubmission {
  score: number
  zone_reached: number
  shards: number
  kills: number
  duration_s: number
  victory: boolean
}

const CLIENT_KEY = 'aetherfall.clientId'
const NAME_KEY = 'aetherfall.name'

export function getClientId(): string {
  if (typeof window === 'undefined') return 'server-side-client'
  try {
    const existing = window.localStorage.getItem(CLIENT_KEY)
    if (existing && existing.length >= 8) return existing
    const generated =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `ae-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    window.localStorage.setItem(CLIENT_KEY, generated)
    return generated
  } catch {
    return `ae-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  }
}

export function loadStoredName(): string {
  if (typeof window === 'undefined') return 'Guardian'
  try {
    return window.localStorage.getItem(NAME_KEY) || 'Guardian'
  } catch {
    return 'Guardian'
  }
}

export function storeName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name)
  } catch {
    /* storage unavailable — the name still lives in memory */
  }
}

export async function fetchProfile(clientId: string): Promise<Profile | null> {
  const res = await fetch(api(`profile?client_id=${encodeURIComponent(clientId)}`))
  if (!res.ok) throw new Error(`profile ${res.status}`)
  const data = (await res.json()) as { profile: Profile | null }
  return data.profile
}

export async function saveProfile(clientId: string, name: string): Promise<Profile | null> {
  const res = await fetch(api('profile'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, name }),
  })
  if (!res.ok) throw new Error(`profile ${res.status}`)
  const data = (await res.json()) as { profile: Profile | null }
  return data.profile
}

export async function fetchLeaderboard(): Promise<{ entries: LeaderboardEntry[]; stats: GlobalStats | null }> {
  const res = await fetch(api('leaderboard'))
  if (!res.ok) throw new Error(`leaderboard ${res.status}`)
  return (await res.json()) as { entries: LeaderboardEntry[]; stats: GlobalStats | null }
}

export async function submitRun(
  clientId: string,
  name: string,
  run: RunSubmission
): Promise<{ entry: LeaderboardEntry | null; profile: Profile | null }> {
  const res = await fetch(api('leaderboard'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, name, ...run }),
  })
  if (!res.ok) throw new Error(`submit ${res.status}`)
  return (await res.json()) as { entry: LeaderboardEntry | null; profile: Profile | null }
}
