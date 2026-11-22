/**
 * A line diff for "compare" (design 6). A line that was edited shows as one changed line, not as a
 * removed line and an added line.
 */
export type DiffRow =
  | { kind: 'same'; left: string; right: string; leftNo: number; rightNo: number }
  | { kind: 'changed'; left: string; right: string; leftNo: number; rightNo: number }
  | { kind: 'removed'; left: string; leftNo: number }
  | { kind: 'added'; right: string; rightNo: number };

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Longest common subsequence table, kept small by trimming the common start and end first. */
export function lineDiff(before: string, after: string): DiffRow[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i++) rows.push({ kind: 'same', left: a[i]!, right: b[i]!, leftNo: i + 1, rightNo: i + 1 });

  const n = endA - start;
  const m = endB - start;
  // ops over the middle: 's' same, '-' removed, '+' added
  const ops: ('s' | '-' | '+')[] = [];
  if (n * m <= 4_000_000) {
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = a[start + i] === b[start + j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        ops.push('s');
        i++;
        j++;
      } else if (j < m && (i === n || lcs[i * w + j + 1]! >= lcs[(i + 1) * w + j]!)) {
        ops.push('+');
        j++;
      } else {
        ops.push('-');
        i++;
      }
    }
  } else {
    // Too large to align line by line: everything between the common start and end changed.
    for (let i = 0; i < n; i++) ops.push('-');
    for (let j = 0; j < m; j++) ops.push('+');
  }

  let i = start;
  let j = start;
  for (let k = 0; k < ops.length; ) {
    if (ops[k] === 's') {
      rows.push({ kind: 'same', left: a[i]!, right: b[j]!, leftNo: i + 1, rightNo: j + 1 });
      i++;
      j++;
      k++;
      continue;
    }
    // A run of removed and added lines: pair them up as changed lines, the rest stay removed or added.
    const removed: number[] = [];
    const added: number[] = [];
    while (k < ops.length && ops[k] !== 's') {
      if (ops[k] === '-') removed.push(i++);
      else added.push(j++);
      k++;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let p = 0; p < pairs; p++) rows.push({ kind: 'changed', left: a[removed[p]!]!, right: b[added[p]!]!, leftNo: removed[p]! + 1, rightNo: added[p]! + 1 });
    for (const r of removed.slice(pairs)) rows.push({ kind: 'removed', left: a[r]!, leftNo: r + 1 });
    for (const r of added.slice(pairs)) rows.push({ kind: 'added', right: b[r]!, rightNo: r + 1 });
  }

  for (let k = 0; k < a.length - endA; k++) rows.push({ kind: 'same', left: a[endA + k]!, right: b[endB + k]!, leftNo: endA + k + 1, rightNo: endB + k + 1 });
  return rows;
}
