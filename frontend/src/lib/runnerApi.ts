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
export async function startRunnerTicket(clientId: string, onTicketAuthLost?: () => void): Promise<string | null> {
  try {
    const response = await fetch(api('runner/runs/start'), {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ client_id: clientId }),
    })
    if (response.status === 401) onTicketAuthLost?.()
    if (!response.ok) return null
    const data = await jsonOrNull<{ ticket?: string }>(response)
    return typeof data?.ticket === 'string' ? data.ticket : null
  } catch {
    return null
  }
}

/** JSON body when the server sent JSON; null for a proxy's HTML error page or a broken body. */
async function jsonOrNull<T>(response: Response): Promise<T | null> {
  if (!(response.headers.get('content-type') ?? '').includes('json')) return null
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

/** Throws on a dropped connection (the caller decides what offline means there). */
export async function fetchRunnerProfile(clientId: string): Promise<RunnerProfile | null> {
  const response = await fetch(`${api('runner/profile')}?client_id=${encodeURIComponent(clientId)}`)
  if (!response.ok) return null
  const data = await jsonOrNull<{ profile: RunnerProfile | null }>(response)
  return data?.profile ?? null
}

/** The name's own state, as the UI needs to show it. */
export type NameState = 'checking' | 'ok' | 'taken' | 'short' | 'blocked'

export async function checkRunnerName(name: string, clientId: string): Promise<NameState> {
  const response = await fetch(
    api(`runner/name-available?name=${encodeURIComponent(name)}&client_id=${encodeURIComponent(clientId)}`)
  )
  if (!response.ok) throw new Error('name_check_failed')
  const data = await jsonOrNull<{ available: boolean; reason: string | null }>(response)
  if (!data) throw new Error('name_check_failed')
  if (data.available) return 'ok'
  if (data.reason === 'short') return 'short'
  if (data.reason === 'blocked') return 'blocked'
  return 'taken'
}

/** Never throws: a name that could not be saved is simply saved next time. */
export async function saveRunnerProfile(clientId: string, name: string): Promise<RunnerProfile | null> {
  try {
    const response = await fetch(api('runner/profile'), {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ client_id: clientId, name }),
    })
    if (!response.ok) return null
    const data = await jsonOrNull<{ profile: RunnerProfile | null }>(response)
    return data?.profile ?? null
  } catch {
    return null
  }
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
  const data = await jsonOrNull<{ entries: LeaderboardEntry[]; stats: GlobalStats; season?: SeasonInfo }>(response)
  if (!data) throw new Error('leaderboard unavailable')
  return {
    entries: data.entries ?? [],
    stats: data.stats ?? { runs: 0, coins: 0, best_score: 0, best_distance: 0 },
    season: data.season ?? null,
  }
}

/** Why a run stayed off the public board (null when it is on it). */
export type OffBoardReason = 'guest' | 'unverified' | null

/**
 * Why a submit failed. `network` and `server` are worth retrying later; `rate` is worth
 * retrying after a pause; `auth` needs the player to sign in again (the run is kept);
 * `rejected` (422 implausible run, 409 already counted) will never succeed.
 */
export type SubmitErrorKind = 'network' | 'server' | 'rate' | 'auth' | 'rejected'

export class SubmitError extends Error {
  readonly kind: SubmitErrorKind
  readonly status: number
  readonly code: string | null

  constructor(kind: SubmitErrorKind, status: number, code: string | null) {
    super(`submit ${kind}${code ? `: ${code}` : ''}`)
    this.name = 'SubmitError'
    this.kind = kind
    this.status = status
    this.code = code
  }
}

export interface SubmitResult {
  entry: LeaderboardEntry | null
  profile: RunnerProfile | null
  rank: number | null
  offBoard: OffBoardReason
  banked: number | null
  /** The score was accepted but is held for review before it may reach the board. */
  review: boolean
}

export async function submitRunnerRun(
  clientId: string,
  name: string,
  run: RunSubmission,
  ticket: string | null
): Promise<SubmitResult> {
  let response: Response
  try {
    response = await fetch(api('runner/runs'), {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ client_id: clientId, name, ticket, ...run }),
    })
  } catch {
    throw new SubmitError('network', 0, null)
  }
  const data = await jsonOrNull<{
    entry?: LeaderboardEntry | null
    profile?: RunnerProfile | null
    rank?: number | null
    verified?: boolean
    reason?: string | null
    banked?: number
    review?: boolean
    error?: string
  }>(response)
  if (!response.ok) {
    const code = typeof data?.error === 'string' ? data.error : null
    if (response.status === 401 || response.status === 403) throw new SubmitError('auth', response.status, code)
    if (response.status === 429) throw new SubmitError('rate', response.status, code)
    if (response.status === 409 || response.status === 422) throw new SubmitError('rejected', response.status, code)
    if (response.status >= 500) throw new SubmitError('server', response.status, code)
    // Any other 4xx means this payload is not going to be accepted as it is.
    throw new SubmitError('rejected', response.status, code)
  }
  // A 200 with an HTML body is a proxy or captive portal, not our server.
  if (!data) throw new SubmitError('server', response.status, null)
  const offBoard: OffBoardReason = data.verified ? null : data.reason === 'guest' ? 'guest' : 'unverified'
  return {
    entry: data.entry ?? null,
    profile: data.profile ?? null,
    rank: data.rank ?? null,
    offBoard,
    banked: typeof data.banked === 'number' ? data.banked : null,
    review: data.review === true,
  }
}

// ------------------------------------------------------------ pending runs --
/**
 * Finished runs that have not reached the server yet, kept per client id so a dropped
 * connection, a server hiccup or a reload does not lose the coins from a run. Tickets
 * expire on the server after three hours, so older entries are dropped.
 */
