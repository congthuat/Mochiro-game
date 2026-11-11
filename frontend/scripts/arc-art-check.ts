// Dev-only: captures the Arc coin / billboard / mark artwork so it can be reviewed.
import { launch } from 'puppeteer'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.BASE_PATH?.trim() || '/'
const URL = `http://localhost:5173${BASE.endsWith('/') ? BASE : `${BASE}/`}`
const OUT = '.browser-check'
mkdirSync(OUT, { recursive: true })

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
await new Promise((r) => setTimeout(r, 1500))

type Art = { coin: string | null; billboard: string | null; mark: string | null }
const art = await page.evaluate(() =>
  (window as never as { __arcrush: { artwork: () => Art } }).__arcrush.artwork()
) as Art

const save = (name: string, dataUrl: string | null) => {
  if (!dataUrl) { console.log(`  ✗ ${name} missing`); return false }
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`  ✓ ${name} saved (${Math.round(dataUrl.length / 1024)}KB)`)
  return true
}
const ok = [save('art-coin', art.coin), save('art-billboard', art.billboard), save('art-mark', art.mark)]

const qa = async (fn: string, arg: boolean) =>
  page.evaluate(
    (name, value) => (window as never as { __arcrush: Record<string, (v: boolean) => void> }).__arcrush[name](value),
    fn,
    arg
  )

// Close-ups have to happen in play: the menu panel covers the canvas.
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /start sprint/i.test(b.textContent ?? ''))
  ;(btn as HTMLButtonElement | undefined)?.click()
})
await new Promise((r) => setTimeout(r, 3500))
await qa('freezeSpawns', true)
await new Promise((r) => setTimeout(r, 500))
// Close-ups happen while the menu is up: the scenery chunks still sit at their
// boot positions, so the parked camera actually frames the props.
await qa('billboard', true)
await new Promise((r) => setTimeout(r, 1200))
await page.screenshot({ path: `${OUT}/art-billboard-ingame.png` })
await qa('billboard', false)
console.log('  ✓ art-billboard-ingame saved')

await qa('coin', true)
await new Promise((r) => setTimeout(r, 1200))
await page.screenshot({ path: `${OUT}/art-coin-ingame.png` })
await qa('coin', false)
console.log('  ✓ art-coin-ingame saved')


await new Promise((r) => setTimeout(r, 1500))
await page.screenshot({ path: `${OUT}/art-gameplay.png` })
console.log(`  ✓ art-gameplay saved | console errors: ${errors.length}`)
if (errors.length) console.log('   ', errors.slice(0, 3).join(' | '))
await browser.close()
process.exit(ok.every(Boolean) ? 0 : 1)
