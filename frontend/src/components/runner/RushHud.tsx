// Mochiro HUD: score, Arc coin counter, multiplier, speed meter, power-ups,
// touch controls and transient overlays.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Pause, Gauge, Zap, Magnet, Shield, ShieldCheck, Coins, Ghost, Shuffle, CloudFog, Weight, Compass, TriangleAlert, Check, Siren } from 'lucide-react'
import { formatNumber, useT } from '../../lib/i18n'
import { BIOMES, BIOME_LAP, POWER_BY_KIND, ZONE_ICONS } from '../../runner/config'
import type { PowerKind } from '../../runner/types'
import { formatScore, formatSpeed } from '../../runner/utils'
import type { HudState, PickupEvent, ToastMsg } from '../../runner/types'
import type { RushAction } from '../../runner/input'

export function ArcIcon({ logo, size = 38, className = '' }: { logo: string | null; size?: number; className?: string }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt="Gold"
        width={size}
        height={size}
        className={`ar-coin-icon ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className={`ar-coin-icon flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-label="Gold"
    >
      <svg viewBox="0 0 40 40" width={size * 0.62} height={size * 0.62}>
        <circle cx="20" cy="20" r="14" fill="none" stroke="#a9ecff" strokeWidth="3" strokeDasharray="62 26" strokeLinecap="round" />
        <text x="20" y="25" textAnchor="middle" fontSize="13" fontFamily="Orbitron, sans-serif" fill="#eaf8ff">
          A
        </text>
      </svg>
    </div>
  )
}

/** Icon per pickup, chosen so the HUD matches the 3D glyph on the road. */
const POWER_ICON: Record<PowerKind, typeof Zap> = {
  shield: Shield,
  magnet: Magnet,
  boost: Zap,
  double: Coins,
  ghost: Ghost,
  invert: Shuffle,
  fog: CloudFog,
  heavy: Weight,
}

const POWER_GLOW: Record<PowerKind, string> = {
  shield: '#4fd8ff',
  magnet: '#b47cff',
  boost: '#ff9b3d',
  double: '#ffd45e',
  ghost: '#6ef0d4',
  invert: '#ff5d73',
  fog: '#9aa7c2',
  heavy: '#c98a4b',
}

