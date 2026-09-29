# crispctl

Agent-friendly CLI over the [Crisp REST API](https://docs.crisp.chat/references/rest-api/v1/) for support operations: reply, note, resolve, reopen, assign, segments, mark read, search, people, and operators.

`crispctl` speaks HTTP to `https://api.crisp.chat/v1/` with Node's undici `fetch`. Routes match the official [`crisp-api`](https://github.com/crisp-im/node-crisp-api) resource paths. Tests mock that wire with undici `MockAgent`. The CLI does not wrap the SDK, so a test can assert the path and body without stubbing the SDK surface.

## Sandbox only

Use the **Cos Crisp sandbox** website only. Do not point crispctl at the **production Teachify** website. This repository and CI contain no Crisp credentials. Live checks stay off unless you opt in locally.

## Install

Requires Node.js 20 or newer.

```bash
npm install -g crispctl
crispctl --help
```

From a checkout:

```bash
npm ci
npm run build
node dist/index.js --help
```

## Auth

A profile stores `identifier`, `key`, `tier` (`website` or `plugin`), and `website_id`. Profiles are named. `default` and `sandbox` are the usual ones. `auth set` writes the profile you name and makes it current.

Config file: `$XDG_CONFIG_HOME/crispctl/config.json`, or `~/.config/crispctl/config.json`. Override the path with `CRISPCTL_CONFIG`. The file is written mode `0600` and its directory mode `0700`.

```bash
crispctl auth set \
  --profile sandbox \
  --identifier "$CRISP_IDENTIFIER" \
  --key "$CRISP_KEY" \
  --tier website \
  --website "$CRISP_WEBSITE_ID"

crispctl auth show --profile sandbox
```

`--key` lands in shell history. Prefer environment variables. `auth set` with no credential flags copies the current env into the selected profile. `auth show` prints the identifier, tier, website id, and `key: "set"` or `"missing"`. It never prints the key.

Resolution order, highest first:

| Field | Order |
| --- | --- |
| Profile name | `--profile`, `CRISPCTL_PROFILE`, `current` in the file, then `default` |
| Identifier | `CRISPCTL_IDENTIFIER`, `CRISP_IDENTIFIER`, profile |
| Key | `CRISPCTL_KEY`, `CRISP_KEY`, profile |
| Website | `--website` or `--website-id`, `CRISPCTL_WEBSITE_ID`, `CRISP_WEBSITE_ID`, profile |
| Tier | `CRISPCTL_TIER`, `CRISP_TIER`, profile |

Global flags (any position): `--json`, `--profile`, `--website`.

`--json` prints one JSON line on stdout. Failures print a JSON object on stderr and exit non-zero. The key is redacted if it would otherwise appear in an error string.

## Commands

```text
crispctl auth set|show
crispctl conversations list|get|search
crispctl messages list <session>
crispctl reply <session> --text "..." | --note "..."
crispctl resolve|reopen <session>
crispctl assign <session> --user <id> | --unassign
crispctl segments <session> --set a,b
crispctl read <session>
crispctl people get <id|email>
crispctl operators list
crispctl listen
```

| Command | HTTP |
| --- | --- |
| `conversations list [--page n]` | `GET /v1/website/{website_id}/conversations/{page}` |
| `conversations get <session>` | `GET /v1/website/{website_id}/conversation/{session}` |
| `conversations search <query>` | `GET /v1/website/{website_id}/conversations/{page}?search_query&search_type` (`text` or `segment`) |
| `messages list <session>` | `GET /v1/website/{website_id}/conversation/{session}/messages` |
| `reply <session> --text` | `POST .../message` `{"type":"text","from":"operator","origin":"chat","content":"..."}` |
| `reply <session> --note` | `POST .../message` `{"type":"note","from":"operator","origin":"chat","content":"..."}` |
| `resolve <session>` | `PATCH .../state` `{"state":"resolved"}` |
| `reopen <session>` | `PATCH .../state` `{"state":"unresolved"}` |
| `assign <session> --user <id>` | `PATCH .../routing` `{"assigned":{"user_id":"<id>"}}` |
| `assign <session> --unassign` | `PATCH .../routing` `{"assigned":null}` |
| `segments <session> --set a,b` | `PATCH .../meta` `{"segments":["a","b"]}` |
| `read <session>` | `PATCH .../read` `{"from":"operator","origin":"chat"}` |
| `people get <id>` | `GET /v1/website/{website_id}/people/profile/{people_id}` |
| `people get <email>` | `GET .../people/profiles/1?search_text=<email>`, then `GET .../people/profile/{people_id}` for the exact email match |
| `operators list` | `GET /v1/website/{website_id}/operators/list` |

Requests send HTTP Basic auth (`identifier:key`) and `X-Crisp-Tier`. Stdout is the Crisp `data` payload.

### `listen` (not implemented)

`crispctl listen` exits 2. It does not open a socket.

The official `crisp-api` Node SDK, when `tier` is `website`, requests `GET /v1/website/connect/endpoints` and omits `website_id`. That route does not work for website tokens. The correct route is `GET /v1/website/{website_id}/connect/endpoints`. Plugin tokens use `GET /v1/plugin/connect/endpoints`, which the SDK does call. A future `listen` has to use the website-scoped route for website-tier tokens. Point that work at the Cos Sandbox website only.

## Testing

Unit and HTTP contract tests use undici [`MockAgent`](https://undici.nodejs.org/#/docs/api/MockAgent) against `https://api.crisp.chat`. Each MVP verb has a happy path plus HTTP 400 and 429. The mock is the client's dispatcher, so the test sees the real path, query, and body. Nothing in `npm test` contacts Crisp.

```bash
npm test
npm run typecheck
```

Coverage is enforced for `src/` (80% lines and statements).

### Live smoke

`npm run test:live` lists operators with your real credentials. It **skips** (exit 0) unless `CRISPCTL_LIVE=1` or `CRISP_LIVE=1`.

```bash
export CRISPCTL_PROFILE=sandbox
export CRISP_IDENTIFIER=...
export CRISP_KEY=...
export CRISP_WEBSITE_ID=...
export CRISP_TIER=website
export CRISPCTL_LIVE=1
npm run test:live
```

That opt-in is for the **Cos Sandbox** website only. Do not export production Teachify tokens. Do not commit tokens, and do not add them as CI secrets for this workflow. CI runs `npm test` and does not set `CRISPCTL_LIVE`.

## Release

Publishing uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC). There is no npm token in the repo or in GitHub Actions secrets.

1. Set `version` in `package.json` (for example `0.1.0`).
2. Tag that commit `vX.Y.Z`, matching the `version` field: `git tag v0.1.0 && git push origin v0.1.0`.
3. `.github/workflows/publish.yml` runs on tags `v*`, on Node 24, with `id-token: write` and `package-manager-cache: false`. Before build or publish it requires `GITHUB_REF_NAME` to equal `v` plus the `version` in `package.json` (`vX.Y.Z` for version `X.Y.Z`). It then runs `npm ci`, `npm run build`, `npm test`, and `npm publish`.

Pull requests run `.github/workflows/ci.yml` (install, typecheck, test, no live call).

## License

MIT
