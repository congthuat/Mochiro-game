// The town: detailed, procedurally generated houses and street furniture.
//
// Every prototype is merged into a single vertex-coloured BufferGeometry, so a
// whole house (walls, roof, windows, shutters, door, awning, chimney, balcony)
// costs exactly one draw call per chunk via InstancedMesh.
//
// Shape vocabulary follows the low-poly architectural conventions popularised by
// CC0 asset collections (Kenney "City Kit", Quaternius city packs): a plinth, a
// wall block, an overhanging roof with a fascia, punched windows with frames and
// sills, a recessed door with a step, and street-level awnings.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type Rng = () => number

interface PartOptions {
  pos?: [number, number, number]
  rot?: [number, number, number]
  scale?: [number, number, number]
}

/** Applies a transform, then bakes a flat vertex colour into the geometry. */
function paint(geo: THREE.BufferGeometry, color: number, options: PartOptions = {}): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  if (options.rot) {
    if (options.rot[0]) g.rotateX(options.rot[0])
    if (options.rot[1]) g.rotateY(options.rot[1])
    if (options.rot[2]) g.rotateZ(options.rot[2])
  }
  if (options.scale) g.scale(options.scale[0], options.scale[1], options.scale[2])
  if (options.pos) g.translate(options.pos[0], options.pos[1], options.pos[2])
  const c = new THREE.Color(color)
  const count = g.attributes.position.count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]
}

const WALLS = [0xfff3dc, 0xfdfbf5, 0xffe2c9, 0xdfeefc, 0xe2f7e6, 0xffe6ee, 0xf7e6c8, 0xf0e7fa] as const
const TRIMS = [0xfdfaf3, 0xf3ece0, 0xe8e2d6, 0xfff8ea] as const
const ROOFS = [0xc8552f, 0xa8432c, 0x5d6f80, 0x4a545e, 0x6b8a5a, 0x8c6239, 0x7c4a58] as const
const SHUTTERS = [0x2f6f8f, 0x8f4a3f, 0x4a7a52, 0x6a5f92, 0x3f5f7a] as const
const AWNINGS = [0xd94f4f, 0x2f8f8f, 0xe0a02f, 0x4a8fd9, 0xd96fa0, 0x4aa85a] as const
const STONE = 0xd0c7b4
const GLASS = 0x9ec4dc
const WOOD = 0x9a6238
const BRASS = 0xd9b45a

function window_(parts: THREE.BufferGeometry[], x: number, y: number, z: number, ry: number, trim: number, rng: Rng, width = 1.0) {
  const h = width * 1.18
  const frame = new THREE.BoxGeometry(width, h, 0.16)
  parts.push(paint(frame, trim, { rot: [0, ry, 0], pos: [x, y, z] }))
  const glass = new THREE.BoxGeometry(width - 0.2, h - 0.2, 0.1)
  parts.push(paint(glass, GLASS, { rot: [0, ry, 0], pos: [x, y, z] }))
  const barV = new THREE.BoxGeometry(0.07, h - 0.2, 0.14)
  parts.push(paint(barV, trim, { rot: [0, ry, 0], pos: [x, y, z] }))
  const barH = new THREE.BoxGeometry(width - 0.2, 0.07, 0.14)
  parts.push(paint(barH, trim, { rot: [0, ry, 0], pos: [x, y, z] }))
  const sill = new THREE.BoxGeometry(width + 0.22, 0.1, 0.3)
  parts.push(paint(sill, trim, { rot: [0, ry, 0], pos: [x, y - h / 2 - 0.06, z] }))
  if (rng() < 0.55) {
    const shutter = pick(rng, SHUTTERS)
    for (const side of [-1, 1]) {
      const leaf = new THREE.BoxGeometry(width * 0.3, h * 0.94, 0.08)
      const ox = Math.cos(ry) * (x + side * (width * 0.66)) + Math.sin(ry) * z
      const oz = -Math.sin(ry) * (x + side * (width * 0.66)) + Math.cos(ry) * z
      parts.push(paint(leaf, shutter, { rot: [0, ry, 0], pos: [ox, y, oz + (ry === 0 ? 0.06 : 0)] }))
    }
  }
}

