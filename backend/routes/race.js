// Mochiro — live races ("Đua Trực Tiếp").
//
// The race itself runs on a separate realtime server (realtime/, a Cloudflare Worker).
// This route is the bridge between that server and the game's accounts and Gold:
//
//   POST /api/race/ticket      "I am player X": a short signed note the realtime server
//                              checks before seating anyone. Signed-in players race as
//                              their profile; anyone else races as a one-off guest.
//   GET  /api/race/key         the public half of the ticket key, for the realtime server.
//   POST /api/race/result      the realtime server files a finished race, signed with its
//                              own key. The winner is paid here, once per race.
//   GET  /api/race/match/:id   how a race ended — for players who left before the end.
//   GET  /api/race/stats       wins and races for a profile.
//
// Payout rules (checked here, not on the realtime server, so they hold even if it were
// misconfigured): 20 Gold to the winner of a race with at least two different players,
// only for a signed-in winner, only if the race lasted 20 s, at least one other racer
// covered 200 m (no farming against an account that quits at once), nothing about the
// winner was flagged, and at most 10 paid wins per player per UTC day.
const { Router } = require('express')
const crypto = require('node:crypto')
const { dbQuery } = require('../db/client')
const { authorise } = require('../db/session')

const router = Router()
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

const WIN_GOLD = 20
const DAILY_WINS = 10
const MIN_MS = 20_000
const MIN_RIVAL_M = 200
const TICKET_TTL = 6 * 60 * 60 * 1000
const CHARACTERS = new Set(['kai', 'mika', 'bjorn', 'nyx', 'rin', 'tim', 'ezgi', 'jeremy'])

/** The realtime server's result-signing key (public half; the private half is a Worker secret). */
const RESULT_PUBLIC_KEY = 'nuUmJyYpmM2fGG6KA0S7KjcHIXUn-xUI9Xxl6nvaBOs'

// ----------------------------------------------------------------- keys --
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

const publicKeyFromRaw = (raw) =>
  crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' })

// The ticket key is derived from a server secret, so every serverless instance signs with
// the same key without storing one more secret.
const ticketSeed = crypto
  .createHash('sha256')
  .update('mochiro-race-ticket|' + (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SURF_API_KEY || 'dev'))
  .digest()
const ticketPrivate = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, ticketSeed]), format: 'der', type: 'pkcs8' })
const ticketPublicRaw = crypto.createPublicKey(ticketPrivate).export({ format: 'der', type: 'spki' }).subarray(-32)
const resultPublic = publicKeyFromRaw(Buffer.from(RESULT_PUBLIC_KEY, 'base64url'))

function signTicket(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.sign(null, Buffer.from(body), ticketPrivate).toString('base64url')
  return `${body}.${sig}`
}

// ---------------------------------------------------------------- table --
// Created on first use: the schema sync does not run on the production database.
let tableReady = null
function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await dbQuery(`CREATE TABLE IF NOT EXISTS race_results (
        match_id   text PRIMARY KEY,
        room       text,
        winner_pid text,
        pids       text NOT NULL DEFAULT ',',
        players    text NOT NULL,
        rewarded   boolean NOT NULL DEFAULT false,
        gold       integer NOT NULL DEFAULT 0,
        reason     text,
        started_at timestamp,
        ended_at   timestamp,
        created_at timestamp DEFAULT now()
      )`)
      await dbQuery('CREATE INDEX IF NOT EXISTS race_results_winner ON race_results (winner_pid, created_at)')
    })().catch((error) => {
      tableReady = null
      throw error
    })
  }
  return tableReady
}

// ----------------------------------------------------------- rate limit --
const recent = new Map()
function limited(key, max, windowMs) {
  const now = Date.now()
  const list = (recent.get(key) || []).filter((t) => now - t < windowMs)
  list.push(now)
  recent.set(key, list)
  if (recent.size > 5000) for (const [k, v] of recent) if (!v.some((t) => now - t < windowMs)) recent.delete(k)
  return list.length > max
}

const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()

// --------------------------------------------------------------- routes --
router.get('/key', (_req, res) => {
  res.json({ key: ticketPublicRaw.toString('base64url') })
})

