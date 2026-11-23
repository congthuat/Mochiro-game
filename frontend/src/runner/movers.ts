// Moving obstacles ("movers"): the set pieces that do something while you run at them.
//
//   roller    barrels (harbour), round hay bales (farm), hopping jack-o'-lanterns (haunted)
//             rolling down the lane at you — jump them or change lane.
//   snowball  rolls at you and grows as it comes; by the last stretch it is too tall to
//             jump, so it is a dodge you have to read early.
//   slider    a low barrier gliding between two lanes on a fixed beat — time it, hop it,
//             or take the third lane, which it never reaches.
//   crossing  a level-crossing half barrier over two lanes, red lamps and a bell before
//             it drops. Run under while it is up, slide under while it is down.
//   pendulum  a log / paper lantern / caged pumpkin swinging across two lanes from a
//             frame over the road. Its lowest point is the slide-gate height.
//   rockfall  a warning ring on the road; a second before you get there a boulder (or an
//             ice chunk) drops onto it and stays as a wall.
//   sweeper   a neon laser that slides up and down its posts: jump it low, slide it in
//             the middle, run under it high.
//   hauler    a slow tractor / market cart driving away from you. Its canopy is a roof
//             you can jump onto for the coins over it.
//
// Fairness is designed in, not tested in: every mover leaves at least one lane it never
// enters, moves on a fixed beat, and is collided with by exactly the pose it is drawn in
// — `stepMover` computes the pose once a frame, the rig is posed from it and
// `moverBox` tests the runner against the same numbers (scripts/mover-fit.ts checks
// the drawn parts against those boxes over whole cycles).
import * as THREE from 'three'
import { LANES, type ObstacleSpec } from './config'
import {
  barrel,
  box,
  crate,
  cyl,
  finish,
  merge,
  prop,
  rbox,
  slab,
  turned,
  type PropMap,
  type SkinGeo as Geo,
  type SkinV3 as V3,
  type Theme,
} from './obstacleSkins'

export type MoverType = 'roller' | 'snowball' | 'slider' | 'crossing' | 'pendulum' | 'rockfall' | 'sweeper' | 'hauler'
export const MOVER_TYPES: MoverType[] = ['roller', 'snowball', 'slider', 'crossing', 'pendulum', 'rockfall', 'sweeper', 'hauler']

export type MoverLook =
  | 'barrel'
  | 'hay'
  | 'pumpkin'
  | 'snow'
  | 'sawhorse'
  | 'hover'
  | 'rail'
  | 'railwood'
  | 'log'
  | 'lantern'
  | 'ghost'
  | 'boulder'
  | 'redrock'
  | 'icicle'
  | 'laser'
  | 'tractor'
  | 'cart'

/** Each type's looks, and which look a theme (or zone) gets. The first is the default. */
export const MOVER_LOOKS: Record<MoverType, MoverLook[]> = {
  roller: ['barrel', 'hay', 'pumpkin'],
  snowball: ['snow'],
  slider: ['sawhorse', 'hover'],
  crossing: ['rail', 'railwood'],
  pendulum: ['log', 'lantern', 'ghost'],
  rockfall: ['boulder', 'redrock', 'icicle'],
  sweeper: ['laser'],
  hauler: ['tractor', 'cart'],
}

export function lookFor(type: MoverType, theme: Theme, zone: string): MoverLook {
  switch (type) {
    case 'roller':
      return theme === 'farm' ? 'hay' : theme === 'haunted' ? 'pumpkin' : 'barrel'
    case 'slider':
      return theme === 'future' ? 'hover' : 'sawhorse'
    case 'crossing':
      return theme === 'farm' ? 'railwood' : 'rail'
    case 'pendulum':
      return theme === 'asian' ? 'lantern' : theme === 'haunted' ? 'ghost' : 'log'
    case 'rockfall':
      return theme === 'ice' ? 'icicle' : zone === 'redcanyon' || zone === 'volcano' ? 'redrock' : 'boulder'
    case 'hauler':
      return theme === 'asian' ? 'cart' : 'tractor'
    default:
      return MOVER_LOOKS[type][0]
  }
}

// ---------------------------------------------------------------------------------
// Tuning. Every number a player has to learn lives here.

const HALF_LANE = (LANES[1] - LANES[0]) / 2

export const ROLLER = {
  /** Own speed down the road towards the runner, m/s. */
  speed: 6,
  radius: 0.45,
  width: { barrel: 1.45, hay: 1.45, pumpkin: 1.05 } as Record<string, number>,
  /** The pumpkins hop instead of rolling (they keep their faces on you). */
  hop: 0.32,
  hopPeriod: 0.62,
}

export const SNOWBALL = {
  speed: 5,
  r0: 0.45,
  rMax: 1.3,
  /** Full size from this far out: the last stretch is always the un-jumpable one. */
  fullAt: -26,
}

export const SLIDER = { period: 2.6, width: 2.0, height: 0.92, depth: 0.7 }

export const CROSSING = {
  /** Seconds: down, rising, up, lowering. Lamps flash `warn` s before it lowers. */
  down: 1.3,
  rise: 0.45,
  up: 1.4,
  lower: 0.45,
  warn: 0.8,
  pivotX: 3.75,
  pivotY: 1.38,
  length: 5.1,
  thick: 0.24,
  upAngle: (82 * Math.PI) / 180,
  depth: 0.3,
}
export const CROSSING_PERIOD = CROSSING.down + CROSSING.rise + CROSSING.up + CROSSING.lower

export const PENDULUM = {
  period: 2.8,
  pivotY: 7.0,
  /** Bob sizes (x, y, z); its lowest point is the slide-gate clearance. */
  bob: {
    log: [1.04, 1.04, 1.06],
    lantern: [1.0, 1.1, 1.0],
    ghost: [1.0, 1.0, 1.0],
  } as Record<string, V3>,
  /** Round bobs (a log seen end-on) have the same box at every angle. */
  round: { log: true } as Record<string, boolean>,
  clearance: 1.25,
}

export const ROCKFALL = {
  width: 1.9,
  height: 2.3,
  depth: 1.4,
  /** Starts to fall this many seconds before it would reach the runner. */
  lead: 1.25,
  fall: 0.5,
  from: 15,
}

export const SWEEPER = { period: 2.4, low: 0.3, high: 2.35, thick: 0.12, width: 2.0, depth: 0.4 }

export const HAULER = {
  /** Own speed *away* from the runner, m/s — it is overtaken, never met head-on. */
  speed: 3.5,
  width: 2.0,
  height: 1.45,
  depth: 7.4,
}

