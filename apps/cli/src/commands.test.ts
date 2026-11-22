import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createBoardDoc, ensureBoardId } from '@agent-board/model';
import { devicePk, newDeviceKey, parseInvite } from '@agent-board/sync/peer';
import { describe, expect, it } from 'vitest';
import { folderBoardId, inviteFolder, joinFolder, setupIdentity } from './commands';
import { loadNetwork } from './network';
import { DOC_FILE, saveDoc, STATE_DIR } from './store';
import { tempDir } from './test-helpers';

const device = newDeviceKey();
const dev = () => device;

describe('setup', () => {
  it('saves the cleaned name and the side, and makes the device key', () => {
    const file = join(tempDir('ab-home-'), 'config.json');
    let made = 0;
    const me = setupIdentity({ name: '  Dewi\u0000  Lestari ', side: 'product' }, file, () => (made++, device));
    expect(me).toEqual({ name: 'Dewi Lestari', side: 'product' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ name: 'Dewi Lestari', side: 'product' });
    expect(made).toBe(1);
  });

  it('refuses a bad side', () => {
    const file = join(tempDir('ab-home-'), 'config.json');
    expect(() => setupIdentity({ name: 'Dewi', side: 'design' }, file, dev)).toThrow(/product or engineering/);
  });
});

describe('invite', () => {
  it('needs the app URL the first time', () => {
    expect(() => inviteFolder(tempDir('ab-f-'), { device: dev })).toThrow(/--app-url/);
  });

  it('makes a link with the board id and this device as the root, then gives the same link again', () => {
    const folder = tempDir('ab-f-');
    const first = inviteFolder(folder, { appUrl: 'https://app.example/board', device: dev });
    expect(first.isNew).toBe(true);
    expect(first.link.startsWith('https://app.example/board/#')).toBe(true);
    const inv = parseInvite(first.link)!;
    expect(inv.root).toBe(devicePk(device));
    expect(inv.boardId).toBe(folderBoardId(folder));
    expect(statSync(join(folder, STATE_DIR, 'network.json')).mode & 0o077).toBe(0);
    const again = inviteFolder(folder, { device: dev });
    expect(again).toMatchObject({ link: first.link, isNew: false });
  });

  it('keeps the board id of a board that is already in the folder', () => {
    const folder = tempDir('ab-f-');
    const doc = createBoardDoc();
    const id = ensureBoardId(doc);
    saveDoc(doc, join(folder, STATE_DIR, DOC_FILE));
    expect(inviteFolder(folder, { appUrl: 'http://127.0.0.1:4748', device: dev }).cfg.boardId).toBe(id);
  });
});

describe('join', () => {
  const link = () => inviteFolder(tempDir('ab-f-'), { appUrl: 'https://app.example/', device: dev }).link;

  it('remembers the invite and the app URL in a new folder', () => {
    const folder = join(tempDir('ab-f-'), 'board');
    const l = link();
    const cfg = joinFolder(l, folder);
    expect(cfg.appUrl).toBe('https://app.example/');
    expect(loadNetwork(folder)).toEqual(cfg);
  });

  it('refuses text that is not an invite', () => {
    expect(() => joinFolder('https://app.example/#nope', tempDir('ab-f-'))).toThrow(/not an agent-board invite/);
  });

  it('refuses a folder that holds another board', () => {
    const folder = tempDir('ab-f-');
    const doc = createBoardDoc();
    ensureBoardId(doc);
    saveDoc(doc, join(folder, STATE_DIR, DOC_FILE));
    expect(() => joinFolder(link(), folder)).toThrow(/another board/);
    expect(existsSync(join(folder, STATE_DIR, 'network.json'))).toBe(false);
  });

  it('needs the full link when only the code is given', () => {
    const fragment = link().split('#')[1]!;
    expect(() => joinFolder(fragment, tempDir('ab-f-'))).toThrow(/full invite link/);
    expect(joinFolder(fragment, tempDir('ab-f-'), { appUrl: 'http://x.example/' }).appUrl).toBe('http://x.example/');
  });
});
