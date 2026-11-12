// Browser-free legibility audit for the menu.
//
// "Is the text clear enough?" is a measurable question: WCAG asks 4.5:1 contrast for
// body text and 3:1 for large text, and there is a floor below which a font size stops
// being readable on a normal screen no matter how good the contrast is. This reads the
// stylesheet itself, so changing a colour or a size in ui.css re-runs the audit rather
// than silently drifting past it.
//
// It caught three real failures on the menu: the ability label at 1.94:1 (an 8.5 px
// string at 65 % opacity — tiny type, low contrast, widest tracking, the worst of every
// possible combination), the class tag at 4.03:1 and the stage hint at 3.4:1.
import { readFileSync } from 'node:fs'

// The sheet is preprocessed before it is parsed. Comments become part of a selector as
// far as a flat regex is concerned, an `@import` line swallows the rule after it, and a
// nested `@media` block hides the rules inside it. The audit is about the desktop
// layout, so the narrow-screen overrides are dropped entirely.
function strip(css: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^\n]*/g, '')
  let out = ''
  let i = 0
  for (;;) {
    const at = withoutComments.indexOf('@media', i)
    if (at < 0) {
      out += withoutComments.slice(i)
      return out
    }
    out += withoutComments.slice(i, at)
    let depth = 0
    let j = withoutComments.indexOf('{', at)
    if (j < 0) return out
    for (; j < withoutComments.length; j += 1) {
      if (withoutComments[j] === '{') depth += 1
      else if (withoutComments[j] === '}') {
        depth -= 1
        if (depth === 0) {
          j += 1
          break
        }
      }
    }
    i = j
  }
}

const CSS = strip(readFileSync('src/runner/ui.css', 'utf8'))

interface Rule {
  selectors: string[]
  body: string
}

const RULES: Rule[] = []
for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selectors = match[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (selectors.length > 0) RULES.push({ selectors, body: match[2] })
}

/** The winning declarations for a selector: later rules override earlier ones. */
function style(selector: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const rule of RULES) {
    if (!rule.selectors.includes(selector)) continue
    for (const declaration of rule.body.split(';')) {
      const at = declaration.indexOf(':')
      if (at < 0) continue
      found[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim()
    }
  }
  return found
}

const ROOT = style(':root')
function resolve(value: string, extra: Record<string, string> = {}): string {
  const variable = value.match(/^var\((--[a-z-]+)(?:,\s*(.+))?\)$/)
  if (!variable) return value
  return extra[variable[1]] ?? ROOT[variable[1]] ?? variable[2] ?? value
}

type Rgb = [number, number, number]
function parse(value: string, extra: Record<string, string> = {}): Rgb {
  const text = resolve(value, extra).trim()
  // The sheet tints chips with `color-mix(in srgb, A p%, B)` — the audit has to speak
  // the same language, or three rules become unauditable by construction.
  const mixed = text.match(/^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)(?:\s+([\d.]+)%)?\s*\)$/i)
  if (mixed) {
    const a = parse(mixed[1], extra)
    const b = parse(mixed[3], extra)
    const pa = parseFloat(mixed[2]) / 100
    const pb = mixed[4] ? parseFloat(mixed[4]) / 100 : 1 - pa
    const total = pa + pb
    return [0, 1, 2].map((i) => (a[i] * pa + b[i] * pb) / total) as Rgb
  }
  const hex = text.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const short = text.match(/^#([0-9a-f]{3})$/i)
  if (short) {
    const n = parseInt(short[1], 16)
    return [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17]
  }
  const fn = text.match(/rgba?\(([^)]+)\)/)
  if (fn) {
    const parts = fn[1].split(',').map((part) => parseFloat(part))
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
  }
  throw new Error(`cannot read the colour ${value}`)
}

/** The alpha of an `rgba(...)` literal; opaque colours return 1. */
function alphaOf(value: string): number {
  const match = value.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/)
  return match ? parseFloat(match[1]) : 1
}

/** What a colour looks like once it is drawn at `alpha` over a background. */
function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as Rgb
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(fg: Rgb, bg: Rgb): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const hex = (rgb: Rgb): string => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

// The panel is 95 % white over a blurred, darkened backdrop, so its effective colour is
// within a hair of white; the stage is the top of its own blue gradient.
const PANEL = '#fbfcff'
const STAGE = '#e0efff'

interface Target {
  selector: string
  background: string
  /** Large text gets 4.5:1; everything else 7:1. */
  large?: boolean
  /**
   * A control rather than a word — an icon button, a chevron. WCAG asks 3:1 of a graphical
   * object and sets no size floor, because there is no glyph to read. Its colour still has to
   * be measured: a chevron nobody can see is not a control.
   */
  icon?: boolean
}

