/**
 * Headless self-check for the Aetherfall game logic (no WebGL required).
 *
 *   cd frontend && bun run scripts/game-smoke.ts
 *
 * Verifies terrain generation, zone definitions, upgrade pool, enemy spawning
 * and the player controller physics for every zone.
 */
import * as THREE from 'three'
import { TerrainField, mulberry32 } from '../src/game/noise'
import { ZONES } from '../src/game/zones'
import { BASE_STATS, pickUpgradeChoices, UPGRADES } from '../src/game/config'
import { Player } from '../src/game/entities/player'
import { EnemyManager } from '../src/game/entities/enemies'
import { findSpawnSpot } from '../src/game/world/props'
import { ZoneWorld } from '../src/game/world/zone'
import { PickupManager } from '../src/game/entities/pickups'
import { QUALITY_PRESETS } from '../src/game/config'
import { EffectsSystem } from '../src/game/effects'
import { AudioEngine } from '../src/game/audio'
import type { WorldRef } from '../src/game/world/zone'

let failures = 0

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures++
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function makeStubWorld(zoneIndex: number): WorldRef {
  const zone = ZONES[zoneIndex]
  const field = new TerrainField(
    { seed: zone.seed, maxHeight: zone.maxHeight, islandRadius: zone.islandRadius, sharpness: zone.sharpness },
    240
  )
  const group = new THREE.Group()
  const spawn = findSpawnSpot(field, zone.islandRadius, mulberry32(zone.seed + 21))
  return {
    zone,
    field,
    colliders: [],
    group,
    spawnPoint: new THREE.Vector3(spawn.x, spawn.y, spawn.z),
    portalSpot: new THREE.Vector3(20, field.height(20, 0), 0),
    heightAt: (x: number, z: number) => field.height(x, z),
    resolveCollision: () => undefined,
    update: () => undefined,
    dispose: () => undefined,
  } as WorldRef
}

console.log('Aetherfall smoke test\n')

console.log('Zone terrain:')
ZONES.forEach((zone, index) => {
  const world = makeStubWorld(index)
  const rng = mulberry32(zone.seed + 7)
  let land = 0
  let water = 0
  let minH = Infinity
  let maxH = -Infinity
  for (let i = 0; i < 3000; i++) {
    const x = (rng() - 0.5) * 220
    const z = (rng() - 0.5) * 220
    const h = world.field.height(x, z)
    if (!Number.isFinite(h)) {
      check(`${zone.name}: finite heights`, false)
      return
    }
    if (h > 0.6) land++
    else water++
    minH = Math.min(minH, h)
    maxH = Math.max(maxH, h)
  }
  const spawnSlope = world.field.slope(world.spawnPoint.x, world.spawnPoint.z)
  check(
    `${zone.name}`,
    land > 800 && world.spawnPoint.y > 2.2 && spawnSlope < 0.25,
    `land ${((land / 3000) * 100).toFixed(0)}% · height ${minH.toFixed(1)}..${maxH.toFixed(1)} · spawn y=${world.spawnPoint.y.toFixed(2)} slope=${spawnSlope.toFixed(2)}`
  )
})

console.log('\nProgression:')
const rng = mulberry32(99)
let uniqueOk = true
for (let i = 0; i < 200; i++) {
  const picks = pickUpgradeChoices(rng, 3)
  if (picks.length !== 3) uniqueOk = false
  const ids = new Set(picks.map((p) => p.id))
  if (ids.size !== 3) uniqueOk = false
}
check('upgrade choices are unique sets of three', uniqueOk)
check('upgrade pool is complete', UPGRADES.length >= 10, `${UPGRADES.length} upgrades`)

const stats = { ...BASE_STATS }
UPGRADES.forEach((u) => u.apply(stats))
check(
  'all upgrades apply without breaking stats',
  Number.isFinite(stats.maxHp) && Number.isFinite(stats.attackDamage) && stats.moveSpeed > BASE_STATS.moveSpeed,
  `hp ${stats.maxHp.toFixed(0)} · dmg ${stats.attackDamage.toFixed(0)} · speed ${stats.moveSpeed.toFixed(1)}`
)

console.log('\nEnemy spawning:')
ZONES.forEach((zone, index) => {
  const world = makeStubWorld(index)
  const manager = new EnemyManager(zone)
  manager.spawnZone(world, mulberry32(zone.seed + 3), new THREE.Vector3(0, 0, 0))
  const expected = zone.enemies.wisp + zone.enemies.sentry + zone.enemies.brute + (zone.boss ? 1 : 0)
  const spawned = manager.enemies.length
  const bossOk = zone.boss ? manager.boss !== null : manager.boss === null
  check(
    `${zone.name}`,
    spawned >= Math.max(1, Math.floor(expected * 0.7)) && bossOk,
    `${spawned}/${expected} hostiles placed${zone.boss ? ' (boss present)' : ''}`
  )
  // One update tick must not throw with a distant player.
  const ctx = {
    playerPos: new THREE.Vector3(0, 5, 0),
    playerAlive: true,
    playerRadius: 0.5,
    world,
    effects: new EffectsSystem(64, mulberry32(1)),
    audio: new AudioEngine(),
    projectiles: { spawn: () => undefined, update: () => undefined } as any,
    damagePlayer: () => undefined,
    spawnMinion: () => undefined,
  }
  manager.update(1 / 60, 0.5, ctx as any)
  manager.dispose()
})

// ---------------------------------------------------------------------------
// World assembly (terrain, water, scenery, pickups, combat) with a canvas shim
// so the browser-only code paths are exercised headlessly.
// ---------------------------------------------------------------------------
type Ctx2D = Record<string, any>

