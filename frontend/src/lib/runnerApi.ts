// Player profile + leaderboard client for the Mochiro backend.
import { api } from './api'
import { authToken, readSession } from './auth'
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

/** JSON headers plus the session token, so wallet-bound profiles prove who is writing. */
function writeHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = authToken()
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

/**
 * Asks the server to stamp the start of a run. The ticket is spent when the result is
 * posted; without one (offline, rate limited) the run still counts for the player's own
 * profile, it just cannot reach the public board.
 */
export async function startRunnerTicket(clientId: string): Promise<string | null> {
  try {
    const response = await fetch(api('runner/runs/start'), {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ client_id: clientId }),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { ticket?: string }
    return typeof data.ticket === 'string' ? data.ticket : null
  } catch {
    return null
  }
}

export async function fetchRunnerProfile(clientId: string): Promise<RunnerProfile | null> {
  const response = await fetch(`${api('runner/profile')}?client_id=${encodeURIComponent(clientId)}`)
  if (!response.ok) return null
  const data = (await response.json()) as { profile: RunnerProfile | null }
  return data.profile ?? null
}

/** The name's own state, as the UI needs to show it. */
export type NameState = 'checking' | 'ok' | 'taken' | 'short' | 'blocked'

export async function checkRunnerName(name: string, clientId: string): Promise<NameState> {
  const response = await fetch(
    api(`runner/name-available?name=${encodeURIComponent(name)}&client_id=${encodeURIComponent(clientId)}`)
  )
  if (!response.ok) throw new Error('name_check_failed')
  const data = (await response.json()) as { available: boolean; reason: string | null }
  if (data.available) return 'ok'
  if (data.reason === 'short') return 'short'
  if (data.reason === 'blocked') return 'blocked'
  return 'taken'
}

export async function saveRunnerProfile(clientId: string, name: string): Promise<RunnerProfile | null> {
  const response = await fetch(api('runner/profile'), {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify({ client_id: clientId, name }),
  })
  if (!response.ok) return null
  const data = (await response.json()) as { profile: RunnerProfile | null }
  return data.profile ?? null
}

export type BoardScope = 'all' | 'week'

export interface SeasonInfo {
  startsAt: string
  endsAt: string
  lastWeekTop: LeaderboardEntry[]
}

export async function fetchRunnerLeaderboard(scope: BoardScope = 'all'): Promise<{
  entries: LeaderboardEntry[]
  stats: GlobalStats
  season: SeasonInfo | null
}> {
  const response = await fetch(`${api('runner/leaderboard')}?scope=${scope}`)
  if (!response.ok) throw new Error('leaderboard unavailable')
  const data = (await response.json()) as { entries: LeaderboardEntry[]; stats: GlobalStats; season?: SeasonInfo }
  return {
    entries: data.entries ?? [],
    stats: data.stats ?? { runs: 0, coins: 0, best_score: 0, best_distance: 0 },
    season: data.season ?? null,
  }
}

/** Why a run stayed off the public board (null when it is on it). */
export type OffBoardReason = 'guest' | 'unverified' | null

export async function submitRunnerRun(
  clientId: string,
  name: string,
  run: RunSubmission,
  ticket: string | null
): Promise<{
  entry: LeaderboardEntry | null
  profile: RunnerProfile | null
  rank: number | null
  offBoard: OffBoardReason
}> {
  const response = await fetch(api('runner/runs'), {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify({ client_id: clientId, name, ticket, ...run }),
  })
  if (!response.ok) throw new Error('submit failed')
  const data = (await response.json()) as {
    entry: LeaderboardEntry | null
    profile: RunnerProfile | null
    rank: number | null
    verified?: boolean
    reason?: string | null
  }
  const offBoard: OffBoardReason = data.verified ? null : data.reason === 'guest' ? 'guest' : 'unverified'
  return { entry: data.entry ?? null, profile: data.profile ?? null, rank: data.rank ?? null, offBoard }
}

// ---------------------------------------------------------------- economy --
export type UpgradeKind = 'magnet' | 'boost' | 'double' | 'ghost'

export interface QuestState {
  id: string
  target: number
  reward: number
  progress: number
  claimed: boolean
}

export interface EconomyState {
  bank: number
  unlocked: string[]
  upgrades: Record<UpgradeKind, number>
  daily: { claimable: boolean; streak: number; nextDay: number; nextReward: number; rewards: number[] }
  quests: QuestState[]
  resetsAt: string
  season: {
    key: string
    endsAt: string
    lastWeek: { key: string; rank: number | null; reward: number; claimable: boolean }
  }
  catalog: {
    characters: Record<string, number>
    upgrades: { kinds: UpgradeKind[]; costs: number[]; max: number; step: number }
    daily: number[]
  }
}

const ECONOMY_KEY = 'mochiro.economy'

/** Last known state, so the menu shows coins and locks instantly while the server answers. */
export function cachedEconomy(clientId: string): EconomyState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ECONOMY_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { clientId: string; state: EconomyState }
    return data.clientId === clientId ? data.state : null
  } catch {
    return null
  }
}

function cacheEconomy(clientId: string, state: EconomyState) {
  try {
    window.localStorage.setItem(ECONOMY_KEY, JSON.stringify({ clientId, state }))
  } catch {
    /* storage unavailable */
  }
}

export async function fetchEconomy(clientId: string): Promise<EconomyState | null> {
  try {
    const response = await fetch(`${api('economy')}?client_id=${encodeURIComponent(clientId)}`)
    if (!response.ok) return null
    const state = (await response.json()) as EconomyState
    cacheEconomy(clientId, state)
    return state
  } catch {
    return null
  }
}

export type EconomyAction =
  | { kind: 'buy'; item: string }
  | { kind: 'daily' }
  | { kind: 'quest'; quest: string }
  | { kind: 'season' }

export interface EconomyResult {
  ok: boolean
  error?: string
  reward?: number
  state?: EconomyState
}

export async function economyAction(clientId: string, action: EconomyAction): Promise<EconomyResult> {
  const { kind, ...rest } = action
  try {
    const response = await fetch(api(`economy/${kind}`), {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ client_id: clientId, ...rest }),
    })
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      reward?: number
      state?: EconomyState
    }
    if (data.state) cacheEconomy(clientId, data.state)
    if (!response.ok) return { ok: false, error: data.error ?? 'failed', state: data.state }
    return { ok: true, reward: data.reward, state: data.state }
  } catch {
    return { ok: false, error: 'offline' }
  }
}
