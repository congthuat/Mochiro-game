// WalletConnect pairing, for wallet apps on a phone.
//
// The injected-wallet button only works where a wallet has put itself into the page — MetaMask
// on a desktop, or a wallet's own built-in browser. A phone opening mochiro.xyz in Safari has
// nothing to inject, so without this there is no way to sign in with a wallet at all.
//
// The provider is imported lazily. It is a large dependency that most players never touch, so
// it stays out of the main bundle and arrives only once a wallet has actually been chosen.
import type { Eip1193 } from './auth'

/**
 * Public project id. It is safe in client code — the relay restricts it by domain allowlist —
 * and can be replaced without a rebuild by setting VITE_WALLETCONNECT_PROJECT_ID.
 */
export const WALLETCONNECT_PROJECT_ID: string =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) || 'ac840b47c8005425a4b4f2cf7e14b63a'

export const walletConnectReady = (): boolean => /^[0-9a-f]{32}$/i.test(WALLETCONNECT_PROJECT_ID)

const ARC_CHAIN_ID = 5042002
const ARC_RPC = 'https://rpc.testnet.arc.io'

export type WcWallet = { id: string; name: string; native: string; logo: string }

/**
 * Deep links taken from the official WalletConnect registry. Each button names one app on both
 * Android and iOS, so a phone never hands the pairing to whichever wallet happens to be default.
 * Ordered by how many people carry them, not alphabetically.
 */
export const WC_WALLETS: WcWallet[] = [
  { id: 'metamask', name: 'MetaMask', native: 'metamask://', logo: 'metamask.svg' },
  { id: 'okxwallet', name: 'OKX Wallet', native: 'okxwallet://main', logo: 'okxwallet.png' },
  { id: 'binance', name: 'Binance Wallet', native: 'bnc://app.binance.com/cedefi/', logo: 'binance.png' },
  { id: 'trust', name: 'Trust Wallet', native: 'trust://', logo: 'trust.png' },
  { id: 'bitget', name: 'Bitget Wallet', native: 'bitkeep://', logo: 'bitget.png' },
  { id: 'okx', name: 'OKX', native: 'okex://main', logo: 'okx.png' },
]

/**
 * The mark for a wallet that has put itself into the page. `walletLabel` names the four the
 * detector can recognise; anything else falls back to a generic icon rather than a wrong logo.
 */
export const INJECTED_LOGOS: Record<string, string> = {
  MetaMask: 'metamask.svg',
  Rabby: 'rabby.svg',
  'OKX Wallet': 'okxwallet.png',
  'Coinbase Wallet': 'coinbase.png',
}

/** A scheme has to end in "://" or "/" before `wc?uri=` can be appended to it. */
export function wcNativeLink(native: string, uri: string): string {
  let base = native
  if (!base.includes('://')) base = `${base.replace(/[/:]/g, '')}://`
  if (!base.endsWith('/')) base = `${base}/`
  return `${base}wc?uri=${encodeURIComponent(uri)}`
}

export const isMobile = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)))

/** UniversalProvider is headless, so the pairing URI is an event rather than a rendered modal. */
type WcProvider = Eip1193 & {
  connect: (options: unknown) => Promise<unknown>
  disconnect?: () => Promise<void>
  on: (event: string, handler: (...args: never[]) => void) => void
  removeListener?: (event: string, handler: (...args: never[]) => void) => void
  client?: { core?: { relayer?: { on: (event: string, handler: (error: unknown) => void) => void } } }
}

/**
 * Errors a player can act on. `wc-origin` means the WalletConnect project does not list this
 * site's domain; `wc-timeout` means the relay never answered; `wc-expired` means nobody
 * approved the pairing in time.
 */
export type WcError = 'wc-origin' | 'wc-timeout' | 'wc-expired'

/** How long to wait for the code before calling it a failure instead of spinning forever. */
const URI_TIMEOUT_MS = 15000
/** How long a shown code stays valid while the player finds their phone. */
const APPROVE_TIMEOUT_MS = 5 * 60 * 1000