router.post('/ticket', async (req, res) => {
  try {
    if (limited('t:' + ipOf(req), 40, 10 * 60 * 1000)) return res.status(429).json({ error: 'slow_down' })
    const ch = CHARACTERS.has(req.body?.ch) ? req.body.ch : 'kai'
    const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : ''
    // The live game has no guest mode; guests exist only off Vercel (local test rigs).
    const signedIn = Boolean(req.headers.authorization) || Boolean(process.env.VERCEL)
    let pid
    let name
    let guest = false
    if (signedIn) {
      const { ok, error } = await authorise(req, clientId)
      if (!ok) return res.status(401).json({ error })
      pid = clientId
      const { rows } = await dbQuery('SELECT name FROM runner_profiles WHERE client_id = $1', [clientId])
      name = rows[0]?.name && rows[0].name !== 'Runner' ? rows[0].name : `Runner ${clientId.slice(-4).toUpperCase()}`
    } else {
      guest = true
      pid = 'g:' + crypto.randomBytes(9).toString('base64url')
      name = 'Guest ' + String(crypto.randomInt(1000, 10000))
    }
    const exp = Date.now() + TICKET_TTL
    const ticket = signTicket({ pid, name: String(name).slice(0, 24), ch, g: guest, exp, n: crypto.randomBytes(6).toString('base64url') })
    res.json({ ticket, pid, name, guest, exp })
  } catch (error) {
    console.error('[race] ticket failed', error)
    res.status(500).json({ error: 'server' })
  }
})

/** Decides the payout for a verified result. Pure, so it can be tested without a database. */
function judge(result, winsToday) {
  const players = Array.isArray(result?.players) ? result.players : []
  const pids = new Set(players.map((p) => p?.pid))
  if (players.length < 2 || pids.size !== players.length) return 'solo'
  const winner = players.find((p) => p.rank === 1)
  if (!winner) return 'no_winner'
  if (winner.g || typeof winner.pid !== 'string' || !winner.pid.startsWith('arc:')) return 'guest'
  if (!(winner.ms >= MIN_MS)) return 'short'
  if (winner.reason === 'cheat' || (Array.isArray(winner.flags) && winner.flags.length)) return 'review'
  if (!players.some((p) => p !== winner && p.d >= MIN_RIVAL_M)) return 'no_contest'
  if (winsToday >= DAILY_WINS) return 'daily_cap'
  return 'ok'
}

