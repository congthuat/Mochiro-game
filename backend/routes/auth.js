// Arc Rush accounts: Sign-In with Ethereum (SIWE) and Google sign-in.
//
// Wallet flow:   POST /nonce  → a SIWE challenge bound to the caller's address
//                POST /verify → the signed challenge is checked and a bearer
//                               session token is issued
// Google flow:   POST /google → the Google ID token is verified server-side; the
//                               device-minted wallet address is accepted only
//                               with a signature proving the caller holds the key
//
// Sessions are opaque bearer tokens (no cookies): the games run in an iframe on
// a preview path, and cookies there are a needless source of surprises.
const { Router } = require('express')
const crypto = require('node:crypto')
const { SiweMessage } = require('siwe')
const { verifyMessage, getAddress, isAddress } = require('ethers')
const { dbQuery } = require('../db/client')
const { hashToken, TOKEN_RE, bearer, sessionAccount: lookupSession } = require('../db/session')

const ARC_CHAIN_ID = 5042002
const SESSION_DAYS = 30
const CHALLENGE_MS = 10 * 60 * 1000
/** How old a Google wallet-link signature may be. */
const LINK_MAX_AGE_MS = 10 * 60 * 1000
/** Sign-in challenges one IP / one address may ask for per 10 minutes. */
const NONCE_RATE = { windowSec: 600, perIp: 40, perAddress: 12 }

/**
 * Hosts a SIWE message may name. Production refuses anything else, so a look-alike site
 * cannot fetch a valid challenge for mochiro.xyz and relay the player's signature: the
 * wallet shows the real domain the message was made for, and a phishing page cannot ask
 * for one that names itself. Local and sandbox builds (no DATABASE_URL) accept any host.
 */
const PRODUCTION = Boolean(process.env.DATABASE_URL)
const ALLOWED_HOSTS = [/^(www\.)?mochiro\.xyz$/i, /^mochiro[a-z0-9-]*\.vercel\.app$/i, /^localhost(:\d+)?$/i]
const hostAllowed = (host) => !PRODUCTION || ALLOWED_HOSTS.some((re) => re.test(host))
// Mochiro's own OAuth client (Google Cloud project "Mochiro"). Client ids are public — the
// secret is never needed for ID-token sign-in. GOOGLE_CLIENT_ID overrides it per deployment.
// Pinning it here also means the server only accepts tokens minted for *this* app.
const MOCHIRO_CLIENT_ID = '116160392215-dd77so1e6nr44u39ldcc5l4pco1mu9gp.apps.googleusercontent.com'
const DEFAULT_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim() || MOCHIRO_CLIENT_ID

const router = Router()
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

// ------------------------------------------------------------------ helpers --
const normalise = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')

function canonicalAddress(value) {
  if (typeof value !== 'string' || !isAddress(value)) return null
  return getAddress(value)
}

/**
 * The site the player is actually on. Wallets compare the SIWE domain with the page they
 * show, so it must be the browser's origin — not the internal host a proxy forwarded to.
 * Browsers set Origin on every POST and page scripts cannot forge it.
 */
function clientOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin === 'string' && /^https?:\/\/[^\s/]+$/i.test(origin)) {
    try {
      const url = new URL(origin)
      return { host: url.host, protocol: url.protocol.replace(':', '') }
    } catch {
      /* fall through to the forwarded host */
    }
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
  const proto = req.headers['x-forwarded-proto'] || 'http'
  return { host: String(host).split(',')[0].trim(), protocol: String(proto).split(',')[0].trim() }
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return (forwarded || req.socket?.remoteAddress || 'unknown').slice(0, 64)
}

async function accountById(id) {
  const { rows } = await dbQuery('SELECT * FROM arc_accounts WHERE id = $1', [id])
  return rows[0] ?? null
}

function accountShape(row) {
  if (!row) return null
  return {
    address: row.address,
    method: row.method,
    walletKind: row.wallet_kind,
    email: row.email ?? null,
    displayName: row.display_name ?? null,
  }
}

/**
 * Sessions are stored as a SHA-256 of the token, so a leaked database copy holds no
 * usable sessions. Older rows (raw tokens) still resolve until they expire.
 */