const TARGETS: Target[] = [
  { selector: '.ar-char-tile-name', background: PANEL },
  { selector: '.ar-char-tile-tag', background: PANEL },
  { selector: '.ar-char-tile-perk-label', background: PANEL },
  { selector: '.ar-char-tile-perk-text', background: PANEL },
  { selector: '.ar-stage-hint', background: STAGE },
  { selector: '.ar-side-label', background: PANEL },
  { selector: '.ar-menu .ar-stat-label', background: PANEL },
  { selector: '.ar-auth-title', background: PANEL },
  { selector: '.ar-auth .ar-hint', background: PANEL },
  { selector: '.ar-auth-inapp-title', background: '#fff2d9' },
  { selector: '.ar-auth-inapp-body', background: '#fff2d9' },
  { selector: '.ar-auth-inapp-open', background: '#6f4100' },
  { selector: '.ar-pick-title', background: PANEL },
  { selector: '.ar-pick-label', background: PANEL },
  { selector: '.ar-pick-name', background: PANEL },
  { selector: '.ar-pick-sub', background: PANEL },
  { selector: '.ar-pick-icon-btn', background: PANEL, icon: true },
  { selector: '.ar-pick-chevron', background: PANEL, icon: true },
  { selector: '.ar-pick-qr-note', background: PANEL },
  { selector: '.ar-pick-help-title', background: '#fff8ea' },
  { selector: '.ar-pick-help-body', background: '#fff8ea' },
  { selector: '.ar-pick-help-link', background: '#6f4100' },
  { selector: '.ar-pick-note', background: '#f2f5fa' },
  { selector: '.ar-pick-sub-link', background: PANEL },
  { selector: '.ar-pick-mini', background: PANEL },
  { selector: '.ar-pick-safety', background: PANEL },
  { selector: '.ar-pick-tips-summary', background: PANEL },
  { selector: '.ar-pick-tips-list', background: PANEL },
  { selector: '.ar-guest', background: PANEL },
  { selector: '.ar-signin', background: PANEL },
  { selector: '.ar-name-fixed', background: PANEL },
  { selector: '.ar-name-error', background: PANEL },
  { selector: '.ar-row-sub', background: PANEL },
  { selector: '.ar-modal-title', background: PANEL },
  { selector: '.ar-hint', background: PANEL },
  { selector: '.ar-btn', background: '#ffffff' },
  { selector: '.ar-diff', background: '#ffffff' },
]

/** Nothing on a normal screen is readable below this, whatever the contrast says. */
const MIN_FONT = 9.5

