// Mochiro badges: soulbound achievement NFTs on Arc testnet.
//
// The contract (backend/contracts/MochiroBadges.sol) lets a player mint a badge only with a
// voucher signed by this server, and the server only signs once it has checked the goal on
// the player's VERIFIED runs (ticketed, signed-in, plausible — see routes/runner.js). The
// player sends the mint themselves and pays the tiny network fee; nothing here holds funds.
//
//   GET  /api/badges                 → catalog, contract status, and (signed in) progress + owned
//   POST /api/badges/claim { badge } → a 30-minute voucher plus the ready-made calldata
//   GET  /api/badges/meta/:tokenId   → ERC-721 metadata (what wallets and the explorer show)
//   GET  /api/badges/setup           → one-time activation data for the owner
//
// Where the contract lives: it is deployed through the standard CREATE2 factory, so its
// address follows from the bytecode and constructor arguments alone. The server, the client
// and the explorer all agree on it without any configuration, and anyone deploying it gets
// the very same contract — owned by the Mochiro treasury, trusting this server's signer.
//
// The signer: MOCHIRO_BADGE_KEY when set, otherwise a key derived from the database secret
// (HMAC, domain-separated), so production signs without a new secret to manage. The key only
// authorises badge mints — it holds nothing. If it ever changes, the owner points the
// contract at the new signer with setSigner (the setup endpoint hands out that call).
const crypto = require('node:crypto')
const { Router } = require('express')
const { AbiCoder, Interface, Wallet, concat, getAddress, getBytes, getCreate2Address, id, isAddress, keccak256 } = require('ethers')
const { dbQuery } = require('../db/client')
const { sessionAccount, profileIdFor } = require('../db/session')
const ARTIFACT = require('../contracts/badges')

const router = Router()

const CHAIN_ID = 5042002
const RPC_URLS = [(process.env.ARC_RPC_URL || '').trim(), 'https://rpc.testnet.arc.io'].filter(Boolean)
const EXPLORER = 'https://explorer.testnet.arc.io'
const SITE = 'https://mochiro.xyz'

// Constructor arguments and salt are part of the address — never change them in place.
const CREATE2_FACTORY = '0x4e59b44847b379578588920ca78fbf26c0b4956c'
const SALT = id('mochiro-badges-v1')
const BASE_URI = `${SITE}/api/badges/meta/`
const OWNER = (() => {
  const raw = (process.env.MOCHIRO_TREASURY || process.env.TREASURY_ADDRESS || '').trim()
  return isAddress(raw) ? getAddress(raw) : getAddress('0x16299b74c616994eaecb9b20e37d369d5d62586b')
})()

const VOUCHER_TTL_S = 30 * 60
/** A weekly board needs at least this many players before its top spots earn a badge. */
const WEEK_MIN_PLAYERS = 5

/**
 * The badges. `id` is the on-chain badge number (1..255) and must never be reused for
 * another goal. `metric` is measured on verified runs only; `week_rank` is the best final
 * rank on any finished weekly board with at least WEEK_MIN_PLAYERS players.
 */
const BADGES = [
  { id: 1, key: 'run1k', metric: 'best_distance', target: 1000, name: 'First Kilometre', goal: 'Run 1,000 m in a single sprint.' },
  { id: 2, key: 'run5k', metric: 'best_distance', target: 5000, name: 'Long Runner', goal: 'Run 5,000 m in a single sprint.' },
  { id: 3, key: 'run10k', metric: 'best_distance', target: 10000, name: 'Marathoner', goal: 'Run 10,000 m in a single sprint.' },
  { id: 4, key: 'combo300', metric: 'best_combo', target: 300, name: 'Combo Master', goal: 'Reach a ×300 combo.' },
  { id: 5, key: 'score1m', metric: 'best_score', target: 1000000, name: 'Millionaire', goal: 'Score 1,000,000 points in one sprint.' },
  { id: 6, key: 'hard3k', metric: 'hard_distance', target: 3000, name: 'Daredevil', goal: 'Run 3,000 m on Hard.' },
  { id: 7, key: 'runs50', metric: 'runs', target: 50, name: 'Regular', goal: 'Finish 50 verified sprints.' },
  { id: 8, key: 'week10', metric: 'week_rank', target: 10, name: 'Weekly Top 10', goal: 'Finish a weekly season in the top 10.' },
  { id: 9, key: 'week1', metric: 'week_rank', target: 1, name: 'Weekly Champion', goal: 'Finish a weekly season at #1.' },
]
const BY_ID = new Map(BADGES.map((badge) => [badge.id, badge]))

const iface = new Interface(ARTIFACT.abi)
const coder = AbiCoder.defaultAbiCoder()

