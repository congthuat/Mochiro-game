// Player profile + leaderboard client for the Mochiro backend.
import { api } from './api'
import { readSession } from './auth'
import type { GlobalStats, LeaderboardEntry, RunnerProfile, RunSubmission } from '../runner/types'

const CLIENT_KEY = 'arcrush.clientId'
const NAME_KEY = 'arcrush.name'

export function getRunnerClientId(): string {
  if (typeof window === 'undefined') return 'server-side-client'
  // Signed in? The profile follows the wallet address, so progress survives a
  // new device as soon as the player signs in again.
  const account = readSession()?.account
  if (account?.address) return `arc:${account.address.toLowerCase()}`
  try {
    const existing = window.localStorage.getItem(CLIENT_KEY)
    if (existing && existing.length >= 8) return existing
    const generated =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `ar-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    window.localStorage.setItem(CLIENT_KEY, generated)
    return generated
  } catch {
    return `ar-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  }
}

export function loadRunnerName(): string {
  if (typeof window === 'undefined') return 'Runner'
  try {
    return window.localStorage.getItem(NAME_KEY) || 'Runner'
  } catch {
    return 'Runner'
  }
}

export function storeRunnerName(name: string): void {
  if (typeof window === 'undefined') return
  // An empty string is not a name. Writing one would erase the only record of the last
  // valid name, which is what the field restores itself from.
  if (!name.trim()) return
  try {
    window.localStorage.setItem(NAME_KEY, name)
  } catch {
    /* storage unavailable */
  }
}

export async function fetchRunnerProfile(clientId: string): Promise<RunnerProfile | null> {
  const response = await fetch(`${api('runner/profile')}?client_id=${encodeURIComponent(clientId)}`)
  if (!response.ok) return null
  const data = (await response.json()) as { profile: RunnerProfile | null }
  return data.profile ?? null
}

/** The name's own state, as the UI needs to show it. */
export type NameState = 'checking' | 'ok' | 'taken' | 'short'

export async function checkRunnerName(name: string, clientId: string): Promise<NameState> {
  const response = await fetch(
    api(`runner/name-available?name=${encodeURIComponent(name)}&client_id=${encodeURIComponent(clientId)}`)
  )
  if (!response.ok) throw new Error('name_check_failed')
  const data = (await response.json()) as { available: boolean; reason: string | null }
  if (data.available) return 'ok'
  return data.reason === 'short' ? 'short' : 'taken'
}

export async function saveRunnerProfile(clientId: string, name: string): Promise<RunnerProfile | null> {
  const response = await fetch(api('runner/profile'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, name }),
  })
  if (!response.ok) return null
  const data = (await response.json()) as { profile: RunnerProfile | null }
  return data.profile ?? null
}

export async function fetchRunnerLeaderboard(): Promise<{
  entries: LeaderboardEntry[]
  stats: GlobalStats
}> {
  const response = await fetch(api('runner/leaderboard'))
  if (!response.ok) throw new Error('leaderboard unavailable')
  const data = (await response.json()) as { entries: LeaderboardEntry[]; stats: GlobalStats }
  return { entries: data.entries ?? [], stats: data.stats ?? { runs: 0, coins: 0, best_score: 0, best_distance: 0 } }
}

export async function submitRunnerRun(
  clientId: string,
  name: string,
  run: RunSubmission
): Promise<{ entry: LeaderboardEntry | null; profile: RunnerProfile | null; rank: number | null }> {
  const response = await fetch(api('runner/runs'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, name, ...run }),
  })
  if (!response.ok) throw new Error('submit failed')
  const data = (await response.json()) as {
    entry: LeaderboardEntry | null
    profile: RunnerProfile | null
    rank: number | null
  }
  return { entry: data.entry ?? null, profile: data.profile ?? null, rank: data.rank ?? null }
}
