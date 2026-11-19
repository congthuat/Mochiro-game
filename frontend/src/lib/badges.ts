// Mochiro NFT badges on Arc: soulbound ERC-721 milestones. The server checks the milestone
// on verified runs and hands back a signed voucher; the player's own wallet sends the mint,
// so the badge lands straight in their address and nothing is signed with their key server-side.
import { api } from './api'
import { authToken, type AuthAccount } from './auth'
import { sendFromAccount, waitReceipt, type Signer, type WalletConfig } from './arcWallet'

export type BadgeMetric = 'best_distance' | 'best_combo' | 'best_score' | 'hard_distance' | 'runs' | 'week_rank'

export interface BadgeInfo {
  id: number
  key: string
  metric: BadgeMetric
  target: number
  reached: boolean
}

export interface BadgeProgress {
  runs: number
  best_distance: number
  best_score: number
  best_combo: number
  hard_distance: number
  week_rank: number | null
}

export interface BadgeState {
  chainId: number
  explorer: string
  contract: string | null
  owner: string
  deployed: boolean
  ready: boolean
  weekMinPlayers: number
  badges: BadgeInfo[]
  progress: BadgeProgress | null
  owned: number[]
  signedIn: boolean
}

export interface BadgeSetup {
  available: boolean
  contract?: string
  owner?: string
  deployed?: boolean
  deploy?: { to: string; data: string } | null
  fixSigner?: { to: string; data: string } | null
}

export class BadgeError extends Error {
  constructor(public code: string) {
    super(code)
  }
}

const authHeaders = (): Record<string, string> => {
  const token = authToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

export async function fetchBadges(): Promise<BadgeState> {
  const response = await fetch(api('badges'), { headers: authHeaders(), cache: 'no-store' })
  if (!response.ok) throw new BadgeError('unavailable')
  const body = (await response.json()) as BadgeState
  if (!Array.isArray(body?.badges)) throw new BadgeError('unavailable')
  return { ...body, owned: Array.isArray(body.owned) ? body.owned : [] }
}

export async function fetchBadgeSetup(): Promise<BadgeSetup> {
  const response = await fetch(api('badges/setup'), { cache: 'no-store' })
  if (!response.ok) throw new BadgeError('unavailable')
  return (await response.json()) as BadgeSetup
}

export async function refreshBadges(): Promise<void> {
  await fetch(api('badges/refresh'), { method: 'POST' }).catch(() => undefined)
}

/** Token id = badge << 160 | holder, so every badge has a stable explorer link. */
export function badgeTokenId(badge: number, holder: string): string {
  return ((BigInt(badge) << 160n) | BigInt(holder)).toString()
}

export function badgeImage(key: string): string {
  return `${import.meta.env.BASE_URL}badges/${key}.svg`
}

/** Asks the server for a signed voucher; the mint transaction is then sent from the player's wallet. */
export async function requestVoucher(badge: number): Promise<{ to: string; data: string }> {
  const response = await fetch(api('badges/claim'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ badge }),
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string; contract?: string; data?: string }
  if (!response.ok || !body.contract || !body.data) throw new BadgeError(body.error ?? 'claim_failed')
  return { to: body.contract, data: body.data }
}

export async function sendContractTx(
  account: AuthAccount,
  signer: Signer,
  tx: { to: string; data: string },
  config: WalletConfig
): Promise<string> {
  return sendFromAccount(account, signer, { to: tx.to, wei: 0n, data: tx.data }, config)
}

export { waitReceipt }
