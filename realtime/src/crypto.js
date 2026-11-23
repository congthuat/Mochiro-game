// Tickets (signed by the game's backend: "this connection is player X") and results
// (signed here: "this is how race M ended"). Ed25519 through WebCrypto, which both the
// Workers runtime and Node 22 provide.

const enc = new TextEncoder()
const dec = new TextDecoder()

export function toB64url(bytes) {
  let bin = ''
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function importVerifyKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify'])
}

export async function importSignKey(pkcs8) {
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign'])
}

/** `payload.sig` → the payload when the signature holds and it has not expired, else null. */
export async function verifyTicket(ticket, key, now) {
  if (typeof ticket !== 'string' || ticket.length > 1500) return null
  const dot = ticket.indexOf('.')
  if (dot <= 0) return null
  const body = ticket.slice(0, dot)
  try {
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, fromB64url(ticket.slice(dot + 1)), enc.encode(body))
    if (!ok) return null
    const data = JSON.parse(dec.decode(fromB64url(body)))
    if (!data || typeof data.pid !== 'string' || typeof data.exp !== 'number' || data.exp < now) return null
    return data
  } catch {
    return null
  }
}

/** → { body, sig } as sent to the backend. */
export async function signResult(result, key) {
  const body = toB64url(enc.encode(JSON.stringify(result)))
  const sig = toB64url(await crypto.subtle.sign({ name: 'Ed25519' }, key, enc.encode(body)))
  return { body, sig }
}
