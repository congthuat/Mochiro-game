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

export type WcWallet = { id: string; name: string; native: string }

/**
 * Deep links taken from the official WalletConnect registry. Each button names one app on both
 * Android and iOS, so a phone never hands the pairing to whichever wallet happens to be default.
 */
export const WC_WALLETS: WcWallet[] = [
  { id: 'okx', name: 'OKX', native: 'okex://main' },
  { id: 'okxwallet', name: 'OKX Wallet', native: 'okxwallet://main' },
  { id: 'binance', name: 'Binance Wallet', native: 'bnc://app.binance.com/cedefi/' },
  { id: 'metamask', name: 'MetaMask', native: 'metamask://' },
  { id: 'trust', name: 'Trust Wallet', native: 'trust://' },
  { id: 'bitget', name: 'Bitget Wallet', native: 'bitkeep://' },
]

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
  on: (event: string, handler: (...args: never[]) => void) => void
  removeListener?: (event: string, handler: (...args: never[]) => void) => void
}

/**
 * Pair with one wallet and return a provider the sign-in flow can use.
 *
 * On a phone the pairing URI is handed to the chosen app through its own deep link, which opens
 * the wallet with the request already loaded. On a desktop there is no app to open, so the
 * caller is expected to have offered the injected route instead.
 */
export async function connectWallet(wallet: WcWallet): Promise<Eip1193> {
  if (!walletConnectReady()) throw new Error('walletconnect-not-configured')
  if (typeof window === 'undefined') throw new Error('walletconnect-no-window')

  const { default: UniversalProvider } = await import('@walletconnect/universal-provider')
  const origin = window.location.origin

  const provider = (await UniversalProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    metadata: {
      name: 'Mochiro',
      description: 'Endless runner on Arc',
      url: origin,
      icons: [`${origin}/favicon.ico`],
    },
  })) as unknown as WcProvider

  const uri = new Promise<string>((resolve) => {
    provider.on('display_uri', (value: never) => resolve(String(value)))
  })

  const connecting = provider.connect({
    namespaces: {
      eip155: {
        methods: [
          'personal_sign',
          'eth_sign',
          'eth_sendTransaction',
          'wallet_switchEthereumChain',
          'wallet_addEthereumChain',
        ],
        chains: [`eip155:${ARC_CHAIN_ID}`],
        events: ['chainChanged', 'accountsChanged'],
        rpcMap: { [ARC_CHAIN_ID]: ARC_RPC },
      },
    },
  })

  if (isMobile()) {
    // The wallet app cannot be opened without a tap somewhere, and the tap already happened —
    // the player chose this wallet. Waiting forever would strand them if the event never fires.
    const first = await Promise.race([uri, new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))])
    if (first) window.location.href = wcNativeLink(wallet.native, first)
  }

  await connecting
  return provider
}