export interface PendingRun {
  id: string
  clientId: string
  name: string
  run: RunSubmission
  ticket: string | null
  createdAt: number
  attempts: number
}

const PENDING_PREFIX = 'mochiro.pending.'
const PENDING_MAX = 5
export const PENDING_MAX_AGE_MS = 3 * 60 * 60 * 1000

function pendingKey(clientId: string): string {
  return `${PENDING_PREFIX}${clientId}`
}

export function loadPendingRuns(clientId: string): PendingRun[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(pendingKey(clientId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    return (parsed as PendingRun[]).filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.createdAt === 'number' &&
        item.run &&
        now - item.createdAt < PENDING_MAX_AGE_MS
    )
  } catch {
    return []
  }
}

function storePendingRuns(clientId: string, runs: PendingRun[]): void {
  try {
    const kept = runs.slice(-PENDING_MAX)
    if (kept.length) window.localStorage.setItem(pendingKey(clientId), JSON.stringify(kept))
    else window.localStorage.removeItem(pendingKey(clientId))
  } catch {
    /* storage unavailable: the run is only retried while this page stays open */
  }
}

export function addPendingRun(entry: Omit<PendingRun, 'id' | 'createdAt' | 'attempts'>): PendingRun {
  const pending: PendingRun = {
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    attempts: 0,
  }
  storePendingRuns(entry.clientId, [...loadPendingRuns(entry.clientId), pending])
  return pending
}

export function removePendingRun(clientId: string, id: string): void {
  storePendingRuns(
    clientId,
    loadPendingRuns(clientId).filter((item) => item.id !== id)
  )
}

export function bumpPendingRun(clientId: string, id: string): void {
  storePendingRuns(
    clientId,
    loadPendingRuns(clientId).map((item) => (item.id === id ? { ...item, attempts: item.attempts + 1 } : item))
  )
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

export interface AchievementTier {
  id: string
  target: number
  reward: number
  reached: boolean
  claimed: boolean
}

export interface AchievementGroup {
  id: string
  value: number
  tiers: AchievementTier[]
}

export interface InviteState {
  /** Null for guests: only a signed-in player has a link to share. */
  code: string | null
  joined: number
  paid: number
  canJoin: boolean
  mine: { by: string; paid: boolean; ready: boolean } | null
}

export interface InviteCatalog {
  welcome: number
  reward: number
  needDistance: number
  cap: number
  joinWindowDays: number
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
  /** Older servers (and the offline cache from before Phase 3) may not send these. */
  achievements?: AchievementGroup[]
  lifetime?: { runs: number; best_distance: number; best_score: number; coins: number }
  invite?: InviteState
  catalog: {
    characters: Record<string, number>
    upgrades: { kinds: UpgradeKind[]; costs: number[]; max: number; step: number }
    daily: number[]
    invite?: InviteCatalog
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
    const state = await jsonOrNull<EconomyState>(response)
    if (!state) return null
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
  | { kind: 'achievement'; group?: string }
  | { kind: 'invite'; code: string }
  | { kind: 'inviteClaim' }

const ACTION_PATH: Record<EconomyAction['kind'], string> = {
  buy: 'buy',
  daily: 'daily',
  quest: 'quest',
  season: 'season',
  achievement: 'achievement',
  invite: 'invite',
  inviteClaim: 'invite/claim',
}

export interface EconomyResult {
  ok: boolean
  error?: string
  reward?: number
  state?: EconomyState
}

export async function economyAction(clientId: string, action: EconomyAction): Promise<EconomyResult> {
  const { kind, ...rest } = action
  try {
    const response = await fetch(api(`economy/${ACTION_PATH[kind]}`), {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ client_id: clientId, ...rest }),
    })
    const data =
      (await jsonOrNull<{
        error?: string
        reward?: number
        state?: EconomyState
      }>(response)) ?? {}
    if (data.state) cacheEconomy(clientId, data.state)
    // 401: the session is gone (expired, or signed out in another tab).
    if (response.status === 401) return { ok: false, error: 'signed_out' }
    if (!response.ok) return { ok: false, error: data.error ?? (response.status >= 500 ? 'offline' : 'failed'), state: data.state }
    return { ok: true, reward: data.reward, state: data.state }
  } catch {
    return { ok: false, error: 'offline' }
  }
}

// ---------------------------------------------------------------- invites --
const REF_KEY = 'mochiro.ref'

/** Reads `?ref=CODE` from the address bar once, keeps it, and tidies the URL. */
export function captureInviteCode(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    const fromUrl = url.searchParams.get('ref')
    if (fromUrl && /^[0-9A-Za-z]{3,10}$/.test(fromUrl)) {
      window.localStorage.setItem(REF_KEY, fromUrl.toUpperCase())
      url.searchParams.delete('ref')
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    }
    return window.localStorage.getItem(REF_KEY)
  } catch {
    return null
  }
}

export function forgetInviteCode(): void {
  try {
    window.localStorage.removeItem(REF_KEY)
  } catch {
    /* storage unavailable */
  }
}

export async function lookupInvite(code: string): Promise<{ name: string; welcome: number; needDistance: number } | null> {
  try {
    const response = await fetch(api(`economy/invite/${encodeURIComponent(code)}`))
    if (!response.ok) return null
    return await jsonOrNull<{ name: string; welcome: number; needDistance: number }>(response)
  } catch {
    return null
  }
}

export function inviteLink(code: string): string {
  return `https://mochiro.xyz/?ref=${encodeURIComponent(code)}`
}
