// Mochiro wallet on Arc testnet: balance, activity, and Arc top-ups paid in testnet USDC.
//
// Same model as the Makoto payment wallet: the player sends native USDC (Arc's gas token,
// 18 decimals) from the wallet they signed in with to the Mochiro treasury, then hands the
// transaction hash to /topup. Nothing is credited on the client's word — the server reads
// the transaction and its receipt straight from Arc and checks, in order:
//
//   • the transaction succeeded on Arc testnet (chain id 5042002);
//   • it came FROM the signed-in account's own address;
//   • it went TO the treasury;
//   • it paid at least the pack's price;
//   • it carries the Mochiro top-up memo in its data field, so a transfer made to the same
//     treasury for anything else (another app, a plain gift) can never be cashed in here;
//   • it is recent (48 h), and it has never been used before (tx hash is the primary key).
//
// The insert of the top-up row, the bank credit and the ledger line happen in ONE statement,
// so a hash can never be marked used without the Arc landing, or credited twice.
const { Router } = require('express')
const { formatEther, parseEther, getAddress, isAddress, toUtf8String } = require('ethers')
const { dbQuery } = require('../db/client')
const { authorise } = require('../db/session')

const router = Router()
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

const CHAIN = {
  chainId: 5042002,
  chainHex: '0x4cef52',
  chainName: 'Arc Testnet',
  rpc: 'https://rpc.testnet.arc.io',
  explorer: 'https://explorer.testnet.arc.io',
  faucet: 'https://faucet.circle.com',
  currency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
}
const RPC_URLS = [(process.env.ARC_RPC_URL || '').trim(), CHAIN.rpc].filter(Boolean)

// The owner's Arc treasury (same one the Makoto payment wallet uses). Override per deploy.
const TREASURY = (() => {
  const raw = (process.env.MOCHIRO_TREASURY || process.env.TREASURY_ADDRESS || '').trim()
  return isAddress(raw) ? getAddress(raw) : getAddress('0x16299b74c616994eaecb9b20e37d369d5d62586b')
})()

/** USDC → Arc packs. Bigger packs carry a bonus; prices are whole testnet USDC. */
const PACKS = [
  { id: 'p1', usdc: '1', arc: 2000, bonus: 0 },
  { id: 'p5', usdc: '5', arc: 11000, bonus: 10 },
  { id: 'p10', usdc: '10', arc: 24000, bonus: 20 },
  { id: 'p20', usdc: '20', arc: 52000, bonus: 30 },
]
const MEMO_PREFIX = 'mochiro-topup:'
const MAX_AGE_S = 48 * 3600

// ------------------------------------------------------------------- rpc --
class RpcError extends Error {}

async function rpc(method, params) {
  let lastError = null
  for (const url of RPC_URLS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) throw new RpcError(`rpc ${response.status}`)
        const body = await response.json()
        if (body.error) throw new RpcError(body.error.message || 'rpc error')
        return body.result
      } catch (error) {
        lastError = error
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400))
      }
    }
  }
  throw lastError ?? new RpcError('rpc unavailable')
}

async function explorer(path) {
  const response = await fetch(`${CHAIN.explorer}/api/v2/${path}`, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`explorer ${response.status}`)
  return response.json()
}

const HASH_RE = /^0x[0-9a-f]{64}$/
const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : '')

function memoOf(input) {
  if (typeof input !== 'string' || input.length < 4 || input === '0x') return ''
  try {
    return toUtf8String(input).slice(0, 80)
  } catch {
    return ''
  }
}

// --------------------------------------------------------------- config --
router.get('/config', (_req, res) => {
  res.json({ ...CHAIN, treasury: TREASURY, packs: PACKS, memoPrefix: MEMO_PREFIX })
})

// --------------------------------------------------------- balance+activity --
// Short cache so a few players opening the panel at once do not hammer the RPC.
const accountCache = new Map()
const ACCOUNT_TTL_MS = 8_000