let resolvedProjectId: string | null = null

/** Build-time id first, then the one the deployment's backend serves, then the default. */
async function projectId(): Promise<string> {
  if (resolvedProjectId) return resolvedProjectId
  const fromEnv = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim()
  let id = fromEnv || ''
  if (!id) {
    try {
      const { chainConfig } = await import('./auth')
      const served = (await chainConfig()).walletConnectProjectId?.trim()
      if (served && /^[0-9a-f]{32}$/i.test(served)) id = served
    } catch {
      /* fall back to the default */
    }
  }
  resolvedProjectId = id || WALLETCONNECT_PROJECT_ID
  return resolvedProjectId
}

/**
 * Pair with one wallet and return a provider the sign-in flow can use.
 *
 * On a phone the pairing URI is handed to the chosen app through its own deep link, which opens
 * the wallet with the request already loaded. On a desktop the caller draws it as a QR code.
 * Every failure ends in a thrown error — never an endless spinner.
 */
export async function connectWallet(wallet: WcWallet, onUri?: (uri: string) => void): Promise<Eip1193> {
  if (!walletConnectReady()) throw new Error('walletconnect-not-configured')
  if (typeof window === 'undefined') throw new Error('walletconnect-no-window')

  const mod = (await import('@walletconnect/universal-provider')) as unknown as {
    default?: { init?: unknown }
    UniversalProvider?: { init?: unknown }
  }
  const Universal = (typeof mod.default?.init === 'function' ? mod.default : mod.UniversalProvider) as {
    init: (options: unknown) => Promise<unknown>
  }
  const origin = window.location.origin

  const provider = (await Universal.init({
    projectId: await projectId(),
    metadata: {
      name: 'Mochiro',
      description: 'Endless runner on Arc',
      url: origin,
      icons: [`${origin}${import.meta.env.BASE_URL}favicon.ico`],
    },
  })) as WcProvider

  let fail: (error: Error) => void = () => {}
  const failed = new Promise<never>((_, reject) => {
    fail = reject
  })
  failed.catch(() => {})

  // The relay closes the socket with "origin not allowed" when the project's domain allowlist
  // does not include this site. Without listening for it the code simply never arrives.
  provider.client?.core?.relayer?.on('relayer_error', (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error ?? '')
    if (/origin not allowed|unauthorized/i.test(text)) fail(new Error('wc-origin'))
  })

  const uri = new Promise<string>((resolve) => {
    provider.on('display_uri', (value: never) => resolve(String(value)))
  })

  // Optional, not required: a wallet that has never heard of Arc testnet would refuse a
  // session that *requires* it. The sign-in flow adds and switches to Arc afterwards.
  const connecting = provider.connect({
    optionalNamespaces: {
      eip155: {
        methods: ['personal_sign', 'eth_sendTransaction', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'],
        chains: [`eip155:${ARC_CHAIN_ID}`, 'eip155:1'],
        events: ['chainChanged', 'accountsChanged'],
        rpcMap: { [ARC_CHAIN_ID]: ARC_RPC },
      },
    },
  })
  connecting.catch(() => {})

  const giveUp = (ms: number, code: WcError) =>
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(code)), ms))

  try {
    const first = await Promise.race([uri, failed, giveUp(URI_TIMEOUT_MS, 'wc-timeout')])
    if (isMobile()) {
      // The tap already happened — the player chose this wallet — so the app may be opened.
      window.location.href = wcNativeLink(wallet.native, first)
    }
    // Always offer the code too: on a phone it is the fallback when the app did not open.
    onUri?.(first)
    await Promise.race([connecting, failed, giveUp(APPROVE_TIMEOUT_MS, 'wc-expired')])
    return provider
  } catch (error) {
    void provider.disconnect?.().catch(() => {})
    throw error
  }
}
