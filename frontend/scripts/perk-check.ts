/**
 * The six signature abilities, checked without a browser.
 *
 * Picking a hero is meant to be a gameplay choice, so two things have to hold: the
 * roster has to be readable (one distinct ability each, labelled in both languages)
 * and the rules have to be honest (a hazard bites everyone — except on the one hero
 * whose ability is a ward against them).
 *
 *   bun run scripts/perk-check.ts
 */
import { CHARACTERS, CHARACTER_IDS, POWERS, powerTakesHold, type PerkId } from '../src/runner/config'
import { translate } from '../src/lib/i18n'

let failed = 0
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
}

console.log('The roster\n')

const perks = CHARACTER_IDS.map((id) => ({ id, name: CHARACTERS[id].name, perk: CHARACTERS[id].perk }))
for (const entry of perks) {
  check(
    `${entry.name} has a signature ability`,
    Boolean(entry.perk?.id),
    entry.perk ? entry.perk.id : 'none'
  )
}

const ids = perks.map((entry) => entry.perk?.id).filter(Boolean) as PerkId[]
check('no two heroes share an ability', new Set(ids).size === ids.length, ids.join(', '))

console.log('\nThe labels the menu card renders\n')
for (const entry of perks) {
  const key = `perk.${entry.perk.id}`
  const en = translate(key, 'en')
  const vi = translate(key, 'vi')
  check(`${entry.name}: labelled in both languages`, en !== key && vi !== key && Boolean(en) && Boolean(vi), `en “${en}” · vi “${vi}”`)
}

console.log('\nThe rule\n')

const harmful = POWERS.filter((power) => power.harmful)
const helpful = POWERS.filter((power) => !power.harmful)
check('there are hazards to be immune to', harmful.length > 0, `${harmful.map((p) => p.kind).join(', ')}`)
check(
  'hazards stay rarer than the rewards',
  harmful.reduce((sum, p) => sum + p.weight, 0) < helpful.reduce((sum, p) => sum + p.weight, 0),
  `${harmful.reduce((sum, p) => sum + p.weight, 0)} vs ${helpful.reduce((sum, p) => sum + p.weight, 0)} spawn weight`
)

const wardens = perks.filter((entry) => entry.perk?.id === 'badImmunity')
check('exactly one hero is warded', wardens.length === 1, wardens.map((w) => w.name).join(', ') || 'none')

for (const entry of perks) {
  const spec = CHARACTERS[entry.id].perk
  const blocked = harmful.filter((power) => !powerTakesHold(spec, power.harmful)).length
  const letsHelpfulThrough = helpful.every((power) => powerTakesHold(spec, false))
  if (spec?.id === 'badImmunity') {
    check(
      `${entry.name} shrugs off every hazard`,
      blocked === harmful.length,
      `${blocked}/${harmful.length} blocked (${harmful.map((p) => p.kind).join(', ')})`
    )
  } else {
    check(
      `${entry.name} still takes every hazard`,
      blocked === 0,
      blocked === 0 ? `${harmful.length}/${harmful.length} land` : `${blocked} blocked by mistake`
    )
  }
  check(
    `${entry.name} keeps every reward`,
    letsHelpfulThrough,
    letsHelpfulThrough ? 'all helpful power-ups apply' : 'a reward was blocked'
  )
}

console.log(failed === 0 ? '\nPerk check passed.' : `\n${failed} perk check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
