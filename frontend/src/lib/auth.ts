// Mochiro sign-in client.
//
// Two ways in, exactly like the Makoto wallet reference:
//   • an injected browser wallet — Sign-In with Ethereum, the server hands out a
//     challenge and checks the signature;
//   • Google — the ID token is verified server-side, and the device mints an Arc
//     wallet whose key is encrypted with a password the player chooses. The key
//     never leaves the browser.
// ethers is ~100 KB gzipped and only needed at the moment a player signs in, so it is
// fetched on demand instead of riding in the first download.
import type { Wallet } from 'ethers'
const loadEthers = () => import('ethers')
import { api } from './api'

export interface AuthAccount {
  address: string
  method: 'wallet' | 'google'
  walletKind: 'eoa' | 'embedded'
  email: string | null
  displayName: string | null
}

export interface AuthSession {
  authenticated: boolean
  account: AuthAccount | null
  chainId: number
}

export interface ChainConfig {
  chainId: number
  chainHex: string
  chainName: string
  rpc: string
  explorer: string
  currency: { name: string; symbol: string; decimals: number }
  googleClientId: string | null
  walletConnectProjectId?: string | null
}

interface Stored {
  token: string
  account: AuthAccount
}

/** localStorage key of the signed-in session; other tabs watch it through `storage` events. */
export const SESSION_KEY = 'arcrush.session'
const VAULT_KEY = 'arcrush.wallet.vault'
const CLIENT_ID_KEY = 'arcrush.google.clientId'
const GOOGLE_SRC = 'https://accounts.google.com/gsi/client'

// ------------------------------------------------------------------ errors --
/**
 * A sign-in failure with a stable `code`. Codes are either our own ('network', 'server',
 * 'no-wallet', ...) or the server's machine codes ('wallet_owned', 'link_expired',
 * 'slow_down'); older server routes answer with an English sentence, kept in `detail`.
 */
export class AuthError extends Error {
  readonly code: string
  readonly status: number
  readonly detail: string
  constructor(code: string, status = 0, detail = '') {
    super(code)
    this.name = 'AuthError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/** The body as JSON when it is JSON. An HTML 502 page from a proxy is not, and must not throw. */
async function readBody<T>(response: Response): Promise<Partial<T> & { error?: string }> {
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('json')) return {}
  try {
    return ((await response.json()) ?? {}) as Partial<T> & { error?: string }
  } catch {
    return {}
  }
}

/** POST JSON; a dropped connection becomes AuthError('network'), a 5xx AuthError('server'). */
async function postAuth<T>(path: string, payload: unknown): Promise<{ status: number; data: Partial<T> & { error?: string } }> {
  let response: Response
  try {
    response = await fetch(api(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new AuthError('network')
  }
  const data = await readBody<T>(response)
  if (response.status >= 500 && !data.error) throw new AuthError('server', response.status)
  if (response.status === 429) throw new AuthError('slow_down', 429, data.error ?? '')
  return { status: response.status, data }
}

/** Machine codes the server sends as-is (everything else is a sentence, kept as detail). */
const SERVER_CODES = new Set(['wallet_owned', 'link_expired', 'slow_down', 'unavailable'])

function serverError(status: number, error: string | undefined, fallback: string): AuthError {
  if (error && SERVER_CODES.has(error)) return new AuthError(error, status, error)
  if (status >= 500) return new AuthError('server', status, error ?? '')
  return new AuthError(fallback, status, error ?? '')
}

/**
 * The i18n key to show for a sign-in failure, or null when there is nothing to say (the
 * player backed out of a pairing on purpose). The raw error goes to the console only.
 */
export function authErrorKey(error: unknown): string | null {
  const code = error instanceof AuthError ? error.code : error instanceof Error ? error.message : ''
  const detail = error instanceof AuthError ? error.detail : ''
  const raw = error as { code?: unknown; message?: unknown; info?: { error?: { code?: unknown } } } | null
  const numeric = typeof raw?.code === 'number' ? raw.code : (raw?.info?.error?.code as number | undefined)
  const text = `${code} ${detail} ${typeof raw?.message === 'string' ? raw.message : ''}`

  if (code === 'wc-cancelled') return null
  if (
    numeric === 4001 ||
    raw?.code === 'ACTION_REJECTED' ||
    /user (rejected|denied|cancel)|rejected the request|request rejected|user disapproved/i.test(text)
  ) {
    return 'auth.err.rejected'
  }
  const known: Record<string, string> = {
    'no-wallet': 'auth.err.noWallet',
    'no-account': 'auth.err.noAccount',
    'verify-failed': 'auth.err.verify',
    'walletconnect-not-configured': 'auth.err.wcConfig',
    'walletconnect-no-window': 'auth.err.wcConfig',
    'wc-origin': 'pick.wcErrOrigin',
    'wc-timeout': 'pick.wcErrTimeout',
    'wc-expired': 'pick.wcErrExpired',
    network: 'auth.err.network',
    server: 'auth.err.server',
    unavailable: 'auth.err.server',
    'challenge-failed': 'auth.err.server',
    slow_down: 'auth.err.slowDown',
    wallet_owned: 'auth.err.walletOwned',
    link_expired: 'auth.err.expired',
    'weak-password': 'auth.passwordHint',
    'storage-unavailable': 'auth.err.storage',
    'google-failed': 'auth.err.google',
  }
  const direct = known[code]
  if (direct && code !== 'verify-failed' && code !== 'google-failed') return direct
  // Older routes answer with a sentence; the sentence is matched, never shown.
  if (/domain mismatch/i.test(text)) return 'auth.err.domain'
  if (/switch your wallet to arc/i.test(text)) return 'auth.err.chain'
  if (/expired/i.test(text)) return 'auth.err.expired'
  if (/signature|malformed sign-in/i.test(text)) return 'auth.err.verify'
  if (/google/i.test(text)) return 'auth.err.google'
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) return 'auth.err.network'
  if (direct) return direct
  console.error('[auth] sign-in failed', error)
  return 'auth.error'
}

// ------------------------------------------------------------------ session --
export function readSession(): Stored | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (!parsed?.token || !parsed.account?.address) return null
    return parsed
  } catch {
    return null
  }
}

