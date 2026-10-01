# RTM event coverage

Source: [Crisp RTM API v1](https://docs.crisp.chat/references/rtm-api/v1/), checked
2026-10-01 (reference updated 2026-02-12). The reference's malformed
`user``website` tier label for `website:update_visitors_count` is interpreted as
separate `user` and `website` tiers.

The CLI supports website and plugin tokens. Of 82 documented event namespaces,
71 allow website tokens and 72 allow plugin tokens. Ten require the unsupported
user tier. Plugin events still require the permissions granted to the token;
local transport tests do not establish access to those permissions in production.

All 82 namespaces are checked for subscription eligibility under both CLI token
tiers. Each eligible event is tested for payload preservation, website isolation,
authentication subscription and cleanup. The built CLI also receives every
eligible event over a real local WSS Socket.IO connection for each token tier.
Data is synthetic, using documented routing-field locations; tests do not claim
to validate every server payload variant or trigger every event on real Crisp.

Independent hand-authored fixtures also cover text/file messages, bucket URLs,
email tracking and plugin payloads over WSS. Malformed and cross-website routing
fields are rejected; optional/unknown fields and nested content are preserved.

`listen --list-events --json` exposes the catalog and documented scopes. Unknown,
syntactically valid names remain accepted to permit future Crisp events, with
website isolation still enforced. Known incompatible tiers fail before network
access. A documented `write` scope is a token permission requirement for receiving
some events; subscribing does not perform that write operation.

## Event matrix

`website_id` is the routing field unless otherwise shown. A bucket resource must
also have `type: "website"`. Session filters exclude events with no recognized
session identity; arbitrary nested plugin data is not trusted as routing metadata.

| Event                                   | Website token | Plugin token | Website routing | Session routing                |
| --------------------------------------- | ------------- | ------------ | --------------- | ------------------------------ |
| `session:update_availability`           | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:update_verify`                 | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:request:initiated`             | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_email`                     | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_phone`                     | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_address`                   | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_subject`                   | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_avatar`                    | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_nickname`                  | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_origin`                    | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_data`                      | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_segments`                  | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_block`                     | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_opened`                    | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_closed`                    | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_participants`              | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_mentions`                  | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_routing`                   | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_inbox`                     | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:set_state`                     | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:sync:capabilities`             | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:sync:geolocation`              | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:sync:system`                   | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:sync:network`                  | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:sync:timezone`                 | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:sync:locales`                  | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:sync:pages`                    | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:sync:events`                   | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:sync:rating`                   | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:sync:topic`                    | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:removed`                       | Yes           | Yes          | `website_id`    | `session_id`                   |
| `session:error`                         | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:updated`                       | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:send`                          | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:received`                      | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:removed`                       | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:compose:send`                  | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:compose:receive`               | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:acknowledge:read:send`         | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:acknowledge:read:received`     | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:acknowledge:unread:send`       | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:acknowledge:delivered`         | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:acknowledge:ignored`           | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:notify:unread:send`            | Yes           | Yes          | `website_id`    | `session_id`                   |
| `message:notify:unread:received`        | Yes           | Yes          | `website_id`    | `session_id`                   |
| `spam:message`                          | No            | No           | `website_id`    | None                           |
| `spam:decision`                         | No            | No           | `website_id`    | None                           |
| `people:profile:created`                | Yes           | Yes          | `website_id`    | None                           |
| `people:profile:updated`                | Yes           | Yes          | `website_id`    | None                           |
| `people:profile:removed`                | Yes           | Yes          | `website_id`    | None                           |
| `people:bind:session`                   | Yes           | Yes          | `website_id`    | `session_id`                   |
| `people:sync:profile`                   | Yes           | Yes          | `website_id`    | `session_id`                   |
| `people:import:progress`                | No            | No           | `website_id`    | None                           |
| `people:import:done`                    | No            | No           | `website_id`    | None                           |
| `campaign:progress`                     | No            | No           | `website_id`    | None                           |
| `campaign:dispatched`                   | No            | No           | `website_id`    | None                           |
| `campaign:running`                      | No            | No           | `website_id`    | None                           |
| `browsing:request:initiated`            | Yes           | Yes          | `website_id`    | `session_id`                   |
| `browsing:request:rejected`             | Yes           | Yes          | `website_id`    | `session_id`                   |
| `call:request:initiated`                | Yes           | Yes          | `website_id`    | `session_id`                   |
| `call:request:rejected`                 | Yes           | Yes          | `website_id`    | `session_id`                   |
| `identity:verify:request`               | No            | Yes          | `website_id`    | `session_id`                   |
| `widget:action:processed`               | No            | No           | `website_id`    | `session_id`                   |
| `status:health:changed`                 | No            | No           | `website_id`    | None                           |
| `website:update_visitors_count`         | Yes           | Yes          | `website_id`    | None                           |
| `website:update_operators_availability` | Yes           | Yes          | `website_id`    | None                           |
| `website:users:available`               | Yes           | Yes          | `website_id`    | None                           |
| `bucket:url:upload:generated`           | Yes           | Yes          | `resource.id`   | None                           |
| `bucket:url:avatar:generated`           | Yes           | Yes          | `resource.id`   | None                           |
| `bucket:url:website:generated`          | Yes           | Yes          | `resource.id`   | None                           |
| `bucket:url:campaign:generated`         | Yes           | Yes          | `resource.id`   | None                           |
| `bucket:url:helpdesk:generated`         | Yes           | Yes          | `resource.id`   | None                           |
| `bucket:url:status:generated`           | Yes           | Yes          | `resource.id`   | None                           |
| `bucket:url:processing:generated`       | Yes           | Yes          | `resource.id`   | None                           |
| `media:animation:listed`                | No            | No           | None            | None                           |
| `email:subscribe`                       | Yes           | Yes          | `website_id`    | None                           |
| `email:track:view`                      | Yes           | Yes          | `website_id`    | `identifier` (`type: session`) |
| `plugin:channel`                        | Yes           | Yes          | `website_id`    | None                           |
| `plugin:event`                          | Yes           | Yes          | `website_id`    | None                           |
| `plugin:subscription:updated`           | Yes           | Yes          | `website_id`    | None                           |
| `plugin:settings:saved`                 | Yes           | Yes          | `website_id`    | None                           |
| `plan:subscription:updated`             | Yes           | Yes          | `website_id`    | None                           |

## Connection behavior and limits

Tests cover endpoint changes on reconnect, website/plugin authentication,
authentication failure, startup timeout, transient and fatal discovery errors,
cancellation during discovery and connection setup, SIGTERM cleanup, and NDJSON
output. The RTM coverage gate enforces 100% lines/statements/functions and 95%
branches across `src/rtm*.ts` independently of the overall CLI threshold.

Failure tests include HTTP body resets, closed/slow stdout consumers, bounded
output overflow, deterministic retry delays and resource cleanup after 100
reconnects. These tests establish behavior under injected faults, not a production
uptime or lossless-delivery guarantee.

The default subscription remains three events, not the whole catalog. Live smoke
has confirmed website-token authentication and real session availability and
visitor-count events; it has not live-validated all 82 events or plugin-token
scopes. WSS matrix tests provide offline transport coverage for both tiers.

Reconnection does not replay missed events. The CLI does not persist events or
reconcile missed messages via REST. Payloads are forwarded without schema
normalization, apart from credential redaction in CLI output.

## Keeping the catalog current

Run `npm run check:rtm-reference` to compare the catalog's names, tiers and scopes
with the official reference. This is an explicit network check, not part of CI.
When the reference changes, review routing fields as well, update the catalog and
fixture snapshot, and rerun `npm test` and `npm run test:rtm`.