router.post('/result', async (req, res) => {
  try {
    const body = typeof req.body?.body === 'string' ? req.body.body : ''
    const sig = typeof req.body?.sig === 'string' ? req.body.sig : ''
    if (!body || !sig || body.length > 20_000) return res.status(400).json({ error: 'bad_request' })
    const ok = crypto.verify(null, Buffer.from(body), resultPublic, Buffer.from(sig, 'base64url'))
    if (!ok) return res.status(403).json({ error: 'signature' })
    let result
    try {
      result = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    } catch {
      return res.status(400).json({ error: 'bad_result' })
    }
    const matchId = String(result?.matchId || '')
    if (!/^[0-9a-f]{32}$/.test(matchId) || !Array.isArray(result.players) || result.players.length > 4) {
      return res.status(400).json({ error: 'bad_result' })
    }
    await ensureTable()

    const players = result.players.map((p) => ({
      pid: String(p.pid || '').slice(0, 64),
      name: String(p.name || '').slice(0, 24),
      ch: String(p.ch || '').slice(0, 24),
      g: Boolean(p.g),
      rank: Number(p.rank) || 0,
      d: Math.max(0, Math.round(Number(p.d) || 0)),
      ms: Math.max(0, Math.round(Number(p.ms) || 0)),
      reason: String(p.reason || '').slice(0, 16),
      flags: Array.isArray(p.flags) ? p.flags.map(String).slice(0, 4) : [],
    }))
    const winner = players.find((p) => p.rank === 1) || null
    const inserted = await dbQuery(
      `INSERT INTO race_results (match_id, room, winner_pid, pids, players, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0))
       ON CONFLICT (match_id) DO NOTHING RETURNING match_id`,
      [
        matchId,
        String(result.room || '').slice(0, 12),
        winner?.pid ?? null,
        ',' + players.map((p) => p.pid).join(',') + ',',
        JSON.stringify(players),
        Number(result.goAt) || Date.now(),
        Number(result.endAt) || Date.now(),
      ]
    )
    if (!inserted.rows.length) {
      // Already filed (the realtime server retried): answer with what was decided then.
      const { rows } = await dbQuery('SELECT rewarded, gold, reason FROM race_results WHERE match_id = $1', [matchId])
      return res.json({ rewarded: Boolean(rows[0]?.rewarded), gold: Number(rows[0]?.gold) || 0, reason: rows[0]?.reason || 'filed' })
    }

    let winsToday = 0
    if (winner?.pid?.startsWith('arc:')) {
      const { rows } = await dbQuery(
        `SELECT COUNT(*)::int AS n FROM race_results
          WHERE winner_pid = $1 AND rewarded AND created_at >= date_trunc('day', now())`,
        [winner.pid]
      )
      winsToday = Number(rows[0]?.n) || 0
    }
    const reason = judge({ players }, winsToday)
    if (reason !== 'ok') {
      await dbQuery('UPDATE race_results SET reason = $2 WHERE match_id = $1', [matchId, reason])
      return res.json({ rewarded: false, gold: 0, reason })
    }
    const claimed = await dbQuery(
      `UPDATE race_results SET rewarded = true, gold = $2, reason = 'ok'
        WHERE match_id = $1 AND NOT rewarded RETURNING match_id`,
      [matchId, WIN_GOLD]
    )
    if (!claimed.rows.length) return res.json({ rewarded: false, gold: 0, reason: 'filed' })
    await dbQuery(
      `INSERT INTO runner_profiles (client_id, name) VALUES ($1, 'Runner') ON CONFLICT (client_id) DO NOTHING`,
      [winner.pid]
    )
    const { rows: bank } = await dbQuery(
      'UPDATE runner_profiles SET bank = bank + $2, updated_at = NOW() WHERE client_id = $1 RETURNING bank',
      [winner.pid, WIN_GOLD]
    )
    await dbQuery('INSERT INTO runner_ledger (client_id, delta, reason, balance) VALUES ($1, $2, $3, $4)', [
      winner.pid,
      WIN_GOLD,
      'race:' + matchId.slice(0, 12),
      bank[0]?.bank ?? null,
    ]).catch((error) => console.error('[race] ledger write failed', error))
    res.json({ rewarded: true, gold: WIN_GOLD, reason: 'ok' })
  } catch (error) {
    console.error('[race] result failed', error)
    res.status(500).json({ error: 'server' })
  }
})

router.get('/match/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '')
    if (!/^[0-9a-f]{32}$/.test(id)) return res.status(400).json({ error: 'bad_request' })
    await ensureTable()
    const { rows } = await dbQuery('SELECT * FROM race_results WHERE match_id = $1', [id])
    const row = rows[0]
    if (!row) return res.status(404).json({ error: 'not_found' })
    const me = typeof req.query.pid === 'string' ? req.query.pid : ''
    let players = []
    try {
      players = JSON.parse(row.players)
    } catch {
      players = []
    }
    res.json({
      matchId: id,
      rewarded: Boolean(row.rewarded),
      gold: Number(row.gold) || 0,
      reason: row.reason || null,
      winnerIsYou: Boolean(me) && row.winner_pid === me,
      standings: players.map((p) => ({ name: p.name, ch: p.ch, rank: p.rank, d: p.d, ms: p.ms, reason: p.reason, you: Boolean(me) && p.pid === me })),
    })
  } catch (error) {
    console.error('[race] match failed', error)
    res.status(500).json({ error: 'server' })
  }
})

router.get('/stats', async (req, res) => {
  try {
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : ''
    if (!clientId.startsWith('arc:') || clientId.length > 64) return res.json({ wins: 0, races: 0 })
    await ensureTable()
    const [wins, races] = await Promise.all([
      dbQuery('SELECT COUNT(*)::int AS n FROM race_results WHERE winner_pid = $1', [clientId]),
      dbQuery('SELECT COUNT(*)::int AS n FROM race_results WHERE pids LIKE $1', ['%,' + clientId.replace(/[%_\\]/g, '') + ',%']),
    ])
    res.json({ wins: Number(wins.rows[0]?.n) || 0, races: Number(races.rows[0]?.n) || 0 })
  } catch (error) {
    console.error('[race] stats failed', error)
    res.status(500).json({ error: 'server' })
  }
})

router.judge = judge
module.exports = router
