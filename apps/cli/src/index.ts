#!/usr/bin/env -S npx tsx
const USAGE = `agent-board <command>

Commands (design section 10):
  setup            name, side, folders and the board to join (once)
  watch            stream the shared folder to the board
  export           print the board as JSON for agents
  stories import   import a milestone file as draft stories
`;

const [command] = process.argv.slice(2);
if (!command || command === 'help' || command === '--help') {
  process.stdout.write(USAGE);
} else {
  process.stderr.write(`Unknown or not built yet: ${command}\n\n${USAGE}`);
  process.exitCode = 1;
}