/** Collision depth per type (the reach window along the road). */
export const MOVER_DEPTH: Record<MoverType, number> = {
  roller: 0.9,
  snowball: SNOWBALL.rMax * 2 * 0.9,
  slider: SLIDER.depth,
  crossing: CROSSING.depth,
  pendulum: 1.06,
  rockfall: ROCKFALL.depth,
  sweeper: SWEEPER.depth,
  hauler: HAULER.depth,
}

/**
 * The obstacle spec each type is spawned with: its reach along the road, the footprint
 * the blob shadow and the roof test use, and the boost-smash points. The live collision
 * box comes from `moverBox`.
 */
export const MOVER_SPECS: Record<MoverType, ObstacleSpec> = {
  roller: { kind: 'mover', width: 1.45, height: ROLLER.radius * 2, bottom: 0, depth: MOVER_DEPTH.roller, points: 50 },
  snowball: { kind: 'mover', width: SNOWBALL.rMax * 2 * 0.86, height: SNOWBALL.rMax * 2 * 0.94, bottom: 0, depth: MOVER_DEPTH.snowball, points: 70 },
  slider: { kind: 'mover', width: SLIDER.width, height: SLIDER.height, bottom: 0, depth: MOVER_DEPTH.slider, points: 45 },
  crossing: { kind: 'mover', width: CROSSING.length, height: 0.3, bottom: CROSSING.pivotY, depth: MOVER_DEPTH.crossing, points: 60 },
  pendulum: { kind: 'mover', width: 1.1, height: 1.1, bottom: PENDULUM.clearance, depth: MOVER_DEPTH.pendulum, points: 60 },
  rockfall: { kind: 'mover', width: ROCKFALL.width, height: ROCKFALL.height, bottom: 0, depth: MOVER_DEPTH.rockfall, points: 70 },
  sweeper: { kind: 'mover', width: SWEEPER.width, height: SWEEPER.thick, bottom: SWEEPER.low, depth: MOVER_DEPTH.sweeper, points: 50 },
  hauler: { kind: 'mover', width: HAULER.width, height: HAULER.height, bottom: 0, depth: MOVER_DEPTH.hauler, points: 90, platformTop: HAULER.height },
}

/** Close calls past a mover pay from a little further out than a parked hazard. */
export const MOVER_NEAR_MISS = 0.5

// ---------------------------------------------------------------------------------
// State and pose.

export interface MoverState {
  type: MoverType
  look: MoverLook
  /** Lanes it works over: one for most, the two it swings / slides / bars across. */
  lanes: number[]
  /** Crossing: which kerb the barrier is hinged on (+1 right, -1 left). */
  side: 1 | -1
  /** Seconds into its cycle at t = 0. */
  phase: number
  /** Where it was spawned (the snowball grows with the distance it has rolled). */
  z0: number
  /** Live pose, recomputed every frame by `stepMover`. */
  x: number
  y: number
  angle: number
  size: number
  /** Rockfall: -1 waiting on the warning ring, 0…1 falling, 1 down. */
  drop: number
  lamp: boolean
  /** Crossing: the lamps came on this frame (the bell rings). */
  warned: boolean
  /** Rockfall: it hit the road this frame. */
  landed: boolean
}

export function createMover(type: MoverType, look: MoverLook, lanes: number[], z: number, side: 1 | -1 = 1, phase = 0): MoverState {
  const state: MoverState = {
    type,
    look,
    lanes,
    side,
    phase,
    z0: z,
    x: LANES[lanes[0]],
    y: 0,
    angle: 0,
    size: type === 'snowball' ? SNOWBALL.r0 : 1,
    drop: -1,
    lamp: false,
    warned: false,
    landed: false,
  }
  return state
}

const smooth = (t: number): number => {
  const k = Math.min(1, Math.max(0, t))
  return k * k * (3 - 2 * k)
}

/** Middle of the lanes it spans. */
export const moverMid = (m: MoverState): number =>
  m.lanes.reduce((sum, lane) => sum + LANES[lane], 0) / Math.max(1, m.lanes.length)

/** Pendulum string length for a look: the bob's lowest point sits at the clearance. */
export const pendulumLength = (look: MoverLook): number => {
  const bob = PENDULUM.bob[look] ?? PENDULUM.bob.log
  return PENDULUM.pivotY - (PENDULUM.clearance + bob[1] / 2)
}

/** Crossing boom angle (0 = down across the road) and lamp state at cycle time `u`. */
export function crossingAt(u: number): { angle: number; lamp: boolean } {
  const c = CROSSING
  const t = ((u % CROSSING_PERIOD) + CROSSING_PERIOD) % CROSSING_PERIOD
  let k: number
  if (t < c.down) k = 0
  else if (t < c.down + c.rise) k = smooth((t - c.down) / c.rise)
  else if (t < c.down + c.rise + c.up) k = 1
  else k = 1 - smooth((t - c.down - c.rise - c.up) / c.lower)
  const lowersAt = c.down + c.rise + c.up
  // Flashing from `warn` before it lowers until it has finished rising.
  const lamp = t < c.down + c.rise || t >= lowersAt - c.warn
  return { angle: k * c.upAngle, lamp }
}

/**
 * Advances a mover's pose. `time` is the manager clock, `z` the obstacle's distance up
 * the road (negative ahead of the runner), `speed` the world scroll in m/s.
 */
