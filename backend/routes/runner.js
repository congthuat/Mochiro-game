// Mochiro — endless runner leaderboard + profile persistence.
//
// Anti-cheat model (the client is never trusted with the score):
//   1. POST /runs/start hands out a one-shot ticket stamped with the server's clock.
//   2. POST /runs spends that ticket. The claimed duration can never exceed the real
//      time that passed since the ticket, and score / distance / coins / speed must be
//      physically reachable in that time with the game's own tuning.
//   3. Only runs from a signed-in account that pass every check are "verified", and
//      only verified runs reach the public board. Everything else is still saved to the
//      player's own profile, so an honest offline/guest run is never thrown away.
//   4. Tickets and ticket-less submissions are rate limited per player and per IP.
//
// A profile whose id is bound to a wallet ("arc:0x…") can only be written by a session
// for that same wallet, so nobody can rename or post as somebody else.
const { Router } = require('express')
const crypto = require('node:crypto')
const { dbQuery } = require('../db/client')

const router = Router()
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

const clampInt = (value, min, max) => {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

// ------------------------------------------------------------- limits --
/**
 * Upper bounds derived from the game's tuning (frontend/src/runner/config.ts):
 * top speed 42 × hard 1.16 × boost 1.55 ≈ 75.5 m/s. Honest top players sit at
 * ~3,000 pts/s, ~46 m/s average and ~6 coins/s, so these leave generous headroom
 * for a perfect run while making forged numbers impossible.
 */
const LIMITS = {
  topSpeed: 80, // m/s
  metresPerSecond: 80,
  pointsPerSecond: 6_000,
  coinsPerSecond: 12,
  comboPerSecond: 8,
  minDuration: 3, // s
  clockSlack: 3, // s of tolerance between the client's clock and ours
  ticketMaxAgeMs: 3 * 3600 * 1000,
}

/**
 * Game modes, mirrored from frontend/src/runner/config.ts (DIFFICULTIES + RUN).
 * speed: world speed multiplier · score: points multiplier · bank: wallet multiplier.
 */
const MODES = {
  easy: { speed: 0.86, score: 0.5, bank: 0.7 },
  normal: { speed: 1, score: 1, bank: 1 },
  hard: { speed: 1.16, score: 1.5, bank: 1.3 },
}
const RUN_SPEED = { start: 15, max: 42, ramp: 150, ease: 2.1, boost: 1.55 }

/**
 * Metres a run covers in `seconds` at the mode's base speed with no boost — the speed
 * curve is deterministic, so this is exact up to a few hit-stop frames. It is what makes
 * the claimed mode checkable: an Easy run posted as Hard is ~25% too short.
 */
function baseDistance(seconds, speedMult) {
  const { start, max, ramp, ease } = RUN_SPEED
  const t = Math.min(seconds, ramp)
  const ramped = max * t - ((max - start) * ramp) / (ease + 1) * (1 - Math.pow(1 - t / ramp, ease + 1))
  return (ramped + Math.max(0, seconds - ramp) * max) * speedMult
}

const cleanMode = (value) => (value === 'easy' || value === 'hard' ? value : 'normal')

/**
 * The mode a run was really played on. Live runs sit within ~2% of their mode's curve
 * (boosts add little), and the modes are 14–16% apart, so distance ÷ time identifies
 * the mode. The claimed mode is kept when it fits; otherwise the measured one wins.
 */
function resolveMode(claimed, distance, duration) {
  const base = baseDistance(duration, 1)
  if (base <= 0) return claimed
  const ratio = distance / base
  const fit = ratio / MODES[claimed].speed
  if (fit >= 0.9 && fit <= 1.1) return claimed
  return ratio >= 1.08 ? 'hard' : ratio >= 0.93 ? 'normal' : 'easy'
}

const RATE = {
  windowSec: 600,
  ticketsPerClient: 60,
  ticketsPerIp: 200,
  untrackedPerClient: 30,
}

// --------------------------------------------------------------- names --
const NAME_MIN = 2
const NAME_MAX = 20

/** Folds diacritics, leetspeak and separators so "f.u.c.k", "đ.m" and "fvck" all match. */
function foldName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/[^a-z]/g, '')
}

