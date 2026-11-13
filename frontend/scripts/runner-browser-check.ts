/**
 * End-to-end browser check for Arc Rush.
 *
 *   cd frontend
 *   bun add -d puppeteer yauzl      # one-off (downloads a headless Chrome build)
 *   bun run scripts/runner-browser-check.ts
 *
 * Boots the preview in headless Chrome (software GL), plays a real sprint —
 * lanes, jump, slide, coins, magnet, shield, overdrive, crash, leaderboard
 * submission — and fails on any console error or blank frame.
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
  score: number
  coins: number
  distance: number
  speed: number
  multiplier: number
  combo: number
  lane: number
  invert: number
  laneX: number
  y: number
  onGround: boolean
  sliding: boolean
  avatarY: number
  shield: number
  boosting: boolean
  magnet: boolean
  obstacles: number
  activeCoins: number
  coinTextureReady: boolean
  double: number
  ghost: number
  fog: number
  heavy: number
  activePowers: number
  animWeight: number
  animTime: number
  slideBlend: number
  avatarVisible: boolean
  character: string
  avatar: string
  anim: string
  perk: {
    id: string | null
    value: number
    jumpVelocity: number
    laneRate: number
    magnetRadius: number
    passiveReach: number
    closeCall: number
    powerScale: number
    shieldAtStart: number
  }
  fps: number
  quality: string
  brand: string | null
  logo: boolean
}

const BASE = readBasePath()
const URL = `http://localhost:5173${BASE.endsWith('/') ? BASE : `${BASE}/`}`
const OUT_DIR = resolve(process.cwd(), '.browser-check')
const errors: string[] = []
let failures = 0

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function waitFor(
  page: Page,
  label: string,
  predicate: (...args: never[]) => boolean,
  timeout = 25000,
  ...args: unknown[]
): Promise<boolean> {
  try {
    await page.waitForFunction(predicate, { timeout, polling: 100 }, ...args)
    return true
  } catch {
    try {
      const state = await snapshot(page)
      console.log(`    (timeout: ${label}) state=${JSON.stringify(state)}`)
    } catch {
      console.log(`    (timeout: ${label}) state unavailable`)
    }
    return false
  }
}

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot())

const qa = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    (name: string, params: unknown[]) =>
      (window as unknown as Record<string, Record<string, (...rest: unknown[]) => T>>).__arcrush[name](...params),
    fn,
    args
  )

async function shot(page: Page, name: string) {
  const base64 = (await page.screenshot({ encoding: 'base64' })) as string
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, `${name}.png`), Buffer.from(base64, 'base64'))
  return page.evaluate(async (data: string) => {
    const img = new Image()
    img.src = `data:image/png;base64,${data}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let sum = 0
    let sumSq = 0
    let n = 0
    let dark = 0
    for (let i = 0; i < px.length; i += 16) {
      const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
      sum += lum
      sumSq += lum * lum
      n++
      if (lum < 10) dark++
    }
    const mean = sum / n
    return { mean, std: Math.sqrt(sumSq / n - mean * mean), darkRatio: dark / n }
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
    window.localStorage.setItem(
      'arcrush.settings',
      JSON.stringify({ master: 0, music: 0, sfx: 0, quality: 'low', laneGuide: true, shake: true, showFps: true })
    )
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${(err as Error).message}`))
  page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()}`))

  console.log(`Arc Rush browser check → ${URL}\n`)
  console.log('Boot & menu')
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => /start sprint/i.test(document.body.innerText), { timeout: 120000 })

  const menuShot = await shot(page, 'rush-menu')
  check(
    'menu renders the live 3D backdrop',
    menuShot.std > 8 && menuShot.darkRatio < 0.85,
    `std ${menuShot.std.toFixed(1)} · dark ${(menuShot.darkRatio * 100).toFixed(0)}%`
  )

  const brandInfo = await page.evaluate(() => {
    const text = document.body.innerText
    const logo = document.querySelector('img.ar-coin-icon') as HTMLImageElement | null
    return {
      hasArcLine: /arc/i.test(text),
      logoLoaded: Boolean(logo && logo.naturalWidth > 0),
      logoWidth: logo?.naturalWidth ?? 0,
      hasTagline: /layer1|payments|stablecoin/i.test(text),
    }
  })
  check('menu shows the Arc project branding', brandInfo.hasArcLine && brandInfo.hasTagline, brandInfo.hasTagline ? 'tags present' : 'no tags')
  check('Arc logo loads from the backend proxy', brandInfo.logoLoaded, `${brandInfo.logoWidth}px wide`)

  const apiStatus = await page.evaluate(async () => {
    try {
      const [board, project, logo] = await Promise.all([
        fetch('api/runner/leaderboard'),
        fetch('api/arc/project'),
        fetch('api/arc/logo'),
      ])
      return `${board.status}/${project.status}/${logo.status}`
    } catch {
      return 'error'
    }
  })
  check('runner + Arc APIs reachable from the browser', apiStatus === '200/200/200', apiStatus)

  console.log('\nGameplay')
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => /start sprint/i.test(b.textContent ?? ''))
    ;(button as HTMLButtonElement | undefined)?.click()
  })
  // Wait on the game phase rather than on HUD copy, which is translated now.
  await waitFor(
    page,
    'sprint start',
    () => (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot().phase === 'playing',
    90000
  )
  await qa(page, 'freezeSpawns', true)
  await sleep(400)
  const start = await snapshot(page)
  check('sprint starts', start.phase === 'playing', `${start.quality} quality · ${start.fps} fps · brand ${start.brand}`)
  check('rigged character model is driving the runner', start.avatar === 'rigged', `avatar ${start.avatar}`)
  // Sam's ability is a shield before the first obstacle — check it on a live run.
  check('Sam opens the sprint with a shield', start.shield === 1, `shield ${start.shield}`)

  // Lane switching
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  const leftOk = await waitFor(
    page,
    'lane left',
    () => (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot().lane === 0
  )
  check('lane change left works', leftOk, 'lane 1 → 0')
  await page.keyboard.press('ArrowRight')
  const rightOk = await waitFor(
    page,
    'lane right',
    () => (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot().lane === 1
  )
  check('lane change right works', rightOk, 'lane 0 → 1')

  // Jump
  await page.keyboard.press('Space')
  let apex = 0
  let drawnApex = 0
  let airAnim = 'none'
  // Software rendering in CI runs the sim far slower than real time, so be patient.
  for (let i = 0; i < 90; i++) {
    const sample = await snapshot(page)
    apex = Math.max(apex, sample.y)
    drawnApex = Math.max(drawnApex, sample.avatarY)
    if (!sample.onGround && /^Jump_/.test(sample.anim)) airAnim = sample.anim
    if (apex > 0.5 && airAnim !== 'none') break
    await sleep(100)
  }
  check('jump lifts the runner off the track', apex > 0.5, `apex ${apex.toFixed(2)}m`)
  // Physics height is not enough: a model that is pinned to the road looks exactly
  // like a broken jump while this check still passes. Measure what is drawn.
  check(
    'the runner model actually leaves the ground',
    drawnApex > apex - 0.15,
    `model rose to ${drawnApex.toFixed(2)}m of the ${apex.toFixed(2)}m the physics reached`
  )
  check(
    'jump blends into the rigged jump clip',
    /^Jump_/.test(airAnim),
    `clip ${airAnim}`
  )

  // The landing clip is a one-shot: the run cycle has to come back on its own,
  // otherwise the runner freezes mid-landing with dead legs.
  const runResumed = await waitFor(
    page,
    'run cycle after landing',
    () => {
      const s = (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot()
      return s.onGround && s.anim === 'Running_A' && s.animWeight > 0.5
    },
    60000
  )
  const runSnap = await snapshot(page)
  check(
    'the run cycle resumes after a jump',
    runResumed,
    `clip ${runSnap.anim} at ${runSnap.animWeight.toFixed(2)} weight`
  )

  // Slide
  await page.keyboard.press('ArrowDown')
  const slid = await waitFor(
    page,
    'slide',
    () => (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot().sliding,
    20000
  )
  check('slide ducks the runner', slid, 'down-arrow (or dive from the air)')
  const slideSnap = await snapshot(page)
  // Must match SLIDE_CLIP in src/runner/model.ts.
  check('slide plays the slide clip', slideSnap.anim === 'Idle', `clip ${slideSnap.anim}`)
  // The clip alone was not enough: through Dodge_Forward the head drops 0.10 m, less
  // than the run cycle's own bounce, so the runner looked *taller* while sliding while
  // the box quietly shrank. The body has to come down with it — and come down *lying*,
  // so what is checked is that the tip over the feet actually reached full.
  check(
    'the body actually lies down while sliding',
    slideSnap.slideBlend > 0.8,
    `tip blend ${slideSnap.slideBlend.toFixed(2)}`
  )

  // Coins
  const beforeCoins = (await snapshot(page)).coins
  await qa(page, 'spawnCoins', 12)
  await sleep(250)
  const coinRender = await snapshot(page)
  check(
    'Arc coins render with the project icon texture',
    coinRender.activeCoins > 0 && coinRender.coinTextureReady,
    `${coinRender.activeCoins} coins in flight · texture ${coinRender.coinTextureReady ? 'ready' : 'missing'}`
  )
  const coinsOk = await waitFor(
    page,
    'coin pickup',
    ((expected: number) => {
      const s = (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot()
      return s.coins >= expected + 4
    }) as unknown as (...args: never[]) => boolean,
    30000,
    beforeCoins
  )
  const afterCoins = await snapshot(page)
  check(
    'Arc coin lines are collected',
    coinsOk && afterCoins.coins >= beforeCoins + 4,
    `${beforeCoins} → ${afterCoins.coins} Arc`
  )
  const comboOk = await waitFor(
    page,
    'combo multiplier',
    () => (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot().multiplier >= 2,
    30000
  )
  const comboSnap = await snapshot(page)
  check(
    'a clean coin streak raises the multiplier',
    comboOk && comboSnap.multiplier >= 2 && comboSnap.score > start.score,
    `×${comboSnap.multiplier} · combo ${comboSnap.combo} · score ${comboSnap.score}`
  )

  const coinIconVisible = await page.evaluate(() => {
    const img = document.querySelector('img.ar-coin-icon')
    if (!img) return false
    const rect = img.getBoundingClientRect()
    return rect.width > 10 && rect.height > 10
  })
  check('Arc coin counter is visible in the HUD', coinIconVisible)

  // City obstacles: car roofs are platforms, ramps launch, tunnels gate.
  await qa(page, 'place', 'car', 1, -6)
  await sleep(150)
  await qa(page, 'drop', 2.8)
  const roofOk = await waitFor(
    page,
    'car roof landing',
    () => {
      const s = (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot()
      return s.onGround && s.y > 0.6 && s.y < 1.4
    },
    30000
  )
  const roofSnap = await snapshot(page)
  check('cars are platforms you can land on', roofOk, `landed at y ${roofSnap.y.toFixed(2)}m`)

  await qa(page, 'place', 'ramp', 1, -7)
  const launchOk = await waitFor(
    page,
    'ramp launch',
    () => {
      const s = (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot()
      return !s.onGround && s.y > 1.5
    },
    30000
  )
  const launchSnap = await snapshot(page)
  check('ramps launch the runner into the air', launchOk, `apex so far ${launchSnap.y.toFixed(2)}m`)

  // A long flight must not hang on a static air pose: the run cycle takes over.
  const airRunOk = await waitFor(
    page,
    'air run',
    () => {
      const s = (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot()
      return !s.onGround && s.anim === 'Running_A' && s.animWeight > 0.5
    },
    45000
  )
  check('the legs keep cycling during a long flight', airRunOk, 'run cycle takes over mid-air')

  // Wait for the launch to land, then wipe the road: these props were placed by
  // the check, not by the game, and must not kill the runner mid-test.
  await waitFor(page, 'landing after launch', () => {
    const s = (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot()
    return s.onGround
  }, 30000)
  await qa(page, 'place', 'tunnel', 1, -8)
  const tunnelSnap = await snapshot(page)
  check('tunnel mouths spawn across the road', tunnelSnap.obstacles > 0, `${tunnelSnap.obstacles} obstacles live`)
  await qa(page, 'clear')
  await sleep(300)

  // Hazards: mirrored controls are verifiable, and the HUD warns in red.
  await qa(page, 'spawnPower', 'invert')
  const invertOk = await waitFor(
    page,
    'invert pickup',
    () => (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot().invert > 0,
    30000
  )
  check('harmful pickups exist and are rarer', invertOk, 'CONTROLS JAMMED collected')
  // The HUD is React state fed by the game loop, so give it a beat to paint.
  const hudOk = await waitFor(
    page,
    'hazard hud',
    () =>
      document.querySelectorAll('.ar-power-pill-bad').length > 0 &&
      document.querySelectorAll('.ar-invert').length > 0,
    45000
  )
  const badPill = await page.evaluate(() => document.querySelectorAll('.ar-power-pill-bad').length)
  check('hazards read red in the HUD', hudOk, `${badPill} hazard pill · red overlay on`)

  const laneBefore = (await snapshot(page)).lane
  await page.keyboard.press('ArrowLeft')
  const mirroredOk = await waitFor(
    page,
    'mirrored steering',
    ((expected: number) => {
      const s = (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot()
      return s.lane > expected
    }) as unknown as (...args: never[]) => boolean,
    20000,
    laneBefore
  )
  check('jammed controls mirror the steering', mirroredOk, `lane ${laneBefore} → left pressed`)
  await qa(page, 'grant', 'fog')
  const fogOk = await waitFor(page, 'fog overlay', () => document.querySelectorAll('.ar-fog').length > 0, 15000)
  check('smoke screen dims the view', fogOk, 'haze overlay live')

  // Pickup juice: the counter answers every banked coin, and a power-up slams a
  // banner plus a colour flash across the screen.
  const juiceBefore = (await snapshot(page)).coins
  await qa(page, 'spawnCoins', 8)
  const floatOk = await waitFor(
    page,
    'floating +N pop',
    () => document.querySelectorAll('.ar-float').length > 0,
    30000
  )
  const bumpOk = await waitFor(
    page,
    'counter kick',
    () => document.querySelectorAll('.ar-coin-counter.ar-bump').length > 0,
    30000
  )
  check('coin pickups raise a floating +N pop', floatOk, `counter ${juiceBefore} → ${(await snapshot(page)).coins}`)
  check('the Arc counter kicks on pickup', bumpOk, 'scale punch + gold flash')

  // A magnet pickup: real spawn, real collection, so the banner is earned.
  await qa(page, 'spawnPower', 'magnet')
  const bannerOk = await waitFor(
    page,
    'power banner',
    () => document.querySelectorAll('.ar-power-banner').length > 0,
    20000
  )
  const bannerText = await page.evaluate(() => document.querySelector('.ar-power-banner-tag')?.textContent ?? '')
  const flashOk = await page.evaluate(() => document.querySelectorAll('.ar-flash').length > 0)
  check('power-ups slam a banner', bannerOk, `${bannerText}`)
  check('power-ups flash the screen edge', flashOk, 'vignette pulse')

  // Magnet
  await qa(page, 'grant', 'magnet')
  const magnetCoinsBefore = (await snapshot(page)).coins
  await qa(page, 'spawnCoins', 5, 2)
  const magnetOk = await waitFor(
    page,
    'magnet pull',
    ((expected: number) => {
      const s = (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot()
      return s.coins >= expected + 3
    }) as unknown as (...args: never[]) => boolean,
    30000,
    magnetCoinsBefore
  )
  const magnetSnap = await snapshot(page)
  check('magnet pulls in coins from another lane', magnetOk && magnetSnap.magnet, `+${magnetSnap.coins - magnetCoinsBefore} Arc`)

  // Shield absorbs a hit. Sam starts with one of his own, so clear it first and
  // grant exactly one — otherwise the assertion below is off by one.
  await qa(page, 'shield', 0)
  await qa(page, 'grant', 'shield')
  await sleep(300)
  await qa(page, 'spawnObstacle', 'tall')
  await waitFor(page, 'shield hit', () => {
    const s = (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot()
    return s.shield === 0 || s.phase === 'gameover'
  })
  const shieldSnap = await snapshot(page)
  check('shield absorbs the first hit', shieldSnap.phase === 'playing' && shieldSnap.shield === 0, `phase ${shieldSnap.phase}`)

  const playShot = await shot(page, 'rush-gameplay')
  check(
    'gameplay renders a lit 3D track',
    playShot.std > 10 && playShot.mean > 18,
    `mean ${playShot.mean.toFixed(1)} · std ${playShot.std.toFixed(1)}`
  )

  // Pause / settings
  await page.keyboard.press('Escape')
  const pauseOk = await waitFor(page, 'pause', () => /paused/i.test(document.body.innerText), 15000)
  check('escape pauses the sprint', pauseOk && (await snapshot(page)).phase === 'paused')
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => /settings/i.test(b.textContent ?? ''))
    ;(button as HTMLButtonElement | undefined)?.click()
  })
  const settingsOk = await waitFor(page, 'settings', () => /master volume/i.test(document.body.innerText), 15000)
  check('settings panel opens with sliders', settingsOk)
  await page.keyboard.press('Escape')
  await sleep(300)
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => /resume/i.test(b.textContent ?? ''))
    ;(button as HTMLButtonElement | undefined)?.click()
  })
  const resumeOk = await waitFor(page, 'resume', () => /arc collected/i.test(document.body.innerText), 15000)
  check('resume returns to the sprint', resumeOk && (await snapshot(page)).phase === 'playing')

  // Overdrive (checked after the pause block so the invulnerability cannot mask the crash test)
  await qa(page, 'grant', 'boost')
  // The speed ramp is driven by game time, which crawls under software
  // rendering — wait for it instead of sampling after a fixed sleep.
  const boostOk = await waitFor(
    page,
    'overdrive speed',
    () => {
      const s = (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot()
      return s.boosting && s.speed > 20
    },
    90000
  )
  const boostSnap = await snapshot(page)
  check('overdrive raises speed', boostOk, `${boostSnap.speed.toFixed(1)} u/s`)
  // Overdrive smashes obstacles by design, so the crash test must wait it out.
  // Game time runs far slower than wall clock in software rendering.
  const boostGone = await waitFor(
    page,
    'boost expiry',
    () => !(window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot().boosting,
    180000
  )
  check('overdrive eventually expires', boostGone, 'boost window closed')

  console.log('\nCrash & leaderboard')
  await sleep(600)
  // Sam's ability gives him a free hit — take it away so this is a clean crash test.
  await qa(page, 'shield', 0)
  await qa(page, 'spawnObstacle', 'tall')
  const preCrash = await snapshot(page)
  console.log('   pre-crash:', JSON.stringify({ ...preCrash, laneX: undefined }).slice(0, 260))
  // Software rendering runs the sim far slower than real time: be generous.
  const crashOk = await waitFor(page, 'crash', () => /sprint over/i.test(document.body.innerText), 120000)
  if (!crashOk) console.log('   post-crash:', JSON.stringify(await snapshot(page)).slice(0, 260))
  check('hitting an obstacle ends the sprint', crashOk)
  await waitFor(
    page,
    'death clip',
    () => (window as unknown as { __arcrush: { snapshot: () => Snapshot } }).__arcrush.snapshot().anim === 'Death_A',
    60000
  )
  const crashSnap = await snapshot(page)
  check('crash plays the death clip', crashSnap.anim === 'Death_A', `clip ${crashSnap.anim}`)

  const submitOk = await waitFor(page, 'submit', () => /submitted/i.test(document.body.innerText), 90000)
  const resultText = await page.evaluate(() => document.body.innerText)
  check('result screen reports the submission', submitOk, (resultText.match(/submitted[^\n]*/i) ?? [''])[0])
  const resultShot = await shot(page, 'rush-result')
  check('result screen renders', resultShot.std > 4, `std ${resultShot.std.toFixed(1)}`)

  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => /leaderboard/i.test(b.textContent ?? ''))
    ;(button as HTMLButtonElement | undefined)?.click()
  })
  const boardOk = await waitFor(page, 'board', () => /global board/i.test(document.body.innerText), 60000)
  const boardText = await page.evaluate(() => document.body.innerText)
  check('leaderboard lists the finished sprint', boardOk, (boardText.match(/sprints?[^\n]*/i) ?? [''])[0])
  await page.keyboard.press('Escape')
  await sleep(400)

  // Back to the menu and switch games
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => /menu/i.test(b.textContent ?? ''))
    ;(button as HTMLButtonElement | undefined)?.click()
  })
  const menuOk = await waitFor(page, 'back to menu', () => /start sprint/i.test(document.body.innerText), 15000)
  // Character picker: pick the second hero and make sure the runner model swaps.
  // Match on the tile's position, not on the hero's name, so renaming the roster
  // never breaks this check.
  const pickedSecond = await page.evaluate(() => {
    const tile = document.querySelectorAll('.ar-char-tile')[1] as HTMLButtonElement | undefined
    tile?.click()
    return Boolean(tile)
  })
  await sleep(900)
  const swapped = await snapshot(page)
  check(
    'character picker swaps the runner model',
    pickedSecond && swapped.character === 'mika',
    `runner: ${swapped.character}`
  )
  check('menu is reachable again', menuOk)

  // Every hero has a signature ability, and it has to actually reach the game.
  const abilities = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.ar-char-tile')).map((tile) => ({
      name: tile.querySelector('.ar-char-tile-name')?.textContent?.trim() ?? '',
      perk: tile.querySelector('.ar-char-tile-perk')?.textContent?.trim() ?? '',
    }))
  )
  check(
    'every hero card lists an ability',
    abilities.length === 6 && abilities.every((a) => a.perk.length > 8),
    abilities.map((a) => a.name).join(' · ')
  )

  // Baseline: take it on Sam, whose perk is the shield, so every multiplier perk
  // below has something neutral to be measured against.
  await qa(page, 'character', 'kai')
  await sleep(500)
  const perkBase = await snapshot(page)
  const expected: Record<string, { id: string; jump?: number; lane?: number; magnet?: number; power?: number; shield?: number; boost?: number }> = {
    kai: { id: 'shieldStart', shield: 1 },
    mika: { id: 'longPower', power: 1.2 },
    bjorn: { id: 'badImmunity' },
    nyx: { id: 'quickLane', lane: 1.35 },
    rin: { id: 'wideMagnet', magnet: 1.45 },
    tim: { id: 'longBoost', boost: 2 },
  }
  const baseline = {
    jump: perkBase.perk.jumpVelocity,
    lane: perkBase.perk.laneRate,
    magnet: perkBase.perk.magnetRadius,
    power: perkBase.perk.powerScale,
    boost: perkBase.perk.boostScale,
  }
  for (const [id, want] of Object.entries(expected)) {
    await qa(page, 'character', id)
    await sleep(700)
    const snap = await snapshot(page)
    const perk = snap.perk
    const ok =
      perk.id === want.id &&
      (want.jump ? perk.jumpVelocity > baseline.jump : true) &&
      (want.lane ? perk.laneRate > baseline.lane : true) &&
      (want.magnet ? perk.magnetRadius > baseline.magnet && perk.passiveReach > 0 : perk.passiveReach === 0) &&
      (want.lane ? perk.closeCall === 2 : perk.closeCall === 1) &&
      (want.power ? perk.powerScale > baseline.power : true) &&
      (want.shield ? perk.shieldAtStart === want.shield : true) &&
      (want.boost ? perk.boostScale > baseline.boost : true)
    check(
      `hero "${id}" ability reaches the game`,
      ok,
      `${perk.id} · jump ${perk.jumpVelocity} · lane ${perk.laneRate} · magnet ${perk.magnetRadius} · boost ×${perk.boostScale}`
    )
  }
  // Teddyz's ward: a hazard goes in through the real rule, and must not come out
  // the other side. Everyone else still takes it, which is what makes it a perk
  // rather than a change to the hazards themselves.
  await qa(page, 'character', 'bjorn')
  await sleep(700)
  await qa(page, 'grant', 'invert')
  await sleep(160)
  const warded = await snapshot(page)
  check('Teddyz shrugs off a hazard', warded.invert === 0, `jammed-controls timer ${warded.invert.toFixed(2)}s`)
  await qa(page, 'grant', 'fog')
  await sleep(160)
  const wardedFog = await snapshot(page)
  check('Teddyz shrugs off the smoke too', wardedFog.fog === 0, `smoke timer ${wardedFog.fog.toFixed(2)}s`)

  await qa(page, 'character', 'kai')
  await sleep(700)
  await qa(page, 'grant', 'invert')
  await sleep(160)
  const landed = await snapshot(page)
  check('everyone else still takes the hazard', landed.invert > 0, `jammed-controls timer ${landed.invert.toFixed(2)}s`)
  await qa(page, 'character', 'kai')

  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => /aetherfall/i.test(b.textContent ?? ''))
    ;(button as HTMLButtonElement | undefined)?.click()
  })
  const switchOk = await waitFor(page, 'game switch', () => /start run/i.test(document.body.innerText), 90000)
  check('switching to the Aetherfall game works', switchOk)

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean')
} catch (error) {
  failures++
  console.error('\nBrowser check aborted:', (error as Error).message)
  console.error('Console output seen:', errors.slice(0, 8).join('\n') || '(none)')
} finally {
  await browser.close()
}

console.log(failures === 0 ? `\nAll Arc Rush browser checks passed. Screenshots in ${OUT_DIR}` : `\n${failures} check(s) failed.`)
if (failures > 0) process.exit(1)
