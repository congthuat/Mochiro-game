import { launch } from 'puppeteer'

const BASE = process.env.BASE_PATH?.trim() || '/'
const URL = `http://localhost:5173${BASE.endsWith('/') ? BASE : `${BASE}/`}`

const browser = await launch({
  headless: 'shell',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 760 })
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('arcrush.guest', '1')
  localStorage.setItem('arcrush.settings', JSON.stringify({ quality: 'medium', master: 0, music: 0, sfx: 0 }))
})
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForFunction(() => /start sprint/i.test(document.body.innerText), { timeout: 120000 })
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /start sprint/i.test(b.textContent ?? ''))
  ;(btn as HTMLButtonElement | undefined)?.click()
})
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => {
  const qa = (window as never as { __arcrush: { freezeSpawns: (on: boolean) => void } }).__arcrush
  qa.freezeSpawns(true)
})
await new Promise((r) => setTimeout(r, 800))
await page.evaluate(() => {
  const qa = (window as never as { __arcrush: { studio: (on: boolean) => void } }).__arcrush
  qa.studio(true)
  // hide the DOM HUD so only the 3D model is left in frame
  document.querySelectorAll('.ar-root *').forEach((el) => {
    const node = el as HTMLElement
    if (node.className && String(node.className).includes('ar-hud')) node.style.display = 'none'
  })
  document
    .querySelectorAll('.ar-hud, .ar-hud *, .ar-screen, .ar-screen *, .ar-toasts, .ar-toasts *')
    .forEach((el) => ((el as HTMLElement).style.display = 'none'))
})
await new Promise((r) => setTimeout(r, 1500))
await page.evaluate(() => (window as never as { __arcrush: { noFx: (on: boolean) => void } }).__arcrush.noFx(false))
await new Promise((r) => setTimeout(r, 600))
const snap = await page.evaluate(() => (window as never as { __arcrush: { snapshot: () => Record<string, unknown> } }).__arcrush.snapshot())
console.log('avatar:', snap.avatar, '| anim:', snap.anim, '| character:', snap.character)
const stats = await page.evaluate(() => (window as never as { __arcrush: { stats: () => unknown } }).__arcrush.stats())
console.log('render stats:', JSON.stringify(stats))
const probe = await page.evaluate(() => (window as never as { __arcrush: { probe: () => unknown } }).__arcrush.probe())
console.log('avatar probe:', JSON.stringify(probe))
const parts = await page.evaluate(() => (window as never as { __arcrush: { parts: () => unknown } }).__arcrush.parts())
console.log('avatar parts:', JSON.stringify(parts, null, 1).slice(0, 3000))
const dir = '.browser-check'
await page.screenshot({ path: `${dir}/rush-portrait.png` })
// Same framing with the hair hidden, so the painted face can be checked.
await page.evaluate(() => (window as never as { __arcrush: { hair: (on: boolean) => void } }).__arcrush.hair(false))
await new Promise((r) => setTimeout(r, 600))
await page.screenshot({ path: `${dir}/rush-face.png` })
await page.evaluate(() => (window as never as { __arcrush: { hair: (on: boolean) => void } }).__arcrush.hair(true))
await new Promise((r) => setTimeout(r, 400))
// Mika: same framing, second hero.
await page.evaluate(() => {
  const qa = (window as never as { __arcrush: { studio: (on: boolean) => void; character: (id: 'kai' | 'mika') => void } }).__arcrush
  qa.studio(true)
  qa.character('mika')
})
await new Promise((r) => setTimeout(r, 1400))
await page.screenshot({ path: `${dir}/rush-portrait-mika.png` })

// street view: inspect the procedural houses (studio off so the town is back)
await page.evaluate(() => {
  const qa = (window as never as { __arcrush: { studio: (on: boolean) => void; street: (on: boolean) => void } }).__arcrush
  qa.studio(false)
  qa.street(true)
})
await new Promise((r) => setTimeout(r, 1200))
await page.screenshot({ path: `${dir}/rush-street.png` })
await page.evaluate(() => (window as never as { __arcrush: { street: (on: boolean) => void } }).__arcrush.street(false))
await new Promise((r) => setTimeout(r, 600))

// back to the real scene for a full-frame look at medium quality (bloom path)
await page.evaluate(() => (window as never as { __arcrush: { studio: (on: boolean) => void } }).__arcrush.studio(false))
await new Promise((r) => setTimeout(r, 1500))
await page.screenshot({ path: `${dir}/rush-gameplay-medium.png` })
const sceneStats = await page.evaluate(() => (window as never as { __arcrush: { stats: () => unknown } }).__arcrush.stats())
console.log('scene stats (medium quality):', JSON.stringify(sceneStats))
const liveProbe = await page.evaluate(() => (window as never as { __arcrush: { probe: () => unknown } }).__arcrush.probe())
console.log('runner on screen:', JSON.stringify(liveProbe))
const fps = await page.evaluate(
  () =>
    new Promise<number>((resolve) => {
      let frames = 0
      const t0 = performance.now()
      const tick = () => {
        frames++
        if (performance.now() - t0 < 2500) requestAnimationFrame(tick)
        else resolve(frames / ((performance.now() - t0) / 1000))
      }
      requestAnimationFrame(tick)
    })
)
console.log('medium-quality fps:', fps.toFixed(1))
// second shot: mid-run pose
await page.evaluate(() => {
  const qa = (window as never as { __arcrush: Record<string, unknown> }).__arcrush
  void qa
})
console.log('portrait screenshot written')
await browser.close()
