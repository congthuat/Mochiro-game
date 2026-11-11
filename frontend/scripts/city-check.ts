// Dev-only: captures the new city obstacles and the pickup glyphs.
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
await page.setViewport({ width: 900, height: 700 })
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('arcrush.guest', '1')
  localStorage.setItem('arcrush.settings', JSON.stringify({ quality: 'low', master: 0, music: 0, sfx: 0 }))
})
const errors: string[] = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForFunction(() => /start sprint/i.test(document.body.innerText), { timeout: 120000 })

type Seam = {
  grant: (kind: string) => void
  freezeSpawns: (v: boolean) => void
  place: (kind: string, lane: number, z: number) => void
  drop: (y: number) => void
  clear: () => void
  power: (kind: string | null) => void
  spawnPower: (kind: string, lane?: number) => void
}
const qa = (name: keyof Seam, ...args: unknown[]) =>
  page.evaluate(
    (method, params) =>
      (window as never as { __arcrush: Record<string, (...x: unknown[]) => void> }).__arcrush[method](...params),
    name as string,
    args
  )
const snap = () => page.evaluate(() => (window as never as { __arcrush: { snapshot: () => Record<string, number> } }).__arcrush.snapshot())

await qa('freezeSpawns', true)
await new Promise((r) => setTimeout(r, 600))

// 1 — car roof: drop onto a parked car and grab the frame while riding it.
await qa('place', 'car', 1, -16)
await new Promise((r) => setTimeout(r, 150))
await qa('drop', 2.2)
for (let i = 0; i < 60; i++) {
  const s = await snap()
  if (s.onGround && s.y > 0.6) {
    await page.screenshot({ path: '.browser-check/city-car.png' })
    console.log(`  ✓ city-car captured — riding a roof at y ${s.y.toFixed(2)}m`)
    break
  }
  await new Promise((r) => setTimeout(r, 200))
}
await qa('clear')
await new Promise((r) => setTimeout(r, 400))

// 2 — ramp launch.
await qa('place', 'ramp', 1, -7)
for (let i = 0; i < 60; i++) {
  const s = await snap()
  if (!s.onGround && s.y > 1.6) {
    await page.screenshot({ path: '.browser-check/city-ramp.png' })
    console.log(`  ✓ city-ramp captured — airborne at y ${s.y.toFixed(2)}m`)
    break
  }
  await new Promise((r) => setTimeout(r, 150))
}
await new Promise((r) => setTimeout(r, 2500))
await qa('clear')
await new Promise((r) => setTimeout(r, 500))

// 3 — tunnel mouth, seen head on.
await qa('place', 'tunnel', 1, -9)
await new Promise((r) => setTimeout(r, 500))
await page.screenshot({ path: '.browser-check/city-tunnel.png' })
console.log('  ✓ city-tunnel captured')
await qa('clear')

// 4 — pickup glyphs: one boon, one hazard.
for (const [kind, name] of [['magnet', 'good'], ['invert', 'bad']] as const) {
  await qa('power', kind)
  await new Promise((r) => setTimeout(r, 900))
  await page.screenshot({ path: `.browser-check/power-${name}.png` })
  console.log(`  ✓ power-${name} captured (${kind})`)
}
await qa('power', null)

// 5 — hazard in play: fog overlay + red pills.
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /pause/i.test(b.textContent ?? ''))
  ;(btn as HTMLButtonElement | undefined)?.click()
})
await qa('grant', 'fog')
await new Promise((r) => setTimeout(r, 900))
await page.screenshot({ path: '.browser-check/hazard-fog.png' })
console.log('  ✓ hazard-fog captured — haze overlay + hazard pills')
console.log(`  console errors: ${errors.length}`)
if (errors.length) console.log('   ', errors.slice(0, 3).join(' | '))
await browser.close()
