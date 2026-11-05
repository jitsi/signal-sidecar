# AGENTS.md

This file gives guidance to coding agents for work in this repository. `CLAUDE.md` imports it for Claude Code.

## Build and run

- **Build** (lint, then compile): `npm run build`
- **Lint** (with autofix): `npm run lint`
- **Dev mode** (watch and auto-restart): `npm run watch`
- **Start**: `npm start`. This runs the compiled `dist/app.js`.
- **Tests**: there is no test suite. `npm test` only prints an error.

TypeScript compiles from `src/` to `dist/` as CommonJS with an ES2020 target. ESLint uses typescript-eslint and Prettier. A Prettier error fails `npm run build`.

## Verify a change

There are no tests, so check behavior changes against fake services:

1. Run `npm run build`.
2. Start small HTTP servers for jicofo (`/about/health` and `/stats`) and prosody (`/http-bind`). Let each test set the status codes. `/stats` must return JSON, for example `{"participants": 0, "conferences": 0}`.
3. Write a status file, for example `ready`.
4. Start `node dist/app.js`. Point `JICOFO_ORIG`, `PROSODY_ORIG` and `STATUS_PATH` at the fakes. Use short intervals, for example `POLLING_INTERVAL=1`, `HEALTH_DAMPENING_INTERVAL=6` and `DRAIN_GRACE_INTERVAL=20`.
5. Change the fake answers over time. Sample the TCP agent on `TCP_PORT`, `/about/health` and `/signal/report` about every 250 ms.

The node must be healthy for at least 1 poll before a test starts, because the drain grace needs an earlier healthy poll.

## Commits and pull requests

- Use conventional commit prefixes, for example `fix:`, `docs:`, `ci:` and `chore(docker):`.
- Pull requests merge as a squash. The squash subject ends with the PR number, for example `(#52)`.
- Bump the version in the same pull request as the code change. See "Versions and releases".

## Versions and releases

- **Bump the version on every code change.** Run `npm version patch --no-git-tag-version` in the same PR. Use `minor` or `major` for larger changes. The command updates `package.json` and `package-lock.json`.
- A merge to `main` releases only if tag `v<package.json version>` does not exist yet. A merge without a bump releases nothing.
- `.github/workflows/build-deb.yml` builds the deb as version `1:<version>-1`. Older CI builds used integer versions up to `75-1`. The epoch keeps the new versions above them.
- After a good build, the workflow creates the tag and the GitHub release. The release gets the `.deb`, `.changes`, `.buildinfo`, `SHA256SUMS` and a build provenance bundle.
- The workflow never replaces a file on an existing release. A manual run can rebuild an existing tag that has no files yet.
- A Jitsi release job downloads the release, verifies it, and publishes it to the Jitsi apt repository.

## Packaging

- **Deb**: `debian/` builds the `signal-sidecar` package (`Architecture: all`, depends on `nodejs`).
  - The app goes to `/usr/share/signal-sidecar/`.
  - The systemd unit reads its environment from `/etc/jitsi/signal-sidecar/config`.
  - `debian/rules` runs `npm install` and `npm run build`.
- **Container**: the `Dockerfile` copies `dist/`, so run `npm run build` first.
  - `build/build.sh` builds `jitsi/signal-sidecar` for amd64 and arm64 and pushes it. Set `TAG` before you run it.
  - `build/run.sh` sources `/usr/jitsi/pre-run.sh` if it exists, then starts the app.

## Architecture

signal-sidecar monitors the health of a Jitsi signal node (jicofo and prosody). It runs next to these services and reports their combined health to load balancers.

### Polling loops (`src/app.ts`)

The app runs 2 independent loops. Each loop runs every `POLLING_INTERVAL` seconds.

1. **Health polling**: `HealthCollector` checks 4 sources at the same time:
   - jicofo `/about/health`;
   - jicofo `/stats`;
   - prosody `/http-bind`;
   - the status file at `STATUS_PATH` (default `/etc/jitsi/shard-status`).

   The node is healthy only when jicofo and prosody are healthy and the stats parse. The status file must also be readable and not `unhealthy`. The collector lowercases the status file, so `MAINT` and `maint` are the same.
2. **Census polling** (optional, `CENSUS_POLL=true`): `CensusCollector` polls prosody `/room-census` for the participants in each room. The census numbers go into the health report.

