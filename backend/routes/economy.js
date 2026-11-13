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
//   POST /api/economy/achievement { client_id, group? }   (claims every reached tier)
//   POST /api/economy/invite  { client_id, code }          (a new account joins via a link)
//   POST /api/economy/invite/claim { client_id }           (welcome bonus, both sides paid)
//   GET  /api/economy/invite/:code                         (who sent this link)
const { Router } = require('express')
const { dbQuery } = require('../db/client')

const router = Router()
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

// ------------------------------------------------------------- catalog --
// Balance model (measured on live runs: ~5 Arc/s, average run ≈ 730 Arc / 2.4 min).
// A regular player (≈10 min a day) earns ≈ 3,000 from runs + ≈ 800 daily login
// + ≈ 1,200 from quests ≈ 5,000 Arc a day. Runs stay the main income (~60%), but
// showing up every day and finishing quests is worth ~40% — not a rounding error.
//   first paid hero  ≈ 2 days · every hero ≈ 2.5 weeks · every upgrade maxed ≈ +1 month

/**
 * Hero prices. Two starters are free; every other hero costs the same, because each one
 * is a different way to play rather than a stronger tier — the perks are balanced as
 * sidegrades (see CHARACTERS in the client config). ≈ 4 days of regular income each.
 */
const HERO_PRICE = 20000
const CHARACTER_PRICES = {
  kai: 0, // Sam — starts with a shield
  mika: 0, // Bobbilee — helpful power-ups last +20%
  bjorn: HERO_PRICE, // Teddyz — immune to the three bad pick-ups
  nyx: HERO_PRICE, // Lecter — faster lane changes, close calls score double
  rin: HERO_PRICE, // Mike — always pulls nearby coins, magnet reaches 45% further
  tim: HERO_PRICE, // Tim — Overdrive lasts twice as long
}

/** Each level stretches that power-up by +10% (max +50%). Costs climb per level. */
const UPGRADE_KINDS = ['magnet', 'boost', 'double', 'ghost']
const UPGRADE_COSTS = [2000, 4000, 7000, 11000, 16000]
const UPGRADE_MAX = UPGRADE_COSTS.length
const UPGRADE_STEP = 0.1

/** Login streak rewards, day 1 … day 7 (≈ 6,000 a week; day 7 is the big one). */
const DAILY_REWARDS = [300, 400, 500, 600, 800, 1000, 2000]

/** Daily quest pool. Three are picked per UTC day, the same three for everybody. */
const QUEST_POOL = [
  { id: 'runs', stat: 'runs', target: 5, reward: 300 },
  { id: 'distance', stat: 'distance', target: 10000, reward: 400 },
  { id: 'coins', stat: 'coins', target: 1500, reward: 400 },
  { id: 'score', stat: 'best_score', target: 200000, reward: 500 },
  { id: 'combo', stat: 'best_combo', target: 100, reward: 400 },
  { id: 'time', stat: 'seconds', target: 600, reward: 300 },
]
const QUESTS_PER_DAY = 3

/** Weekly season payout by final rank (signed-in, verified runs only). */
function seasonReward(rank) {
  if (rank === 1) return 10000
  if (rank === 2) return 6000
  if (rank === 3) return 4000
  if (rank <= 10) return 2000
  return 0
}

/**
 * Lifetime achievements. Each group has tiers [target, reward]; a tier id is the group id
 * plus its 1-based tier ("distance3"). Thresholds come from live runs (median run ≈ 1.7 km
 * and 50k points, top 10% ≈ 18 km and 1.8M), so tier 1 lands in the first sessions and the
 * last tier is a months-long goal. All tiers together ≈ 67k Arc — about two weeks of normal
 * income, spread over the whole life of an account.
 */
