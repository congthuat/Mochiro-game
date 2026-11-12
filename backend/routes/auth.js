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
const { dbQuery } = require('@surf-ai/sdk/db')

const ARC_CHAIN_ID = 5042002
const SESSION_DAYS = 30
const CHALLENGE_MS = 10 * 60 * 1000
const DEFAULT_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''

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

async function issueSession(accountId) {
  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000)
  await dbQuery('INSERT INTO arc_sessions (token, account_id, expires_at) VALUES ($1, $2, $3)', [
    token,
    accountId,
    expires.toISOString(),
  ])
  return token
}

/** Resolve a bearer token into an account row (or null). */
async function sessionAccount(req) {
  const raw = req.headers.authorization || ''
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : String(req.query.token || '')
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const { rows } = await dbQuery(
    `SELECT a.* FROM arc_sessions s
     JOIN arc_accounts a ON a.id = s.account_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  )
  if (!rows[0]) return null
  void dbQuery('UPDATE arc_accounts SET last_seen_at = now() WHERE id = $1', [rows[0].id]).catch(() => {})
  return rows[0]
}

async function upsertAccount({ address, method, googleSub, email, displayName, walletKind }) {
  const lower = normalise(address)
  const { rows } = await dbQuery(
    `INSERT INTO arc_accounts (address, method, google_sub, email, display_name, wallet_kind)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (address) DO UPDATE SET
       last_seen_at = now(),
       email = COALESCE(EXCLUDED.email, arc_accounts.email),
       google_sub = COALESCE(EXCLUDED.google_sub, arc_accounts.google_sub),
       display_name = COALESCE(EXCLUDED.display_name, arc_accounts.display_name),
       wallet_kind = EXCLUDED.wallet_kind,
       method = EXCLUDED.method
     RETURNING *`,
    [lower, method, googleSub ?? null, email ?? null, displayName ?? null, walletKind]
  )
  return rows[0]
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
    console.error('[auth] session failed', error)
    res.json({ authenticated: false, account: null, chainId: ARC_CHAIN_ID })
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
  })
})

router.post('/nonce', async (req, res) => {
  try {
    const address = canonicalAddress(req.body?.address)
    if (!address) return res.status(400).json({ error: 'A valid wallet address is required.' })
    const { host, protocol } = clientOrigin(req)
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
      `INSERT INTO arc_challenges (nonce, address, message, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (nonce) DO NOTHING`,
      [nonce, address.toLowerCase(), message, new Date(Date.now() + CHALLENGE_MS).toISOString()]
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
    const { rows: challengeRows } = await dbQuery(
      'SELECT * FROM arc_challenges WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > now()',
      [parsed.nonce]
    )
    const challenge = challengeRows[0]
    if (!challenge || challenge.message !== message) {
      return res.status(401).json({ error: 'This sign-in challenge has expired. Try again.' })
    }
    const { host } = clientOrigin(req)
    if (parsed.domain !== host) return res.status(401).json({ error: 'Sign-in domain mismatch.' })

    let recovered
    try {
      recovered = getAddress(verifyMessage(message, signature))
    } catch {
      return res.status(401).json({ error: 'Signature could not be verified.' })
    }
    if (recovered.toLowerCase() !== String(parsed.address).toLowerCase()) {
      return res.status(401).json({ error: 'Signature does not match the wallet address.' })
    }
    await dbQuery('UPDATE arc_challenges SET consumed_at = now() WHERE nonce = $1', [parsed.nonce])

    const account = await upsertAccount({
      address: recovered,
      method: 'wallet',
      email: null,
      displayName: null,
      walletKind: 'eoa',
    })
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
    let address = null
    let walletKind = 'embedded'
    const wallet = req.body?.wallet
    if (wallet && typeof wallet.address === 'string' && typeof wallet.signature === 'string' && typeof wallet.message === 'string') {
      try {
        const recovered = getAddress(verifyMessage(wallet.message, wallet.signature))
        if (recovered.toLowerCase() === wallet.address.toLowerCase()) address = recovered
      } catch {
        /* fall through — an unproven address is simply not linked */
      }
    }
    if (!address) {
      // No wallet yet: look for one this Google account already registered.
      const { rows } = await dbQuery('SELECT * FROM arc_accounts WHERE google_sub = $1', [identity.sub])
      if (rows[0]) {
        const token = await issueSession(rows[0].id)
        return res.json({ token, account: accountShape(rows[0]), chainId: ARC_CHAIN_ID, needsWallet: false })
      }
      return res.json({ token: null, account: null, chainId: ARC_CHAIN_ID, needsWallet: true })
    }

    const account = await upsertAccount({
      address,
      method: 'google',
      googleSub: identity.sub,
      email: identity.email,
      displayName: identity.name,
      walletKind,
    })
    const token = await issueSession(account.id)
    res.json({ token, account: accountShape(account), chainId: ARC_CHAIN_ID, needsWallet: false })
  } catch (error) {
    console.error('[auth] google failed', error)
    res.status(500).json({ error: 'Sign-in failed.' })
  }
})

router.post('/logout', async (req, res) => {
  try {
    const token = String(req.body?.token || '')
    if (/^[0-9a-f]{64}$/.test(token)) await dbQuery('DELETE FROM arc_sessions WHERE token = $1', [token])
    res.json({ authenticated: false })
  } catch (error) {
    console.error('[auth] logout failed', error)
    res.json({ authenticated: false })
  }
})

/** Housekeeping: drop expired sessions and challenges. */
router.post('/sweep', async (_req, res) => {
  try {
    await dbQuery('DELETE FROM arc_sessions WHERE expires_at < now()')
    await dbQuery('DELETE FROM arc_challenges WHERE expires_at < now() - interval \'1 hour\'')
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false })
  }
})

module.exports = router
