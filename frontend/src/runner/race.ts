// Live races ("Đua Trực Tiếp") — the connection to the race server.
//
// The server (realtime/ in the repo) is the referee: it seats players, starts everyone
// on the same seed at the same moment, relays positions and decides who is out. This
// module keeps one connection to it, keeps a clock in step with it, survives a short
// drop (the server holds a seat for five seconds) and turns its messages into one
// status object the screens render.
import { api } from '../lib/api'
import { authToken } from '../lib/auth'
import type { CharacterId } from './config'
import type { RivalSample } from './rivals'

/** The deployed race server. Empty = live races are switched off (the button hides). */
const PROD_SERVER = 'https://mochiro-race.nguyencongthuat2.workers.dev'

export function raceServer(): string {
  if (import.meta.env.DEV) {
    try {
      const local = window.localStorage.getItem('mochiro.raceServer')
      if (local) return local
    } catch {
      /* storage unavailable */
    }
  }
  return PROD_SERVER
}

export const raceAvailable = (): boolean => raceServer() !== ''

export type RaceStage = 'idle' | 'connecting' | 'lobby' | 'countdown' | 'running' | 'done' | 'error'
export type RaceError = 'ticket' | 'auth' | 'nocode' | 'started' | 'full' | 'replaced' | 'lost' | 'offline' | 'server'
export type OutReason = 'crash' | 'left' | 'dropped' | 'cheat' | 'lag' | 'time'

export interface RacePlayer {
  id: string
  name: string
  ch: CharacterId
  host: boolean
  guest: boolean
}

export interface RaceOut {
  ms: number
  d: number
  reason: OutReason
}

export interface RaceStanding {
  id: string
  name: string
  ch: CharacterId
  rank: number
  d: number
  ms: number
  reason: OutReason
  you?: boolean
}

export interface RaceReward {
  rewarded: boolean
  gold: number
  reason: string
}

export interface RaceStatus {
  stage: RaceStage
  kind: 'quick' | 'private'
  code: string | null
  you: string | null
  players: RacePlayer[]
  max: number
  /** Quick race: when the room starts on its own (Date.now() ms), null while waiting for a second racer. */
  startsAt: number | null
  /** The start, in this device's performance.now() ms. */
  goAt: number | null
  seed: number | null
  matchId: string | null
  outs: Record<string, RaceOut>
  /** Latest known distance per racer (yours included), for the standings. */
  distances: Record<string, number>
  lastId: string | null
  standings: RaceStanding[] | null
  reward: RaceReward | null
  error: RaceError | null
  reconnecting: boolean
}

export const idleRace = (): RaceStatus => ({
  stage: 'idle',
  kind: 'quick',
  code: null,
  you: null,
  players: [],
  max: 4,
  startsAt: null,
  goAt: null,
  seed: null,
  matchId: null,
  outs: {},
  distances: {},
  lastId: null,
  standings: null,
  reward: null,
  error: null,
  reconnecting: false,
})

export interface RaceHandlers {
  change: (status: RaceStatus) => void
  /** Everyone is seated and the countdown has begun: build the road. */
  start: (seed: number, players: RacePlayer[], you: string, goAt: number) => void
  sample: (id: string, sample: RivalSample) => void
  out: (id: string, out: RaceOut, self: boolean) => void
}

interface Ticket {
  ticket: string
  pid: string
}

const PENDING_KEY = 'mochiro.race.pending'

export interface PendingMatch {
  matchId: string
  pid: string
  at: number
}

export function loadPendingMatch(): PendingMatch | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as PendingMatch
    return typeof data?.matchId === 'string' && typeof data.pid === 'string' ? data : null
  } catch {
    return null
  }
}

export function clearPendingMatch(matchId?: string): void {
  try {
    if (matchId && loadPendingMatch()?.matchId !== matchId) return
    window.localStorage.removeItem(PENDING_KEY)
  } catch {
    /* storage unavailable */
  }
}

function storePendingMatch(match: PendingMatch): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(match))
  } catch {
    /* storage unavailable */
  }
}

