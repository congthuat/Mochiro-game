// Mochiro live race — the referee. Pure logic, no transport: the Cloudflare Durable
// Object (src/index.js) and the tests (test/logic.test.mjs) both drive it.
//
// The referee never simulates the road (every racer's game does, from the same seed).
// It owns what must not be left to any one player: when the race starts, the clock
// every elimination is stamped with, who is still in, whether a reported distance is
// physically possible, and the signed result the game's backend pays out on.

export const RULES = {
  maxPlayers: 4,
  minPlayers: 2,
  /** Quick race: start this long after the second racer arrives (or at once when full). */
  quickWait: 15000,
  /** "3-2-1" plus a little slack for the message to land everywhere. */
  countdown: 3600,
  /** A racer whose connection is gone (or silent) this long is out, as of when it went. */
  dropAfter: 5000,
  /** Safety net only: a race still going after an hour is called on distance. */
  maxMatch: 60 * 60 * 1000,
  /** Positions are relayed at most this often per racer (ms). */
  sampleGap: 70,
  /** Lobby: a connection that never says hello is closed. */
  helloTimeout: 10000,
  /** Distinct obstacles a racer must be seen passing through before they are flagged. */
  strikeFlag: 2,
  /**
   * A racer whose game is this many seconds behind the race clock (a hidden tab, a
   * stalled device) is out: time spent frozen would otherwise outlast honest runners.
   */
  lagGrace: 8,
  /** …for this long in a row (ms), so one late packet never decides it. */
  lagHold: 2000,
}

// The game's speed ramp (frontend/src/runner/config.ts RUN): metres a racer can cover.
const START = 15
const MAX = 42
const RAMP = 150
const BOOST = 1.55

export function baseDistance(seconds) {
  const t = Math.max(0, seconds)
  const span = MAX - START
  const ramp = (u) => START * u + span * (u - (RAMP / 3.1) * (1 - Math.pow(1 - u / RAMP, 3.1)))
  if (t <= RAMP) return ramp(t)
  return ramp(RAMP) + MAX * (t - RAMP)
}

/** The farthest an honest racer could be after `seconds`, boosting the whole way. */
export function plausibleMax(seconds) {
  return baseDistance(seconds) * BOOST + 60
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function makeCode(random, length = 4) {
  let code = ''
  for (let i = 0; i < length; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)]
  return code
}

const finite = (value, lo, hi) => typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi

/**
 * One room: a lobby that becomes one race. `io` supplies the clock, the transport and
 * the two outside services (ticket check, result filing).
 *
 *   io.now()                     → ms
 *   io.random()                  → [0, 1)
 *   io.send(conn, object)
 *   io.close(conn, code, reason)
 *   io.verify(ticket)            → Promise<{ pid, name, ch, g } | null>
 *   io.finish(result)            → Promise<{ rewarded, gold, reason } | null>
 *   io.started()                 → the room no longer takes quick-race players
 */
export class RoomCore {
  constructor(code, kind, io) {
    this.code = code
    this.kind = kind === 'private' ? 'private' : 'quick'
    this.io = io
    this.state = 'lobby'
    /** pid → player */
    this.players = new Map()
    /** conn → { pid, at } */
    this.conns = new Map()
    this.order = 0
    this.firstPairAt = 0
    this.seed = 0
    this.goAt = 0
    this.matchId = ''
    this.endAt = 0
    this.result = null
    this.reward = null
    this.createdAt = io.now()
  }

  // ------------------------------------------------------------ transport --
  connect(conn) {
    this.conns.set(conn, { pid: null, at: this.io.now() })
  }

