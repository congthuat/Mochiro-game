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
