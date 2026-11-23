// Live race screens: choosing a room, the waiting room, the in-race overlay (countdown,
// standings, "last one standing", spectating) and the result.
import { useEffect, useMemo, useState } from 'react'
import { Copy, Crown, Eye, Flag, Loader2, LogOut, Play, RotateCcw, Swords, Users, X, Zap } from 'lucide-react'
import { formatNumber, translate, useT } from '../../lib/i18n'
import { rivalColor } from '../../runner/rivals'
import { inviteRaceLink, normaliseCode, type RaceStanding, type RaceStatus } from '../../runner/race'

export const RACE_GOLD = 20

/** "Guest 1234" is the server's neutral spelling; show it in the player's language. */
export function raceDisplayName(name: string): string {
  const guest = /^Guest (\d+)$/.exec(name)
  return guest ? translate('race.guest', undefined, { n: guest[1] }) : name
}

function useName() {
  useT() // re-render on a language switch
  return raceDisplayName
}

/** Re-renders every `ms` while `on`. */
function useTicker(on: boolean, ms = 200): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!on) return undefined
    const timer = window.setInterval(() => setNow(performance.now()), ms)
    return () => window.clearInterval(timer)
  }, [on, ms])
  return now
}

// ------------------------------------------------------------------ lobby --
export function RaceLobby({
  status,
  creating,
  onQuick,
  onCreate,
  onJoin,
  onStartNow,
  onCancel,
  onClose,
}: {
  status: RaceStatus
  creating: boolean
  onQuick: () => void
  onCreate: () => void
  onJoin: (code: string) => void
  onStartNow: () => void
  onCancel: () => void
  onClose: () => void
}) {
  const t = useT()
  const show = useName()
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const waiting = status.stage === 'connecting' || status.stage === 'lobby'
  useTicker(status.stage === 'lobby' && status.startsAt !== null, 250)

  const me = status.players.find((p) => p.id === status.you)
  const isHost = Boolean(me?.host)
  const seconds = status.startsAt === null ? null : Math.max(0, Math.ceil((status.startsAt - Date.now()) / 1000))

  const copyLink = async () => {
    if (!status.code) return
    const link = inviteRaceLink(status.code)
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text: t('race.shareText', { code: status.code }), url: link })
        return
      }
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* dismissed or no clipboard */
    }
  }

  return (
    <div
      className="ar-screen"
      onClick={(event) => {
        if (event.target === event.currentTarget && !waiting) onClose()
      }}
    >
      <div className="ar-panel ar-modal ar-race-modal">
        <div className="flex items-center justify-between">
          <div className="ar-modal-title">
            <Swords size={18} className="inline-block align-[-3px]" /> {t('race.title')}
          </div>
          {!waiting && (
            <button className="ar-btn ar-btn-sm" onClick={onClose}>
              <X size={14} /> {t('race.close')}
            </button>
          )}
        </div>

        {!waiting && (
          <>
            <p className="ar-race-intro">{t('race.intro', { n: RACE_GOLD })}</p>
            <p className="ar-race-rules">{t('race.rules')}</p>
            {status.stage === 'error' && status.error && <p className="ar-race-error">{t(`race.err.${status.error}`)}</p>}
            <div className="ar-race-choices">
              <button className="ar-btn ar-btn-primary ar-race-choice" onClick={onQuick}>
                <Zap size={18} />
                <span>
                  <strong>{t('race.quick')}</strong>
                  <small>{t('race.quickHint')}</small>
                </span>
              </button>
              <button className="ar-btn ar-race-choice" onClick={onCreate} disabled={creating}>
                {creating ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}
                <span>
                  <strong>{t('race.create')}</strong>
                  <small>{t('race.createHint')}</small>
                </span>
              </button>
            </div>
            <form
              className="ar-race-code"
              onSubmit={(event) => {
                event.preventDefault()
                if (code.length === 4) onJoin(code)
              }}
            >
              <label htmlFor="ar-race-code">{t('race.codeLabel')}</label>
              <input
                id="ar-race-code"
                value={code}
                onChange={(event) => setCode(normaliseCode(event.target.value))}
                placeholder={t('race.codePlaceholder')}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={6}
              />
              <button className="ar-btn" type="submit" disabled={code.length !== 4}>
                {t('race.join')}
              </button>
            </form>
          </>
        )}

        {status.stage === 'connecting' && (
          <div className="ar-race-wait">
            <Loader2 size={28} className="animate-spin" />
            <div className="ar-race-wait-title">{t('race.connecting')}</div>
          </div>
        )}

        {status.stage === 'lobby' && (
          <div className="ar-race-wait">
            {status.kind === 'private' ? (
              <>
                <div className="ar-race-code-label">{t('race.roomCode')}</div>
                <div className="ar-race-code-big">{status.code}</div>
                <button className="ar-btn ar-btn-sm" onClick={() => void copyLink()}>
                  <Copy size={13} /> {copied ? t('race.copied') : t('race.copyLink')}
                </button>
              </>
            ) : (
              <>
                <Loader2 size={26} className="animate-spin" />
                <div className="ar-race-wait-title">{t('race.searching')}</div>
              </>
            )}
            <div className="ar-race-count">{t('race.waitingCount', { n: status.players.length, max: status.max })}</div>
            <ul className="ar-race-players">
              {status.players.map((p) => (
                <li key={p.id} style={{ '--ar-rival': rivalColor(p.id) } as React.CSSProperties}>
                  <i />
                  <span>{show(p.name)}</span>
                  {p.id === status.you && <em>{t('race.you')}</em>}
                  {status.kind === 'private' && p.host && (
                    <em className="is-host">
                      <Crown size={11} /> {t('race.host')}
                    </em>
                  )}
                </li>
              ))}
              {Array.from({ length: Math.max(0, status.max - status.players.length) }, (_, i) => (
                <li key={`empty-${i}`} className="is-empty">
                  <i />
                  <span>…</span>
                </li>
              ))}
            </ul>
            {status.kind === 'quick' && (
              <div className="ar-race-status">
                {seconds !== null ? t('race.startsIn', { n: seconds }) : t('race.needOne')}
              </div>
            )}
            {status.kind === 'private' &&
              (isHost ? (
                <button className="ar-btn ar-btn-primary ar-race-go" disabled={status.players.length < 2} onClick={onStartNow}>
                  <Play size={16} /> {status.players.length < 2 ? t('race.needPlayers') : t('race.hostStart')}
                </button>
              ) : (
                <div className="ar-race-status">{t('race.waitHost')}</div>
              ))}
            {status.reconnecting && <div className="ar-race-status">{t('race.reconnecting')}</div>}
          </div>
        )}

        {waiting && (
          <div className="ar-menu-actions">
            <button className="ar-btn" onClick={onCancel}>
              <X size={14} /> {t('race.cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// -------------------------------------------------------------- in a race --
interface Row {
  id: string
  name: string
  d: number
  out: boolean
  reason: string | null
  you: boolean
}

function liveRows(status: RaceStatus): Row[] {
  const rows = status.players.map((p) => {
    const out = status.outs[p.id]
    return {
      id: p.id,
      name: p.name,
      d: out ? out.d : status.distances[p.id] ?? 0,
      out: Boolean(out),
      ms: out?.ms ?? Infinity,
      reason: out?.reason ?? null,
      you: p.id === status.you,
    }
  })
  rows.sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1
    // Same order as the referee's final standings: a disqualified racer is always last.
    const dqA = a.reason === 'cheat'
    const dqB = b.reason === 'cheat'
    if (dqA !== dqB) return dqA ? 1 : -1
    if (a.out && Math.abs(a.ms - b.ms) > 100) return b.ms - a.ms
    return b.d - a.d
  })
  return rows
}

export function RaceHud({
  status,
  spectating,
  watching,
  onLeave,
}: {
  status: RaceStatus
  spectating: boolean
  watching: string | null
  onLeave: () => void
}) {
  const t = useT()
  const show = useName()
  const now = useTicker(status.stage === 'countdown' || (status.goAt !== null && performance.now() - status.goAt < 1500), 100)
  const [confirm, setConfirm] = useState(false)
  const [lastShown, setLastShown] = useState<number | null>(null)
  const rows = useMemo(() => liveRows(status), [status])
  const alive = rows.filter((r) => !r.out).length
  const youLast = status.lastId !== null && status.lastId === status.you

  useEffect(() => {
    if (!youLast) return undefined
    setLastShown(Date.now())
    const timer = window.setTimeout(() => setLastShown(null), 4200)
    return () => window.clearTimeout(timer)
  }, [youLast])

  const left = status.goAt === null ? 0 : status.goAt - now
  const countdown = left > 0 ? Math.ceil(left / 1000) : null
  const goFlash = left <= 0 && left > -900
  const watchedName = watching ? show(status.players.find((p) => p.id === watching)?.name ?? '') : ''

  return (
    <div className="ar-race-hud">
      {countdown !== null && (
        <div className="ar-race-countdown" key={countdown}>
          {countdown}
        </div>
      )}
      {countdown === null && goFlash && <div className="ar-race-countdown is-go">{t('race.go')}</div>}

      <div className="ar-race-side">
        <div className="ar-race-board" aria-live="polite">
          {rows.map((row, i) => (
            <div
              key={row.id}
              className={`ar-race-row${row.out ? ' is-out' : ''}${row.you ? ' is-you' : ''}`}
              style={{ '--ar-rival': rivalColor(row.id) } as React.CSSProperties}
            >
              <span className="ar-race-pos">{i + 1}</span>
              <i />
              <span className="ar-race-name">{row.you ? t('race.you') : show(row.name)}</span>
              <span className="ar-race-dist">{row.out && row.reason !== 'crash' ? t(`race.reason.${row.reason}`) : `${formatNumber(row.d)} m`}</span>
            </div>
          ))}
          {status.reconnecting && <div className="ar-race-note">{t('race.reconnecting')}</div>}
        </div>
        {!spectating && status.stage === 'running' && (
          <div className="ar-race-leave">
            {confirm ? (
              <div className="ar-race-confirm">
                <span>{t('race.leaveConfirm')}</span>
                <button className="ar-btn ar-btn-sm" onClick={onLeave}>
                  {t('race.leaveYes')}
                </button>
                <button className="ar-btn ar-btn-sm ar-btn-primary" onClick={() => setConfirm(false)}>
                  {t('race.leaveNo')}
                </button>
              </div>
            ) : (
              <button className="ar-btn ar-btn-sm ar-hud-btn" onClick={() => setConfirm(true)}>
                <Flag size={13} /> {t('race.leave')}
              </button>
            )}
          </div>
        )}
      </div>

      {lastShown !== null && (
        <div className="ar-race-banner">
          <Crown size={22} />
          <div>
            <strong>{t('race.lastOne')}</strong>
            <span>{t('race.lastOneHint')}</span>
          </div>
        </div>
      )}

      {spectating && status.stage !== 'done' && (
        <div className="ar-race-spectate">
          <div>
            <strong>{t('race.outTitle')}</strong>
            <span>
              {watchedName && (
                <>
                  <Eye size={13} className="inline-block align-[-2px]" /> {t('race.watching', { name: watchedName })} ·{' '}
                </>
              )}
              {t('race.alive', { n: alive })}
            </span>
            <small>{t('race.waitingEnd')}</small>
          </div>
          <button className="ar-btn ar-btn-sm" onClick={onLeave}>
            <LogOut size={13} /> {t('race.leave')}
          </button>
        </div>
      )}

    </div>
  )
}

// ----------------------------------------------------------------- result --
function rewardLine(t: (key: string, vars?: Record<string, string | number>) => string, reward: RaceStatus['reward'], youWon: boolean, signedIn: boolean): string | null {
  if (!youWon) return null
  if (!reward) return t('race.reward.pending')
  if (reward.rewarded) return t('race.reward.ok', { n: reward.gold })
  if (!signedIn || reward.reason === 'guest') return t('race.reward.guest')
  const known = ['daily_cap', 'short', 'no_contest', 'review', 'offline']
  return t(known.includes(reward.reason) ? `race.reward.${reward.reason}` : 'race.reward.other')
}

function Standings({ standings, isYou }: { standings: RaceStanding[]; isYou: (s: RaceStanding) => boolean }) {
  const t = useT()
  const show = useName()
  return (
    <div className="ar-rows ar-race-standings">
      {standings.map((s) => (
        <div key={`${s.rank}-${s.id}`} className={`ar-row${isYou(s) ? ' is-you' : ''}`}>
          <span className="ar-race-rank">{s.rank === 1 ? <Crown size={15} /> : s.rank}</span>
          <span className="ar-row-name">
            {show(s.name)}
            {isYou(s) && <em className="ar-race-you"> · {t('race.you')}</em>}
            {s.reason && s.reason !== 'crash' && <small className="ar-race-why"> · {t(`race.reason.${s.reason}`)}</small>}
          </span>
          <span className="ar-row-score">{formatNumber(s.d)} m</span>
        </div>
      ))}
    </div>
  )
}

export function RaceResult({
  status,
  signedIn,
  onAgain,
  onMenu,
}: {
  status: RaceStatus
  signedIn: boolean
  onAgain: () => void
  onMenu: () => void
}) {
  const t = useT()
  const standings = status.standings ?? []
  const mine = standings.find((s) => s.id === status.you)
  const youWon = mine?.rank === 1
  const line = rewardLine(t, status.reward, youWon, signedIn)
  return (
    <div className="ar-screen ar-race-result-screen">
      <div className="ar-panel ar-modal ar-race-modal">
        <div className="ar-modal-title">{t('race.resultTitle')}</div>
        <div className={`ar-race-headline${youWon ? ' is-win' : ''}`}>
          {youWon ? (
            <>
              <Crown size={22} /> {t('race.youWon')}
            </>
          ) : mine ? (
            t('race.youPlaced', { n: mine.rank })
          ) : null}
        </div>
        {line && <div className={`ar-race-reward${status.reward?.rewarded ? ' is-paid' : ''}`}>{line}</div>}
        <Standings standings={standings} isYou={(s) => s.id === status.you} />
        <div className="ar-menu-actions">
          <button className="ar-btn ar-btn-primary" onClick={onAgain}>
            <RotateCcw size={15} /> {t('race.again')}
          </button>
          <button className="ar-btn" onClick={onMenu}>
            {t('race.menuBack')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The end of a race the player had left, shown the next time they are on the menu. */
export function RaceRecap({
  standings,
  reward,
  won,
  signedIn,
  onClose,
}: {
  standings: RaceStanding[]
  reward: RaceStatus['reward']
  won: boolean
  signedIn: boolean
  onClose: () => void
}) {
  const t = useT()
  const mine = standings.find((s) => s.you)
  const line = rewardLine(t, reward, won, signedIn)
  return (
    <div
      className="ar-screen"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ar-panel ar-modal ar-race-modal">
        <div className="flex items-center justify-between">
          <div className="ar-modal-title">{t('race.recapTitle')}</div>
          <button className="ar-btn ar-btn-sm" onClick={onClose}>
            <X size={14} /> {t('race.close')}
          </button>
        </div>
        <div className={`ar-race-headline${won ? ' is-win' : ''}`}>
          {won ? (
            <>
              <Crown size={22} /> {t('race.youWon')}
            </>
          ) : mine ? (
            t('race.youPlaced', { n: mine.rank })
          ) : null}
        </div>
        {line && <div className={`ar-race-reward${reward?.rewarded ? ' is-paid' : ''}`}>{line}</div>}
        <Standings standings={standings} isYou={(s) => Boolean(s.you)} />
      </div>
    </div>
  )
}

/** The menu's entry point, under "Start sprint". */
export function RaceMenuButton({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <button className="ar-btn ar-race-menu-btn" onClick={onClick}>
      <Swords size={16} />
      <span>
        <strong>{t('race.menu')}</strong>
        <small>{t('race.menuHint', { n: RACE_GOLD })}</small>
      </span>
    </button>
  )
}
