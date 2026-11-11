// Dev-only: end-to-end sign-in check.
//
// A mock EIP-1193 provider (the same trick the Makoto wallet repo uses in
// scripts/qa-mock-wallet.js) stands in for a browser extension: the page asks it
// to sign, and the request is handed to a real ethers wallet running here, so
// the SIWE round trip is exercised for real — challenge, signature, session.
import { launch } from 'puppeteer'
import { Wallet } from 'ethers'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_PATH?.trim() || '/'
const URL = `http://localhost:5173${BASE.endsWith('/') ? BASE : `${BASE}/`}`
mkdirSync('.browser-check', { recursive: true })

const wallet = Wallet.createRandom()
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
await page.setViewport({ width: 1000, height: 820 })
const errors: string[] = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

// Signing happens out here, with a real key.
await page.exposeFunction('__qaSign', async (message: string) => wallet.signMessage(message))

await page.evaluateOnNewDocument(
  (address: string) => {
    // A wallet the page can talk to, with no extension installed.
    const provider = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address]
        if (method === 'eth_chainId') return '0x4cef52'
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
        if (method === 'personal_sign') {
          // ethers sends the message hex-encoded; decode it before signing.
          const raw = Array.isArray(params) ? String(params[0]) : ''
          const message = raw.startsWith('0x')
            ? new TextDecoder().decode(new Uint8Array((raw.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16))))
            : raw
          return await (window as unknown as { __qaSign: (m: string) => Promise<string> }).__qaSign(message)
        }
        throw new Error(`mock provider: unsupported method ${method}`)
      },
    }
    ;(window as unknown as { ethereum: unknown }).ethereum = provider
    localStorage.setItem('arcrush.settings', JSON.stringify({ quality: 'low', master: 0, music: 0, sfx: 0 }))
  },
  wallet.address
)

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => /đăng nhập|sign in/i.test(document.body.innerText), { timeout: 90000 })

const gate = await page.evaluate(() => document.body.innerText)
check('the sign-in gate is shown before the game', /sign in|đăng nhập/i.test(gate))
check('a Google option is offered', /google/i.test(gate))
check('a wallet option is offered', /ví|wallet/i.test(gate))
check('the language switch is on the gate', /Tiếng Việt/.test(gate) && /English/.test(gate))
const shotGate = await page.screenshot({ path: '.browser-check/auth-gate.png' })
check('the gate renders', shotGate.length > 8000, `${shotGate.length} bytes`)

// Wallet sign-in
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll('button')).find((b) => /kết nối ví|connect a wallet/i.test(b.textContent ?? ''))
  ;(button as HTMLButtonElement | undefined)?.click()
})
const reachedMenu = await page
  .waitForFunction(() => /start sprint|bắt đầu chạy/i.test(document.body.innerText), { timeout: 90000 })
  .then(() => true)
  .catch(() => false)
check('wallet sign-in reaches the menu', reachedMenu)
if (!reachedMenu) {
  const state = await page.evaluate(() => ({
    error: document.querySelector('.ar-auth-error')?.textContent ?? null,
    text: document.body.innerText.slice(0, 300),
  }))
  console.log('   gate error:', state.error)
  console.log('   gate text:', state.text.replace(/\n+/g, ' | ').slice(0, 240))
}

const chip = await page.evaluate(() => {
  const el = document.querySelector('.ar-account')
  return el ? el.textContent ?? '' : null
})
// The server stores addresses lower-cased, so compare the chip case-insensitively.
const short = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`.toLowerCase()
check(
  'the account chip shows the signed-in wallet',
  Boolean(chip && chip.toLowerCase().includes(short)),
  `chip "${chip ?? 'none'}" · expected ${short}`
)

const session = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem('arcrush.session') ?? 'null')
  } catch {
    return null
  }
})
check(
  'a bearer session is stored for the signed-in address',
  Boolean(session?.token && String(session.account?.address).toLowerCase() === wallet.address.toLowerCase()),
  session ? `token ${String(session.token).slice(0, 8)}…` : 'none'
)

// The session survives a reload
await page.reload({ waitUntil: 'domcontentloaded' })
const stillIn = await page
  .waitForFunction(() => /start sprint|bắt đầu chạy/i.test(document.body.innerText), { timeout: 90000 })
  .then(() => true)
  .catch(() => false)
check('the session survives a reload', stillIn)

// Server-side validation of that token
const serverSession = await page.evaluate(async (endpoint: string) => {
  const stored = JSON.parse(localStorage.getItem('arcrush.session') ?? 'null')
  if (!stored?.token) return null
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${stored.token}` } })
  return await response.json()
}, `${BASE}api/auth`)
check(
  'the server accepts the session token',
  Boolean(serverSession?.authenticated),
  serverSession?.account?.address ?? 'rejected'
)

// Sign out returns to the gate
await page.evaluate(() => {
  const button = document.querySelector('.ar-account button') as HTMLButtonElement | null
  button?.click()
})
const backToGate = await page
  .waitForFunction(() => /đăng nhập|sign in/i.test(document.body.innerText), { timeout: 60000 })
  .then(() => true)
  .catch(() => false)
check('signing out returns to the gate', backToGate)
const cleared = await page.evaluate(() => localStorage.getItem('arcrush.session'))
check('signing out clears the stored session', cleared === null)

// Guest path still works
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll('button')).find((b) => /khách|guest/i.test(b.textContent ?? ''))
  ;(button as HTMLButtonElement | undefined)?.click()
})
const guestMenu = await page
  .waitForFunction(() => /start sprint|bắt đầu chạy/i.test(document.body.innerText), { timeout: 90000 })
  .then(() => true)
  .catch(() => false)
check('guests can still play', guestMenu)

// Every hero loads in the game
const seam = (name: string, ...args: unknown[]) =>
  page.evaluate(
    (method, params) =>
      (window as never as { __arcrush: Record<string, (...x: unknown[]) => void> }).__arcrush[method](...params),
    name,
    args
  )
const snap = () =>
  page.evaluate(() =>
    (window as never as { __arcrush: { snapshot: () => Record<string, string | number | boolean> } }).__arcrush.snapshot()
  )
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll('button')).find((b) => /start sprint|bắt đầu chạy/i.test(b.textContent ?? ''))
  ;(button as HTMLButtonElement | undefined)?.click()
})
await page.waitForFunction(() => (window as never as { __arcrush?: unknown }).__arcrush !== undefined, { timeout: 60000 })
await sleep(2500)

for (const id of ['kai', 'mika', 'bjorn', 'nyx', 'rin'] as const) {
  await seam('character', id)
  const ok = await page
    .waitForFunction(
      (want: string) => {
        const s = (window as never as { __arcrush: { snapshot: () => Record<string, unknown> } }).__arcrush.snapshot()
        return s.character === want && s.avatar === 'rigged'
      },
      { timeout: 45000 },
      id
    )
    .then(() => true)
    .catch(() => false)
  const state = await snap()
  check(`hero "${id}" loads its rigged model`, ok, `avatar ${state.avatar} · anim ${state.anim}`)
}

const failures = checks.filter((item) => !item.ok)
console.log(`\n${checks.length - failures.length}/${checks.length} sign-in checks passed`)
if (errors.length) console.log('console errors:', errors.slice(0, 3).join(' | '))
if (failures.length) process.exitCode = 1
await browser.close()
