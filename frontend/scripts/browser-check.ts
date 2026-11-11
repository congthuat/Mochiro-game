/**
 * End-to-end browser check for Aetherfall.
 *
 *   cd frontend
 *   bun add -d puppeteer yauzl     # one-off (downloads a headless Chrome build)
 *   bun run scripts/browser-check.ts
 *
 * Boots the dev preview in headless Chrome (SwiftShader software GL), walks the
 * whole game loop — menu → zone 1 → upgrades → … → boss → victory → leaderboard
 * submission — and reports console errors plus screenshot statistics so a blank
 * render cannot pass silently.
 *
 * Screenshots are written to frontend/.browser-check/.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer, { type Page } from 'puppeteer'

function readBasePath(): string {
  if (process.env.BASE_PATH) return process.env.BASE_PATH
  try {
    const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    const line = env.split('\n').find((l) => l.startsWith('BASE_PATH='))
    if (line) return line.slice('BASE_PATH='.length).trim()
  } catch {
    /* fall through */
  }
  return '/'
}

interface Snapshot {
  phase: string
  zone: number
  zoneName: string
  score: number
  time: number
  hp: number
  x: number
  y: number
  z: number
  onGround: boolean
  shards: number
  enemies: number
  portalOpen: boolean
  fps: number
}

const BASE = readBasePath()
const URL = `http://localhost:5173${BASE.endsWith('/') ? BASE : `${BASE}/`}`
const OUT_DIR = resolve(process.cwd(), '.browser-check')

const errors: string[] = []
let failures = 0

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => (window as unknown as { __aetherfall: { snapshot: () => Snapshot } }).__aetherfall.snapshot())

async function screenshotStats(page: Page, name: string) {
  const base64 = (await page.screenshot({ encoding: 'base64' })) as string
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, `${name}.png`), Buffer.from(base64, 'base64'))
  return page.evaluate(async (b64: string) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const probe = (x: number, y: number) => {
      const i = (y * canvas.width + x) * 4
      return `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`
    }
    let sum = 0
    let sumSq = 0
    let n = 0
    let dark = 0
    for (let i = 0; i < data.length; i += 16) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      sum += lum
      sumSq += lum * lum
      n++
      if (lum < 12) dark++
    }
    const mean = sum / n
    return {
      mean,
      std: Math.sqrt(sumSq / n - mean * mean),
      darkRatio: dark / n,
      top: probe(Math.floor(canvas.width * 0.5), 40),
    }
  }, base64)
}

