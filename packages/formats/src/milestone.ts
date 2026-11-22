import { stripFrontMatter } from './links';

/**
 * The milestone file (design 5.5): an agent writes the first cut of a milestone's stories as one
 * markdown file in a feature folder. The board reads it once, at import.
 *
 * ```markdown
 * # Milestone 1: Pay by card
 * Goal: a shopper can pay by card, with 3DS.
 *
 * ## Payment ready before form
 * - story: As a shopper, I want …, so that …
 * - size: S
 * - owner:
 * - covers: card-form.html, flow.md
 * - blocked-by:
 * - check: the card form opens with an intent ID already set.
 * ```
 *
 * A file is a milestone file when its name is `milestone-<anything>.md` and its first heading is
 * `# Milestone <n>: <name>`.
 */

export type StorySize = 'S' | 'M' | 'L';

export interface MilestoneEntry {
  /** The `##` heading: the story's short title. */
  title: string;
  story: string;
  /** Null when the field is missing, empty or not S, M or L. */
  size: StorySize | null;
  owner: string;
  /** File names or paths, as written. */
  covers: string[];
  /** Titles of other entries in the same file. Unknown titles are left out (and reported). */
  blockedBy: string[];
  check: string;
  /** Fields the board does not know, kept as written. */
  unknown: Record<string, string>;
  /** What was wrong with this entry. The entry is still imported. */
  problems: string[];
}

export interface MilestoneFile {
  number: number;
  name: string;
  goal: string;
  entries: MilestoneEntry[];
  /** Problems outside the entries: text before the first entry, an entry with no title, a title used twice. */
  problems: string[];
}

const FILE_NAME = /(?:^|\/)milestone-[^/]*\.md$/i;
const HEADING = /^#[ \t]+Milestone[ \t]+(\d+)[ \t]*[:·\-–—][ \t]*(.+?)[ \t]*#*[ \t]*$/i;
const FIELD = /^[-*][ \t]+([A-Za-z][A-Za-z _-]*?)[ \t]*:[ \t]*(.*)$/;
const KNOWN = ['story', 'size', 'owner', 'covers', 'blocked-by', 'check'] as const;
type Known = (typeof KNOWN)[number];

/** The first line that is not empty, after front matter. */
function firstLine(text: string): string {
  for (const line of stripFrontMatter(text).split(/\r?\n/)) if (line.trim()) return line.trim();
  return '';
}

/** Whether the path names a milestone file (by its name only). */
export function isMilestonePath(path: string): boolean {
  return FILE_NAME.test(path.replace(/\\/g, '/'));
}

/** Whether this file is a milestone file: name `milestone-*.md` and a `# Milestone <n>: <name>` heading first. */
export function isMilestoneFile(path: string, text: string): boolean {
  return isMilestonePath(path) && HEADING.test(firstLine(text));
}

const list = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function fieldKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[ _]+/g, '-');
}

/** Parse a milestone file. Null when it is not one (see `isMilestoneFile`). Never throws. */
export function parseMilestoneFile(path: string, text: string): MilestoneFile | null {
  if (!isMilestoneFile(path, text)) return null;
  const lines = stripFrontMatter(text).split(/\r?\n/);
  const problems: string[] = [];
  let number = 0;
  let name = '';
  let goal = '';
  let seenHeading = false;

  interface Raw {
    title: string;
    fields: Map<string, string>;
    order: string[];
    problems: string[];
    line: number;
  }
  const raws: Raw[] = [];
  let cur: Raw | null = null;
  let last: string | null = null;

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) {
      last = null;
      return;
    }
    if (!seenHeading) {
      const m = HEADING.exec(t);
      if (m) {
        seenHeading = true;
        number = Number(m[1]);
        name = m[2]!.trim();
      }
      return;
    }
    const h2 = /^##[ \t]*(.*?)[ \t]*#*$/.exec(t);
    if (h2 && !t.startsWith('###')) {
      cur = { title: h2[1]!.trim(), fields: new Map(), order: [], problems: [], line: i + 1 };
      raws.push(cur);
      last = null;
      return;
    }
    if (!cur) {
      const g = /^goal[ \t]*:[ \t]*(.*)$/i.exec(t);
      if (g) goal = g[1]!.trim();
      else if (goal && last === 'goal') goal = `${goal} ${t}`;
      else problems.push(`line ${i + 1}: text before the first story is not read: "${t}"`);
      last = g ? 'goal' : last;
      return;
    }
    const f = FIELD.exec(t);
    if (f) {
      const key = fieldKey(f[1]!);
      if (cur.fields.has(key)) cur.problems.push(`"${key}" is given twice; the last one counts`);
      else cur.order.push(key);
      cur.fields.set(key, f[2]!.trim());
      last = key;
      return;
    }
    if (last && cur.fields.has(last)) {
      // A field that runs on to the next line.
      cur.fields.set(last, `${cur.fields.get(last)} ${t}`.trim());
      return;
    }
    cur.problems.push(`line ${i + 1}: not a field ("- name: value"): "${t}"`);
  });

  const titles = new Set<string>();
  const kept: Raw[] = [];
  for (const r of raws) {
    if (!r.title) {
      problems.push(`line ${r.line}: a story with no title is not read`);
      continue;
    }
    const key = r.title.toLowerCase();
    if (titles.has(key)) {
      problems.push(`line ${r.line}: the title "${r.title}" is used twice; the second one is not read`);
      continue;
    }
    titles.add(key);
    kept.push(r);
  }
  const byTitle = new Map(kept.map((r) => [r.title.toLowerCase(), r.title]));

  const entries = kept.map((r): MilestoneEntry => {
    const get = (k: Known) => r.fields.get(k) ?? '';
    const out: string[] = [...r.problems];
    const sizeRaw = get('size').toUpperCase();
    const size = sizeRaw === 'S' || sizeRaw === 'M' || sizeRaw === 'L' ? sizeRaw : null;
    if (!size && get('size')) out.push(`size "${get('size')}" is not S, M or L`);
    const blockedBy: string[] = [];
    for (const b of list(get('blocked-by'))) {
      const t = byTitle.get(b.toLowerCase());
      if (!t) out.push(`blocked-by "${b}" is not a story title in this file`);
      else if (t === r.title) out.push('a story cannot be blocked by itself');
      else if (!blockedBy.includes(t)) blockedBy.push(t);
    }
    if (!get('story')) out.push('no story sentence');
    if (!get('check')) out.push('no check');
    const unknown: Record<string, string> = {};
    for (const k of r.order) if (!(KNOWN as readonly string[]).includes(k)) unknown[k] = r.fields.get(k) ?? '';
    return {
      title: r.title,
      story: get('story'),
      size,
      owner: get('owner'),
      covers: list(get('covers')),
      blockedBy,
      check: get('check'),
      unknown,
      problems: out,
    };
  });

  return { number, name, goal, entries, problems };
}