const ACHIEVEMENTS = [
  { id: 'distance', metric: 'best_distance', tiers: [[1000, 300], [2500, 800], [5000, 1500], [10000, 3000], [25000, 6000]] },
  { id: 'score', metric: 'best_score', tiers: [[50000, 300], [250000, 800], [1000000, 2000], [3000000, 5000]] },
  { id: 'combo', metric: 'best_combo', tiers: [[100, 300], [300, 1000], [600, 2500]] },
  { id: 'runs', metric: 'runs', tiers: [[10, 300], [50, 1000], [200, 3000], [500, 6000]] },
  { id: 'coins', metric: 'coins', tiers: [[5000, 300], [25000, 1000], [100000, 3000], [300000, 6000]] },
  { id: 'hard', metric: 'hard_distance', tiers: [[1000, 500], [3000, 1500], [8000, 4000]] },
  { id: 'heroes', metric: 'heroes', tiers: [[3, 500], [6, 3000]] },
  { id: 'upgrades', metric: 'maxed', tiers: [[1, 1000], [4, 4000]] },
  { id: 'streak', metric: 'dailies', tiers: [[7, 500], [30, 2500]] },
  { id: 'quests', metric: 'quests', tiers: [[10, 500], [50, 2000]] },
  { id: 'friends', metric: 'friends', tiers: [[1, 500], [5, 2500]] },
]

/** Invites: the friend gets a welcome bonus, the inviter a reward, once the friend runs. */
const INVITE = {
  welcome: 1000, // paid to the new player
  reward: 1500, // paid to whoever invited them
  needDistance: 1000, // one verified run at least this far proves a real player
  cap: 10, // friends per inviter that can ever pay out
  joinWindowDays: 14, // only accounts younger than this can accept an invite
}

