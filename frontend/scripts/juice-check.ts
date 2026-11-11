// Dev-only: captures the pickup feedback in motion (coin pop + power-up slam).
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
await page.setViewport({ width: 900, height: 760 })
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('arcrush.guest', '1')
  localStorage.setItem('arcrush.settings', JSON.stringify({ quality: 'low', master: 0, music: 0, sfx: 0 }))
})
const errors: string[] = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForFunction(() => /start sprint/i.test(document.body.innerText), { timeout: 120000 })
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /start sprint/i.test(b.textContent ?? ''))
  ;(btn as HTMLButtonElement | undefined)?.click()
})
await new Promise((r) => setTimeout(r, 3000))

type Seam = {
  freezeSpawns: (v: boolean) => void
  spawnCoins: (n: number, lane?: number) => void
  spawnPower: (kind: string, lane?: number) => void
  juice: () => Record<string, number>
}
const seam = <T>(fn: (qa: Seam) => T) =>
  page.evaluate((body) => new Function('qa', `return (${body})(qa)`)(
    (window as never as { __arcrush: Seam }).__arcrush
  ), fn.toString()) as Promise<T>

await seam((qa) => qa.freezeSpawns(true))
await new Promise((r) => setTimeout(r, 400))

// Coin pop: spawn a line and grab the frame while the ring + ghost coin are alive.
await seam((qa) => qa.spawnCoins(9))
let caught = 0
for (let i = 0; i < 60; i++) {
  const state = await seam((qa) => qa.juice())
  if (state.rings > 0 && state.flyCoins > 0) {
    await page.screenshot({ path: '.browser-check/juice-coin.png' })
    console.log(`  ✓ juice-coin captured — rings ${state.rings}, ghost coins ${state.flyCoins}, camera kick ${state.camKick.toFixed(2)}`)
    caught++
    break
  }
  await new Promise((r) => setTimeout(r, 120))
}
if (!caught) console.log('  ✗ never caught a live coin pop')

// Power-up slam: banner + flash + hit-stop + double shockwave.
await seam((qa) => qa.spawnPower('magnet'))
let slammed = false
for (let i = 0; i < 90; i++) {
  const state = await seam((qa) => qa.juice())
  if (state.hitStop > 0 && state.rings >= 2) {
    await page.screenshot({ path: '.browser-check/juice-power.png' })
    console.log(`  ✓ juice-power captured — hit-stop ${state.hitStop.toFixed(3)}s, rings ${state.rings}, camera kick ${state.camKick.toFixed(2)}`)
    slammed = true
    break
  }
  await new Promise((r) => setTimeout(r, 100))
}
if (!slammed) console.log('  ✗ never caught the power-up slam')

console.log(`  console errors: ${errors.length}`)
if (errors.length) console.log('   ', errors.slice(0, 3).join(' | '))
await browser.close()
