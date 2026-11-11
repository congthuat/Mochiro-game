const express = require("express");
const { dbQuery } = require("@surf-ai/sdk/db");

const router = express.Router();

const MAX_NAME = 24;
const MAX_SCORE = 100000000;

function cleanName(raw) {
  if (typeof raw !== "string") return "Guardian";
  const trimmed = raw.replace(/[\u0000-\u001f\u007f<>]/g, "").trim();
  return (trimmed || "Guardian").slice(0, MAX_NAME);
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(MAX_SCORE, Math.round(n)));
}

// GET /api/leaderboard — top runs + global stats.
router.get("/", async (_req, res) => {
  try {
    const { rows } = await dbQuery(
      `SELECT id, name, score, zone_reached, shards, kills, duration_s, victory, created_at
         FROM runs
        ORDER BY score DESC, created_at ASC
        LIMIT 20`
    );
    const { rows: statRows } = await dbQuery(
      `SELECT COUNT(*)::int AS runs,
              COALESCE(SUM(shards), 0)::int AS shards,
              COUNT(*) FILTER (WHERE victory)::int AS victories,
              COALESCE(MAX(score), 0)::int AS best_score
         FROM runs`
    );
    res.json({ entries: rows, stats: statRows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leaderboard — submit a finished run, update the player profile.
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const clientId =
      typeof body.client_id === "string" && body.client_id.length >= 8
        ? body.client_id.slice(0, 64)
        : null;
    if (!clientId) {
      res.status(400).json({ error: "client_id is required" });
      return;
    }

    const name = cleanName(body.name);
    const score = toInt(body.score);
    const zoneReached = Math.max(1, Math.min(5, toInt(body.zone_reached, 1)));
    const shards = toInt(body.shards);
    const kills = toInt(body.kills);
    const duration = toInt(body.duration_s);
    const victory = body.victory === true;

    const { rows: runRows } = await dbQuery(
      `INSERT INTO runs (client_id, name, score, zone_reached, shards, kills, duration_s, victory)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, score, zone_reached, shards, kills, duration_s, victory, created_at`,
      [clientId, name, score, zoneReached, shards, kills, duration, victory]
    );

    const { rows: playerRows } = await dbQuery(
      `INSERT INTO players (client_id, name, best_score, total_score, total_shards, total_kills, runs, victories, best_zone)
       VALUES ($1, $2, $3, $3, $4, $5, 1, $6, $7)
       ON CONFLICT (client_id) DO UPDATE SET
         name = EXCLUDED.name,
         best_score = GREATEST(players.best_score, EXCLUDED.best_score),
         total_score = players.total_score + EXCLUDED.total_score,
         total_shards = players.total_shards + EXCLUDED.total_shards,
         total_kills = players.total_kills + EXCLUDED.total_kills,
         runs = players.runs + 1,
         victories = players.victories + EXCLUDED.victories,
         best_zone = GREATEST(players.best_zone, EXCLUDED.best_zone),
         updated_at = now()
       RETURNING id, client_id, name, best_score, total_score, total_shards, total_kills, runs, victories, best_zone`,
      [clientId, name, score, shards, kills, victory ? 1 : 0, zoneReached]
    );

    res.json({ entry: runRows[0] || null, profile: playerRows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
