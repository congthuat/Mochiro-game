# Mochiro live race server

Cloudflare Worker + Durable Objects that referee "Đua Trực Tiếp" races.

- `src/logic.js` — the referee (lobby, countdown, eliminations, standings, anti-cheat). No transport.
- `src/index.js` — the Worker: routing, one `Room` Durable Object per room, one `Matchmaker`.
- `src/crypto.js` — Ed25519 tickets (from the game backend) and signed results (to it).

Deploy: `npx wrangler deploy`, then `npx wrangler secret put RESULT_KEY` (the private key
whose public half is in `backend/routes/race.js`).