/** A full house: plinth, walls, roof, windows, shutters, door, chimney, extras. */
export function makeHouse(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const W = 4.4 + rng() * 2.2
  const D = 4.0 + rng() * 1.8
  const floors = rng() < 0.3 ? 1 : rng() < 0.72 ? 2 : 3
  const FH = 2.75
  const base = 0.55
  const bodyH = floors * FH
  const top = base + bodyH
  const wall = pick(rng, WALLS)
  const trim = pick(rng, TRIMS)
  const roofColor = pick(rng, ROOFS)
  const roofH = Math.min(W * 0.42, 2.3)

  // Plinth + walls + floor bands.
  parts.push(paint(new THREE.BoxGeometry(W + 0.3, base, D + 0.3), STONE, { pos: [0, base / 2, 0] }))
  parts.push(paint(new THREE.BoxGeometry(W, bodyH, D), wall, { pos: [0, base + bodyH / 2, 0] }))
  for (let f = 1; f < floors; f++) {
    parts.push(paint(new THREE.BoxGeometry(W + 0.16, 0.18, D + 0.16), trim, { pos: [0, base + f * FH, 0] }))
  }

  // Roof: gable (ridge along x), hip, or flat with a parapet.
  const kind = rng()
  const over = 0.42
  if (kind < 0.56) {
    const shape = new THREE.Shape()
    shape.moveTo(-D / 2 - over, 0)
    shape.lineTo(D / 2 + over, 0)
    shape.lineTo(0, roofH)
    shape.closePath()
    const span = W + over * 2
    const roof = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false })
    parts.push(paint(roof, roofColor, { rot: [0, Math.PI / 2, 0], pos: [-span / 2, top, 0] }))
    parts.push(paint(new THREE.BoxGeometry(span, 0.14, 0.34), roofColor, { pos: [0, top + roofH, 0] }))
    for (const side of [-1, 1]) {
      parts.push(
        paint(new THREE.BoxGeometry(span, 0.18, 0.14), trim, { pos: [0, top - 0.04, side * (D / 2 + over - 0.07)] })
      )
    }
  } else if (kind < 0.84) {
    const half = Math.max(W, D) / 2 + over
    const radius = half / Math.cos(Math.PI / 4)
    const cone = new THREE.CylinderGeometry(0.05, radius, roofH * 1.05, 4, 1)
    parts.push(
      paint(cone, roofColor, {
        rot: [0, Math.PI / 4, 0],
        scale: [1, 1, D / W],
        pos: [0, top + roofH * 0.52, 0],
      })
    )
    parts.push(paint(new THREE.BoxGeometry(W + over * 2, 0.18, D + over * 2), trim, { pos: [0, top - 0.02, 0] }))
  } else {
    parts.push(paint(new THREE.BoxGeometry(W + 0.24, 0.55, D + 0.24), trim, { pos: [0, top + 0.27, 0] }))
    parts.push(paint(new THREE.BoxGeometry(W - 0.14, 0.14, D - 0.14), 0x76808c, { pos: [0, top + 0.46, 0] }))
  }

  // Chimney.
  if (rng() < 0.72) {
    const cx = W * 0.26
    const cz = -D * 0.16
    const ch = 1.0 + rng() * 0.5
    parts.push(paint(new THREE.BoxGeometry(0.56, ch, 0.56), 0xb4653f, { pos: [cx, top + roofH * 0.45 + ch / 2, cz] }))
    parts.push(paint(new THREE.BoxGeometry(0.74, 0.16, 0.74), STONE, { pos: [cx, top + roofH * 0.45 + ch + 0.06, cz] }))
    parts.push(paint(new THREE.BoxGeometry(0.4, 0.1, 0.4), 0x3a3632, { pos: [cx, top + roofH * 0.45 + ch + 0.16, cz] }))
  }

  // Windows: two per floor on the street facade, one per side.
  const facadeZ = D / 2
  for (let f = 0; f < floors; f++) {
    const y = base + f * FH + FH * 0.58
    const dx = W * 0.27
    window_(parts, -dx, y, facadeZ, 0, trim, rng)
    window_(parts, dx, y, facadeZ, 0, trim, rng)
    if (f > 0 || floors > 1) {
      window_(parts, W / 2, y, 0, Math.PI / 2, trim, rng, 0.92)
      window_(parts, -W / 2, y, 0, -Math.PI / 2, trim, rng, 0.92)
    }
  }

  // Door with frame, handle, step and a small canopy.
  const doorW = 1.15
  const doorH = 2.25
  parts.push(paint(new THREE.BoxGeometry(doorW + 0.24, doorH + 0.16, 0.18), trim, { pos: [0, base + doorH / 2, facadeZ] }))
  parts.push(paint(new THREE.BoxGeometry(doorW, doorH, 0.1), pick(rng, [WOOD, 0x3f5f7a, 0x6b4a3a, 0x4a6b52]), { pos: [0, base + doorH / 2, facadeZ + 0.05] }))
  parts.push(paint(new THREE.SphereGeometry(0.06, 10, 8), BRASS, { pos: [0.34, base + doorH * 0.52, facadeZ + 0.14] }))
  parts.push(paint(new THREE.BoxGeometry(doorW + 0.5, 0.18, 0.7), STONE, { pos: [0, base - 0.02, facadeZ + 0.32] }))
  parts.push(paint(new THREE.BoxGeometry(doorW + 0.6, 0.12, 0.8), roofColor, { pos: [0, base + doorH + 0.32, facadeZ + 0.34] }))
  for (const side of [-1, 1]) {
    parts.push(
      paint(new THREE.BoxGeometry(0.08, 0.4, 0.08), trim, { pos: [side * (doorW / 2 + 0.2), base + doorH + 0.1, facadeZ + 0.6] })
    )
  }

  // Balcony on the upper floor.
  if (floors > 1 && rng() < 0.45) {
    const by = base + FH - 0.08
    parts.push(paint(new THREE.BoxGeometry(W * 0.82, 0.16, 1.2), trim, { pos: [0, by, facadeZ + 0.6] }))
    parts.push(paint(new THREE.BoxGeometry(W * 0.82, 0.1, 0.1), trim, { pos: [0, by + 0.62, facadeZ + 1.14] }))
    for (let i = 0; i < 9; i++) {
      const px = -W * 0.38 + (i / 8) * W * 0.76
      parts.push(paint(new THREE.BoxGeometry(0.07, 0.62, 0.07), trim, { pos: [px, by + 0.34, facadeZ + 1.14] }))
    }
  }

  // Ground-floor shopfront with a striped awning and a hanging sign.
  if (rng() < 0.5) {
    const aw = pick(rng, AWNINGS)
    parts.push(paint(new THREE.BoxGeometry(2.6, 1.6, 0.14), trim, { pos: [0, base + 1.15, facadeZ + 0.08] }))
    parts.push(paint(new THREE.BoxGeometry(2.36, 1.36, 0.1), GLASS, { pos: [0, base + 1.15, facadeZ + 0.1] }))
    parts.push(paint(new THREE.BoxGeometry(2.9, 0.12, 1.3), aw, { rot: [-0.3, 0, 0], pos: [0, base + 2.32, facadeZ + 0.55] }))
    parts.push(paint(new THREE.BoxGeometry(2.9, 0.16, 0.16), 0xfdfaf3, { pos: [0, base + 2.12, facadeZ + 1.14] }))
    parts.push(paint(new THREE.BoxGeometry(1.5, 0.52, 0.1), 0x33404d, { pos: [0, base + 2.85, facadeZ + 0.12] }))
    parts.push(paint(new THREE.BoxGeometry(1.3, 0.12, 0.06), 0xfdfaf3, { pos: [0, base + 2.85, facadeZ + 0.18] }))
  }

  return mergeGeometries(parts, false) as THREE.BufferGeometry
}

