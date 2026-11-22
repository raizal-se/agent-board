import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_WEB_DIR, startBoard } from './board';
import { inviteFolder, joinFolder, setupIdentity } from './commands';
import { resolveIdentity } from './config';
import { relayUrlsFromEnv } from './network';
import { startAppServer } from './server';

const USAGE = `agent-board <command>

Commands:
  setup --name <name> --side <side>   save your name and side, and make this device's key
  watch <folder>                      show the folder as a board in the browser, live
  invite <folder> --app-url <URL>     share the board of the folder: print the invite link
  join <invite link> <folder>         join a shared board into the folder, then watch it
  app                                 serve the web app alone (the page an invite link opens)

Options for watch and join:
  --port <n>       port on 127.0.0.1 (default 4747)
  --name <name>    your name on the board (default: ~/.agent-board/config.json, then your OS user)
  --side <side>    product or engineering (default: config, then product)
  --app-url <URL>  where the web app is served, for invite links made from the page
  --poll           poll the folder instead of native file events
  --quiet          do not log each file change

Options for app:
  --port <n>       port (default 4748)
  --host <host>    address to listen on (default 127.0.0.1; 0.0.0.0 for other devices)
`;

/** pnpm runs scripts in the package folder; INIT_CWD is where the user typed the command. */
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);
const out = (line: string) => process.stdout.write(`${line}\n`);

function portOf(v: string | undefined): number {
  const port = Number(v);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Bad --port: ${v}`);
  return port;
}

const WATCH_OPTIONS = {
  port: { type: 'string', default: '4747' },
  name: { type: 'string' },
  side: { type: 'string' },
  'app-url': { type: 'string' },
  poll: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false },
} as const;

async function watch(root: string, values: { port?: string; name?: string; side?: string; 'app-url'?: string; poll?: boolean; quiet?: boolean }) {
  const identity = resolveIdentity({ name: values.name, side: values.side });
  const log = values.quiet ? () => {} : (line: string) => process.stdout.write(`  ${line}\n`);
  let stopping = false;
  let board: Awaited<ReturnType<typeof startBoard>> | undefined;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    await board?.stop();
    process.exit(code);
  };
  board = await startBoard({
    folder: root,
    identity,
    port: portOf(values.port),
    poll: values.poll,
    log,
    appUrl: values['app-url'],
    relayUrls: relayUrlsFromEnv(),
    onRejected: () => {
      out('This board did not let you in, or it is not the board of the invite. The folder forgot it.');
      void stop(1);
    },
  });
  out(`Board: ${board.url}`);
  out(`Watching ${root} as ${identity.name} (${identity.side}). Ctrl+C to stop.`);
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  await board.ready;
}

async function watchCommand(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: WATCH_OPTIONS });
  if (positionals.length !== 1) throw new Error(`watch takes one folder.\n\n${USAGE}`);
  await watch(here(positionals[0]!), values);
}

async function joinCommand(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: WATCH_OPTIONS });
  if (positionals.length !== 2) throw new Error(`join takes the invite link and a folder.\n\n${USAGE}`);
  const root = here(positionals[1]!);
  joinFolder(positionals[0]!, root, { appUrl: values['app-url'] });
  out(`Asking to join. A member of the board must let you in (on their board page).`);
  await watch(root, values);
}

function inviteCommand(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { 'app-url': { type: 'string' } } });
  if (positionals.length !== 1) throw new Error(`invite takes one folder.\n\n${USAGE}`);
  const { link, isNew } = inviteFolder(here(positionals[0]!), { appUrl: values['app-url'] });
  out(link);
  out('');
  out(isNew ? 'Send this link to the people you work with. You approve each person on the board page.' : 'This board is already shared. This is its link.');
  out('Anyone with this link can ask to join. Only a member can let them in.');
}

function setupCommand(args: string[]) {
  const { values } = parseArgs({ args, options: { name: { type: 'string' }, side: { type: 'string' } } });
  const me = setupIdentity({ name: values.name, side: values.side });
  out(`You are ${me.name} (${me.side}) on this computer.`);
}

async function appCommand(args: string[]) {
  const { values } = parseArgs({ args, options: { port: { type: 'string', default: '4748' }, host: { type: 'string' } } });
  const app = await startAppServer({ webDir: DEFAULT_WEB_DIR, port: portOf(values.port), host: values.host });
  out(`Web app: ${app.url}`);
  out(`Use the address that other people can open as --app-url (for example a tunnel to port ${app.port}).`);
  const stop = async () => {
    await app.close();
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
  if (command === 'join') return joinCommand(rest);
  if (command === 'invite') return inviteCommand(rest);
  if (command === 'setup') return setupCommand(rest);
  if (command === 'app') return appCommand(rest);
  throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
}

main(process.argv.slice(2)).catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
