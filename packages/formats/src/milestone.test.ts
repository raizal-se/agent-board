import { describe, expect, it } from 'vitest';
import { isMilestoneFile, isMilestonePath, parseMilestoneFile } from './milestone';

const DESIGN = `# Milestone 1: Pay by card
Goal: a shopper can pay by card, with 3DS.

## Payment ready before form
- story: As a shopper, I want my payment to be ready before I see the card form, so that checkout feels instant.
- size: S
- owner:
- covers: card-form.html, payment-sequence.md
- blocked-by:
- check: the card form opens with an intent ID already set.

## Pass the 3DS check
- story: As a shopper, I want to pass the 3DS check of my bank, so that my card payment is accepted.
- size: M
- owner: Mei Ling
- covers: 3ds.html, 3ds-flow.md
- blocked-by: Payment ready before form
- check: a 3DS test card shows the bank challenge, and the intent status is succeeded.
`;

describe('isMilestoneFile', () => {
  it('needs the name milestone-*.md and the heading first', () => {
    expect(isMilestoneFile('checkout/milestone-1.md', DESIGN)).toBe(true);
    expect(isMilestoneFile('checkout/milestone-pay.md', DESIGN)).toBe(true);
    expect(isMilestoneFile('checkout/milestones.md', DESIGN)).toBe(false);
    expect(isMilestoneFile('checkout/milestone-1.html', DESIGN)).toBe(false);
    expect(isMilestoneFile('checkout/milestone-1.md', '# Notes\n# Milestone 1: x')).toBe(false);
    expect(isMilestoneFile('checkout/milestone-1.md', '# Milestone one: x')).toBe(false);
  });

  it('skips front matter and empty lines before the heading', () => {
    expect(isMilestoneFile('a/milestone-2.md', '---\narea: product\n---\n\n# Milestone 2: Refunds\n')).toBe(true);
  });

  it('isMilestonePath looks at the name only', () => {
    expect(isMilestonePath('a/b/Milestone-3.md')).toBe(true);
    expect(isMilestonePath('a/milestone-3.md/x.md')).toBe(false);
  });
});

describe('parseMilestoneFile', () => {
  it('reads all fields of the design 5.5 example', () => {
    const m = parseMilestoneFile('checkout/milestone-1.md', DESIGN)!;
    expect(m.number).toBe(1);
    expect(m.name).toBe('Pay by card');
    expect(m.goal).toBe('a shopper can pay by card, with 3DS.');
    expect(m.problems).toEqual([]);
    expect(m.entries).toEqual([
      {
        title: 'Payment ready before form',
        story: 'As a shopper, I want my payment to be ready before I see the card form, so that checkout feels instant.',
        size: 'S',
        owner: '',
        covers: ['card-form.html', 'payment-sequence.md'],
        blockedBy: [],
        check: 'the card form opens with an intent ID already set.',
        unknown: {},
        problems: [],
      },
      {
        title: 'Pass the 3DS check',
        story: 'As a shopper, I want to pass the 3DS check of my bank, so that my card payment is accepted.',
        size: 'M',
        owner: 'Mei Ling',
        covers: ['3ds.html', '3ds-flow.md'],
        blockedBy: ['Payment ready before form'],
        check: 'a 3DS test card shows the bank challenge, and the intent status is succeeded.',
        unknown: {},
        problems: [],
      },
    ]);
  });

  it('is null for a file that is not a milestone file', () => {
    expect(parseMilestoneFile('checkout/flow.md', DESIGN)).toBeNull();
    expect(parseMilestoneFile('checkout/milestone-1.md', '# Flow')).toBeNull();
  });

  it('finds blocked-by by title, in any case, and reports unknown titles', () => {
    const m = parseMilestoneFile(
      'x/milestone-1.md',
      `# Milestone 1: X\n## A\n- story: a\n- check: c\n## B\n- story: b\n- check: c\n- blocked-by: a, Nope, B\n`,
    )!;
    const b = m.entries[1]!;
    expect(b.blockedBy).toEqual(['A']);
    expect(b.problems).toEqual(['blocked-by "Nope" is not a story title in this file', 'a story cannot be blocked by itself']);
  });

  it('keeps unknown fields, and reads field names in any case', () => {
    const m = parseMilestoneFile('x/milestone-1.md', `# Milestone 1: X\n## A\n- Story: a\n- Blocked by:\n- priority: high\n- check: c\n`)!;
    expect(m.entries[0]!.story).toBe('a');
    expect(m.entries[0]!.unknown).toEqual({ priority: 'high' });
    expect(m.entries[0]!.problems).toEqual([]);
  });

  it('joins a field that runs on to the next line', () => {
    const m = parseMilestoneFile('x/milestone-1.md', `# Milestone 1: X\nGoal: one\n  two\n## A\n- story: As a shopper,\n  I want x\n- check: c\n`)!;
    expect(m.goal).toBe('one two');
    expect(m.entries[0]!.story).toBe('As a shopper, I want x');
  });

  it('reads a broken entry and says what is wrong; the others are fine', () => {
    const m = parseMilestoneFile(
      'x/milestone-1.md',
      `# Milestone 1: X\nstray text\n## Broken\nsome words\n- size: XL\n- size: L\n## \n- story: no title\n## Fine\n- story: s\n- size: m\n- check: c\n## Fine\n- story: again\n`,
    )!;
    expect(m.entries.map((e) => e.title)).toEqual(['Broken', 'Fine']);
    const broken = m.entries[0]!;
    expect(broken.size).toBe('L');
    expect(broken.problems).toEqual([
      'line 4: not a field ("- name: value"): "some words"',
      '"size" is given twice; the last one counts',
      'no story sentence',
      'no check',
    ]);
    expect(m.entries[1]).toMatchObject({ size: 'M', problems: [] });
    expect(m.problems).toEqual([
      'line 2: text before the first story is not read: "stray text"',
      'line 7: a story with no title is not read',
      'line 13: the title "Fine" is used twice; the second one is not read',
    ]);
  });

  it('reports a size that is not S, M or L', () => {
    const m = parseMilestoneFile('x/milestone-1.md', `# Milestone 1: X\n## A\n- story: a\n- size: XL\n- check: c\n`)!;
    expect(m.entries[0]!.size).toBeNull();
    expect(m.entries[0]!.problems).toEqual(['size "XL" is not S, M or L']);
  });

  it('handles CRLF and a heading with a dot separator', () => {
    const m = parseMilestoneFile('x/milestone-4.md', `# Milestone 4 · Refunds\r\nGoal: g\r\n## A\r\n- story: a\r\n- check: c\r\n`)!;
    expect(m).toMatchObject({ number: 4, name: 'Refunds', goal: 'g' });
    expect(m.entries[0]!.check).toBe('c');
  });
});
