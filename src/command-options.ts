export const OPTIONS = [
  ["--json", "Write machine-readable JSON"],
  ["-h, --help", "Show help"],
  ["--version", "Show version"],
  ["--read-only", "Refuse all write operations"],
  ["--profile <name>", "Select a credential profile"],
  ["--website <id>", "Override website ID"],
  ["--website-id <id>", "Alias for --website"],
  ["--identifier <id>", "API identifier"],
  ["--key <key>", "API token key"],
  ["--tier <tier>", "Token tier: website or plugin"],
  ["--page <n>", "Page number (default: 1)"],
  ["--search-type <type>", "Search type: text or segment"],
  ["--text <message>", "Send an operator message"],
  ["--note <note>", "Send a private note"],
  ["--user <id>", "Operator ID"],
  ["--unassign", "Remove the assigned operator"],
  ["--set <a,b>", "Replace segments (empty value clears them)"],
  ["--events <a,b>", "RTM event names"],
  ["--session <id>", "Filter RTM events by session"],
  ["--count <n>", "Stop after N matching events"],
  ["--timeout <seconds>", "Listen deadline including stdout drain"],
  ["--list-events", "List RTM events without connecting"],
] as const

type LongOptionName<Spec extends string> = Spec extends `${string}--${infer Name} ${string}`
  ? Name
  : Spec extends `${string}--${infer Name}`
    ? Name
    : never

export type OptionName = LongOptionName<(typeof OPTIONS)[number][0]>