/** How a race ended, for a player who left before the end. null = not filed (yet). */
export async function fetchMatch(match: PendingMatch): Promise<{ standings: RaceStanding[]; reward: RaceReward; you: boolean } | null | 'gone'> {
  try {
    const res = await fetch(`${api(`race/match/${match.matchId}`)}?pid=${encodeURIComponent(match.pid)}`)
    // Not filed yet (or the server is having a moment): ask again later.
    if (res.status === 404 || res.status >= 500) return null
    if (!res.ok) return 'gone'
    const data = (await res.json()) as {
      standings: RaceStanding[]
      rewarded: boolean
      gold: number
      reason: string | null
      winnerIsYou: boolean
    }
    return {
      standings: (data.standings ?? []).map((s, i) => ({ ...s, id: String(i) })),
      reward: { rewarded: Boolean(data.rewarded), gold: Number(data.gold) || 0, reason: data.reason ?? '' },
      you: Boolean(data.winnerIsYou),
    }
  } catch {
    return null
  }
}

export async function fetchRaceStats(clientId: string): Promise<{ wins: number; races: number } | null> {
  try {
    const res = await fetch(`${api('race/stats')}?clientId=${encodeURIComponent(clientId)}`)
    if (!res.ok) return null
    return (await res.json()) as { wins: number; races: number }
  } catch {
    return null
  }
}

/** Opens a private room. → its code, or an error. */
export async function createPrivateRoom(): Promise<string | RaceError> {
  try {
    const res = await fetch(`${raceServer().replace(/^ws/, 'http')}/room`, { method: 'POST' })
    if (!res.ok) return 'server'
    const data = (await res.json()) as { code?: string }
    return typeof data.code === 'string' ? data.code : 'server'
  } catch {
    return 'offline'
  }
}

export const inviteRaceLink = (code: string): string => `${window.location.origin}/?race=${encodeURIComponent(code)}`

/** A ?race=CODE link the page was opened with (removed from the address bar once read). */
export function takeRaceLink(): string | null {
  try {
    const url = new URL(window.location.href)
    const code = (url.searchParams.get('race') || '').toUpperCase()
    if (!code) return null
    url.searchParams.delete('race')
    window.history.replaceState(window.history.state, '', url.toString())
    return /^[A-HJ-NP-Z2-9]{4}$/.test(code) ? code : null
  } catch {
    return null
  }
}

export const normaliseCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[IO01]/g, '').slice(0, 4)

const RETRY_WAITS = [250, 700, 1400, 2400]

export class RaceClient {
  private ws: WebSocket | null = null
  private status: RaceStatus = idleRace()
  private ticket: Ticket | null = null
  private leaving = false
  private retry = 0
  private quickSkips = 0
  private pingTimer = 0
  private clockSamples: Array<{ rtt: number; offset: number }> = []
  private offset = 0
  private changeTimer = 0

  constructor(
    private readonly handlers: RaceHandlers,
    private readonly clientId: string,
    private readonly character: CharacterId
  ) {}

  get state(): RaceStatus {
    return this.status
  }

  /** Server time now, in ms. */
  serverNow(): number {
    return performance.now() + this.offset
  }

  async join(target: { quick: true } | { code: string }): Promise<void> {
    this.leaving = false
    this.retry = 0
    this.quickSkips = 0
    this.close()
    this.status = { ...idleRace(), stage: 'connecting', kind: 'quick' in target ? 'quick' : 'private', code: 'code' in target ? target.code : null }
    this.emit(true)
    const ticket = await this.fetchTicket()
    if (this.leaving) return
    if (!ticket) return
    this.ticket = ticket
    this.connect('quick' in target ? null : target.code)
  }