const CATALOG = {
  characters: CHARACTER_PRICES,
  upgrades: { kinds: UPGRADE_KINDS, costs: UPGRADE_COSTS, max: UPGRADE_MAX, step: UPGRADE_STEP },
  daily: DAILY_REWARDS,
  invite: INVITE,
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

/** Lifetime numbers every achievement is measured on. Only ticketed runs count. */
async function lifetimeStats(clientId, profile) {
  const [runs, book, friends] = await Promise.all([
    dbQuery(
      `SELECT COUNT(*)::int AS runs,
              COALESCE(MAX(distance_m), 0)::int AS best_distance,
              COALESCE(MAX(score), 0)::int AS best_score,
              COALESCE(MAX(best_combo), 0)::int AS best_combo,
              COALESCE(SUM(coins), 0)::int AS coins,
              COALESCE(MAX(distance_m) FILTER (WHERE difficulty = 'hard'), 0)::int AS hard_distance
         FROM runner_runs
        WHERE client_id = $1 AND (flag IS NULL OR flag = 'guest')`,
      [clientId]
    ),
    dbQuery(
      `SELECT COUNT(*) FILTER (WHERE reason = 'daily')::int AS dailies,
              COUNT(*) FILTER (WHERE reason LIKE 'quest:%')::int AS quests
         FROM runner_ledger WHERE client_id = $1`,
      [clientId]
    ),
    dbQuery('SELECT COUNT(*)::int AS n FROM runner_profiles WHERE referred_by = $1 AND ref_paid IS TRUE', [clientId]),
  ])
  const owned = Object.keys(CHARACTER_PRICES).filter(
    (id) => CHARACTER_PRICES[id] === 0 || (profile?.unlocked ?? ',').includes(`,${id},`)
  ).length
  const maxed = UPGRADE_KINDS.filter((kind) => Number(profile?.[`up_${kind}`] ?? 0) >= UPGRADE_MAX).length
  return {
    ...(runs.rows[0] ?? {}),
    ...(book.rows[0] ?? {}),
    friends: friends.rows[0]?.n ?? 0,
    heroes: owned,
    maxed,
  }
}

/** Every group with its tiers, progress and which tiers can be claimed right now. */
function achievementState(stats, claimed) {
  return ACHIEVEMENTS.map((group) => {
    const value = Number(stats[group.metric] ?? 0)
    const tiers = group.tiers.map(([target, reward], index) => {
      const id = `${group.id}${index + 1}`
      return { id, target, reward, reached: value >= target, claimed: claimed.includes(`,${id},`) }
    })
    return { id: group.id, value, tiers }
  })
}

// Invite codes are the profile id, scrambled so they do not read as a counter.
const CODE_MUL = 7919
const CODE_ADD = 104729
const inviteCode = (profileId) => (Number(profileId) * CODE_MUL + CODE_ADD).toString(36).toUpperCase()
function profileIdFromCode(code) {
  const raw = String(code ?? '').trim()
  if (!/^[0-9A-Za-z]{3,10}$/.test(raw)) return null
  const n = parseInt(raw, 36) - CODE_ADD
  return n > 0 && n % CODE_MUL === 0 ? n / CODE_MUL : null
}

async function inviteState(clientId, p) {
  const signedIn = clientId.startsWith('arc:')
  const [joined, mine] = await Promise.all([
    signedIn
      ? dbQuery(
          `SELECT COUNT(*)::int AS joined, COUNT(*) FILTER (WHERE ref_paid IS TRUE)::int AS paid
             FROM runner_profiles WHERE referred_by = $1`,
          [clientId]
        )
      : Promise.resolve({ rows: [] }),
    p?.referred_by
      ? dbQuery(
          `SELECT (SELECT name FROM runner_profiles WHERE client_id = $2) AS by,
                  EXISTS (SELECT 1 FROM runner_runs WHERE client_id = $1 AND verified = true AND distance_m >= $3) AS ready`,
          [clientId, p.referred_by, INVITE.needDistance]
        )
      : Promise.resolve({ rows: [] }),
  ])
  const fresh = p?.created_at ? Date.now() - new Date(p.created_at).getTime() < INVITE.joinWindowDays * DAY_MS : true
  return {
    code: signedIn && p?.id ? inviteCode(p.id) : null,
    joined: joined.rows[0]?.joined ?? 0,
    paid: joined.rows[0]?.paid ?? 0,
    canJoin: signedIn && !p?.referred_by && fresh,
    mine: p?.referred_by
      ? { by: mine.rows[0]?.by ?? 'Runner', paid: Boolean(p.ref_paid), ready: Boolean(mine.rows[0]?.ready) }
      : null,
  }
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

  const [lifetime, invite] = await Promise.all([lifetimeStats(clientId, p), inviteState(clientId, p)])

  return {
    bank: Number(p?.bank ?? 0),
    unlocked,
    upgrades,
    daily,
    quests,
    resetsAt: new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString(),
    season,
    achievements: achievementState(lifetime, p?.ach_claimed ?? ','),
    lifetime: {
      runs: Number(lifetime.runs ?? 0),
      best_distance: Number(lifetime.best_distance ?? 0),
      best_score: Number(lifetime.best_score ?? 0),
      coins: Number(lifetime.coins ?? 0),
    },
    invite,
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

router.post(
  '/achievement',
  writeRoute(async (clientId, body) => {
    const { rows: prof } = await dbQuery('SELECT * FROM runner_profiles WHERE client_id = $1', [clientId])
    const p = prof[0]
    const before = p?.ach_claimed ?? ','
    const group = body.group ? String(body.group) : null
    const stats = await lifetimeStats(clientId, p)
    const due = achievementState(stats, before)
      .filter((g) => !group || g.id === group)
      .flatMap((g) => g.tiers.filter((tier) => tier.reached && !tier.claimed))
    if (!due.length) return { error: 'nothing_to_claim', status: 409 }
    const total = due.reduce((sum, tier) => sum + tier.reward, 0)
    const ids = due.map((tier) => tier.id)
    // `ach_claimed = $4` is the lock: if another tap claimed in between, this one misses.
    const { rows } = await dbQuery(
      `UPDATE runner_profiles SET bank = bank + $2, ach_claimed = COALESCE(ach_claimed, ',') || $3, updated_at = NOW()
        WHERE client_id = $1 AND COALESCE(ach_claimed, ',') = $4
        RETURNING bank`,
      [clientId, total, `${ids.join(',')},`, before]
    )
    if (!rows[0]) return { error: 'already_claimed', status: 409 }
    await ledger(clientId, total, `ach:${ids.join('+')}`, rows[0].bank)
    return { reward: total, claimed: ids }
  })
)

router.get('/invite/:code', async (req, res) => {
  const id = profileIdFromCode(req.params.code)
  if (!id) return res.status(404).json({ error: 'unknown_code' })
  try {
    const { rows } = await dbQuery(`SELECT name FROM runner_profiles WHERE id = $1 AND client_id LIKE 'arc:%'`, [id])
    if (!rows[0]) return res.status(404).json({ error: 'unknown_code' })
    res.json({ name: rows[0].name, welcome: INVITE.welcome, needDistance: INVITE.needDistance })
  } catch (error) {
    console.error('[economy] invite lookup failed', error)
    res.status(500).json({ error: 'economy_unavailable' })
  }
})

router.post(
  '/invite',
  writeRoute(async (clientId, body) => {
    if (!clientId.startsWith('arc:')) return { error: 'sign_in', status: 401 }
    const inviterId = profileIdFromCode(body.code)
    if (!inviterId) return { error: 'unknown_code', status: 404 }
    const { rows: inviter } = await dbQuery('SELECT client_id, referred_by FROM runner_profiles WHERE id = $1', [inviterId])
    const from = inviter[0]
    if (!from || !String(from.client_id).startsWith('arc:')) return { error: 'unknown_code', status: 404 }
    if (from.client_id === clientId || from.referred_by === clientId) return { error: 'self_invite', status: 409 }
    // Only a new account can join through a link; an old one has nothing to be invited to.
    const { rows: acct } = await dbQuery('SELECT created_at FROM arc_accounts WHERE address = $1', [
      clientId.slice(4).toLowerCase(),
    ])
    const born = acct[0]?.created_at ? new Date(acct[0].created_at).getTime() : 0
    if (!born || Date.now() - born > INVITE.joinWindowDays * DAY_MS) return { error: 'too_old', status: 409 }
    const { rows: count } = await dbQuery('SELECT COUNT(*)::int AS n FROM runner_profiles WHERE referred_by = $1', [
      from.client_id,
    ])
    if ((count[0]?.n ?? 0) >= INVITE.cap) return { error: 'inviter_full', status: 409 }
    const { rows } = await dbQuery(
      `UPDATE runner_profiles SET referred_by = $2, ref_at = NOW(), updated_at = NOW()
        WHERE client_id = $1 AND referred_by IS NULL
        RETURNING client_id`,
      [clientId, from.client_id]
    )
    if (!rows[0]) return { error: 'already_joined', status: 409 }
    return { joined: true }
  })
)

router.post(
  '/invite/claim',
  writeRoute(async (clientId) => {
    const { rows: ready } = await dbQuery(
      `SELECT 1 FROM runner_runs WHERE client_id = $1 AND verified = true AND distance_m >= $2 LIMIT 1`,
      [clientId, INVITE.needDistance]
    )
    if (!ready[0]) return { error: 'not_done', status: 409 }
    const { rows } = await dbQuery(
      `UPDATE runner_profiles SET ref_paid = true, bank = bank + $2, updated_at = NOW()
        WHERE client_id = $1 AND referred_by IS NOT NULL AND ref_paid IS NOT TRUE
        RETURNING bank, referred_by`,
      [clientId, INVITE.welcome]
    )
    if (!rows[0]) return { error: 'already_claimed', status: 409 }
    await ledger(clientId, INVITE.welcome, 'invite:welcome', rows[0].bank)
    const { rows: paid } = await dbQuery(
      `UPDATE runner_profiles SET bank = bank + $2, updated_at = NOW() WHERE client_id = $1 RETURNING bank`,
      [rows[0].referred_by, INVITE.reward]
    )
    if (paid[0]) await ledger(rows[0].referred_by, INVITE.reward, `invite:friend:${clientId}`, paid[0].bank)
    return { reward: INVITE.welcome }
  })
)

module.exports = router
