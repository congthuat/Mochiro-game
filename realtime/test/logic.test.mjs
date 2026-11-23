// node --test realtime/test
import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomCore, RULES, baseDistance, plausibleMax } from '../src/logic.js'

function harness(kind = 'quick', finish = async () => ({ rewarded: true, gold: 20, reason: 'ok' })) {
  let clock = 1_000_000
  let seed = 7
  const sent = new Map()
  const closed = new Map()
  const results = []
  let started = 0
  const io = {
    now: () => clock,
    random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
    send: (c, m) => (sent.get(c) ?? sent.set(c, []).get(c)).push(m),
    close: (c, code) => closed.set(c, code),
    verify: async (t) => (t.startsWith('ok:') ? { pid: t.slice(3), name: t.slice(3), ch: 'kai', g: t.includes('guest') } : null),
    finish: async (r) => (results.push(r), finish(r)),
    started: () => started++,
  }
  const room = new RoomCore('Q-TEST1', kind, io)
  const join = async (name) => {
    const c = { name }
    room.connect(c)
    await room.message(c, JSON.stringify({ type: 'hello', ticket: 'ok:' + name }))
    return c
  }
  const last = (c, type) => [...(sent.get(c) ?? [])].reverse().find((m) => m.type === type)
  const all = (c, type) => (sent.get(c) ?? []).filter((m) => m.type === type)
  const advance = (ms) => {
    const end = clock + ms
    while (clock < end) {
      clock = Math.min(end, clock + 250)
      room.tick()
    }
  }
  const run = async (c, seconds, extra = {}) => {
    const t = seconds
    await room.message(c, JSON.stringify({ type: 's', t, d: baseDistance(t), x: 0, y: 0, sl: false, f: 0, ...extra }))
  }
  return { room, io, join, last, all, advance, run, sent, closed, results, get clock() { return clock }, get started() { return started } }
}

const flush = () => new Promise((r) => setImmediate(r))

test('quick room waits 15 s after the second racer, then counts down', async () => {
  const h = harness()
  const a = await h.join('a')
  h.advance(30_000)
  assert.equal(h.room.state, 'lobby')
  const b = await h.join('b')
  assert.equal(h.last(a, 'room').players.length, 2)
  assert.ok(h.last(b, 'room').startsIn > 14_000)
  h.advance(14_500)
  assert.equal(h.room.state, 'lobby')
  h.advance(600)
  assert.equal(h.room.state, 'countdown')
  assert.equal(h.started, 1)
  const sa = h.last(a, 'start'), sb = h.last(b, 'start')
  assert.equal(sa.seed, sb.seed)
  assert.equal(sa.goAt - h.clock > 3000, true)
  h.advance(RULES.countdown)
  assert.equal(h.room.state, 'running')
})

test('quick room starts at once when full; a fifth is turned away', async () => {
  const h = harness()
  const cs = [await h.join('a'), await h.join('b'), await h.join('c'), await h.join('d')]
  assert.equal(h.room.state, 'countdown')
  const e = await h.join('e')
  assert.equal(h.last(e, 'error').code, 'started')
  assert.equal(h.closed.get(e), 4003)
  assert.equal(new Set(cs.map((c) => h.last(c, 'start').seed)).size, 1)
})

test('private room: only the host starts, and not alone', async () => {
  const h = harness('private')
  const a = await h.join('a')
  await h.room.message(a, JSON.stringify({ type: 'start' }))
  assert.equal(h.last(a, 'error').code, 'alone')
  const b = await h.join('b')
  await h.room.message(b, JSON.stringify({ type: 'start' }))
  assert.equal(h.room.state, 'lobby')
  h.advance(60_000)
  assert.equal(h.room.state, 'lobby', 'private rooms never auto-start')
  // host leaves → b becomes host
  h.room.closed(a)
  assert.equal(h.last(b, 'room').players[0].host, true)
  const c = await h.join('c')
  await h.room.message(b, JSON.stringify({ type: 'start' }))
  assert.equal(h.room.state, 'countdown')
  assert.ok(h.last(c, 'start'))
})

test('bad ticket is refused', async () => {
  const h = harness()
  const c = {}
  h.room.connect(c)
  await h.room.message(c, JSON.stringify({ type: 'hello', ticket: 'forged' }))
  assert.equal(h.last(c, 'error').code, 'ticket')
  assert.equal(h.closed.get(c), 4001)
})

async function cruise(h, players, from, to) {
  for (let s = from; s <= to; s++) {
    h.advance(1000)
    for (const p of players) await h.run(p, s)
  }
}

async function race(h, names) {
  const cs = []
  for (const n of names) cs.push(await h.join(n))
  if (h.room.kind === 'private') await h.room.message(cs[0], JSON.stringify({ type: 'start' }))
  else h.advance(RULES.quickWait + 300)
  h.advance(RULES.countdown + 100)
  assert.equal(h.room.state, 'running')
  return cs
}

