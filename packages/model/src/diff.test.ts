import { describe, expect, it } from 'vitest';
import { lineDiff, splitLines } from './diff';

describe('lineDiff', () => {
  it('an edited line is one changed line', () => {
    const rows = lineDiff('# API\ntimeout: 30s\nretry: 3\n', '# API\ntimeout: 60s\nretry: 3\n');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'changed', 'same']);
    expect(rows[1]).toEqual({ kind: 'changed', left: 'timeout: 30s', right: 'timeout: 60s', leftNo: 2, rightNo: 2 });
  });

  it('shows added and removed lines with their line numbers', () => {
    const rows = lineDiff('a\nb\nc', 'a\nc\nd');
    expect(rows).toEqual([
      { kind: 'same', left: 'a', right: 'a', leftNo: 1, rightNo: 1 },
      { kind: 'removed', left: 'b', leftNo: 2 },
      { kind: 'same', left: 'c', right: 'c', leftNo: 3, rightNo: 2 },
      { kind: 'added', right: 'd', rightNo: 3 },
    ]);
  });

  it('pairs a run of edits as changed lines, the extra ones as added', () => {
    const rows = lineDiff('x\n1\n2\ny', 'x\nA\nB\nC\ny');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'changed', 'changed', 'added', 'same']);
  });

  it('handles empty texts and same texts', () => {
    expect(lineDiff('', '')).toEqual([]);
    expect(lineDiff('', 'a\n').map((r) => r.kind)).toEqual(['added']);
    expect(lineDiff('a\r\nb', 'a\nb').every((r) => r.kind === 'same')).toBe(true);
    expect(splitLines('a\n')).toEqual(['a']);
  });
});
