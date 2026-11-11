// Mochiro HUD: score, Arc coin counter, multiplier, speed meter, power-ups,
// touch controls and transient overlays.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Pause, Gauge, Zap, Magnet, Shield, ShieldCheck, Coins, Ghost, Shuffle, CloudFog, Weight, Compass, TriangleAlert, Check } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { POWER_BY_KIND } from '../../runner/config'
import type { PowerKind } from '../../runner/types'
import { formatScore, formatSpeed } from '../../runner/utils'
import type { HudState, PickupEvent, ToastMsg } from '../../runner/types'
import type { RushAction } from '../../runner/input'

export function ArcIcon({ logo, size = 38, className = '' }: { logo: string | null; size?: number; className?: string }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt="Arc"
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
      aria-label="Arc"
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
    <div className="ar-hud">
      <div className="ar-hud-top">
        <div>
          <div className="ar-score-label">{t('hud.score')}</div>
          <div className="ar-score">{formatScore(hud.score)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="ar-chip">
              {t('hud.best')} <strong>{formatScore(Math.max(hud.best, hud.score))}</strong>
            </span>
            <span className="ar-chip">
              <Gauge size={13} /> {hud.tierName}
            </span>
            <span className="ar-chip ar-chip-zone">
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
              <span className="ml-2 text-[12px] tracking-[0.2em] text-[#5d7096]">{hud.combo} ARC</span>
            </div>
          </div>
        </div>
      </div>

      <div className="ar-hud-track">
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
                  {mission.done ? `+${mission.reward}` : `${Math.min(mission.progress, mission.target)}/${mission.target}`}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="ar-badge-row">
        {pop && <span className="ar-toast ar-toast-good ar-mult-pop">Multiplier ×{hud.multiplier}</span>}
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
          <div className="flex gap-2">
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
                  <Shield size={12} /> {t('power.shield.pill')} ×hud.shieldHits
                </span>
              )}
              {hud.magnet > 0 && (
                <span className="ar-power-pill" style={{ '--ar-power': POWER_GLOW.magnet } as CSSProperties}>
                  <Magnet size={12} /> {t('power.magnet.pill')} {hud.magnet.toFixed(1)}s
                  <span className="ar-power-bar">
                    <span style={{ width: `${(hud.magnet / POWER_BY_KIND.magnet.duration) * 100}%` }} />
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
                    <span style={{ width: `${(hud.double / POWER_BY_KIND.double.duration) * 100}%` }} />
                  </span>
                </span>
              )}
              {hud.ghost > 0 && (
                <span className="ar-power-pill" style={{ '--ar-power': POWER_GLOW.ghost } as CSSProperties}>
                  <Ghost size={12} /> {t('power.ghost.pill')} {hud.ghost.toFixed(1)}s
                  <span className="ar-power-bar">
                    <span style={{ width: `${(hud.ghost / POWER_BY_KIND.ghost.duration) * 100}%` }} />
                  </span>
                </span>
              )}
              {hud.invert > 0 && (
                <span className="ar-power-pill ar-power-pill-bad">
                  <Shuffle size={12} /> {t('power.invert.pill')} {hud.invert.toFixed(1)}s
                  <span className="ar-power-bar">
                    <span style={{ width: `${(hud.invert / POWER_BY_KIND.invert.duration) * 100}%` }} />
                  </span>
                </span>
              )}
              {hud.fog > 0 && (
                <span className="ar-power-pill ar-power-pill-bad">
                  <CloudFog size={12} /> {t('power.fog.pill')} {hud.fog.toFixed(1)}s
                  <span className="ar-power-bar">
                    <span style={{ width: `${(hud.fog / POWER_BY_KIND.fog.duration) * 100}%` }} />
                  </span>
                </span>
              )}
              {hud.heavy > 0 && (
                <span className="ar-power-pill ar-power-pill-bad">
                  <Weight size={12} /> {t('power.heavy.pill')} {hud.heavy.toFixed(1)}s
                  <span className="ar-power-bar">
                    <span style={{ width: `${(hud.heavy / POWER_BY_KIND.heavy.duration) * 100}%` }} />
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