function writeSession(session: Stored | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* private mode */
  }
}

export function authToken(): string | null {
  return readSession()?.token ?? null
}

/** Forget the local session without telling the server (it already said the token is dead). */
export function clearSession(): void {
  writeSession(null)
}

/**
 * Re-validate the stored token against the server (it may have expired).
 *
 * Only a definite answer — HTTP 200 with `authenticated: false` — ends the session. A dropped
 * connection, a 5xx (`{error:'unavailable'}`) or a proxy's HTML error page says nothing about
 * the token, so the cached session stays and `reachable: false` tells the caller to ask again
 * later instead of throwing the player back to the sign-in gate.
 */
export async function refreshSession(): Promise<AuthSession & { reachable: boolean }> {
  const stored = readSession()
  const cached = { authenticated: Boolean(stored), account: stored?.account ?? null, chainId: 5042002, reachable: false }
  try {
    const response = await fetch(api('auth'), {
      headers: stored ? { authorization: `Bearer ${stored.token}` } : {},
    })
    if (response.status !== 200) return cached
    const body = await readBody<AuthSession>(response)
    if (typeof body.authenticated !== 'boolean') return cached
    // Another tab may have signed in as someone else while this request was out.
    const now = readSession()
    if (stored && now?.token !== stored.token) return { ...cached, authenticated: Boolean(now), account: now?.account ?? null }
    if (body.authenticated && body.account && stored) writeSession({ token: stored.token, account: body.account })
    if (!body.authenticated) writeSession(null)
    return {
      authenticated: body.authenticated,
      account: body.authenticated ? (body.account ?? stored?.account ?? null) : null,
      chainId: body.chainId ?? 5042002,
      reachable: true,
    }
  } catch {
    return cached
  }
}

