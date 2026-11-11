// The runner: a cel-shaded chibi character with a painted face, layered hair,
// tailored clothing and a full run / jump / slide / boost pose set.
import * as THREE from 'three'
import { type CharacterSpec } from './config'
import { starDecalTexture } from './textures'
import { AvatarFx } from './avatarFx'
import { ball, capsule, faceTexture, rounded, strand, toon, toonRamp, withOutline } from './chibi'
import { clamp, damp } from './utils'

export interface AvatarState {
  speed01: number
  onGround: boolean
  sliding: boolean
  boosting: boolean
  /** Sideways velocity, used for the lean. */
  laneVelocity: number
  time: number
  /** 'menu' keeps the runner idle, 'gameover' plays the crash. */
  mode?: 'menu' | 'playing' | 'gameover'
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t

interface PartOptions {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
  outline?: number
  shadow?: boolean
}

export class RunnerAvatar {
  readonly root = new THREE.Group()
  /** The procedural rig has no crash clip; the runner tips it over instead. */
  readonly hasDeathAnimation = false
  readonly animName = 'procedural'

  private body = new THREE.Group()
  private hips = new THREE.Group()
  private torso = new THREE.Group()
  private neck = new THREE.Group()
  private head = new THREE.Group()
  private hairGroup = new THREE.Group()
  private ponytail: THREE.Group | null = null
  private ponytailTip: THREE.Group | null = null
  private armL = new THREE.Group()
  private armR = new THREE.Group()
  private elbowL = new THREE.Group()
  private elbowR = new THREE.Group()
  private legL = new THREE.Group()
  private legR = new THREE.Group()
  private kneeL = new THREE.Group()
  private kneeR = new THREE.Group()
  private footL = new THREE.Group()
  private footR = new THREE.Group()
  private facing = new THREE.Group()
  private fx = new AvatarFx(0.46, 0.85)
  private disposables: Array<{ dispose: () => void }> = []

  private runPhase = 0
  private airBlend = 0
  /** 0 = upright, 1 = full slide. Reported so a check can see the duck engage. */
  slideBlend = 0
  private shieldLevel = 0
  private hairLag = 0
  private tailLag = 0
  private tailLag2 = 0
  private squash = 0
  private wasGrounded = true

