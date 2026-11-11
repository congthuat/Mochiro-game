import { useEffect, useRef, useState } from 'react'
import { Activity, Crosshair, Gem, Pause, Shield, Skull, Timer, Zap } from 'lucide-react'
import type { Game } from '../../game/Game'
import type { HudState, ToastMsg, ZoneIntro } from '../../game/types'
import { formatScore, formatTime } from '../../game/utils'

const TOAST_TONE: Record<ToastMsg['tone'], string> = {
  info: 'border-l-[#6ee7ff] text-[#d6f2ff]',
  good: 'border-l-[#6ef0a8] text-[#d6ffe8]',
  warn: 'border-l-[#ffd479] text-[#fff2d2]',
  bad: 'border-l-[#ff5c8a] text-[#ffd9e3]',
}

export function Hud({
  hud,
  onPause,
  showFps,
}: {
  hud: HudState
  onPause: () => void
  showFps: boolean
}) {
  const hpPct = Math.max(0, Math.min(100, (hud.hp / Math.max(1, hud.maxHp)) * 100))
  const energyPct = Math.max(0, Math.min(100, (hud.energy / Math.max(1, hud.maxEnergy)) * 100))
  const shardPct = hud.shardsTotal > 0 ? Math.min(100, (hud.shards / hud.shardsTotal) * 100) : 0
  const enemyPct = hud.enemiesTotal > 0 ? Math.max(0, Math.min(100, 100 - (hud.enemies / hud.enemiesTotal) * 100)) : 0
  const lowHp = hpPct < 35

  const hint = hud.portalOpen
    ? 'Beacon online — reach the portal'
    : hud.shards < hud.shardsTotal && hud.enemies > 0
      ? 'Collect shards · cleanse hostiles'
      : hud.shards < hud.shardsTotal
        ? `Find the remaining ${hud.shardsTotal - hud.shards} shard(s)`
        : `Defeat the remaining ${hud.enemies} hostile(s)`

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* Vitals */}
      <div className="absolute left-4 top-4 w-[286px] max-w-[46vw]">
        <div className="ae-panel-soft p-3">
          <div className="flex items-start gap-3">
            <div className={`mt-[3px] h-[42px] w-[3px] shrink-0 rounded-full ${lowHp ? 'ae-pulse bg-[#ff5c8a]' : 'bg-[#6ee7ff]/50'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between">
                <span className={`ae-sub inline-flex items-center gap-1.5 ${lowHp ? 'text-[#ff9db4]' : ''}`}>
                  <Shield size={11} /> Integrity
                </span>
                <span className="font-semibold tabular-nums text-[13px] text-[#e9f2ff]">
                  {hud.hp}
                  <span className="text-[#93a7c9]">/{hud.maxHp}</span>
                </span>
              </div>
              <div className="ae-bar mt-1">
                <div className="ae-bar-fill ae-bar-hp" style={{ width: `${hpPct}%` }} />
              </div>

              <div className="mt-2 flex items-baseline justify-between">
                <span className="ae-sub">Aether</span>
                <span className="font-semibold tabular-nums text-[12px] text-[#9fe9ff]">{hud.energy}</span>
              </div>
              <div className="ae-bar mt-1 h-[8px]">
                <div className="ae-bar-fill ae-bar-energy" style={{ width: `${energyPct}%` }} />
              </div>

              <div className="mt-2 flex items-center gap-2">
                <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[#0a1226]/80">
                  <div
                    className="h-full rounded-full transition-all duration-200"
                    style={{
                      width: `${hud.dashReady * 100}%`,
                      background: hud.dashReady >= 1 ? 'linear-gradient(90deg,#7cf5e0,#6ee7ff)' : 'rgba(110,231,255,0.35)',
                    }}
                  />
                </div>
                <span className="ae-sub !tracking-[0.2em]">{hud.dashReady >= 1 ? 'dash ready' : 'dash'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <span className="ae-chip">
            <Gem size={14} className="text-[#8ef6ff]" />
            <span className="tabular-nums">
              {hud.shards}
              <span className="text-[#93a7c9]">/{hud.shardsTotal}</span>
            </span>
            <span className="hidden text-[#93a7c9] sm:inline">shards</span>
          </span>
          <span className="ae-chip">
            <Skull size={14} className="text-[#ff8aa6]" />
            <span className="tabular-nums">
              {hud.enemies}
              <span className="text-[#93a7c9]">/{hud.enemiesTotal}</span>
            </span>
            <span className="hidden text-[#93a7c9] sm:inline">hostiles</span>
          </span>
          {hud.portalOpen && (
            <span className="ae-chip ae-pulse border-[#6ee7ff]/50 text-[#c9f4ff]">
              <Crosshair size={14} className="text-[#6ee7ff]" />
              beacon online
            </span>
          )}
        </div>

        <div className="mt-2 flex gap-2">
          <div className="h-[4px] w-[86px] overflow-hidden rounded-full bg-[#0a1226]/80">
            <div className="h-full rounded-full bg-[#8ef6ff] transition-all duration-200" style={{ width: `${shardPct}%` }} />
          </div>
          <div className="h-[4px] w-[86px] overflow-hidden rounded-full bg-[#0a1226]/80">
            <div className="h-full rounded-full bg-[#ff8aa6] transition-all duration-200" style={{ width: `${enemyPct}%` }} />
          </div>
        </div>
      </div>

      {/* Zone + timer */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2 text-center">
        <div className="ae-panel-soft px-4 py-2">
          <div className="ae-display text-[13px] text-[#dff2ff]">
            Zone {hud.zone}/{hud.zoneCount} · {hud.zoneName}
          </div>
          <div className="mt-1 flex items-center justify-center gap-3 text-[12px] text-[#93a7c9]">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Timer size={12} /> {formatTime(hud.time)}
            </span>
            <span className="text-[#2f4a72]">|</span>
            <span>{hint}</span>
          </div>
        </div>
      </div>

      {/* Score + pause */}
      <div className="absolute right-4 top-4 flex items-start gap-2">
        <div className="ae-panel-soft px-4 py-2 text-right">
          <div className="ae-sub">Score</div>
          <div className="ae-display text-[20px] leading-tight text-[#e9f2ff] tabular-nums">{formatScore(hud.score)}</div>
          {showFps && (
            <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#7f95bb] tabular-nums">
              <Activity size={11} /> {hud.fps} fps
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onPause}
          className="ae-btn pointer-events-auto !px-3 !py-3"
          aria-label="Pause"
        >
          <Pause size={16} />
        </button>
      </div>

      {/* Boss bar */}
      {hud.bossMax > 0 && hud.bossHp > 0 && (
        <div className="absolute bottom-24 left-1/2 w-[min(560px,80vw)] -translate-x-1/2">
          <div className="ae-panel-soft px-4 py-2">
            <div className="flex items-center justify-between">
              <span className="ae-display text-[12px] text-[#e2c6ff]">Shadow Colossus</span>
              <span className="tabular-nums text-[12px] text-[#c9b0ff]">
                {hud.bossHp}/{hud.bossMax}
              </span>
            </div>
            <div className="ae-bar mt-1 h-[10px]">
              <div className="ae-bar-fill ae-bar-boss" style={{ width: `${(hud.bossHp / Math.max(1, hud.bossMax)) * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Sprint indicator */}
      {hud.sprinting && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[12px] tracking-[0.3em] text-[#8fe6ff]/70">
          SPRINTING
        </div>
      )}
    </div>
  )
}

