import { CaptureUpdateAction, Excalidraw, MainMenu } from '@excalidraw/excalidraw';
import type { ExcalidrawElement, NonDeleted, ExcalidrawEmbeddableElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { EMBED_SCHEME, FONT_HELVETICA, kindOf, roughMeasure, type El, type Measure } from './elements';
import { BlockEmbed } from './embeds';
import type { GestureState } from './scene';
import { BoardSync } from './sync';

/** Measures text the way the canvas draws it. */
function canvasMeasure(): Measure {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return roughMeasure;
  return (line, fontSize) => {
    ctx.font = `${fontSize}px Helvetica, Arial, sans-serif`;
    return ctx.measureText(line).width;
  };
}

/** What is selected on the canvas: board items in the order they were picked, or one drawn link. */
export interface Selection {
  items: string[];
  link: string | null;
}

/** Where the view is, for placing new things in the middle of it. */
export interface Viewport {
  /** The scene point in the middle of the screen. */
  center(): { x: number; y: number };
  /** Select these elements (and nothing else). */
  select(ids: string[]): void;
}

const INITIAL: ExcalidrawInitialDataState = {
  appState: {
    viewBackgroundColor: '#f7f6f3',
    currentItemRoughness: 0,
    currentItemFontFamily: FONT_HELVETICA,
    currentItemStrokeColor: '#1f1f1c',
    currentItemEndArrowhead: 'arrow',
    frameRendering: { enabled: true, name: true, outline: true, clip: true },
    // Board things snap to nothing; this keeps a drag where the hand is.
    objectsSnapModeEnabled: false,
  },
};

const UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false as const,
    loadScene: false,
    saveToActiveFile: false,
    toggleTheme: null,
    saveAsImage: false,
  },
  tools: { image: false },
};

/** Only our own blocks embed: nothing on the canvas loads a page from outside. */
const validateEmbeddable = (link: string) => link.startsWith(EMBED_SCHEME);

const renderEmbeddable = (el: NonDeleted<ExcalidrawEmbeddableElement>) => {
  const kind = kindOf(el as unknown as El);
  return kind === 'file' || kind === 'decision' ? <BlockEmbed id={el.id} /> : null;
};

const BOARD_KINDS = new Set(['file', 'decision', 'sticky']);

/**
 * The board on an Excalidraw canvas. The doc stays the source of truth (see sync.ts); this only
 * wires Excalidraw's API to the bridge and reports the selection.
 */
export const BoardCanvas = memo(function BoardCanvas({
  doc,
  onSelection,
  onViewport,
  onReady,
}: {
  doc: Y.Doc;
  onSelection: (s: Selection) => void;
  onViewport?: (v: Viewport) => void;
  /** Called once the first scene from the doc is on the canvas. */
  onReady?: () => void;
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const picked = useRef<string[]>([]);
  const lastKey = useRef('');
  const fitted = useRef(false);

  useEffect(() => {
    if (!api) return;
    const sync = new BoardSync(
      doc,
      {
        getSceneElementsIncludingDeleted: () => api.getSceneElementsIncludingDeleted() as unknown as readonly El[],
        getAppState: () => api.getAppState() as unknown as GestureState,
        updateScene: (elements) =>
          api.updateScene({ elements: elements as unknown as ExcalidrawElement[], captureUpdate: CaptureUpdateAction.NEVER }),
      },
      { measure: canvasMeasure(), delayMs: 16 },
    );
    const stop = sync.start();
    const up = () => sync.pointer(false);
    const offs = [
      api.onPointerDown(() => sync.pointer(true)),
      api.onPointerUp(up),
      api.onChange((elements) => {
        sync.changed();
        // Fit when the board first shows, and again if the scene was replaced (scroll reset with it).
        const live = elements.some((e) => !e.isDeleted);
        if (!live) fitted.current = false;
        else if (!fitted.current) {
          fitted.current = true;
          api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9 });
          onReady?.();
        }
      }),
    ];
    window.addEventListener('pointercancel', up);
    // For the end-to-end checks: the canvas draws on a <canvas>, so they read the scene here.
    (window as unknown as { __board?: unknown }).__board = { api, sync };
    onViewport?.({
      center: () => {
        const s = api.getAppState();
        return { x: -s.scrollX + s.width / 2 / s.zoom.value, y: -s.scrollY + s.height / 2 / s.zoom.value };
      },
      select: (ids) =>
        api.updateScene({
          appState: { selectedElementIds: Object.fromEntries(ids.map((id) => [id, true as const])) },
          captureUpdate: CaptureUpdateAction.NEVER,
        }),
    });
    return () => {
      stop();
      for (const off of offs) off();
      window.removeEventListener('pointercancel', up);
    };
  }, [api, doc, onReady, onViewport]);

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      const ids = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]);
      if (ids.length === 0 && picked.current.length === 0 && lastKey.current === '') return;
      const byId = new Map(elements.map((e) => [e.id, e as unknown as El]));
      const items = ids.filter((id) => BOARD_KINDS.has(kindOf(byId.get(id)) ?? ''));
      picked.current = [...picked.current.filter((id) => items.includes(id)), ...items.filter((id) => !picked.current.includes(id))];
      const links = ids.filter((id) => kindOf(byId.get(id)) === 'link');
      const sel: Selection = { items: picked.current, link: items.length === 0 && links.length === 1 ? links[0]! : null };
      const key = `${sel.items.join(',')}|${sel.link ?? ''}`;
      if (key === lastKey.current) return;
      lastKey.current = key;
      onSelection(sel);
    },
    [onSelection],
  );

  return (
    <Excalidraw
      excalidrawAPI={setApi}
      initialData={INITIAL}
      onChange={onChange}
      UIOptions={UI_OPTIONS}
      validateEmbeddable={validateEmbeddable}
      renderEmbeddable={renderEmbeddable}
      onLinkOpen={(_el, e) => e.preventDefault()}
      aiEnabled={false}
    >
      <MainMenu>
        <MainMenu.DefaultItems.ToggleTheme />
        <MainMenu.DefaultItems.Help />
      </MainMenu>
    </Excalidraw>
  );
});
