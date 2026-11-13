# Deploying Mochiro to mochiro.xyz

The application is a Vite frontend plus an Express backend. The frontend reaches the API
through `import.meta.env.BASE_URL`, so it works at a domain root, under a subpath, or
behind a proxy without a single code change. Nothing in the source names a host — the only
absolute URLs are Arc Testnet's, which are meant to be absolute.

## What has to be true before DNS matters

| Piece | Where it runs | What it needs |
|---|---|---|
| Frontend | static files | `BASE_PATH` (empty string for a root domain) |
| Backend | Node 20+ | `BACKEND_PORT`; `SURF_API_KEY` only for the Arc logo lookup |
| Database | Neon Postgres (Vercel Storage) | `DATABASE_URL`, added by the Neon integration |

Set `BASE_PATH` to `/` (or leave it unset) for `mochiro.xyz`. The preview deployment uses a
long subpath; a custom domain at the root must not inherit it.

## DNS

Point the domain at whatever hosts the deployment, then wait for the provider to issue a
certificate. The records below are the two shapes that cover every host:

**Root domain (`mochiro.xyz`)**

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `@` | the host's IPv4 address | 3600 |
| `AAAA` | `@` | the host's IPv6 address, if it publishes one | 3600 |

**`www` subdomain**

| Type | Name | Value | TTL |
|---|---|---|---|
| `CNAME` | `www` | the host's hostname, e.g. `app.example.com` | 3600 |

A CNAME cannot sit on a root domain — that is what the `A` records are for. If the host
publishes an "ALIAS" or "ANAME" record, use it on `@` instead and skip the `A` records.

## After the certificate is issued

1. **Sign-in origins.** Google sign-in only works from an origin the Google Cloud project
   lists. Add `https://mochiro.xyz` under *Authorised JavaScript origins*.
2. **Wallet sign-in.** Nothing to do — the nonce is issued by the backend and verified
   against the address, and it does not care which host served the page.
3. **Check the leaderboard.** `GET https://mochiro.xyz/api/runner/leaderboard` must return
   JSON. If it returns the HTML of the app, the proxy is sending `/api` to the static files
   instead of the backend.

## Path A — Vercel (LIVE)

**mochiro.xyz and www.mochiro.xyz are serving this application, with the backend behind them.**

| | |
|---|---|
| Project | `mochiro`, linked to `congthuat/Mochiro-game`, branch `main` |
| Frontend | `frontend/dist/client`, built on every push to `main` |
| Backend | `api/index.js` as a serverless function, reached at `/api/*` |
| Database | the Surf gateway, through `SURF_API_KEY` |
| DNS | `A @ 76.76.21.21` · `CNAME www cname.vercel-dns.com`, both at Spaceship |

### The build needed two things the platform supplies on its own

`frontend/package.json` runs `scripts/check-env.cjs` before building, and that script
requires `BACKEND_PORT` and a defined `BASE_PATH`. Locally the platform injects both; on
Vercel they have to be set as project environment variables. Without them the build stops
at `Missing required env vars: BACKEND_PORT`.

The build emits `dist/client` (the browser bundle) and `dist/server` (an SSR bundle). Only
the first is served here — the platform's own server consumes the second.

### Verified live

```
https://mochiro.xyz/                       200
https://www.mochiro.xyz/                   200
https://mochiro.xyz/api/health             200  {"status":"ok"}
https://mochiro.xyz/api/runner/leaderboard 200  6 entries, best 92906
```

## Path A (original notes) — Vercel

Vercel runs the backend as a serverless function, so the leaderboard and sign-in survive.
The wiring is three files at the repository root:

| File | Why |
|---|---|
| `api/index.js` | hands the Express app to Vercel |
| `vercel.json` | builds `frontend/`, publishes `frontend/dist`, sends `/api/*` to the function |
| `package.json` | Vercel installs from the root, so the SDK has to be declared there |

