const express = require("express");
const { dbQuery } = require("@surf-ai/sdk/db");

const router = express.Router();

const MAX_NAME = 24;

function cleanName(raw) {
  if (typeof raw !== "string") return "Guardian";
  const trimmed = raw.replace(/[\u0000-\u001f\u007f<>]/g, "").trim();
  return (trimmed || "Guardian").slice(0, MAX_NAME);
}

// GET /api/profile?client_id=... — fetch a stored profile (null when new).
router.get("/", async (req, res) => {
  try {
    const clientId = String(req.query.client_id || "").slice(0, 64);
    if (clientId.length < 8) {
      res.status(400).json({ error: "client_id is required" });
      return;
    }
    const { rows } = await dbQuery(
      `SELECT id, client_id, name, best_score, total_score, total_shards, total_kills, runs, victories, best_zone
         FROM players
        WHERE client_id = $1`,
      [clientId]
    );
    res.json({ profile: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile — create or rename the profile.
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

    const { rows } = await dbQuery(
      `INSERT INTO players (client_id, name)
       VALUES ($1, $2)
       ON CONFLICT (client_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id, client_id, name, best_score, total_score, total_shards, total_kills, runs, victories, best_zone`,
      [clientId, name]
    );
    res.json({ profile: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
