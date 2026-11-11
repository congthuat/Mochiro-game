// Arc Rush — endless runner leaderboard + profile persistence.
const { Router } = require('express')
const { dbQuery } = require('@surf-ai/sdk/db')

const router = Router()

const clampInt = (value, min, max) => {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

const NAME_MIN = 2
const NAME_MAX = 20

const trimName = (value) => String(value ?? '').trim().slice(0, NAME_MAX)
const cleanName = (value) => trimName(value) || 'Runner'

/**
 * A name belongs to one player. Two rows reading "Makoto" on the leaderboard is not a
 * cosmetic problem — nobody can tell whose run is whose, and the second person silently
 * impersonates the first. The check ignores your own row, so keeping your name is always
 * allowed; only taking someone else's is not.
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

async function fetchBoard() {
  const [top, stats] = await Promise.all([
    dbQuery(
      `SELECT id, name, score, coins, distance_m, top_speed, best_combo, duration_s, created_at
         FROM runner_runs
        ORDER BY score DESC, created_at ASC
        LIMIT 20`
    ),
    dbQuery(
      `SELECT COUNT(*)::int AS runs,
              COALESCE(SUM(coins), 0)::int AS coins,
              COALESCE(MAX(score), 0)::int AS best_score,
              COALESCE(MAX(distance_m), 0)::int AS best_distance
         FROM runner_runs`
    ),
  ])
  return {
    entries: top.rows,
    stats: stats.rows[0] ?? { runs: 0, coins: 0, best_score: 0, best_distance: 0 },
  }
}

// GET /api/runner/leaderboard
router.get('/leaderboard', async (_req, res) => {
  try {
    res.json(await fetchBoard())
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
  try {
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

// POST /api/runner/runs — submit a finished sprint.
router.post('/runs', async (req, res) => {
  const clientId = cleanClientId(req.body?.client_id)
  if (!clientId) return res.status(400).json({ error: 'invalid_client_id' })

  let name = cleanName(req.body?.name)
  const score = clampInt(req.body?.score, 0, 100_000_000)
  const coins = clampInt(req.body?.coins, 0, 1_000_000)
  const distance = clampInt(req.body?.distance_m, 0, 10_000_000)
  const topSpeed = clampInt(req.body?.top_speed, 0, 1000)
  const bestCombo = clampInt(req.body?.best_combo, 0, 100_000)
  const duration = clampInt(req.body?.duration_s, 0, 86_400)

  try {
    // A finished run must never be thrown away over a name clash. If the submitted name is
    // someone else's, the run is still recorded — under the name already on the profile.
    if (await nameTaken(name, clientId)) {
      const { rows } = await dbQuery('SELECT name FROM runner_profiles WHERE client_id = $1', [clientId])
      name = rows[0]?.name ?? 'Runner'
    }
    const inserted = await dbQuery(
      `INSERT INTO runner_runs (client_id, name, score, coins, distance_m, top_speed, best_combo, duration_s)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [clientId, name, score, coins, distance, topSpeed, bestCombo, duration]
    )
    const entry = inserted.rows[0] ?? null

    const { rows: profileRows } = await dbQuery(
      `INSERT INTO runner_profiles
         (client_id, name, best_score, total_score, total_coins, best_distance, best_combo, runs)
       VALUES ($1, $2, $3, $3, $4, $5, $6, 1)
       ON CONFLICT (client_id) DO UPDATE SET
         name = EXCLUDED.name,
         best_score = GREATEST(runner_profiles.best_score, EXCLUDED.best_score),
         total_score = runner_profiles.total_score + EXCLUDED.total_score,
         total_coins = runner_profiles.total_coins + EXCLUDED.total_coins,
         best_distance = GREATEST(runner_profiles.best_distance, EXCLUDED.best_distance),
         best_combo = GREATEST(runner_profiles.best_combo, EXCLUDED.best_combo),
         runs = runner_profiles.runs + 1,
         updated_at = NOW()
       RETURNING *`,
      [clientId, name, score, coins, distance, bestCombo]
    )

    const { rows: rankRows } = await dbQuery(
      'SELECT COUNT(*)::int + 1 AS rank FROM runner_runs WHERE score > $1',
      [score]
    )

    res.json({ entry, profile: profileRows[0] ?? null, rank: rankRows[0]?.rank ?? null })
  } catch (error) {
    console.error('[runner] run submit failed', error)
    res.status(500).json({ error: 'submit_failed' })
  }
})

module.exports = router