export function Radar({ gameRef }: { gameRef: React.RefObject<Game | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let raf = 0
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const game = gameRef.current
      const size = canvas.width
      const cx = size / 2
      const cy = size / 2
      const radius = size / 2 - 6

      ctx.clearRect(0, 0, size, size)

      // backdrop
      const backdrop = ctx.createRadialGradient(cx, cy, 4, cx, cy, radius)
      backdrop.addColorStop(0, 'rgba(12, 22, 44, 0.92)')
      backdrop.addColorStop(1, 'rgba(6, 10, 22, 0.78)')
      ctx.fillStyle = backdrop
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = 'rgba(122, 190, 255, 0.22)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.stroke()

      for (const ring of [0.66, 0.36]) {
        ctx.beginPath()
        ctx.strokeStyle = 'rgba(122, 190, 255, 0.13)'
        ctx.lineWidth = 1
        ctx.arc(cx, cy, radius * ring, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(cx - radius, cy)
      ctx.lineTo(cx + radius, cy)
      ctx.moveTo(cx, cy - radius)
      ctx.lineTo(cx, cy + radius)
      ctx.strokeStyle = 'rgba(122, 190, 255, 0.1)'
      ctx.stroke()

      const radar = game?.getRadar?.() ?? null
      if (radar) {
        const scale = radius / radar.range
        const sin = Math.sin(radar.rot)
        const cos = Math.cos(radar.rot)
        for (const blip of radar.blips) {
          const dx = blip.x - radar.x
          const dz = blip.z - radar.z
          const fx = dx * sin + dz * cos
          const sx = dx * cos - dz * sin
          let px = cx + sx * scale
          let py = cy - fx * scale
          const dist = Math.hypot(px - cx, py - cy)
          const clamped = dist > radius - 4
          if (clamped) {
            const k = (radius - 4) / dist
            px = cx + (px - cx) * k
            py = cy + (py - cy) * k
          }
          ctx.globalAlpha = clamped ? 0.45 : 1
          if (blip.kind === 'shard') {
            ctx.fillStyle = '#8ef6ff'
            ctx.beginPath()
            ctx.moveTo(px, py - 4)
            ctx.lineTo(px + 4, py)
            ctx.lineTo(px, py + 4)
            ctx.lineTo(px - 4, py)
            ctx.closePath()
            ctx.fill()
          } else if (blip.kind === 'enemy') {
            ctx.fillStyle = '#ff6b8a'
            ctx.beginPath()
            ctx.arc(px, py, 3.4, 0, Math.PI * 2)
            ctx.fill()
          } else if (blip.kind === 'boss') {
            ctx.strokeStyle = '#c9a4ff'
            ctx.lineWidth = 2.4
            ctx.beginPath()
            ctx.arc(px, py, 7, 0, Math.PI * 2)
            ctx.stroke()
          } else if (blip.kind === 'orb') {
            ctx.fillStyle = '#6ef0a8'
            ctx.beginPath()
            ctx.arc(px, py, 3, 0, Math.PI * 2)
            ctx.fill()
          } else {
            ctx.strokeStyle = '#8ef6ff'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(px, py, 6, 0, Math.PI * 2)
            ctx.stroke()
          }
          ctx.globalAlpha = 1
        }
      }

      // player arrow
      ctx.fillStyle = '#e9f2ff'
      ctx.beginPath()
      ctx.moveTo(cx, cy - 7)
      ctx.lineTo(cx + 5.5, cy + 6)
      ctx.lineTo(cx, cy + 3)
      ctx.lineTo(cx - 5.5, cy + 6)
      ctx.closePath()
      ctx.fill()
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [gameRef])

  return <canvas ref={canvasRef} width={264} height={264} className="ae-radar" />
}

export function Toasts({ toasts }: { toasts: ToastMsg[] }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[86px] flex w-[min(420px,86vw)] -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`ae-toast ae-panel-soft w-full border-l-2 px-3 py-2 text-[13px] font-semibold ${TOAST_TONE[toast.tone]}`}
        >
          {toast.text}
        </div>
      ))}
    </div>
  )
}

export function DamageOverlay({ hitCount }: { hitCount: number }) {
  if (hitCount === 0) return null
  return <div key={hitCount} className="ae-vignette ae-vignette-hit absolute inset-0" />
}

export function ZoneIntroBanner({ intro }: { intro: ZoneIntro | null }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!intro) return
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 3600)
    return () => window.clearTimeout(timer)
  }, [intro])

  if (!intro || !visible) return null
  return (
    <div className="pointer-events-none absolute left-1/2 top-[38%] w-[min(620px,90vw)] -translate-x-1/2 text-center">
      <div className="ae-fade-in">
        <div className="ae-sub mb-2">
          Zone {intro.zone} of {intro.zoneCount}
        </div>
        <div className="ae-title text-[clamp(28px,5vw,46px)] leading-none">{intro.name}</div>
        <div className="mt-3 text-[15px] text-[#bcd3f0]">{intro.subtitle}</div>
        <div className="mt-2 inline-flex items-center gap-2 text-[13px] text-[#8fe6ff]">
          <Zap size={14} /> {intro.objective}
        </div>
      </div>
    </div>
  )
}
