import { readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { Side } from '@agent-board/model';

export interface Identity {
  name: string;
  side: Side;
}

export const CONFIG_DIR = process.env.AGENT_BOARD_HOME ?? join(homedir(), '.agent-board');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function isSide(v: unknown): v is Side {
  return v === 'product' || v === 'engineering';
}

function osUserName(): string {
  try {
    return userInfo().username || 'me';
  } catch {
    return 'me';
  }
}

/**
 * Name and side: flags win, then `~/.agent-board/config.json` (`{ "name": "...", "side": "product" }`),
 * then the OS user name and side `product`.
 */
export function resolveIdentity(flags: { name?: string; side?: string }, configFile = CONFIG_FILE): Identity {
  let config: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(configFile, 'utf8'));
    if (parsed && typeof parsed === 'object') config = parsed as Record<string, unknown>;
  } catch {
    // no config file, or not JSON: use the defaults
  }
  if (flags.side !== undefined && !isSide(flags.side)) throw new Error(`--side must be product or engineering, not "${flags.side}"`);
  const name = flags.name?.trim() || (typeof config.name === 'string' && config.name.trim()) || osUserName();
  const side = (flags.side as Side | undefined) ?? (isSide(config.side) ? config.side : 'product');
  return { name, side };
}