// ---------------------------------------------------------------- signer --
const signer = (() => {
  const explicit = (process.env.MOCHIRO_BADGE_KEY || '').trim()
  if (/^0x[0-9a-fA-F]{64}$/.test(explicit)) return new Wallet(explicit)
  const secret = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim()
  if (!secret) return null
  const key = crypto.createHmac('sha256', secret).update('mochiro-badge-signer-v1').digest('hex')
  return new Wallet(`0x${key}`)
})()

// -------------------------------------------------------------- contract --
function initCodeFor(signerAddress) {
  return concat([ARTIFACT.bytecode, coder.encode(['address', 'address', 'string'], [signerAddress, OWNER, BASE_URI])])
}

/** Pinned address (env) wins; otherwise the CREATE2 address for this server's signer. */
const CONTRACT = (() => {
  const pinned = (process.env.MOCHIRO_BADGE_CONTRACT || '').trim()
  if (isAddress(pinned)) return getAddress(pinned)
  if (!signer) return null
  return getCreate2Address(CREATE2_FACTORY, SALT, keccak256(initCodeFor(signer.address)))
})()

async function rpc(method, params) {
  let lastError = null
  for (const url of RPC_URLS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw new Error(`rpc ${response.status}`)
      const body = await response.json()
      if (body.error) throw new Error(body.error.message || 'rpc error')
      return body.result
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('rpc unavailable')
}

const call = async (fn, args = []) => {
  const raw = await rpc('eth_call', [{ to: CONTRACT, data: iface.encodeFunctionData(fn, args) }, 'latest'])
  return iface.decodeFunctionResult(fn, raw)
}

// Once deployed, always deployed — remember it. A "not yet" is rechecked every 20 s.
let deployedAt = 0
let deployedKnown = false
async function isDeployed() {
  if (!CONTRACT) return false
  if (deployedKnown) return true
  if (Date.now() - deployedAt < 20_000) return false
  const code = await rpc('eth_getCode', [CONTRACT, 'latest'])
  deployedAt = Date.now()
  deployedKnown = typeof code === 'string' && code.length > 2
  return deployedKnown
}

let signerCache = { at: 0, value: null }
async function onchainSigner() {
  if (Date.now() - signerCache.at < 60_000 && signerCache.value) return signerCache.value
  const [value] = await call('signer')
  signerCache = { at: Date.now(), value: getAddress(value) }
  return signerCache.value
}

async function ownedMask(address) {
  const [mask] = await call('badgesOf', [address])
  return BigInt(mask)
}

const ownedIds = (mask) => BADGES.filter((badge) => (mask >> BigInt(badge.id)) & 1n).map((badge) => badge.id)

/** Everything the panel needs to know about the contract, without a session. */
async function contractStatus() {
  const deployed = await isDeployed().catch(() => false)
  let signerOk = false
  if (deployed && signer) signerOk = (await onchainSigner().catch(() => null)) === signer.address
  return { deployed, ready: deployed && signerOk, signerOk }
}

// -------------------------------------------------------------- progress --
async function progressFor(clientId) {
  const [runs, weeks] = await Promise.all([
    dbQuery(
      `SELECT COUNT(*)::int AS runs,
              COALESCE(MAX(distance_m), 0)::bigint AS best_distance,
              COALESCE(MAX(score), 0)::bigint AS best_score,
              COALESCE(MAX(best_combo), 0)::bigint AS best_combo,
              COALESCE(MAX(distance_m) FILTER (WHERE difficulty = 'hard'), 0)::bigint AS hard_distance
         FROM runner_runs
        WHERE client_id = $1 AND verified = true`,
      [clientId]
    ),
    // Final ranks on finished weeks only (this week's board is still moving).
    dbQuery(
      `WITH best AS (
         SELECT date_trunc('week', created_at) AS wk, client_id, MAX(score) AS score
           FROM runner_runs
          WHERE verified = true AND created_at < date_trunc('week', now() AT TIME ZONE 'UTC')
          GROUP BY 1, 2
       ),
       weeks AS (SELECT wk FROM best GROUP BY wk HAVING COUNT(*) >= $2),
       ranked AS (
         SELECT b.client_id, RANK() OVER (PARTITION BY b.wk ORDER BY b.score DESC) AS r
           FROM best b JOIN weeks w ON w.wk = b.wk
       )
       SELECT MIN(r)::int AS rank FROM ranked WHERE client_id = $1`,
      [clientId, WEEK_MIN_PLAYERS]
    ),
  ])
  const row = runs.rows[0] ?? {}
  return {
    runs: Number(row.runs ?? 0),
    best_distance: Number(row.best_distance ?? 0),
    best_score: Number(row.best_score ?? 0),
    best_combo: Number(row.best_combo ?? 0),
    hard_distance: Number(row.hard_distance ?? 0),
    week_rank: weeks.rows[0]?.rank ? Number(weeks.rows[0].rank) : null,
  }
}

function reached(badge, progress) {
  if (!progress) return false
  if (badge.metric === 'week_rank') return progress.week_rank !== null && progress.week_rank <= badge.target
  return Number(progress[badge.metric] ?? 0) >= badge.target
}

const catalog = () => BADGES.map(({ id: badgeId, key, metric, target }) => ({ id: badgeId, key, metric, target }))

// ---------------------------------------------------------------- routes --
router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const [status, account] = await Promise.all([contractStatus(), sessionAccount(req).catch(() => null)])
    let progress = null
    let owned = []
    if (account) {
      progress = await progressFor(profileIdFor(account))
      if (status.deployed) owned = ownedIds(await ownedMask(getAddress(account.address)).catch(() => 0n))
    }
    res.json({
      chainId: CHAIN_ID,
      explorer: EXPLORER,
      contract: CONTRACT,
      owner: OWNER,
      deployed: status.deployed,
      ready: status.ready,
      weekMinPlayers: WEEK_MIN_PLAYERS,
      badges: catalog().map((badge) => ({ ...badge, reached: reached(badge, progress) })),
      progress,
      owned,
      signedIn: Boolean(account),
    })
  } catch (error) {
    console.error('[badges] state failed', error)
    res.status(500).json({ error: 'badges_unavailable' })
  }
})

