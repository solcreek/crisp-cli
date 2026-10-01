export const usage = {
  authSet:
    "crispctl auth set [--profile <name>] --identifier <id> --key <key> --tier <website|plugin> --website <website_id>",
  conversationsGet: "crispctl conversations get <session>",
  conversationsPages: "crispctl conversations pages <session> [--page <n>]",
  conversationsSearch:
    "crispctl conversations search <query> [--page <n>] [--search-type text|segment]",
  messagesList: "crispctl messages list <session>",
  reply: "crispctl reply <session> (--text <message> | --note <note>)",
  resolve: "crispctl resolve <session>",
  reopen: "crispctl reopen <session>",
  assign: "crispctl assign <session> (--user <id> | --unassign)",
  segments: "crispctl segments <session> --set <a,b>",
  read: "crispctl read <session>",
  peopleGet: "crispctl people get <id|email>",
  listen:
    "crispctl listen [--list-events] [--events <a,b>] [--session <id>] [--count <n>] [--timeout <seconds>]",
} as const

export const ROOT_NOTES = `Profiles:
  Named profiles live in the config file. "default" and "sandbox" are the usual names.
  --profile and CRISPCTL_PROFILE select one. The file remembers the last profile written by auth set.

Environment (overrides the selected profile):
  CRISPCTL_PROFILE
  CRISPCTL_IDENTIFIER or CRISP_IDENTIFIER
  CRISPCTL_KEY or CRISP_KEY
  CRISPCTL_WEBSITE_ID or CRISP_WEBSITE_ID
  CRISPCTL_TIER or CRISP_TIER
  CRISPCTL_READ_ONLY       Set to 1 to reject all write operations
  CRISPCTL_CONFIG          Config file path (default: $XDG_CONFIG_HOME/crispctl/config.json)

The token key is never printed. A config file written by crispctl is mode 0600.

Development: use a dedicated test website. Production access requires explicit authorization and --read-only.
`

export const COMMAND_NOTES = {
  "auth set": `Writes the selected profile and makes it current. Flags win, then CRISPCTL_* / CRISP_* env, then the existing profile.
--website and --website-id both set website_id. Tier is website or plugin.
`,
  "auth show": `Prints profile, identifier, tier, website_id, whether the key is set, and where each value came from.
The key value is not included.
`,
  "conversations list": `GET /v1/website/{website_id}/conversations/{page}
`,
  "conversations get": `GET /v1/website/{website_id}/conversation/{session}
`,
  "conversations pages": `GET /v1/website/{website_id}/conversation/{session}/pages/{page}
Returns one page of browsing history recorded by Crisp for this session.
--page defaults to 1 and must be a positive safe integer. An empty page returns [].
Optional fields: page_title, page_url, page_referrer, and timestamp.
Requires website:conversation:pages read access.
For new visits, use listen --events session:sync:pages --session <session> --json.
`,
  "conversations search": `GET /v1/website/{website_id}/conversations/{page}?search_query&search_type
search_type is text (default) or segment.
`,
  "messages list": `GET /v1/website/{website_id}/conversation/{session}/messages
`,
  reply: `POST /v1/website/{website_id}/conversation/{session}/message
--text sends {"type":"text","from":"operator","origin":"chat","content":"..."}
--note sends {"type":"note","from":"operator","origin":"chat","content":"..."}
`,
  resolve: `PATCH /v1/website/{website_id}/conversation/{session}/state
Body: {"state":"resolved"}
`,
  reopen: `PATCH /v1/website/{website_id}/conversation/{session}/state
Body: {"state":"unresolved"}
`,
  assign: `PATCH /v1/website/{website_id}/conversation/{session}/routing
--user sends {"assigned":{"user_id":"<id>"}}
--unassign sends {"assigned":null}
`,
  segments: `PATCH /v1/website/{website_id}/conversation/{session}/meta
Body: {"segments":["a","b"]}
`,
  read: `PATCH /v1/website/{website_id}/conversation/{session}/read
Body: {"from":"operator","origin":"chat"}
`,
  "people get": `A people id calls GET /v1/website/{website_id}/people/profile/{people_id}.
An email is not placed on that path. crispctl searches
GET /v1/website/{website_id}/people/profiles/1?search_text=<email>
and then fetches the people_id whose email matches exactly.
`,
  "operators list": `GET /v1/website/{website_id}/operators/list
`,
  listen: `Streams message:send, message:received and session:set_state by default.
--list-events lists the official event catalog, token tiers and scopes without connecting.
It cannot be combined with --events, --session, --count or --timeout.
--events selects comma-separated RTM event names; known tier mismatches fail before connecting.
--session filters locally, including email:track:view session identifiers.
Bucket URL events match resource.type=website and resource.id to the selected website.
--json writes one {event,data,received_at} JSON object per line to stdout.
Connection status goes to stderr. Ctrl-C stops cleanly; reconnects rediscover endpoints.
--count stops after N matching events. --timeout sets a total deadline (exit 1).
Only the selected website is subscribed. Events missed while disconnected are not replayed.
--read-only (or CRISPCTL_READ_ONLY=1) rejects writes, including auth set.
listen itself is always read-only.
`,
}

export type CommandPath = keyof typeof COMMAND_NOTES