/** Distant skyline block with roof cap and window bands. */
export function makeBlock(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const w = 6 + rng() * 8
  const d = 6 + rng() * 8
  const h = 8 + rng() * 26
  const wall = pick(rng, WALLS)
  const roof = pick(rng, ROOFS)
  parts.push(paint(new THREE.BoxGeometry(w, h, d), wall, { pos: [0, h / 2, 0] }))
  parts.push(paint(new THREE.BoxGeometry(w + 0.5, 0.5, d + 0.5), roof, { pos: [0, h + 0.2, 0] }))
  const bands = Math.min(6, Math.floor(h / 4))
  for (let i = 0; i < bands; i++) {
    const y = 2 + i * (h / (bands + 1))
    parts.push(paint(new THREE.BoxGeometry(w + 0.12, 0.7, d + 0.12), 0x9ec4dc, { pos: [0, y, 0] }))
  }
  return mergeGeometries(parts, false) as THREE.BufferGeometry
}

/** Rounded deciduous tree. */
export function makeTree(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const trunkH = 1.5 + rng() * 0.7
  parts.push(paint(new THREE.CylinderGeometry(0.16, 0.26, trunkH, 8), 0x8a5f3a, { pos: [0, trunkH / 2, 0] }))
  const blobs = 4
  for (let i = 0; i < blobs; i++) {
    const r = 0.95 + rng() * 0.5
    const a = (i / blobs) * Math.PI * 2
    parts.push(
      paint(new THREE.SphereGeometry(r, 10, 8), pick(rng, [0x5fae57, 0x6fbe63, 0x4f9a4f, 0x7ecf6c]), {
        pos: [Math.cos(a) * 0.55, trunkH + 0.6 + Math.sin(i) * 0.3, Math.sin(a) * 0.55],
      })
    )
  }
  parts.push(paint(new THREE.SphereGeometry(1.15, 10, 8), 0x66b85e, { pos: [0, trunkH + 1.25, 0] }))
  return mergeGeometries(parts, false) as THREE.BufferGeometry
}

