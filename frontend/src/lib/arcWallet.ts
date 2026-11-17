// Mochiro wallet on Arc testnet — client side.
//
// Reads (balance, activity, config) come from /api/wallet so the server can cache them.
// Signing never leaves the browser:
//   • a Google account's device wallet is unlocked with the player's password for the one
//     transaction and then dropped;
//   • a browser / WalletConnect wallet signs in its own app.
// A top-up is only credited once the server has read the transaction from Arc itself.
import { api } from './api'
import { authToken, chainConfig, ensureArcNetwork, unlockLocalWallet, localWalletAddress, type AuthAccount, type Eip1193 } from './auth'

const loadEthers = () => import('ethers')

export interface WalletPack {
  id: string
  usdc: string
  arc: number
  bonus: number
}

export interface WalletConfig {
  chainId: number
  chainHex: string
  chainName: string
  rpc: string
  explorer: string
  faucet: string
  treasury: string
  packs: WalletPack[]
  memoPrefix: string
}

export interface WalletTx {
  hash: string
  time: string
  from: string | null
  to: string | null
  direction: 'in' | 'out' | 'self'
  kind: 'transfer' | 'contract' | 'topup'
  method: string | null
  value: string
  fee: string | null
  ok: boolean
}

export interface WalletAccount {
  address: string
  wei: string
  usdc: string
  txs: WalletTx[]
  historyOk: boolean
}

export class WalletError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

const FALLBACK_CONFIG: WalletConfig = {
  chainId: 5042002,
  chainHex: '0x4cef52',
  chainName: 'Arc Testnet',
  rpc: 'https://rpc.testnet.arc.io',
  explorer: 'https://explorer.testnet.arc.io',
  faucet: 'https://faucet.circle.com',
  treasury: '',
  packs: [],
  memoPrefix: 'mochiro-topup:',
}

let configPromise: Promise<WalletConfig> | null = null

export function walletConfig(): Promise<WalletConfig> {
  if (!configPromise) {
    configPromise = fetch(api('wallet/config'))
      .then((response) => (response.ok ? (response.json() as Promise<WalletConfig>) : Promise.reject(new Error('config'))))
      .then((config) => {
        if (!config?.treasury || !Array.isArray(config.packs)) throw new Error('config')
        return config
      })
      .catch((error) => {
        configPromise = null
        throw error
      })
  }
  return configPromise
}

export function fallbackConfig(): WalletConfig {
  return FALLBACK_CONFIG
}

export async function fetchWalletAccount(address: string, fresh = false): Promise<WalletAccount> {
  const response = await fetch(api(`wallet/account/${address}${fresh ? '?fresh=1' : ''}`))
  if (!response.ok) throw new WalletError('arc_unreachable')
  return (await response.json()) as WalletAccount
}

// ----------------------------------------------------------------- amounts --
/** "12.5" → wei, or null when it is not a clean positive amount with ≤ 18 decimals. */
export function parseUsdc(input: string): bigint | null {
  const value = input.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,18})?$/.test(value) && !/^\.\d{1,18}$/.test(value)) return null
  const [whole, frac = ''] = (value.startsWith('.') ? `0${value}` : value).split('.')
  const wei = BigInt(whole) * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18))
  return wei > 0n ? wei : null
}

/** wei → "12.3456" (trimmed, at most `digits` decimals, rounded down). */
export function formatUsdc(wei: bigint | string, digits = 4): string {
  const value = typeof wei === 'string' ? BigInt(wei) : wei
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = abs / 10n ** 18n
  const frac = (abs % 10n ** 18n).toString().padStart(18, '0').slice(0, digits).replace(/0+$/, '')
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`
}

/** "12.5" decimal string from the server → short display. */
export function shortUsdc(decimal: string, digits = 4): string {
  const wei = parseUsdc(decimal)
  return wei === null ? '0' : formatUsdc(wei, digits)
}

export const isAddressLike = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value.trim())

/** Checksummed address, or null when invalid (including a bad mixed-case checksum). */
export async function checkAddress(value: string): Promise<string | null> {
  const trimmed = value.trim()
  if (!isAddressLike(trimmed)) return null
  const { getAddress } = await loadEthers()
  try {
    return getAddress(trimmed)
  } catch {
    return null
  }
}

function hexUtf8(text: string): string {
  return `0x${Array.from(new TextEncoder().encode(text))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

/** The memo every top-up carries, so the payment can only be cashed in by Mochiro. */
export function topupMemo(config: WalletConfig, packId: string): string {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hexUtf8(`${config.memoPrefix}${packId}:${nonce}`)
}

// ----------------------------------------------------------------- signing --
export type Signer =
  | { kind: 'device'; password: string }
  | { kind: 'external'; provider: Eip1193 }

/** Gas needed on top of the amount: 21k-ish gas plus the memo bytes, with headroom. */
export async function estimateFee(config: WalletConfig, withMemo: boolean): Promise<bigint> {
  try {
    const response = await fetch(config.rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }),
    })
    const body = (await response.json()) as { result?: string }
    const price = body.result ? BigInt(body.result) : 30_000_000_000n
    return (price * (withMemo ? 30_000n : 21_000n) * 3n) / 2n
  } catch {
    return 2_000_000_000_000_000n // 0.002 USDC — far above Arc's real cost
  }
}

/** True when this device holds the key of `account` (Google accounts only). */
export function deviceHoldsKey(account: AuthAccount): boolean {
  return localWalletAddress()?.toLowerCase() === account.address.toLowerCase()
}

/**
 * Sends native USDC on Arc from the signed-in account and returns the tx hash.
 * Throws WalletError with a stable code ('bad-password', 'rejected', 'wrong-account',
 * 'insufficient', 'network', 'no-key').
 */
