// Everything outside the track: bright day sky, drifting clouds, the Arc ring,
// balloons, rolling hills and a street of detailed procedural houses that recycles
// in chunks as the runner advances.
import * as THREE from 'three'
import { PALETTE, RUN, type QualityPreset } from './config'
import { buildWordmarkTexture, type ArcMark } from './arc'
import { cloudTexture, glowTexture, skyTexture } from './textures'
import { makeRng, randRange } from './utils'
import type { ArcBrand } from './types'
import {
  makeBench,
  makeBlock,
  makeBush,
  makeFence,
  makeFlowers,
  makeHedge,
  makeHouse,
  makeLamp,
  makePine,
  makeSign,
  makeTree,
} from './town'

const CHUNK_LENGTH = 52
const CHUNK_COUNT = 6
const WRAP_Z = 36

const HOUSES_PER_SIDE = 4
const BLOCKS_PER_SIDE = 3
const TREES_PER_SIDE = 3
const PINES_PER_SIDE = 1
const BUSHES_PER_SIDE = 2
const FLOWERS_PER_SIDE = 3
const LAMPS_PER_SIDE = 2
const FENCES_PER_SIDE = 2
const HEDGES_PER_SIDE = 2
const BENCHES_PER_CHUNK = 2
const SIGNS_PER_CHUNK = 2
const HILLS_PER_CHUNK = 5
/**
 * How far a tree has to stand from a billboard, in metres. A canopy that drifts
 * across the wordmark is the one thing that makes the branding look broken, and the
 * camera sits high and far behind the runner, so "beside it" is not good enough.
 */
const BILLBOARD_CLEAR = 7
/** Half-width of the billboard plane. */
const BILLBOARD_HALF_WIDTH = 2.2
/** How far a lamp post reaches towards the road, from the widest part of its base. */
const LAMP_INNER = 0.22

/**
 * Worst-case canopy radius in metres — the largest tree the generator can build at
 * the largest scale it is placed at. `scripts/billboard-check.ts` measures the real
 * generators against this number.
 */
export const TREE_CANOPY = 3.2

/**
 * Keeps a tree or pine out of a billboard's sightline. A sign is only ever hidden by
 * something *nearer the camera than the sign* — the depth buffer sorts out everything
 * behind it — so a tree in front is allowed only while its canopy still projects
 * clear of the artwork. Otherwise it is shoved behind the sign, where it can no
 * longer cross the wordmark. Exported so the sightline can be verified offline.
 */
export function clearOfBillboards(
  side: number,
  x: number,
  inner: number,
  z: number,
  worldOffset: number,
  boards: Array<{ side: number; x: number; halfWidth: number; z: number }>,
  jitter: () => number
): number {
  // The camera pulls back during a run; the far position is the harder case.
  const camZ = RUN.camDistance + 2.4
  // Chunks are laid out in their own local space and only moved into the world when
  // they are added, so distances have to be measured from the chunk's real position —
  // comparing local z would have chunk 5 sitting on top of the camera.
  const distance = (value: number): number => camZ - (value + worldOffset)
  let out = z
  for (const board of boards) {
    if (board.side !== side) continue
    if (out <= board.z - BILLBOARD_CLEAR) continue // safely behind the sign
    // z grows towards the camera, so "in front of the sign" is a *larger* z.
    const treeInner = (Math.abs(x) - inner) / distance(out)
    const signOuter = (Math.abs(board.x) + board.halfWidth) / distance(board.z)
    if (out > board.z && treeInner >= signOuter) continue
    out = board.z - BILLBOARD_CLEAR - jitter()
  }
  return out
}

interface Layer {
  mesh: THREE.InstancedMesh
  base: number
}

interface Chunk {
  group: THREE.Group
  z: number
  layers: Layer[]
}

const TOWN_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 })
const HILL_MATERIAL = new THREE.MeshStandardMaterial({ color: PALETTE.grassDark, roughness: 0.95, flatShading: true })

export class Scenery {
  readonly group = new THREE.Group()

  private chunks: Chunk[] = []
  private sky: THREE.Mesh
  private ring: THREE.Mesh
  private ringGlow: THREE.Mesh
  private clouds: { mesh: THREE.Mesh; z: number; drift: number }[] = []
  private balloons: { group: THREE.Group; z: number; phase: number; speed: number }[] = []
  private quality: QualityPreset
  private disposables: Array<{ dispose: () => void }> = []

