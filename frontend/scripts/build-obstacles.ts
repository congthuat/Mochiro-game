// One-off asset pipeline for the zone-themed obstacles: packs a handful of props from
// Kenney's kits into a single compact GLB at src/assets/models/obstacle-props.glb.
//
// Sources — all by Kenney (www.kenney.nl), released under CC0 (public domain):
//   Graveyard Kit 5.0, Holiday Kit, Survival Kit, Fantasy Town Kit 2.0, Nature Kit 2.1
//
// The colormap kits paint every face by pointing its UVs into a small palette texture.
// The game draws obstacles flat-shaded and untextured, so each vertex samples its colour
// from that palette once, here, and the UVs, normals and textures are dropped. Every
// prop becomes one root node named `prop.<kit>.<model>`, with one material for the pack.
//
// Usage: bun scripts/build-obstacles.ts graveyard=<dir> holiday=<dir> survival=<dir> \
//          fantasy=<dir> nature=<dir>
//        Each <dir> holds the kit's .glb files (and Textures/colormap.png for the
//        colormap kits). Needs `sharp` and the meshoptimizer encoder in node_modules.
import { Accessor, Document, NodeIO, type Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, mergeDocuments, meshopt, prune, quantize, weld } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import { mkdirSync, statSync } from 'node:fs'

export const PROPS: Record<string, readonly string[]> = {
  graveyard: [
    'hay-bale', 'pumpkin-carved', 'gravestone-round', 'gravestone-cross', 'gravestone-wide',
    'coffin', 'iron-fence', 'pillar-square', 'lantern-candle',
  ],
  holiday: ['snowman-hat', 'present-a-cube', 'present-b-cube', 'candy-cane-red', 'snow-pile'],
  survival: ['barrel', 'box', 'box-large', 'rock-sand-b', 'rock-c'],
  fantasy: ['rock-large', 'rock-wide', 'lantern', 'wheel'],
  nature: ['cactus_tall', 'cactus_short', 'log_large', 'rock_tallA', 'crop_pumpkin'],
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

const dirs = new Map(process.argv.slice(2).map((arg) => arg.split('=') as [string, string]))
for (const kit of Object.keys(PROPS)) if (!dirs.get(kit)) throw new Error(`missing ${kit}=<dir>`)
const OUT = 'src/assets/models/obstacle-props.glb'

type Palette = { data: Buffer; width: number; height: number }
const palettes = new Map<string, Palette | null>()
async function palette(kit: string): Promise<Palette | null> {
  if (palettes.has(kit)) return palettes.get(kit) ?? null
  let found: Palette | null = null
  if (kit !== 'nature') {
    const img = await sharp(`${dirs.get(kit)}/Textures/colormap.png`).raw().ensureAlpha().toBuffer({ resolveWithObject: true })
    found = { data: img.data, width: img.info.width, height: img.info.height }
  }
  palettes.set(kit, found)
  return found
}

function bake(part: Document, prim: Primitive, pal: Palette | null): void {
  const buffer = part.getRoot().listBuffers()[0]
  const material = prim.getMaterial()
  const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1]
  const uv = prim.getAttribute('TEXCOORD_0')
  const count = prim.getAttribute('POSITION')?.getCount() ?? 0
  const data = new Float32Array(count * 3)
  const at: number[] = []
  for (let i = 0; i < count; i++) {
    let rgb: [number, number, number] = [factor[0], factor[1], factor[2]]
    if (pal && uv && material?.getBaseColorTexture()) {
      uv.getElement(i, at)
      const x = Math.min(pal.width - 1, Math.max(0, Math.floor(at[0] * pal.width)))
      const y = Math.min(pal.height - 1, Math.max(0, Math.floor(at[1] * pal.height)))
      const o = (y * pal.width + x) * 4
      rgb = [
        srgbToLinear(pal.data[o] / 255) * factor[0],
        srgbToLinear(pal.data[o + 1] / 255) * factor[1],
        srgbToLinear(pal.data[o + 2] / 255) * factor[2],
      ]
    }
    data.set(rgb, i * 3)
  }
  prim.setAttribute('COLOR_0', part.createAccessor().setType(Accessor.Type.VEC3).setArray(data).setBuffer(buffer))
  prim.setAttribute('NORMAL', null)
  prim.setAttribute('TEXCOORD_0', null)
}

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const doc = new Document()

for (const [kit, models] of Object.entries(PROPS)) {
  const pal = await palette(kit)
  for (const model of models) {
    const part = await io.read(`${dirs.get(kit)}/${model}.glb`)
    const root = part.getRoot()
    const scene = root.listScenes()[0]
    const holder = part.createNode(`prop.${kit}.${model}`)
    for (const child of scene.listChildren()) {
      scene.removeChild(child)
      holder.addChild(child)
    }
    scene.addChild(holder)
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) bake(part, prim, pal)
    for (const material of root.listMaterials()) material.setName('prop').setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(null)
    for (const texture of root.listTextures()) texture.dispose()
    mergeDocuments(doc, part)
  }
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

const [material, ...others] = root.listMaterials()
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) prim.setMaterial(material)
for (const other of others) other.dispose()

await doc.transform(dedup(), prune(), quantize({ quantizeColor: 8 }), weld(), meshopt({ encoder: MeshoptEncoder, level: 'high' }))
mkdirSync('src/assets/models', { recursive: true })
await io.write(OUT, doc)
console.log(OUT, statSync(OUT).size, 'bytes,', scene.listChildren().length, 'props,', root.listMaterials().length, 'materials')
