// GET /api/status — can this deployment reach its database?
//
// Every route that touches the database answers a bare "unavailable" when the query fails,
// which is right for players but says nothing to whoever runs the site. This one does one
// trivial query and reports how it went: the HTTP status the database gateway gave back
// and its short reason — never the key, never a stack. A 401 here means the deployment's
// SURF_API_KEY is no longer accepted and has to be replaced in the host's settings.
const { Router } = require('express')
const { dbQuery } = require('@surf-ai/sdk/db')

const router = Router()

router.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store')
  const started = Date.now()
  if (!process.env.SURF_API_KEY) {
    return res.status(503).json({ db: 'error', reason: 'SURF_API_KEY is not set' })
  }
  try {
    await dbQuery('SELECT 1')
    res.json({ db: 'ok', ms: Date.now() - started })
  } catch (err) {
    const text = String(err?.message || err)
    const status = Number(/API error (\d{3})/.exec(text)?.[1]) || null
    const reason = /"message"\s*:\s*"([^"]{1,120})"/.exec(text)?.[1] || 'query failed'
    const code = /"code"\s*:\s*"([^"]{1,60})"/.exec(text)?.[1] || null
    // The kind of key, never the key: Studio session keys and personal API keys are
    // different things to the gateway, and only one of them can open a project database.
    const key = String(process.env.SURF_API_KEY)
    const keyKind = key.startsWith('sk_ses') ? 'studio-session' : key.startsWith('sk-') ? 'personal-api' : 'other'
    res.status(503).json({ db: 'error', gatewayStatus: status, code, reason, keyKind, ms: Date.now() - started })
  }
})

module.exports = router