router.get('/account/:address', async (req, res) => {
  const raw = String(req.params.address || '')
  if (!isAddress(raw)) return res.status(400).json({ error: 'invalid_address' })
  const address = getAddress(raw)
  const key = lower(address)
  const cached = accountCache.get(key)
  if (cached && Date.now() - cached.at < ACCOUNT_TTL_MS && req.query.fresh !== '1') return res.json(cached.value)

  try {
    const [wei, history] = await Promise.all([
      rpc('eth_getBalance', [address, 'latest']),
      explorer(`addresses/${address}/transactions`).catch(() => null),
    ])
    const treasury = lower(TREASURY)
    const txs = (history?.items ?? []).slice(0, 15).map((t) => {
      const from = lower(t.from?.hash)
      const to = lower(t.to?.hash)
      const memo = memoOf(t.raw_input)
      const direction = from === key && to === key ? 'self' : from === key ? 'out' : 'in'
      const types = Array.isArray(t.transaction_types) ? t.transaction_types : []
      const kind =
        memo.startsWith(MEMO_PREFIX) && to === treasury
          ? 'topup'
          : types.includes('contract_call') || types.includes('contract_creation') || t.to?.is_contract
            ? 'contract'
            : 'transfer'
      return {
        hash: t.hash,
        time: t.timestamp,
        from: t.from?.hash ?? null,
        to: t.to?.hash ?? null,
        direction,
        kind,
        method: kind === 'contract' ? t.method ?? null : null,
        value: t.value ? formatEther(BigInt(t.value)) : '0',
        fee: t.fee?.value ? formatEther(BigInt(t.fee.value)) : null,
        ok: t.status === 'ok' || t.result === 'success',
      }
    })
    const value = { address, wei: BigInt(wei).toString(), usdc: formatEther(BigInt(wei)), txs, historyOk: history !== null }
    accountCache.set(key, { at: Date.now(), value })
    if (accountCache.size > 500) accountCache.delete(accountCache.keys().next().value)
    res.json(value)
  } catch (error) {
    console.error('[wallet] account read failed', error?.message ?? error)
    res.status(502).json({ error: 'arc_unreachable' })
  }
})

// ----------------------------------------------------------------- topup --
const cleanClientId = (value) => {
  const id = String(value ?? '').trim()
  return id.length >= 6 && id.length <= 80 ? id : null
}

