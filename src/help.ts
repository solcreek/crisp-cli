export const usage = {
  authSet: "crispctl auth set [--profile <name>] --identifier <id> --key <key> --tier <website|plugin> --website <website_id>",
  authShow: "crispctl auth show [--profile <name>]",
  conversationsList: "crispctl conversations list [--page <n>]",
  conversationsGet: "crispctl conversations get <session>",
  conversationsSearch: "crispctl conversations search <query> [--page <n>] [--search-type text|segment]",
  messagesList: "crispctl messages list <session>",
  reply: "crispctl reply <session> (--text <message> | --note <note>)",
  resolve: "crispctl resolve <session>",
  reopen: "crispctl reopen <session>",
  assign: "crispctl assign <session> (--user <id> | --unassign)",
  segments: "crispctl segments <session> --set <a,b>",
  read: "crispctl read <session>",
  peopleGet: "crispctl people get <id|email>",
  operatorsList: "crispctl operators list",
  listen: "crispctl listen",
} as const

const globals = "Global flags: --json, --profile <name>, --website <id>"

export const ROOT_HELP = `crispctl — agent-friendly Crisp REST CLI

Usage:
  crispctl [--json] [--profile <name>] [--website <id>] <command> [args]

${globals}

Commands:
  auth set                 Save identifier, key, tier, and website_id
  auth show                Show the resolved profile (key redacted)
  conversations list       List conversations
  conversations get        Get one conversation
  conversations search     Search conversations
  messages list            List messages in a session
  reply                    Send an operator message or private note
  resolve                  Set conversation state to resolved
  reopen                   Set conversation state to unresolved
  assign                   Assign or unassign an operator
  segments                 Replace conversation segments
  read                     Mark the conversation read for the operator
  people get               Get a people profile by id or email
  operators list           List website operators
  listen                   Stub. RTM is not implemented

Profiles:
  Named profiles live in the config file. "default" and "sandbox" are the usual names.
  --profile and CRISPCTL_PROFILE select one. The file remembers the last profile written by auth set.

Environment (overrides the selected profile):
  CRISPCTL_PROFILE
  CRISPCTL_IDENTIFIER or CRISP_IDENTIFIER
  CRISPCTL_KEY or CRISP_KEY
  CRISPCTL_WEBSITE_ID or CRISP_WEBSITE_ID
  CRISPCTL_TIER or CRISP_TIER
  CRISPCTL_CONFIG          Config file path (default: $XDG_CONFIG_HOME/crispctl/config.json)

The token key is never printed. A config file written by crispctl is mode 0600.

Sandbox: use the Cos Crisp sandbox website only. Never point crispctl at production Teachify.
`

const HELP: Record<string, string> = {
  auth: `crispctl auth

  auth set     Save a profile
  auth show    Show the resolved profile with the key redacted

${usage.authSet}
${usage.authShow}
`,
  "auth set": `${usage.authSet}

Writes the selected profile and makes it current. Flags win, then CRISPCTL_* / CRISP_* env, then the existing profile.
--website and --website-id both set website_id. Tier is website or plugin.
`,
  "auth show": `${usage.authShow}

Prints profile, identifier, tier, website_id, whether the key is set, and where each value came from.
The key value is not included.
`,
  conversations: `crispctl conversations

  conversations list
  conversations get <session>
  conversations search <query>
`,
  "conversations list": `${usage.conversationsList}

GET /v1/website/{website_id}/conversations/{page}
`,
  "conversations get": `${usage.conversationsGet}

GET /v1/website/{website_id}/conversation/{session}
`,
  "conversations search": `${usage.conversationsSearch}

GET /v1/website/{website_id}/conversations/{page}?search_query&search_type
search_type is text (default) or segment.
`,
  messages: `crispctl messages list <session>

${usage.messagesList}
`,
  "messages list": `${usage.messagesList}

GET /v1/website/{website_id}/conversation/{session}/messages
`,
  reply: `${usage.reply}

POST /v1/website/{website_id}/conversation/{session}/message
--text sends {"type":"text","from":"operator","origin":"chat","content":"..."}
--note sends {"type":"note","from":"operator","origin":"chat","content":"..."}
`,
  resolve: `${usage.resolve}

PATCH /v1/website/{website_id}/conversation/{session}/state
Body: {"state":"resolved"}
`,
  reopen: `${usage.reopen}

PATCH /v1/website/{website_id}/conversation/{session}/state
Body: {"state":"unresolved"}
`,
  assign: `${usage.assign}

PATCH /v1/website/{website_id}/conversation/{session}/routing
--user sends {"assigned":{"user_id":"<id>"}}
--unassign sends {"assigned":null}
`,
  segments: `${usage.segments}

PATCH /v1/website/{website_id}/conversation/{session}/meta
Body: {"segments":["a","b"]}
`,
  read: `${usage.read}

PATCH /v1/website/{website_id}/conversation/{session}/read
Body: {"from":"operator","origin":"chat"}
`,
  people: `crispctl people get <id|email>

${usage.peopleGet}
`,
  "people get": `${usage.peopleGet}

GET /v1/website/{website_id}/people/profile/{id}
The path segment may be a people id or an email address.
`,
  operators: `crispctl operators list

${usage.operatorsList}
`,
  "operators list": `${usage.operatorsList}

GET /v1/website/{website_id}/operators/list
`,
  listen: `${usage.listen}

RTM listen is not implemented. See the command output for the website-tier connect-endpoints pitfall.
`,
}

export function renderHelp(positionals: readonly string[]): string {
  const key = positionals.join(" ")
  if (!key) {
    return ROOT_HELP
  }
  if (HELP[key]) {
    return HELP[key]
  }
  const head = positionals[0]
  if (head && HELP[head]) {
    return HELP[head]
  }
  return `${ROOT_HELP}\nUnknown command: ${positionals[0] ?? ""}\n`
}