/** Conifer. */
export function makePine(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const h = 3.4 + rng() * 1.4
  parts.push(paint(new THREE.CylinderGeometry(0.14, 0.22, h * 0.4, 8), 0x7a5334, { pos: [0, h * 0.2, 0] }))
  const tiers = 3
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers
    const r = 1.35 * (1 - t * 0.55)
    const y = h * (0.32 + t * 0.34)
    parts.push(paint(new THREE.ConeGeometry(r, h * 0.5, 9), pick(rng, [0x3f7a48, 0x4a8a52, 0x356b40]), { pos: [0, y, 0] }))
  }
  return mergeGeometries(parts, false) as THREE.BufferGeometry
}

export function makeBush(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 3; i++) {
    parts.push(
      paint(new THREE.SphereGeometry(0.42 + rng() * 0.22, 9, 7), pick(rng, [0x5aa851, 0x66b85e, 0x4d9448]), {
        pos: [(rng() - 0.5) * 0.6, 0.4 + rng() * 0.15, (rng() - 0.5) * 0.6],
      })
    )
  }
  return mergeGeometries(parts, false) as THREE.BufferGeometry
}

export function makeFlowers(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  parts.push(paint(new THREE.SphereGeometry(0.62, 10, 6), 0x63b25a, { scale: [1, 0.22, 1], pos: [0, 0.06, 0] }))
  const petals = [0xff8fb4, 0xffd45e, 0xfff4f4, 0xb08cff, 0xff9f4a]
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2
    const r = rng() * 0.5
    parts.push(
      paint(new THREE.SphereGeometry(0.1, 8, 6), pick(rng, petals), {
        pos: [Math.cos(a) * r, 0.2 + rng() * 0.12, Math.sin(a) * r],
      })
    )
  }
  return mergeGeometries(parts, false) as THREE.BufferGeometry
}