  private billboardMat: THREE.MeshBasicMaterial | null = null

  constructor(quality: QualityPreset, brand: ArcBrand, mark: ArcMark | null, seed = 90210) {
    this.quality = quality
    const rng = makeRng(seed)

    // --- sky ----------------------------------------------------------------
    const skyTex = skyTexture()
    const skyGeo = new THREE.SphereGeometry(520, 40, 26)
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
    this.sky = new THREE.Mesh(skyGeo, skyMat)
    this.sky.position.set(0, 0, -140)
    this.group.add(this.sky)
    this.disposables.push(skyGeo, skyMat, skyTex)

    // --- clouds -------------------------------------------------------------
    const cloudTex = cloudTexture()
    const cloudGeo = new THREE.PlaneGeometry(1, 0.5)
    const cloudMat = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: 0.82,
    })
    this.disposables.push(cloudTex, cloudGeo, cloudMat)
    const cloudCount = quality.cityBlocks > 150 ? 22 : quality.cityBlocks > 90 ? 16 : 10
    for (let i = 0; i < cloudCount; i++) {
      const mesh = new THREE.Mesh(cloudGeo, cloudMat)
      const size = randRange(rng, 16, 40)
      mesh.scale.set(size, size, 1)
      mesh.position.set(randRange(rng, -220, 220), randRange(rng, 34, 120), -randRange(rng, 70, 480))
      mesh.renderOrder = -1
      this.group.add(mesh)
      this.clouds.push({ mesh, z: mesh.position.z, drift: randRange(rng, 0.4, 1.3) })
    }

    // --- the Arc ring -------------------------------------------------------
    const ringGeo = new THREE.TorusGeometry(48, 1.3, 12, 96)
    const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.coinRim, fog: false, transparent: true, opacity: 0.42 })
    this.ring = new THREE.Mesh(ringGeo, ringMat)
    this.ring.position.set(20, 70, -290)
    this.group.add(this.ring)
    this.disposables.push(ringGeo, ringMat)

    const glowTex = glowTexture('rgba(200, 240, 255, 0.75)', 'rgba(120, 200, 255, 0)')
    const ringGlowGeo = new THREE.PlaneGeometry(160, 160)
    const ringGlowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      opacity: 0.26,
    })
    this.ringGlow = new THREE.Mesh(ringGlowGeo, ringGlowMat)
    this.ringGlow.position.set(20, 70, -292)
    this.group.add(this.ringGlow)
    this.disposables.push(ringGlowGeo, ringGlowMat, glowTex)

    // --- balloons -----------------------------------------------------------
    const balloonGeo = new THREE.SphereGeometry(1, 18, 14)
    const basketGeo = new THREE.BoxGeometry(0.7, 0.5, 0.7)
    const basketMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 })
    const stripeGeo = new THREE.TorusGeometry(1.02, 0.06, 6, 18)
    const balloonColors = [0xff7f6b, 0x63c9ff, 0xffd166, 0x8be08b, 0xff8fc0, 0xb08cff]
    this.disposables.push(balloonGeo, basketGeo, basketMat, stripeGeo)
    for (let i = 0; i < 4; i++) {
      const balloon = new THREE.Group()
      const color = balloonColors[i % balloonColors.length]
      const envelopeMat = new THREE.MeshStandardMaterial({ color, roughness: 0.62 })
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0xfdfaf3, roughness: 0.6 })
      this.disposables.push(envelopeMat, stripeMat)
      const envelope = new THREE.Mesh(balloonGeo, envelopeMat)
      envelope.scale.set(2.6, 3.1, 2.6)
      envelope.castShadow = true
      balloon.add(envelope)
      for (const rot of [0, Math.PI / 2]) {
        const stripe = new THREE.Mesh(stripeGeo, stripeMat)
        stripe.rotation.y = rot
        stripe.scale.set(2.6, 3.1, 2.6)
        balloon.add(stripe)
      }
      const basket = new THREE.Mesh(basketGeo, basketMat)
      basket.position.y = -4.1
      balloon.add(basket)
      balloon.position.set(randRange(rng, -1, 1) > 0 ? randRange(rng, 34, 96) : -randRange(rng, 34, 96), randRange(rng, 22, 42), -randRange(rng, 30, 400))
      this.group.add(balloon)
      this.balloons.push({ group: balloon, z: balloon.position.z, phase: rng() * 6.28, speed: randRange(rng, 0.5, 1.1) })
    }

    // --- prototypes ---------------------------------------------------------
    const geoRng = makeRng(seed + 7717)
    const houseGeos = [0, 1, 2, 3].map(() => makeHouse(geoRng))
    const blockGeos = [0, 1, 2].map(() => makeBlock(geoRng))
    const treeGeos = [0, 1, 2].map(() => makeTree(geoRng))
    const pineGeos = [0, 1].map(() => makePine(geoRng))
    const bushGeos = [0, 1].map(() => makeBush(geoRng))
    const flowerGeo = makeFlowers(geoRng)
    const lampGeo = makeLamp()
    const fenceGeo = makeFence(geoRng)
    const hedgeGeo = makeHedge(geoRng)
    const benchGeo = makeBench()
    const signGeo = makeSign(geoRng)
    const hillGeo = new THREE.SphereGeometry(1, 16, 12)
    const billboardGeo = new THREE.PlaneGeometry(4.4, 2.2)
    const billboardMat = new THREE.MeshBasicMaterial({ map: buildWordmarkTexture(brand, mark), transparent: true })
    // A cabinet behind the artwork so the sign has depth and a back, not a paper
    // sheet with the logo mirrored through it.
    const cabinetGeo = new THREE.BoxGeometry(4.62, 2.42, 0.16)
    const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.55, metalness: 0.35 })
    this.billboardMat = billboardMat
    const postGeo = new THREE.BoxGeometry(0.22, 4.4, 0.22)
    const postMat = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: 0.6 })
    this.disposables.push(...houseGeos, ...blockGeos, ...treeGeos, ...pineGeos, ...bushGeos, flowerGeo, lampGeo, fenceGeo, hedgeGeo, benchGeo, signGeo, hillGeo, billboardGeo, billboardMat, cabinetGeo, cabinetMat, postGeo, postMat)

    const matrix = new THREE.Matrix4()
    const quat = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)

    const layer = (chunk: THREE.Group, geometry: THREE.BufferGeometry, count: number, layers: Layer[]) => {
      const mesh = new THREE.InstancedMesh(geometry, TOWN_MATERIAL, count)
      mesh.castShadow = true
      mesh.receiveShadow = false
      mesh.frustumCulled = true
      chunk.add(mesh)
      layers.push({ mesh, base: count })
      return mesh
    }

    // Billboard slots for every chunk are claimed up front, on their own random stream
    // so the rest of the town keeps its layout. The tree line overflows its chunk by a
    // few metres either way, so a tree laid down in one chunk can still end up in front
    // of the sign standing in the next one.
    const billboardPlan: Array<Array<{ side: number; x: number; halfWidth: number; z: number }>> = []
    {
      const planRng = makeRng(seed ^ 0x5eed)
      for (let c = 0; c < CHUNK_COUNT; c++) {
        const boards: Array<{ side: number; x: number; halfWidth: number; z: number }> = []
        if (c % 2 === 0) {
          for (const side of [-1, 1]) {
            boards.push({
              side,
              x: side * 8.7,
              halfWidth: BILLBOARD_HALF_WIDTH,
              z: -randRange(planRng, 6, CHUNK_LENGTH - 8),
            })
          }
        }
        billboardPlan.push(boards)
      }
    }

    for (let c = 0; c < CHUNK_COUNT; c++) {
      const chunk = new THREE.Group()
      const layers: Layer[] = []
      const billboards = billboardPlan[c]
      const worldOffset = -c * CHUNK_LENGTH

      // This chunk's signs plus its neighbours', re-expressed in this chunk's local z,
      // so the tree line is kept clear of every sign it could possibly reach.
      const nearby: Array<{ side: number; x: number; halfWidth: number; z: number }> = []
      for (let k = Math.max(0, c - 1); k <= Math.min(CHUNK_COUNT - 1, c + 1); k++) {
        for (const board of billboardPlan[k]) {
          nearby.push({ ...board, z: board.z - (k - c) * CHUNK_LENGTH })
        }
      }
      // Houses: facades turned towards the road.
      houseGeos.forEach((geo, index) => {
        const mesh = layer(chunk, geo, HOUSES_PER_SIDE * 2, layers)
        for (let i = 0; i < HOUSES_PER_SIDE; i++) {
          for (const side of [-1, 1]) {
            const slot = (i + index + c) % HOUSES_PER_SIDE
            const z = -((slot + 0.5) / HOUSES_PER_SIDE) * CHUNK_LENGTH - randRange(rng, -2.4, 2.4)
            pos.set(side * randRange(rng, 14.5, 21.5), 0, z)
            quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side > 0 ? -1 : 1) * (Math.PI / 2) + randRange(rng, -0.07, 0.07))
            const s = randRange(rng, 0.92, 1.18)
            scale.set(s, s, s)
            matrix.compose(pos, quat, scale)
            mesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), matrix)
          }
        }
      })

      // Distant skyline behind the houses.
      blockGeos.forEach((geo, index) => {
        const mesh = layer(chunk, geo, BLOCKS_PER_SIDE * 2, layers)
        for (let i = 0; i < BLOCKS_PER_SIDE; i++) {
          for (const side of [-1, 1]) {
            const slot = (i + index) % BLOCKS_PER_SIDE
            pos.set(side * randRange(rng, 46, 118), 0, -((slot + 0.5) / BLOCKS_PER_SIDE) * CHUNK_LENGTH - randRange(rng, -6, 6))
            quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), randRange(rng, -0.3, 0.3))
            const s = randRange(rng, 1, 2.1)
            scale.set(s, s, s)
            matrix.compose(pos, quat, scale)
            mesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), matrix)
          }
        }
      })

      // Trees, pines and bushes between the pavement and the houses.
      treeGeos.forEach((geo, index) => {
        const mesh = layer(chunk, geo, TREES_PER_SIDE * 2, layers)
        for (let i = 0; i < TREES_PER_SIDE; i++) {
          for (const side of [-1, 1]) {
            const treeZ = -((i + index * 0.5 + 0.5) / TREES_PER_SIDE) * CHUNK_LENGTH - randRange(rng, -5, 5)
            const treeX = side * randRange(rng, 9.6, 13.4)
            pos.set(treeX, 0, clearOfBillboards(side, treeX, TREE_CANOPY, treeZ, worldOffset, nearby, () => randRange(rng, 0, 5)))
            quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), randRange(rng, 0, 6.28))
            const s = randRange(rng, 0.85, 1.35)
            scale.set(s, s, s)
            matrix.compose(pos, quat, scale)
            mesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), matrix)
          }
        }
      })

      pineGeos.forEach((geo, index) => {
        const mesh = layer(chunk, geo, PINES_PER_SIDE * 2, layers)
        for (let i = 0; i < PINES_PER_SIDE; i++) {
          for (const side of [-1, 1]) {
            const pineZ = -((i + index + 0.35) / PINES_PER_SIDE) * CHUNK_LENGTH - randRange(rng, -8, 8)
            const pineX = side * randRange(rng, 10.5, 14.5)
            pos.set(pineX, 0, clearOfBillboards(side, pineX, TREE_CANOPY, pineZ, worldOffset, nearby, () => randRange(rng, 0, 5)))
            quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), randRange(rng, 0, 6.28))
            const s = randRange(rng, 0.9, 1.3)
            scale.set(s, s, s)
            matrix.compose(pos, quat, scale)
            mesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), matrix)
          }
        }
      })

      bushGeos.forEach((geo, index) => {
        const mesh = layer(chunk, geo, BUSHES_PER_SIDE * 2, layers)
        for (let i = 0; i < BUSHES_PER_SIDE; i++) {
          for (const side of [-1, 1]) {
            pos.set(side * randRange(rng, 8.2, 12), 0, -((i + index * 0.6 + 0.4) / BUSHES_PER_SIDE) * CHUNK_LENGTH - randRange(rng, -6, 6))
            quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), randRange(rng, 0, 6.28))
            const s = randRange(rng, 0.85, 1.3)
            scale.set(s, s, s)
            matrix.compose(pos, quat, scale)
            mesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), matrix)
          }
        }
      })

      // Flower beds along the pavement.
      {
        const mesh = layer(chunk, flowerGeo, FLOWERS_PER_SIDE * 2, layers)
        for (let i = 0; i < FLOWERS_PER_SIDE; i++) {
          for (const side of [-1, 1]) {
            pos.set(side * randRange(rng, 7.2, 8.4), 0, -((i + 0.5) / FLOWERS_PER_SIDE) * CHUNK_LENGTH - randRange(rng, -5, 5))
            quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), randRange(rng, 0, 6.28))
            scale.copy(one).multiplyScalar(randRange(rng, 0.85, 1.25))
            matrix.compose(pos, quat, scale)
            mesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), matrix)
          }
        }
      }

      // Lamp posts beside the pavement.
      {
        const mesh = layer(chunk, lampGeo, LAMPS_PER_SIDE * 2, layers)
        for (let i = 0; i < LAMPS_PER_SIDE; i++) {
          for (const side of [-1, 1]) {
            const lampZ = -((i + 0.5) / LAMPS_PER_SIDE) * CHUNK_LENGTH
            // A lamp is 4.3 m of pole with the head at the billboard's height, so a lamp
            // left standing in front of a sign runs straight through the wordmark.
            pos.set(side * 7.0, 0, clearOfBillboards(side, side * 7.0, LAMP_INNER, lampZ, worldOffset, nearby, () => randRange(rng, 0, 5)))
            quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), side > 0 ? Math.PI : 0)
            scale.copy(one)
            matrix.compose(pos, quat, scale)
            mesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), matrix)
          }
        }
      }

      // Fences and hedges marking the gardens.
      {
        const mesh = layer(chunk, fenceGeo, FENCES_PER_SIDE * 2, layers)
        for (let i = 0; i < FENCES_PER_SIDE; i++) {
          for (const side of [-1, 1]) {
            pos.set(side * 8.9, 0, -((i + 0.25) / FENCES_PER_SIDE) * CHUNK_LENGTH - randRange(rng, -3, 3))
            quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side > 0 ? -1 : 1) * (Math.PI / 2) + randRange(rng, -0.05, 0.05))
            scale.copy(one)
            matrix.compose(pos, quat, scale)
            mesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), matrix)
          }
        }
      }
      {
        const mesh = layer(chunk, hedgeGeo, HEDGES_PER_SIDE * 2, layers)
        for (let i = 0; i < HEDGES_PER_SIDE; i++) {
          for (const side of [-1, 1]) {
            pos.set(side * 9.4, 0, -((i + 0.7) / HEDGES_PER_SIDE) * CHUNK_LENGTH - randRange(rng, -4, 4))
            quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side > 0 ? -1 : 1) * (Math.PI / 2) + randRange(rng, -0.06, 0.06))
            scale.copy(one)
            matrix.compose(pos, quat, scale)
            mesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), matrix)
          }
        }
      }

      // Benches and street signs on the pavement.
      {
        const mesh = layer(chunk, benchGeo, BENCHES_PER_CHUNK, layers)
        for (let i = 0; i < BENCHES_PER_CHUNK; i++) {
          const side = i % 2 === 0 ? -1 : 1
          pos.set(side * 6.4, 0, -(i / BENCHES_PER_CHUNK) * CHUNK_LENGTH - randRange(rng, 6, 20))
          quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side > 0 ? -1 : 1) * (Math.PI / 2))
          scale.copy(one)
          matrix.compose(pos, quat, scale)
          mesh.setMatrixAt(i, matrix)
        }
      }
      {
        const mesh = layer(chunk, signGeo, SIGNS_PER_CHUNK, layers)
        for (let i = 0; i < SIGNS_PER_CHUNK; i++) {
          const side = i % 2 === 0 ? -1 : 1
          pos.set(side * 6.1, 0, -(i / SIGNS_PER_CHUNK) * CHUNK_LENGTH - randRange(rng, 4, 18))
          quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side > 0 ? -1 : 1) * (Math.PI / 2))
          scale.copy(one)
          matrix.compose(pos, quat, scale)
          mesh.setMatrixAt(i, matrix)
        }
      }

      // Rolling hills far behind the skyline.
      {
        const mesh = new THREE.InstancedMesh(hillGeo, HILL_MATERIAL, HILLS_PER_CHUNK)
        for (let i = 0; i < HILLS_PER_CHUNK; i++) {
          const side = i % 2 === 0 ? -1 : 1
          const radius = randRange(rng, 26, 58)
          pos.set(side * randRange(rng, 120, 260), -radius * 0.12, -randRange(rng, 0, CHUNK_LENGTH) - Math.floor(i / 2) * 26)
          scale.set(radius, radius * randRange(rng, 0.2, 0.36), radius)
          matrix.compose(pos, quat.identity(), scale)
          mesh.setMatrixAt(i, matrix)
        }
        chunk.add(mesh)
      }

      // Branded billboards beside the track, on the slots claimed at the top of the
      // chunk. Raised clear of the hedge line and given a post that reaches them.
      for (const board of billboards) {
        const billboard = new THREE.Mesh(billboardGeo, billboardMat)
        billboard.position.set(board.side * 8.7, 4.7, board.z)
        billboard.rotation.y = board.side > 0 ? -0.24 : 0.24
        // The post is a child of the panel so it shares its tilt, and it sits *behind*
        // the artwork: a post centred on the panel's own z pokes 0.11 m towards the
        // camera and draws a grey stripe straight down the middle of the wordmark.
        const cabinet = new THREE.Mesh(cabinetGeo, cabinetMat)
        cabinet.position.z = -0.1
        billboard.add(cabinet)
        const post = new THREE.Mesh(postGeo, postMat)
        post.scale.y = 1.28
        post.position.set(0, -1.91, -0.2)
        billboard.add(post)
        chunk.add(billboard)
      }

      chunk.position.z = -c * CHUNK_LENGTH
      this.group.add(chunk)
      this.chunks.push({ group: chunk, z: -c * CHUNK_LENGTH, layers })
    }

    this.setQuality(quality)
  }

  /** QA: parks a branded billboard in front of the camera so it can be reviewed. */
  showcaseBillboard(): THREE.Mesh | null {
    let found: THREE.Mesh | null = null
    this.group.traverse((object) => {
      if (found) return
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (materials.includes(this.billboardMat as THREE.Material)) found = mesh
    })
    const mesh = found as THREE.Mesh | null
    if (!mesh) return null
    mesh.parent?.remove(mesh)
    mesh.position.set(0, 3.2, -9.5)
    mesh.rotation.set(0, 0, 0)
    this.group.add(mesh)
    return mesh
  }

  setQuality(quality: QualityPreset): void {
    this.quality = quality
    const density = quality.cityBlocks > 150 ? 1 : quality.cityBlocks > 90 ? 0.75 : 0.5
    for (const chunk of this.chunks) {
      for (const layer of chunk.layers) {
        layer.mesh.count = Math.max(1, Math.round(layer.base * density))
      }
    }
    this.ringGlow.visible = quality.bloom
    for (let i = 0; i < this.clouds.length; i++) this.clouds[i].mesh.visible = i < quality.cityBlocks * 0.2
    for (let i = 0; i < this.balloons.length; i++) this.balloons[i].group.visible = quality.cityBlocks > 60 || i === 0
  }

  update(dt: number, speed: number, time: number): void {
    const dz = speed * dt
    const loop = CHUNK_COUNT * CHUNK_LENGTH
    for (const chunk of this.chunks) {
      chunk.z += dz
      if (chunk.z > WRAP_Z) chunk.z -= loop
      chunk.group.position.z = chunk.z
    }

    for (const cloud of this.clouds) {
      cloud.z += dz * 0.12 * cloud.drift
      if (cloud.z > 60) cloud.z -= 520
      cloud.mesh.position.z = cloud.z
    }

    for (const balloon of this.balloons) {
      balloon.z += dz * 0.3
      if (balloon.z > 50) balloon.z -= 440
      balloon.group.position.z = balloon.z
      balloon.group.position.y += Math.sin(time * balloon.speed + balloon.phase) * dt * 0.6
      balloon.group.rotation.y += dt * 0.05
    }

    this.ring.rotation.z = time * 0.05
    ;(this.ringGlow.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(time * 0.8) * 0.06
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose()
    this.group.clear()
    this.chunks.length = 0
    this.clouds.length = 0
    this.balloons.length = 0
  }
}
