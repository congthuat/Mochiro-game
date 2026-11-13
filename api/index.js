// Vercel entry point.
//
// `createServer()` returns the Express app it built, so the same backend that runs as a
// long-lived process can also be handed to Vercel as a serverless function. Two details
// matter:
//
//   - It refuses to build without a port. Nothing ever listens on this one — Vercel calls
//     the app directly — but the value has to be there for the call to return.
//   - Routes are registered at *call* time, not at start() time, so the directory has to
//     be passed explicitly: the function runs with a different working directory.
//
// `start()` is deliberately not called. It is what runs the schema sync, and a serverless
// invocation is the wrong place to do that — the tables already exist in Neon, which the
// routes reach through backend/db/client.js when DATABASE_URL is set.
const path = require('node:path')
const { createServer } = require('@surf-ai/sdk/server')

module.exports = createServer({
  port: 3000,
  routesDir: path.join(__dirname, '..', 'backend', 'routes'),
}).app
