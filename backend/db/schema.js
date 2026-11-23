// Aetherfall — game persistence schema.
// Tables are auto-created / synced by the Surf SDK on startup and on change.
const {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
} = require("drizzle-orm/pg-core");

// One row per browser profile (keyed by a client-generated uuid).
exports.players = pgTable("players", {
  id: serial("id").primaryKey(),
  client_id: text("client_id").notNull().unique(),
  name: text("name").notNull().default("Guardian"),
  best_score: integer("best_score").notNull().default(0),
  total_score: integer("total_score").notNull().default(0),
  total_shards: integer("total_shards").notNull().default(0),
  total_kills: integer("total_kills").notNull().default(0),
  runs: integer("runs").notNull().default(0),
  victories: integer("victories").notNull().default(0),
  best_zone: integer("best_zone").notNull().default(1),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// Arc Rush (endless runner) — one row per browser profile.
exports.runner_profiles = pgTable("runner_profiles", {
  id: serial("id").primaryKey(),
  client_id: text("client_id").notNull().unique(),
  name: text("name").notNull().default("Runner"),
  best_score: bigint("best_score", { mode: "number" }).notNull().default(0),
  total_score: bigint("total_score", { mode: "number" }).notNull().default(0),
  total_coins: bigint("total_coins", { mode: "number" }).notNull().default(0),
  best_distance: integer("best_distance").notNull().default(0),
  best_combo: integer("best_combo").notNull().default(0),
  runs: integer("runs").notNull().default(0),
  // ---- Economy (server-authoritative; see routes/economy.js) ----
  // Spendable coins, carried across runs.
  bank: bigint("bank", { mode: "number" }).notNull().default(0),
  // Comma-wrapped list of bought heroes, e.g. ",bjorn,nyx," (free heroes are implied).
  unlocked: text("unlocked").notNull().default(","),
  // Power-up upgrade levels, 0..5 each.
  up_magnet: integer("up_magnet").notNull().default(0),
  up_boost: integer("up_boost").notNull().default(0),
  up_double: integer("up_double").notNull().default(0),
  up_ghost: integer("up_ghost").notNull().default(0),
  // Daily login reward: streak day 1..7 and the UTC day (YYYY-MM-DD) last claimed.
  daily_streak: integer("daily_streak").notNull().default(0),
  daily_last: text("daily_last"),
  // Daily quests: the UTC day the claims below belong to, and the claimed ids ",a,b,".
  quests_day: text("quests_day"),
  quests_claimed: text("quests_claimed").notNull().default(","),
  // Weekly season: the last season key (e.g. 2026-11-09) whose reward was paid out.
  season_claimed: text("season_claimed"),
  // Achievements: claimed tier ids, comma-wrapped, e.g. ",distance1,runs1,".
  ach_claimed: text("ach_claimed").notNull().default(","),
  // Invites: the inviter's client id, and whether the welcome bonus was paid out.
  referred_by: text("referred_by"),
  ref_paid: boolean("ref_paid").notNull().default(false),
  ref_at: timestamp("ref_at"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// Every coin that enters or leaves a bank, for auditing and support.
exports.runner_ledger = pgTable("runner_ledger", {
  id: serial("id").primaryKey(),
  client_id: text("client_id").notNull(),
  delta: bigint("delta", { mode: "number" }).notNull(),
  // 'run' | 'buy:char:<id>' | 'buy:up:<kind>' | 'daily' | 'quest:<id>' | 'season:<key>' | 'welcome'
  // | 'ach:<tier ids>' | 'invite:welcome' | 'invite:friend' | 'topup:<pack>'
  reason: text("reason").notNull(),
  balance: bigint("balance", { mode: "number" }),
  created_at: timestamp("created_at").defaultNow(),
});

// Arc top-ups paid in testnet USDC on Arc (see routes/wallet.js). The tx hash is the
// primary key, so one on-chain payment can be credited exactly once.
exports.runner_topups = pgTable("runner_topups", {
  tx_hash: text("tx_hash").primaryKey(),
  client_id: text("client_id").notNull(),
  // Lower-case sender address (always the signed-in account's own wallet).
  address: text("address").notNull(),
  pack: text("pack").notNull(),
  // USDC actually paid, as a decimal string (18-decimal native USDC).
  usdc: text("usdc").notNull(),
  arc: bigint("arc", { mode: "number" }).notNull(),
  block_number: bigint("block_number", { mode: "number" }),
  created_at: timestamp("created_at").defaultNow(),
});

// Arc Rush — one row per finished sprint, feeds the runner leaderboard.
exports.runner_runs = pgTable("runner_runs", {
  id: serial("id").primaryKey(),
  client_id: text("client_id").notNull(),
  name: text("name").notNull().default("Runner"),
  score: bigint("score", { mode: "number" }).notNull().default(0),
  coins: bigint("coins", { mode: "number" }).notNull().default(0),
  distance_m: bigint("distance_m", { mode: "number" }).notNull().default(0),
  top_speed: integer("top_speed").notNull().default(0),
  best_combo: integer("best_combo").notNull().default(0),
  duration_s: integer("duration_s").notNull().default(0),
  // Signed-in account that played the run.
  account_id: integer("account_id"),
  // True only when the run came with a valid server ticket, from a signed-in player,
  // and passed the plausibility checks. Only verified runs reach the public board.
  verified: boolean("verified").notNull().default(false),
  // Why a run was kept off the board (null when verified). 'review' = passed every check
  // but beat anything on record; it is kept and banked, and waits for a person.
  flag: text("flag"),
  // Game mode the run was played on: easy | normal | hard.
  difficulty: text("difficulty").notNull().default("normal"),
  created_at: timestamp("created_at").defaultNow(),
});

// Arc Rush — one-shot run tickets. The server stamps the start of every run, so a
// submitted duration can never exceed the real time that passed, and every ticket
// can be spent exactly once.
exports.runner_tickets = pgTable("runner_tickets", {
  token: text("token").primaryKey(),
  client_id: text("client_id").notNull(),
  account_id: integer("account_id"),
  ip: text("ip"),
  // How many results were posted on it: 1 for the run, 2 after a continue (revive).
  uses: integer("uses").notNull().default(0),
  // The run row the first result created; a revive updates it instead of adding a run.
  run_id: integer("run_id"),
  created_at: timestamp("created_at").defaultNow(),
  used_at: timestamp("used_at"),
});

// One row per completed (or failed) run — feeds the leaderboard.
exports.runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  client_id: text("client_id").notNull(),
  name: text("name").notNull().default("Guardian"),
  score: integer("score").notNull().default(0),
  zone_reached: integer("zone_reached").notNull().default(1),
  shards: integer("shards").notNull().default(0),
  kills: integer("kills").notNull().default(0),
  duration_s: integer("duration_s").notNull().default(0),
  victory: boolean("victory").notNull().default(false),
  created_at: timestamp("created_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// Accounts (Arc Rush sign-in)
//
// A player can sign in with a browser wallet (SIWE, proven by a signature) or
// with Google. Google sign-in mints an Arc wallet on the device, and the
// account row is linked to that address once the device proves it owns the key.
// ---------------------------------------------------------------------------

// One row per signed-in player.
exports.arc_accounts = pgTable("arc_accounts", {
  id: serial("id").primaryKey(),
  // Lower-cased 0x address that owns this account.
  address: text("address").notNull().unique(),
  // 'wallet' | 'google'
  method: text("method").notNull().default("wallet"),
  // Google subject id (stable per Google account), null for wallet accounts.
  google_sub: text("google_sub").unique(),
  email: text("email"),
  display_name: text("display_name"),
  // 'eoa' for an injected browser wallet, 'embedded' for a device-minted one.
  wallet_kind: text("wallet_kind").notNull().default("eoa"),
  created_at: timestamp("created_at").defaultNow(),
  last_seen_at: timestamp("last_seen_at").defaultNow(),
});

// Bearer sessions handed to the client after a successful sign-in. `token` holds the
// SHA-256 of the bearer token (rows from before Nov 2026 hold the raw token).
exports.arc_sessions = pgTable("arc_sessions", {
  token: text("token").primaryKey(),
  account_id: integer("account_id").notNull(),
  created_at: timestamp("created_at").defaultNow(),
  expires_at: timestamp("expires_at").notNull(),
});

// One-shot SIWE challenges, consumed by the signature check.
exports.arc_challenges = pgTable("arc_challenges", {
  nonce: text("nonce").primaryKey(),
  address: text("address").notNull(),
  message: text("message").notNull(),
  created_at: timestamp("created_at").defaultNow(),
  expires_at: timestamp("expires_at").notNull(),
  consumed_at: timestamp("consumed_at"),
  // Requesting IP, for the per-IP challenge rate limit.
  ip: text("ip"),
});

// Live races ("Đua Trực Tiếp"), one row per finished race, filed by the realtime server
// (routes/race.js creates it on first use in production). `players` is the JSON standings,
// `pids` is ",pid1,pid2," for lookups.
exports.race_results = pgTable("race_results", {
  match_id: text("match_id").primaryKey(),
  room: text("room"),
  winner_pid: text("winner_pid"),
  pids: text("pids").notNull().default(","),
  players: text("players").notNull(),
  rewarded: boolean("rewarded").notNull().default(false),
  gold: integer("gold").notNull().default(0),
  reason: text("reason"),
  started_at: timestamp("started_at"),
  ended_at: timestamp("ended_at"),
  created_at: timestamp("created_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// Indexes (created by hand on the production database — the schema sync does not run
// there). Kept here so the list lives next to the tables:
//   runner_runs     (verified, client_id, score DESC)   -- boards, rank
//   runner_runs     (client_id, created_at)             -- daily stats, rate limit
//   runner_ledger   (client_id)
//   runner_profiles (referred_by)                        -- invite cap
//   runner_profiles UNIQUE (lower(name)) WHERE lower(name) <> 'runner'  -- one name, one player
//   runner_tickets  (created_at), (ip, created_at)       -- rate limit, cleanup
//   arc_challenges  (expires_at), (ip, created_at)
//   arc_sessions    (account_id)
//   runner_topups   (client_id, created_at)
//   race_results    (winner_pid, created_at)             -- daily win cap (made by routes/race.js)
// ---------------------------------------------------------------------------
