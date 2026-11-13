// GET /api/status — can this deployment reach its database?
//
// Every route that touches the database answers a bare "unavailable" when the query fails,
// which is right for players but says nothing to whoever runs the site. This one does one
// trivial query and reports which database it used and how it went — never a connection
// string, never a key, never a stack.
const { Router } = require('express')
const { dbQuery, dbBackend } = require('../db/client')

const router = Router()

router.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store')
  const started = Date.now()
  if (dbBackend === 'surf' && !process.env.SURF_API_KEY) {
    return res.status(503).json({ db: 'error', backend: dbBackend, reason: 'no database configured' })
  }
  try {
    await dbQuery('SELECT 1')
    res.json({ db: 'ok', backend: dbBackend, ms: Date.now() - started })
  } catch (err) {
    const text = String(err?.message || err)
    let reason = 'query failed'
    let gatewayStatus = null
    if (dbBackend === 'surf') {
      gatewayStatus = Number(/API error (\d{3})/.exec(text)?.[1]) || null
      reason = /"message"\s*:\s*"([^"]{1,120})"/.exec(text)?.[1] || reason
    } else {
      // pg error codes/messages name the problem (auth, timeout, missing table) without
      // echoing the connection string.
      reason = (err?.code ? `${err.code} ` : '') + text.replace(/postgres(ql)?:\/\/\S+/g, '[url]').slice(0, 120)
    }
    res.status(503).json({ db: 'error', backend: dbBackend, gatewayStatus, reason, ms: Date.now() - started })
  }
})

module.exports = router
