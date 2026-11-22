import { describe, expect, it } from 'vitest';
import { selectedIds, undoActivation } from './activation';

describe('an embeddable activated by a click in its middle', () => {
  it('is undone, and the selection made in between comes back (a Shift+click on a second block)', () => {
    const before = selectedIds({ selectedElementIds: { flow: true, api: true } });
    // Excalidraw's late setState: the first block alone, active.
    const late = { activeEmbeddable: { state: 'active' as const }, selectedElementIds: { flow: true } };
    expect(undoActivation(late, before)).toEqual({ activeEmbeddable: null, selectedElementIds: { flow: true, api: true } });
  });

  it('a cleared selection stays cleared', () => {
    const late = { activeEmbeddable: { state: 'active' as const }, selectedElementIds: { flow: true } };
    expect(undoActivation(late, {})).toEqual({ activeEmbeddable: null, selectedElementIds: {} });
  });

  it('leaves a hover, or no activation, alone', () => {
    expect(undoActivation({ activeEmbeddable: { state: 'hover' }, selectedElementIds: { api: true } }, {})).toBeNull();
    expect(undoActivation({ activeEmbeddable: null, selectedElementIds: { api: true } }, {})).toBeNull();
  });

  it('reads the selected ids without the ones Excalidraw turned off', () => {
    expect(selectedIds({ selectedElementIds: { a: true, b: false } })).toEqual({ a: true });
  });
});
