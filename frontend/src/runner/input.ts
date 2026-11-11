// Keyboard + touch input for Mochiro. Actions are timestamped so a press is
// never lost on a slow frame, and swipes map to lane changes / jump / slide.

export type RushAction = 'left' | 'right' | 'jump' | 'slide'

interface QueuedAction {
  action: RushAction
  at: number
}

const SWIPE_MIN = 26
const TAP_MAX_TIME = 260

export class RushInput {
  private queue: QueuedAction[] = []
  private enabled = true
  private actionHandlers = new Set<(action: RushAction) => void>()
  private pauseHandlers = new Set<() => void>()

  private target: HTMLElement
  private activePointer: number | null = null
  private startX = 0
  private startY = 0
  private startTime = 0

  constructor(target: HTMLElement) {
    this.target = target
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('blur', this.onBlur)
    target.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerCancel)
  }

  setEnabled(value: boolean): void {
    this.enabled = value
    if (!value) {
      this.queue.length = 0
      this.activePointer = null
    }
  }

  onAction(handler: (action: RushAction) => void): () => void {
    this.actionHandlers.add(handler)
    return () => this.actionHandlers.delete(handler)
  }

  onPause(handler: () => void): () => void {
    this.pauseHandlers.add(handler)
    return () => this.pauseHandlers.delete(handler)
  }

  /** Direct trigger — used by the on-screen touch buttons. */
  press(action: RushAction): void {
    if (!this.enabled) return
    this.push(action)
  }

  /** Consume a buffered action if it happened within `maxAge` ms. */
  consume(action: RushAction, maxAge = 450): boolean {
    const now = performance.now()
    const index = this.queue.findIndex((item) => item.action === action && now - item.at <= maxAge)
    if (index === -1) {
      this.prune(now)
      return false
    }
    this.queue.splice(index, 1)
    return true
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('blur', this.onBlur)
    this.target.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerCancel)
    this.actionHandlers.clear()
    this.pauseHandlers.clear()
    this.queue.length = 0
  }

  private push(action: RushAction): void {
    this.queue.push({ action, at: performance.now() })
    if (this.queue.length > 12) this.queue.shift()
    for (const handler of this.actionHandlers) {
      try {
        handler(action)
      } catch (error) {
        console.error('[arcrush] input handler failed', error)
      }
    }
  }

  private prune(now: number): void {
    this.queue = this.queue.filter((item) => now - item.at <= 1200)
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return
    const code = event.code
    if (code === 'Escape' || code === 'KeyP') {
      for (const handler of this.pauseHandlers) handler()
      return
    }
    if (!this.enabled) return
    let action: RushAction | null = null
    switch (code) {
      case 'ArrowLeft':
      case 'KeyA':
        action = 'left'
        break
      case 'ArrowRight':
      case 'KeyD':
        action = 'right'
        break
      case 'ArrowUp':
      case 'KeyW':
      case 'Space':
        action = 'jump'
        break
      case 'ArrowDown':
      case 'KeyS':
        action = 'slide'
        break
      default:
        return
    }
    event.preventDefault()
    this.push(action)
  }

  private onBlur = (): void => {
    this.queue.length = 0
    this.activePointer = null
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || this.activePointer !== null) return
    // Ignore presses that land on UI controls (buttons, panels).
    const element = event.target as HTMLElement | null
    if (element?.closest('button, a, input, .ar-touch-btn')) return
    this.activePointer = event.pointerId
    this.startX = event.clientX
    this.startY = event.clientY
    this.startTime = performance.now()
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.activePointer !== event.pointerId) return
    const dx = event.clientX - this.startX
    const dy = event.clientY - this.startY
    if (Math.hypot(dx, dy) < SWIPE_MIN) return
    this.activePointer = null
    if (Math.abs(dx) > Math.abs(dy)) this.push(dx > 0 ? 'right' : 'left')
    else this.push(dy > 0 ? 'slide' : 'jump')
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (this.activePointer !== event.pointerId) return
    this.activePointer = null
    if (performance.now() - this.startTime <= TAP_MAX_TIME) this.push('jump')
  }

  private onPointerCancel = (event: PointerEvent): void => {
    if (this.activePointer === event.pointerId) this.activePointer = null
  }
}