### Why `api/index.js` looks the way it does

`createServer()` returns `{ app, port, start }`. Two of those details decide the file:

- It **throws without a port**. Nothing ever listens on the one passed in — Vercel calls the
  app directly — but the call does not return without it.
- It **registers routes at call time**, not at `start()` time, and defaults the directory to
  `process.cwd()/routes`. A serverless function does not run from the repository root, so
  `routesDir` is passed explicitly.

`start()` is deliberately not called. That is what runs the schema sync, and a serverless
invocation is the wrong place for it — the tables already exist in the database the SDK
talks to.

### Verified

`api/index.js` was loaded and served on a real port. All five route groups registered
(`/api/arc`, `/api/auth`, `/api/leaderboard`, `/api/profile`, `/api/runner`) and three
endpoints answered `200` with live data:

```
/api/health                  200  {"status":"ok"}
/api/runner/leaderboard      200  {"entries":[{"best_combo":212,"coins":212,…
/api/arc/project             200  {"id":"05519650-14e2-46d0-bef8-8ec09c9e7709",…
```

`vercel.json` was checked key by key against `https://openapi.vercel.sh/vercel.json`; all
five are recognised.

### Setting it up

1. Import the repository at vercel.com — **root directory stays the repository root**.
2. Add one environment variable: **`SURF_API_KEY`**. The SDK's database proxy and the
   admin-only endpoints both read it, and without it the function returns `503`.
3. Deploy, then add `mochiro.xyz` under **Settings → Domains**.
4. Copy the record values **from Vercel's own panel** — they are per-project and change.

### What it costs you

The database is not yours: `dbQuery` proxies SQL over HTTP to the Surf gateway using that
key. Vercel hosting is free on the hobby tier, but the data lives wherever the key points.

## Google sign-in

Google sign-in needs one value: a **Client ID** that ends in `.apps.googleusercontent.com`. Without
it the gate falls back to a screen that asks the player to paste an id of their own, which is a
developer's escape hatch and not something to show a player.

### Getting the id

1. Open <https://console.cloud.google.com/> and create a project (name it anything, `Mochiro` is fine).
2. **APIs & Services → OAuth consent screen**, user type **External**:
   - App name `Mochiro`, your support email, your developer contact.
   - Scopes: none are needed — the app asks for an id token, not API access.
   - Then **Publish app**. While the app sits in *Testing*, only accounts you add by hand can sign
     in, and everyone else is refused with no useful message.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorised JavaScript origins** — this is the field that matters:
     - `https://mochiro.xyz`
     - `https://www.mochiro.xyz`
   - **Authorised redirect URIs**: leave empty. The button uses Google Identity Services, which
     returns a token to the page instead of redirecting.
4. Copy the Client ID.

### Where it goes

```bash
vercel env add GOOGLE_CLIENT_ID production
```

The backend reads it and serves it from `GET /api/auth/config`; the gate reads it from there, so
one value configures every visitor. `VITE_GOOGLE_CLIENT_ID` is also honoured at build time for a
local run, and a value pasted into the app is kept in that browser only.

**No client secret is needed.** The id token is verified against Google's `tokeninfo` endpoint, and
the `aud` claim is checked against this id — which is also why the id must be the same one the
browser was given. A mismatch is refused with *"This Google client id is not the one this build is
configured for."*

### If it fails

| Symptom | Cause |
|---|---|
| `origin_mismatch` | `https://mochiro.xyz` is not in Authorised JavaScript origins |
| Everyone sees "paste your own id" | `GOOGLE_CLIENT_ID` is unset, or the deployment predates it |
| "not the one this build is configured for" | The browser holds a different id than the server |
| Sign-in works for you, not for others | The consent screen is still in *Testing* |

## Path B — GitHub Pages (no server needed)

The `gh-pages` branch holds a build of the frontend with `BASE_PATH=/`, a `CNAME` file
naming `mochiro.xyz`, and `.nojekyll`. GitHub serves it; nothing else has to run.