  async message(conn, raw) {
    const entry = this.conns.get(conn)
    if (!entry) return
    if (typeof raw !== 'string' || raw.length > 2048) return
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'ping') {
      this.io.send(conn, { type: 'pong', c: msg.c, s: this.io.now() })
      return
    }
    if (msg.type === 'hello') return this.hello(conn, entry, msg)
    this.advance()
    const player = entry.pid ? this.players.get(entry.pid) : null
    if (!player || player.conn !== conn) return
    switch (msg.type) {
      case 'start':
        return this.hostStart(player)
      case 's':
        return this.sample(player, msg)
      case 'out':
        return this.crashed(player, msg)
      case 'strike':
        return this.strike(player, msg)
      case 'leave':
        return this.leave(player, conn)
      default:
    }
  }

  closed(conn) {
    const entry = this.conns.get(conn)
    this.conns.delete(conn)
    if (!entry || !entry.pid) return
    const player = this.players.get(entry.pid)
    if (!player || player.conn !== conn) return
    player.conn = null
    if (this.state === 'lobby') {
      this.players.delete(player.pid)
      this.rehost()
      if (this.players.size < 2) this.firstPairAt = 0
      this.broadcastRoom()
      return
    }
    if (player.status === 'alive') player.droppedAt = this.io.now()
  }

  // ---------------------------------------------------------------- lobby --
  async hello(conn, entry, msg) {
    if (entry.pid) return
    const ticket = typeof msg.ticket === 'string' ? msg.ticket : ''
    const who = ticket ? await this.io.verify(ticket) : null
    if (!this.conns.has(conn)) return
    if (!who || typeof who.pid !== 'string') {
      this.io.send(conn, { type: 'error', code: 'ticket' })
      this.io.close(conn, 4001, 'ticket')
      return
    }
    const existing = this.players.get(who.pid)
    if (existing) {
      // The same player again: a reconnect, or a second tab taking over.
      if (existing.conn && existing.conn !== conn) {
        this.io.send(existing.conn, { type: 'error', code: 'replaced' })
        this.conns.delete(existing.conn)
        this.io.close(existing.conn, 4002, 'replaced')
      }
      existing.conn = conn
      existing.droppedAt = 0
      entry.pid = who.pid
      this.io.send(conn, this.roomMessage(existing))
      if (this.state === 'countdown' || this.state === 'running') this.io.send(conn, this.startMessage())
      if (this.state === 'running') {
        for (const other of this.players.values()) {
          if (other.status === 'out') this.io.send(conn, this.outMessage(other))
        }
      }
      if (this.state === 'done') {
        this.io.send(conn, this.endMessage())
        if (this.reward) this.io.send(conn, { type: 'reward', ...this.reward })
      }
      return
    }
    if (this.state !== 'lobby') {
      this.io.send(conn, { type: 'error', code: 'started' })
      this.io.close(conn, 4003, 'started')
      return
    }
    if (this.players.size >= RULES.maxPlayers) {
      this.io.send(conn, { type: 'error', code: 'full' })
      this.io.close(conn, 4004, 'full')
      return
    }
    const player = {
      pid: who.pid,
      id: this.publicId(),
      name: String(who.name ?? 'Runner').slice(0, 24),
      ch: String(who.ch ?? 'kai').slice(0, 24),
      guest: Boolean(who.g),
      conn,
      joined: this.order++,
      host: false,
      status: 'lobby',
      d: 0,
      lastAt: 0,
      lastT: 0,
      sentAt: 0,
      droppedAt: 0,
      lagSince: 0,
      outAt: 0,
      reason: '',
      strikes: new Set(),
      flags: new Set(),
      dq: false,
    }
    entry.pid = who.pid
    this.players.set(who.pid, player)
    this.rehost()
    if (this.players.size >= 2 && !this.firstPairAt) this.firstPairAt = this.io.now()
    this.broadcastRoom()
    if (this.kind === 'quick' && this.players.size >= RULES.maxPlayers) this.beginCountdown()
  }

  publicId() {
    for (;;) {
      const id = makeCode(this.io.random, 5)
      if (![...this.players.values()].some((p) => p.id === id)) return id
    }
  }

  rehost() {
    let host = null
    for (const p of this.players.values()) {
      p.host = false
      if (!host || p.joined < host.joined) host = p
    }
    if (host) host.host = true
  }

  hostStart(player) {
    if (this.state !== 'lobby' || !player.host || this.kind !== 'private') return
    if (this.players.size < RULES.minPlayers) {
      this.io.send(player.conn, { type: 'error', code: 'alone' })
      return
    }
    this.beginCountdown()
  }

  beginCountdown() {
    if (this.state !== 'lobby') return
    const now = this.io.now()
    this.state = 'countdown'
    this.seed = Math.floor(this.io.random() * 0xffffffff) >>> 0
    this.goAt = now + RULES.countdown
    let id = ''
    for (let i = 0; i < 4; i++) id += Math.floor(this.io.random() * 0xffffffff).toString(16).padStart(8, '0')
    this.matchId = id
    for (const p of this.players.values()) {
      p.status = 'alive'
      p.lastAt = this.goAt
    }
    this.io.started?.()
    this.broadcast(this.startMessage())
  }

  // ---------------------------------------------------------------- race --
  sample(player, msg) {
    if (this.state !== 'running' || player.status !== 'alive') return
    const now = this.io.now()
    if (!finite(msg.d, 0, 1e7) || !finite(msg.x, -10, 10) || !finite(msg.y, -2, 40) || !finite(msg.t, -5, 1e6)) return
    const f = Number.isInteger(msg.f) ? msg.f & 0xff : 0
    const seconds = (now - this.goAt) / 1000
    const d = Math.max(player.d, msg.d)
    // Faster than the game allows, even boosting the whole way.
    const limit = plausibleMax(seconds + 1.5)
    if (d > limit) {
      player.flags.add('speed')
      if (d > limit * 1.3 + 150) {
        player.dq = true
        this.eliminate(player, now, 'cheat')
        return
      }
    }
    player.d = d
    player.lastAt = now
    player.lastT = msg.t
    // Never slower than the plain speed ramp, give or take a few seconds of lost time.
    if (seconds > RULES.lagGrace && d < baseDistance(seconds - RULES.lagGrace)) {
      if (!player.lagSince) player.lagSince = now
      else if (now - player.lagSince >= RULES.lagHold) {
        this.eliminate(player, player.lagSince, 'lag')
        return
      }
    } else player.lagSince = 0
    if (now - player.sentAt < RULES.sampleGap) return
    player.sentAt = now
    this.broadcast({ type: 's', id: player.id, t: msg.t, d: player.d, x: msg.x, y: msg.y, sl: Boolean(msg.sl), f }, player)
  }

  crashed(player, msg) {
    if (player.status !== 'alive') return
    if (this.state === 'countdown') return
    if (this.state !== 'running') return
    if (finite(msg.d, 0, 1e7)) {
      const seconds = (this.io.now() - this.goAt) / 1000
      player.d = Math.max(player.d, Math.min(msg.d, plausibleMax(seconds + 1.5)))
    }
    this.eliminate(player, this.io.now(), 'crash')
  }

  strike(reporter, msg) {
    if (this.state !== 'running' || reporter.status !== 'out') return
    const target = [...this.players.values()].find((p) => p.id === msg.id)
    if (!target || target === reporter || target.status !== 'alive') return
    if (!finite(msg.at, 0, 1e7)) return
    const key = `${reporter.id}:${Math.round(msg.at / 2)}`
    target.strikes.add(key)
    if (target.strikes.size >= RULES.strikeFlag) target.flags.add('strikes')
  }

  leave(player, conn) {
    if (player.status === 'alive' && (this.state === 'running' || this.state === 'countdown')) {
      this.eliminate(player, Math.max(this.io.now(), this.goAt), 'left')
    }
    if (this.state === 'lobby') {
      this.players.delete(player.pid)
      this.rehost()
      if (this.players.size < 2) this.firstPairAt = 0
      this.broadcastRoom()
    }
    player.conn = null
    this.conns.delete(conn)
    this.io.close(conn, 1000, 'left')
  }

  eliminate(player, at, reason) {
    if (player.status !== 'alive') return
    player.status = 'out'
    player.outAt = Math.max(at, this.goAt)
    player.reason = reason
    this.broadcast(this.outMessage(player))
    const alive = [...this.players.values()].filter((p) => p.status === 'alive')
    if (alive.length === 1 && this.players.size > 1) this.broadcast({ type: 'last', id: alive[0].id })
    if (alive.length === 0) void this.end()
  }

  // ----------------------------------------------------------------- clock --
  /** Countdown over: the race is on (checked on every message, not just on the timer). */
  advance() {
    if (this.state === 'countdown' && this.io.now() >= this.goAt) this.state = 'running'
  }

  tick() {
    const now = this.io.now()
    for (const [conn, entry] of this.conns) {
      if (!entry.pid && now - entry.at > RULES.helloTimeout) {
        this.conns.delete(conn)
        this.io.close(conn, 4005, 'hello')
      }
    }
    if (this.state === 'lobby') {
      if (this.kind === 'quick' && this.players.size >= 2 && this.firstPairAt && now - this.firstPairAt >= RULES.quickWait) {
        this.beginCountdown()
      }
      return
    }
    this.advance()
    if (this.state !== 'running') return
    for (const p of this.players.values()) {
      if (p.status !== 'alive') continue
      if (!p.conn && p.droppedAt && now - p.droppedAt >= RULES.dropAfter) {
        this.eliminate(p, p.droppedAt, 'dropped')
      } else if (now - p.lastAt >= RULES.dropAfter) {
        this.eliminate(p, p.lastAt, 'dropped')
      }
    }
    if (this.state === 'running' && now - this.goAt > RULES.maxMatch) {
      for (const p of this.players.values()) if (p.status === 'alive') this.eliminate(p, now, 'time')
    }
  }

  /** Nothing left to do: the room can be forgotten. */
  get idle() {
    const now = this.io.now()
    if (this.state === 'done') return this.conns.size === 0 || now - this.endAt > 10 * 60 * 1000
    if (this.state === 'lobby') return this.players.size === 0 && this.conns.size === 0 && now - this.createdAt > 60 * 1000
    return false
  }

  // ------------------------------------------------------------------ end --
  standings() {
    const list = [...this.players.values()]
    list.sort((a, b) => {
      if (a.dq !== b.dq) return a.dq ? 1 : -1
      // Out later ranks higher; two outs within a tenth of a second are a tie on time
      // and the one who got further takes it.
      if (Math.abs(a.outAt - b.outAt) > 100) return b.outAt - a.outAt
      if (b.d !== a.d) return b.d - a.d
      return a.joined - b.joined
    })
    return list
  }

  async end() {
    if (this.state === 'done') return
    this.state = 'done'
    this.endAt = this.io.now()
    const ranked = this.standings()
    this.result = {
      v: 1,
      matchId: this.matchId,
      room: this.code,
      kind: this.kind,
      seed: this.seed,
      goAt: this.goAt,
      endAt: this.endAt,
      players: ranked.map((p, i) => ({
        pid: p.pid,
        name: p.name,
        ch: p.ch,
        g: p.guest,
        rank: i + 1,
        d: Math.round(p.d),
        ms: Math.max(0, p.outAt - this.goAt),
        reason: p.reason,
        flags: [...p.flags],
      })),
    }
    this.broadcast(this.endMessage())
    let reward = null
    try {
      reward = await this.io.finish(this.result)
    } catch {
      reward = null
    }
    this.reward = reward ?? { rewarded: false, gold: 0, reason: 'offline' }
    this.broadcast({ type: 'reward', ...this.reward })
  }

  // ------------------------------------------------------------- messages --
  publicPlayers() {
    return [...this.players.values()]
      .sort((a, b) => a.joined - b.joined)
      .map((p) => ({ id: p.id, name: p.name, ch: p.ch, host: p.host, guest: p.guest }))
  }

  roomMessage(you) {
    const now = this.io.now()
    const startsIn =
      this.state === 'lobby' && this.kind === 'quick' && this.firstPairAt
        ? Math.max(0, RULES.quickWait - (now - this.firstPairAt))
        : null
    return {
      type: 'room',
      code: this.code,
      kind: this.kind,
      state: this.state,
      you: you?.id ?? null,
      players: this.publicPlayers(),
      max: RULES.maxPlayers,
      startsIn,
      now,
    }
  }

  startMessage() {
    return {
      type: 'start',
      matchId: this.matchId,
      seed: this.seed,
      goAt: this.goAt,
      now: this.io.now(),
      players: this.publicPlayers(),
    }
  }

  outMessage(p) {
    return { type: 'out', id: p.id, ms: Math.max(0, p.outAt - this.goAt), d: Math.round(p.d), reason: p.reason }
  }

  endMessage() {
    const ranked = this.result?.players ?? []
    const byPid = new Map([...this.players.values()].map((p) => [p.pid, p]))
    return {
      type: 'end',
      matchId: this.matchId,
      standings: ranked.map((r) => ({
        id: byPid.get(r.pid)?.id ?? '',
        name: r.name,
        ch: r.ch,
        rank: r.rank,
        d: r.d,
        ms: r.ms,
        reason: r.reason,
      })),
    }
  }

  broadcastRoom() {
    for (const p of this.players.values()) if (p.conn) this.io.send(p.conn, this.roomMessage(p))
  }

  broadcast(msg, except = null) {
    for (const p of this.players.values()) {
      if (p !== except && p.conn) this.io.send(p.conn, msg)
    }
  }
}
