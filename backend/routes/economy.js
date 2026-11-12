// Mochiro — meta-progression: coin bank, hero shop, power-up upgrades, daily login
// reward, daily quests and the weekly season payout.
//
// Everything that moves coins happens here, on the server, in a single conditional
// UPDATE (no read-then-write), so two taps on "buy" can never spend the same coins twice
// and a doctored client can never grant itself anything. The client only ever *asks*.
//
//   GET  /api/economy?client_id=…           → full state + catalog
//   POST /api/economy/buy     { client_id, item: 'char:<id>' | 'up:<kind>' }
//   POST /api/economy/daily   { client_id }
//   POST /api/economy/quest   { client_id, quest }
//   POST /api/economy/season  { client_id }
const { Router } = require('express')
const { dbQuery } = require('@surf-ai/sdk/db')

const router = Router()
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

// ------------------------------------------------------------- catalog --
/** Hero prices. Two heroes are free so a new player always has a choice. */
const CHARACTER_PRICES = { kai: 0, mika: 0, bjorn: 800, nyx: 1500, rin: 2500, tim: 4000 }

/** Each level stretches that power-up by +15%. */
const UPGRADE_KINDS = ['magnet', 'boost', 'double', 'ghost']
const UPGRADE_COSTS = [250, 500, 900, 1500, 2400]
const UPGRADE_MAX = UPGRADE_COSTS.length
const UPGRADE_STEP = 0.15

/** Login streak rewards, day 1 … day 7 (then the week starts over). */
const DAILY_REWARDS = [50, 80, 120, 160, 220, 300, 600]

/** Daily quest pool. Three are picked per UTC day, the same three for everybody. */
const QUEST_POOL = [
  { id: 'runs', stat: 'runs', target: 3, reward: 120 },
  { id: 'distance', stat: 'distance', target: 5000, reward: 150 },
  { id: 'coins', stat: 'coins', target: 400, reward: 150 },
  { id: 'score', stat: 'best_score', target: 60000, reward: 180 },
  { id: 'combo', stat: 'best_combo', target: 40, reward: 150 },
  { id: 'time', stat: 'seconds', target: 300, reward: 120 },
]
const QUESTS_PER_DAY = 3

/** Weekly season payout by final rank. */
function seasonReward(rank) {
  if (rank === 1) return 3000
  if (rank === 2) return 2000
  if (rank === 3) return 1500
  if (rank <= 10) return 600
  return 0
}

const CATALOG = {
  characters: CHARACTER_PRICES,
  upgrades: { kinds: UPGRADE_KINDS, costs: UPGRADE_COSTS, max: UPGRADE_MAX, step: UPGRADE_STEP },
  daily: DAILY_REWARDS,
}

// --------------------------------------------------------------- dates --
const DAY_MS = 24 * 3600 * 1000
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10)

/** Monday 00:00 UTC of the week containing `ms`. */
function weekStart(ms) {
  const d = new Date(ms)
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const sinceMonday = (d.getUTCDay() + 6) % 7
  return midnight - sinceMonday * DAY_MS
}

/** Deterministic pick of the day's quests (same for every player that day). */
function questsFor(day) {
  let seed = 0
  for (const ch of day) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  const pool = QUEST_POOL.slice()
  const picked = []
  while (picked.length < QUESTS_PER_DAY && pool.length) {
    seed = (seed * 1103515245 + 12345) >>> 0
    picked.push(pool.splice(seed % pool.length, 1)[0])
  }
  return picked
}

// ------------------------------------------------------------ identity --
const cleanClientId = (value) => {
  const id = String(value ?? '').trim()
  return id.length >= 6 && id.length <= 80 ? id : null
}

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

/** Wallet-bound ids ("arc:0x…") may only be spent from by that wallet's session. */
async function mayWrite(req, clientId) {
  if (!clientId.startsWith('arc:')) return true
  const account = await sessionAccount(req)
  return Boolean(account && String(account.address).toLowerCase() === clientId.slice(4).toLowerCase())
}

async function ensureProfile(clientId) {
  await dbQuery(
    `INSERT INTO runner_profiles (client_id, name) VALUES ($1, 'Runner') ON CONFLICT (client_id) DO NOTHING`,
    [clientId]
  )
}

async function ledger(clientId, delta, reason, balance) {
  await dbQuery('INSERT INTO runner_ledger (client_id, delta, reason, balance) VALUES ($1, $2, $3, $4)', [
    clientId,
    delta,
    reason,
    balance ?? null,
  ]).catch((error) => console.error('[economy] ledger write failed', error))
}

// ---------------------------------------------------------------- state --
/** Today's totals from runs that carried a valid server ticket. */
async function todayStats(clientId, now) {
  const start = new Date(`${dayKey(now)}T00:00:00Z`)
  const { rows } = await dbQuery(
    `SELECT COUNT(*)::int AS runs,
            COALESCE(SUM(distance_m), 0)::int AS distance,
            COALESCE(SUM(coins), 0)::int AS coins,
            COALESCE(MAX(score), 0)::int AS best_score,
            COALESCE(MAX(best_combo), 0)::int AS best_combo,
            COALESCE(SUM(duration_s), 0)::int AS seconds
       FROM runner_runs
      WHERE client_id = $1 AND created_at >= $2 AND (flag IS NULL OR flag = 'guest')`,
    [clientId, start.toISOString()]
  )
  return rows[0] ?? { runs: 0, distance: 0, coins: 0, best_score: 0, best_combo: 0, seconds: 0 }
}