async function issueSession(accountId) {
  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000)
  await dbQuery('INSERT INTO arc_sessions (token, account_id, expires_at) VALUES ($1, $2, $3)', [
    hashToken(token),
    accountId,
    expires.toISOString(),
  ])
  // Opportunistic housekeeping instead of a public sweep endpoint.
  if (Math.random() < 0.05) await sweep().catch(() => {})
  return token
}

/** Resolve the bearer token into an account row (or null). Never read from the URL. */
async function sessionAccount(req) {
  const account = await lookupSession(req)
  if (!account) return null
  await dbQuery('UPDATE arc_accounts SET last_seen_at = now() WHERE id = $1', [account.id]).catch(() => {})
  return account
}

async function sweep() {
  await dbQuery('DELETE FROM arc_sessions WHERE expires_at < now()')
  await dbQuery("DELETE FROM arc_challenges WHERE expires_at < now() - interval '1 hour'")
}

/** A wallet (SIWE) sign-in. Never touches the Google link of an existing account. */
async function upsertWalletAccount(address) {
  const { rows } = await dbQuery(
    `INSERT INTO arc_accounts (address, method, wallet_kind)
     VALUES ($1, 'wallet', 'eoa')
     ON CONFLICT (address) DO UPDATE SET last_seen_at = now()
     RETURNING *`,
    [normalise(address)]
  )
  return rows[0]
}

/**
 * Parses the message a Google player's device wallet signs (see linkMessage in
 * frontend/src/lib/auth.ts). Returns the reason it is unacceptable, or null.
 */
function linkProblem(message, address, identity) {
  const lines = String(message).split('\n')
  if (lines[0] !== 'Link this Arc wallet to my Mochiro account.') return 'bad_link'
  const field = (name) => {
    const line = lines.find((l) => l.startsWith(`${name}: `))
    return line ? line.slice(name.length + 2).trim() : null
  }
  if (normalise(field('Address')) !== normalise(address)) return 'bad_link'
  if (Number(field('Chain ID')) !== ARC_CHAIN_ID) return 'bad_link'
  const account = normalise(field('Account'))
  if (account !== 'google' && account !== normalise(identity.email)) return 'bad_link'
  const issued = Date.parse(field('Issued At') || '')
  if (!Number.isFinite(issued)) return 'bad_link'
  // A little slack for a phone whose clock runs fast.
  if (Date.now() - issued > LINK_MAX_AGE_MS || issued - Date.now() > 2 * 60 * 1000) return 'link_expired'
  return null
}

/** Google ID token check — Google validates the signature on the tokeninfo endpoint. */
async function verifyGoogleCredential(credential, clientId) {
  if (typeof credential !== 'string' || credential.split('.').length !== 3) {
    return { error: 'Invalid Google credential.', status: 401 }
  }
  let response
  try {
    response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return { error: 'Google verification is unavailable. Try again.', status: 503 }
  }
  if (!response.ok) return { error: 'Google sign-in expired. Sign in again.', status: 401 }
  const info = await response.json().catch(() => ({}))
  if (!clientId || info.aud !== clientId) {
    return { error: 'This Google client id is not the one this build is configured for.', status: 401 }
  }
  const issuers = new Set(['accounts.google.com', 'https://accounts.google.com'])
  if (!issuers.has(info.iss) || Number(info.exp) * 1000 <= Date.now()) {
    return { error: 'Google sign-in expired. Sign in again.', status: 401 }
  }
  if (info.email_verified !== true && info.email_verified !== 'true') {
    return { error: 'Google account email is not verified.', status: 401 }
  }
  if (typeof info.sub !== 'string' || !/^\d{5,40}$/.test(info.sub)) {
    return { error: 'Invalid Google credential.', status: 401 }
  }
  return { sub: info.sub, email: String(info.email || '').toLowerCase().slice(0, 254), name: info.name || null }
}

// -------------------------------------------------------------------- routes --
router.get('/', async (req, res) => {
  try {
    const account = await sessionAccount(req)
    res.json({ authenticated: Boolean(account), account: accountShape(account), chainId: ARC_CHAIN_ID })
  } catch (error) {
    // A database hiccup is not a sign-out: say "unavailable" so the client keeps its session.
    console.error('[auth] session failed', error)
    res.status(503).json({ error: 'unavailable' })
  }
})