router.post('/topup', async (req, res) => {
  const clientId = cleanClientId(req.body?.client_id)
  const hash = lower(String(req.body?.tx_hash ?? '').trim())
  const pack = PACKS.find((p) => p.id === req.body?.pack)
  if (!clientId) return res.status(400).json({ error: 'invalid_client_id' })
  if (!HASH_RE.test(hash)) return res.status(400).json({ error: 'invalid_hash' })
  if (!pack) return res.status(400).json({ error: 'unknown_pack' })

  try {
    const { ok, account, error } = await authorise(req, clientId)
    if (!ok) return res.status(401).json({ error })

    // Already used? Same owner → idempotent success; anyone else → refused.
    const existing = await dbQuery('SELECT client_id, arc FROM runner_topups WHERE tx_hash = $1', [hash])
    if (existing.rows[0]) {
      if (existing.rows[0].client_id !== clientId) return res.status(409).json({ error: 'tx_used' })
      return res.json({ status: 'confirmed', credited: Number(existing.rows[0].arc), duplicate: true })
    }

    let tx
    let receipt
    try {
      ;[tx, receipt] = await Promise.all([rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash])])
    } catch {
      return res.json({ status: 'pending' })
    }
    if (!tx || !receipt) {
      // Arc's RPC forgets old transactions; the explorer still knows them. A payment it has
      // seen long ago can never be credited, so say so instead of leaving the player waiting.
      const known = await explorer(`transactions/${hash}`).catch(() => null)
      const seen = known?.timestamp ? Date.parse(known.timestamp) / 1000 : NaN
      if (Number.isFinite(seen) && Date.now() / 1000 - seen > MAX_AGE_S) return res.status(400).json({ error: 'tx_too_old' })
      return res.json({ status: 'pending' })
    }
    if (receipt.status !== '0x1') return res.status(400).json({ error: 'tx_failed' })
    if (tx.chainId && Number(BigInt(tx.chainId)) !== CHAIN.chainId) return res.status(400).json({ error: 'wrong_chain' })
    if (lower(tx.from) !== lower(account.address)) return res.status(400).json({ error: 'wrong_sender' })
    if (lower(tx.to) !== lower(TREASURY)) return res.status(400).json({ error: 'wrong_recipient' })
    if (BigInt(tx.value) < parseEther(pack.usdc)) return res.status(400).json({ error: 'amount_low' })
    if (!memoOf(tx.input).startsWith(MEMO_PREFIX)) return res.status(400).json({ error: 'no_memo' })

    const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]).catch(() => null)
    const blockTime = block?.timestamp ? Number(BigInt(block.timestamp)) : null
    if (blockTime === null) return res.json({ status: 'pending' })
    if (Date.now() / 1000 - blockTime > MAX_AGE_S) return res.status(400).json({ error: 'tx_too_old' })

    const usdc = formatEther(BigInt(tx.value))
    const { rows } = await dbQuery(
      `WITH t AS (
         INSERT INTO runner_topups (tx_hash, client_id, address, pack, usdc, arc, block_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tx_hash) DO NOTHING
         RETURNING tx_hash
       ), p AS (
         INSERT INTO runner_profiles (client_id, name, bank)
         SELECT $2, 'Runner', $6 FROM t
         ON CONFLICT (client_id) DO UPDATE SET bank = runner_profiles.bank + EXCLUDED.bank, updated_at = NOW()
         RETURNING bank
       ), l AS (
         INSERT INTO runner_ledger (client_id, delta, reason, balance)
         SELECT $2, $6, 'topup:' || $4, (SELECT bank FROM p) FROM t
         RETURNING id
       )
       SELECT (SELECT bank FROM p) AS bank, (SELECT COUNT(*) FROM l) AS logged`,
      [hash, clientId, lower(account.address), pack.id, usdc, pack.arc, Number(BigInt(receipt.blockNumber))]
    )
    if (rows[0]?.bank === null || rows[0]?.bank === undefined) {
      // Lost a race with a second request for the same hash: same owner means it landed.
      const again = await dbQuery('SELECT client_id, arc FROM runner_topups WHERE tx_hash = $1', [hash])
      if (again.rows[0]?.client_id === clientId) return res.json({ status: 'confirmed', credited: Number(again.rows[0].arc), duplicate: true })
      return res.status(409).json({ error: 'tx_used' })
    }
    res.json({ status: 'confirmed', credited: pack.arc, bank: Number(rows[0].bank) })
  } catch (error) {
    console.error('[wallet] topup failed', error?.message ?? error)
    res.status(500).json({ error: 'server_error' })
  }
})

/** The player's own top-up receipts (newest first). */
router.get('/topups', async (req, res) => {
  const clientId = cleanClientId(req.query.client_id)
  if (!clientId) return res.status(400).json({ error: 'invalid_client_id' })
  try {
    const { ok, error } = await authorise(req, clientId)
    if (!ok) return res.status(401).json({ error })
    const { rows } = await dbQuery(
      `SELECT tx_hash, pack, usdc, arc, created_at FROM runner_topups WHERE client_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [clientId]
    )
    res.json({ topups: rows.map((r) => ({ ...r, arc: Number(r.arc), usdc: String(r.usdc) })) })
  } catch (error) {
    console.error('[wallet] topups failed', error?.message ?? error)
    res.status(500).json({ error: 'server_error' })
  }
})

module.exports = router