// Substrings that are offensive wherever they appear.
const BLOCK_ANYWHERE = [
  'fuck', 'fvck', 'phuck', 'shit', 'bitch', 'cunt', 'nigg', 'faggot', 'whore', 'slut',
  'penis', 'vagina', 'pussy', 'porn', 'hitler', 'nazi', 'asshole', 'dickhead', 'cocksuck',
  'dmm', 'dcm', 'dkm', 'clgt', 'vcl', 'vkl', 'cailon', 'conlon', 'concac', 'dumay', 'dume',
  'dimemay', 'ditme', 'ditcon', 'occho', 'thangcho', 'conchohoang',
]
// Short words that are only offensive as the whole name (or the whole name with digits).
const BLOCK_EXACT = ['dm', 'dcm', 'vl', 'cc', 'lon', 'cac', 'deo', 'dit', 'ass', 'sex', 'fag', 'dick', 'cock', 'rape', 'kys', 'admin', 'mochiro', 'moderator']
// Real words that contain a blocked substring and must stay allowed.
const ALLOW = ['shitake', 'scunthorpe']

function nameBlocked(name) {
  const folded = foldName(name)
  if (!folded) return false
  if (BLOCK_EXACT.includes(folded)) return true
  let scrubbed = folded
  for (const word of ALLOW) scrubbed = scrubbed.split(word).join('')
  return BLOCK_ANYWHERE.some((word) => scrubbed.includes(word))
}

const trimName = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
const cleanName = (value) => trimName(value) || 'Runner'

/**
 * A name belongs to one player. The check ignores your own row, so keeping your name is
 * always allowed; only taking someone else's is not.
 */
async function nameTaken(name, clientId) {
  const { rows } = await dbQuery(
    `SELECT 1 FROM runner_profiles
      WHERE LOWER(name) = LOWER($1) AND client_id <> $2
      LIMIT 1`,
    [name, clientId]
  )
  return rows.length > 0
}

const cleanClientId = (value) => {
  const id = String(value ?? '').trim()
  return id.length >= 6 && id.length <= 80 ? id : null
}

// ------------------------------------------------------------ identity --
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return (forwarded || req.socket?.remoteAddress || 'unknown').slice(0, 64)
}