export function stepMover(m: MoverState, time: number, dt: number, z: number, speed: number): void {
  const t = time + m.phase
  m.warned = false
  m.landed = false
  switch (m.type) {
    case 'roller': {
      m.x = LANES[m.lanes[0]]
      if (m.look === 'pumpkin') {
        const hop = Math.abs(Math.sin((Math.PI * t) / ROLLER.hopPeriod))
        m.y = hop * ROLLER.hop
        m.angle = Math.sin((Math.PI * 2 * t) / ROLLER.hopPeriod) * 0.22
      } else {
        m.y = 0
        m.angle += (ROLLER.speed * dt) / ROLLER.radius
      }
      break
    }
    case 'snowball': {
      m.x = LANES[m.lanes[0]]
      const span = SNOWBALL.fullAt - m.z0
      const k = span > 0 ? Math.min(1, Math.max(0, (z - m.z0) / span)) : 1
      m.size = SNOWBALL.r0 + (SNOWBALL.rMax - SNOWBALL.r0) * k
      m.y = 0
      m.angle += (SNOWBALL.speed * dt) / m.size
      break
    }
    case 'slider': {
      const swing = Math.max(-1, Math.min(1, 1.35 * Math.sin((Math.PI * 2 * t) / SLIDER.period)))
      m.x = moverMid(m) + swing * HALF_LANE
      m.y = 0
      break
    }
    case 'crossing': {
      const pose = crossingAt(t)
      if (pose.lamp && !m.lamp) m.warned = true
      m.angle = pose.angle
      m.lamp = pose.lamp
      m.x = m.side * CROSSING.pivotX
      break
    }
    case 'pendulum': {
      const length = pendulumLength(m.look)
      const max = Math.asin(Math.min(0.95, HALF_LANE / length))
      m.angle = max * Math.sin((Math.PI * 2 * t) / PENDULUM.period)
      m.x = moverMid(m) + length * Math.sin(m.angle)
      m.y = PENDULUM.pivotY - length * Math.cos(m.angle)
      break
    }
    case 'rockfall': {
      m.x = LANES[m.lanes[0]]
      if (m.drop < 0 && z > -Math.max(8, speed) * ROCKFALL.lead) m.drop = 0
      if (m.drop >= 0 && m.drop < 1) {
        m.drop = Math.min(1, m.drop + dt / ROCKFALL.fall)
        if (m.drop >= 1) m.landed = true
      }
      m.y = m.drop < 0 ? ROCKFALL.from : ROCKFALL.from * (1 - m.drop * m.drop)
      break
    }
    case 'sweeper': {
      m.x = LANES[m.lanes[0]]
      const k = 0.5 - 0.5 * Math.cos((Math.PI * 2 * t) / SWEEPER.period)
      m.y = SWEEPER.low + (SWEEPER.high - SWEEPER.low) * k
      break
    }
    case 'hauler': {
      m.x = LANES[m.lanes[0]]
      m.y = Math.sin(t * 9) * 0.02
      break
    }
  }
}

/** The box the runner is tested against right now (null: nothing to hit). */
export interface HitBox {
  x: number
  width: number
  bottom: number
  top: number
  depth: number
  /** Roof height the runner can land on (0: none). */
  platform: number
}

/**
 * The collision box for the current pose. `runnerX` / `halfWidth` are the body's lateral
 * span: the crossing boom is a sloped bar, so its height under the runner depends on
 * where across the road the runner is.
 */
