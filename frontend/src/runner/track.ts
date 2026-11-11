// The track: a daylit road with white lane markers, black/white kerbs, cone
// markers and colourful gate arches. Everything recycles around the runner.
import * as THREE from 'three'
import { LANES, PALETTE, RUN, TRACK_HALF_WIDTH, type QualityPreset } from './config'
import { roadTexture } from './textures'
import { makeRng, randRange } from './utils'

// Reused scratch objects — the update loop runs every frame.
const SCRATCH_MATRIX = new THREE.Matrix4()
const SCRATCH_QUAT = new THREE.Quaternion()
const SCRATCH_POS = new THREE.Vector3()
const SCRATCH_SCALE = new THREE.Vector3()

const ROAD_LENGTH = 320
const ROAD_REPEAT = 40
const TILE = ROAD_LENGTH / ROAD_REPEAT

const DASH_SPACING = 7
const DASH_COUNT = 40 // per divider
const ARCH_SPACING = 44
const CONE_SPACING = 13
const CONE_PER_SIDE = 22

const ARCH_COLORS = [0x2f7fe0, 0xff7fb0, 0xffb347, 0x5cc8ff]

export class Track {
  readonly group = new THREE.Group()

  private floor: THREE.Mesh
  private roadTex: THREE.CanvasTexture
  private dashes: THREE.InstancedMesh
  private dashZ: Float32Array
  private cones: THREE.InstancedMesh
  private coneZ: Float32Array
  private coneScale: Float32Array
  private slabs: THREE.InstancedMesh
  private slabZ: Float32Array
  private arches: THREE.Group[] = []
  private archBeams: THREE.MeshStandardMaterial[] = []
  private quality: QualityPreset
  private rng: () => number
  private disposables: Array<{ dispose: () => void }> = []

