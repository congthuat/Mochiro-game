/**
 * Which browser wallets are actually here.
 *
 * Two sources, because neither is complete on its own. EIP-6963 is the modern one: a wallet
 * announces itself with a name and a reverse-DNS id, and several wallets can coexist without
 * fighting over `window.ethereum`. Wallets older than that only set a flag on the injected
 * object, and only one of them can win the slot — the rest appear under `providers[]`.
 *
 * The id decides which catalog entry a wallet is; the announcement is never treated as proof
 * of anything, only as presentation.
 */
import { catalogKindForRdns, type CatalogWalletKind } from './walletCatalog'

export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, callback: (...args: never[]) => void) => void
  removeListener?: (event: string, callback: (...args: never[]) => void) => void
}

type InjectedProvider = Eip1193 & {
  isMetaMask?: boolean
  isRabby?: boolean
  isOkxWallet?: boolean
  isOKExWallet?: boolean
  isCoinbaseWallet?: boolean
  isTrust?: boolean
  isTrustWallet?: boolean
  isBitKeep?: boolean
  isBitgetWallet?: boolean
  isPhantom?: boolean
  isRainbow?: boolean
  isZerion?: boolean
  isBraveWallet?: boolean
  providers?: InjectedProvider[]
}

type WalletHost = {
  ethereum?: InjectedProvider
  okxwallet?: InjectedProvider
  phantom?: { ethereum?: InjectedProvider }
  bitkeep?: { ethereum?: InjectedProvider }
  trustwallet?: InjectedProvider
  coinbaseWalletExtension?: InjectedProvider
}

export type FoundWallet = {
  /** Stable key for React, and for remembering which one the player picked. */
  id: string
  kind: CatalogWalletKind | 'other'
  name: string
  provider: Eip1193
}

type Eip6963Detail = { info?: { rdns?: string; name?: string }; provider?: InjectedProvider }

const announced = new Map<string, FoundWallet>()
const listeners = new Set<() => void>()
let listening = false
let snapshot: FoundWallet[] = []

const host = (): WalletHost => (typeof window === 'undefined' ? {} : (window as unknown as WalletHost))

const isProvider = (value: unknown): value is InjectedProvider =>
  !!value && typeof value === 'object' && typeof (value as Eip1193).request === 'function'

/**
 * Flags are checked in order of specificity. Many wallets also claim `isMetaMask` so that
 * older sites recognise them, which is why it is checked last — otherwise every one of them
 * would be reported as MetaMask.
 */
function kindOf(provider: InjectedProvider, rdns?: string): CatalogWalletKind | 'other' {
  const fromRdns = catalogKindForRdns(rdns)
  if (fromRdns) return fromRdns
  if (provider.isRabby) return 'rabby'
  if (provider.isOkxWallet || provider.isOKExWallet) return 'okx'
  if (provider.isCoinbaseWallet) return 'coinbase'
  if (provider.isTrust || provider.isTrustWallet) return 'trust'
  if (provider.isBitKeep || provider.isBitgetWallet) return 'bitget'
  if (provider.isPhantom) return 'phantom'
  if (provider.isRainbow) return 'rainbow'
  if (provider.isZerion) return 'zerion'
  if (provider.isBraveWallet) return 'brave'
  if (provider.isMetaMask) return 'metamask'
  return 'other'
}

/** Rebuild the snapshot, dropping duplicates — one wallet can arrive by both routes. */
function publish(): void {
  const found: FoundWallet[] = []
  const seen = new Set<string>()

  const push = (wallet: FoundWallet) => {
    const key = `${wallet.kind}:${wallet.name.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    found.push(wallet)
  }

  for (const wallet of announced.values()) push(wallet)

  const source = host()
  const legacy: (InjectedProvider | undefined)[] = [
    source.okxwallet,
    source.phantom?.ethereum,
    source.bitkeep?.ethereum,
    source.trustwallet,
    source.coinbaseWalletExtension,
    source.ethereum,
    ...(source.ethereum?.providers ?? []),
  ]
  for (const provider of legacy) {
    if (!isProvider(provider)) continue
    const kind = kindOf(provider)
    push({ id: `${kind}:${found.length}`, kind, name: kind, provider })
  }

  snapshot = found
  for (const listener of listeners) listener()
}

/**
 * Start listening. Safe to call on every render — the listeners are attached once. The request
 * is dispatched again on each call, so a wallet that announced before this module loaded is
 * still found.
 */
export function watchWallets(): void {
  if (typeof window === 'undefined') return
  if (!listening) {
    listening = true
    window.addEventListener('eip6963:announceProvider', (event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail
      const rdns = detail?.info?.rdns
      if (!rdns || !isProvider(detail.provider)) return
      const kind = kindOf(detail.provider, rdns)
      announced.set(rdns, { id: rdns, kind, name: kind, provider: detail.provider })
      publish()
    })
    publish()
  }
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

/** Ask the wallets to announce again — what the "scan again" button does. */
export function rescanWallets(): void {
  announced.clear()
  publish()
  watchWallets()
}

export function foundWallets(): FoundWallet[] {
  return snapshot
}

export function subscribeWallets(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The provider for a wallet of a given kind, or null when this browser has none. */
export function providerFor(kind: string): Eip1193 | null {
  return snapshot.find((wallet) => wallet.kind === kind)?.provider ?? null
}