/** Public config the client needs before it can even show the sign-in buttons. */
router.get('/config', (_req, res) => {
  res.json({
    chainId: ARC_CHAIN_ID,
    chainHex: `0x${ARC_CHAIN_ID.toString(16)}`,
    chainName: 'Arc Testnet',
    rpc: 'https://rpc.testnet.arc.io',
    explorer: 'https://testnet.arcscan.app',
    currency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    googleClientId: DEFAULT_CLIENT_ID || null,
    // WalletConnect ids are public; serving it lets a deployment swap ids without a rebuild.
    walletConnectProjectId: (process.env.WALLETCONNECT_PROJECT_ID || '').trim() || null,
  })
})

router.post('/nonce', async (req, res) => {
  try {
    const address = canonicalAddress(req.body?.address)
    if (!address) return res.status(400).json({ error: 'A valid wallet address is required.' })
    const { host, protocol } = clientOrigin(req)
    if (!hostAllowed(host)) return res.status(403).json({ error: 'Sign in on mochiro.xyz.' })
    const ip = clientIp(req)
    const { rows: recent } = await dbQuery(
      `SELECT COUNT(*) FILTER (WHERE ip = $1)::int AS by_ip,
              COUNT(*) FILTER (WHERE address = $2)::int AS by_address
         FROM arc_challenges
        WHERE created_at > now() - make_interval(secs => $3)`,
      [ip, address.toLowerCase(), NONCE_RATE.windowSec]
    )
    if ((recent[0]?.by_ip ?? 0) >= NONCE_RATE.perIp || (recent[0]?.by_address ?? 0) >= NONCE_RATE.perAddress) {
      return res.status(429).json({ error: 'slow_down' })
    }
    const nonce = crypto.randomBytes(16).toString('hex')
    const message = new SiweMessage({
      domain: host,
      address,
      // EIP-4361 keeps the statement to plain ASCII: em dashes break the ABNF grammar.
      statement: 'Sign in to Arc Rush. This signature proves you own this wallet. It costs nothing.',
      uri: `${protocol}://${host}`,
      version: '1',
      chainId: ARC_CHAIN_ID,
      nonce,
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + CHALLENGE_MS).toISOString(),
    }).prepareMessage()
    await dbQuery(
      `INSERT INTO arc_challenges (nonce, address, message, expires_at, ip)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (nonce) DO NOTHING`,
      [nonce, address.toLowerCase(), message, new Date(Date.now() + CHALLENGE_MS).toISOString(), ip]
    )
    res.json({ message, nonce, chainId: ARC_CHAIN_ID })
  } catch (error) {
    console.error('[auth] nonce failed', error)
    res.status(500).json({ error: 'Could not start the sign-in challenge.' })
  }
})

router.post('/verify', async (req, res) => {
  try {
    const { message, signature } = req.body ?? {}
    if (typeof message !== 'string' || typeof signature !== 'string') {
      return res.status(400).json({ error: 'Message and signature are required.' })
    }
    let parsed
    try {
      parsed = new SiweMessage(message)
    } catch {
      return res.status(401).json({ error: 'Malformed sign-in message.' })
    }
    if (parsed.chainId !== ARC_CHAIN_ID) {
      return res.status(400).json({ error: `Switch your wallet to Arc testnet (chain ${ARC_CHAIN_ID}).` })
    }
    const { host } = clientOrigin(req)
    if (parsed.domain !== host || !hostAllowed(host)) {
      return res.status(401).json({ error: 'Sign-in domain mismatch.' })
    }
    let recovered
    try {
      recovered = getAddress(verifyMessage(message, signature))
    } catch {
      return res.status(401).json({ error: 'Signature could not be verified.' })
    }
    if (recovered.toLowerCase() !== String(parsed.address).toLowerCase()) {
      return res.status(401).json({ error: 'Signature does not match the wallet address.' })
    }
    // Spend the challenge atomically: two racing requests with one signature get one session.
    const { rows: spent } = await dbQuery(
      `UPDATE arc_challenges SET consumed_at = now()
        WHERE nonce = $1 AND message = $2 AND address = $3 AND consumed_at IS NULL AND expires_at > now()
        RETURNING nonce`,
      [parsed.nonce, message, recovered.toLowerCase()]
    )
    if (!spent[0]) return res.status(401).json({ error: 'This sign-in challenge has expired. Try again.' })

    const account = await upsertWalletAccount(recovered)
    const token = await issueSession(account.id)
    res.json({ token, account: accountShape(account), chainId: ARC_CHAIN_ID })
  } catch (error) {
    console.error('[auth] verify failed', error)
    res.status(500).json({ error: 'Sign-in failed.' })
  }
})

