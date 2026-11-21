import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { startBoard } from './board';
import { resolveIdentity } from './config';

const USAGE = `agent-board <command>

Commands:
  watch <folder>   show the folder as a board in the browser, live

Options for watch:
  --port <n>       port on 127.0.0.1 (default 4747)
  --name <name>    your name on the board (default: ~/.agent-board/config.json, then your OS user)
  --side <side>    product or engineering (default: config, then product)
  --poll           poll the folder instead of native file events
  --quiet          do not log each file change
`;

async function watchCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      port: { type: 'string', default: '4747' },
      name: { type: 'string' },
      side: { type: 'string' },
      poll: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
  });
  const folder = positionals[0];
  if (!folder || positionals.length > 1) throw new Error(`watch takes one folder.\n\n${USAGE}`);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Bad --port: ${values.port}`);
  const identity = resolveIdentity({ name: values.name, side: values.side });
  const log = values.quiet ? () => {} : (line: string) => process.stdout.write(`  ${line}\n`);

  // pnpm runs scripts in the package folder; INIT_CWD is where the user typed the command.
  const root = resolve(process.env.INIT_CWD ?? process.cwd(), folder);
  const board = await startBoard({ folder: root, identity, port, poll: values.poll, log });
  process.stdout.write(`Board: ${board.url}\n`);
  process.stdout.write(`Watching ${root} as ${identity.name} (${identity.side}). Ctrl+C to stop.\n`);
  await board.ready;

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await board.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

async function main(argv: string[]) {
  // `pnpm start -- watch x` passes the `--` through.
  const [command, ...rest] = argv[0] === '--' ? argv.slice(1) : argv;
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(USAGE);
    return;
  }
  if (command === 'watch') return watchCommand(rest);
  throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
}

main(process.argv.slice(2)).catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
