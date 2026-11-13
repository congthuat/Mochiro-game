// One place every route gets its database from.
//
// Production (mochiro.xyz on Vercel) talks straight to its own Neon Postgres through
// DATABASE_URL, so signing in no longer depends on a gateway key that expires. Anywhere
// DATABASE_URL is not set (the Studio sandbox), queries keep going through the Surf SDK
// exactly as before.
//
// Both paths return the same shape — { rows, rowCount, fields } — and the Neon path parses
// values the way the Surf gateway hands them back (counts and numerics as numbers,
// timestamps as ISO strings ending in Z), so the routes behave identically on either.
//
// Schema changes: the SDK only syncs backend/db/schema.js into the sandbox database. When
// a table or column is added there, apply the same change to Neon by hand
// (ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...) before deploying code that uses it.
//
// node-postgres already treats sslmode=require as verify-full and warns about it on every
// cold start; saying verify-full outright keeps the same behaviour without the noise.
const URL = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').replace(
  /([?&])sslmode=require\b/,
  '$1sslmode=verify-full'
)

function isoFromTimestamp(raw) {
  // `timestamp without time zone` arrives as "2026-11-13 08:40:49.519485"; the database
  // runs in UTC, so this is a UTC wall-clock time.
  return /^\d{4}-\d{2}-\d{2} /.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw
}

function isoFromTimestamptz(raw) {
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? raw : d.toISOString()
}

const NUMBER = (raw) => (raw === null ? null : Number(raw))
const PARSERS = {
  20: NUMBER, // int8 — COUNT(*), SUM(int)
  1700: NUMBER, // numeric
  1114: isoFromTimestamp, // timestamp
  1184: isoFromTimestamptz, // timestamptz
  1082: (raw) => `${raw}T00:00:00Z`, // date
}

let pool = null
function getPool() {
  if (pool) return pool
  const { Pool, types } = require('pg')
  pool = new Pool({
    connectionString: URL,
    // Serverless: each instance needs very few connections, and Neon's pooler does the
    // heavy lifting. Short idle timeout so frozen instances don't hold sockets open.
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    types: {
      getTypeParser(oid, format) {
        return PARSERS[oid] || types.getTypeParser(oid, format)
      },
    },
  })
  // A dropped idle connection must not crash the function.
  pool.on('error', (err) => console.error('[db] idle client error:', err.message))
  return pool
}

async function dbQuery(sql, params = []) {
  if (!URL) return require('@surf-ai/sdk/db').dbQuery(sql, params)
  const r = await getPool().query(sql, params)
  return { rows: r.rows, rowCount: r.rowCount, fields: r.fields }
}

const dbBackend = URL ? 'neon' : 'surf'

module.exports = { dbQuery, dbBackend }
