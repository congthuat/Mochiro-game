// Dev-only: captures the speed streaks at play quality so their look can be
// reviewed (they are disabled at the low quality preset used by the main suite).
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
await page.setViewport({ width: 900, height: 620 })
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('arcrush.guest', '1')
  localStorage.setItem('arcrush.settings', JSON.stringify({ quality: 'medium', master: 0, music: 0, sfx: 0 }))
})
const errors: string[] = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => /start sprint/i.test(document.body.innerText), { timeout: 150000 })
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /start sprint/i.test(b.textContent ?? ''))
  ;(btn as HTMLButtonElement | undefined)?.click()
})
const qa = (name: string, ...args: unknown[]) =>
  page.evaluate(
    (method, params) =>
      (window as never as { __arcrush: Record<string, (...x: unknown[]) => void> }).__arcrush[method](...params),
    name,
    args
  )
const snap = () => page.evaluate(() => (window as never as { __arcrush: { snapshot: () => Record<string, number> } }).__arcrush.snapshot())

await new Promise((r) => setTimeout(r, 3000))
await qa('freezeSpawns', true)
await page.screenshot({ path: '.browser-check/speed-slow.png' })
console.log(`  slow frame — ${(await snap()).speed.toFixed(1)} u/s`)

await qa('grant', 'boost')
for (let i = 0; i < 120; i++) {
  const s = await snap()
  if (!s.boosting) { await qa('grant', 'boost') }
  if (s.speed > 26) break
  await new Promise((r) => setTimeout(r, 250))
}
const fast = await snap()
await page.screenshot({ path: '.browser-check/speed-fast.png' })
console.log(`  fast frame — ${fast.speed.toFixed(1)} u/s · boosting ${fast.boosting}`)
// Isolate the streaks: two frames a fraction of a second apart, same speed,
// once with the streak mesh hidden. The world barely moves between them.
await qa('lines', false)
await page.screenshot({ path: '.browser-check/speed-nolines.png' })
await qa('lines', true)
await page.screenshot({ path: '.browser-check/speed-lines.png' })
console.log('  isolated streak frames captured')
console.log(`  console errors: ${errors.length}`)
if (errors.length) console.log('   ', errors.slice(0, 3).join(' | '))
await browser.close()