router.post('/claim', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const account = await sessionAccount(req)
    if (!account) return res.status(401).json({ error: 'not_signed_in' })
    const badge = BY_ID.get(Number(req.body?.badge))
    if (!badge) return res.status(400).json({ error: 'unknown_badge' })
    const status = await contractStatus()
    if (!signer || !status.ready) return res.status(503).json({ error: 'badges_not_ready' })

    const holder = getAddress(account.address)
    const progress = await progressFor(profileIdFor(account))
    if (!reached(badge, progress)) return res.status(403).json({ error: 'not_reached' })
    const mask = await ownedMask(holder)
    if ((mask >> BigInt(badge.id)) & 1n) return res.status(409).json({ error: 'already_owned' })

    const deadline = Math.floor(Date.now() / 1000) + VOUCHER_TTL_S
    const hash = keccak256(
      coder.encode(['uint256', 'address', 'address', 'uint8', 'uint256'], [CHAIN_ID, CONTRACT, holder, badge.id, deadline])
    )
    const signature = await signer.signMessage(getBytes(hash))
    res.json({
      contract: CONTRACT,
      badge: badge.id,
      deadline,
      signature,
      data: iface.encodeFunctionData('claim', [badge.id, deadline, signature]),
    })
  } catch (error) {
    console.error('[badges] claim failed', error)
    res.status(500).json({ error: 'claim_failed' })
  }
})

router.get('/meta/:tokenId', (req, res) => {
  let tokenId
  try {
    tokenId = BigInt(String(req.params.tokenId).replace(/\.json$/, ''))
  } catch {
    return res.status(400).json({ error: 'invalid_token' })
  }
  const badge = BY_ID.get(Number(tokenId >> 160n))
  if (!badge || tokenId < 0n) return res.status(404).json({ error: 'unknown_badge' })
  const holder = getAddress(`0x${(tokenId & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`)
  res.set('Cache-Control', 'public, max-age=86400')
  res.json({
    name: `Mochiro · ${badge.name}`,
    description: `${badge.goal} A soulbound Mochiro achievement badge on Arc — earned in the game, never sold or traded.`,
    image: `${SITE}/badges/${badge.key}.svg`,
    external_url: SITE,
    attributes: [
      { trait_type: 'Badge', value: badge.name },
      { trait_type: 'Goal', value: badge.goal },
      { trait_type: 'Holder', value: holder },
      { trait_type: 'Transferable', value: 'No' },
    ],
  })
})

router.get('/setup', async (_req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    if (!signer || !CONTRACT) return res.json({ available: false })
    const deployed = await isDeployed()
    let current = null
    if (deployed) current = await onchainSigner().catch(() => null)
    res.json({
      available: true,
      contract: CONTRACT,
      owner: OWNER,
      signer: signer.address,
      deployed,
      onchainSigner: current,
      deploy: deployed ? null : { to: CREATE2_FACTORY, data: concat([SALT, initCodeFor(signer.address)]) },
      fixSigner:
        deployed && current && current !== signer.address
          ? { to: CONTRACT, data: iface.encodeFunctionData('setSigner', [signer.address]) }
          : null,
    })
  } catch (error) {
    console.error('[badges] setup failed', error)
    res.status(500).json({ error: 'setup_unavailable' })
  }
})

/** After the owner activates or fixes the contract, forget the cached "not yet". */
router.post('/refresh', (_req, res) => {
  deployedAt = 0
  signerCache = { at: 0, value: null }
  res.json({ ok: true })
})

module.exports = router