  constructor(quality: QualityPreset, seed = 1337) {
    this.quality = quality
    this.rng = makeRng(seed)

    // --- ground -------------------------------------------------------------
    const groundGeo = new THREE.PlaneGeometry(420, ROAD_LENGTH + 60)
    const groundMat = new THREE.MeshStandardMaterial({ color: PALETTE.grass, roughness: 0.95, metalness: 0 })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.set(0, -0.34, -ROAD_LENGTH / 2 + 20)
    ground.receiveShadow = true
    this.group.add(ground)
    this.disposables.push(groundGeo, groundMat)

    // --- road surface -------------------------------------------------------
    this.roadTex = roadTexture()
    const roadMat = new THREE.MeshStandardMaterial({
      map: this.roadTex,
      roughness: 0.88,
      metalness: 0.02,
      color: 0xffffff,
    })
    const roadGeo = new THREE.PlaneGeometry(9.6, ROAD_LENGTH)
    this.floor = new THREE.Mesh(roadGeo, roadMat)
    this.floor.rotation.x = -Math.PI / 2
    this.floor.position.z = -ROAD_LENGTH / 2 + 20
    this.floor.receiveShadow = true
    this.group.add(this.floor)
    this.disposables.push(roadGeo, roadMat, this.roadTex)

    // --- lane dashes --------------------------------------------------------
    // There used to be a translucent 2.05 × 26 m "lane guide" slab here that slid
    // under the runner's feet. Against the old pale-grey surface it was invisible;
    // against real asphalt it read as a long pink rectangle dragging along under the
    // character. The road now has proper white lane markings, which do the same job
    // properly, so the slab is gone.
    const dashGeo = new THREE.BoxGeometry(0.17, 0.05, 2.6)
    const dashMat = new THREE.MeshStandardMaterial({ color: PALETTE.grid, roughness: 0.7 })
    this.dashZ = new Float32Array(DASH_COUNT * 2)
    this.dashes = new THREE.InstancedMesh(dashGeo, dashMat, DASH_COUNT * 2)
    this.dashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.dashes.frustumCulled = false
    for (let i = 0; i < DASH_COUNT * 2; i++) {
      this.dashZ[i] = 20 - (i % DASH_COUNT) * DASH_SPACING
      this.writeDash(i)
    }
    this.group.add(this.dashes)
    this.disposables.push(dashGeo, dashMat)

    // --- kerbs --------------------------------------------------------------
    // Laid as individual stones. A single 320 m box of near-white concrete turns
    // into one endless bright stripe once it streaks past the camera, which
    // reads as a rendering fault — so the kerb is built from stone-sized pieces
    // with alternating shades instead.
    const KERB_SPAN = 1.7
    const KERB_COUNT = Math.ceil(ROAD_LENGTH / KERB_SPAN)
    const kerbGeo = new THREE.BoxGeometry(0.42, 0.22, KERB_SPAN * 0.99)
    const kerbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.74, metalness: 0.03 })
    const kerbCapGeo = new THREE.BoxGeometry(0.46, 0.09, KERB_SPAN * 0.99)
    const kerbCapMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.03 })
    const kerbStones = new THREE.InstancedMesh(kerbGeo, kerbMat, KERB_COUNT * 2)
    const kerbCaps = new THREE.InstancedMesh(kerbCapGeo, kerbCapMat, KERB_COUNT * 2)
    const kerbMatrix = new THREE.Matrix4()
    const stoneTint = new THREE.Color()
    const capTint = new THREE.Color()
    let stoneIndex = 0
    for (const side of [-1, 1]) {
      for (let i = 0; i < KERB_COUNT; i++) {
        const z = 20 - i * KERB_SPAN
        const x = side * (TRACK_HALF_WIDTH + 0.24)
        const lift = (Math.random() - 0.5) * 0.015
        kerbMatrix.makeTranslation(x, 0.1 + lift, z)
        kerbStones.setMatrixAt(stoneIndex, kerbMatrix)
        // Alternating light/worn concrete so the run of stones never blurs into
        // a single white line.
        stoneTint.setHSL(0.09, 0.06, i % 2 === 0 ? 0.68 : 0.58)
        kerbStones.setColorAt(stoneIndex, stoneTint)
        kerbMatrix.makeTranslation(x, 0.24 + lift, z)
        kerbCaps.setMatrixAt(stoneIndex, kerbMatrix)
        // Black / white caps: the road edge reads as a painted line rather than a
        // second row of pale concrete.
        capTint.setHSL(0, 0, i % 2 === 0 ? 0.09 : 0.84)
        kerbCaps.setColorAt(stoneIndex, capTint)
        stoneIndex++
      }
    }
    kerbStones.instanceMatrix.needsUpdate = true
    kerbCaps.instanceMatrix.needsUpdate = true
    this.group.add(kerbStones, kerbCaps)
    this.disposables.push(kerbGeo, kerbMat, kerbCapGeo, kerbCapMat)

    // --- pavement -----------------------------------------------------------
    // A proper pavement (kerb + slabs + a garden strip) is what makes the street
    // read as a real road instead of a ribbon floating on grass.
    const walkGeo = new THREE.BoxGeometry(2.4, 0.3, ROAD_LENGTH)
    const walkMat = new THREE.MeshStandardMaterial({ color: 0xcfcabd, roughness: 0.94, metalness: 0 })
    const edgeGeo = new THREE.BoxGeometry(0.16, 0.34, ROAD_LENGTH)
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xb2ada1, roughness: 0.94 })
    const slabGeo = new THREE.BoxGeometry(0.06, 0.02, 2.2)
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xa9a496, roughness: 0.96 })
    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(walkGeo, walkMat)
      walk.position.set(side * (TRACK_HALF_WIDTH + 1.6), 0.15, -ROAD_LENGTH / 2 + 20)
      walk.receiveShadow = true
      this.group.add(walk)

      const edge = new THREE.Mesh(edgeGeo, edgeMat)
      edge.position.set(side * (TRACK_HALF_WIDTH + 0.34), 0.17, -ROAD_LENGTH / 2 + 20)
      this.group.add(edge)
    }
    this.disposables.push(walkGeo, walkMat, edgeGeo, edgeMat)

    // Paving joints, recycled like the lane dashes.
    const slabs = new THREE.InstancedMesh(slabGeo, slabMat, 70)
    slabs.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    slabs.frustumCulled = false
    this.slabs = slabs
    this.slabZ = new Float32Array(70)
    for (let i = 0; i < 70; i++) {
      this.slabZ[i] = 20 - (i % 35) * (ROAD_LENGTH / 35)
      this.writeSlab(i)
    }
    this.group.add(slabs)
    this.disposables.push(slabGeo, slabMat)

    // --- roadside cones -----------------------------------------------------
    const coneGeo = new THREE.ConeGeometry(0.32, 0.9, 12)
    const coneMat = new THREE.MeshStandardMaterial({ color: PALETTE.hazard, roughness: 0.6 })
    this.cones = new THREE.InstancedMesh(coneGeo, coneMat, CONE_PER_SIDE * 2)
    this.cones.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.cones.frustumCulled = false
    this.coneZ = new Float32Array(CONE_PER_SIDE * 2)
    this.coneScale = new Float32Array(CONE_PER_SIDE * 2)
    for (let i = 0; i < CONE_PER_SIDE * 2; i++) {
      this.coneZ[i] = 20 - (i % CONE_PER_SIDE) * CONE_SPACING
      this.coneScale[i] = randRange(this.rng, 0.85, 1.25)
      this.writeCone(i)
    }
    this.group.add(this.cones)
    this.disposables.push(coneGeo, coneMat)

    // --- gate arches --------------------------------------------------------
    const pillarGeo = new THREE.BoxGeometry(0.55, 6.4, 0.55)
    const beamGeo = new THREE.BoxGeometry(11.6, 0.5, 0.8)
    const glowGeo = new THREE.BoxGeometry(11.6, 0.12, 0.2)
    const signGeo = new THREE.BoxGeometry(2.6, 0.9, 0.12)
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xf6faff, roughness: 0.55, metalness: 0.1 })
    const signMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.08 })
    this.disposables.push(pillarGeo, beamGeo, glowGeo, signGeo, pillarMat, signMat)
    for (let i = 0; i < 6; i++) {
      const arch = new THREE.Group()
      const hue = ARCH_COLORS[i % ARCH_COLORS.length]
      const beamMat = new THREE.MeshStandardMaterial({ color: hue, roughness: 0.5, metalness: 0.1 })
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat)
        pillar.position.set(side * (TRACK_HALF_WIDTH + 1.1), 3.2, 0)
        pillar.castShadow = true
        arch.add(pillar)
      }
      const beam = new THREE.Mesh(beamGeo, beamMat)
      beam.position.set(0, 6.35, 0)
      arch.add(beam)
      const glow = new THREE.Mesh(glowGeo, glowMat)
      glow.position.set(0, 6.06, 0.2)
      arch.add(glow)
      const sign = new THREE.Mesh(signGeo, signMat)
      sign.position.set(0, 5.4, 0.1)
      arch.add(sign)
      arch.position.z = -18 - i * ARCH_SPACING
      this.group.add(arch)
      this.arches.push(arch)
      this.archBeams.push(beamMat)
      this.disposables.push(beamMat, glowMat)
    }
    this.setQuality(quality)
  }

  setQuality(quality: QualityPreset): void {
    this.quality = quality
    this.dashes.count = Math.min(DASH_COUNT * 2, quality.cityBlocks > 100 ? DASH_COUNT * 2 : 56)
    this.cones.count = Math.min(CONE_PER_SIDE * 2, quality.cityBlocks > 100 ? CONE_PER_SIDE * 2 : 28)
    this.arches.forEach((arch, index) => {
      arch.visible = index < quality.arches
    })
  }

  update(dt: number, speed: number, time: number): void {
    const dz = speed * dt
    this.roadTex.offset.y += dz / TILE

    const dashLoop = DASH_COUNT * DASH_SPACING
    for (let i = 0; i < this.dashes.count; i++) {
      let z = this.dashZ[i] + dz
      if (z > RUN.despawnZ) z -= dashLoop
      this.dashZ[i] = z
      this.writeDash(i)
    }
    this.dashes.instanceMatrix.needsUpdate = true

    const slabLoop = 35 * (ROAD_LENGTH / 35)
    for (let i = 0; i < this.slabs.count; i++) {
      let z = this.slabZ[i] + dz
      if (z > RUN.despawnZ) z -= slabLoop
      this.slabZ[i] = z
      this.writeSlab(i)
    }
    this.slabs.instanceMatrix.needsUpdate = true

    const coneLoop = CONE_PER_SIDE * CONE_SPACING
    for (let i = 0; i < this.cones.count; i++) {
      let z = this.coneZ[i] + dz
      if (z > RUN.despawnZ) z -= coneLoop
      this.coneZ[i] = z
      this.writeCone(i)
    }
    this.cones.instanceMatrix.needsUpdate = true

    const archLoop = this.arches.length * ARCH_SPACING
    for (const arch of this.arches) {
      arch.position.z += dz
      if (arch.position.z > RUN.despawnZ + 6) arch.position.z -= archLoop
    }
  }

  private writeDash(index: number): void {
    const side = index < DASH_COUNT ? -1 : 1
    const x = side * (LANES[1] - LANES[0]) * 0.5
    SCRATCH_MATRIX.makeTranslation(x, 0.05, this.dashZ[index])
    this.dashes.setMatrixAt(index, SCRATCH_MATRIX)
  }

  private writeSlab(index: number): void {
    const side = index < 35 ? -1 : 1
    SCRATCH_POS.set(side * (TRACK_HALF_WIDTH + 1.6), 0.31, this.slabZ[index])
    SCRATCH_SCALE.set(1, 1, 1)
    SCRATCH_MATRIX.compose(SCRATCH_POS, SCRATCH_QUAT, SCRATCH_SCALE)
    this.slabs.setMatrixAt(index, SCRATCH_MATRIX)
  }

  private writeCone(index: number): void {
    const side = index < CONE_PER_SIDE ? -1 : 1
    const x = side * (TRACK_HALF_WIDTH - 0.45)
    const scale = this.coneScale[index]
    SCRATCH_POS.set(x, (0.9 * scale) / 2, this.coneZ[index])
    SCRATCH_SCALE.set(scale, scale, scale)
    SCRATCH_MATRIX.compose(SCRATCH_POS, SCRATCH_QUAT, SCRATCH_SCALE)
    this.cones.setMatrixAt(index, SCRATCH_MATRIX)
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose()
    this.group.clear()
    this.arches.length = 0
    this.archBeams.length = 0
  }
}
