# Self-Hosting Zenith Frontend

This guide covers running the Zenith frontend in a Docker container without
rebuilding the image for different environments.

## Quick start (mock / local dev)

```bash
docker compose up
# → http://localhost:3000
```

No backend required — mock mode is enabled by default.

## Running with the real backend

```bash
docker compose --profile full up
# → frontend: http://localhost:3000
# → backend:  http://localhost:8081
```

## Runtime environment variables

Set these at container start time — no image rebuild needed:

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8081` | Zenith backend base URL |
| `NEXT_PUBLIC_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `NEXT_PUBLIC_NETWORK` | `testnet` | `mainnet` or `testnet` |
| `NEXT_PUBLIC_CONTRACT_ID` | _(empty)_ | Soroban contract ID |
| `MOCK_MODE` | `true` | Set to `false` to disable mock data |

### How runtime injection works

NEXT_PUBLIC_* vars are normally baked into the JS bundle at build time.
Zenith solves this with a `/api/runtime-config` route that reads
`process.env` at request time. The client SDK fetches this route once on
boot and caches it for the tab's lifetime.

## Building a custom image

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://api.zenith.finance \
  -t my-zenith-frontend:local \
  .
```

Passing `--build-arg` sets fallback values baked into the image. You can
still override them at runtime via `-e` or `docker compose` environment
variables.

## Production checklist

- [ ] Set `NEXT_PUBLIC_API_URL` to your real backend URL
- [ ] Set `NEXT_PUBLIC_NETWORK=mainnet` for mainnet deployment
- [ ] Set `NEXT_PUBLIC_CONTRACT_ID` to the deployed Soroban contract ID
- [ ] Set `MOCK_MODE=false`
- [ ] Put the container behind a TLS-terminating reverse proxy (nginx, Caddy)
- [ ] Configure your CSP to allow the API and RPC origins

## Image provenance

Release images are built, scanned with Trivy for CVEs, and pushed to
`ghcr.io/zenith-options/frontend` on every git tag by the
`.github/workflows/docker.yml` CI job.  The SARIF scan results are
uploaded to GitHub's Security tab for every push.
