// Dev-only: checks the sign-in gate, the live 3D character line-up and the
// language switch.
import { launch } from 'puppeteer'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_PATH?.trim() || '/'
const URL = `http://localhost:5173${BASE.endsWith('/') ? BASE : `${BASE}/`}`
mkdirSync('.browser-check', { recursive: true })
const browser = await launch({
  headless: 'shell',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1000, height: 820 })
const errors: string[] = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('arcrush.settings', JSON.stringify({ quality: 'medium', master: 0, music: 0, sfx: 0 }))
})
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 1 — the gate
await page.waitForFunction(() => /đăng nhập|sign in/i.test(document.body.innerText), { timeout: 90000 })
await page.screenshot({ path: '.browser-check/auth-gate.png' })
console.log('  ✓ sign-in gate rendered')
const gateText = await page.evaluate(() => document.body.innerText)
console.log('   has google button:', /google/i.test(gateText) ? 'yes' : 'no')
console.log('   has wallet button:', /ví|wallet/i.test(gateText) ? 'yes' : 'no')
console.log('   has language switch:', /Tiếng Việt/.test(gateText) ? 'yes' : 'no')

// 2 — menu, through the dev-only bypass (there is no guest button any more)
await page.evaluate(() => localStorage.setItem('arcrush.guest', '1'))
await page.reload({ waitUntil: 'networkidle2' })
await page.waitForFunction(() => /bắt đầu chạy|start sprint/i.test(document.body.innerText), { timeout: 120000 })
await sleep(6000)
await page.screenshot({ path: '.browser-check/menu-stage.png' })
const info = await page.evaluate(() => {
  const canvas = document.querySelector('.ar-stage canvas') as HTMLCanvasElement | null
  const tiles = document.querySelectorAll('.ar-char-tile').length
  const rect = canvas?.getBoundingClientRect()
  return { hasCanvas: Boolean(canvas), width: rect?.width ?? 0, height: rect?.height ?? 0, tiles }
})
console.log('  stage canvas:', info.hasCanvas ? `${info.width.toFixed(0)}x${info.height.toFixed(0)}` : 'MISSING', '· tiles:', info.tiles)

// 2b — photograph just the stage so the models can be checked pixel by pixel
const stageEl = await page.$('.ar-stage')
if (stageEl) {
  await stageEl.screenshot({ path: '.browser-check/stage-only.png' })
  const rect = await page.evaluate(() => {
    const el = document.querySelector('.ar-stage')?.getBoundingClientRect()
    return el ? { x: Math.round(el.x), y: Math.round(el.y), w: Math.round(el.width), h: Math.round(el.height) } : null
  })
  console.log('  stage rect:', JSON.stringify(rect))
}

// 2c — a 3x close-up of the line-up, for checking kit and costume details
await page.setViewport({ width: 1000, height: 820, deviceScaleFactor: 3 })
await sleep(900)
const zoom = await page.$('.ar-stage')
if (zoom) await zoom.screenshot({ path: '.browser-check/stage-zoom.png' })
await page.setViewport({ width: 1000, height: 820, deviceScaleFactor: 1 })

// 3 — click a hero on the 3D stage itself (raycast path)
const clicked = await page.evaluate(() => {
  const canvas = document.querySelector('.ar-stage canvas') as HTMLCanvasElement | null
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  canvas.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: rect.left + rect.width * 0.5,
    clientY: rect.top + rect.height * 0.55,
    bubbles: true,
  }))
  return true
})
console.log('  pointer sent to stage:', clicked)
await sleep(600)
const activeAfter = await page.evaluate(() => {
  const tiles = Array.from(document.querySelectorAll('.ar-char-tile'))
  const index = tiles.findIndex((tile) => tile.classList.contains('is-active'))
  return { index, name: tiles[index]?.querySelector('.ar-char-tile-name')?.textContent ?? null }
})
console.log('  selected after clicking the middle hero:', activeAfter.name, `(tile ${activeAfter.index})`)
await sleep(1200)
await page.screenshot({ path: '.browser-check/menu-stage-picked.png' })
if (stageEl) await (await page.$('.ar-stage'))?.screenshot({ path: '.browser-check/stage-picked.png' })

// 4 — language switch
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('.ar-lang-btn')).find((b) => /English/.test(b.textContent ?? ''))
  ;(btn as HTMLButtonElement | undefined)?.click()
})
await sleep(900)
const english = await page.evaluate(() => document.body.innerText)
console.log('  english switch:', /Start sprint/i.test(english) ? 'yes ✓' : 'NO')

// the tiles must show the names the studio signed off on
const names = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.ar-char-tile-name')).map((el) => (el.textContent ?? '').trim())
)
const wanted = ['Sam', 'Bobbilee', 'Teddyz', 'Lecter', 'Mike']
const namesOk = JSON.stringify(names) === JSON.stringify(wanted)
console.log(`  hero names: ${names.join(' · ')} ${namesOk ? '✓' : `✗ expected ${wanted.join(' · ')}`}`)
if (!namesOk) process.exitCode = 1
await page.screenshot({ path: '.browser-check/menu-english.png' })

console.log('  console errors:', errors.length)
if (errors.length) console.log('   ', errors.slice(0, 3).join(' | '))
await browser.close()