export function moverBox(m: MoverState, runnerX: number, halfWidth: number, out: HitBox): boolean {
  out.depth = MOVER_DEPTH[m.type]
  out.platform = m.type === 'hauler' ? HAULER.height : 0
  switch (m.type) {
    case 'roller': {
      out.x = m.x
      out.width = ROLLER.width[m.look] ?? 1.45
      out.bottom = m.y
      out.top = m.y + ROLLER.radius * 2
      return true
    }
    case 'snowball': {
      out.x = m.x
      out.width = m.size * 2 * 0.86
      out.bottom = 0
      out.top = m.size * 2 * 0.94
      out.depth = m.size * 2 * 0.9
      return true
    }
    case 'slider': {
      out.x = m.x
      out.width = SLIDER.width
      out.bottom = 0
      out.top = SLIDER.height
      return true
    }
    case 'crossing': {
      const c = CROSSING
      const cos = Math.cos(m.angle)
      const tan = Math.tan(m.angle)
      const pivot = m.side * c.pivotX
      const tip = pivot - m.side * c.length * cos
      const lo = Math.max(Math.min(pivot, tip), runnerX - halfWidth)
      const hi = Math.min(Math.max(pivot, tip), runnerX + halfWidth)
      if (hi <= lo) return false
      const near = Math.min(Math.abs(pivot - lo), Math.abs(pivot - hi))
      const far = Math.max(Math.abs(pivot - lo), Math.abs(pivot - hi))
      const half = c.thick / 2 / Math.max(0.05, cos)
      out.x = (lo + hi) / 2
      out.width = hi - lo
      out.bottom = c.pivotY + near * tan - half
      // Never above the bar's own tip (its upper corner), however steep it stands.
      out.top = Math.min(c.pivotY + far * tan + half, c.pivotY + c.length * Math.sin(m.angle) + (c.thick / 2) * cos)
      return true
    }
    case 'pendulum': {
      const [w, h] = PENDULUM.bob[m.look] ?? PENDULUM.bob.log
      const round = PENDULUM.round[m.look]
      const c = Math.cos(m.angle)
      const s = Math.abs(Math.sin(m.angle))
      const hw = round ? w / 2 : (w / 2) * c + (h / 2) * s
      const hh = round ? h / 2 : (h / 2) * c + (w / 2) * s
      out.x = m.x
      out.width = hw * 2
      out.bottom = m.y - hh
      out.top = m.y + hh
      return true
    }
    case 'rockfall': {
      if (m.drop < 0) return false
      out.x = m.x
      out.width = ROCKFALL.width
      out.bottom = m.y
      out.top = m.y + ROCKFALL.height
      return true
    }
    case 'sweeper': {
      out.x = m.x
      out.width = SWEEPER.width
      out.bottom = m.y - SWEEPER.thick / 2
      out.top = m.y + SWEEPER.thick / 2
      return true
    }
    case 'hauler': {
      out.x = m.x
      out.width = HAULER.width
      out.bottom = 0
      out.top = HAULER.height
      return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------------
// The looks. Every part is built in the skin format (position, colour, glow) so it
// shares the obstacle skin material. Animated parts are built around their own pivot.

export type MoverPart = 'body' | 'track' | 'post' | 'boom' | 'lampA' | 'lampB' | 'frame' | 'arm' | 'rock' | 'beam'
export const MOVER_PARTS: Record<MoverType, MoverPart[]> = {
  roller: ['body'],
  snowball: ['body'],
  slider: ['track', 'body'],
  crossing: ['post', 'boom', 'lampA', 'lampB'],
  pendulum: ['frame', 'arm'],
  rockfall: ['rock'],
  sweeper: ['frame', 'beam'],
  hauler: ['body'],
}
/** Parts that are scenery, not hazard: never collided with, never measured. */
export const SCENERY_PARTS: MoverPart[] = ['track', 'post', 'frame', 'lampA', 'lampB']

export type MoverBook = Record<MoverLook, Partial<Record<MoverPart, Geo>>>

const RED = 0xd92b2b
const WHITE = 0xf4f4f2

/** A cheap deterministic jitter so procedural rocks are not perfect polyhedra. */
function craggy(geo: Geo, amount: number, seed: number): Geo {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`
  const moved = new Map<string, number>()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const k = key(x, y, z)
    let f = moved.get(k)
    if (f === undefined) {
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453
      f = 1 + (h - Math.floor(h) - 0.5) * amount
      moved.set(k, f)
    }
    pos.setXYZ(i, x * f, y * f, z * f)
  }
  return geo
}

/** Scales a merged part so its bounds are exactly `fit` and stands it on `y0`. */
function fitTo(geo: Geo, fit: V3, y0: number): Geo {
  geo.computeBoundingBox()
  const b = geo.boundingBox as THREE.Box3
  const size = b.getSize(new THREE.Vector3())
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2)
  geo.scale(fit[0] / size.x, fit[1] / size.y, fit[2] / size.z)
  geo.translate(0, y0, 0)
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

// --- roller (built around its axle, which the rig lifts to the radius) ---

function rollerBarrel(): Geo {
  const r = ROLLER.radius
  const L = 1.4
  const p: Geo[] = [
    cyl(r, L, 14, 0x9c6a3c, [0, 0, 0], 'x'),
    cyl(r * 0.9, 0.02, 14, 0xc79a62, [-L / 2 - 0.01, 0, 0], 'x'),
    cyl(r * 0.9, 0.02, 14, 0xc79a62, [L / 2 + 0.01, 0, 0], 'x'),
  ]
  for (const x of [-0.48, 0, 0.48]) p.push(cyl(r * 1.03, 0.07, 14, 0x3e434c, [x, 0, 0], 'x'))
  // Dark staves: without them a rolling barrel looks like a sliding one.
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3
    p.push(box(L * 0.98, 0.035, 0.035, 0x6e4526, [0, Math.sin(a) * r, Math.cos(a) * r]))
  }
  return merge(p)
}

function rollerHay(): Geo {
  const r = ROLLER.radius
  const L = 1.4
  const p: Geo[] = [cyl(r, L, 16, 0xd9b25a, [0, 0, 0], 'x')]
  for (const sx of [-1, 1]) {
    p.push(cyl(r * 0.86, 0.02, 16, 0xc59a3e, [sx * (L / 2 + 0.005), 0, 0], 'x'))
    p.push(cyl(r * 0.55, 0.03, 12, 0xb8892f, [sx * (L / 2 + 0.01), 0, 0], 'x'))
    p.push(cyl(r * 0.22, 0.04, 8, 0xa47a28, [sx * (L / 2 + 0.015), 0, 0], 'x'))
  }
  for (const x of [-0.32, 0.32]) p.push(cyl(r * 1.02, 0.05, 16, 0x8a6a3a, [x, 0, 0], 'x'))
  // Loose straw tufts so the roll reads.
  for (let i = 0; i < 8; i++) {
    const a = i * 0.785 + 0.3
    const x = ((i * 0.37) % 1.1) - 0.55
    p.push(box(0.14, 0.05, 0.09, 0xf0d27a, [x, Math.sin(a) * r * 1.01, Math.cos(a) * r * 1.01]))
  }
  return merge(p)
}

function rollerPumpkin(props: PropMap | null): Geo {
  const d = ROLLER.radius * 2
  const kit = prop(props, 'pumpkin-carved', { fit: [1.04, d, 0.98], at: [0, -d / 2, 0] })
  if (kit) return merge([kit])
  const sphere = new THREE.SphereGeometry(0.52, 10, 8)
  sphere.scale(1, 0.82, 0.94)
  return merge([
    finish(sphere, 0xe8862e),
    cyl(0.06, 0.1, 5, 0x4f7a2e, [0, 0.42, 0]),
    box(0.5, 0.14, 0.04, 0xffc44d, [0, -0.05, 0.47], 1.4),
    box(0.12, 0.1, 0.04, 0xffc44d, [-0.17, 0.14, 0.46], 1.4),
    box(0.12, 0.1, 0.04, 0xffc44d, [0.17, 0.14, 0.46], 1.4),
  ])
}

// --- snowball (unit sphere; the rig scales it to the live radius) ---

function snowball(): Geo {
  const core = craggy(new THREE.IcosahedronGeometry(1, 2), 0.06, 3)
  const p: Geo[] = [finish(core, 0xf2f6fc)]
  // Clumps it picked up on the way down, and a few twigs: the tumble has to read.
  const bits: Array<[number, number, number, number]> = [
    [0.6, 0.55, 0.55, 0xdfe9f5],
    [-0.7, 0.2, 0.68, 0xe6eef8],
    [0.1, -0.5, 0.86, 0xdfe9f5],
    [-0.3, 0.85, -0.4, 0xe6eef8],
    [0.75, -0.2, -0.62, 0xdfe9f5],
  ]
  for (const [x, y, z, hex] of bits) {
    const n = new THREE.Vector3(x, y, z).normalize()
    p.push(finish(new THREE.IcosahedronGeometry(0.15, 0).translate(n.x * 0.9, n.y * 0.9, n.z * 0.9), hex))
  }
  for (const [x, y, z] of [[0.2, 0.3, 0.93], [-0.9, -0.3, 0.2], [0.4, -0.85, -0.3]] as V3[]) {
    const n = new THREE.Vector3(x, y, z).normalize()
    const twig = box(0.26, 0.04, 0.04, 0x6b4a2e, [n.x * 0.97, n.y * 0.97, n.z * 0.97])
    p.push(turned(twig, 0, Math.atan2(n.x, n.z), 0.6, [n.x * 0.97, n.y * 0.97, n.z * 0.97]))
  }
  const geo = merge(p)
  // Keep it a unit ball: the rig scales it to the radius the collision box uses.
  geo.computeBoundingSphere()
  return geo
}

// --- slider (body built around its own centre line; the track spans both lanes) ---

function sliderSawhorse(): Geo {
  const p: Geo[] = []
  for (const x of [-0.82, 0.82]) {
    for (const s of [-1, 1]) p.push(turned(box(0.08, 0.84, 0.08, 0xe9edf2, [x, 0.47, s * 0.14]), s * 0.3, 0, 0, [x, 0.47, s * 0.14]))
    for (const s of [-1, 1]) p.push(cyl(0.07, 0.05, 8, 0x2b2f38, [x, 0.07, s * 0.27], 'x'))
  }
  p.push(slab(2.0, 0.3, 0.1, WHITE, 0, 0.5, 0))
  for (let i = 0; i < 5; i++) {
    const x = -0.8 + i * 0.4
    p.push(turned(box(0.16, 0.36, 0.02, 0xff6a1a, [x, 0.65, 0.06]), 0, 0, 0.55, [x, 0.65, 0.06]))
  }
  p.push(slab(1.8, 0.1, 0.06, 0xff6a1a, 0, 0.24, 0))
  // Amber beacon: the barrier is "on duty".
  p.push(slab(0.16, 0.12, 0.12, 0xffb21a, 0.74, 0.8, 0, 1.6))
  return merge(p)
}

function sliderHover(): Geo {
  const p: Geo[] = [
    rbox(2.0, 0.44, 0.6, 0.1, 0x1c2333, [0, 0.62, 0]),
    slab(1.9, 0.06, 0.05, 0xff3dbb, 0, 0.78, 0.28, 1.4),
    slab(1.9, 0.05, 0.05, 0x38e8ff, 0, 0.46, 0.28, 1.4),
    slab(0.06, 0.08, 0.06, 0x38e8ff, -0.85, 0.84, 0, 1.4),
    slab(0.06, 0.08, 0.06, 0x38e8ff, 0.85, 0.84, 0, 1.4),
    slab(1.8, 0.02, 0.5, 0x38e8ff, 0, 0.005, 0, 0.9),
  ]
  for (const x of [-0.6, 0, 0.6]) p.push(turned(box(0.26, 0.06, 0.02, 0x38e8ff, [x, 0.62, 0.31], 1.6), 0, 0, 0.7, [x, 0.62, 0.31]))
  for (const x of [-0.7, 0.7]) p.push(cyl(0.13, 0.1, 10, 0x38e8ff, [x, 0.37, 0], 'y', 1.2))
  return merge(p)
}

function sliderTrack(neon: boolean): Geo {
  const span = LANES[1] - LANES[0] + SLIDER.width + 0.2
  const rail = neon ? 0x38e8ff : 0x3a3f4a
  const p: Geo[] = [
    slab(span, 0.03, 0.08, rail, 0, 0, 0.3, neon ? 1 : 0),
    slab(span, 0.03, 0.08, rail, 0, 0, -0.3, neon ? 1 : 0),
  ]
  for (const sx of [-1, 1]) p.push(slab(0.12, 0.12, 0.72, neon ? 0xff3dbb : 0xf7c33c, sx * (span / 2), 0, 0, neon ? 1.2 : 0))
  return merge(p)
}

// --- level crossing (built for the right-hand kerb; the rig mirrors it) ---

function crossingPost(wood: boolean): Geo {
  const c = CROSSING
  const poleX = c.pivotX + 0.5
  const pole = wood ? 0x8a6a46 : WHITE
  const p: Geo[] = [
    slab(0.56, 0.12, 0.56, 0x6a6f78, poleX, 0, 0),
    cyl(0.09, 3.3, 8, pole, [poleX, 1.65, 0]),
    // Mechanism housing the boom pivots on.
    slab(0.42, 0.75, 0.42, 0xe6e6e6, c.pivotX + 0.12, 0.9, 0),
    slab(0.43, 0.12, 0.43, RED, c.pivotX + 0.12, 1.3, 0),
    // Lamp bar with two hooded lamps (the lit discs are their own parts).
    slab(0.95, 0.09, 0.09, 0x15171c, poleX, 2.3, 0.08),
    cyl(0.18, 0.12, 12, 0x15171c, [poleX - 0.33, 2.35, 0.14], 'z'),
    cyl(0.18, 0.12, 12, 0x15171c, [poleX + 0.33, 2.35, 0.14], 'z'),
    cyl(0.12, 0.02, 12, 0x3a1210, [poleX - 0.33, 2.35, 0.205], 'z'),
    cyl(0.12, 0.02, 12, 0x3a1210, [poleX + 0.33, 2.35, 0.205], 'z'),
    slab(0.4, 0.04, 0.22, 0x15171c, poleX - 0.33, 2.53, 0.16),
    slab(0.4, 0.04, 0.22, 0x15171c, poleX + 0.33, 2.53, 0.16),
    // Bell on top.
    cyl(0.13, 0.15, 10, 0xd6a531, [poleX, 3.4, 0], 'y', 0.2, 0.06),
  ]
  for (const y of [0.55, 1.15, 1.75]) if (!wood) p.push(cyl(0.095, 0.2, 8, RED, [poleX, y, 0]))
  // Crossbuck.
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    p.push(turned(box(1.25, 0.2, 0.03, RED, [poleX, 2.95, 0.1]), 0, 0, a, [poleX, 2.95, 0.1]))
    p.push(turned(box(1.17, 0.13, 0.03, WHITE, [poleX, 2.95, 0.118]), 0, 0, a, [poleX, 2.95, 0.118]))
  }
  // The railway itself, across the whole road just past the barrier.
  for (let x = -4.5; x <= 4.51; x += 0.6) p.push(slab(0.24, 0.04, 1.5, wood ? 0x6a5038 : 0x4a4038, x, 0, -2.2))
  for (const z of [-1.75, -2.65]) p.push(slab(9.6, 0.08, 0.08, 0xa0a8b2, 0, 0.04, z))
  return merge(p)
}

/** The boom, pivoting at the origin and reaching out along -x. */
function crossingBoom(): Geo {
  const c = CROSSING
  const seg = c.length / 6
  const p: Geo[] = []
  for (let i = 0; i < 6; i++) p.push(box(seg, 0.2, 0.14, i % 2 ? WHITE : RED, [-(seg / 2 + i * seg), 0, 0]))
  // Counterweight behind the pivot and reflectors along the bar.
  p.push(box(0.5, 0.3, 0.24, 0x3a3f4a, [0.3, 0, 0]))
  for (const x of [-1.4, -2.9, -4.4]) p.push(box(0.1, 0.1, 0.03, 0xff3b2a, [x, 0, 0.085], 1.1))
  return merge(p)
}

function crossingLamp(x: number): Geo {
  const poleX = CROSSING.pivotX + 0.5
  return merge([cyl(0.13, 0.03, 12, 0xff2a1a, [poleX + x, 2.35, 0.215], 'z', 2.6)])
}

// --- pendulum (frame spans the road; the arm hangs from its pivot at the origin) ---

function pendulumFrame(look: MoverLook): Geo {
  const top = 7.6
  const p: Geo[] = []
  if (look === 'lantern') {
    for (const x of [-5.0, 5.0]) p.push(cyl(0.24, top, 10, 0xc8372d, [x, top / 2, 0]), slab(0.62, 0.3, 0.62, 0x1f1a1a, x, 0, 0))
    p.push(slab(11.6, 0.34, 0.55, 0x1f1a1a, 0, top, 0), slab(10.6, 0.26, 0.4, 0xc8372d, 0, PENDULUM.pivotY - 0.05, 0))
    p.push(slab(0.5, 0.6, 0.18, 0xd6a531, 0, PENDULUM.pivotY + 0.21, 0.22))
  } else if (look === 'ghost') {
    for (const x of [-5.0, 5.0]) p.push(turned(cyl(0.2, top, 7, 0x3a3440, [x, top / 2, 0]), 0, 0, x < 0 ? 0.03 : -0.04, [x, 0, 0]))
    p.push(turned(cyl(0.22, 10.8, 7, 0x2e2a33, [0, top - 0.1, 0], 'x'), 0, 0, 0.025, [0, top, 0]))
    for (const sx of [-1, 1]) p.push(turned(box(2.2, 0.14, 0.14, 0x2e2a33, [sx * 4.2, top - 0.75, 0]), 0, 0, sx * 0.6, [sx * 4.2, top - 0.75, 0]))
  } else {
    for (const x of [-5.0, 5.0]) p.push(cyl(0.22, top, 8, 0x6b4a2e, [x, top / 2, 0]))
    p.push(cyl(0.25, 10.9, 9, 0x7a5532, [0, top, 0], 'x'))
    for (const sx of [-1, 1]) p.push(turned(box(2.3, 0.16, 0.16, 0x6b4a2e, [sx * 4.15, top - 0.8, 0]), 0, 0, sx * 0.62, [sx * 4.15, top - 0.8, 0]))
  }
  return merge(p)
}

function pendulumArm(look: MoverLook, props: PropMap | null): Geo {
  const L = pendulumLength(look)
  const [w, h, d] = PENDULUM.bob[look] ?? PENDULUM.bob.log
  const rope = L - h / 2
  const p: Array<Geo | null> = []
  // From the frame's beam down to the bob (above head height, decoration only).
  const top = 7.6 - PENDULUM.pivotY
  if (look === 'ghost') {
    for (let i = 0; i < Math.floor((rope + top) / 0.28); i++) p.push(box(0.07, 0.2, 0.04, 0x55525c, [0, top - 0.14 - i * 0.28, 0]))
  } else {
    p.push(box(0.07, rope + top, 0.07, look === 'lantern' ? 0x2a2420 : 0xb89a6a, [0, (top - rope) / 2, 0]))
  }
  const y = -L
  if (look === 'log') {
    p.push(cyl(w / 2, d - 0.06, 10, 0x7a4e2e, [0, y, 0], 'z'))
    for (const sz of [-1, 1]) p.push(cyl(w / 2 - 0.06, 0.03, 10, 0xe3c79c, [0, y, sz * (d / 2 - 0.02)], 'z'))
    for (const sz of [-1, 1]) p.push(cyl(w / 2 + 0.012, 0.08, 10, 0xb89a6a, [0, y, sz * 0.24], 'z'))
  } else if (look === 'lantern') {
    const body = h - 0.26
    p.push(cyl(w / 2, body, 14, 0xe0352b, [0, y, 0], 'y', 0.55))
    for (const k of [-0.3, 0, 0.3]) p.push(cyl(w / 2 + 0.008, 0.03, 14, 0x9c1f18, [0, y + k * body, 0]))
    p.push(cyl(w * 0.3, 0.13, 10, 0xd6a531, [0, y + body / 2 + 0.065, 0]), cyl(w * 0.3, 0.13, 10, 0xd6a531, [0, y - body / 2 - 0.065, 0]))
  } else {
    const kit = prop(props, 'pumpkin-carved', { fit: [w * 0.86, h * 0.82, d * 0.86], at: [0, y - h / 2 + 0.06, 0] })
    if (kit) p.push(kit)
    else p.push(finish(new THREE.SphereGeometry(w * 0.42, 9, 7).scale(1, 0.85, 1).translate(0, y - 0.05, 0), 0xe8862e), box(0.4, 0.12, 0.04, 0xffc44d, [0, y - 0.05, w * 0.4], 1.4))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.04, h, 0.04, 0x2a2a30, [sx * (w / 2 - 0.02), y, sz * (d / 2 - 0.02)]))
    p.push(box(w, 0.04, d, 0x2a2a30, [0, y - h / 2 + 0.02, 0]), box(w, 0.04, d, 0x2a2a30, [0, y + h / 2 - 0.02, 0]))
  }
  return merge(p)
}

// --- rockfall (standing on y = 0; the rig drops it from above) ---

function rockBoulder(props: PropMap | null, tint: number): Geo {
  const fit: V3 = [ROCKFALL.width, ROCKFALL.height, ROCKFALL.depth]
  const kit = prop(props, 'rock_tallA', { fit, ry: 0.4, at: [0, 0, 0], tint })
  if (kit) return merge([kit])
  const a = craggy(new THREE.IcosahedronGeometry(1, 1), 0.22, 7).scale(0.9, 1.15, 0.7).translate(0, 1.15, 0)
  const b = craggy(new THREE.IcosahedronGeometry(0.55, 1), 0.25, 11).translate(0.55, 0.45, 0.15)
  return fitTo(merge([finish(a, tint), finish(b, tint)]), fit, 0)
}

function rockIcicle(): Geo {
  const fit: V3 = [ROCKFALL.width, ROCKFALL.height, ROCKFALL.depth]
  const p: Geo[] = [rbox(1.7, 0.42, 1.25, 0.12, 0xe8f6ff, [0, 0.21, 0])]
  const spikes: Array<[number, number, number, number, number]> = [
    [0, 0, 0.48, 2.3, 0],
    [-0.55, 0.1, 0.3, 1.5, 0.22],
    [0.55, -0.05, 0.32, 1.65, -0.2],
    [0.15, 0.4, 0.24, 1.1, -0.15],
    [-0.2, -0.4, 0.26, 1.25, 0.18],
  ]
  for (const [x, z, r, h, tilt] of spikes) {
    const cone = finish(new THREE.ConeGeometry(r, h, 6).translate(x, h / 2, z), 0xbfe6ff, 0.25)
    p.push(turned(cone, 0, 0, tilt, [x, 0, z]))
  }
  return fitTo(merge(p), fit, 0)
}

// --- sweeper (frame on the lane edges; the beam rides up and down at the origin) ---

const AMBER = 0xffb21a

function sweeperFrame(): Geo {
  const p: Geo[] = [slab(2.0, 0.05, 0.16, 0x2a2f45, 0, 0, 0)]
  for (const x of [-1.08, 1.08]) {
    p.push(slab(0.16, 2.75, 0.24, 0x2a2f45, x, 0, 0), slab(0.34, 0.08, 0.4, 0x1b1f30, x, 0, 0))
    p.push(slab(0.04, 2.3, 0.07, AMBER, x - Math.sign(x) * 0.09, 0.25, 0, 1.1))
    p.push(slab(0.22, 0.12, 0.28, AMBER, x, 2.75, 0, 1.4))
  }
  return merge(p)
}

function sweeperBeam(): Geo {
  return merge([
    box(1.98, 0.1, 0.08, AMBER, [0, 0, 0], 2.4),
    box(1.98, 0.03, 0.1, 0xfff1c4, [0, 0, 0], 2.8),
    box(0.2, 0.22, 0.3, 0xfff1c4, [-1.0, 0, 0], 1.6),
    box(0.2, 0.22, 0.3, 0xfff1c4, [1.0, 0, 0], 1.6),
  ])
}

// --- hauler (centred on its footprint, front at -z; it drives away from the runner) ---

function haulerTractor(props: PropMap | null): Geo {
  const top = HAULER.height
  const p: Array<Geo | null> = []
  // Hay wagon at the back (towards the runner).
  p.push(slab(2.0, 0.18, 4.3, 0x8a5a33, 0, 0.55, 1.55))
  for (const sx of [-1, 1]) p.push(slab(0.06, 0.26, 4.3, 0xa06a3c, sx * 0.97, 0.73, 1.55))
  p.push(slab(1.94, 0.26, 0.06, 0xa06a3c, 0, 0.73, 3.67))
  for (const z of [0.4, 2.9]) for (const sx of [-1, 1]) {
    p.push(cyl(0.36, 0.2, 12, 0x2b2b2b, [sx * 0.84, 0.36, z], 'x'), cyl(0.16, 0.22, 8, 0xd9b25a, [sx * 0.84, 0.36, z], 'x'))
  }
  // Two layers of bales: the top layer is the roof you run along.
  const bale = (x: number, y0: number, z: number, i: number): Geo | null =>
    prop(props, 'hay-bale', { fit: [0.94, 0.36, 1.36], ry: i % 2 ? Math.PI : 0, at: [x, y0, z], tint: i % 3 ? 0xe2bd63 : 0xd2a94f }) ??
    merge([slab(0.94, 0.36, 1.36, i % 3 ? 0xe2bd63 : 0xd2a94f, x, y0, z), slab(0.95, 0.37, 0.05, 0x8a6a3a, x, y0, z - 0.35), slab(0.95, 0.37, 0.05, 0x8a6a3a, x, y0, z + 0.35)])
  let i = 0
  for (const y0 of [0.73, 1.09]) for (const z of [0.15, 1.55, 2.95]) for (const x of [-0.48, 0.48]) p.push(bale(x, y0, z, i++))
  // Hitch and the tractor in front, under a sun canopy at roof height.
  p.push(box(0.12, 0.1, 0.6, 0x2b2b2b, [0, 0.45, -0.85]))
  p.push(slab(0.9, 0.55, 1.4, 0xd8342c, 0, 0.55, -2.95), slab(1.1, 0.5, 1.0, 0xd8342c, 0, 0.45, -1.75))
  p.push(slab(0.5, 0.1, 0.45, 0x222222, 0, 0.95, -1.6), slab(0.5, 0.4, 0.08, 0x222222, 0, 0.95, -1.36))
  p.push(slab(0.92, 0.04, 0.06, 0xf2f2f2, 0, 0.9, -3.66))
  for (const sx of [-1, 1]) {
    p.push(cyl(0.6, 0.36, 14, 0x262626, [sx * 0.78, 0.6, -1.6], 'x'), cyl(0.3, 0.38, 10, 0xf2c230, [sx * 0.78, 0.6, -1.6], 'x'))
    p.push(cyl(0.33, 0.22, 12, 0x262626, [sx * 0.6, 0.33, -3.2], 'x'), cyl(0.15, 0.24, 8, 0xf2c230, [sx * 0.6, 0.33, -3.2], 'x'))
  }
  p.push(cyl(0.05, 0.75, 6, 0x333333, [0.3, 1.0, -2.75]))
  for (const sx of [-1, 1]) for (const z of [-3.5, -1.2]) p.push(cyl(0.035, top - 1.0, 6, 0x333333, [sx * 0.7, 1.0 + (top - 1.0) / 2 - 0.05, z]))
  p.push(slab(1.6, 0.05, 2.7, 0x2f8f4e, 0, top - 0.05, -2.3), slab(1.64, 0.1, 0.04, 0xf2c230, 0, top - 0.12, -0.96))
  return merge(p)
}

function haulerCart(): Geo {
  const top = HAULER.height
  const p: Geo[] = []
  // Cargo bed of fruit crates, three-wheeled, under one striped canopy.
  p.push(slab(2.0, 0.15, 4.9, 0x3d6fa8, 0, 0.5, 1.25))
  for (const sx of [-1, 1]) p.push(slab(0.05, 0.3, 4.9, 0x2f5a8c, sx * 0.975, 0.65, 1.25))
  for (const z of [0.2, 2.9]) for (const sx of [-1, 1]) p.push(cyl(0.34, 0.16, 12, 0x2b2b2b, [sx * 0.86, 0.34, z], 'x'), cyl(0.12, 0.18, 8, 0xb0b6bf, [sx * 0.86, 0.34, z], 'x'))
  const fruit = [0xf2c230, 0xe2457a, 0x7cc04a, 0xff8a2a]
  let i = 0
  for (const z of [-0.4, 0.75, 1.9, 3.05]) for (const x of [-0.48, 0.48]) {
    p.push(...crate(0.9, 0.42, 1.0, x, 0.65, z, 0xc08a55, 0x7a4e2e))
    p.push(slab(0.8, 0.08, 0.9, fruit[i++ % fruit.length], x, 1.07, z))
  }
  // Rider's end: front wheel, seat and handlebar.
  p.push(cyl(0.34, 0.14, 12, 0x2b2b2b, [0, 0.34, -3.2], 'x'), box(0.08, 0.7, 0.08, 0x444a52, [0, 0.7, -3.05]))
  p.push(slab(0.8, 0.05, 0.05, 0x444a52, 0, 1.0, -2.9), slab(0.44, 0.12, 0.5, 0x222222, 0, 0.8, -2.2), slab(0.5, 0.45, 0.6, 0x3d6fa8, 0, 0.3, -2.2))
  for (const sx of [-1, 1]) for (const z of [-2.9, 3.6]) p.push(cyl(0.035, top - 0.6, 6, 0xd8d8d8, [sx * 0.9, 0.6 + (top - 0.6) / 2 - 0.05, z]))
  const stripes = 9
  const length = 7.2
  for (let k = 0; k < stripes; k++) {
    const z = -3.5 + (k + 0.5) * (length / stripes)
    p.push(slab(1.96, 0.05, length / stripes, k % 2 ? 0xf4f4f2 : 0x2f7fd0, 0, top - 0.05, z))
  }
  for (const sx of [-1, 1]) p.push(slab(0.04, 0.16, length, 0x2f7fd0, sx * 0.98, top - 0.2, 0.1))
  return merge(p)
}

/** Builds every look's parts. Without the prop pack the procedural ones stand in. */
export function buildMoverBook(props: PropMap | null): MoverBook {
  return {
    barrel: { body: rollerBarrel() },
    hay: { body: rollerHay() },
    pumpkin: { body: rollerPumpkin(props) },
    snow: { body: snowball() },
    sawhorse: { body: sliderSawhorse(), track: sliderTrack(false) },
    hover: { body: sliderHover(), track: sliderTrack(true) },
    rail: { post: crossingPost(false), boom: crossingBoom(), lampA: crossingLamp(-0.33), lampB: crossingLamp(0.33) },
    railwood: { post: crossingPost(true), boom: crossingBoom(), lampA: crossingLamp(-0.33), lampB: crossingLamp(0.33) },
    log: { frame: pendulumFrame('log'), arm: pendulumArm('log', props) },
    lantern: { frame: pendulumFrame('lantern'), arm: pendulumArm('lantern', props) },
    ghost: { frame: pendulumFrame('ghost'), arm: pendulumArm('ghost', props) },
    boulder: { rock: rockBoulder(props, 0xd9a066) },
    redrock: { rock: rockBoulder(props, 0xb8583a) },
    icicle: { rock: rockIcicle() },
    laser: { frame: sweeperFrame(), beam: sweeperBeam() },
    tractor: { body: haulerTractor(props) },
    cart: { body: haulerCart() },
  }
}

/** The warning ring a rock is about to land on (own material: it pulses). */
export function warningRingGeometry(): THREE.BufferGeometry {
  const outer = new THREE.RingGeometry(0.78, 1.02, 28)
  const inner = new THREE.RingGeometry(0.34, 0.46, 20)
  const merged = merge([finish(outer, 0xffffff), finish(inner, 0xffffff)])
  merged.rotateX(-Math.PI / 2)
  return merged
}

// ---------------------------------------------------------------------------------
// Rigs: one group of meshes per type, reused from the pool and posed every frame.

export interface MoverRig {
  root: THREE.Group
  parts: Partial<Record<MoverPart | 'mark', THREE.Mesh>>
}

export function buildRig(type: MoverType, material: THREE.Material, mark: { geometry: THREE.BufferGeometry; material: THREE.Material } | null): MoverRig {
  const root = new THREE.Group()
  root.name = `mover:${type}`
  const parts: MoverRig['parts'] = {}
  for (const name of MOVER_PARTS[type]) {
    const mesh = new THREE.Mesh(undefined, material)
    mesh.name = name
    mesh.castShadow = !SCENERY_PARTS.includes(name) || name === 'frame' || name === 'post'
    parts[name] = mesh
    root.add(mesh)
  }
  if (type === 'crossing') {
    const boom = parts.boom as THREE.Mesh
    boom.position.set(CROSSING.pivotX, CROSSING.pivotY, 0)
  }
  if (type === 'rockfall' && mark) {
    const ring = new THREE.Mesh(mark.geometry, mark.material)
    ring.name = 'mark'
    ring.position.y = 0.035
    ring.renderOrder = 1
    parts.mark = ring
    root.add(ring)
  }
  return { root, parts }
}

/** Puts a look's geometry on the rig's parts (a look may not have every part). */
export function dressRig(rig: MoverRig, book: MoverBook, look: MoverLook, empty: THREE.BufferGeometry): void {
  const set = book[look]
  for (const [name, mesh] of Object.entries(rig.parts) as Array<[MoverPart | 'mark', THREE.Mesh]>) {
    if (name === 'mark') continue
    const geo = set[name as MoverPart]
    mesh.geometry = geo ?? empty
    mesh.visible = !!geo
  }
}

/**
 * Poses a rig from the mover's state. The rig root sits at `rootX` (lane or road
 * centre) — every part position is relative to it.
 */
export function poseRig(rig: MoverRig, m: MoverState, rootX: number, time: number): void {
  const p = rig.parts
  switch (m.type) {
    case 'roller': {
      const body = p.body as THREE.Mesh
      body.position.set(m.x - rootX, ROLLER.radius + m.y, 0)
      // Pumpkins hop and waddle, face on; barrels and bales roll.
      if (m.look === 'pumpkin') body.rotation.set(0, 0, m.angle)
      else body.rotation.set(m.angle, 0, 0)
      break
    }
    case 'snowball': {
      const body = p.body as THREE.Mesh
      body.position.set(m.x - rootX, m.size, 0)
      body.scale.setScalar(m.size)
      body.rotation.set(m.angle, 0, 0)
      break
    }
    case 'slider': {
      ;(p.body as THREE.Mesh).position.x = m.x - rootX
      ;(p.track as THREE.Mesh).position.x = 0
      break
    }
    case 'crossing': {
      rig.root.scale.x = m.side
      ;(p.boom as THREE.Mesh).rotation.z = -m.angle
      const on = m.lamp
      const flip = Math.floor(time * 2.6) % 2 === 0
      ;(p.lampA as THREE.Mesh).visible = on && flip
      ;(p.lampB as THREE.Mesh).visible = on && !flip
      break
    }
    case 'pendulum': {
      const arm = p.arm as THREE.Mesh
      arm.position.set(moverMid(m) - rootX, PENDULUM.pivotY, 0)
      arm.rotation.z = m.angle
      break
    }
    case 'rockfall': {
      const rock = p.rock as THREE.Mesh
      rock.position.set(m.x - rootX, m.y, 0)
      rock.visible = m.drop >= 0
      const mark = p.mark
      if (mark) {
        mark.visible = m.drop < 1
        const grow = m.drop < 0 ? 1 : 1 + m.drop * 0.25
        mark.scale.set(grow, 1, grow)
      }
      break
    }
    case 'sweeper': {
      ;(p.beam as THREE.Mesh).position.set(0, m.y, 0)
      break
    }
    case 'hauler': {
      ;(p.body as THREE.Mesh).position.set(0, m.y, 0)
      break
    }
  }
}