test('last one standing wins; later out ranks higher; race ends only when all are out', async () => {
  const h = harness()
  const [a, b, c] = await race(h, ['a', 'b', 'c'])
  for (let s = 1; s <= 40; s++) {
    h.advance(1000)
    for (const p of [a, b, c]) if (h.room.players.get(p.name).status === 'alive') await h.run(p, s)
    if (s === 10) await h.room.message(b, JSON.stringify({ type: 'out', d: baseDistance(10) }))
    if (s === 25) await h.room.message(a, JSON.stringify({ type: 'out', d: baseDistance(25) }))
  }
  assert.equal(h.room.state, 'running', 'the last runner keeps going')
  assert.equal(h.last(c, 'last').id, h.room.players.get('c').id)
  assert.equal(h.all(a, 'last').length, 1)
  // c's relayed position reaches the spectators
  assert.ok(h.all(a, 's').some((m) => m.id === h.room.players.get('c').id))
  await h.room.message(c, JSON.stringify({ type: 'out', d: baseDistance(40) }))
  await flush()
  assert.equal(h.room.state, 'done')
  const end = h.last(a, 'end')
  assert.deepEqual(end.standings.map((s) => s.name), ['c', 'a', 'b'])
  assert.equal(h.results.length, 1)
  assert.deepEqual(h.results[0].players.map((p) => [p.pid, p.rank]), [['c', 1], ['a', 2], ['b', 3]])
  assert.ok(h.results[0].players[0].ms > 39_000)
  assert.equal(h.last(b, 'reward').gold, 20)
})

test('outs within 0.1 s tie on time, distance decides', async () => {
  const h = harness()
  const [a, b] = await race(h, ['a', 'b'])
  await cruise(h, [a, b], 1, 4)
  h.advance(1000)
  await h.run(a, 5)
  await h.run(b, 5, { d: baseDistance(5) + 8 })
  await h.room.message(a, JSON.stringify({ type: 'out', d: baseDistance(5) }))
  h.io.now = ((n) => () => n + 60)(h.clock)
  await h.room.message(b, JSON.stringify({ type: 'out', d: baseDistance(5) + 8 }))
  await flush()
  assert.deepEqual(h.last(a, 'end').standings.map((s) => s.name), ['b', 'a'])
})

test('disconnect: out at the moment the connection went, after 5 s grace; reconnect in time keeps you in', async () => {
  const h = harness()
  const [a, b, c] = await race(h, ['a', 'b', 'c'])
  h.advance(3000)
  for (const p of [a, b, c]) await h.run(p, 3)
  const goneAt = h.clock
  h.room.closed(b)
  h.room.closed(c)
  h.advance(2000)
  // c comes back
  const c2 = { name: 'c' }
  h.room.connect(c2)
  await h.room.message(c2, JSON.stringify({ type: 'hello', ticket: 'ok:c' }))
  assert.ok(h.last(c2, 'start'), 'reconnect gets the race again')
  for (let s = 6; s <= 12; s++) {
    h.advance(1000)
    await h.run(a, s)
    await h.run(c2, s)
  }
  const pb = h.room.players.get('b')
  assert.equal(pb.status, 'out')
  assert.equal(pb.reason, 'dropped')
  assert.equal(pb.outAt, goneAt)
  assert.equal(h.room.players.get('c').status, 'alive')
})

test('silent racer (connected but no samples) is out as of its last sample', async () => {
  const h = harness()
  const [a, b] = await race(h, ['a', 'b'])
  h.advance(1000)
  await h.run(a, 1)
  await h.run(b, 1)
  const lastB = h.clock
  for (let s = 2; s <= 9; s++) {
    h.advance(1000)
    await h.run(a, s)
  }
  const pb = h.room.players.get('b')
  assert.equal(pb.status, 'out')
  assert.equal(pb.outAt, lastB)
})

test('impossible distance is disqualified and ranked last', async () => {
  const h = harness()
  const [a, b, c] = await race(h, ['a', 'b', 'c'])
  await cruise(h, [a, b, c], 1, 9)
  h.advance(1000)
  await h.run(a, 10)
  await h.run(b, 10)
  await h.run(c, 10, { d: 5000 })
  const pc = h.room.players.get('c')
  assert.equal(pc.status, 'out')
  assert.equal(pc.reason, 'cheat')
  await h.room.message(b, JSON.stringify({ type: 'out', d: 300 }))
  h.advance(1000)
  await h.room.message(a, JSON.stringify({ type: 'out', d: 330 }))
  await flush()
  assert.deepEqual(h.results[0].players.map((p) => p.pid), ['a', 'b', 'c'])
  assert.equal(h.results[0].players[2].reason, 'cheat')
})

