// One-off asset pipeline for the city districts: packs a selection of Kenney's City
// Kit buildings into a single compact GLB at src/assets/models/city-districts.glb.
//
// Sources — all by Kenney (www.kenney.nl), released under CC0 (public domain):
//   City Kit (Commercial) 2.1  https://opengameart.org/content/city-kit-commercial
//   City Kit (Suburban) 2.0    https://opengameart.org/content/city-kit-suburban
//   City Kit (Industrial) 2.0  https://kenney.nl/assets/city-kit-industrial
//
// Every model becomes one root node named `<kit>.<model>` (e.g. `com.building-a`); each
// kit keeps its own 512² palette texture and one material. Vertices are quantised and
// the buffers meshopt-compressed, so the whole city costs a few hundred KB.
//
// Usage: bun scripts/build-districts.ts <folder holding commercial/ suburban/ industrial/>
//        (each the kit's "Models/GLB format" folder, with its Textures/ beside the .glb files)
//        Needs the meshoptimizer encoder (`bun add -d meshoptimizer` if it is not installed).
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, mergeDocuments, meshopt, prune, quantize, weld } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { mkdirSync, statSync } from 'node:fs'

const letters = (from: string, to: string, prefix: string): string[] => {
  const out: string[] = []
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(prefix + String.fromCharCode(c))
  return out
}

export const KITS = {
  com: {
    folder: 'commercial',
    models: [
      ...letters('a', 'n', 'building-'),
      ...letters('a', 'e', 'building-skyscraper-'),
      ...letters('a', 'm', 'low-detail-building-'),
      'low-detail-building-wide-a',
      'low-detail-building-wide-b',
      'detail-parasol-a',
      'detail-parasol-b',
    ],
  },
  sub: {
    folder: 'suburban',
    models: [...letters('a', 'u', 'building-type-'), 'tree-large', 'tree-small', 'planter', 'fence-1x4'],
  },
  ind: {
    folder: 'industrial',
    models: [
      ...letters('a', 't', 'building-'),
      'chimney-large',
      'chimney-medium',
      'detail-tank-large',
      'detail-tank',
      'shipping-container-a',
      'shipping-container-b',
      'shipping-container-c',
      'water-tower',
      'windmill',
      'solar-panel-landscape-group',
    ],
  },
} as const

const SRC = process.argv[2]
const OUT = 'src/assets/models/city-districts.glb'
if (!SRC) throw new Error('usage: bun scripts/build-districts.ts <folder with commercial/ suburban/ industrial/>')

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const doc = new Document()

for (const [kit, { folder, models }] of Object.entries(KITS)) {
  for (const model of models) {
    const part = await io.read(`${SRC}/${folder}/${model}.glb`)
    const scene = part.getRoot().listScenes()[0]
    // One named root per model, whatever the source hierarchy looked like.
    const holder = part.createNode(`${kit}.${model}`)
    for (const child of scene.listChildren()) {
      scene.removeChild(child)
      holder.addChild(child)
    }
    scene.addChild(holder)
    // The industrial kit splits its faces over "colormap" and "colormap-specular", which
    // are the same texture with the same factors; one material per kit is all we need.
    for (const material of part.getRoot().listMaterials()) material.setName(kit)
    for (const texture of part.getRoot().listTextures()) texture.setName(kit).setURI(`${kit}.png`)
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

// One buffer for the whole file (mergeDocuments brings one per source model).
const [buffer, ...extra] = root.listBuffers()
for (const accessor of root.listAccessors()) accessor.setBuffer(buffer)
for (const other of extra) other.dispose()

// No normals: the game draws these flat-shaded (face normals from screen derivatives),
// which is how the kits are lit anyway. Without them the hard edges stop splitting
// vertices, so welding shares every corner a face's neighbours also use — roughly
// halving the vertex count, and the file with it.
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const normal = prim.getAttribute('NORMAL')
    if (normal) prim.setAttribute('NORMAL', null)
  }
}

await doc.transform(dedup(), prune(), quantize(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'high' }))
mkdirSync('src/assets/models', { recursive: true })
await io.write(OUT, doc)
console.log(OUT, statSync(OUT).size, 'bytes,', scene.listChildren().length, 'models,', root.listMaterials().length, 'materials,', root.listTextures().length, 'textures')
