// Sessions and profile ownership, shared by every route that needs to know who is calling.
//
// Session tokens are 32 random bytes handed to the browser as hex. The database keeps only
// their SHA-256, so a leaked table or log line cannot be replayed as a login. Tokens issued
// before hashing was introduced are still found by their raw value until they expire.
const crypto = require('node:crypto')
const { dbQuery } = require('./client')

const TOKEN_RE = /^[0-9a-f]{64}$/

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')

/** The bearer token on the request (Authorization header only — never the URL). */
function bearer(req) {
  const raw = String(req.headers.authorization || '')
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : ''
  return TOKEN_RE.test(token) ? token : null
}

/** Resolves the caller's session into an account row, or null. Throws on database errors. */
async function sessionAccount(req) {
  const token = bearer(req)
  if (!token) return null
  const { rows } = await dbQuery(
    `SELECT a.* FROM arc_sessions s
       JOIN arc_accounts a ON a.id = s.account_id
      WHERE s.token IN ($1, $2) AND s.expires_at > now()
      LIMIT 1`,
    [hashToken(token), token]
  )
  return rows[0] ?? null
}

/** The one profile id an account may act as. Lower-case, so there is exactly one per wallet. */
const profileIdFor = (account) => (account?.address ? `arc:${String(account.address).toLowerCase()}` : null)

/**
 * Who may act as `clientId`: only a signed-in account, and only on its own profile id,
 * spelled exactly as the server spells it. Anonymous ids and case variants are refused.
 * Returns { ok, account, error }.
 */
async function authorise(req, clientId) {
  const account = await sessionAccount(req)
  if (!account) return { ok: false, account: null, error: 'not_signed_in' }
  if (clientId !== profileIdFor(account)) return { ok: false, account, error: 'not_your_profile' }
  return { ok: true, account, error: null }
}

module.exports = { TOKEN_RE, hashToken, bearer, sessionAccount, profileIdFor, authorise }