export async function sendFromAccount(
  account: AuthAccount,
  signer: Signer,
  tx: { to: string; wei: bigint; data?: string },
  config: WalletConfig
): Promise<string> {
  if (signer.kind === 'device') {
    if (!deviceHoldsKey(account)) throw new WalletError('no-key')
    const wallet = await unlockLocalWallet(signer.password)
    if (!wallet) throw new WalletError('bad-password')
    if (wallet.address.toLowerCase() !== account.address.toLowerCase()) throw new WalletError('no-key')
    const { JsonRpcProvider } = await loadEthers()
    const provider = new JsonRpcProvider(config.rpc, config.chainId, { staticNetwork: true })
    try {
      const sent = await wallet.connect(provider).sendTransaction({ to: tx.to, value: tx.wei, data: tx.data ?? '0x' })
      return sent.hash
    } catch (error) {
      throw mapSendError(error)
    } finally {
      provider.destroy()
    }
  }

  const provider = signer.provider
  try {
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
    const from = accounts?.find((a) => a.toLowerCase() === account.address.toLowerCase())
    if (!from) throw new WalletError('wrong-account')
    await ensureArcNetwork(provider, await chainConfig())
    const hash = (await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from, to: tx.to, value: `0x${tx.wei.toString(16)}`, ...(tx.data ? { data: tx.data } : {}) }],
    })) as string
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new WalletError('network')
    return hash
  } catch (error) {
    throw mapSendError(error)
  }
}

function mapSendError(error: unknown): WalletError {
  if (error instanceof WalletError) return error
  const e = error as { code?: number | string; message?: string; shortMessage?: string; info?: { error?: { message?: string } } }
  const text = `${e?.shortMessage ?? ''} ${e?.message ?? ''} ${e?.info?.error?.message ?? ''}`
  if (e?.code === 4001 || e?.code === 'ACTION_REJECTED' || /reject|denied|cancel/i.test(text)) return new WalletError('rejected')
  if (e?.code === 'INSUFFICIENT_FUNDS' || /insufficient/i.test(text)) return new WalletError('insufficient')
  return new WalletError('network')
}

// ------------------------------------------------------------------ top-up --
export type TopupOutcome =
  | { status: 'confirmed'; credited: number }
  | { status: 'pending' }
  | { status: 'error'; error: string }

export async function verifyTopup(clientId: string, hash: string, pack: string): Promise<TopupOutcome> {
  const token = authToken()
  try {
    const response = await fetch(api('wallet/topup'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ client_id: clientId, tx_hash: hash, pack }),
    })
    const body = (await response.json().catch(() => ({}))) as { status?: string; credited?: number; error?: string }
    if (response.status === 401) return { status: 'error', error: 'signed_out' }
    if (body.status === 'confirmed') return { status: 'confirmed', credited: Number(body.credited ?? 0) }
    if (body.status === 'pending') return { status: 'pending' }
    return { status: 'error', error: body.error ?? (response.status >= 500 ? 'offline' : 'failed') }
  } catch {
    return { status: 'pending' }
  }
}

export interface PendingTopup {
  clientId: string
  hash: string
  pack: string
  at: number
}

const PENDING_KEY = 'mochiro.topup.pending'

/** A paid-but-not-yet-credited top-up survives a closed tab and is finished on the next open. */
export function loadPendingTopups(clientId: string): PendingTopup[] {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as PendingTopup[]
    return Array.isArray(list) ? list.filter((p) => p.clientId === clientId && Date.now() - p.at < 47 * 3600_000) : []
  } catch {
    return []
  }
}

function writePending(list: PendingTopup[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-10)))
  } catch {
    /* storage unavailable */
  }
}

export function addPendingTopup(entry: PendingTopup): void {
  let list: PendingTopup[] = []
  try {
    list = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as PendingTopup[]
  } catch {
    list = []
  }
  writePending([...(Array.isArray(list) ? list : []).filter((p) => p.hash !== entry.hash), entry])
}

export function removePendingTopup(hash: string): void {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as PendingTopup[]
    writePending((Array.isArray(list) ? list : []).filter((p) => p.hash !== hash))
  } catch {
    /* ignore */
  }
}

/** Polls the server until the top-up is credited, fails, or `timeoutMs` passes. */
export async function waitForTopup(
  clientId: string,
  hash: string,
  pack: string,
  isCancelled: () => boolean,
  timeoutMs = 90_000
): Promise<TopupOutcome> {
  const started = Date.now()
  let delay = 1200
  while (!isCancelled()) {
    const outcome = await verifyTopup(clientId, hash, pack)
    if (outcome.status !== 'pending') return outcome
    if (Date.now() - started > timeoutMs) return outcome
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(4000, delay + 600)
  }
  return { status: 'pending' }
}

/** Waits until Arc has mined `hash`; true on success, false on revert, null on timeout. */
export async function waitReceipt(config: WalletConfig, hash: string, timeoutMs = 60_000): Promise<boolean | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(config.rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
      })
      const body = (await response.json()) as { result?: { status?: string } | null }
      if (body.result?.status) return body.result.status === '0x1'
    } catch {
      /* keep polling */
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return null
}

/** "3 min ago" in the player's language. */
export function timeAgo(iso: string, lang: 'vi' | 'en'): string {
  const seconds = Math.round((Date.parse(iso) - Date.now()) / 1000)
  if (!Number.isFinite(seconds)) return ''
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return rtf.format(seconds, 'second')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  return rtf.format(Math.round(seconds / 86400), 'day')
}