/** Final rank of `clientId` on last week's board (verified runs, best per player). */
async function lastWeekRank(clientId, now) {
  const thisWeek = weekStart(now)
  const lastWeek = thisWeek - 7 * DAY_MS
  const { rows } = await dbQuery(
    `WITH best AS (
       SELECT client_id, MAX(score) AS score, MIN(created_at) AS first_at
         FROM runner_runs
        WHERE verified = true AND created_at >= $1 AND created_at < $2
        GROUP BY client_id
     )
     SELECT (SELECT COUNT(*) FROM best b2 WHERE b2.score > b.score)::int + 1 AS rank
       FROM best b WHERE b.client_id = $3`,
    [new Date(lastWeek).toISOString(), new Date(thisWeek).toISOString(), clientId]
  )
  return { rank: rows[0]?.rank ?? null, key: dayKey(lastWeek) }
}

async function buildState(clientId) {
  const now = Date.now()
  const today = dayKey(now)
  const yesterday = dayKey(now - DAY_MS)
  const { rows } = await dbQuery('SELECT * FROM runner_profiles WHERE client_id = $1', [clientId])
  const p = rows[0] ?? null

  const unlocked = Object.keys(CHARACTER_PRICES).filter(
    (id) => CHARACTER_PRICES[id] === 0 || (p?.unlocked ?? ',').includes(`,${id},`)
  )
  const upgrades = Object.fromEntries(UPGRADE_KINDS.map((kind) => [kind, Number(p?.[`up_${kind}`] ?? 0)]))

  // Daily login: the streak survives only if yesterday was claimed.
  const streak = Number(p?.daily_streak ?? 0)
  const claimedToday = p?.daily_last === today
  const continuing = p?.daily_last === yesterday
  const nextDay = claimedToday ? streak : continuing ? (streak % 7) + 1 : 1
  const daily = {
    claimable: !claimedToday,
    streak: claimedToday || continuing ? streak : 0,
    nextDay,
    nextReward: DAILY_REWARDS[nextDay - 1],
    rewards: DAILY_REWARDS,
  }

  const stats = await todayStats(clientId, now)
  const claimedQuests = p?.quests_day === today ? (p?.quests_claimed ?? ',') : ','
  const quests = questsFor(today).map((q) => ({
    id: q.id,
    target: q.target,
    reward: q.reward,
    progress: Math.min(q.target, Number(stats[q.stat] ?? 0)),
    claimed: claimedQuests.includes(`,${q.id},`),
  }))

  const thisWeek = weekStart(now)
  const last = await lastWeekRank(clientId, now)
  const reward = last.rank ? seasonReward(last.rank) : 0
  const season = {
    key: dayKey(thisWeek),
    endsAt: new Date(thisWeek + 7 * DAY_MS).toISOString(),
    lastWeek: {
      key: last.key,
      rank: last.rank,
      reward,
      claimable: reward > 0 && p?.season_claimed !== last.key,
    },
  }

  return {
    bank: Number(p?.bank ?? 0),
    unlocked,
    upgrades,
    daily,
    quests,
    resetsAt: new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString(),
    season,
    catalog: CATALOG,
  }
}

// --------------------------------------------------------------- routes --
router.get('/', async (req, res) => {
  const clientId = cleanClientId(req.query.client_id)
  if (!clientId) return res.status(400).json({ error: 'invalid_client_id' })
  try {
    res.json(await buildState(clientId))
  } catch (error) {
    console.error('[economy] state failed', error)
    res.status(500).json({ error: 'economy_unavailable' })
  }
})

/** Wraps a write: validates the id, checks ownership, makes sure the row exists. */
function writeRoute(handler) {
  return async (req, res) => {
    const clientId = cleanClientId(req.body?.client_id)
    if (!clientId) return res.status(400).json({ error: 'invalid_client_id' })
    try {
      if (!(await mayWrite(req, clientId))) return res.status(401).json({ error: 'not_your_profile' })
      await ensureProfile(clientId)
      const outcome = await handler(clientId, req.body ?? {})
      if (outcome?.error) return res.status(outcome.status ?? 400).json({ error: outcome.error })
      res.json({ ...(outcome ?? {}), state: await buildState(clientId) })
    } catch (error) {
      console.error('[economy] write failed', error)
      res.status(500).json({ error: 'economy_write_failed' })
    }
  }
}