  private async fetchTicket(): Promise<Ticket | null> {
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      const token = authToken()
      if (token) headers.authorization = `Bearer ${token}`
      const res = await fetch(api('race/ticket'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ clientId: this.clientId, ch: this.character }),
      })
      if (res.status === 401) return this.fail('auth')
      if (!res.ok) return this.fail('server')
      const data = (await res.json()) as Ticket
      if (typeof data.ticket !== 'string') return this.fail('server')
      return data
    } catch {
      return this.fail('offline')
    }
  }

  private fail(error: RaceError): null {
    this.status = { ...this.status, stage: 'error', error, reconnecting: false }
    this.emit(true)
    this.close()
    return null
  }

  private connect(code: string | null, skip?: string): void {
    const base = raceServer().replace(/^http/, 'ws')
    const query = code ? `code=${encodeURIComponent(code)}` : `quick=1${skip ? `&skip=${encodeURIComponent(skip)}` : ''}`
    let ws: WebSocket
    try {
      ws = new WebSocket(`${base}/ws?${query}`)
    } catch {
      this.fail('offline')
      return
    }
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws) return
      ws.send(JSON.stringify({ type: 'hello', ticket: this.ticket?.ticket }))
      this.ping()
    }
    ws.onmessage = (event) => {
      if (this.ws !== ws) return
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(String(event.data)) as Record<string, unknown>
      } catch {
        return
      }
      this.receive(msg, ws)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      window.clearTimeout(this.pingTimer)
      this.dropped()
    }
  }

  private dropped(): void {
    const stage = this.status.stage
    if (this.leaving || stage === 'error' || stage === 'idle') return
    if (stage === 'done' && this.status.reward) return
    const code = this.status.code
    if (!code || this.retry >= RETRY_WAITS.length) {
      if (stage === 'done') return
      this.fail('lost')
      return
    }
    this.status = { ...this.status, reconnecting: true }
    this.emit(true)
    const wait = RETRY_WAITS[this.retry++]
    window.setTimeout(() => {
      if (!this.leaving && !this.ws) this.connect(code)
    }, wait)
  }

  private ping(): void {
    window.clearTimeout(this.pingTimer)
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'ping', c: performance.now() }))
    const gap = this.clockSamples.length < 6 ? 700 : 4000
    this.pingTimer = window.setTimeout(() => this.ping(), gap)
  }

  private receive(msg: Record<string, unknown>, ws: WebSocket): void {
    switch (msg.type) {
      case 'pong': {
        const c = Number(msg.c)
        const s = Number(msg.s)
        const now = performance.now()
        const rtt = now - c
        if (!Number.isFinite(rtt) || rtt < 0 || rtt > 10000) return
        this.clockSamples.push({ rtt, offset: s - (c + rtt / 2) })
        if (this.clockSamples.length > 12) this.clockSamples.shift()
        const best = this.clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a))
        this.offset = best.offset
        return
      }
      case 'room': {
        this.retry = 0
        const players = Array.isArray(msg.players) ? (msg.players as RacePlayer[]) : []
        const startsIn = typeof msg.startsIn === 'number' ? msg.startsIn : null
        const stage = this.status.stage === 'connecting' || this.status.stage === 'lobby' ? 'lobby' : this.status.stage
        this.status = {
          ...this.status,
          stage,
          kind: msg.kind === 'private' ? 'private' : 'quick',
          code: String(msg.code ?? this.status.code ?? ''),
          you: typeof msg.you === 'string' ? msg.you : this.status.you,
          players,
          max: Number(msg.max) || 4,
          startsAt: startsIn === null ? null : Date.now() + startsIn,
          reconnecting: false,
          error: null,
        }
        this.emit(true)
        return
      }
      case 'start': {
        const already = this.status.matchId === msg.matchId && this.status.goAt !== null
        const goAt = Number(msg.goAt) - this.offset
        const players = Array.isArray(msg.players) ? (msg.players as RacePlayer[]) : this.status.players
        this.status = {
          ...this.status,
          stage: performance.now() >= goAt ? 'running' : 'countdown',
          seed: Number(msg.seed) >>> 0,
          matchId: String(msg.matchId),
          goAt,
          players,
          startsAt: null,
          reconnecting: false,
        }
        if (!already) {
          storePendingMatch({ matchId: String(msg.matchId), pid: this.ticket?.pid ?? '', at: Date.now() })
          this.handlers.start(this.status.seed ?? 0, players, this.status.you ?? '', goAt)
        }
        this.emit(true)
        return
      }
      case 's': {
        const id = String(msg.id)
        const sample: RivalSample = {
          t: Number(msg.t),
          d: Number(msg.d),
          x: Number(msg.x),
          y: Number(msg.y),
          sl: Boolean(msg.sl),
          f: Number(msg.f) | 0,
        }
        if (!Number.isFinite(sample.t) || !Number.isFinite(sample.d)) return
        this.status.distances[id] = sample.d
        this.handlers.sample(id, sample)
        this.emit(false)
        return
      }
      case 'out': {
        const id = String(msg.id)
        const out: RaceOut = { ms: Number(msg.ms) || 0, d: Number(msg.d) || 0, reason: (msg.reason as OutReason) ?? 'crash' }
        if (this.status.outs[id]) return
        this.status = { ...this.status, outs: { ...this.status.outs, [id]: out }, distances: { ...this.status.distances, [id]: out.d } }
        this.handlers.out(id, out, id === this.status.you)
        this.emit(true)
        return
      }
      case 'last':
        this.status = { ...this.status, lastId: String(msg.id) }
        this.emit(true)
        return
      case 'end':
        this.status = {
          ...this.status,
          stage: 'done',
          standings: Array.isArray(msg.standings) ? (msg.standings as RaceStanding[]) : [],
        }
        this.emit(true)
        return
      case 'reward':
        this.status = {
          ...this.status,
          stage: 'done',
          reward: { rewarded: Boolean(msg.rewarded), gold: Number(msg.gold) || 0, reason: String(msg.reason ?? '') },
        }
        if (this.status.matchId) clearPendingMatch(this.status.matchId)
        this.emit(true)
        this.leaving = true
        ws.close(1000, 'done')
        return
      case 'error': {
        const raw = String(msg.code)
        if (raw === 'alone') return
        const code = raw as RaceError
        if ((code === 'started' || code === 'full') && this.status.kind === 'quick' && this.status.stage === 'connecting' && this.quickSkips < 3) {
          // The room filled or set off a moment ago: ask the matchmaker for the next one.
          this.quickSkips++
          const skip = this.status.code ?? ''
          this.ws = null
          ws.close()
          this.connect(null, skip)
          return
        }
        this.fail(code)
        return
      }
      default:
    }
  }

  /** Ten times a second while running: where this runner is. */
  sendState(state: { d: number; x: number; y: number; sl: boolean; f: number }): void {
    if (this.status.stage !== 'running' && this.status.stage !== 'countdown') return
    const you = this.status.you
    if (!you || this.status.outs[you]) return
    const ws = this.ws
    const goAt = this.status.goAt
    if (!ws || ws.readyState !== WebSocket.OPEN || goAt === null) return
    const now = performance.now()
    if (now < goAt) return
    if (this.status.stage === 'countdown') {
      this.status = { ...this.status, stage: 'running' }
      this.emit(true)
    }
    const t = Math.round(now - goAt) / 1000
    ws.send(JSON.stringify({ type: 's', t, d: state.d, x: state.x, y: state.y, sl: state.sl, f: state.f }))
    this.status.distances[you] = state.d
    this.emit(false)
  }

  /** This runner crashed. */
  sendOut(distance: number): void {
    this.ws?.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify({ type: 'out', d: Math.round(distance * 100) / 100 }))
  }

  /** While spectating: the followed racer went through something solid. */
  sendStrike(id: string, at: number, kind: string): void {
    this.ws?.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify({ type: 'strike', id, at, kind }))
  }

  /** Host only: go. */
  startNow(): void {
    this.ws?.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify({ type: 'start' }))
  }

  /** Quit: cancel the search, or give up the race keeping the place reached. */
  leave(): void {
    this.leaving = true
    const ws = this.ws
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'leave' }))
    this.close()
    this.status = idleRace()
    this.emit(true)
  }

  private close(): void {
    window.clearTimeout(this.pingTimer)
    const ws = this.ws
    this.ws = null
    if (ws) {
      try {
        ws.close(1000, 'bye')
      } catch {
        /* already closed */
      }
    }
  }

  dispose(): void {
    this.leaving = true
    this.close()
    window.clearTimeout(this.changeTimer)
  }

  /** Big changes render at once; distance ticks are batched to four renders a second. */
  private emit(now: boolean): void {
    if (now) {
      window.clearTimeout(this.changeTimer)
      this.changeTimer = 0
      this.handlers.change({ ...this.status, distances: { ...this.status.distances } })
      return
    }
    if (this.changeTimer) return
    this.changeTimer = window.setTimeout(() => {
      this.changeTimer = 0
      this.handlers.change({ ...this.status, distances: { ...this.status.distances } })
    }, 250)
  }
}