export async function signOut(): Promise<void> {
  const stored = readSession()
  writeSession(null)
  if (!stored) return
  try {
    await fetch(api('auth/logout'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${stored.token}` },
      body: JSON.stringify({ token: stored.token }),
    })
  } catch {
    /* the token is already gone locally */
  }
}

// --------------------------------------------------------------- chain info --
let cachedConfig: ChainConfig | null = null

export async function chainConfig(): Promise<ChainConfig> {
  if (cachedConfig) return cachedConfig
  try {
    const response = await fetch(api('auth/config'))
    const body: Partial<ChainConfig> = response.ok ? await readBody<ChainConfig>(response) : {}
    if (typeof body.chainId !== 'number' || typeof body.chainHex !== 'string') throw new Error('config-unavailable')
    cachedConfig = body as ChainConfig
    const served = cachedConfig.googleClientId?.trim()
    if (served?.endsWith('.apps.googleusercontent.com')) remoteClientId = served
  } catch {
    // Not cached: the next sign-in attempt asks the server again instead of living with the
    // fallback for the rest of the visit.
    return {
      chainId: 5042002,
      chainHex: '0x4cef52',
      chainName: 'Arc Testnet',
      rpc: 'https://rpc.testnet.arc.io',
      explorer: 'https://testnet.arcscan.app',
      currency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      googleClientId: null,
    }
  }
  return cachedConfig
}

/**
 * The id the backend is configured with, learned from /api/auth/config. It is the deployment's
 * own answer, so it outranks a value someone pasted into this browser by hand.
 */
let remoteClientId: string | null = null

/** Mochiro's own OAuth client. Public by design; the backend pins the same id. */
const MOCHIRO_CLIENT_ID = '116160392215-dd77so1e6nr44u39ldcc5l4pco1mu9gp.apps.googleusercontent.com'

export function googleClientId(): string | null {
  const fromEnv = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim()
  if (fromEnv) return fromEnv
  if (remoteClientId) return remoteClientId
  return MOCHIRO_CLIENT_ID
}

export function rememberGoogleClientId(id: string): void {
  try {
    localStorage.setItem(CLIENT_ID_KEY, id.trim())
  } catch {
    /* ignore */
  }
  cachedConfig = null
}

// ------------------------------------------------------------ injected wallet --
export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, handler: (...args: never[]) => void) => void
  removeListener?: (event: string, handler: (...args: never[]) => void) => void
}

export function injectedProvider(): Eip1193 | null {
  if (typeof window === 'undefined') return null
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum
  return eth && typeof eth.request === 'function' ? eth : null
}

export function walletLabel(): string | null {
  const eth = (window as unknown as { ethereum?: { isMetaMask?: boolean; isRabby?: boolean; isOkxWallet?: boolean; isCoinbaseWallet?: boolean } }).ethereum
  if (!eth) return null
  if (eth.isRabby) return 'Rabby'
  if (eth.isOkxWallet) return 'OKX Wallet'
  if (eth.isCoinbaseWallet) return 'Coinbase Wallet'
  if (eth.isMetaMask) return 'MetaMask'
  return 'Browser wallet'
}

/** Point the wallet at Arc testnet, adding the network if it has never seen it. */
export async function ensureArcNetwork(provider: Eip1193, config: ChainConfig): Promise<void> {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: config.chainHex }] })
  } catch (error) {
    const code = (error as { code?: number })?.code
    if (code !== 4902 && !/unrecognized|not added|unknown chain/i.test((error as Error)?.message ?? '')) throw error
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: config.chainHex,
          chainName: config.chainName,
          nativeCurrency: config.currency,
          rpcUrls: [config.rpc],
          blockExplorerUrls: [config.explorer],
        },
      ],
    })
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: config.chainHex }] })
  }
}

/** Connect an injected wallet and complete a SIWE sign-in. */
/**
 * Sign in by proving control of a wallet address.
 *
 * The provider is a parameter because there are two ways to have one: a wallet that injected
 * itself into the page, and a wallet paired over WalletConnect. Everything after the provider
 * is identical, so it lives here once.
 */
export async function signInWithWallet(external?: Eip1193): Promise<AuthAccount> {
  const injected = external ?? injectedProvider()
  if (!injected) throw new Error('no-wallet')
  const config = await chainConfig()

  const accounts = (await injected.request({ method: 'eth_requestAccounts' })) as string[]
  const address = Array.isArray(accounts) ? accounts[0] : null
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('no-account')
  // Best effort only. The sign-in message is built by the server and carries Arc's chain id
  // itself, and personal_sign does not depend on the wallet's active network — so a wallet
  // that refuses (or does not support) switching must not stop the player signing in.
  try {
    await ensureArcNetwork(injected, config)
  } catch (error) {
    console.warn('[auth] could not switch the wallet to Arc; signing in anyway', error)
  }

  const challenge = await postAuth<{ message: string }>('auth/nonce', { address })
  if (!challenge.data.message) throw serverError(challenge.status, challenge.data.error, 'challenge-failed')

  const message = challenge.data.message
  const { BrowserProvider } = await loadEthers()
  const provider = new BrowserProvider(injected as never)
  const signer = await provider.getSigner()
  const signature = await signer.signMessage(message)

  const verified = await postAuth<{ token: string; account: AuthAccount }>('auth/verify', { message, signature })
  if (!verified.data.token || !verified.data.account) {
    throw serverError(verified.status, verified.data.error, 'verify-failed')
  }
  writeSession({ token: verified.data.token, account: verified.data.account })
  return verified.data.account
}

// ------------------------------------------------------------- google sign-in --
interface GoogleIdentity {
  accounts?: {
    id?: {
      initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void }) => void
      renderButton: (element: HTMLElement, options: Record<string, unknown>) => void
      disableAutoSelect: () => void
    }
  }
}

let googleScript: Promise<boolean> | null = null

/** Load Google Identity Services once. */
export function loadGoogleIdentity(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false)
  if (googleScript) return googleScript
  googleScript = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(true))
      existing.addEventListener('error', () => resolve(false))
      if ((window as unknown as { google?: GoogleIdentity }).google) resolve(true)
      return
    }
    const script = document.createElement('script')
    script.src = GOOGLE_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.head.appendChild(script)
  })
  return googleScript
}

export function googleIdentity(): GoogleIdentity | null {
  return (window as unknown as { google?: GoogleIdentity }).google ?? null
}

/** Exchange a Google ID token for a session. `wallet` proves a device key. */
export async function signInWithGoogle(
  credential: string,
  wallet?: { address: string; message: string; signature: string }
): Promise<{ account: AuthAccount | null; needsWallet: boolean; email?: string }> {
  const { status, data: body } = await postAuth<{
    token: string | null
    account: AuthAccount | null
    needsWallet: boolean
  }>('auth/google', { credential, wallet, clientId: googleClientId() })
  // 409 wallet_owned: the device wallet is another account's. 401 link_expired: the link
  // message is stale. Both arrive as codes; anything else is a sentence matched for its meaning.
  if (body.error || status >= 400) throw serverError(status, body.error, 'google-failed')
  if (body.token && body.account) {
    writeSession({ token: body.token, account: body.account })
    return { account: body.account, needsWallet: false }
  }
  return { account: null, needsWallet: body.needsWallet ?? true }
}

// ------------------------------------------------------------ embedded wallet --
interface Vault {
  address: string
  cipher: string
  iv: string
  salt: string
}

const bytesToB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
const b64ToBytes = (value: string): Uint8Array => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 210000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function readVault(): Vault | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Vault
    return parsed?.address && parsed.cipher && parsed.iv && parsed.salt ? parsed : null
  } catch {
    return null
  }
}

export function hasLocalWallet(): boolean {
  return Boolean(readVault())
}

export function localWalletAddress(): string | null {
  return readVault()?.address ?? null
}

export function forgetLocalWallet(): void {
  try {
    localStorage.removeItem(VAULT_KEY)
  } catch {
    /* ignore */
  }
}

/** Mint a wallet on this device and lock the key behind `password`. */
export async function createLocalWallet(password: string): Promise<{ address: string; privateKey: string }> {
  if (password.length < 8) throw new Error('weak-password')
  const { Wallet } = await loadEthers()
  const wallet = Wallet.createRandom()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(wallet.privateKey)
  )
  const vault: Vault = {
    address: wallet.address,
    cipher: bytesToB64(new Uint8Array(cipher)),
    iv: bytesToB64(iv),
    salt: bytesToB64(salt),
  }
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(vault))
  } catch {
    throw new Error('storage-unavailable')
  }
  return { address: wallet.address, privateKey: wallet.privateKey }
}

/** Decrypt the device wallet, or null when the password is wrong. */
export async function unlockLocalWallet(password: string): Promise<Wallet | null> {
  const vault = readVault()
  if (!vault) return null
  try {
    const key = await deriveKey(password, b64ToBytes(vault.salt))
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(vault.iv) as unknown as BufferSource },
      key,
      b64ToBytes(vault.cipher) as unknown as BufferSource
    )
    const { Wallet } = await loadEthers()
    return new Wallet(new TextDecoder().decode(plain))
  } catch {
    return null
  }
}

/** The message an embedded wallet signs so the server can link the address. */
export function linkMessage(address: string, email: string | null, chainId: number): string {
  return [
    'Link this Arc wallet to my Mochiro account.',
    '',
    `Address: ${address}`,
    `Account: ${email ?? 'google'}`,
    `Chain ID: ${chainId}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n')
}

export function shortAddress(address: string | null | undefined): string {
  if (!address || address.length < 10) return address ?? ''
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
