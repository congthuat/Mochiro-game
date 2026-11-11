// Extra kit bolted onto a rigged hero.
//
// The KayKit rig exposes `handslot.l/r` and `chest`, so a quiver can be parented
// straight to the skeleton and then animate with it — it rides the torso through
// the run cycle. Everything is built here in world metres and rescaled to the
// model's own units, and every piece is oriented by aligning the bone's frame with
// the character's frame, so the result does not depend on how the exporter happened
// to orient the bone.
//
// Weapons are *not* built here: every rig already ships its own, mounted on the
// hand slots, so a class is defined by switching the rig's props on and off (see
// `hideNodes` in config.ts) rather than by modelling new ones.
import * as THREE from 'three'

export interface GearSpec {
  /** Bolt quiver strapped across the back. */
  quiver?: boolean
}

const LEATHER = 0x3c2a1c
const BRASS = 0xc9a13f
const FLETCH = 0xd8503c

function woodMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.66, metalness: 0.04 })
}

function leatherMaterial(color = LEATHER): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02 })
}

export function buildQuiver(): THREE.Group {
  const group = new THREE.Group()
  const bodyMaterial = leatherMaterial(0x4a3220)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.44, 12, 1, true), bodyMaterial)
  group.add(body)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.02, 12), leatherMaterial(0x33220f))
  cap.position.y = -0.225
  group.add(cap)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.012, 6, 14), leatherMaterial(0x6b4a2c))
  rim.rotation.x = Math.PI / 2
  rim.position.y = 0.218
  group.add(rim)
  for (const [y, radius] of [
    [0.06, 0.08],
    [-0.06, 0.078],
  ] as const) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.009, 6, 14), leatherMaterial(0x6b4a2c))
    band.rotation.x = Math.PI / 2
    band.position.y = y
    group.add(band)
  }

  const shaftMaterial = woodMaterial(0xd8c39a)
  const fletchMaterial = new THREE.MeshStandardMaterial({ color: FLETCH, roughness: 0.7, metalness: 0 })
  const fletchMaterialAlt = new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.7, metalness: 0 })
  const tipMaterial = new THREE.MeshStandardMaterial({ color: BRASS, roughness: 0.4, metalness: 0.5 })
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2
    const offset = new THREE.Vector3(Math.cos(angle) * 0.032, 0.3, Math.sin(angle) * 0.032)
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.34, 5), shaftMaterial)
    shaft.position.copy(offset)
    shaft.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.04
    group.add(shaft)
    for (const side of [1, -1]) {
      const vane = new THREE.Mesh(
        new THREE.BoxGeometry(0.004, 0.06, 0.026),
        i % 2 === 0 ? fletchMaterial : fletchMaterialAlt
      )
      vane.position.copy(offset).add(new THREE.Vector3(0, 0.13, 0))
      vane.rotation.y = (side * Math.PI) / 2
      group.add(vane)
    }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.05, 6), tipMaterial)
    tip.position.copy(offset).add(new THREE.Vector3(0, -0.17, 0))
    group.add(tip)
  }
  return group
}

/**
 * glTF loader sanitises node names (`handslot.l` arrives as `handslotl`), so match
 * bones on a normalised name rather than on the exported spelling.
 */
function findBone(root: THREE.Object3D, candidates: string[]): THREE.Object3D | null {
  // Candidate order is priority order: a rig has both `spine` and `chest`, and the
  // traversal happens to meet the lower one first.
  for (const candidate of candidates) {
    const wanted = normalise(candidate)
    let found: THREE.Object3D | null = null
    root.traverse((object) => {
      if (!found && normalise(object.name) === wanted) found = object
    })
    if (found) return found
  }
  return null
}

function normalise(name: string): string {
  return name.replace(/\s/g, '_').replace(/[\[\].:/]/g, '').toLowerCase()
}

/**
 * A node whose axes match the character's own (up = +y, forward = +z) and whose
 * scale makes one unit equal one world metre, whatever the bone underneath does.
 * Gear is then placed with plain metres, independent of the rig's bone scales.
 */
function holderFor(bone: THREE.Object3D, root: THREE.Object3D): THREE.Group {
  root.updateWorldMatrix(true, true)
  const holder = new THREE.Group()
  // Work out the holder's local matrix by construction: whatever the bone does,
  // the gear inside must end up axis-aligned with the character and scaled so one
  // unit is one world metre. Solving it as a matrix sidesteps non-uniform or
  // sheared bone scales, which a quaternion + scalar cannot express.
  const boneWorld = bone.matrixWorld.clone()
  const position = new THREE.Vector3()
  const rootQuat = new THREE.Quaternion()
  boneWorld.decompose(position, new THREE.Quaternion(), new THREE.Vector3())
  root.getWorldQuaternion(rootQuat)
  const desired = new THREE.Matrix4().compose(position, rootQuat, new THREE.Vector3(1, 1, 1))
  holder.matrixAutoUpdate = false
  holder.matrix.copy(boneWorld.invert().multiply(desired))
  bone.add(holder)
  return holder
}

/** Parents the requested kit to the skeleton. Silently skips missing bones. */
export interface AttachOptions {
  /** Rendered height of the character in world metres. */
  height: number
}

export function attachGear(root: THREE.Object3D, gear: GearSpec, options: AttachOptions): void {
  if (!gear.quiver) return

  // The quiver rides the torso rather than the hand: the run cycle swings the arms
  // through a wide arc, which would tumble anything hand-held in every direction.
  const back = findBone(root, ['chest', 'upperchest', 'torso', 'spine'])
  if (!back) return
  const holder = holderFor(back, root)
  // This rig keeps its joints in a compressed space (the armature is scaled and the
  // skin's inverse bind matrices put the mesh back to size), so the chest bone sits
  // at roughly half the character's height. Place the kit against the *body*, not
  // against the bone, by measuring the bone and offsetting from there.
  const boneAt = new THREE.Vector3()
  back.getWorldPosition(boneAt)
  const waist = options.height * 0.55 - boneAt.y

  const quiver = buildQuiver()
  quiver.name = 'gear:quiver'
  quiver.position.set(0.12, waist - options.height * 0.16, -0.32)
  quiver.rotation.set(-0.2, 0, -0.5)
  holder.add(quiver)

  // Strap over the shoulder, so the quiver is not floating.
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.014, 6, 18, Math.PI * 1.25), leatherMaterial(0x54391f))
  strap.position.set(0.02, 0, -0.08)
  strap.rotation.set(0.1, 0, 0.42)
  holder.add(strap)
}