test('slightly fast is flagged, not removed; boosting the whole way is fine', async () => {
  const h = harness()
  const [a, b] = await race(h, ['a', 'b'])
  for (let s = 1; s <= 30; s++) {
    h.advance(1000)
    await h.run(a, s, { d: baseDistance(s) * 1.55 })
    await h.run(b, s, { d: plausibleMax(s + 1.5) * 1.1 })
  }
  assert.equal(h.room.players.get('a').flags.size, 0)
  assert.equal(h.room.players.get('b').status, 'alive')
  assert.ok(h.room.players.get('b').flags.has('speed'))
})

test('spectator strikes flag a runner that drives through obstacles', async () => {
  const h = harness()
  const [a, b, c] = await race(h, ['a', 'b', 'c'])
  h.advance(3000)
  await h.room.message(a, JSON.stringify({ type: 'out', d: 40 }))
  const idC = h.room.players.get('c').id
  // an alive player cannot strike
  await h.room.message(b, JSON.stringify({ type: 'strike', id: idC, at: 100 }))
  assert.equal(h.room.players.get('c').strikes.size, 0)
  await h.room.message(a, JSON.stringify({ type: 'strike', id: idC, at: 100 }))
  await h.room.message(a, JSON.stringify({ type: 'strike', id: idC, at: 100.4 }))
  assert.equal(h.room.players.get('c').flags.has('strikes'), false, 'the same obstacle twice is one strike')
  await h.room.message(a, JSON.stringify({ type: 'strike', id: idC, at: 180 }))
  assert.equal(h.room.players.get('c').flags.has('strikes'), true)
})

test('leaving mid-race keeps your place; garbage messages are ignored', async () => {
  const h = harness()
  const [a, b] = await race(h, ['a', 'b'])
  for (const junk of ['', 'x', '{"type":"s","d":"NaN"}', '{"type":"s","d":1e99,"x":0,"y":0,"t":0}', 'null', '[]', '{"type":"start"}', 'a'.repeat(5000)]) {
    await h.room.message(b, junk)
  }
  assert.equal(h.room.players.get('b').status, 'alive')
  await cruise(h, [a, b], 1, 4)
  await h.room.message(b, JSON.stringify({ type: 'leave' }))
  assert.equal(h.room.players.get('b').reason, 'left')
  for (let s = 5; s <= 20; s++) {
    h.advance(1000)
    await h.run(a, s)
  }
  await h.room.message(a, JSON.stringify({ type: 'out', d: baseDistance(20) }))
  await flush()
  assert.deepEqual(h.results[0].players.map((p) => [p.pid, p.reason]), [['a', 'crash'], ['b', 'left']])
})

test('backend down: the race still ends, reward says offline', async () => {
  const h = harness('quick', async () => null)
  const [a, b] = await race(h, ['a', 'b'])
  h.advance(1000)
  await h.room.message(a, JSON.stringify({ type: 'out', d: 10 }))
  await h.room.message(b, JSON.stringify({ type: 'out', d: 12 }))
  await flush()
  assert.equal(h.last(a, 'reward').reason, 'offline')
  assert.equal(h.room.state, 'done')
})

test('a second tab takes over the seat', async () => {
  const h = harness()
  const a = await h.join('a')
  const a2 = await h.join('a')
  assert.equal(h.last(a, 'error').code, 'replaced')
  assert.equal(h.room.players.size, 1)
  assert.equal(h.last(a2, 'room').players.length, 1)
})

test('a frozen game (hidden tab) falls behind the clock and is out as of when it fell behind', async () => {
  const h = harness()
  const [a, b] = await race(h, ['a', 'b'])
  await cruise(h, [a, b], 1, 20)
  // b stops moving at 20 s but keeps reporting; a runs on.
  const frozen = baseDistance(20)
  let behindAt = 0
  for (let s = 21; s <= 40 && h.room.players.get('b').status === 'alive'; s++) {
    h.advance(1000)
    await h.run(a, s)
    await h.run(b, s, { d: frozen })
    if (!behindAt && frozen < baseDistance((h.clock - h.room.goAt) / 1000 - RULES.lagGrace)) behindAt = h.clock
  }
  const out = h.all(a, 'out').find((m) => m.id === h.room.players.get('b').id)
  assert.ok(out, 'b is out')
  assert.equal(out.reason, 'lag')
  assert.ok(behindAt > 0)
  // Out as of the moment it fell behind, not when the referee was sure (2 s later).
  assert.equal(h.room.players.get('b').outAt, behindAt)
  assert.ok(h.clock - behindAt >= RULES.lagHold)
  assert.equal(h.room.players.get('a').status, 'alive')
})

test('a short stall (a few seconds lost) is forgiven', async () => {
  const h = harness()
  const [a, b] = await race(h, ['a', 'b'])
  for (let s = 1; s <= 60; s++) {
    h.advance(1000)
    await h.run(a, s)
    // b's game runs 6 s behind the race clock the whole way.
    await h.run(b, s, { d: baseDistance(s - 6) })
  }
  assert.equal(h.room.players.get('b').status, 'alive')
  assert.equal(h.room.players.get('a').status, 'alive')
})