Each health request has a 3 second timeout and 2 retries. A jicofo 500 or 503 therefore takes a few seconds to show in a poll.

### Flap mitigation

The rules live in `healthReportRightNow`, `checkSoftDown` and `pollForHealth` in `src/app.ts`. The README section "flap prevention configuration" describes them for operators.

- **Soft down** means overload, not a broken node. It applies in 2 cases:
  - jicofo answers 500 or 503, and prosody is healthy or only times out;
  - jicofo is healthy (`/about/health` and `/stats` both 200), and prosody only times out.
- **Hard down** is every other unhealthy state. A status file set to `unhealthy` is always a hard down.
- **Drain grace** (`DRAIN_GRACE_INTERVAL`): during a soft down, the TCP agent reports DRAIN instead of DOWN for this period. The period counts from the first unhealthy poll of the episode.
- **Dampening** (`HEALTH_DAMPENING_INTERVAL`): after the last unhealthy poll, REST stays unhealthy for this period. With `DAMPENING_REPORTS_DRAIN=true`, the TCP agent reports DRAIN during this period, not DOWN.
- A soft down that recovers inside the grace period keeps REST healthy. With `DAMPENING_REPORTS_DRAIN=true`, the agent still reports DRAIN for the dampening period.
- An unhealthy poll inside the dampening period continues the same episode. A flapping node therefore reaches DOWN after the grace period.
- A hard down poll clears the soft down mark. Recovery then gets the full dampening period.
- A `maint` status file stays MAINT. The sidecar never replaces it with DRAIN.
- `DRAIN_GRACE_INTERVAL` must be greater than `HEALTH_DAMPENING_INTERVAL`. If it is lower, `src/config.ts` raises it to the dampening value plus 1.

### Interfaces

- **HTTP** (Express, `HTTP_PORT`, default 6000):
  - `/health`: the sidecar itself is up;
  - `/about/health` and `/signal/health`: signal node health, 200 or 503;
  - `/signal/report`: the full health report as JSON;
  - `/signal/census`: the room census, only when `CENSUS_POLL=true`;
  - `/metrics`: Prometheus metrics, only when `METRICS=true`.
- **TCP** (`TCP_PORT`, default 6060): the HAProxy agent-check protocol. The answer has 3 parts: `up` or `down`, then `ready`, `drain` or `maint`, then a weight percentage.

### Weight

With `WEIGHT_PARTICIPANTS=true`, the weight falls as jicofo participants approach `PARTICIPANT_MAX`. It moves in 5% steps, with a minimum of 1%. A `drain` or `maint` status file gives 0%.

When the sidecar itself adds DRAIN (grace or dampening), the weight does not change.

### Consul

Consul KV integration is optional.

- **Watch** (`CONSUL_STATUS=true`): reads the shard state from `CONSUL_STATUS_KEY` and writes it to the status file.
- **Publish** (`CONSUL_REPORTS=true`): writes the health report to `CONSUL_REPORT_KEY` every `CONSUL_REPORTS_INTERVAL` seconds. With `CENSUS_REPORTS=true`, the report includes the census.

### Configuration

All configuration comes from environment variables. `src/config.ts` validates them with `envalid` and lists each one with its default and description. `dotenv` loads a local `.env` file.

### Known stale items

These do not match the code. Do not rely on them.

- `npm run jwt` runs `dist/jwt.js`, but no source file builds it.
- `debian/config` sets `HA_PORT`, but the code reads `TCP_PORT`. The default `TCP_PORT` is the same port, 6060.
- `main` in `package.json` points at `src/index.js`, which does not exist. The entry point is `src/app.ts`.
- `debian/signal-sidecar.conf` is an Upstart job. The systemd unit `debian/signal-sidecar.service` is the one that runs.

### Key files

- `src/app.ts`: entry point, polling loops, flap mitigation, Express routes, TCP agent, weight
- `src/health_collector.ts`: jicofo and prosody checks, status file, `HealthReport` interface
- `src/census_collector.ts`: prosody room census, `CensusReport` and `RoomData` interfaces
- `src/consul.ts`: Consul KV watch and publish
- `src/metrics.ts`: Prometheus metrics (prom-client) and Express middleware
- `src/config.ts`: environment variables and defaults
- `src/logger.ts`: winston logger, JSON to the console
- `debian/`, `Dockerfile`, `build/`: packaging
- `.github/workflows/build-deb.yml`: deb build and GitHub release
