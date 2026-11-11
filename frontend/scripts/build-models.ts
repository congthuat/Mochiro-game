// One-off asset pipeline: strips the 76 KayKit clips down to the ones the runner
// uses, prunes unreferenced data and writes compact GLBs into src/assets/models.
//
// Source: "KayKit - Adventurers Character Pack (1.0)" by Kay Lousberg — CC0.
//   https://kaylousberg.itch.io/kaykit-adventurers
import { NodeIO } from '@gltf-transform/core'
import { prune, dedup, resample } from '@gltf-transform/functions'
import { readdirSync, mkdirSync } from 'node:fs'

const KEEP = new Set([
  'Idle',
  'Running_A',
  'Jump_Start',
  'Jump_Idle',
  'Jump_Land',
  'Dodge_Forward',
  'Dodge_Left',
  'Dodge_Right',
  'Cheer',
  'Death_A',
])

const SRC = '/tmp'
const OUT = 'src/assets/models'

const io = new NodeIO()
mkdirSync(OUT, { recursive: true })
const files = readdirSync(SRC).filter((f) => /^kk_.*\.glb$/.test(f))
for (const file of files) {
  const name = file.replace(/^kk_/, '').replace(/\.glb$/, '').toLowerCase()
  const doc = await io.read(`${SRC}/${file}`)
  const root = doc.getRoot()
  let dropped = 0
  // Accessors still needed by the clips we keep.
  const keepAccessors = new Set<unknown>()
  for (const anim of root.listAnimations()) {
    if (!KEEP.has(anim.getName())) continue
    for (const sampler of anim.listSamplers()) {
      keepAccessors.add(sampler.getInput())
      keepAccessors.add(sampler.getOutput())
    }
  }
  // Disposing an Animation leaves its samplers + accessors behind, which is what
  // makes a stripped GLB look small in the viewer but stay megabytes on disk.
  for (const anim of [...root.listAnimations()]) {
    if (KEEP.has(anim.getName())) continue
    for (const sampler of anim.listSamplers()) {
      const input = sampler.getInput()
      const output = sampler.getOutput()
      sampler.dispose()
      if (input && !keepAccessors.has(input)) input.dispose()
      if (output && !keepAccessors.has(output)) output.dispose()
    }
    anim.dispose()
    dropped++
  }
  // Drop the constant "scale = 1" tracks: they triple the channel count and the
  // glTF JSON that goes with it, and the rest pose already provides them.
  let droppedTracks = 0
  for (const anim of root.listAnimations()) {
    for (const channel of anim.listChannels()) {
      if (channel.getTargetPath() !== 'scale') continue
      const array = channel.getSampler().getOutput().getArray()
      let constant = true
      for (let i = 0; i < array.length; i++) {
        if (Math.abs(array[i] - 1) > 1e-4) {
          constant = false
          break
        }
      }
      if (constant) {
        channel.dispose()
        droppedTracks++
      }
    }
    for (const sampler of anim.listSamplers()) {
      if (!anim.listChannels().some((c) => c.getSampler() === sampler)) sampler.dispose()
    }
  }
  await doc.transform(dedup(), resample(), prune())
  await io.write(`${OUT}/${name}.glb`, doc)
  const kept = root.listAnimations().map((a) => a.getName())
  console.log(`${name}: dropped ${dropped} clips + ${droppedTracks} constant tracks, kept ${kept.length} → ${kept.join(', ')}`)
}
