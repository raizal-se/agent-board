/** The part of Excalidraw's app state that an embeddable's activation touches. */
export interface ActivationState {
  activeEmbeddable?: { state: 'hover' | 'active' } | null;
  selectedElementIds: Readonly<Record<string, boolean>>;
}

/**
 * Excalidraw "activates" an embeddable on a short click in its middle third (and on a double-click):
 * 100 ms later it selects that element alone and lets the pointer through to its content
 * (App.handleEmbeddableCenterClick). Our blocks are not pages to interact with: their buttons take
 * the pointer anyway (styles.css). And that late selection overwrites whatever came in between: a
 * Shift+click, a cleared selection, the next block clicked. So it is undone: no active embeddable, and
 * the selection from before it. Returns the app state to put back, or null if nothing was activated.
 */
export function undoActivation(
  app: ActivationState,
  before: Readonly<Record<string, true>>,
): { activeEmbeddable: null; selectedElementIds: Record<string, true> } | null {
  if (app.activeEmbeddable?.state !== 'active') return null;
  return { activeEmbeddable: null, selectedElementIds: { ...before } };
}

/** The selected ids, as Excalidraw keeps them (a map of id to true). */
export function selectedIds(app: ActivationState): Record<string, true> {
  const out: Record<string, true> = {};
  for (const [id, on] of Object.entries(app.selectedElementIds)) if (on) out[id] = true;
  return out;
}