export function RushHud({
  hud,
  pickup,
  brandLogo,
  onPause,
  showFps,
  isTouch,
  onAction,
}: {
  hud: HudState
  pickup: PickupEvent | null
  brandLogo: string | null
  onPause: () => void
  showFps: boolean
  isTouch: boolean
  onAction: (action: RushAction) => void
}) {
  const t = useT()
  const [pop, setPop] = useState(false)
  const [bump, setBump] = useState(false)
  const [floats, setFloats] = useState<{ id: number; text: string; hot: boolean }[]>([])
  const [banner, setBanner] = useState<{ id: number; power: PowerKind; warded: boolean } | null>(null)
  const [flash, setFlash] = useState<{ id: number; colour: string } | null>(null)
  const lastMultiplier = useRef(hud.multiplier)
  const [zoneCard, setZoneCard] = useState<{ id: number; biome: string; lap: number } | null>(null)
  const lastBiome = useRef(hud.biome)
  const zoneIndex = Math.max(0, BIOMES.findIndex((zone) => zone.name === hud.biome))

  // Entering a new zone: its name comes up as a title card for a moment.
  useEffect(() => {
    if (hud.biome === lastBiome.current) return undefined
    lastBiome.current = hud.biome
    setZoneCard({ id: Date.now(), biome: hud.biome, lap: hud.lap })
    return undefined
  }, [hud.biome, hud.lap])

  // The card bows out on its own after three seconds.
  useEffect(() => {
    if (!zoneCard) return undefined
    const { id } = zoneCard
    const timer = window.setTimeout(() => setZoneCard((current) => (current?.id === id ? null : current)), 3000)
    return () => window.clearTimeout(timer)
  }, [zoneCard])

  // Every banked pickup answers back: the counter kicks, a "+N" rises off it, and
  // power-ups additionally slam a banner and a colour flash across the screen.
  useEffect(() => {
    if (!pickup) return undefined
    if (pickup.kind === 'coin') {
      const id = pickup.id
      setBump(true)
      setFloats((prev) => [...prev.slice(-4), { id, text: `+${pickup.amount}`, hot: pickup.multiplierUp }])
      const settle = window.setTimeout(() => setBump(false), 210)
      const clear = window.setTimeout(() => setFloats((prev) => prev.filter((item) => item.id !== id)), 900)
      return () => {
        window.clearTimeout(settle)
        window.clearTimeout(clear)
      }
    }
    const power = pickup.power
    if (!power) return undefined
    setBanner({ id: pickup.id, power, warded: pickup.warded })
    setFlash({ id: pickup.id, colour: pickup.warded ? '#4fd8ff' : POWER_GLOW[power] ?? '#4fd8ff' })
    const bannerTimer = window.setTimeout(() => setBanner((current) => (current?.id === pickup.id ? null : current)), 1250)
    const flashTimer = window.setTimeout(() => setFlash((current) => (current?.id === pickup.id ? null : current)), 560)
    return () => {
      window.clearTimeout(bannerTimer)
      window.clearTimeout(flashTimer)
    }
  }, [pickup])

  useEffect(() => {
    if (hud.multiplier !== lastMultiplier.current) {
      lastMultiplier.current = hud.multiplier
      setPop(true)
      const timer = window.setTimeout(() => setPop(false), 340)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [hud.multiplier])

  const speedPct = Math.min(100, Math.max(0, ((hud.speed - 12) / 34) * 100))

  return (
    <div className={`ar-hud${isTouch ? ' is-touch' : ''}`}>
      {/* Overdrive: wind streaks rushing out from the vanishing point plus a hot edge glow. */}
      <div className={`ar-rush${hud.boost > 0 ? ' is-on' : ''}`} aria-hidden />
      <div className="ar-hud-top">
        <div>
          <div className="ar-score-label">{t('hud.score')}</div>
          <div className="ar-score">{formatScore(hud.score)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="ar-chip">
              {t('hud.best')} <strong>{formatScore(Math.max(hud.best, hud.score))}</strong>
            </span>
            <span className="ar-chip">
              <Gauge size={13} /> {hud.tierKey ? t(hud.tierKey) : hud.tierName}
            </span>
            <span className="ar-chip ar-chip-zone ar-hud-zone">
              <Compass size={13} /> {t(`biome.${hud.biome}`)}
            </span>
            {showFps && (
              <span className="ar-chip">
                <strong>{hud.fps}</strong> FPS
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <button className="ar-btn ar-btn-sm ar-hud-btn" onClick={onPause} aria-label={t('hud.pause')}>
            <Pause size={14} /> {t('hud.pause')}
          </button>
          <div className="text-right">
            <div className="ar-score-label">{t('hud.combo')}</div>
            <div className="ar-mult">
              ×{hud.multiplier}
              <span className="ml-2 text-[12px] tracking-[0.2em] text-[#5d7096]">{hud.combo} GOLD</span>
            </div>
          </div>
        </div>
      </div>

      <div className="ar-hud-track">
        <div className="ar-journey" aria-label={t('hud.zoneOf', { n: zoneIndex + 1, total: BIOMES.length })}>
          <span className="ar-journey-bar">
            <i className="ar-journey-fill" style={{ width: `${Math.min(100, hud.lapProgress * 100)}%` }} />
            {BIOMES.slice(1).map((zone) => (
              <i key={zone.name} className="ar-journey-tick" style={{ left: `${(zone.at / BIOME_LAP) * 100}%` }} />
            ))}
            <span className="ar-journey-pin" style={{ left: `${Math.min(100, hud.lapProgress * 100)}%` }}>
              {ZONE_ICONS[hud.biome] ?? '🏁'}
            </span>
          </span>
          <span className="ar-journey-note">
            {t('hud.zoneOf', { n: zoneIndex + 1, total: BIOMES.length })}
            {hud.lap > 0 && <> · {t('hud.journey', { n: hud.lap + 1 })}</>}
          </span>
        </div>
        {hud.event && (
          <div className={`ar-event ar-event-${hud.event.kind}${hud.event.phase === 'incoming' ? ' is-incoming' : ''}`}>
            <span className="ar-event-label">
              {hud.event.kind === 'goldRush' ? <Coins size={14} /> : <Siren size={14} />}
              {t(`event.${hud.event.kind}`)}
            </span>
            {hud.event.phase === 'incoming' ? (
              <span className="ar-event-note">{t('event.incoming', { n: hud.event.seconds })}</span>
            ) : (
              <>
                <span className="ar-event-bar">
                  <i style={{ width: `${Math.max(0, 100 - hud.event.progress * 100)}%` }} />
                </span>
                <span className="ar-event-note">{hud.event.seconds}s</span>
              </>
            )}
          </div>
        )}
        {hud.heat > 0.02 && (
          <div className={`ar-pursuit${hud.heat > 0.7 ? ' is-hot' : ''}`}>
            <span className="ar-pursuit-label">
              <TriangleAlert size={13} /> {t('hud.pursuit')}
            </span>
            <span className="ar-pursuit-bar">
              <i style={{ width: `${Math.min(100, hud.heat * 100)}%` }} />
            </span>
          </div>
        )}
        {hud.missions.length > 0 && (
          <div className="ar-mission-strip">
            {hud.missions.map((mission) => (
              <span key={mission.id} className={`ar-mission${mission.done ? ' is-done' : ''}`}>
                <Check size={11} />
                <span className="ar-mission-name">{t(`mission.${mission.id}`)}</span>
                <span className="ar-mission-count">
                  {mission.done ? `+${formatNumber(mission.reward)}` : `${formatNumber(Math.min(mission.progress, mission.target))}/${formatNumber(mission.target)}`}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="ar-badge-row">
        {pop && <span className="ar-toast ar-toast-good ar-mult-pop">{t('hud.combo')} ×{hud.multiplier}</span>}
      </div>

      {banner && (
        <div
          className={`ar-power-banner${
            !banner.warded && POWER_BY_KIND[banner.power].harmful ? ' ar-power-banner-bad' : ''
          }`}
          style={{ '--ar-power': banner.warded ? '#4fd8ff' : POWER_GLOW[banner.power] } as CSSProperties}
        >
          <span className="ar-power-banner-tag">
            {(() => {
              const Icon = banner.warded ? ShieldCheck : POWER_ICON[banner.power] ?? Zap
              return <Icon size={20} />
            })()}
            {t(banner.warded ? 'power.ward.label' : `power.${banner.power}.label`)}
          </span>
          <span className="ar-power-banner-hint">
            {t(banner.warded ? 'power.ward.hint' : `power.${banner.power}.hint`)}
          </span>
        </div>
      )}
      {zoneCard && (
        <div key={zoneCard.id} className="ar-zone-card" aria-live="polite">
          <span className="ar-zone-card-icon">{ZONE_ICONS[zoneCard.biome] ?? '🏁'}</span>
          <span className="ar-zone-card-name">{t(`biome.${zoneCard.biome}`)}</span>
          <span className="ar-zone-card-note">
            {t('hud.zoneOf', { n: Math.max(0, BIOMES.findIndex((zone) => zone.name === zoneCard.biome)) + 1, total: BIOMES.length })}
            {zoneCard.lap > 0 && <> · {t('hud.journey', { n: zoneCard.lap + 1 })}</>}
          </span>
        </div>
      )}
      {hud.fog > 0 && <div className="ar-fog" style={{ opacity: Math.min(0.92, hud.fog * 0.5) }} />}
      {hud.invert > 0 && <div className="ar-invert" />}
      {flash && (
        <div
          className="ar-flash"
          style={{ background: `radial-gradient(circle at 50% 58%, ${flash.colour}00 22%, ${flash.colour}66 62%, ${flash.colour}cc 100%)` }}
        />
      )}

      <div className="ar-hud-bottom">
        <div className="flex flex-col gap-2">
          <div className={`ar-coin-counter${bump ? ' ar-bump' : ''}`}>
            <ArcIcon logo={brandLogo} />
            <div>
              <div className={`ar-coin-count${bump ? ' ar-bump-num' : ''}`}>{hud.coins}</div>
              <div className="ar-coin-unit">{t('hud.arcCollected')}</div>
            </div>
            {floats.map((item) => (
              <span key={item.id} className={`ar-float${item.hot ? ' ar-float-hot' : ''}`}>
                {item.text}
              </span>
            ))}
          </div>
          <div className="ar-hud-trip flex gap-2">
            <span className="ar-chip">
              <strong>{hud.distance}</strong> m
            </span>
            <span className="ar-chip">
              {t('hud.top')} <strong>{formatSpeed(hud.topSpeed)}</strong> km/h
            </span>
          </div>
          {(hud.shield ||
            hud.magnet > 0 ||
            hud.boost > 0 ||
            hud.double > 0 ||
            hud.ghost > 0 ||
            hud.invert > 0 ||
            hud.fog > 0 ||
            hud.heavy > 0) && (
            <div className="ar-power-row">
              {hud.shield && (
                <span className="ar-power-pill" style={{ '--ar-power': POWER_GLOW.shield } as CSSProperties}>
                  <Shield size={12} /> {t('power.shield.pill')}{hud.shieldHits > 1 ? ` ×${hud.shieldHits}` : ''}
                </span>
              )}
              {hud.magnet > 0 && (
                <span className="ar-power-pill" style={{ '--ar-power': POWER_GLOW.magnet } as CSSProperties}>
                  <Magnet size={12} /> {t('power.magnet.pill')} {hud.magnet.toFixed(1)}s
                  <span className="ar-power-bar">
                    <span style={{ width: `${Math.min(100, (hud.magnet / POWER_BY_KIND.magnet.duration) * 100)}%` }} />
                  </span>
                </span>
              )}
              {hud.boost > 0 && (
                <span className="ar-power-pill" style={{ '--ar-power': POWER_GLOW.boost } as CSSProperties}>
                  <Zap size={12} /> {t('power.boost.pill')} {hud.boost.toFixed(1)}s
                </span>
              )}
              {hud.double > 0 && (
                <span className="ar-power-pill" style={{ '--ar-power': POWER_GLOW.double } as CSSProperties}>
                  <Coins size={12} /> {t('power.double.pill')} {hud.double.toFixed(1)}s
                  <span className="ar-power-bar">
                    <span style={{ width: `${Math.min(100, (hud.double / POWER_BY_KIND.double.duration) * 100)}%` }} />
                  </span>
                </span>
              )}
              {hud.ghost > 0 && (
                <span className="ar-power-pill" style={{ '--ar-power': POWER_GLOW.ghost } as CSSProperties}>
                  <Ghost size={12} /> {t('power.ghost.pill')} {hud.ghost.toFixed(1)}s
                  <span className="ar-power-bar">
                    <span style={{ width: `${Math.min(100, (hud.ghost / POWER_BY_KIND.ghost.duration) * 100)}%` }} />
                  </span>
                </span>
              )}
              {hud.invert > 0 && (
                <span className="ar-power-pill ar-power-pill-bad">
                  <Shuffle size={12} /> {t('power.invert.pill')} {hud.invert.toFixed(1)}s
                  <span className="ar-power-bar">
                    <span style={{ width: `${Math.min(100, (hud.invert / POWER_BY_KIND.invert.duration) * 100)}%` }} />
                  </span>
                </span>
              )}
              {hud.fog > 0 && (
                <span className="ar-power-pill ar-power-pill-bad">
                  <CloudFog size={12} /> {t('power.fog.pill')} {hud.fog.toFixed(1)}s
                  <span className="ar-power-bar">
                    <span style={{ width: `${Math.min(100, (hud.fog / POWER_BY_KIND.fog.duration) * 100)}%` }} />
                  </span>
                </span>
              )}
              {hud.heavy > 0 && (
                <span className="ar-power-pill ar-power-pill-bad">
                  <Weight size={12} /> {t('power.heavy.pill')} {hud.heavy.toFixed(1)}s
                  <span className="ar-power-bar">
                    <span style={{ width: `${Math.min(100, (hud.heavy / POWER_BY_KIND.heavy.duration) * 100)}%` }} />
                  </span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="ar-speed">
          <div className="ar-speed-label ar-score-label">{t('hud.speed')}</div>
          <div className="ar-speed-value">
            {formatSpeed(hud.speed)}
            <span className="ar-speed-unit ml-1">km/h</span>
          </div>
          <div className="ar-meter">
            <span style={{ width: `${speedPct}%` }} />
          </div>
        </div>
      </div>

      {isTouch && (
        <div className="ar-touch">
          <div className="ar-touch-group">
            <button className="ar-touch-btn" onPointerDown={() => onAction('left')} aria-label={t('hud.leftLane')}>
              ◀
            </button>
            <button className="ar-touch-btn" onPointerDown={() => onAction('right')} aria-label={t('hud.rightLane')}>
              ▶
            </button>
          </div>
          <div className="ar-touch-group">
            <button className="ar-touch-btn" onPointerDown={() => onAction('slide')} aria-label={t('hud.slide')}>
              ▼
              <span>{t('hud.slide').toUpperCase()}</span>
            </button>
            <button
              className="ar-touch-btn ar-touch-btn-primary"
              onPointerDown={() => onAction('jump')}
              aria-label={t('hud.jump')}
            >
              ▲
              <span>{t('hud.jump').toUpperCase()}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function RushToasts({ toasts }: { toasts: ToastMsg[] }) {
  return (
    <div className="ar-toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`ar-toast ar-toast-${toast.kind}`}>
          {toast.text}
        </div>
      ))}
    </div>
  )
}

export function HitOverlay({ hitCount, boosting, shielded }: { hitCount: number; boosting: boolean; shielded: boolean }) {
  return (
    <>
      {hitCount > 0 && <div key={hitCount} className="ar-flash" />}
      {boosting && <div className="ar-boost-vignette" />}
      {shielded && <div className="ar-shield-ring" />}
    </>
  )
}

export function SwipeHint({ onDone }: { onDone?: () => void }) {
  const t = useT()
  useEffect(() => {
    const timer = window.setTimeout(() => onDone?.(), 2600)
    return () => window.clearTimeout(timer)
  }, [onDone])

  return (
    <div className="ar-swipe-hint">
      <div>
        {t('hud.swipeLanes')}
        <br />
        {t('hud.swipeRest')}
      </div>
    </div>
  )
}
