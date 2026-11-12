// Share card: a 1080×1350 picture of a finished run (the 4:5 shape every feed shows
// uncropped), drawn on a 2D canvas over the run's last frame, plus the plumbing to hand
// it to the phone's share sheet — or, on a desktop, to download it and copy the link.
import { mochiroMarkSvg } from '../runner/mochiro'
import { formatDistance, formatScore, formatTime } from '../runner/utils'
import { formatNumber, translate, type Lang } from './i18n'

export interface ShareCardData {
  score: number
  distance: number
  coins: number
  bestCombo: number
  duration: number
  record: boolean
  rank: number | null
  difficulty: string
  hero: string
  player: string
  link: string
  /** The game's last frame, as a data URL; the card falls back to a gradient without it. */
  scene: string | null
  lang: Lang
}

const W = 1080
const H = 1350

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Cover-fit an image into a box, like `object-fit: cover`. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height)
  const sw = w / scale
  const sh = h / scale
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h)
}

/** Shrinks the font until `text` fits `maxWidth`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, start: number, maxWidth: number) {
  let size = start
  do {
    ctx.font = `${weight} ${size}px ${family}`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 4
  } while (size > 24)
  return size
}

export async function drawShareCard(data: ShareCardData): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  // The display fonts come from a stylesheet; make sure they are ready before measuring.
  try {
    await Promise.all([
      document.fonts.load('900 64px Orbitron'),
      document.fonts.load('700 40px Rajdhani'),
      document.fonts.load('600 40px Rajdhani'),
    ])
  } catch {
    /* fall back to system fonts */
  }
  const t = (key: string, vars?: Record<string, string | number>) => translate(key, data.lang, vars)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const display = `Orbitron, Rajdhani, system-ui, sans-serif`
  const body = `Rajdhani, system-ui, sans-serif`

  // ---- background: the run's last frame, or a sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#2b8ae8')
  sky.addColorStop(0.55, '#8fd0ff')
  sky.addColorStop(1, '#dff1ff')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)
  const scene = data.scene ? await loadImage(data.scene) : null
  if (scene) drawCover(ctx, scene, 0, 0, W, H)

  // Darken top and bottom so white type always reads, whatever the frame shows.
  const veil = ctx.createLinearGradient(0, 0, 0, H)
  veil.addColorStop(0, 'rgba(6, 18, 48, 0.78)')
  veil.addColorStop(0.3, 'rgba(6, 18, 48, 0.25)')
  veil.addColorStop(0.5, 'rgba(6, 18, 48, 0.15)')
  veil.addColorStop(0.72, 'rgba(6, 18, 48, 0.7)')
  veil.addColorStop(1, 'rgba(6, 18, 48, 0.92)')
  ctx.fillStyle = veil
  ctx.fillRect(0, 0, W, H)

  // ---- header: mark + name
  const mark = await loadImage(`data:image/svg+xml,${encodeURIComponent(mochiroMarkSvg(128, 'card'))}`)
  if (mark) ctx.drawImage(mark, 64, 60, 112, 112)
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `900 60px ${display}`
  ctx.fillText('MOCHIRO', 200, 132)
  ctx.font = `600 32px ${body}`
  ctx.fillStyle = 'rgba(223, 241, 255, 0.85)'
  ctx.fillText(t('share.tagline'), 202, 168)

  // Mode tag, top right
  const mode = t(`diff.${data.difficulty}`).toUpperCase()
  ctx.font = `700 30px ${body}`
  const modeW = ctx.measureText(mode).width + 44
  const modeColor = data.difficulty === 'hard' ? '#ff4d6d' : data.difficulty === 'easy' ? '#12b981' : '#0aa9ff'
  roundRect(ctx, W - 64 - modeW, 84, modeW, 56, 28)
  ctx.fillStyle = modeColor
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.fillText(mode, W - 64 - modeW + 22, 122)

  // ---- score block
  const bottom = H - 64
  ctx.textAlign = 'center'
  if (data.record) {
    ctx.font = `700 34px ${body}`
    const label = `★ ${t('over.record').toUpperCase()} ★`
    const lw = ctx.measureText(label).width + 60
    roundRect(ctx, (W - lw) / 2, 618, lw, 60, 30)
    ctx.fillStyle = '#f59f0b'
    ctx.fill()
    ctx.fillStyle = '#1b1300'
    ctx.fillText(label, W / 2, 659)
  }
  ctx.fillStyle = 'rgba(223, 241, 255, 0.9)'
  ctx.font = `700 36px ${body}`
  ctx.fillText(t('share.scored', { name: data.player }).toUpperCase(), W / 2, 740)

  const score = formatScore(data.score)
  const size = fitFont(ctx, score, 900, display, 168, W - 140)
  const grad = ctx.createLinearGradient(0, 770, 0, 770 + size)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(1, '#9fd8ff')
  ctx.fillStyle = grad
  ctx.shadowColor = 'rgba(10, 169, 255, 0.55)'
  ctx.shadowBlur = 40
  ctx.font = `900 ${size}px ${display}`
  ctx.fillText(score, W / 2, 770 + size * 0.86)
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'

  // ---- stat tiles
  const stats: Array<[string, string]> = [
    [formatDistance(data.distance), t('over.distance')],
    [formatNumber(data.coins, data.lang), t('over.arc')],
    [`×${formatNumber(data.bestCombo, data.lang)}`, t('over.bestCombo')],
    [data.rank ? `#${data.rank}` : formatTime(data.duration), data.rank ? t('over.rank') : t('over.time')],
  ]
  const tileY = 1000
  const tileH = 132
  const gap = 18
  const tileW = (W - 128 - gap * 3) / 4
  stats.forEach(([value, label], i) => {
    const x = 64 + i * (tileW + gap)
    roundRect(ctx, x, tileY, tileW, tileH, 24)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(159, 216, 255, 0.35)'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    fitFont(ctx, value, 700, display, 40, tileW - 24)
    ctx.fillText(value, x + tileW / 2, tileY + 64)
    ctx.fillStyle = 'rgba(223, 241, 255, 0.75)'
    fitFont(ctx, label.toUpperCase(), 600, body, 24, tileW - 20)
    ctx.fillText(label.toUpperCase(), x + tileW / 2, tileY + 104)
  })

  // ---- footer: hero + call to action
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(223, 241, 255, 0.8)'
  ctx.font = `600 30px ${body}`
  ctx.fillText(t('share.hero', { hero: data.hero }), 64, bottom - 52)
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 40px ${body}`
  ctx.fillText(t('share.beat'), 64, bottom - 6)
  ctx.textAlign = 'right'
  ctx.fillStyle = '#8ceaff'
  ctx.font = `700 38px ${display}`
  ctx.fillText(data.link.replace(/^https?:\/\//, ''), W - 64, bottom - 6)

  return await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}

export type ShareOutcome = 'shared' | 'downloaded' | 'copied' | 'cancelled' | 'failed'

/** Hands the card to the share sheet where there is one; otherwise downloads it and copies the link. */
export async function shareCard(blob: Blob | null, text: string, link: string): Promise<ShareOutcome> {
  const file = blob ? new File([blob], 'mochiro-run.png', { type: 'image/png' }) : null
  const nav = typeof navigator !== 'undefined' ? navigator : null
  try {
    if (file && nav?.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], text: `${text} ${link}` })
      return 'shared'
    }
    if (nav?.share && /Android|iPhone|iPad|iPod/i.test(nav.userAgent)) {
      await nav.share({ text, url: link })
      return 'shared'
    }
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') return 'cancelled'
  }
  let outcome: ShareOutcome = 'failed'
  if (blob) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mochiro-run.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    outcome = 'downloaded'
  }
  try {
    await nav?.clipboard?.writeText(`${text} ${link}`)
    if (outcome === 'failed') outcome = 'copied'
  } catch {
    /* clipboard blocked — the download still happened */
  }
  return outcome
}

/** Copies text; returns false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}
