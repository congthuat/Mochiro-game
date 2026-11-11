// Arc project branding for the runner: live project card + logo proxy.
//
// The coin texture in the game is the real Arc project icon, resolved through the
// Surf project catalog at runtime. The logo is proxied through this route so the
// browser can load it into a WebGL texture without cross-origin tainting.
const { Router } = require('express')
const { dataApi } = require('@surf-ai/sdk/server')

const router = Router()

const PROJECT_SLUG = process.env.ARC_PROJECT_SLUG || 'arc'
const PROJECT_QUERY = process.env.ARC_PROJECT_QUERY || 'arc'
const CARD_TTL_MS = 10 * 60 * 1000

let cardCache = { at: 0, value: null }
let logoCache = { at: 0, url: null, bytes: null, contentType: 'image/png' }

async function resolveProject() {
  // Preferred: exact project lookup by slug/name.
  try {
    const response = await dataApi.project.detail({ q: PROJECT_QUERY, fields: ['overview', 'social'] })
    const overview = response?.data?.overview
    if (overview?.name) {
      return {
        id: overview.id ?? null,
        name: overview.name,
        symbol: overview.token_symbol ?? null,
        slug: overview.slug ?? PROJECT_SLUG,
        description: overview.description ?? '',
        tags: overview.tags ?? [],
        website: overview.website ?? null,
        x_handle: overview.x_handle ?? response?.data?.social?.twitter?.handle ?? null,
        followers: overview.x_followers ?? response?.data?.social?.twitter?.followers_count ?? null,
        logo_url: overview.logo_url ?? null,
      }
    }
  } catch (error) {
    console.warn('[arc] project detail lookup failed:', error?.message ?? error)
  }

  // Fallback: keyword search, preferring the configured slug.
  const search = await dataApi.get('search/project', { q: PROJECT_QUERY, limit: 8 })
  const items = Array.isArray(search?.data) ? search.data : []
  const match = items.find((item) => item?.slug === PROJECT_SLUG) ?? items[0]
  if (!match) throw new Error('arc project not found')
  return {
    id: match.id ?? null,
    name: match.name ?? 'Arc',
    symbol: match.symbol ?? null,
    slug: match.slug ?? PROJECT_SLUG,
    description: match.description ?? '',
    tags: match.tags ?? [],
    website: null,
    x_handle: null,
    followers: null,
    logo_url: match.logo_url ?? null,
  }
}

async function projectCard() {
  const now = Date.now()
  if (cardCache.value && now - cardCache.at < CARD_TTL_MS) return cardCache.value
  const card = await resolveProject()
  cardCache = { at: now, value: card }
  return card
}

// GET /api/arc/project — branding card used by the game UI.
router.get('/project', async (_req, res) => {
  try {
    const card = await projectCard()
    res.json({ ...card, logo: card.logo_url ? 'logo' : null })
  } catch (error) {
    console.error('[arc] project card failed', error)
    // The game must still run if the catalog is unreachable — it falls back to
    // a procedurally drawn emblem on the client.
    res.json({
      id: null,
      name: 'Arc',
      symbol: null,
      slug: PROJECT_SLUG,
      description: '',
      tags: [],
      website: null,
      x_handle: null,
      followers: null,
      logo_url: null,
      logo: null,
      degraded: true,
    })
  }
})

// GET /api/arc/logo — same-origin image proxy (cacheable, CORS-friendly).
router.get('/logo', async (_req, res) => {
  try {
    const card = await projectCard()
    if (!card.logo_url) return res.status(404).json({ error: 'no_logo' })

    const now = Date.now()
    if (!logoCache.bytes || logoCache.url !== card.logo_url || now - logoCache.at > CARD_TTL_MS) {
      const upstream = await fetch(card.logo_url)
      if (!upstream.ok) throw new Error(`upstream ${upstream.status}`)
      const buffer = Buffer.from(await upstream.arrayBuffer())
      logoCache = {
        at: now,
        url: card.logo_url,
        bytes: buffer,
        contentType: upstream.headers.get('content-type') || 'image/png',
      }
    }

    res.set('Content-Type', logoCache.contentType)
    res.set('Cache-Control', 'public, max-age=3600')
    res.set('Access-Control-Allow-Origin', '*')
    res.send(logoCache.bytes)
  } catch (error) {
    console.error('[arc] logo proxy failed', error)
    res.status(502).json({ error: 'logo_unavailable' })
  }
})

module.exports = router
