# Deploying Mochiro to mochiro.xyz

The application is a Vite frontend plus an Express backend. The frontend reaches the API
through `import.meta.env.BASE_URL`, so it works at a domain root, under a subpath, or
behind a proxy without a single code change. Nothing in the source names a host — the only
absolute URLs are Arc Testnet's, which are meant to be absolute.

## What has to be true before DNS matters

| Piece | Where it runs | What it needs |
|---|---|---|
| Frontend | static files | `BASE_PATH` (empty string for a root domain) |
| Backend | Node 20+ | `BACKEND_PORT`, `SURF_API_KEY` |
| Database | provisioned by the SDK | nothing — the schema syncs on boot |

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

## Path A — GitHub Pages (no server needed)

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

## Path B — a host that runs the backend

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
