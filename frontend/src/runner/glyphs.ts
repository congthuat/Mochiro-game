// Pickup glyphs: every power-up carries an extruded 3D icon of what it does, so
// the player reads the effect before they read the colour. Bodies are white and
// take the pickup's tint; accents stay dark so the silhouette holds up at speed.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { PowerKind } from './types'

const BODY = 0xffffff
const DARK = 0x2b3242
const TRIM = 0xdfe9f7

function tint(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
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

function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry {
  return tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex)
}

function cylinder(r: number, h: number, x: number, y: number, z: number, hex: number, rx = 0): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(r, r, h, 20, 1)
  geometry.rotateX(rx)
  return tint(geometry.translate(x, y, z), hex)
}

function sphere(r: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry {
  return tint(new THREE.SphereGeometry(r, 16, 12).translate(x, y, z), hex)
}

function cone(r: number, h: number, x: number, y: number, z: number, hex: number, rz = 0): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(r, h, 14, 1)
  if (rz) geometry.rotateZ(rz)
  return tint(geometry.translate(x, y, z), hex)
}

function extrude(shape: THREE.Shape, depth: number, hex: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.015,
    bevelThickness: 0.015,
    bevelSegments: 2,
    curveSegments: 14,
  })
  geometry.center()
  return tint(geometry, hex)
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  return (merged ?? parts[0]) as THREE.BufferGeometry
}

/** Classic shield: a wide top that tapers to a point. */
function shieldShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-0.5, 0.5)
  shape.lineTo(0.5, 0.5)
  shape.lineTo(0.5, -0.02)
  shape.quadraticCurveTo(0.46, -0.44, 0, -0.6)
  shape.quadraticCurveTo(-0.46, -0.44, -0.5, -0.02)
  shape.closePath()
  return shape
}

/** Lightning bolt. */
function boltShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(0.12, 0.62)
  shape.lineTo(-0.42, 0.04)
  shape.lineTo(-0.06, 0.04)
  shape.lineTo(-0.16, -0.62)
  shape.lineTo(0.42, -0.02)
  shape.lineTo(0.04, -0.02)
  shape.closePath()
  return shape
}

/** Coin with a raised rim, used twice for the doubler. */
function coinStack(): THREE.BufferGeometry {
  const front = cylinder(0.34, 0.1, -0.12, -0.08, 0.05, BODY, Math.PI / 2)
  const back = cylinder(0.34, 0.1, 0.14, 0.12, -0.04, TRIM, Math.PI / 2)
  const rim = cylinder(0.2, 0.12, -0.12, -0.08, 0.05, DARK, Math.PI / 2)
  return merge([back, front, rim])
}

/** Horseshoe magnet: an arc with two legs and bright pole tips. */
function magnetGlyph(): THREE.BufferGeometry {
  const arc = new THREE.TorusGeometry(0.34, 0.13, 12, 26, Math.PI)
  const left = box(0.26, 0.42, 0.26, -0.34, -0.16, 0, BODY)
  const right = box(0.26, 0.42, 0.26, 0.34, -0.16, 0, BODY)
  const tipL = box(0.28, 0.12, 0.28, -0.34, -0.4, 0, DARK)
  const tipR = box(0.28, 0.12, 0.28, 0.34, -0.4, 0, DARK)
  return merge([tint(arc, BODY), left, right, tipL, tipR])
}

/** Ghost: a rounded body with a ragged skirt. */
function ghostGlyph(): THREE.BufferGeometry {
  const head = sphere(0.34, 0, 0.16, 0, BODY)
  const body = box(0.68, 0.42, 0.5, 0, -0.12, 0, BODY)
  const feet = [-0.24, 0, 0.24].map((x) => box(0.2, 0.2, 0.5, x, -0.4, 0, BODY))
  const eyes = [box(0.12, 0.16, 0.12, -0.13, 0.16, 0.26, DARK), box(0.12, 0.16, 0.12, 0.13, 0.16, 0.26, DARK)]
  return merge([head, body, ...feet, ...eyes])
}

/** Two arrows pulling opposite ways: the mirror-controls hazard. */
function invertGlyph(): THREE.BufferGeometry {
  const parts = [
    box(0.66, 0.13, 0.26, 0, 0.22, 0, BODY),
    cone(0.17, 0.24, -0.42, 0.22, 0, BODY, Math.PI / 2),
    box(0.66, 0.13, 0.26, 0, -0.22, 0, TRIM),
    cone(0.17, 0.24, 0.42, -0.22, 0, TRIM, -Math.PI / 2),
  ]
  return merge(parts)
}

/** Smoke puff: overlapping lobes. */
function fogGlyph(): THREE.BufferGeometry {
  const parts = [
    sphere(0.26, -0.24, -0.02, 0, BODY),
    sphere(0.34, 0.06, 0.1, 0, BODY),
    sphere(0.24, 0.36, -0.04, 0, BODY),
    box(0.9, 0.2, 0.4, 0.02, -0.2, 0, BODY),
    box(0.5, 0.06, 0.42, 0.0, -0.34, 0, DARK),
  ]
  return merge(parts)
}

/** Downward arrow over a weight bar: heavy gravity. */
function heavyGlyph(): THREE.BufferGeometry {
  const parts = [
    box(0.2, 0.5, 0.26, 0, 0.12, 0, BODY),
    cone(0.3, 0.36, 0, -0.28, 0, BODY, Math.PI),
    box(0.86, 0.16, 0.32, 0, -0.56, 0, DARK),
  ]
  return merge(parts)
}

const CACHE = new Map<PowerKind, THREE.BufferGeometry>()

/** Returns the shared glyph geometry for a pickup kind. */
export function powerGlyph(kind: PowerKind): THREE.BufferGeometry {
  const cached = CACHE.get(kind)
  if (cached) return cached
  let geometry: THREE.BufferGeometry
  switch (kind) {
    case 'shield':
      geometry = extrude(shieldShape(), 0.16, BODY)
      break
    case 'boost':
      geometry = extrude(boltShape(), 0.16, BODY)
      break
    case 'double':
      geometry = coinStack()
      break
    case 'magnet':
      geometry = magnetGlyph()
      break
    case 'ghost':
      geometry = ghostGlyph()
      break
    case 'invert':
      geometry = invertGlyph()
      break
    case 'fog':
      geometry = fogGlyph()
      break
    default:
      geometry = heavyGlyph()
      break
  }
  geometry.computeVertexNormals()
  CACHE.set(kind, geometry)
  return geometry
}

/** Frees every cached glyph (the whole game is torn down on unmount). */
export function disposeGlyphs(): void {
  for (const geometry of CACHE.values()) geometry.dispose()
  CACHE.clear()
}
