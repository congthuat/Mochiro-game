// Zone dressing: the props that make each district of the run its own place.
//
// The zones (config.ts BIOMES) used to be a lighting palette and nothing else, so the
// golden hour, dusk and the neon night were the same street in a different light. This
// lays a set of district props along the road on top of that:
//
//   golden — a construction district: tower cranes on the skyline, roadwork barricades
//            with amber beacons along the kerb.
//   dusk   — a lantern street: strings of paper lanterns slung over the road between
//            the gate arches.
//   neon   — the night district: neon portal frames over the road and glowing kerb
//            strips that turn the road into a light trail.
//
// Everything is pooled and scrolls with the world. Props are spawned for the zone the
// road will be in when they arrive, so a district builds up out of the fog rather than
// popping in around the runner.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TRACK_HALF_WIDTH, zoneAt, type QualityPreset } from './config'
import { makeRng } from './utils'

type PropKind = 'crane' | 'barricade' | 'lanterns' | 'neonGate' | 'strip'

interface Prop {
  kind: PropKind
  object: THREE.Object3D
  active: boolean
}

/** How far up the road props are placed; past the near fog on every tier. */
const SPAWN_Z = -215
/** Behind the camera — the overhead pieces are big, so give them room to leave the frame. */
const DESPAWN_Z = 34
/** Arch spacing on the track (track.ts); overhead props hang halfway between two arches. */
const ARCH_SPACING = 44

/** Which zone each prop belongs to, how often it comes round (m), and how many may exist. */
const SCHEDULE: Record<PropKind, { zone: string; every: number; jitter: number; cap: number; lowCap: number }> = {
  crane: { zone: 'port', every: 62, jitter: 24, cap: 5, lowCap: 3 },
  barricade: { zone: 'port', every: 21, jitter: 10, cap: 12, lowCap: 7 },
  lanterns: { zone: 'suburb', every: ARCH_SPACING, jitter: 0, cap: 6, lowCap: 5 },
  neonGate: { zone: 'neon', every: ARCH_SPACING * 2, jitter: 0, cap: 4, lowCap: 3 },
  strip: { zone: 'neon', every: 13, jitter: 0, cap: 40, lowCap: 22 },
}

function paint(source: THREE.BufferGeometry, hex: number, offset: [number, number, number]): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source
  if (geometry !== source) source.dispose()
  geometry.translate(offset[0], offset[1], offset[2])
  const count = geometry.attributes.position.count
  const colours = new Float32Array(count * 3)
  const colour = new THREE.Color(hex)
  for (let i = 0; i < count; i++) {
    colours[i * 3] = colour.r
    colours[i * 3 + 1] = colour.g
    colours[i * 3 + 2] = colour.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return geometry
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry
  for (const part of parts) part.dispose()
  return merged
}

/** Tower crane: lattice mast, jib reaching back over the street, counterweight, cab. */
function craneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const yellow = 0xf2b632
  const height = 30
  // Mast: four legs with cross bracing every few metres.
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
    parts.push(paint(new THREE.BoxGeometry(0.22, height, 0.22), yellow, [x, height / 2, z]))
  }
  for (let y = 2; y < height; y += 3) {
    parts.push(paint(new THREE.BoxGeometry(1.6, 0.16, 0.16), yellow, [0, y, -0.7]))
    parts.push(paint(new THREE.BoxGeometry(1.6, 0.16, 0.16), yellow, [0, y, 0.7]))
    parts.push(paint(new THREE.BoxGeometry(0.16, 0.16, 1.6), yellow, [-0.7, y + 1.5, 0]))
    parts.push(paint(new THREE.BoxGeometry(0.16, 0.16, 1.6), yellow, [0.7, y + 1.5, 0]))
  }
  // Jib towards +x (the crane is mirrored for the other side of the road), counter-jib.
  parts.push(paint(new THREE.BoxGeometry(24, 0.9, 1.0), yellow, [9, height + 0.5, 0]))
  parts.push(paint(new THREE.BoxGeometry(8, 0.8, 1.0), yellow, [-5, height + 0.5, 0]))
  parts.push(paint(new THREE.BoxGeometry(2.4, 2.0, 1.6), 0x5b6170, [-7.6, height - 0.6, 0]))
  // Apex and tie bars.
  parts.push(paint(new THREE.BoxGeometry(0.6, 5, 0.6), yellow, [0, height + 3.4, 0]))
  // Cab.
  parts.push(paint(new THREE.BoxGeometry(1.8, 1.5, 1.8), 0xe8edf5, [1.4, height - 1.0, 0]))
  // Hook line and a hanging beam load.
  parts.push(paint(new THREE.BoxGeometry(0.06, 9, 0.06), 0x2b3242, [16, height - 4.2, 0]))
  parts.push(paint(new THREE.BoxGeometry(3.2, 0.5, 0.6), 0xc24a2a, [16, height - 8.9, 0]))
  // Ballast blocks at the foot.
  parts.push(paint(new THREE.BoxGeometry(3.2, 1.2, 3.2), 0x8d93a0, [0, 0.6, 0]))
  return merge(parts)
}

