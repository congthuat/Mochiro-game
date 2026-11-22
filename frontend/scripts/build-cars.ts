// One-off asset pipeline for the traffic: packs the five KayKit city cars into a
// single compact GLB (one shared texture, quantised vertices) at
// src/assets/models/kaykit-cars.glb.
//
// Source: "KayKit - City Builder Bits (1.0)" by Kay Lousberg — CC0 (public domain).
//   https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0
//   (addons/kaykit_city_builder_bits/Assets/gltf/car_*.gltf + citybits_texture.png)
//
// Usage: bun scripts/build-cars.ts <folder with the car_*.gltf files>
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, mergeDocuments, prune, quantize, unpartition } from '@gltf-transform/functions'
import { mkdirSync, statSync } from 'node:fs'

export const CARS = ['car_sedan', 'car_hatchback', 'car_stationwagon', 'car_taxi', 'car_police'] as const

const SRC = process.argv[2]
const OUT = 'src/assets/models/kaykit-cars.glb'
if (!SRC) throw new Error('usage: bun scripts/build-cars.ts <kaykit gltf folder>')

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = new Document()
for (const name of CARS) mergeDocuments(doc, await io.read(`${SRC}/${name}.gltf`))

// One scene holding the five cars side by side in the file (placement happens in game).
const root = doc.getRoot()
const [scene, ...rest] = root.listScenes()
for (const other of rest) {
  for (const node of other.listChildren()) scene.addChild(node)
  other.dispose()
}
root.setDefaultScene(scene)

await doc.transform(unpartition(), dedup(), prune(), quantize())
mkdirSync('src/assets/models', { recursive: true })
await io.write(OUT, doc)
console.log(OUT, statSync(OUT).size, 'bytes', scene.listChildren().map((node) => node.getName()))