const browser = await puppeteer.launch({
  headless: 'shell',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1280,760',
    '--mute-audio',
  ],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(() => {
  localStorage.setItem('arcrush.guest', '1')
    // Software GL is slow: run the lightest preset and keep audio silent.
    window.localStorage.setItem(
      'aetherfall.settings',
      JSON.stringify({ master: 0, music: 0, sfx: 0, quality: 'low', sensitivity: 1, showFps: true })
    )
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${(err as Error).message}`))
  page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()}`))

  console.log(`Aetherfall browser check → ${URL}\n`)
  console.log('Boot & menu')
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  // The hub opens on Arc Rush — hop over to the Aetherfall game first.
  await page.waitForFunction(() => /start sprint|start run/i.test(document.body.innerText), { timeout: 120000 })
  await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll('button')).find((b) => /aetherfall/i.test(b.textContent ?? ''))
    ;(link as HTMLButtonElement | undefined)?.click()
  })
  await page.waitForFunction(() => /start run/i.test(document.body.innerText), { timeout: 120000 })

  const menuShot = await screenshotStats(page, 'menu')
  check(
    'menu renders the live 3D backdrop',
    menuShot.std > 10 && menuShot.darkRatio < 0.7,
    `std ${menuShot.std.toFixed(1)} · dark ${(menuShot.darkRatio * 100).toFixed(0)}% · top ${menuShot.top}`
  )

  const apiStatus = await page.evaluate(async () => {
    try {
      const res = await fetch('api/leaderboard')
      return res.status
    } catch {
      return -1
    }
  })
  check('leaderboard API reachable from the browser', apiStatus === 200, `status ${apiStatus}`)

  console.log('\nZone 1 gameplay')
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => /start run/i.test(b.textContent ?? ''))
    ;(button as HTMLButtonElement | undefined)?.click()
  })
  await page.waitForFunction(() => /integrity/i.test(document.body.innerText), { timeout: 60000 })
  const start = await snapshot(page)
  check('run starts on zone 1', start.phase === 'playing' && start.zone === 1, `${start.zoneName} · ${start.enemies} hostiles · ${start.shards} shards`)

  await page.keyboard.down('KeyW')
  await sleep(2500)
  await page.keyboard.up('KeyW')
  const moved = await snapshot(page)
  const distance = Math.hypot(moved.x - start.x, moved.z - start.z)
  check('guardian moves with input', distance > 1, `${distance.toFixed(1)} units`)
  check('game clock advances', moved.time > start.time, `${start.time.toFixed(1)}s → ${moved.time.toFixed(1)}s`)

  await page.keyboard.press('Space')
  let apex = moved.y
  let airborne = false
  for (let i = 0; i < 34; i++) {
    const sample = await snapshot(page)
    apex = Math.max(apex, sample.y)
    if (!sample.onGround) airborne = true
    if (apex > moved.y + 0.4 && airborne) break
    await sleep(90)
  }
  check('jump lifts the guardian off the ground', apex > moved.y + 0.4, `+${(apex - moved.y).toFixed(2)} units`)

  await page.mouse.click(640, 420)
  await page.keyboard.press('KeyQ')
  await sleep(600)

  const playShot = await screenshotStats(page, 'gameplay')
  check(
    'gameplay renders a lit 3D scene',
    playShot.std > 12 && playShot.mean > 25,
    `mean ${playShot.mean.toFixed(1)} · std ${playShot.std.toFixed(1)}`
  )

  const radarSamples = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.ae-radar') as HTMLCanvasElement | null
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return -1
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let lit = 0
    for (let i = 3; i < data.length; i += 40) if (data[i] > 10) lit++
    return lit
  })
  check('radar canvas is drawing', radarSamples > 50, `${radarSamples} lit samples`)

  console.log('\nPause & settings')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => /paused/i.test(document.body.innerText), { timeout: 20000 })
  const paused = await snapshot(page)
  check('escape opens the pause menu', paused.phase === 'paused')

  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => /settings/i.test(b.textContent ?? ''))
    ;(button as HTMLButtonElement | undefined)?.click()
  })
  await page.waitForFunction(() => /master volume/i.test(document.body.innerText), { timeout: 20000 })
  check('settings panel opens from the pause menu', true)
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => /resume/i.test(b.textContent ?? ''))
    ;(button as HTMLButtonElement | undefined)?.click()
  })
  await page.waitForFunction(() => /integrity/i.test(document.body.innerText), { timeout: 20000 })
  await sleep(1200)
  const resumed = await snapshot(page)
  check('resume continues the run', resumed.phase === 'playing' && resumed.time >= paused.time, `${resumed.time.toFixed(1)}s`)

  console.log('\nFull run progression')
  for (let zoneIndex = 1; zoneIndex <= 4; zoneIndex++) {
    await page.evaluate(() => (window as unknown as { __aetherfall: { clearObjectives: () => void } }).__aetherfall.clearObjectives())
    await page.waitForFunction(() => {
      const s = (window as unknown as { __aetherfall: { snapshot: () => Snapshot } }).__aetherfall.snapshot()
      return s.portalOpen || s.phase === 'victory' || s.phase === 'gameover'
    }, { timeout: 40000 })
    await page.evaluate(() => (window as unknown as { __aetherfall: { teleportToPortal: () => void } }).__aetherfall.teleportToPortal())
    await page.waitForFunction(() => /zone cleared/i.test(document.body.innerText), { timeout: 40000 })
    const cleared = await snapshot(page)
    check(`zone ${zoneIndex} clear opens the upgrade draft`, cleared.phase === 'upgrade', `${cleared.zoneName} · score ${Math.round(cleared.score)}`)

    await page.evaluate(() => {
      const card = document.querySelector('button.ae-card') as HTMLButtonElement | null
      card?.click()
    })
    await page.waitForFunction(() => /integrity/i.test(document.body.innerText), { timeout: 90000 })
    await page.waitForFunction((expected) => {
      const s = (window as unknown as { __aetherfall: { snapshot: () => Snapshot } }).__aetherfall.snapshot()
      return s.phase === 'playing' && s.zone === expected
    }, { timeout: 90000 }, zoneIndex + 1)
    const next = await snapshot(page)
    check(`zone ${zoneIndex + 1} loads with upgrades applied`, next.zone === zoneIndex + 1, `${next.zoneName} · ${next.enemies} hostiles`)
  }

  console.log('\nBoss & victory')
  await page.evaluate(() => (window as unknown as { __aetherfall: { clearObjectives: () => void } }).__aetherfall.clearObjectives())
  await page.waitForFunction(() => {
    const s = (window as unknown as { __aetherfall: { snapshot: () => Snapshot } }).__aetherfall.snapshot()
    return s.portalOpen || s.phase === 'victory'
  }, { timeout: 60000 })
  await page.evaluate(() => (window as unknown as { __aetherfall: { teleportToPortal: () => void } }).__aetherfall.teleportToPortal())
  await page.waitForFunction(() => /victory/i.test(document.body.innerText), { timeout: 60000 })
  check('defeating the Colossus ends the run in victory', true)

  await page.waitForFunction(() => /submitted/i.test(document.body.innerText), { timeout: 30000 })
  const resultText = await page.evaluate(() => document.body.innerText)
  check('score submitted to the leaderboard', /submitted/i.test(resultText), (resultText.match(/submitted[^\n]*/i) ?? [''])[0])
  const victoryShot = await screenshotStats(page, 'victory')
  check('victory screen renders', victoryShot.std > 5, `std ${victoryShot.std.toFixed(1)}`)

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean')
} catch (error) {
  failures++
  console.error('\nBrowser check aborted:', (error as Error).message)
  console.error('Console output seen:', errors.slice(0, 8).join('\n') || '(none)')
} finally {
  await browser.close()
}

console.log(
  failures === 0 ? `\nAll browser checks passed. Screenshots in ${OUT_DIR}` : `\n${failures} browser check(s) failed.`
)
if (failures > 0) process.exit(1)
