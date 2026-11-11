// Browser-free dictionary audit.
//
// The UI is bilingual, and a key missing from the dictionary does not fail loudly — it
// renders as its own name. "Bắt đầu chạy" becomes "MENU.START", and the build stays
// green, the other checks stay green, and the raw key ships to the menu. That is
// exactly what happened when a cleanup deleted a *range* of entries instead of one:
// fourteen menu strings vanished and nobody noticed until a screenshot.
//
// So this reads the dictionary and every call site and compares them in both
// directions: nothing used may be missing, and nothing defined may be unused.
import { readFileSync } from 'node:fs'
import { Glob } from 'bun'

const DICT_FILE = 'src/lib/i18n.ts'
const dictSrc = readFileSync(DICT_FILE, 'utf8')

interface Entry {
  key: string
  body: string
}

/** Every `'key': { ... }` in the dictionary, with its braces matched properly. */
function readEntries(): Entry[] {
  const from = dictSrc.indexOf('const DICT')
  const to = dictSrc.indexOf('\n}\n', from)
  const body = dictSrc.slice(from, to)
  const entries: Entry[] = []
  const at = /'([^']+)':\s*\{/g
  let match: RegExpExecArray | null
  while ((match = at.exec(body))) {
    const open = match.index + match[0].length - 1
    let depth = 0
    let close = open
    for (let i = open; i < body.length; i += 1) {
      if (body[i] === '{') depth += 1
      else if (body[i] === '}') {
        depth -= 1
        if (depth === 0) {
          close = i
          break
        }
      }
    }
    entries.push({ key: match[1], body: body.slice(open, close + 1) })
  }
  return entries
}

const entries = readEntries()
const defined = new Set(entries.map((entry) => entry.key))

/** Every key a component asks for, however it is written. */
function readUsed(): { literals: Set<string>; templates: Set<string> } {
  const literals = new Set<string>()
  const templates = new Set<string>()
  const glob = new Glob('src/**/*.{ts,tsx}')
  for (const file of glob.scanSync('.')) {
    if (file.endsWith('lib/i18n.ts')) continue
    const src = readFileSync(file, 'utf8')
    // Walk to each `t(` and take its balanced argument text. Matching `t('…')` directly
    // is not enough: a key can sit inside a ternary or behind a second argument, which
    // is exactly how the power banners are written — and missing those made this check
    // report fifteen perfectly live keys as unused.
    for (const at of src.matchAll(/\bt\(/g)) {
      const open = at.index + at[0].length - 1
      let depth = 0
      let close = open
      for (let i = open; i < src.length; i += 1) {
        if (src[i] === '(') depth += 1
        else if (src[i] === ')') {
          depth -= 1
          if (depth === 0) {
            close = i
            break
          }
        }
      }
      // Only the first argument is a key: `t('help.intro', { brand: 'Arc' })` must not
      // report "Arc" as a missing string.
      const args = src.slice(open + 1, close)
      let depth2 = 0
      let firstEnd = args.length
      for (let i = 0; i < args.length; i += 1) {
        const c = args[i]
        if (c === '(' || c === '[' || c === '{') depth2 += 1
        else if (c === ')' || c === ']' || c === '}') depth2 -= 1
        else if (c === ',' && depth2 === 0) {
          firstEnd = i
          break
        }
      }
      for (const quoted of args.slice(0, firstEnd).matchAll(/'([^']+)'|`([^`]+)`/g)) {
        const value = quoted[1] ?? quoted[2]
        if (value.includes('${')) templates.add(value)
        else literals.add(value)
      }
    }
  }
  return { literals, templates }
}

const { literals, templates } = readUsed()

let failures = 0
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log('Dictionary audit\n')

const missing = [...literals].filter((key) => !defined.has(key)).sort()
check(
  'every string the UI asks for exists',
  missing.length === 0,
  missing.length === 0
    ? `${literals.size} call sites resolve`
    : `MISSING: ${missing.join(', ')} — these render as their own name on screen`
)

// A template key such as `mission.${mission.id}` is only correct if the dictionary
// actually holds a family under that prefix.
const orphanTemplates = [...templates].filter((key) => {
  const prefix = key.slice(0, key.indexOf('${'))
  return ![...defined].some((candidate) => candidate.startsWith(prefix))
})
check(
  'every templated key has a family behind it',
  orphanTemplates.length === 0,
  orphanTemplates.length === 0 ? `${templates.size} templates` : `ORPHANED: ${orphanTemplates.join(', ')}`
)

const templatePrefixes = [...templates].map((key) => key.slice(0, key.indexOf('${')))
const unused = [...defined]
  .filter((key) => !literals.has(key) && !templatePrefixes.some((prefix) => key.startsWith(prefix)))
  .sort()
check(
  'and nothing sits in the dictionary unused',
  unused.length === 0,
  unused.length === 0 ? `${defined.size} keys, all reachable` : `UNUSED: ${unused.join(', ')}`
)

const blank = entries
  .filter((entry) => {
    const en = entry.body.match(/en:\s*'([^']*)'/)?.[1]
    const vi = entry.body.match(/vi:\s*'([^']*)'/)?.[1]
    return !en || !vi
  })
  .map((entry) => entry.key)
check(
  'every entry is written in both languages',
  blank.length === 0,
  blank.length === 0 ? 'Vietnamese and English throughout' : `INCOMPLETE: ${blank.join(', ')}`
)

const seen = new Set<string>()
const duplicates = entries.map((entry) => entry.key).filter((key) => (seen.has(key) ? true : (seen.add(key), false)))
check(
  'no key is defined twice',
  duplicates.length === 0,
  duplicates.length === 0 ? `${entries.length} entries` : `DUPLICATED: ${duplicates.join(', ')}`
)

if (failures > 0) {
  console.error(`\nDictionary check failed (${failures}).`)
  process.exit(1)
}
console.log('\nDictionary check passed.')
