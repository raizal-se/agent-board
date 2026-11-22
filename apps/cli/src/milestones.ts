import { parseMilestoneFile } from '@agent-board/formats';
import { fileItems, importMilestone, milestoneFromFile } from '@agent-board/model';
import type * as Y from 'yjs';

/**
 * Import each milestone file that has no milestone yet (design 5.5): one milestone with one draft
 * story per entry, in the file's frame. A file is read once: after that, its stories belong to the
 * people on the board, and new entries come in only when a person clicks "import new entries".
 * Returns the ids of the milestones made.
 */
export function importMilestoneFiles(doc: Y.Doc, log: (line: string) => void = () => {}): string[] {
  const made: string[] = [];
  for (const f of fileItems(doc)) {
    if (f.gone || f.type !== 'markdown' || milestoneFromFile(doc, f.id)) continue;
    const parsed = parseMilestoneFile(f.path, f.text);
    if (!parsed) continue;
    const r = importMilestone(doc, f, parsed);
    made.push(r.milestone);
    log(`imported ${f.path}: ${r.stories.length} ${r.stories.length === 1 ? 'story' : 'stories'}`);
    for (const p of parsed.problems) log(`  ${f.path}: ${p}`);
    for (const e of parsed.entries) for (const p of e.problems) log(`  ${f.path} "${e.title}": ${p}`);
  }
  return made;
}

/**
 * Import milestone files after the first scan (so the cards they cover are on the board), and then
 * shortly after each burst of changes.
 */
export function autoImport(doc: Y.Doc, ready: Promise<void>, opts: { delayMs?: number; log?: (line: string) => void } = {}): { close(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let open = false;
  let closed = false;
  const run = () => {
    timer = undefined;
    if (!closed) importMilestoneFiles(doc, opts.log);
  };
  const onUpdate = () => {
    if (open && !closed && !timer) timer = setTimeout(run, opts.delayMs ?? 300);
  };
  void ready.then(() => {
    open = true;
    run();
  });
  doc.on('update', onUpdate);
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      doc.off('update', onUpdate);
    },
  };
}