export function makeLamp(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  parts.push(paint(new THREE.CylinderGeometry(0.16, 0.22, 0.3, 10), 0x4a4f57, { pos: [0, 0.15, 0] }))
  parts.push(paint(new THREE.CylinderGeometry(0.075, 0.1, 4.2, 10), 0x59606a, { pos: [0, 2.2, 0] }))
  parts.push(paint(new THREE.BoxGeometry(0.16, 0.16, 0.9), 0x59606a, { pos: [0, 4.28, 0.4] }))
  parts.push(paint(new THREE.BoxGeometry(0.55, 0.24, 0.75), 0x6d747e, { pos: [0, 4.12, 0.72] }))
  parts.push(paint(new THREE.BoxGeometry(0.46, 0.1, 0.66), 0xfff6d8, { pos: [0, 3.99, 0.72] }))
  return mergeGeometries(parts, false) as THREE.BufferGeometry
}

export function makeFence(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const len = 4.4
  const color = pick(rng, [0xf3efe4, 0xd8c9a8, 0xbfae8e])
  for (let i = 0; i <= 6; i++) {
    const x = -len / 2 + (i / 6) * len
    parts.push(paint(new THREE.BoxGeometry(0.12, 0.95, 0.12), color, { pos: [x, 0.48, 0] }))
  }
  for (const y of [0.4, 0.78]) parts.push(paint(new THREE.BoxGeometry(len, 0.12, 0.1), color, { pos: [0, y, 0] }))
  return mergeGeometries(parts, false) as THREE.BufferGeometry
}

export function makeHedge(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const len = 3.2 + rng() * 1.6
  parts.push(paint(new THREE.BoxGeometry(len, 0.9, 0.7), 0x4d9448, { pos: [0, 0.45, 0] }))
  for (let i = 0; i < 4; i++) {
    parts.push(
      paint(new THREE.SphereGeometry(0.42, 8, 6), pick(rng, [0x5aa851, 0x66b85e]), {
        pos: [-len / 2 + 0.4 + (i / 3) * (len - 0.8), 0.92, (rng() - 0.5) * 0.3],
      })
    )
  }
  return mergeGeometries(parts, false) as THREE.BufferGeometry
}

export function makeBench(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  parts.push(paint(new THREE.BoxGeometry(1.7, 0.1, 0.5), 0xa8703f, { pos: [0, 0.46, 0] }))
  parts.push(paint(new THREE.BoxGeometry(1.7, 0.5, 0.09), 0xa8703f, { pos: [0, 0.72, -0.22] }))
  for (const side of [-1, 1]) {
    parts.push(paint(new THREE.BoxGeometry(0.1, 0.46, 0.46), 0x5c5f66, { pos: [side * 0.72, 0.23, 0] }))
  }
  return mergeGeometries(parts, false) as THREE.BufferGeometry
}

export function makeSign(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  parts.push(paint(new THREE.CylinderGeometry(0.06, 0.07, 2.3, 8), 0x6d747e, { pos: [0, 1.15, 0] }))
  const color = pick(rng, [0xd94f4f, 0x2f8f8f, 0x2f6f8f, 0xe0a02f])
  parts.push(paint(new THREE.BoxGeometry(0.75, 0.75, 0.08), 0xfdfaf3, { pos: [0, 2.35, 0] }))
  parts.push(paint(new THREE.BoxGeometry(0.6, 0.6, 0.1), color, { pos: [0, 2.35, 0.02] }))
  return mergeGeometries(parts, false) as THREE.BufferGeometry
}