router.post('/google', async (req, res) => {
  try {
    const clientId = DEFAULT_CLIENT_ID || String(req.body?.clientId || '').trim()
    if (!clientId) {
      return res.status(503).json({ error: 'Google sign-in is not configured on this build.' })
    }
    const identity = await verifyGoogleCredential(req.body?.credential, clientId)
    if (identity.error) return res.status(identity.status).json({ error: identity.error })

    // The device mints the wallet; the signature proves the caller holds the key.
    // A Google account that already owns a wallet signs straight into it. This is also
    // the way back for a player who forgot the device password: Google alone is enough.
    const { rows: linked } = await dbQuery('SELECT * FROM arc_accounts WHERE google_sub = $1', [identity.sub])
    if (linked[0]) {
      await dbQuery('UPDATE arc_accounts SET last_seen_at = now() WHERE id = $1', [linked[0].id]).catch(() => {})
      const token = await issueSession(linked[0].id)
      return res.json({ token, account: accountShape(linked[0]), chainId: ARC_CHAIN_ID, needsWallet: false })
    }

    const wallet = req.body?.wallet
    const hasWallet =
      wallet && typeof wallet.address === 'string' && typeof wallet.signature === 'string' && typeof wallet.message === 'string'
    if (!hasWallet) return res.json({ token: null, account: null, chainId: ARC_CHAIN_ID, needsWallet: true })

    // The device mints the wallet; a fresh signature over the link message for *this*
    // Google account proves the caller holds the key right now.
    let address = null
    try {
      const recovered = getAddress(verifyMessage(wallet.message, wallet.signature))
      if (recovered.toLowerCase() === wallet.address.toLowerCase()) address = recovered
    } catch {
      /* not a valid signature */
    }
    if (!address) return res.status(401).json({ error: 'Signature could not be verified.' })
    const problem = linkProblem(wallet.message, address, identity)
    if (problem === 'link_expired') return res.status(401).json({ error: 'link_expired' })
    if (problem) return res.status(401).json({ error: 'Signature could not be verified.' })

    // Linking only ever creates a new account. A wallet that already has one — a wallet
    // sign-in or another Google account — is never taken over.
    const { rows: created } = await dbQuery(
      `INSERT INTO arc_accounts (address, method, google_sub, email, display_name, wallet_kind)
       VALUES ($1, 'google', $2, $3, $4, 'embedded')
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [normalise(address), identity.sub, identity.email || null, identity.name]
    )
    if (!created[0]) {
      // Lost a race with this same Google account on another tab: sign into that one.
      const { rows: again } = await dbQuery('SELECT * FROM arc_accounts WHERE google_sub = $1', [identity.sub])
      if (again[0]) {
        const token = await issueSession(again[0].id)
        return res.json({ token, account: accountShape(again[0]), chainId: ARC_CHAIN_ID, needsWallet: false })
      }
      return res.status(409).json({ error: 'wallet_owned' })
    }
    const token = await issueSession(created[0].id)
    res.json({ token, account: accountShape(created[0]), chainId: ARC_CHAIN_ID, needsWallet: false })
  } catch (error) {
    console.error('[auth] google failed', error)
    res.status(500).json({ error: 'Sign-in failed.' })
  }
})

router.post('/logout', async (req, res) => {
  try {
    const token = bearer(req) || String(req.body?.token || '')
    if (TOKEN_RE.test(token)) await dbQuery('DELETE FROM arc_sessions WHERE token IN ($1, $2)', [hashToken(token), token])
    res.json({ authenticated: false })
  } catch (error) {
    console.error('[auth] logout failed', error)
    res.json({ authenticated: false })
  }
})

module.exports = router
