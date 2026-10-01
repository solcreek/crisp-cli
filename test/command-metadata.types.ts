// Compile-time contracts: these errors must remain errors as metadata evolves.
import type { CommandDefinition } from "../src/command-tree.js"
import type { CommandPath } from "../src/help.js"
import type { OptionName } from "../src/command-options.js"

// @ts-expect-error misspelled option names cannot silently disappear from help
const invalidOption: OptionName = "paeg"
// @ts-expect-error a command requires a corresponding help-notes entry
const undocumentedCommand: CommandPath = "unknown command"
const invalidDefinition: CommandDefinition = {
  description: "Fixture",
  // @ts-expect-error local options use the same names as the option definitions
  options: ["unknown-flag"],
  run: () => 0,
}
// @ts-expect-error the command map must cover every documented command
const incomplete: Record<CommandPath, CommandDefinition> = {
  listen: { description: "Fixture", run: () => 0 },
}
void [invalidOption, undocumentedCommand, invalidDefinition, incomplete]
