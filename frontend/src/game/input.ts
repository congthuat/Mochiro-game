// Unified input: keyboard + mouse (drag-to-orbit) + touch (virtual stick from React UI).

export interface MoveVector {
  x: number
  z: number
}

export class InputManager {
  move: MoveVector = { x: 0, z: 0 }
  sprint = false
  jumpHeld = false

  private keys = new Set<string>()
  private jumpQueue = 0
  private attackQueue = 0
  private dashQueue = 0
  private lookX = 0
  private lookY = 0
  private zoom = 0
  private touchMove: MoveVector | null = null
  private touchSprint = false
  private dragging = false
  private dragMoved = false
  private lastPointer = { x: 0, y: 0, id: -1 }
  private active = true

  constructor(
    private element: HTMLElement,
    private onPauseRequest: () => void,
    private onAnyInput?: () => void
  ) {
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
    window.addEventListener('blur', this.handleBlur)
    element.addEventListener('pointerdown', this.handlePointerDown)
    element.addEventListener('pointermove', this.handlePointerMove)
    element.addEventListener('pointerup', this.handlePointerUp)
    element.addEventListener('pointercancel', this.handlePointerUp)
    element.addEventListener('wheel', this.handleWheel, { passive: false })
    element.addEventListener('contextmenu', this.preventContext)
  }

  setEnabled(enabled: boolean): void {
    this.active = enabled
    if (!enabled) {
      this.keys.clear()
      this.move = { x: 0, z: 0 }
      this.jumpHeld = false
      this.dragging = false
    }
  }

  private preventContext = (e: Event): void => {
    e.preventDefault()
  }

  private handleBlur = (): void => {
    this.keys.clear()
    this.jumpHeld = false
    this.sprint = false
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    if (!this.active) return
    if (e.code === 'Escape') {
      this.onPauseRequest()
      return
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault()
    }
    if (e.repeat) {
      this.keys.add(e.code)
      return
    }
    this.keys.add(e.code)
    this.onAnyInput?.()
    switch (e.code) {
      case 'Space':
        this.jumpQueue = performance.now()
        this.jumpHeld = true
        break
      case 'KeyJ':
      case 'KeyF':
      case 'KeyK':
        this.attackQueue = performance.now()
        break
      case 'KeyQ':
      case 'KeyE':
      case 'ShiftRight':
        this.dashQueue = performance.now()
        break
      default:
        break
    }
  }

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
    if (e.code === 'Space') this.jumpHeld = false
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (!this.active) return
    this.dragging = true
    this.dragMoved = false
    this.lastPointer = { x: e.clientX, y: e.clientY, id: e.pointerId }
    try {
      this.element.setPointerCapture(e.pointerId)
    } catch {
      /* pointer capture unsupported — drag still works */
    }
    this.onAnyInput?.()
  }

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.active || !this.dragging || e.pointerId !== this.lastPointer.id) return
    const dx = e.clientX - this.lastPointer.x
    const dy = e.clientY - this.lastPointer.y
    this.lastPointer = { x: e.clientX, y: e.clientY, id: e.pointerId }
    if (Math.abs(dx) + Math.abs(dy) > 1) {
      if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true
      this.lookX += dx
      this.lookY += dy
    }
  }

  private handlePointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.lastPointer.id) return
    const wasDragging = this.dragging
    const moved = this.dragMoved
    this.dragging = false
    this.dragMoved = false
    this.lastPointer.id = -1
    if (!wasDragging || moved || !this.active) return
    // A clean tap/click counts as an action.
    if (e.button === 2) this.dashQueue = performance.now()
    else this.attackQueue = performance.now()
  }

  private handleWheel = (e: WheelEvent): void => {
    if (!this.active) return
    e.preventDefault()
    this.zoom += e.deltaY
  }

  // Touch UI hooks (React overlay)
  setTouchMove(x: number, z: number): void {
    if (!this.active) return
    this.touchMove = { x, z }
  }

  clearTouchMove(): void {
    this.touchMove = null
    this.touchSprint = false
  }

  setTouchSprint(value: boolean): void {
    this.touchSprint = value
  }

  triggerJump(): void {
    if (!this.active) return
    this.jumpQueue = performance.now()
    this.jumpHeld = true
    window.setTimeout(() => {
      this.jumpHeld = false
    }, 140)
  }

  triggerAttack(): void {
    if (!this.active) return
    this.attackQueue = performance.now()
  }

  triggerDash(): void {
    if (!this.active) return
    this.dashQueue = performance.now()
  }

  /** Recompute the movement vector from keyboard + touch sources. */
  sample(): MoveVector {
    let x = 0
    let z = 0
    const k = this.keys
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1

    if (this.touchMove) {
      x += this.touchMove.x
      z += this.touchMove.z
    }

    const len = Math.hypot(x, z)
    if (len > 1) {
      x /= len
      z /= len
    }
    this.move = { x, z }
    this.sprint =
      k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint
    return this.move
  }

  // Windows are generous so a press is never lost on a slow frame (low-end GPUs).
  consumeJump(maxAgeMs = 260): boolean {
    if (performance.now() - this.jumpQueue <= maxAgeMs) {
      this.jumpQueue = 0
      return true
    }
    return false
  }

  consumeAttack(maxAgeMs = 260): boolean {
    if (performance.now() - this.attackQueue <= maxAgeMs) {
      this.attackQueue = 0
      return true
    }
    return false
  }

  consumeDash(maxAgeMs = 260): boolean {
    if (performance.now() - this.dashQueue <= maxAgeMs) {
      this.dashQueue = 0
      return true
    }
    return false
  }

  consumeLook(): { x: number; y: number } {
    const out = { x: this.lookX, y: this.lookY }
    this.lookX = 0
    this.lookY = 0
    return out
  }

  get isDragging(): boolean {
    return this.dragging && this.dragMoved
  }

  consumeZoom(): number {
    const out = this.zoom
    this.zoom = 0
    return out
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    window.removeEventListener('blur', this.handleBlur)
    this.element.removeEventListener('pointerdown', this.handlePointerDown)
    this.element.removeEventListener('pointermove', this.handlePointerMove)
    this.element.removeEventListener('pointerup', this.handlePointerUp)
    this.element.removeEventListener('pointercancel', this.handlePointerUp)
    this.element.removeEventListener('wheel', this.handleWheel)
    this.element.removeEventListener('contextmenu', this.preventContext)
  }
}
