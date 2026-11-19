# Phone relay

A Cloudflare Worker that gives AgentDock one stable address for phones:
<https://agentdock-phone.juho-agentdock.workers.dev>.

```
phone ──https/wss──▶ Worker (workers.dev) ──▶ quick tunnel (*.trycloudflare.com) ──▶ cloudflared on the Mac ──▶ AgentDock server (127.0.0.1)
```

- When **Phone access (Cloudflare)** is on (Settings -> Sharing & access, or
  `phoneAccessEnabled` in `settings.json`), the server runs `cloudflared tunnel --url <local
  server>` (`apps/server/src/phone`). This is a quick tunnel: no Cloudflare account or zone
  is needed, but every start gets a new random URL.
- The server registers that URL with this Worker. The Worker proxies every other request,
  WebSocket upgrades included, to the URL it has on record. When the tunnel answers
  502/530 (it has gone away), the Worker re-reads the registration once and retries GET,
  HEAD and WebSocket requests against the new one.
- cloudflared sends the Worker's own host as `Host` (`--http-host-header`). The server
  therefore builds URLs, cookies and origin checks for the address the phone opened, and
  pairing links and session cookies work unchanged.
- The server's web UI is the phone client. Pair a phone with a pairing link from
  **Authorized clients**; the relay does not authenticate anyone itself.

## Who may register (trust on first use)

Each install creates a random 32-byte secret (`<home>/userdata/secrets/phone-relay-secret.bin`)
and sends it as a bearer token to `POST /__agentdock/register` with `{ "origin":
"https://<name>.trycloudflare.com" }`. The Worker's Durable Object stores only the
secret's SHA-256:

- No hash stored yet: the first install to register claims the relay.
- Same hash: the registration is updated.
- Different hash: `403 claimed_by_another_install`. The app shows "Another AgentDock
  install owns ...".

Origins must be bare `https://<one label>.trycloudflare.com` URLs (`ORIGIN_HOST_SUFFIX`), so
a stolen secret can only point the relay at another quick tunnel.

Until an install registers, the relay is unclaimed and the first registrant wins. Turn
phone access on soon after deploying a new relay, and check `claimed` in the health output.

## Reset

`POST /__agentdock/reset` with `Authorization: Bearer <token>` clears the claim and the
registration. The token is either the owning install's secret or the optional
`RESET_TOKEN` Worker secret:

```sh
# With the install secret (base64url of the 32 bytes, no padding):
SECRET=$(node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1]).toString("base64url"))' ~/.agentdock-next/userdata/secrets/phone-relay-secret.bin)
curl -fsS -X POST -H "Authorization: Bearer $SECRET" https://agentdock-phone.juho-agentdock.workers.dev/__agentdock/reset

# Or set an owner token once, then reset with it when the install secret is lost:
wrangler secret put RESET_TOKEN
curl -fsS -X POST -H "Authorization: Bearer <RESET_TOKEN>" https://agentdock-phone.juho-agentdock.workers.dev/__agentdock/reset
```

The next registration claims the relay again.

## Health

```sh
curl -fsS https://agentdock-phone.juho-agentdock.workers.dev/__agentdock/health
# {"ok":true,"claimed":true,"registered":true,"updatedAt":"..."}
```

When no tunnel is registered, or it stops answering, phones get a small "AgentDock is
offline" page (503) that retries.

## Deploy

```sh
cd infra/phone-relay
WRANGLER=~/.agentdock/tools/wrangler/node_modules/.bin/wrangler \
  PHONE_RELAY_URL=https://agentdock-phone.juho-agentdock.workers.dev \
  sh scripts/deploy.sh
```

`wrangler login` (or `CLOUDFLARE_API_TOKEN`) must be set up first. A deploy does not restart
a running Durable Object; change `PhoneRelayRegistry`'s class name with a new migration if
its logic changes. A different relay can be chosen with `phoneRelayUrl` in the server's
`settings.json` (a bare `https://` origin).

Tests: `vp test run` in this folder (`src/relay.test.ts`).

## Limits

- Quick tunnels have no uptime guarantee and Cloudflare may rate-limit them. After a Mac
  restart or a cloudflared crash the server starts a new tunnel and re-registers within
  seconds; open pages reconnect on their own.
- Quick tunnels do not support server-sent events. AgentDock uses WebSockets, which work.
- The server sees the Worker's egress address as the client IP, so session records show
  a Cloudflare address rather than the phone's.
- Long-idle WebSockets can be closed by Cloudflare; the app reconnects.
