import { useRef, useState } from 'react'
import { ChevronsUp, Sparkles, Wind } from 'lucide-react'
import type { Game } from '../../game/Game'

const RADIUS = 54

export function TouchControls({ gameRef }: { gameRef: React.RefObject<Game | null> }) {
  const stickRef = useRef<HTMLDivElement>(null)
  const pointerId = useRef<number | null>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [sprinting, setSprinting] = useState(false)

  const updateFromEvent = (clientX: number, clientY: number) => {
    const el = stickRef.current
    const game = gameRef.current
    if (!el || !game) return
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let dx = clientX - cx
    let dy = clientY - cy
    const dist = Math.hypot(dx, dy)
    if (dist > RADIUS) {
      dx = (dx / dist) * RADIUS
      dy = (dy / dist) * RADIUS
    }
    setKnob({ x: dx, y: dy })
    game.touchMove(dx / RADIUS, dy / RADIUS)
  }

  const handleDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerId.current = event.pointerId
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* capture unsupported */
    }
    updateFromEvent(event.clientX, event.clientY)
  }

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return
    updateFromEvent(event.clientX, event.clientY)
  }

  const handleUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return
    pointerId.current = null
    setKnob({ x: 0, y: 0 })
    gameRef.current?.touchMoveEnd()
  }

  const toggleSprint = () => {
    const next = !sprinting
    setSprinting(next)
    gameRef.current?.touchSprint(next)
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="pointer-events-auto absolute bottom-6 left-5">
        <div
          ref={stickRef}
          className="ae-stick"
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        >
          <div className="ae-stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
        </div>
        <button
          type="button"
          onClick={toggleSprint}
          className={`ae-btn mt-3 w-full !py-2 !text-[12px] ${sprinting ? 'ae-btn-primary' : 'ae-btn-ghost'}`}
        >
          <Wind size={14} /> Sprint {sprinting ? 'on' : 'off'}
        </button>
      </div>

      <div className="pointer-events-auto absolute bottom-24 right-5 flex flex-col items-end gap-3">
        <button
          type="button"
          className="ae-touch-btn h-[74px] w-[74px]"
          onPointerDown={(event) => {
            event.preventDefault()
            gameRef.current?.touchJump()
          }}
        >
          <span className="flex flex-col items-center gap-0.5">
            <ChevronsUp size={20} />
            JUMP
          </span>
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="ae-touch-btn h-[62px] w-[62px]"
            onPointerDown={(event) => {
              event.preventDefault()
              gameRef.current?.touchDash()
            }}
          >
            <span className="flex flex-col items-center gap-0.5">
              <Wind size={18} />
              DASH
            </span>
          </button>
          <button
            type="button"
            className="ae-touch-btn h-[86px] w-[86px] border-[#6ee7ff]/60"
            onPointerDown={(event) => {
              event.preventDefault()
              gameRef.current?.touchAttack()
            }}
          >
            <span className="flex flex-col items-center gap-0.5">
              <Sparkles size={22} />
              PULSE
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