/** Resolves the bearer token (same sessions as /api/auth) into an account row, or null. */
async function sessionAccount(req) {
  const raw = req.headers.authorization || ''
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : ''
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const { rows } = await dbQuery(
    `SELECT a.* FROM arc_sessions s
       JOIN arc_accounts a ON a.id = s.account_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  )
  return rows[0] ?? null
}

/**
 * Who is allowed to act as `clientId`. Wallet-bound ids ("arc:0x…") need a live session
 * for that exact address; anonymous guest ids are allowed as before.
 * Returns { ok, account } — account is set only for a signed-in owner.
 */
async function authorise(req, clientId) {
  const account = await sessionAccount(req)
  if (clientId.startsWith('arc:')) {
    const address = clientId.slice(4).toLowerCase()
    if (!account || String(account.address).toLowerCase() !== address) return { ok: false, account: null }
    return { ok: true, account }
  }
  return { ok: true, account: null }
}

// --------------------------------------------------------------- board --
const DAY_MS = 24 * 3600 * 1000

/** Monday 00:00 UTC of the week containing `ms` — the weekly season boundary. */
function weekStart(ms) {
  const d = new Date(ms)
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return midnight - ((d.getUTCDay() + 6) % 7) * DAY_MS
}

/** Best verified run per player inside [from, to), top `limit`, under their current name. */
function boardQuery(from, to, limit) {
  return dbQuery(
    `SELECT b.id, COALESCE(p.name, b.name) AS name, b.score, b.coins, b.distance_m, b.top_speed,
            b.best_combo, b.duration_s, b.difficulty, b.created_at
       FROM (
         SELECT DISTINCT ON (client_id) *
           FROM runner_runs
          WHERE verified = true
            AND ($1::timestamp IS NULL OR created_at >= $1::timestamp)
            AND ($2::timestamp IS NULL OR created_at < $2::timestamp)
          ORDER BY client_id, score DESC, created_at ASC
       ) b
       LEFT JOIN runner_profiles p ON p.client_id = b.client_id
      ORDER BY b.score DESC, b.created_at ASC
      LIMIT ${Number(limit)}`,
    [from, to]
  )
}

async function fetchBoard(scope = 'all') {
  const now = Date.now()
  const thisWeek = weekStart(now)
  const iso = (ms) => new Date(ms).toISOString()
  const weekly = scope === 'week'
  const [top, stats, lastTop] = await Promise.all([
    weekly ? boardQuery(iso(thisWeek), null, 20) : boardQuery(null, null, 20),
    dbQuery(
      `SELECT COUNT(*)::int AS runs,
              COALESCE(SUM(coins), 0)::int AS coins,
              COALESCE(MAX(score) FILTER (WHERE verified), 0)::int AS best_score,
              COALESCE(MAX(distance_m) FILTER (WHERE verified), 0)::int AS best_distance
         FROM runner_runs`
    ),
    weekly ? boardQuery(iso(thisWeek - 7 * DAY_MS), iso(thisWeek), 3) : Promise.resolve({ rows: [] }),
  ])
  return {
    scope: weekly ? 'week' : 'all',
    entries: top.rows,
    stats: stats.rows[0] ?? { runs: 0, coins: 0, best_score: 0, best_distance: 0 },
    season: { startsAt: iso(thisWeek), endsAt: iso(thisWeek + 7 * DAY_MS), lastWeekTop: lastTop.rows },
  }
}

// GET /api/runner/leaderboard?scope=all|week
router.get('/leaderboard', async (req, res) => {
  try {
    res.json(await fetchBoard(req.query.scope === 'week' ? 'week' : 'all'))
  } catch (error) {
    console.error('[runner] leaderboard failed', error)
    res.status(500).json({ error: 'leaderboard_unavailable' })
  }
})

// GET /api/runner/profile?client_id=...
router.get('/profile', async (req, res) => {
  const clientId = cleanClientId(req.query.client_id)
  if (!clientId) return res.json({ profile: null })
  try {
    const { rows } = await dbQuery('SELECT * FROM runner_profiles WHERE client_id = $1', [clientId])
    res.json({ profile: rows[0] ?? null })
  } catch (error) {
    console.error('[runner] profile read failed', error)
    res.status(500).json({ error: 'profile_unavailable' })
  }
})

// GET /api/runner/name-available?name=...&client_id=...
router.get('/name-available', async (req, res) => {
  const name = trimName(req.query.name)
  const clientId = cleanClientId(req.query.client_id) ?? ''
  if (name.length < NAME_MIN) return res.json({ available: false, reason: 'short' })
  if (nameBlocked(name)) return res.json({ available: false, reason: 'blocked' })
  try {
    const taken = await nameTaken(name, clientId)
    res.json({ available: !taken, reason: taken ? 'taken' : null })
  } catch (error) {
    console.error('[runner] name check failed', error)
    res.status(500).json({ error: 'name_check_failed' })
  }
})

// POST /api/runner/profile  { client_id, name }
router.post('/profile', async (req, res) => {
  const clientId = cleanClientId(req.body?.client_id)
  if (!clientId) return res.status(400).json({ error: 'invalid_client_id' })
  const name = cleanName(req.body?.name)
  if (name.length < NAME_MIN) return res.status(400).json({ error: 'name_too_short' })
  if (nameBlocked(name)) return res.status(400).json({ error: 'name_blocked' })
  try {
    const { ok } = await authorise(req, clientId)
    if (!ok) return res.status(401).json({ error: 'not_your_profile' })
    if (await nameTaken(name, clientId)) return res.status(409).json({ error: 'name_taken' })
    const { rows } = await dbQuery(
      `INSERT INTO runner_profiles (client_id, name)
       VALUES ($1, $2)
       ON CONFLICT (client_id)
       DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
       RETURNING *`,
      [clientId, name]
    )
    res.json({ profile: rows[0] ?? null })
  } catch (error) {
    console.error('[runner] profile write failed', error)
    res.status(500).json({ error: 'profile_write_failed' })
  }
})

// POST /api/runner/runs/start  { client_id } → { ticket }
router.post('/runs/start', async (req, res) => {
  const clientId = cleanClientId(req.body?.client_id)
  if (!clientId) return res.status(400).json({ error: 'invalid_client_id' })
  const ip = clientIp(req)
  try {
    const { ok, account } = await authorise(req, clientId)
    if (!ok) return res.status(401).json({ error: 'not_your_profile' })

    const { rows } = await dbQuery(
      `SELECT COUNT(*) FILTER (WHERE client_id = $1)::int AS by_client,
              COUNT(*) FILTER (WHERE ip = $2)::int AS by_ip
         FROM runner_tickets
        WHERE created_at > NOW() - make_interval(secs => $3)`,
      [clientId, ip, RATE.windowSec]
    )
    const recent = rows[0] ?? { by_client: 0, by_ip: 0 }
    if (recent.by_client >= RATE.ticketsPerClient || recent.by_ip >= RATE.ticketsPerIp) {
      return res.status(429).json({ error: 'slow_down' })
    }

    const token = crypto.randomBytes(24).toString('hex')
    await dbQuery(
      'INSERT INTO runner_tickets (token, client_id, account_id, ip) VALUES ($1, $2, $3, $4)',
      [token, clientId, account?.id ?? null, ip]
    )
    // Housekeeping: old tickets are worthless; keep the table small.
    if (Math.random() < 0.05) {
      void dbQuery(`DELETE FROM runner_tickets WHERE created_at < NOW() - INTERVAL '1 day'`).catch(() => {})
    }
    res.json({ ticket: token })
  } catch (error) {
    console.error('[runner] ticket failed', error)
    res.status(500).json({ error: 'ticket_failed' })
  }
})

/** Returns null when the numbers are reachable in `duration` seconds, else the reason. */
function implausible({ score, coins, distance, topSpeed, bestCombo, duration, mode }) {
  const spec = MODES[mode]
  const base = baseDistance(duration, spec.speed)
  if (duration < LIMITS.minDuration) return 'too_short'
  if (topSpeed > LIMITS.topSpeed || topSpeed > RUN_SPEED.max * spec.speed * RUN_SPEED.boost + 2) return 'speed'
  if (distance > duration * LIMITS.metresPerSecond + 50) return 'distance'
  // Even boosting the whole way cannot beat the mode's curve by more than the boost.
  if (distance > base * RUN_SPEED.boost + 60) return 'distance'
  // …and nobody runs slower than the mode's own base speed: this is what catches an
  // easier run being posted as a harder mode.
  if (distance < base * 0.8 - 60) return 'mode'
  if (score > duration * LIMITS.pointsPerSecond * spec.score + 2_000) return 'score'
  if (coins > duration * LIMITS.coinsPerSecond + 200) return 'coins'
  if (bestCombo > duration * LIMITS.comboPerSecond + 20) return 'combo'
  // Score always includes the distance points (≥ 1 point per metre, times the mode).
  if (score + 5 < distance * spec.score) return 'score_vs_distance'
  return null
}

// POST /api/runner/runs — submit a finished sprint.
router.post('/runs', async (req, res) => {
  const clientId = cleanClientId(req.body?.client_id)
  if (!clientId) return res.status(400).json({ error: 'invalid_client_id' })

  let name = cleanName(req.body?.name)
  if (nameBlocked(name)) name = 'Runner'
  const score = clampInt(req.body?.score, 0, 100_000_000)
  const coins = clampInt(req.body?.coins, 0, 1_000_000)
  const distance = clampInt(req.body?.distance_m, 0, 10_000_000)
  const topSpeed = clampInt(req.body?.top_speed, 0, 1000)
  const bestCombo = clampInt(req.body?.best_combo, 0, 100_000)
  const duration = clampInt(req.body?.duration_s, 0, 86_400)
  let mode = cleanMode(req.body?.difficulty)
  const ticket = typeof req.body?.ticket === 'string' ? req.body.ticket.trim() : ''

  try {
    const { ok, account } = await authorise(req, clientId)
    if (!ok) return res.status(401).json({ error: 'not_your_profile' })

    // ---- verification ---------------------------------------------------
    let flag = null
    if (!account) flag = 'guest'
    // Set when this result continues a run already on record (the player revived).
    let continued = null

    if (/^[0-9a-f]{48}$/.test(ticket)) {
      // Spend the ticket atomically. A run may post twice — once at the first crash and
      // once more after its single continue — and never more.
      const { rows } = await dbQuery(
        `UPDATE runner_tickets SET uses = COALESCE(uses, 0) + 1, used_at = NOW()
          WHERE token = $1 AND client_id = $2 AND COALESCE(uses, 0) < 2
          RETURNING uses, run_id, EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS age_ms`,
        [ticket, clientId]
      )
      const spent = rows[0] ?? null
      if (!spent) flag = flag ?? 'ticket_used'
      else {
        const ageMs = Number(spent.age_ms)
        if (ageMs > LIMITS.ticketMaxAgeMs) flag = flag ?? 'ticket_expired'
        else if (duration > ageMs / 1000 + LIMITS.clockSlack) flag = flag ?? 'clock'
        if (spent.uses >= 2) {
          if (!spent.run_id) flag = flag ?? 'ticket_used'
          else {
            const { rows: prev } = await dbQuery('SELECT * FROM runner_runs WHERE id = $1 AND client_id = $2', [
              spent.run_id,
              clientId,
            ])
            continued = prev[0] ?? null
            // A continued run only ever grows.
            if (!continued || score < continued.score || duration < continued.duration_s) {
              continued = null
              flag = flag ?? 'ticket_used'
            }
          }
        }
      }
    } else {
      flag = flag ?? 'no_ticket'
      // Ticket-less posts can only ever reach the player's own profile, but still cap them.
      const { rows } = await dbQuery(
        `SELECT COUNT(*)::int AS n FROM runner_runs
          WHERE client_id = $1 AND flag = 'no_ticket'
            AND created_at > NOW() - make_interval(secs => $2)`,
        [clientId, RATE.windowSec]
      )
      if ((rows[0]?.n ?? 0) >= RATE.untrackedPerClient) return res.status(429).json({ error: 'slow_down' })
    }

    // A continued run keeps the mode it started on.
    if (continued) mode = cleanMode(continued.difficulty)
    else mode = resolveMode(mode, distance, duration)
    const reason = implausible({ score, coins, distance, topSpeed, bestCombo, duration, mode })
    if (reason) {
      // Impossible numbers are not stored at all — not even on the cheater's profile.
      console.warn('[runner] rejected run', { clientId, reason, score, distance, duration })
      return res.status(422).json({ error: 'implausible_run', reason })
    }
    // A forged second post on a used ticket is dropped, not stored as a fresh run.
    if (flag === 'ticket_used') return res.status(409).json({ error: 'ticket_used' })
    const verified = flag === null

    // A finished run must never be thrown away over a name clash. If the submitted name is
    // someone else's, the run is still recorded — under the name already on the profile.
    if (await nameTaken(name, clientId)) {
      const { rows } = await dbQuery('SELECT name FROM runner_profiles WHERE client_id = $1', [clientId])
      name = rows[0]?.name ?? 'Runner'
    }

    const RETURNING =
      'RETURNING id, name, score, coins, distance_m, top_speed, best_combo, duration_s, verified, difficulty, created_at'
    let entry
    if (continued) {
      const updated = await dbQuery(
        `UPDATE runner_runs SET name = $2, score = $3, coins = $4, distance_m = $5, top_speed = $6,
                best_combo = $7, duration_s = $8, verified = (verified AND $9), flag = COALESCE(flag, $10)
          WHERE id = $1 ${RETURNING}`,
        [continued.id, name, score, coins, distance, topSpeed, bestCombo, duration, verified, flag]
      )
      entry = updated.rows[0] ?? null
    } else {
      const inserted = await dbQuery(
        `INSERT INTO runner_runs
           (client_id, name, score, coins, distance_m, top_speed, best_combo, duration_s, account_id, verified, flag, difficulty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ${RETURNING}`,
        [clientId, name, score, coins, distance, topSpeed, bestCombo, duration, account?.id ?? null, verified, flag, mode]
      )
      entry = inserted.rows[0] ?? null
      if (entry && /^[0-9a-f]{48}$/.test(ticket)) {
        await dbQuery('UPDATE runner_tickets SET run_id = $1 WHERE token = $2', [entry.id, ticket])
      }
    }

    // Totals grow by what this post adds: the whole run, or only the part after a revive.
    const addScore = continued ? score - continued.score : score
    const addCoins = continued ? coins - continued.coins : coins
    // Coins only reach the spendable bank from runs the server handed a ticket for, scaled
    // by the mode (Easy ×0.7, Hard ×1.3). A continued run banks only what it added.
    const bankable = flag === null || flag === 'guest'
    const bankMult = MODES[mode].bank
    const bankedTotal = bankable ? Math.round(coins * bankMult) : 0
    const bankDelta = bankable ? bankedTotal - (continued ? Math.round(continued.coins * bankMult) : 0) : 0
    const { rows: profileRows } = await dbQuery(
      `INSERT INTO runner_profiles
         (client_id, name, best_score, total_score, total_coins, best_distance, best_combo, runs, bank)
       VALUES ($1, $2, $3, $7, GREATEST($8, 0), $5, $6, 1, GREATEST($9, 0))
       ON CONFLICT (client_id) DO UPDATE SET
         name = EXCLUDED.name,
         bank = GREATEST(runner_profiles.bank + $9, 0),
         best_score = GREATEST(runner_profiles.best_score, $3),
         total_score = runner_profiles.total_score + $7,
         total_coins = GREATEST(runner_profiles.total_coins + $8, 0),
         best_distance = GREATEST(runner_profiles.best_distance, EXCLUDED.best_distance),
         best_combo = GREATEST(runner_profiles.best_combo, EXCLUDED.best_combo),
         runs = runner_profiles.runs + $4,
         updated_at = NOW()
       RETURNING *`,
      [clientId, name, score, continued ? 0 : 1, distance, bestCombo, addScore, addCoins, bankDelta]
    )
    if (bankDelta !== 0 && profileRows[0]) {
      void dbQuery('INSERT INTO runner_ledger (client_id, delta, reason, balance) VALUES ($1, $2, $3, $4)', [
        clientId,
        bankDelta,
        'run',
        profileRows[0].bank,
      ]).catch(() => {})
    }

    // Rank on the public board (one line per player). Unverified runs have no rank.
    let rank = null
    if (verified) {
      const { rows: rankRows } = await dbQuery(
        `SELECT COUNT(DISTINCT client_id)::int + 1 AS rank
           FROM runner_runs
          WHERE verified = true AND score > $1 AND client_id <> $2`,
        [score, clientId]
      )
      rank = rankRows[0]?.rank ?? null
    }

    res.json({ entry, profile: profileRows[0] ?? null, rank, verified, reason: flag, banked: bankedTotal })
  } catch (error) {
    console.error('[runner] run submit failed', error)
    res.status(500).json({ error: 'submit_failed' })
  }
})

module.exports = router
