import { join } from 'node:path';
import { editStory, milestonesMap, storiesMap, type BoardExport } from '@agent-board/model';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { startBoard, type RunningBoard } from './board';
import { DOC_FILE, EXPORT_FILE, loadDoc, STATE_DIR } from './store';
import { fakeWebDir, itemAt, tempDir, until, write } from './test-helpers';

const identity = { name: 'arif', side: 'engineering' as const };
const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

async function board(folder: string): Promise<RunningBoard> {
  const b = await startBoard({ folder, identity, port: 0, webDir: fakeWebDir(), poll: true });
  cleanup.push(() => b.stop());
  await b.ready;
  return b;
}

const MILESTONE = `# Milestone 1: Pay by card
Goal: a shopper can pay by card.

## Payment ready before form
- story: As a shopper, I want my payment ready, so that checkout feels instant.
- size: S
- owner:
- covers: card-form.html, flow.md
- blocked-by:
- check: the card form opens with an intent ID already set.

## Pass the 3DS check
- story: As a shopper, I want to pass 3DS, so that my payment is accepted.
- size: M
- owner: Mei Ling
- covers: flow.md
- blocked-by: Payment ready before form
- check: a 3DS test card shows the bank challenge.
`;

describe('milestone files', () => {
  it('are imported once, after the first scan, and never again: not on save, not after a restart', async () => {
    const folder = tempDir('ab-ms-');
    // The milestone file is written first: the cards it covers still resolve, as the import waits for the scan.
    write(folder, 'checkout/milestone-1.md', MILESTONE);
    write(folder, 'checkout/flow.md', '# Flow');
    write(folder, 'ui/card-form.html', '<p>form</p>');
    const b1 = await board(folder);
    const doc = b1.doc;
    await until(() => storiesMap(doc).size === 2, 3000, 'stories');
    const m = [...milestonesMap(doc).values()][0]!;
    expect(m).toMatchObject({ frame: 'frame:checkout', number: 1, name: 'Pay by card', author: "arif's agent" });
    const flow = itemAt(doc, 'checkout/flow.md')!;
    const form = itemAt(doc, 'ui/card-form.html')!;
    expect(storiesMap(doc).get('story-1')).toMatchObject({ covers: [form.id, flow.id], authorKind: 'agent' });
    expect(storiesMap(doc).get('story-2')).toMatchObject({ blockedBy: ['story-1'], owner: 'Mei Ling' });

    // A person edits a story; the agent saves the file again with a changed entry and a new one.
    editStory(doc, 'story-1', { title: 'Payment first' });
    write(folder, 'checkout/milestone-1.md', MILESTONE.replace('my payment ready', 'CHANGED') + '\n## Save the card\n- story: s\n- check: c\n');
    await until(() => itemAt(doc, 'checkout/milestone-1.md')?.text.includes('Save the card'), 3000, 'saved');
    await new Promise((r) => setTimeout(r, 600));
    expect(storiesMap(doc).size).toBe(2);
    expect(storiesMap(doc).get('story-1')).toMatchObject({ title: 'Payment first', story: expect.stringContaining('my payment ready') });

    const exported = () => JSON.parse(readFileSync(join(folder, STATE_DIR, EXPORT_FILE), 'utf8')) as BoardExport;
    await until(() => exported().stories?.[0]?.title === 'Payment first', 3000, 'export');
    expect(exported().milestones.map((x) => x.summary)).toEqual(['2 stories · 0 approved · 1 can start']);

    await until(() => storiesMap(loadDoc(join(folder, STATE_DIR, DOC_FILE))).get('story-1')?.title === 'Payment first', 3000, 'saved to disk');
    await b1.stop();
    cleanup.length = 0;

    const b2 = await board(folder);
    await new Promise((r) => setTimeout(r, 600));
    expect(milestonesMap(b2.doc).size).toBe(1);
    expect(storiesMap(b2.doc).size).toBe(2);
    expect(storiesMap(b2.doc).get('story-1')?.title).toBe('Payment first');
  });

  it('a file that is not a milestone file is a plain card', async () => {
    const folder = tempDir('ab-ms-');
    write(folder, 'checkout/milestone-notes.md', '# Notes about milestones');
    const b = await board(folder);
    await until(() => itemAt(b.doc, 'checkout/milestone-notes.md'), 3000, 'card');
    await new Promise((r) => setTimeout(r, 400));
    expect(milestonesMap(b.doc).size).toBe(0);
  });
});
