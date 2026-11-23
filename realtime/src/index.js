// Mochiro live race server (Cloudflare Worker + Durable Objects).
//
//   GET  /ws?quick=1        quick race: the matchmaker picks the room that is filling
//   GET  /ws?code=ABCD      a private room
//   POST /room              open a private room → { code }
//
// One Durable Object per room runs the referee in ./logic.js; the matchmaker is a single
// Durable Object that only remembers which quick room is currently filling.

import { DurableObject } from 'cloudflare:workers'
import { RoomCore, makeCode } from './logic.js'
import { fromB64url, importSignKey, importVerifyKey, signResult, verifyTicket } from './crypto.js'

const PRIVATE_CODE = /^[A-HJ-NP-Z2-9]{4}$/
const QUICK_CODE = /^Q-[A-HJ-NP-Z2-9]{5}$/
const PRIVATE_TTL = 30 * 60 * 1000

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors } })

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true })

    if (url.pathname === '/room' && request.method === 'POST') {
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = makeCode(Math.random, 4)
        const stub = env.ROOM.get(env.ROOM.idFromName(code))
        const res = await stub.fetch(`https://room/init?code=${code}&kind=private`, { method: 'POST' })
        if (res.ok) return json({ code })
      }
      return json({ error: 'busy' }, 503)
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade') !== 'websocket') return json({ error: 'websocket' }, 426)
      let code = (url.searchParams.get('code') || '').toUpperCase()
      if (url.searchParams.get('quick')) {
        const mm = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('quick'))
        const skip = url.searchParams.get('skip') || ''
        const res = await mm.fetch(`https://mm/quick?skip=${encodeURIComponent(skip)}`)
        code = (await res.json()).code
      }
      if (!PRIVATE_CODE.test(code) && !QUICK_CODE.test(code)) return json({ error: 'code' }, 400)
      const stub = env.ROOM.get(env.ROOM.idFromName(code))
      return stub.fetch(`https://room/ws?code=${code}`, request)
    }

    return json({ error: 'not found' }, 404)
  },
}

// ------------------------------------------------------------------ keys --
let ticketKey = null
let ticketKeyAt = 0

async function getTicketKey(env, fresh = false) {
  if (ticketKey && Date.now() - ticketKeyAt < (fresh ? 30 * 1000 : 10 * 60 * 1000)) return ticketKey
  const res = await fetch(`${env.BACKEND_URL}/api/race/key`)
  if (!res.ok) throw new Error('key ' + res.status)
  const { key } = await res.json()
  ticketKey = await importVerifyKey(fromB64url(key))
  ticketKeyAt = Date.now()
  return ticketKey
}

let resultKey = null
async function getResultKey(env) {
  if (!resultKey) resultKey = await importSignKey(fromB64url(env.RESULT_KEY))
  return resultKey
}

// ------------------------------------------------------------------ room --
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.env = env
    this.core = null
    this.timer = null
    this.sockets = new Set()
  }

  async fetch(request) {
    const url = new URL(request.url)
    const code = url.searchParams.get('code') || ''

    if (url.pathname === '/init') {
      const existing = await this.ctx.storage.get('room')
      if (existing && Date.now() - existing.at < PRIVATE_TTL) return new Response('taken', { status: 409 })
      await this.ctx.storage.put('room', { code, kind: 'private', at: Date.now() })
      await this.ctx.storage.setAlarm(Date.now() + PRIVATE_TTL)
      this.core = null
      return new Response('ok')
    }

    let room = await this.ctx.storage.get('room')
    if (!room && QUICK_CODE.test(code)) {
      room = { code, kind: 'quick', at: Date.now() }
      await this.ctx.storage.put('room', room)
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()
    if (!room) {
      server.send(JSON.stringify({ type: 'error', code: 'nocode' }))
      server.close(4006, 'nocode')
      return new Response(null, { status: 101, webSocket: client })
    }
    if (!this.core) this.core = this.makeCore(room)
    const core = this.core
    this.sockets.add(server)
    core.connect(server)
    server.addEventListener('message', (event) => {
      if (this.core === core) void core.message(server, typeof event.data === 'string' ? event.data : '')
    })
    const gone = () => {
      if (!this.sockets.delete(server)) return
      if (this.core === core) core.closed(server)
    }
    server.addEventListener('close', gone)
    server.addEventListener('error', gone)
    if (!this.timer) this.timer = setInterval(() => this.tick(), 250)
    return new Response(null, { status: 101, webSocket: client })
  }

  makeCore(room) {
    const env = this.env
    return new RoomCore(room.code, room.kind, {
      now: () => Date.now(),
      random: Math.random,
      send: (ws, msg) => {
        try {
          ws.send(JSON.stringify(msg))
        } catch {
          /* closed */
        }
      },
      close: (ws, code, reason) => {
        this.sockets.delete(ws)
        try {
          ws.close(code, reason)
        } catch {
          /* closed */
        }
      },
      verify: async (ticket) => {
        try {
          const ok = await verifyTicket(ticket, await getTicketKey(env), Date.now())
          // The backend may have changed its key: look again (at most every 30 s) before refusing.
          return ok ?? (await verifyTicket(ticket, await getTicketKey(env, true), Date.now()))
        } catch {
          return null
        }
      },
      finish: async (result) => {
        const signed = await signResult(result, await getResultKey(env))
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetch(`${env.BACKEND_URL}/api/race/result`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(signed),
            })
            if (res.ok) return await res.json()
            if (res.status < 500) return { rewarded: false, gold: 0, reason: 'rejected' }
          } catch {
            /* retry */
          }
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
        }
        return null
      },
      started: () => {
        if (room.kind !== 'quick') return
        const mm = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('quick'))
        this.ctx.waitUntil(mm.fetch(`https://mm/rotate?code=${room.code}`, { method: 'POST' }).catch(() => {}))
      },
    })
  }

  tick() {
    const core = this.core
    if (!core) return this.stopTimer()
    core.tick()
    if (core.idle) {
      for (const ws of this.sockets) {
        try {
          ws.close(1000, 'done')
        } catch {
          /* closed */
        }
      }
      this.sockets.clear()
      this.core = null
      this.stopTimer()
      // A finished room's code is free again; an empty private lobby keeps its code
      // until the alarm (the host may just be reloading).
      if (core.state !== 'lobby' || core.kind === 'quick') this.ctx.waitUntil(this.ctx.storage.deleteAll())
    }
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async alarm() {
    if (this.core && this.core.state !== 'lobby') {
      await this.ctx.storage.setAlarm(Date.now() + PRIVATE_TTL)
      return
    }
    if (this.core && this.sockets.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + PRIVATE_TTL)
      return
    }
    this.core = null
    this.stopTimer()
    await this.ctx.storage.deleteAll()
  }
}

// ------------------------------------------------------------ matchmaker --
export class Matchmaker extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.current = null
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/rotate') {
      if (this.current === url.searchParams.get('code')) this.current = null
      return new Response('ok')
    }
    // A client that was turned away by the current room (it started a moment ago)
    // asks again with ?skip=<that code>.
    const skip = url.searchParams.get('skip')
    if (!this.current || this.current === skip) this.current = 'Q-' + makeCode(Math.random, 5)
    return Response.json({ code: this.current })
  }
}
