/**
 * The browser wallets the connect dialog lists.
 *
 * Presentation only: whether a wallet is actually present is decided by its own announcement
 * (EIP-6963) or by an injected provider, never by this list. The install links are the wallets'
 * own download pages, so a player who has none of them has somewhere to go.
 *
 * Ported from the Makoto Wallet catalog, which is the same list the reference dialog shows.
 */
export type CatalogWalletKind =
  | 'metamask'
  | 'okx'
  | 'rabby'
  | 'coinbase'
  | 'trust'
  | 'bitget'
  | 'phantom'
  | 'rainbow'
  | 'zerion'
  | 'brave'

export type CatalogWallet = Readonly<{
  kind: CatalogWalletKind
  name: string
  /** EIP-6963 reverse-DNS identifiers this wallet announces. */
  rdns: readonly string[]
  installUrl: string
  /** The mark under public/wallets. */
  logo: string
  /** Monogram tile, used only if the logo fails to load — no remote images. */
  mono: Readonly<{ text: string; bg: string; fg: string }>
}>

export const WALLET_CATALOG: readonly CatalogWallet[] = Object.freeze([
  {
    kind: 'metamask',
    name: 'MetaMask',
    rdns: ['io.metamask', 'io.metamask.flask'],
    installUrl: 'https://metamask.io/download/',
    logo: 'metamask.svg',
    mono: { text: 'M', bg: '#f6851b', fg: '#ffffff' },
  },
  {
    kind: 'okx',
    name: 'OKX Wallet',
    rdns: ['com.okex.wallet', 'com.okx.wallet'],
    installUrl: 'https://www.okx.com/web3',
    logo: 'okxwallet.png',
    mono: { text: 'OKX', bg: '#000000', fg: '#ffffff' },
  },
  {
    kind: 'rabby',
    name: 'Rabby',
    rdns: ['io.rabby'],
    installUrl: 'https://rabby.io/',
    logo: 'rabby.svg',
    mono: { text: 'R', bg: '#7084ff', fg: '#ffffff' },
  },
  {
    kind: 'coinbase',
    name: 'Coinbase Wallet',
    rdns: ['com.coinbase.wallet'],
    installUrl: 'https://www.coinbase.com/wallet/downloads',
    logo: 'coinbase.png',
    mono: { text: 'C', bg: '#0052ff', fg: '#ffffff' },
  },
  {
    kind: 'trust',
    name: 'Trust Wallet',
    rdns: ['com.trustwallet.app'],
    installUrl: 'https://trustwallet.com/browser-extension',
    logo: 'trust.png',
    mono: { text: 'T', bg: '#0500ff', fg: '#ffffff' },
  },
  {
    kind: 'bitget',
    name: 'Bitget Wallet',
    rdns: ['com.bitget.web3'],
    installUrl: 'https://web3.bitget.com/en/wallet-download',
    logo: 'bitget.png',
    mono: { text: 'BG', bg: '#00f0ff', fg: '#0b0b10' },
  },
  {
    kind: 'phantom',
    name: 'Phantom',
    rdns: ['app.phantom'],
    installUrl: 'https://phantom.com/download',
    logo: 'phantom.png',
    mono: { text: 'P', bg: '#ab9ff2', fg: '#1c1c1c' },
  },
  {
    kind: 'rainbow',
    name: 'Rainbow',
    rdns: ['me.rainbow'],
    installUrl: 'https://rainbow.me/extension',
    logo: 'rainbow.png',
    mono: { text: 'R', bg: '#174299', fg: '#ffffff' },
  },
  {
    kind: 'zerion',
    name: 'Zerion',
    rdns: ['io.zerion.wallet'],
    installUrl: 'https://zerion.io/download',
    logo: 'zerion.png',
    mono: { text: 'Z', bg: '#2962ef', fg: '#ffffff' },
  },
  {
    kind: 'brave',
    name: 'Brave Wallet',
    rdns: ['com.brave.wallet'],
    installUrl: 'https://brave.com/wallet/',
    logo: 'brave.png',
    mono: { text: 'B', bg: '#fb542b', fg: '#ffffff' },
  },
])

/** The two the reference dialog links directly when nothing is installed. */
export const STORE_LINKS: readonly CatalogWalletKind[] = ['okx', 'metamask']

const BY_RDNS = new Map(WALLET_CATALOG.flatMap((wallet) => wallet.rdns.map((rdns) => [rdns, wallet.kind] as const)))

export function catalogKindForRdns(rdns: string | undefined): CatalogWalletKind | undefined {
  return rdns ? BY_RDNS.get(rdns.toLowerCase()) : undefined
}

export function catalogWallet(kind: string): CatalogWallet | undefined {
  return WALLET_CATALOG.find((wallet) => wallet.kind === kind)
}