let failures = 0
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`)
}

console.log('Legibility audit\n')

const rows: string[] = []
for (const target of TARGETS) {
  const rule = style(target.selector)
  if (!rule.color) {
    rows.push(`${target.selector}: no colour declared`)
    continue
  }
  const background = parse(target.background)
  const opacity = rule.opacity ? parseFloat(rule.opacity) : 1
  const drawn = over(parse(rule.color), background, opacity)
  const contrast = ratio(drawn, background)
  // 4.5:1 is the AA floor, and text that only just clears it reads as washed out —
  // which is exactly what a player said when they looked at the menu. Small text is
  // held to AAA (7:1) here; large text keeps the 4.5:1 that AAA asks of it.
  const need = target.icon ? 3 : target.large ? 4.5 : 7
  const size = parseFloat(rule['font-size'] ?? '0')
  const ok = target.icon ? contrast >= need : contrast >= need && size >= MIN_FONT
  if (!ok) failures += 1
  const sizeNote = target.icon ? 'icon' : size >= MIN_FONT ? `${size}px` : `${size}px TOO SMALL`
  rows.push(
    `${ok ? '✓' : '✗'} ${target.selector} — ${contrast.toFixed(2)}:1 (needs ${need}:1) · ${sizeNote} · ${hex(drawn)} on ${target.background}`
  )
}
for (const row of rows) console.log(row)

// The wordmark is a gradient, so it is measured at both ends rather than in the middle.
const title = style('.ar-menu .ar-title')
const stops = [...(title.background ?? '').matchAll(/#[0-9a-f]{6}/gi)].map((m) => parse(m[0]))
if (stops.length >= 2) {
  const worst = Math.min(...stops.map((stop) => ratio(stop, parse(PANEL))))
  check(
    'the wordmark stays dark across its whole gradient',
    worst >= 4.5,
    `worst stop ${worst.toFixed(2)}:1 at ${hex(stops[stops.length - 1])}`
  )
} else {
  check('the wordmark has a measurable gradient', false, 'no stops found')
}

// A sanity check on the audit itself: the old values must fail, or the maths is wrong.
const REGRESSION: Array<[string, number]> = [
  ['#8496b5', 1.94],
  ['#6d7fa3', 4.03],
]
for (const [colour, expected] of REGRESSION) {
  const measured = ratio(over(parse(colour), parse(PANEL), colour === '#8496b5' ? 0.65 : 1), parse(PANEL))
  check(
    `the audit still catches ${colour}`,
    Math.abs(measured - expected) < 0.15,
    `${measured.toFixed(2)}:1, the value it failed at before`
  )
}

// ─────────────────────────────────── the HUD ────────────────────────────────────
// The audit had never looked at the HUD, and the HUD is where the player spends the
// entire run. Its text floats over a world that changes colour four times per run, so
// a colour that reads perfectly on the menu can be invisible at speed. Every chip is
// tested against the two extremes the world actually reaches: the pale day sky and
// the neon zone at night. A translucent chip is composited over both, because a chip
// that only works on a bright background is a chip that fails in the neon zone.

const SCENES: [string, string][] = [
  ['the day sky', '#e8f2ff'],
  ['the neon zone at night', '#0a0f1e'],
]

interface HudChip {
  selector: string
  background: string
  /** When the rule only changes colour, the size lives on the base class. */
  sizeFrom?: string
}

const HUD_CHIPS: HudChip[] = [
  { selector: '.ar-chip', background: 'rgba(255, 255, 255, 0.86)' },
  { selector: '.ar-mission', background: 'rgba(255, 255, 255, 0.86)' },
  { selector: '.ar-pursuit', background: 'rgba(255, 246, 246, 0.9)' },
  { selector: '.ar-power-banner-hint', background: 'rgba(255, 255, 255, 0.86)' },
  { selector: '.ar-coin-unit', background: 'rgba(255, 255, 255, 0.95)' },
  { selector: '.ar-toast', background: 'rgba(6, 10, 24, 0.86)' },
  { selector: '.ar-toast-good', background: 'rgba(6, 10, 24, 0.86)', sizeFrom: '.ar-toast' },
  { selector: '.ar-toast-warn', background: 'rgba(6, 10, 24, 0.86)', sizeFrom: '.ar-toast' },
  { selector: '.ar-toast-power', background: 'rgba(6, 10, 24, 0.86)', sizeFrom: '.ar-toast' },
  { selector: '.ar-swipe-hint > div', background: 'rgba(6, 10, 24, 0.8)' },
  // The results screen is the same situation as the HUD: panels over a world that
  // changes colour, on the screen every run ends on.
  { selector: '.ar-stat-label', background: 'rgba(255, 255, 255, 0.92)' },
  { selector: '.ar-stat-value', background: 'rgba(255, 255, 255, 0.92)' },
  { selector: '.ar-over-missions-title', background: 'rgba(255, 255, 255, 0.9)' },
  { selector: '.ar-over-mission', background: 'rgba(255, 255, 255, 0.9)' },
  { selector: '.ar-over-mission-count', background: 'rgba(255, 255, 255, 0.9)', sizeFrom: '.ar-over-mission' },
  { selector: '.ar-record', background: '#fff2d9' },
  { selector: '.ar-bust', background: PANEL },
]

for (const { selector, background: chip, sizeFrom } of HUD_CHIPS) {
  const rule = style(selector)
  if (!rule.color) {
    check(`HUD ${selector}`, false, 'no colour declared')
    continue
  }
  const sizeRule = sizeFrom ? style(sizeFrom) : rule
  const size = parseFloat(sizeRule['font-size'] ?? rule['font-size'] ?? '0')
  const ink = parse(rule.color)
  const flat = parse(chip)
  const alpha = alphaOf(chip)
  const worst = Math.min(...SCENES.map(([, scene]) => ratio(ink, over(flat, parse(scene), alpha))))
  const scene = SCENES.find(([, s2]) => ratio(ink, over(flat, parse(s2), alpha)) === worst)?.[0] ?? ''
  check(
    `HUD ${selector}`,
    worst >= 7 && size >= MIN_FONT,
    `${worst.toFixed(2)}:1 on its chip over ${scene} · ${size}px`
  )
}

// The power pills keep their hue in a custom property and set the ink inline, so the
// audit reads the real hue table out of the component rather than trusting a copy.
const HUD_SOURCE = readFileSync('src/components/runner/RushHud.tsx', 'utf8')
const HUES = [...HUD_SOURCE.matchAll(/^\s{2}(?:shield|magnet|boost|double|ghost|invert|fog|heavy): '(#[0-9a-f]{6})',$/gm)].map((m) => m[1])
check('the power hue table is readable', HUES.length === 8, `${HUES.length} hues found in RushHud.tsx`)

const pill = style('.ar-power-pill')
for (const hue of HUES) {
  const vars = { '--ar-power': hue }
  const ink = parse(pill.color ?? '#000', vars)
  const chip = parse(pill.background ?? '#fff', vars)
  const contrast = ratio(ink, chip)
  check(`power pill ${hue}`, contrast >= 7, `${contrast.toFixed(2)}:1 · ${hex(ink)} on ${hex(chip)}`)
}

// Outlined type — the score, the multiplier, the floating numbers. A single ink cannot
// clear both a pale sky and a dark road, so these carry an outline, and what makes an
// outline work is the contrast between the fill and the outline itself.
const OUTLINED: [string, string][] = [
  ['.ar-score', '#0a1a36'],
  ['.ar-mult', '#0a1a36'],
  ['.ar-score-label', '#0a1a36'],
  ['.ar-float', '#0a1a36'],
  ['.ar-float-hot', '#7a3d00'],
]
for (const [selector, outline] of OUTLINED) {
  const rule = style(selector)
  const fill = parse(rule.color ?? '#000')
  const contrast = ratio(fill, parse(outline))
  const declared = (rule['text-shadow'] ?? '').includes(outline)
  check(
    `${selector} is outlined, not just shadowed`,
    contrast >= 7 && declared,
    `${contrast.toFixed(2)}:1 fill vs outline${declared ? '' : ' — no outline declared'}`
  )
}

// Guards: the three HUD failures this pass found must stay caught.
check(
  'the audit still catches a bright pill ink on a white chip',
  ratio(parse('#5ce1ff'), parse('#ffffff')) < 4.5,
  `${ratio(parse('#5ce1ff'), parse('#ffffff')).toFixed(2)}:1 — the shield pill before`
)
check(
  'the audit still catches a mid-grey label over the night sky',
  ratio(parse('#5d7096'), over(parse('rgba(255, 255, 255, 0.86)'), parse('#0a0f1e'), 0.86)) < 4.5,
  `${ratio(parse('#5d7096'), over(parse('rgba(255, 255, 255, 0.86)'), parse('#0a0f1e'), 0.86)).toFixed(2)}:1`
)
check(
  'the audit still catches a white score on the day sky',
  ratio(parse('#ffffff'), parse('#e8f2ff')) < 4.5,
  `${ratio(parse('#ffffff'), parse('#e8f2ff')).toFixed(2)}:1`
)

// The results score is a gradient like the wordmark, so it is measured at every stop.
const bigScore = style('.ar-big-score')
const scoreStops = [...(bigScore.background ?? '').matchAll(/#[0-9a-f]{6}/gi)].map((m) => parse(m[0]))
if (scoreStops.length >= 2) {
  const worst = Math.min(...scoreStops.map((stop) => ratio(stop, parse(PANEL))))
  check(
    'the results score stays dark across its whole gradient',
    worst >= 4.5,
    `worst stop ${worst.toFixed(2)}:1 — the pale end of a gradient is where the eye starts`
  )
}

// A job label that wraps mid-phrase turns six cards into a ragged row: "Chiến binh sấm
// sét" took two lines while "Pháp sư" took one, and the pair looked unrelated. The
// budget is derived from the tile rather than guessed: the panel is 1080 px, the left
// column is 1.62fr of a 2.42fr grid with an 18 px gap, six tiles with 8 px gaps and
// 10 px of padding leave about 86 px of text, and the tag is 10 px uppercase at 0.06em
// — which is roughly twelve characters.
const TAG_BUDGET = 12
const I18N_SOURCE = readFileSync('src/lib/i18n.ts', 'utf8')
const TAGS = [...I18N_SOURCE.matchAll(/'char\.\w+\.tag': \{ en: '([^']+)', vi: '([^']+)' \}/g)]
check('the hero tag list is readable', TAGS.length === 6, `${TAGS.length} tags found`)
for (const [, en, vi] of TAGS) {
  const longest = Math.max(en.length, vi.length)
  check(
    `hero tag fits one line — ${vi}`,
    longest <= TAG_BUDGET,
    `${longest} of ${TAG_BUDGET} characters (en "${en}", vi "${vi}")`
  )
}

const menuButton = style('.ar-menu .ar-menu-row > .ar-btn')
check(
  'the three menu buttons are one line each at a readable size',
  parseFloat(menuButton['font-size'] ?? '0') >= 11.5 && menuButton['white-space'] === 'nowrap',
  `${menuButton['font-size']} · white-space: ${menuButton['white-space']}`
)

if (failures > 0) {
  console.error(`\nLegibility check failed (${failures}).`)
  process.exit(1)
}
console.log('\nLegibility check passed.')