function installCanvasShim(): void {
  const makeCtx = (): Ctx2D => ({
    clearRect: () => undefined,
    fillRect: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    stroke: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  })
  const makeCanvas = () => ({
    width: 0,
    height: 0,
    style: {},
    getContext: (kind: string) => (kind === '2d' ? makeCtx() : null),
  })
  const doc = {
    createElement: (tag: string) => (tag === 'canvas' ? makeCanvas() : { style: {} }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  ;(globalThis as unknown as { document: unknown }).document = doc
}

installCanvasShim()

console.log('\nWorld assembly (all five zones):')
for (let index = 0; index < ZONES.length; index++) {
  const zone = ZONES[index]
  const built = new ZoneWorld(zone, QUALITY_PRESETS.medium, mulberry32(zone.seed + 5))
  built.buildGround()
  built.buildScenery()
  const effects = new EffectsSystem(256, mulberry32(index + 1))
  const pickups = new PickupManager(built, zone, mulberry32(index + 2), effects)
  pickups.openPortal()

  // 90 simulated frames of world + pickup + effect updates.
  for (let frame = 0; frame < 90; frame++) {
    const dt = 1 / 60
    built.update(dt, frame * dt, built.spawnPoint)
    effects.update(dt)
    pickups.update(dt, frame * dt, built.spawnPoint, 2.4, { onShard: () => undefined, onOrb: () => undefined })
  }

  const expectedShards = zone.shards
  const portalDistance = pickups.portalDistance(built.spawnPoint)
  check(
    `${zone.name} world`,
    built.colliders.length > 20 && pickups.totalShards >= Math.ceil(expectedShards * 0.75) && Number.isFinite(portalDistance),
    `props ${built.colliders.length} · shards ${pickups.totalShards}/${expectedShards} · orbs ${pickups.totalOrbs} · portal ${portalDistance.toFixed(1)}u from spawn`
  )

  pickups.dispose()
  effects.dispose()
  built.dispose()
}

console.log('\nCombat:')
{
  const zone = ZONES[0]
  const built = new ZoneWorld(zone, QUALITY_PRESETS.medium, mulberry32(42))
  built.buildGround()
  built.buildScenery()
  const effects = new EffectsSystem(256, mulberry32(43))
  const audio = new AudioEngine()
  const manager = new EnemyManager(zone)

  // Spawn three wisps directly in front of the player and blast them.
  const playerPos = built.spawnPoint.clone()
  const facing = new THREE.Vector3(0, 0, 1)
  for (let i = 0; i < 3; i++) {
    const spot = playerPos.clone().addScaledVector(facing, 2.5 + i * 0.6)
    manager.spawnMinion('wisp', spot)
  }
  const before = manager.aliveCount
  const result = manager.damageInArc(playerPos, facing, 5, Math.cos(Math.PI * 0.42), 999)
  check(
    'pulse blast hits enemies in the arc',
    result.hits === before && result.kills.length === before,
    `${result.hits} hits · ${result.kills.length} kills`
  )
  const combatCtx = {
    playerPos,
    playerAlive: true,
    playerRadius: 0.5,
    world: built,
    effects,
    audio,
    projectiles: { spawn: () => undefined, update: () => undefined } as any,
    damagePlayer: () => undefined,
    spawnMinion: () => undefined,
  }
  // Death animation runs for ~0.4s before the corpses are recycled.
  for (let frame = 0; frame < 45; frame++) manager.update(1 / 60, 1 + frame / 60, combatCtx as any)
  check('defeated enemies are retired from the scene', manager.enemies.length === 0, `${manager.enemies.length} left`)

  manager.dispose()
  effects.dispose()
  built.dispose()
}

console.log('\nPlayer controller:')
const world = makeStubWorld(0)
const effects = new EffectsSystem(128, mulberry32(5))
const audio = new AudioEngine()
const player = new Player(effects, audio, mulberry32(11), { ...BASE_STATS })
player.spawnAt(world.spawnPoint, world)
const startX = player.position.x
const startZ = player.position.z
const intent = { moveX: 0, moveZ: -1, sprint: true, jump: false, attack: false, dash: false, cameraYaw: 0 }
let airborneSeen = false
for (let i = 0; i < 240; i++) {
  intent.jump = i === 60
  player.update(1 / 60, intent, world, i / 60)
  if (!player.onGround) airborneSeen = true
}
const travelled = Math.hypot(player.position.x - startX, player.position.z - startZ)
check('player moves when input is applied', travelled > 5, `Δ ${travelled.toFixed(1)} units`)
check('jump leaves the ground', airborneSeen)

// Let the guardian settle, then verify ground contact.
const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false, attack: false, dash: false, cameraYaw: 0 }
for (let i = 0; i < 150; i++) player.update(1 / 60, idle, world, 5 + i / 60)
const surfaceGap = Math.abs(player.position.y - world.heightAt(player.position.x, player.position.z))
check(
  'player settles on the terrain surface',
  player.onGround && surfaceGap < 0.05,
  `y ${player.position.y.toFixed(2)} · gap ${surfaceGap.toFixed(3)}`
)
check('player survives a long sprint', player.hp === player.stats.maxHp)

const before = player.hp
player.takeDamage(20)
check('damage reduces health and grants i-frames', player.hp === before - 20 && player.invuln > 0, `hp ${player.hp}`)
player.takeDamage(20)
check('invulnerability window blocks a second hit', player.hp === before - 20)

player.dispose()
effects.dispose()

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
if (failures > 0) process.exit(1)
