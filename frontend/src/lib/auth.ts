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

const SESSION_KEY = 'arcrush.session'
const VAULT_KEY = 'arcrush.wallet.vault'
const CLIENT_ID_KEY = 'arcrush.google.clientId'
const GOOGLE_SRC = 'https://accounts.google.com/gsi/client'

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

/** Re-validate the stored token against the server (it may have expired). */
export async function refreshSession(): Promise<AuthSession> {
  const stored = readSession()
  try {
    const response = await fetch(api('auth'), {
      headers: stored ? { authorization: `Bearer ${stored.token}` } : {},
    })
    const body = (await response.json()) as AuthSession
    if (body.authenticated && body.account && stored) writeSession({ token: stored.token, account: body.account })
    if (!body.authenticated) writeSession(null)
    return body
  } catch {
    return { authenticated: Boolean(stored), account: stored?.account ?? null, chainId: 5042002 }
  }
}

export async function signOut(): Promise<void> {
  const stored = readSession()
  writeSession(null)
  if (!stored) return
  try {
    await fetch(api('auth/logout'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
    cachedConfig = (await response.json()) as ChainConfig
    const served = cachedConfig.googleClientId?.trim()
    if (served?.endsWith('.apps.googleusercontent.com')) remoteClientId = served
  } catch {
    cachedConfig = {
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
  await ensureArcNetwork(injected, config)

  const challenge = await fetch(api('auth/nonce'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  }).then((response) => response.json() as Promise<{ message?: string; error?: string }>)
  if (!challenge.message) throw new Error(challenge.error || 'challenge-failed')

  const { BrowserProvider } = await loadEthers()
  const provider = new BrowserProvider(injected as never)
  const signer = await provider.getSigner()
  const signature = await signer.signMessage(challenge.message)

  const verified = await fetch(api('auth/verify'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: challenge.message, signature }),
  }).then((response) => response.json() as Promise<{ token?: string; account?: AuthAccount; error?: string }>)
  if (!verified.token || !verified.account) throw new Error(verified.error || 'verify-failed')
  writeSession({ token: verified.token, account: verified.account })
  return verified.account
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
  const response = await fetch(api('auth/google'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential, wallet, clientId: googleClientId() }),
  })
  const body = (await response.json()) as {
    token?: string | null
    account?: AuthAccount | null
    needsWallet?: boolean
    error?: string
  }
  if (body.error) throw new Error(body.error)
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