router.post(
  '/buy',
  writeRoute(async (clientId, body) => {
    const item = String(body.item ?? '')
    const [kind, id] = item.split(':')

    if (kind === 'char') {
      const price = CHARACTER_PRICES[id]
      if (price === undefined) return { error: 'unknown_item' }
      if (price === 0) return { error: 'already_owned', status: 409 }
      const { rows } = await dbQuery(
        `UPDATE runner_profiles
            SET bank = bank - $2, unlocked = unlocked || $3 || ',', updated_at = NOW()
          WHERE client_id = $1 AND bank >= $2 AND POSITION(',' || $3 || ',' IN unlocked) = 0
          RETURNING bank`,
        [clientId, price, id]
      )
      if (!rows[0]) return await whyNot(clientId, price, item)
      await ledger(clientId, -price, `buy:char:${id}`, rows[0].bank)
      return { bought: item }
    }

    if (kind === 'up' && UPGRADE_KINDS.includes(id)) {
      const column = `up_${id}` // whitelisted above
      const { rows: current } = await dbQuery(`SELECT ${column} AS level FROM runner_profiles WHERE client_id = $1`, [
        clientId,
      ])
      const level = Number(current[0]?.level ?? 0)
      if (level >= UPGRADE_MAX) return { error: 'max_level', status: 409 }
      const price = UPGRADE_COSTS[level]
      // `AND level = $3` makes a double tap buy one level, not two at the old price.
      const { rows } = await dbQuery(
        `UPDATE runner_profiles
            SET bank = bank - $2, ${column} = ${column} + 1, updated_at = NOW()
          WHERE client_id = $1 AND bank >= $2 AND ${column} = $3
          RETURNING bank`,
        [clientId, price, level]
      )
      if (!rows[0]) return await whyNot(clientId, price, item)
      await ledger(clientId, -price, `buy:up:${id}`, rows[0].bank)
      return { bought: item }
    }

    return { error: 'unknown_item' }
  })
)

async function whyNot(clientId, price) {
  const { rows } = await dbQuery('SELECT bank FROM runner_profiles WHERE client_id = $1', [clientId])
  if (Number(rows[0]?.bank ?? 0) < price) return { error: 'not_enough_coins', status: 402 }
  return { error: 'already_owned', status: 409 }
}

router.post(
  '/daily',
  writeRoute(async (clientId) => {
    const now = Date.now()
    const today = dayKey(now)
    const yesterday = dayKey(now - DAY_MS)
    // One statement decides the new streak day, pays its reward and stamps today.
    const { rows } = await dbQuery(
      `UPDATE runner_profiles
          SET daily_streak = CASE WHEN daily_last = $3 THEN (daily_streak % 7) + 1 ELSE 1 END,
              bank = bank + ($4::int[])[CASE WHEN daily_last = $3 THEN (daily_streak % 7) + 1 ELSE 1 END],
              daily_last = $2,
              updated_at = NOW()
        WHERE client_id = $1 AND daily_last IS DISTINCT FROM $2
        RETURNING bank, daily_streak`,
      [clientId, today, yesterday, DAILY_REWARDS]
    )
    if (!rows[0]) return { error: 'already_claimed', status: 409 }
    const reward = DAILY_REWARDS[rows[0].daily_streak - 1]
    await ledger(clientId, reward, 'daily', rows[0].bank)
    return { reward, day: rows[0].daily_streak }
  })
)

router.post(
  '/quest',
  writeRoute(async (clientId, body) => {
    const now = Date.now()
    const today = dayKey(now)
    const quest = questsFor(today).find((q) => q.id === String(body.quest ?? ''))
    if (!quest) return { error: 'unknown_quest' }
    const stats = await todayStats(clientId, now)
    if (Number(stats[quest.stat] ?? 0) < quest.target) return { error: 'not_done', status: 409 }
    const { rows } = await dbQuery(
      `UPDATE runner_profiles
          SET quests_claimed = (CASE WHEN quests_day = $2 THEN quests_claimed ELSE ',' END) || $3 || ',',
              quests_day = $2,
              bank = bank + $4,
              updated_at = NOW()
        WHERE client_id = $1
          AND NOT (quests_day IS NOT DISTINCT FROM $2 AND POSITION(',' || $3 || ',' IN quests_claimed) > 0)
        RETURNING bank`,
      [clientId, today, quest.id, quest.reward]
    )
    if (!rows[0]) return { error: 'already_claimed', status: 409 }
    await ledger(clientId, quest.reward, `quest:${quest.id}`, rows[0].bank)
    return { reward: quest.reward }
  })
)

router.post(
  '/season',
  writeRoute(async (clientId) => {
    const last = await lastWeekRank(clientId, Date.now())
    const reward = last.rank ? seasonReward(last.rank) : 0
    if (!reward) return { error: 'no_reward', status: 409 }
    const { rows } = await dbQuery(
      `UPDATE runner_profiles SET bank = bank + $3, season_claimed = $2, updated_at = NOW()
        WHERE client_id = $1 AND season_claimed IS DISTINCT FROM $2
        RETURNING bank`,
      [clientId, last.key, reward]
    )
    if (!rows[0]) return { error: 'already_claimed', status: 409 }
    await ledger(clientId, reward, `season:${last.key}`, rows[0].bank)
    return { reward, rank: last.rank }
  })
)

module.exports = router