  constructor(spec: CharacterSpec) {
    const ramp = toonRamp()
    const skinMat = toon(spec.skin, ramp)
    const hairMat = toon(spec.hair, ramp)
    const hairDeepMat = toon(new THREE.Color(spec.hair).multiplyScalar(0.72).getHex(), ramp)
    const outfitMat = toon(spec.outfit, ramp)
    const outfitDarkMat = toon(spec.outfitDark, ramp)
    const shirtMat = toon(spec.shirt, ramp)
    const bottomMat = toon(spec.bottom, ramp)
    const shoeMat = toon(spec.shoe, ramp)
    const soleMat = toon(spec.sole, ramp)
    const accentMat = toon(spec.accent, ramp, { emissive: new THREE.Color(spec.accent), emissiveIntensity: 0.18 })
    const gloveMat = toon(spec.glove, ramp)
    const darkMat = toon(0x3b3355, ramp)
    const metalMat = toon(0xf7f2e4, ramp, { emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.08 })

    this.disposables.push(ramp, skinMat, hairMat, hairDeepMat, outfitMat, outfitDarkMat, shirtMat, bottomMat, shoeMat, soleMat, accentMat, gloveMat, darkMat, metalMat)

    const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, options: PartOptions = {}): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material)
      if (options.position) mesh.position.set(...options.position)
      if (options.rotation) mesh.rotation.set(...options.rotation)
      if (options.scale) mesh.scale.set(...options.scale)
      mesh.castShadow = options.shadow ?? true
      mesh.receiveShadow = false
      if (options.outline && options.outline > 0) withOutline(mesh, options.outline)
      parent.add(mesh)
      return mesh
    }

    this.hips.position.y = 0.6
    // The rig is authored looking down +z; the runner travels down -z, so the
    // whole body is turned around once here (the root stays free for the lean).
    this.facing.rotation.y = Math.PI
    this.root.add(this.body)
    this.root.add(this.fx.group)
    this.body.add(this.facing)
    this.facing.add(this.hips)
    this.facing.add(this.torso)

    // ------------------------------------------------------------ legs -----
    for (const [side, leg, knee, foot] of [
      [-1, this.legL, this.kneeL, this.footL],
      [1, this.legR, this.kneeR, this.footR],
    ] as const) {
      leg.position.set(side * 0.115, -0.03, 0)
      this.hips.add(leg)
      add(leg, capsule(0.078, 0.1), spec.hairStyle === 'ponytail' ? soleMat : skinMat, {
        position: [0, -0.12, 0],
        outline: 1.08,
      })
      knee.position.set(0, -0.24, 0)
      leg.add(knee)
      add(knee, capsule(0.064, 0.1), spec.hairStyle === 'ponytail' ? soleMat : skinMat, {
        position: [0, -0.115, 0],
        outline: 1.09,
      })
      foot.position.set(0, -0.24, 0)
      knee.add(foot)
      // Sneaker: sole, upper, toe cap, laces, accent stripe, star decal.
      add(foot, rounded(0.2, 0.055, 0.31, 0.026), soleMat, { position: [0, -0.045, 0.015], outline: 1.06 })
      add(foot, rounded(0.185, 0.115, 0.28, 0.05), shoeMat, { position: [0, 0.015, 0], outline: 1.06 })
      add(foot, rounded(0.175, 0.09, 0.11, 0.04), shoeMat, { position: [0, 0.005, 0.11] })
      add(foot, rounded(0.075, 0.02, 0.09, 0.008), metalMat, { position: [0, 0.075, 0.05] })
      add(foot, rounded(0.075, 0.02, 0.09, 0.008), metalMat, { position: [0, 0.062, 0.11] })
      add(foot, rounded(0.2, 0.028, 0.26, 0.01), accentMat, { position: [0, -0.012, 0] })
      const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(0.1, 0.1),
        new THREE.MeshBasicMaterial({ map: starDecalTexture(), transparent: true, depthWrite: false })
      )
      decal.position.set(side * 0.1, 0.02, -0.01)
      decal.rotation.y = side * Math.PI * 0.5
      foot.add(decal)
      this.disposables.push(decal.geometry, decal.material as THREE.Material)
    }

    // ------------------------------------------------------- hips + top -----
    add(
      this.hips,
      spec.hairStyle === 'ponytail' ? new THREE.CylinderGeometry(0.19, 0.32, 0.24, 16, 1, true) : rounded(0.33, 0.26, 0.27, 0.07),
      spec.hairStyle === 'ponytail' ? bottomMat : bottomMat,
      { position: [0, -0.06, 0], outline: 1.05 }
    )
    if (spec.hairStyle === 'ponytail') {
      add(this.hips, rounded(0.35, 0.07, 0.29, 0.03), accentMat, { position: [0, 0.05, 0] })
    }
    add(this.hips, rounded(0.36, 0.12, 0.3, 0.06), bottomMat, { position: [0, 0.06, 0] })

    this.torso.position.set(0, 0.0, 0)
    this.hips.add(this.torso)

    // Inner tee + jacket shell.
    add(this.torso, rounded(0.34, 0.42, 0.26, 0.09), shirtMat, { position: [0, 0.24, 0], outline: 1.05 })
    add(this.torso, rounded(0.42, 0.4, 0.32, 0.1), outfitMat, { position: [0, 0.23, 0], outline: 1.045 })
    add(this.torso, rounded(0.44, 0.075, 0.34, 0.03), outfitDarkMat, { position: [0, 0.05, 0], outline: 1.05 })
    add(this.torso, rounded(0.035, 0.34, 0.02, 0.008), metalMat, { position: [0, 0.22, 0.168] })
    // Collar wings.
    add(this.torso, rounded(0.17, 0.1, 0.13, 0.04), outfitDarkMat, {
      position: [-0.11, 0.43, 0.05],
      rotation: [0.2, 0.34, 0.22],
    })
    add(this.torso, rounded(0.17, 0.1, 0.13, 0.04), outfitDarkMat, {
      position: [0.11, 0.43, 0.05],
      rotation: [0.2, -0.34, -0.22],
    })
    // Chest badge.
    const badge = new THREE.Mesh(
      new THREE.CircleGeometry(0.052, 20),
      new THREE.MeshBasicMaterial({ map: starDecalTexture(), transparent: true, depthWrite: false })
    )
    badge.position.set(-0.12, 0.32, 0.172)
    this.torso.add(badge)
    this.disposables.push(badge.geometry, badge.material as THREE.Material)

    // Bag: backpack for Sam, satchel for Bobbilee.
    if (spec.hairStyle === 'spiky') {
      add(this.torso, rounded(0.3, 0.34, 0.17, 0.06), accentMat, { position: [0, 0.26, -0.235], outline: 1.06 })
      add(this.torso, rounded(0.07, 0.3, 0.04, 0.015), outfitDarkMat, { position: [-0.13, 0.3, 0.14] })
      add(this.torso, rounded(0.07, 0.3, 0.04, 0.015), outfitDarkMat, { position: [0.13, 0.3, 0.14] })
    } else {
      add(this.torso, rounded(0.24, 0.2, 0.12, 0.045), accentMat, { position: [0.16, 0.06, 0.06], rotation: [0, 0.5, 0], outline: 1.07 })
      add(this.torso, rounded(0.05, 0.46, 0.04, 0.014), accentMat, { position: [0.05, 0.28, 0.16], rotation: [0, 0, -0.5] })
    }

    // ------------------------------------------------------------ arms -----
    for (const [side, arm, elbow] of [
      [-1, this.armL, this.elbowL],
      [1, this.armR, this.elbowR],
    ] as const) {
      arm.position.set(side * 0.245, 0.4, 0)
      this.torso.add(arm)
      add(arm, ball(0.1), outfitMat, { position: [0, 0, 0], outline: 1.07 })
      add(arm, capsule(0.072, 0.11), outfitMat, { position: [0, -0.09, 0], outline: 1.08 })
      elbow.position.set(0, -0.18, 0)
      arm.add(elbow)
      add(elbow, capsule(0.064, 0.1), outfitMat, { position: [0, -0.08, 0], outline: 1.09 })
      add(elbow, new THREE.CylinderGeometry(0.072, 0.068, 0.07, 14), outfitDarkMat, { position: [0, -0.155, 0] })
      add(elbow, ball(0.078, 18, 14), gloveMat, { position: [0, -0.225, 0], outline: 1.07 })
    }

    // ------------------------------------------------------------ head -----
    this.neck.position.set(0, 0.44, 0)
    this.torso.add(this.neck)
    add(this.neck, new THREE.CylinderGeometry(0.062, 0.07, 0.09, 14), skinMat, { position: [0, 0.03, 0] })
    this.head.position.set(0, 0.09, 0)
    this.neck.add(this.head)

    const headR = 0.315
    const headTexture = faceTexture(spec)
    this.disposables.push(headTexture)
    // The emissive lift must follow the face texture, otherwise a flat skin glow
    // washes the eyes out.
    const headMat = toon(0xffffff, ramp, {
      map: headTexture,
      emissiveMap: headTexture,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.32,
    })
    const skull = add(this.head, ball(headR, 40, 28), headMat, {
      position: [0, 0.3, 0],
      scale: [1, 1.02, 0.98],
      outline: 1.035,
    })
    // SphereGeometry maps u = 0.5 to +x; turn the head so the painted face looks +z.
    skull.rotation.y = -Math.PI / 2
    skull.receiveShadow = false
    // Ears.
    add(this.head, ball(0.055, 14, 12), skinMat, { position: [-0.3, 0.29, 0], scale: [0.6, 1, 0.8] })
    add(this.head, ball(0.055, 14, 12), skinMat, { position: [0.3, 0.29, 0], scale: [0.6, 1, 0.8] })

    // ------------------------------------------------------------ hair -----
    this.hairGroup.position.set(0, 0.3, 0)
    this.head.add(this.hairGroup)
    this.buildHair(spec, hairMat, hairDeepMat, accentMat, add)

  }

  // ------------------------------------------------------------------ hair --

  private buildHair(
    spec: CharacterSpec,
    hairMat: THREE.Material,
    hairDeepMat: THREE.Material,
    accentMat: THREE.Material,
    add: (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, options?: PartOptions) => THREE.Mesh
  ): void {
    const R = 0.315
    // Scalp cap so no skin shows through the strands.
    const cap = new THREE.SphereGeometry(R * 1.035, 28, 20, 0, Math.PI * 2, 0, 1.15)
    add(this.hairGroup, cap, hairMat, { position: [0, 0.0, 0], scale: [1, 1.02, 1], outline: 1.04 })
    // Nape volume.
    add(this.hairGroup, ball(R * 0.62, 18, 14), hairMat, { position: [0, -0.02, -0.14], scale: [1.3, 1, 0.9], outline: 1.06 })

    const spiky = spec.hairStyle === 'spiky'
    // Strand placement uses spherical coordinates around the skull so the fringe,
    // crown and back locks all sit exactly on the scalp.
    const place = (theta: number, phi: number, out = 1.03): [number, number, number] => [
      Math.sin(theta) * Math.sin(phi) * R * out,
      Math.cos(phi) * R * out,
      Math.cos(theta) * Math.sin(phi) * R * out,
    ]

    // Bangs / fringe: roots on the hairline, tips falling just above the brows.
    const bangCount = spiky ? 9 : 8
    for (let i = 0; i < bangCount; i++) {
      const t = i / (bangCount - 1)
      const theta = mix(-1.12, 1.12, t)
      const centre = 1 - Math.abs(theta) / 1.12
      const geo = strand({
        length: (spiky ? 0.19 : 0.21) + centre * 0.03,
        width: spiky ? 0.105 : 0.125,
        thickness: spiky ? 0.06 : 0.08,
        bend: spiky ? 0.24 : 0.16,
        tipRadius: spiky ? 0.03 : 0.14,
      })
      const mesh = add(this.hairGroup, geo, i % 3 === 1 ? hairDeepMat : hairMat, {
        position: place(theta, 0.66),
        outline: 1.06,
      })
      mesh.rotation.order = 'YXZ'
      mesh.rotation.set(2.74, theta * 0.9, -Math.sin(theta) * 0.55)
      mesh.castShadow = false
    }

    // Crown volume / spikes.
    const crownCount = spiky ? 7 : 4
    for (let i = 0; i < crownCount; i++) {
      const t = i / (crownCount - 1)
      const theta = mix(-1.5, 1.5, t)
      const geo = strand({
        length: spiky ? 0.3 + Math.cos(theta) * 0.07 : 0.26,
        width: spiky ? 0.12 : 0.15,
        thickness: spiky ? 0.065 : 0.11,
        bend: spiky ? 0.3 : 0.2,
        tipRadius: spiky ? 0.03 : 0.16,
      })
      const mesh = add(this.hairGroup, geo, hairMat, {
        position: place(theta, 0.42),
        outline: 1.06,
      })
      mesh.rotation.order = 'YXZ'
      mesh.rotation.set(-0.62, theta * 0.75, Math.sin(theta) * 0.8)
      mesh.castShadow = false
    }

    // Back locks.
    for (let i = 0; i < 5; i++) {
      const t = i / 4
      const theta = Math.PI + mix(-1.25, 1.25, t)
      const geo = strand({
        length: 0.32,
        width: 0.13,
        thickness: 0.085,
        bend: 0.22,
        tipRadius: spiky ? 0.04 : 0.12,
      })
      const mesh = add(this.hairGroup, geo, hairDeepMat, {
        position: place(theta, 0.92),
        outline: 1.06,
      })
      mesh.rotation.order = 'YXZ'
      mesh.rotation.set(4.05, theta, Math.sin(theta) * 0.35)
      mesh.castShadow = false
    }

    if (spiky) {
      // Ahoge + sideburns.
      const ahoge = add(
        this.hairGroup,
        strand({ length: 0.24, width: 0.05, thickness: 0.04, bend: 0.32, tipRadius: 0.02 }),
        hairMat,
        { position: place(0.1, 0.3), outline: 1.08 }
      )
      ahoge.rotation.order = 'YXZ'
      ahoge.rotation.set(-0.95, 0.15, 0.35)
      for (const side of [-1, 1]) {
        const burn = add(
          this.hairGroup,
          strand({ length: 0.26, width: 0.07, thickness: 0.06, bend: 0.1, tipRadius: 0.03 }),
          hairMat,
          { position: place(side * 1.42, 0.95), outline: 1.07 }
        )
        burn.rotation.order = 'YXZ'
        burn.rotation.set(2.9, side * 1.42, side * 0.16)
      }
      return
    }

    // Bobbilee: side locks, ponytail, bow.
    for (const side of [-1, 1]) {
      const lock = add(
        this.hairGroup,
        strand({ length: 0.52, width: 0.105, thickness: 0.09, bend: 0.14, tipRadius: 0.07 }),
        hairMat,
        { position: place(side * 1.34, 0.95), outline: 1.06 }
      )
      lock.rotation.order = 'YXZ'
      lock.rotation.set(3.02, side * 1.34, side * 0.1)
    }

    this.ponytail = new THREE.Group()
    this.ponytail.position.set(0, 0.12, -0.26)
    this.hairGroup.add(this.ponytail)
    add(this.ponytail, ball(0.1, 16, 12), accentMat, { position: [0, -0.02, -0.02], scale: [1, 0.8, 0.8], outline: 1.08 })
    // Bow petals.
    for (const side of [-1, 1]) {
      add(this.ponytail, rounded(0.17, 0.14, 0.05, 0.055), accentMat, {
        position: [side * 0.13, 0.03, -0.03],
        rotation: [0, side * 0.35, side * 0.25],
        outline: 1.08,
      })
    }
    this.ponytailTip = new THREE.Group()
    this.ponytailTip.position.set(0, -0.06, -0.12)
    this.ponytail.add(this.ponytailTip)
    for (let i = 0; i < 5; i++) {
      const t = i / 4
      const theta = mix(-0.5, 0.5, t)
      const tail = add(
        this.ponytailTip,
        strand({
          length: 0.5 + Math.cos(theta) * 0.08,
          width: 0.11,
          thickness: 0.09,
          bend: 0.36,
          tipRadius: 0.05,
        }),
        i % 2 === 0 ? hairMat : hairDeepMat,
        { position: [Math.sin(theta) * 0.07, -0.02, 0], outline: 1.07 }
      )
      tail.rotation.order = 'YXZ'
      tail.rotation.set(4.28, theta * 0.7, Math.sin(theta) * 0.3)
    }
  }

  // ------------------------------------------------------------- controls --

  /** The procedural rig is driven every frame, so it is always fully weighted. */
  get animWeight(): number {
    return 1
  }

  /** The procedural rig has no clip playhead. */
  get animTime(): number {
    return this.runPhase
  }

  /** Dev-only: hide the hair so the painted face can be inspected. */
  debugHair(on: boolean): void {
    this.hairGroup.visible = on
  }

  setShield(active: boolean): void {
    this.fx.setShield(active)
  }

  /** 0 = hidden, 1 = full opacity, used for the shield pop animation. */
  setShieldLevel(level: number): void {
    this.shieldLevel = clamp(level, 0, 1)
    this.fx.setShieldLevel(this.shieldLevel)
  }

  update(dt: number, state: AvatarState): void {
    const speed01 = clamp(state.speed01, 0, 1)
    this.runPhase += dt * (7 + speed01 * 11)
    this.airBlend = damp(this.airBlend, state.onGround ? 0 : 1, 13, dt)
    this.slideBlend = damp(this.slideBlend, state.sliding ? 1 : 0, 17, dt)
    if (!this.wasGrounded && state.onGround) this.squash = 1
    this.wasGrounded = state.onGround
    this.squash = damp(this.squash, 0, 9, dt)

    const swing = 0.5 + speed01 * 0.85
    const sinL = Math.sin(this.runPhase)
    const sinR = Math.sin(this.runPhase + Math.PI)

    let legLTarget = sinL * swing
    let legRTarget = sinR * swing
    let kneeLTarget = Math.max(0, -sinL) * 1.4
    let kneeRTarget = Math.max(0, -sinR) * 1.4
    let footLTarget = -Math.cos(this.runPhase) * 0.34
    let footRTarget = -Math.cos(this.runPhase + Math.PI) * 0.34
    let armLTarget = -sinL * swing * 0.9
    let armRTarget = -sinR * swing * 0.9
    let elbowTarget = 0.75 + speed01 * 0.45
    let hipsTarget = 0.6 + Math.abs(Math.sin(this.runPhase)) * 0.055 * (1 - speed01 * 0.4)
    let torsoPitch = 0.06 + speed01 * 0.17

    // Air pose: tuck, arms up.
    legLTarget = mix(legLTarget, -0.85, this.airBlend)
    legRTarget = mix(legRTarget, -0.3, this.airBlend)
    kneeLTarget = mix(kneeLTarget, 1.6, this.airBlend)
    kneeRTarget = mix(kneeRTarget, 0.7, this.airBlend)
    footLTarget = mix(footLTarget, -0.25, this.airBlend)
    footRTarget = mix(footRTarget, 0.2, this.airBlend)
    armLTarget = mix(armLTarget, -1.7, this.airBlend)
    armRTarget = mix(armRTarget, -1.3, this.airBlend)
    elbowTarget = mix(elbowTarget, 0.9, this.airBlend)
    hipsTarget = mix(hipsTarget, 0.66, this.airBlend)
    torsoPitch = mix(torsoPitch, 0.24, this.airBlend)

    // Slide pose: low, feet first.
    legLTarget = mix(legLTarget, -1.45, this.slideBlend)
    legRTarget = mix(legRTarget, -1.1, this.slideBlend)
    kneeLTarget = mix(kneeLTarget, 0.25, this.slideBlend)
    kneeRTarget = mix(kneeRTarget, 0.5, this.slideBlend)
    footLTarget = mix(footLTarget, 0.35, this.slideBlend)
    footRTarget = mix(footRTarget, 0.3, this.slideBlend)
    armLTarget = mix(armLTarget, 1.0, this.slideBlend)
    armRTarget = mix(armRTarget, 1.25, this.slideBlend)
    elbowTarget = mix(elbowTarget, 0.35, this.slideBlend)
    hipsTarget = mix(hipsTarget, 0.3, this.slideBlend)
    torsoPitch = mix(torsoPitch, -0.6, this.slideBlend)

    // Boost pose: streamlined.
    if (state.boosting) {
      torsoPitch += 0.15
      armLTarget = 1.65
      armRTarget = 1.65
      elbowTarget = 0.2
      legLTarget = mix(legLTarget, -0.2, 0.5)
      legRTarget = mix(legRTarget, -0.55, 0.5)
    }

    // Squash on landing keeps the weight readable.
    const squash = this.squash * 0.16
    this.body.scale.set(1 + squash * 0.55, 1 - squash, 1 + squash * 0.55)
    this.body.position.y = damp(this.body.position.y, state.sliding ? -0.02 : 0, 12, dt)

    this.hips.position.y = damp(this.hips.position.y, hipsTarget, 16, dt)
    this.hips.rotation.y = damp(this.hips.rotation.y, Math.sin(this.runPhase) * 0.16 * (1 - this.airBlend), 14, dt)
    this.torso.rotation.x = damp(this.torso.rotation.x, torsoPitch, 14, dt)
    this.torso.rotation.y = damp(this.torso.rotation.y, -Math.sin(this.runPhase) * 0.2 * (1 - this.airBlend), 12, dt)
    this.legL.rotation.x = damp(this.legL.rotation.x, legLTarget, 18, dt)
    this.legR.rotation.x = damp(this.legR.rotation.x, legRTarget, 18, dt)
    this.legL.rotation.z = damp(this.legL.rotation.z, -0.04, 10, dt)
    this.legR.rotation.z = damp(this.legR.rotation.z, 0.04, 10, dt)
    this.kneeL.rotation.x = damp(this.kneeL.rotation.x, -kneeLTarget, 18, dt)
    this.kneeR.rotation.x = damp(this.kneeR.rotation.x, -kneeRTarget, 18, dt)
    this.footL.rotation.x = damp(this.footL.rotation.x, footLTarget, 16, dt)
    this.footR.rotation.x = damp(this.footR.rotation.x, footRTarget, 16, dt)
    this.armL.rotation.x = damp(this.armL.rotation.x, armLTarget, 18, dt)
    this.armR.rotation.x = damp(this.armR.rotation.x, armRTarget, 18, dt)
    this.armL.rotation.z = damp(this.armL.rotation.z, 0.16 + this.airBlend * 0.25, 12, dt)
    this.armR.rotation.z = damp(this.armR.rotation.z, -0.16 - this.airBlend * 0.25, 12, dt)
    this.elbowL.rotation.x = damp(this.elbowL.rotation.x, -elbowTarget, 16, dt)
    this.elbowR.rotation.x = damp(this.elbowR.rotation.x, -elbowTarget, 16, dt)

    // Head: looks into the corner it is running toward, bobs with the stride.
    this.neck.rotation.x = damp(
      this.neck.rotation.x,
      -torsoPitch * 0.45 - Math.sin(this.runPhase * 2) * 0.03 + this.airBlend * -0.06,
      10,
      dt
    )
    this.head.rotation.z = damp(this.head.rotation.z, clamp(-state.laneVelocity * 0.035, -0.18, 0.18), 9, dt)
    this.head.rotation.x = damp(this.head.rotation.x, Math.sin(this.runPhase * 2) * 0.02, 8, dt)

    // Hair reacts with spring-style lag.
    this.hairLag = damp(this.hairLag, clamp(state.laneVelocity * 0.04, -0.34, 0.34), 6, dt)
    this.hairGroup.rotation.z = this.hairLag
    this.hairGroup.rotation.x = damp(
      this.hairGroup.rotation.x,
      -0.08 - speed01 * 0.18 + Math.sin(this.runPhase * 0.5) * 0.03 + (state.onGround ? 0 : -0.2),
      7,
      dt
    )
    if (this.ponytail && this.ponytailTip) {
      const drive = 0.16 + speed01 * 0.55 + (state.onGround ? 0 : 0.35)
      this.tailLag = damp(this.tailLag, drive + this.hairLag * 0.6, 5, dt)
      this.tailLag2 = damp(this.tailLag2, drive * 0.8 + this.hairLag * 0.5, 3.5, dt)
      this.ponytail.rotation.x = this.tailLag
      this.ponytail.rotation.z = damp(this.ponytail.rotation.z, this.hairLag * 0.8, 5, dt)
      this.ponytailTip.rotation.x = this.tailLag2 * 0.9
      this.ponytailTip.rotation.z = damp(this.ponytailTip.rotation.z, this.hairLag, 4, dt)
    }

    // Lean into lane changes, dip forward with speed.
    const lean = clamp(-state.laneVelocity * 0.05, -0.4, 0.4)
    this.root.rotation.z = damp(this.root.rotation.z, lean, 12, dt)
    this.root.rotation.y = damp(this.root.rotation.y, clamp(-state.laneVelocity * 0.02, -0.15, 0.15), 10, dt)

    // Thruster, trails and contact shadow.
    this.fx.update(state.boosting && state.mode !== 'gameover', Math.max(0, this.root.position.y))
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose()
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
    })
    this.fx.dispose()
    this.root.clear()
    this.disposables.length = 0
  }
}
