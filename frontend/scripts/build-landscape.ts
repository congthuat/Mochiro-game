// One-off asset pipeline for the countryside beyond the city: packs a selection of
// Kenney's Nature Kit into a single compact GLB at src/assets/models/landscape.glb.
//
// Source — by Kenney (www.kenney.nl), released under CC0 (public domain):
//   Nature Kit 2.1  https://kenney.nl/assets/nature-kit
//
// The kit colours every model with flat material colours and no texture. Here each
// primitive's material colour is baked into a vertex colour (re-graded so the kit's
// teal greens sit with the game's grass), the normals and UVs are dropped (the game
// draws the countryside flat-shaded) and every model becomes one root node named
// `nat.<model>`. One material for the whole pack.
//
// Usage: bun scripts/build-landscape.ts "<Nature Kit>/Models/GLTF format"
//        Needs the meshoptimizer encoder (`bun add -d meshoptimizer` if it is not installed).
import { Accessor, Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, mergeDocuments, meshopt, prune, quantize, weld } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { mkdirSync, statSync } from 'node:fs'

export const MODELS = [
  // Forest and mountains
  'tree_pineTallA', 'tree_pineTallB', 'tree_pineTallC', 'tree_pineTallD',
  'tree_pineRoundC', 'tree_pineRoundD', 'tree_pineRoundE',
  'tree_pineDefaultA', 'tree_pineDefaultB', 'tree_pineSmallA', 'tree_pineSmallB', 'tree_pineGroundA',
  'tree_tall_dark', 'tree_default_dark', 'tree_cone_dark',
  'tree_default_fall', 'tree_fat_fall', 'tree_cone_fall', 'tree_oak_fall',
  'rock_tallA', 'rock_tallB', 'rock_tallC', 'rock_tallE', 'rock_tallG',
  'rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_largeD', 'rock_smallA', 'rock_smallC',
  'stone_tallA', 'stone_tallB', 'stone_tallC', 'stone_tallE', 'stone_largeA', 'stone_largeB', 'stone_largeC',
  'cliff_large_rock', 'cliff_block_rock', 'cliff_top_rock', 'cliff_large_stone', 'cliff_block_stone',
  'stump_old', 'stump_round', 'log', 'log_large', 'log_stack', 'log_stackLarge',
  'mushroom_redGroup', 'mushroom_tanGroup', 'plant_bushLarge', 'plant_bush', 'plant_bushDetailed', 'grass_large',
  'tent_detailedOpen', 'tent_smallClosed', 'campfire_logs', 'campfire_stones',
  // Plains and farmland
  'tree_default', 'tree_oak', 'tree_fat', 'tree_simple', 'tree_small', 'tree_cone', 'tree_plateau',
  'crops_cornStageC', 'crops_cornStageD', 'crop_pumpkin',
  'fence_simple', 'fence_planks', 'fence_gate',
  'flower_redA', 'flower_yellowA', 'flower_purpleA', 'sign',
  // Desert
  'cactus_tall', 'cactus_short', 'tree_palm', 'tree_palmTall', 'tree_palmBend', 'tree_palmShort',
  'statue_obelisk', 'statue_column', 'statue_columnDamaged', 'statue_head', 'statue_ring', 'statue_block',
  'tent_smallOpen', 'tent_detailedClosed',
] as const

/**
 * Re-grade of the kit palette, by material name, in sRGB. The kit's greens are a minty
 * teal that fights the game's grass; rocks and wood are pulled a little greyer so the
 * countryside reads in the same light as the city kits.
 */
const GRADE: Record<string, string> = {
  leafsGreen: '#4fae4a',
  leafsDark: '#2f7d4c',
  leafsFall: '#ee8a2e',
  grass: '#6cbf4e',
  dirt: '#a38a72',
  stone: '#aab4ba',
  stoneDark: '#87929a',
  woodBark: '#8a5a3a',
  woodBarkDark: '#6b4630',
  woodBirch: '#efe6d6',
  wood: '#b37b4a',
  woodDark: '#8a5c36',
  woodInner: '#e3c79c',
  corn: '#f2c94c',
  colorRed: '#d9534f',
  colorRedDark: '#b23c3a',
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const hexToLinear = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)]
}

const SRC = process.argv[2]
const OUT = 'src/assets/models/landscape.glb'
if (!SRC) throw new Error('usage: bun scripts/build-landscape.ts "<Nature Kit>/Models/GLTF format"')

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const doc = new Document()

for (const model of MODELS) {
  const part = await io.read(`${SRC}/${model}.glb`)
  const root = part.getRoot()
  const scene = root.listScenes()[0]
  const holder = part.createNode(`nat.${model}`)
  for (const child of scene.listChildren()) {
    scene.removeChild(child)
    holder.addChild(child)
  }
  scene.addChild(holder)
  const buffer = root.listBuffers()[0]
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial()
      const name = material?.getName() ?? ''
      const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1]
      const colour = GRADE[name] ? hexToLinear(GRADE[name]) : [factor[0], factor[1], factor[2]]
      const count = prim.getAttribute('POSITION')?.getCount() ?? 0
      const data = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) data.set(colour, i * 3)
      prim.setAttribute('COLOR_0', part.createAccessor().setType(Accessor.Type.VEC3).setArray(data).setBuffer(buffer))
      // Flat-shaded and untextured in the game: no normals, no UVs.
      prim.setAttribute('NORMAL', null)
      prim.setAttribute('TEXCOORD_0', null)
    }
  }
  for (const material of root.listMaterials()) material.setName('nat').setBaseColorFactor([1, 1, 1, 1])
  mergeDocuments(doc, part)
}

const root = doc.getRoot()
const [scene, ...rest] = root.listScenes()
for (const other of rest) {
  for (const node of other.listChildren()) scene.addChild(node)
  other.dispose()
}
root.setDefaultScene(scene)

const [buffer, ...extra] = root.listBuffers()
for (const accessor of root.listAccessors()) accessor.setBuffer(buffer)
for (const other of extra) other.dispose()

// Every model now shares one plain white material; keep one of them.
const [material, ...others] = root.listMaterials()
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) prim.setMaterial(material)
for (const other of others) other.dispose()

await doc.transform(dedup(), prune(), quantize({ quantizeColor: 8 }), weld(), meshopt({ encoder: MeshoptEncoder, level: 'high' }))
mkdirSync('src/assets/models', { recursive: true })
await io.write(OUT, doc)
console.log(OUT, statSync(OUT).size, 'bytes,', scene.listChildren().length, 'models,', root.listMaterials().length, 'materials')