/** Roadwork barricade: striped boards on legs, running along the kerb. */
function barricadeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const length = 2.6
  for (const z of [-length / 2 + 0.15, length / 2 - 0.15]) {
    parts.push(paint(new THREE.BoxGeometry(0.1, 1.05, 0.1), 0xdfe5ee, [0, 0.52, z]))
    parts.push(paint(new THREE.BoxGeometry(0.6, 0.08, 0.16), 0x2b3242, [0, 0.04, z]))
  }
  // Two rails, striped orange and white in short blocks.
  for (const y of [0.62, 0.92]) {
    const stripes = 6
    for (let i = 0; i < stripes; i++) {
      const w = length / stripes
      parts.push(paint(new THREE.BoxGeometry(0.08, 0.22, w), i % 2 === 0 ? 0xff7a1a : 0xf7f9fc, [0, y, -length / 2 + w * (i + 0.5)]))
    }
  }
  return merge(parts)
}

/** Lantern string: two poles beside the road and the cable slung between them. */
function lanternFrameGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const poleX = TRACK_HALF_WIDTH + 1.8
  for (const x of [-poleX, poleX]) {
    parts.push(paint(new THREE.CylinderGeometry(0.11, 0.15, 7.9, 8), 0x4a3426, [x, 3.95, 0]))
    parts.push(paint(new THREE.BoxGeometry(0.5, 0.12, 0.12), 0x4a3426, [x - Math.sign(x) * 0.2, 7.7, 0]))
  }
  // Cable: short segments following the sag.
  const segments = 14
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments
    const t1 = (i + 1) / segments
    const x0 = -poleX + t0 * poleX * 2
    const x1 = -poleX + t1 * poleX * 2
    const y0 = lanternSag(t0)
    const y1 = lanternSag(t1)
    const len = Math.hypot(x1 - x0, y1 - y0)
    const seg = new THREE.BoxGeometry(len, 0.035, 0.035)
    seg.rotateZ(Math.atan2(y1 - y0, x1 - x0))
    parts.push(paint(seg, 0x1d1a1a, [(x0 + x1) / 2, (y0 + y1) / 2, 0]))
  }
  return merge(parts)
}

/** Height of the lantern cable `t` of the way across (0 and 1 are the poles). */
function lanternSag(t: number): number {
  return 7.65 - Math.sin(Math.PI * t) * 0.9
}

/** Neon portal: a dark steel frame over the road. The tubes are separate glowing meshes. */
function neonFrameGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const x = TRACK_HALF_WIDTH + 1.8
  for (const side of [-1, 1]) {
    parts.push(paint(new THREE.BoxGeometry(0.5, 8.8, 0.6), 0x1a1f33, [side * x, 4.4, 0]))
    parts.push(paint(new THREE.BoxGeometry(1.0, 0.3, 1.0), 0x10131f, [side * x, 0.15, 0]))
  }
  parts.push(paint(new THREE.BoxGeometry(x * 2 + 0.5, 0.55, 0.6), 0x1a1f33, [0, 8.6, 0]))
  // A sign panel in the middle of the lintel.
  parts.push(paint(new THREE.BoxGeometry(4.2, 1.3, 0.3), 0x0d1020, [0, 9.4, 0]))
  return merge(parts)
}

export class ZoneDressing {
  readonly group = new THREE.Group()

  private props: Prop[] = []
  private cursors: Record<PropKind, number> = { crane: 0, barricade: 0, lanterns: 0, neonGate: 0, strip: 0 }
  /** Where the last overhead piece was put (scrolls with the world), so one gap never gets two. */
  private lastOverhead: Record<'lanterns' | 'neonGate', number> = { lanterns: 999, neonGate: 999 }
  private side = 1
  private rng: () => number
  private low = false
  private time = 0
  private disposables: Array<{ dispose: () => void }> = []