**What works:** the whole game. **What does not:** the leaderboard and sign-in — both need
the Express backend. Every API call in the app already degrades: the profile tiles read
`—`, the board stays quiet, and a finished run shows *connecting* rather than an error.

### The records — verified against GitHub's live DNS, not remembered

| Type | Host | Value |
|---|---|---|
| `A` | `@` | `185.199.108.153` |
| `A` | `@` | `185.199.109.153` |
| `A` | `@` | `185.199.110.153` |
| `A` | `@` | `185.199.111.153` |
| `CNAME` | `www` | `congthuat.github.io` |

`dig +short congthuat.github.io` returns exactly those four addresses, so the table cannot
drift from what GitHub actually serves. All four answer on port 443.

### Order matters

1. Add the records at Spaceship **first**.
2. Wait for them to resolve: `dig +short mochiro.xyz A`.
3. Then turn Pages on — **Settings → Pages → Source: `gh-pages`, folder `/`**.
4. Type `mochiro.xyz` into the custom-domain field and save.

Doing step 3 before step 1 makes GitHub verify a domain that does not point anywhere yet,
and it drops the custom domain again.

## Path C — a host that runs the backend as a process

Keeps the leaderboard and sign-in. Point the same domain at whatever runs both halves,
using the `A` / `CNAME` values that host gives you instead of the table above.

## Spaceship — adding the domain

Spaceship is the registrar for `mochiro.xyz`. Its DNS editor is at
**Domains → Launchpad → mochiro.xyz → Advanced DNS**. Everything below happens there.

### Root domain

| Type | Host | Value | TTL |
|---|---|---|---|
| `A` | `@` | the IPv4 address your host gives you | 3600 |
| `AAAA` | `@` | the IPv6 address, if the host publishes one | 3600 |

Spaceship accepts `@` for the root. A CNAME is **not** allowed on `@` — that is why the
root needs `A` records and only `www` gets a CNAME.

### `www`

| Type | Host | Value | TTL |
|---|---|---|---|
| `CNAME` | `www` | the hostname your host gives you | 3600 |

### Verifying it landed

DNS propagates in minutes, not seconds. Check the record before blaming the host:

```bash
dig +short mochiro.xyz A
dig +short www.mochiro.xyz CNAME
```

Then check the certificate and the API:

```bash
curl -sI https://mochiro.xyz | head -1
curl -s https://mochiro.xyz/api/runner/leaderboard | head -c 120
```

If the second one returns HTML instead of JSON, the proxy is serving `/api` from the static
files. If the first one fails, the certificate has not been issued yet — give it longer.

### What was verified here

A build with `BASE_PATH=/` was run and inspected: `index.html` references `/assets/…`,
the API is called at `/api/…`, and no preview path survives in the bundle. The frontend is
ready to sit at a domain root; the only thing missing is the DNS.

## Running the checks

Every check is browser-free, so they run anywhere Node and Bun do:

```bash
cd frontend
bun install
bunx tsc --noEmit
for s in feature-check biome-check sweep-check obstacle-fit kit-check perk-check \
         slide-pose carry-geometry billboard-check i18n-check legibility-check; do
  bun run "scripts/$s.ts"
done
```

## Building

```bash
cd frontend && bun install && bun run build     # → frontend/dist
cd backend  && bun install                      # → node backend/server.js
```

## Database

Production reads and writes its own Neon Postgres through `DATABASE_URL` (see
`backend/db/client.js`). Without `DATABASE_URL` the backend falls back to the Surf SDK
database, which is what the Studio sandbox uses. The SDK does not sync `schema.js` into
Neon: when a column or table is added, run the matching `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` / `CREATE TABLE IF NOT EXISTS` against Neon before deploying the code that uses it.
`GET /api/status` reports which database answered (`backend: "neon"`) and whether it is up.
