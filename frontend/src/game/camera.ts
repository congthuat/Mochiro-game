// Third-person orbit camera: smooth follow, terrain avoidance, shake and FOV kick.
import * as THREE from 'three'
import type { WorldRef } from './world/zone'
import { clamp, damp } from './utils'

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  yaw = Math.PI
  pitch = 0.34

  private distance = 9.5
  private targetDistance = 9.5
  private shakeAmount = 0
  private fovTarget = 62
  private currentPos = new THREE.Vector3()
  private currentLook = new THREE.Vector3()
  private initialized = false

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 1400)
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  shake(amount: number): void {
    this.shakeAmount = Math.min(1.4, this.shakeAmount + amount)
  }

  setFovBoost(amount: number): void {
    this.fovTarget = 62 + amount
  }

  snap(playerPos: THREE.Vector3, world: WorldRef): void {
    this.initialized = false
    this.update(0.016, playerPos, { x: 0, z: 0, active: false }, { x: 0, y: 0 }, 0, 1, world, false, false)
    this.initialized = true
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    moveDir: { x: number; z: number; active: boolean },
    look: { x: number; y: number },
    zoom: number,
    sensitivity: number,
    world: WorldRef,
    sprinting: boolean,
    dragging: boolean
  ): void {
    this.yaw -= look.x * 0.0036 * sensitivity
    this.pitch = clamp(this.pitch + look.y * 0.0026 * sensitivity, -0.28, 1.02)

    if (!dragging && moveDir.active) {
      const desiredYaw = Math.atan2(-moveDir.x, -moveDir.z)
      let diff = ((desiredYaw - this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI
      if (diff < -Math.PI) diff += Math.PI * 2
      this.yaw += diff * Math.min(1, dt * 1.5)
    }

    if (zoom !== 0) {
      this.targetDistance = clamp(this.targetDistance + zoom * 0.012, 4.8, 16)
    }
    this.distance = damp(this.distance, this.targetDistance, 7, dt)

    const head = new THREE.Vector3(playerPos.x, playerPos.y + 1.5, playerPos.z)
    const cp = Math.cos(this.pitch)
    const offset = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(
      this.distance
    )
    const desired = head.clone().add(offset)

    // Terrain clearance along the camera boom.
    let lift = 0
    for (const t of [0.4, 0.65, 0.85, 1]) {
      const sample = head.clone().lerp(desired, t)
      const required = world.heightAt(sample.x, sample.z) + 0.85
      if (sample.y < required) lift = Math.max(lift, required - sample.y)
    }
    desired.y += lift

    const lambda = this.initialized ? 13 : 1000
    this.currentPos.x = damp(this.currentPos.x, desired.x, lambda, dt)
    this.currentPos.y = damp(this.currentPos.y, desired.y, lambda, dt)
    this.currentPos.z = damp(this.currentPos.z, desired.z, lambda, dt)

    const lookTarget = head.clone().add(new THREE.Vector3(0, 0.3, 0))
    this.currentLook.x = damp(this.currentLook.x, lookTarget.x, this.initialized ? 16 : 1000, dt)
    this.currentLook.y = damp(this.currentLook.y, lookTarget.y, this.initialized ? 16 : 1000, dt)
    this.currentLook.z = damp(this.currentLook.z, lookTarget.z, this.initialized ? 16 : 1000, dt)

    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.9)
    const shake = this.shakeAmount * this.shakeAmount * 0.45
    const shakeX = (Math.random() - 0.5) * shake
    const shakeY = (Math.random() - 0.5) * shake
    const shakeZ = (Math.random() - 0.5) * shake

    this.camera.position.set(this.currentPos.x + shakeX, this.currentPos.y + shakeY, this.currentPos.z + shakeZ)
    this.camera.lookAt(this.currentLook.x, this.currentLook.y, this.currentLook.z)

    const targetFov = sprinting ? 66 : this.fovTarget
    this.camera.fov = damp(this.camera.fov, targetFov, 5, dt)
    this.camera.updateProjectionMatrix()
    this.initialized = true
  }
}
