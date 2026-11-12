// Aetherfall — game persistence schema.
// Tables are auto-created / synced by the Surf SDK on startup and on change.
const {
  pgTable,
  serial,
  text,
  integer,
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
  best_score: integer("best_score").notNull().default(0),
  total_score: integer("total_score").notNull().default(0),
  total_coins: integer("total_coins").notNull().default(0),
  best_distance: integer("best_distance").notNull().default(0),
  best_combo: integer("best_combo").notNull().default(0),
  runs: integer("runs").notNull().default(0),
  // ---- Economy (server-authoritative; see routes/economy.js) ----
  // Spendable coins, carried across runs.
  bank: integer("bank").notNull().default(0),
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
  delta: integer("delta").notNull(),
  // 'run' | 'buy:char:<id>' | 'buy:up:<kind>' | 'daily' | 'quest:<id>' | 'season:<key>' | 'welcome'
  // | 'ach:<tier ids>' | 'invite:welcome' | 'invite:friend'
  reason: text("reason").notNull(),
  balance: integer("balance"),
  created_at: timestamp("created_at").defaultNow(),
});

// Arc Rush — one row per finished sprint, feeds the runner leaderboard.
exports.runner_runs = pgTable("runner_runs", {
  id: serial("id").primaryKey(),
  client_id: text("client_id").notNull(),
  name: text("name").notNull().default("Runner"),
  score: integer("score").notNull().default(0),
  coins: integer("coins").notNull().default(0),
  distance_m: integer("distance_m").notNull().default(0),
  top_speed: integer("top_speed").notNull().default(0),
  best_combo: integer("best_combo").notNull().default(0),
  duration_s: integer("duration_s").notNull().default(0),
  // Signed-in account that played the run (null for guests).
  account_id: integer("account_id"),
  // True only when the run came with a valid server ticket, from a signed-in player,
  // and passed the plausibility checks. Only verified runs reach the public board.
  verified: boolean("verified").notNull().default(false),
  // Why a run was kept off the board (null when verified).
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

// Bearer sessions handed to the client after a successful sign-in.
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
});