  private propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 })
  private geometries: {
    crane: THREE.BufferGeometry
    barricade: THREE.BufferGeometry
    lanternFrame: THREE.BufferGeometry
    neonFrame: THREE.BufferGeometry
    lantern: THREE.BufferGeometry
    beacon: THREE.BufferGeometry
    tube: THREE.BoxGeometry
    strip: THREE.BoxGeometry
  }
  private lanternMats: THREE.MeshBasicMaterial[]
  private beaconMat = new THREE.MeshBasicMaterial({ color: 0xffb020, toneMapped: false })
  private neonMats: THREE.MeshBasicMaterial[]
  private stripMats: THREE.MeshBasicMaterial[]

  constructor(preset: QualityPreset, seed = 4242) {
    this.rng = makeRng(seed)
    this.geometries = {
      crane: craneGeometry(),
      barricade: barricadeGeometry(),
      lanternFrame: lanternFrameGeometry(),
      neonFrame: neonFrameGeometry(),
      lantern: new THREE.SphereGeometry(0.3, 10, 8),
      beacon: new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8),
      tube: new THREE.BoxGeometry(1, 1, 1),
      strip: new THREE.BoxGeometry(0.14, 0.05, 9),
    }
    // Lanterns, tubes and strips skip tone mapping so the bloom pass picks them up.
    const glow = (hex: number) => new THREE.MeshBasicMaterial({ color: hex, toneMapped: false })
    this.lanternMats = [glow(0xff5a3c), glow(0xffa83c), glow(0xff6fa8), glow(0xffd36b)]
    this.neonMats = [glow(0xff3df0), glow(0x2ef2ff), glow(0x8a5cff)]
    this.stripMats = [glow(0x2ef2ff), glow(0xff3df0)]
    this.disposables.push(
      ...Object.values(this.geometries),
      this.propMat,
      this.beaconMat,
      ...this.lanternMats,
      ...this.neonMats,
      ...this.stripMats
    )
    this.setQuality(preset)
    this.reset()
  }

  setQuality(preset: QualityPreset): void {
    this.low = !preset.bloom
  }

  /** Clears the road for a fresh run. */
  reset(): void {
    for (const prop of this.props) {
      prop.active = false
      prop.object.visible = false
    }
    this.cursors = { crane: 20, barricade: 0, lanterns: 0, neonGate: 0, strip: 0 }
    this.lastOverhead = { lanterns: 999, neonGate: 999 }
  }

  /**
   * Scrolls the props and lays new ones for the district the road will be in when they
   * arrive. `archPhase` is any gate arch's z, so overhead pieces sit between arches.
   */
  update(dt: number, speed: number, distance: number, archPhase: number): void {
    const dz = speed * dt
    this.time += dt
    for (const prop of this.props) {
      if (!prop.active) continue
      prop.object.position.z += dz
      if (prop.object.position.z > DESPAWN_Z) {
        prop.active = false
        prop.object.visible = false
      }
    }
    this.lastOverhead.lanterns += dz
    this.lastOverhead.neonGate += dz

    // Lanterns sway; beacons blink; the neon breathes.
    const sway = Math.sin(this.time * 1.3) * 0.05
    const beaconOn = Math.floor(this.time * 2.2) % 2 === 0
    this.beaconMat.color.setHex(beaconOn ? 0xffb020 : 0x4a2a08)
    const breathe = 0.8 + 0.2 * Math.sin(this.time * 3.1)
    this.neonMats[0].color.setRGB(1 * breathe, 0.24 * breathe, 0.94 * breathe)
    for (const prop of this.props) {
      if (prop.active && prop.kind === 'lanterns') prop.object.rotation.x = sway
    }

    // The zone the road will be in when a prop placed at SPAWN_Z reaches the runner.
    const zone = zoneAt(distance - SPAWN_Z)
    for (const kind of Object.keys(SCHEDULE) as PropKind[]) {
      const plan = SCHEDULE[kind]
      this.cursors[kind] -= dz
      if (this.cursors[kind] > 0) continue
      if (plan.zone !== zone) {
        this.cursors[kind] = 8
        continue
      }
      // The low tier gets half as many kerb strips, so its smaller pool never runs dry.
      const every = kind === 'strip' && this.low ? plan.every * 2 : plan.every
      this.cursors[kind] = every + (plan.jitter ? (this.rng() - 0.5) * plan.jitter : 0)
      this.spawn(kind, archPhase)
    }
  }

  private spawn(kind: PropKind, archPhase: number): void {
    let z = SPAWN_Z
    if (kind === 'lanterns' || kind === 'neonGate') {
      // Halfway between two arches, at the first such spot at or beyond SPAWN_Z.
      const mid = archPhase + ARCH_SPACING / 2
      const offset = (((SPAWN_Z - mid) % ARCH_SPACING) + ARCH_SPACING) % ARCH_SPACING
      z = SPAWN_Z - offset
      if (Math.abs(this.lastOverhead[kind] - z) < ARCH_SPACING * 0.6) return
      this.lastOverhead[kind] = z
    }
    if (kind === 'strip') {
      // Both kerbs, one strip each, colours alternating along the road.
      const colour = Math.floor(this.time * 7) % 2
      for (const side of [-1, 1]) {
        const strip = this.acquire('strip')
        if (!strip) return
        const mesh = strip.object as THREE.Mesh
        mesh.material = this.stripMats[(colour + (side > 0 ? 1 : 0)) % 2]
        strip.object.position.set(side * (TRACK_HALF_WIDTH + 0.2), 0.03, z)
      }
      return
    }
    const prop = this.acquire(kind)
    if (!prop) return
    const object = prop.object
    object.rotation.set(0, 0, 0)
    object.scale.set(1, 1, 1)
    if (kind === 'crane') {
      // Far out on the skyline, jib reaching back over the street.
      this.side = -this.side
      const side = this.side
      // Behind the district's front row (districts.ts), so the mast never stands in a building.
      object.position.set(side * (31 + this.rng() * 7), 0, z)
      object.scale.set(-side, 1, 1)
      object.rotation.y = (this.rng() - 0.5) * 0.6
    } else if (kind === 'barricade') {
      const side = this.rng() < 0.5 ? -1 : 1
      object.position.set(side * (TRACK_HALF_WIDTH + 0.75), 0, z)
    } else {
      object.position.set(0, 0, z)
    }
  }

  private acquire(kind: PropKind): Prop | null {
    for (const prop of this.props) {
      if (!prop.active && prop.kind === kind) {
        prop.active = true
        prop.object.visible = true
        return prop
      }
    }
    const plan = SCHEDULE[kind]
    const count = this.props.reduce((sum, prop) => sum + (prop.kind === kind ? 1 : 0), 0)
    if (count >= (this.low ? plan.lowCap : plan.cap)) return null
    const prop: Prop = { kind, object: this.build(kind), active: true }
    this.props.push(prop)
    this.group.add(prop.object)
    return prop
  }

  private build(kind: PropKind): THREE.Object3D {
    const g = this.geometries
    if (kind === 'crane') return new THREE.Mesh(g.crane, this.propMat)
    if (kind === 'strip') return new THREE.Mesh(g.strip, this.stripMats[0])
    if (kind === 'barricade') {
      const root = new THREE.Group()
      root.add(new THREE.Mesh(g.barricade, this.propMat))
      for (const z of [-1.15, 1.15]) {
        const beacon = new THREE.Mesh(g.beacon, this.beaconMat)
        beacon.position.set(0, 1.13, z)
        root.add(beacon)
      }
      return root
    }
    if (kind === 'lanterns') {
      const root = new THREE.Group()
      root.add(new THREE.Mesh(g.lanternFrame, this.propMat))
      const poleX = TRACK_HALF_WIDTH + 1.8
      const count = 9
      for (let i = 1; i <= count; i++) {
        const t = i / (count + 1)
        const lantern = new THREE.Mesh(g.lantern, this.lanternMats[i % this.lanternMats.length])
        lantern.position.set(-poleX + t * poleX * 2, lanternSag(t) - 0.42, 0)
        lantern.scale.set(1, 1.25, 1)
        root.add(lantern)
      }
      return root
    }
    // Neon portal: frame plus glowing tubes along its inner edges and a sign bar.
    const root = new THREE.Group()
    root.add(new THREE.Mesh(g.neonFrame, this.propMat))
    const x = TRACK_HALF_WIDTH + 1.8
    const tube = (mat: THREE.Material, px: number, py: number, sx: number, sy: number) => {
      const mesh = new THREE.Mesh(g.tube, mat)
      mesh.position.set(px, py, 0.34)
      mesh.scale.set(sx, sy, 0.1)
      root.add(mesh)
    }
    tube(this.neonMats[0], -x + 0.3, 4.3, 0.1, 7.9)
    tube(this.neonMats[0], x - 0.3, 4.3, 0.1, 7.9)
    tube(this.neonMats[1], 0, 8.28, x * 2 - 0.4, 0.1)
    tube(this.neonMats[1], 0, 9.4, 3.6, 0.16)
    tube(this.neonMats[2], 0, 9.8, 2.6, 0.08)
    tube(this.neonMats[2], 0, 9.0, 2.6, 0.08)
    return root
  }

  setVisible(on: boolean): void {
    this.group.visible = on
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose()
    this.group.clear()
    this.props.length = 0
  }
}
