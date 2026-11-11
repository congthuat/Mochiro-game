// Dev-only: studio portrait of each of the six heroes, plus a check that the
// archer really is carrying a bow and a quiver (measured, not eyeballed).
import { launch } from 'puppeteer'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_PATH?.trim() || '/'
const URL = `http://localhost:5173${BASE.endsWith('/') ? BASE : `${BASE}/`}`
mkdirSync('.browser-check', { recursive: true })

const checks: { name: string; ok: boolean; detail?: string }[] = []
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const browser = await launch({
  headless: 'shell',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 760, height: 900, deviceScaleFactor: 2 })
const errors: string[] = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

await page.evaluateOnNewDocument(() => {
  localStorage.setItem('arcrush.guest', '1')
  localStorage.setItem('arcrush.settings', JSON.stringify({ quality: 'medium', master: 0, music: 0, sfx: 0 }))
})
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => /start sprint|bắt đầu chạy/i.test(document.body.innerText), { timeout: 120000 })
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll('button')).find((b) => /start sprint|bắt đầu chạy/i.test(b.textContent ?? ''))
  ;(button as HTMLButtonElement | undefined)?.click()
})
await page.waitForFunction(() => (window as never as { __arcrush?: unknown }).__arcrush !== undefined, { timeout: 90000 })
await sleep(2500)

type Seam = {
  freezeSpawns: (on: boolean) => void
  studio: (on: boolean) => void
  noFx: (on: boolean) => void
  character: (id: string) => void
  gear: () => { name: string; size: number[]; centre: number[]; localEuler: number[]; worldEuler: number[]; holderEuler: number[] }[]
  snapshot: () => Record<string, unknown>
}
const seam = <K extends keyof Seam>(method: K, ...args: unknown[]) =>
  page.evaluate(
    (name, params) =>
      (window as never as { __arcrush: Record<string, (...x: unknown[]) => unknown> }).__arcrush[name](...params),
    method as string,
    args
  ) as Promise<unknown>

await seam('freezeSpawns', true)
await seam('studio', true)
await sleep(1200)

let boneRef: Record<string, number[]> = {}
const heroes = ['kai', 'mika', 'bjorn', 'nyx', 'rin', 'tim'] as const
for (const id of heroes) {
  await seam('character', id)
  await sleep(2200)
  const snap = (await seam('snapshot')) as Record<string, unknown>
  const gear = (await seam('gear')) as { name: string; size: number[]; centre: number[]; localEuler: number[]; worldEuler: number[]; holderEuler: number[] }[]
  if (id === 'rin') {
    console.log('   gear detail:', JSON.stringify(gear))
    const bones = (await page.evaluate(() =>
      (window as never as { __arcrush: { bones: () => Record<string, number[]> } }).__arcrush.bones()
    )) as Record<string, number[]>
    console.log('   bones:', JSON.stringify(bones))
    boneRef = bones
  }
  await page.screenshot({ path: `.browser-check/hero-${id}.png` })
  check(
    `hero "${id}" renders its rigged model`,
    snap.avatar === 'rigged' && snap.character === id,
    `avatar ${snap.avatar} · anim ${snap.anim} · gear ${gear.length ? gear.map((g) => g.name).join(', ') : 'none'}`
  )
  const weapons = (await page.evaluate(() =>
    (window as never as { __arcrush: { weapons: () => Record<string, boolean> } }).__arcrush.weapons()
  )) as Record<string, boolean>
  if (id === 'rin') {
    console.log('   weapons:', JSON.stringify(weapons))
  }
  if (id === 'rin') {
    const baked = Object.entries(weapons).filter(([name]) => !name.startsWith('gear:'))
    check(
      'the archer carries no baked-in melee weapon',
      baked.every(([, visible]) => !visible),
      baked.map(([name, visible]) => `${name}=${visible}`).join(' ') || 'none'
    )
    const arbalest = Object.entries(weapons).find(([name]) => /^2H_Crossbow$/i.test(name))
    check(
      "the archer holds the rig's arbalest",
      arbalest?.[1] === true,
      arbalest ? `${arbalest[0]} visible=${arbalest[1]}` : 'no crossbow in the rig'
    )
  }
  if (id === 'nyx') {
    const knife = Object.entries(weapons).find(([name]) => /knife/i.test(name))
    check(
      'the assassin still carries his knife',
      Boolean(knife && knife[1] === true),
      knife ? `${knife[0]} visible=${knife[1]}` : 'no knife mesh'
    )
  }
  // The run cycle leans the torso well forward, so "behind the back" is not a fixed
  // world direction: measure the gap from the spine bone instead.
  const spine = boneRef.chest ?? [0, 0, 0]
  const gap = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const visible = (name: RegExp): boolean | undefined =>
    Object.entries(weapons).find(([key]) => name.test(key))?.[1]
  if (id === 'rin') {
    const quiver = gear.find((g) => g.name === 'gear:quiver')
    // There is no bow in the pack any more: Mike carries the rig's own arbalest, so
    // the thing worth asserting is that the old hand-built bow is gone for good.
    check(
      'the archer carries no bow',
      visible(/\bbow\b/i) !== true,
      `bow mesh visible=${visible(/\bbow\b/i)}`
    )
    check(
      'the archer carries no light crossbow',
      visible(/^1H_Crossbow$/i) !== true,
      `1H_Crossbow visible=${visible(/^1H_Crossbow$/i)}`
    )
    check(
      'the quiver rides on the back, clear of the spine',
      quiver ? gap(quiver.centre, spine) > 0.22 : false,
      quiver ? `${gap(quiver.centre, spine).toFixed(2)} m from the chest bone` : 'missing'
    )
  } else if (id === 'kai' || id === 'tim') {
    // The two knights share a rig, so this is the one place where the switch-off
    // list has to be right for two heroes at once.
    const greatsword = id === 'tim'
    const blade = greatsword ? /^2H_Sword$/i : /^1H_Sword$/i
    check(
      greatsword ? 'the swordsman holds the greatsword' : 'the shield knight holds the side sword',
      visible(blade) === true,
      `${greatsword ? '2H_Sword' : '1H_Sword'} visible=${visible(blade)}`
    )
    check(
      greatsword ? 'the swordsman carries no shield' : 'the shield knight keeps the round shield',
      visible(/^Round_Shield$/i) === !greatsword,
      `Round_Shield visible=${visible(/^Round_Shield$/i)}`
    )
    const spare = Object.entries(weapons).filter(([name]) =>
      greatsword
        ? /Badge_Shield|Rectangle_Shield|Round_Shield|Spike_Shield|1H_Sword|Knight_Cape|Knight_Helmet/i.test(name)
        : /Badge_Shield|Rectangle_Shield|Spike_Shield|2H_Sword|1H_Sword_Offhand/i.test(name)
    )
    check(
      greatsword ? 'the swordsman carries nothing else' : 'the shield knight carries no spare kit',
      spare.every(([, on]) => !on),
      spare.map(([name, on]) => `${name}=${on}`).join(' ') || 'none'
    )
  } else {
    check(`hero "${id}" carries no extra kit`, gear.length === 0, `${gear.length} pieces`)
  }
}

console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} hero checks passed`)
if (errors.length) console.log('console errors:', errors.slice(0, 3).join(' | '))
if (checks.some((c) => !c.ok)) process.exitCode = 1
await browser.close()
