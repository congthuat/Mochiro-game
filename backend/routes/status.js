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
    // The detail goes to the server log only; the public answer names no table, host or code.
    console.error('[status] database check failed', err)
    res.status(503).json({ db: 'error', backend: dbBackend, ms: Date.now() - started })
  }
})

module.exports = router
