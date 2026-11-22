import { CaptureUpdateAction, Excalidraw, MainMenu } from '@excalidraw/excalidraw';
import type { ExcalidrawElement, NonDeleted, ExcalidrawEmbeddableElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, ExcalidrawImperativeAPI, ExcalidrawInitialDataState, NormalizedZoomValue } from '@excalidraw/excalidraw/types';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { selectedIds, undoActivation, type ActivationState } from './activation';
import { EMBED_SCHEME, FONT_HELVETICA, kindOf, roughMeasure, type El, type Measure } from './elements';
import { BlockEmbed } from './embeds';
import { barRoom, isNarrow } from './bars';
import { contentBounds, firstBoardBounds, firstView, fitTop, inView, readableZoom, type Fit } from './fit';
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

/** Another person's pointer on the canvas. */
export interface CursorOf {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
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
  /** Select these elements (and nothing else), once they are on the canvas. */
  select(ids: string[]): void;
  /** Show the whole board. */
  fitAll(): void;
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
  return kind === 'file' || kind === 'decision' || kind === 'snapshot' ? <BlockEmbed id={el.id} /> : null;
};

const BOARD_KINDS = new Set(['file', 'decision', 'snapshot', 'sticky']);


function showView(api: ExcalidrawImperativeAPI, f: Fit): void {
  api.updateScene({
    appState: { scrollX: f.scrollX, scrollY: f.scrollY, zoom: { value: f.zoom as NormalizedZoomValue } },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

const viewSpace = (api: ExcalidrawImperativeAPI) => {
  const s = api.getAppState();
  const narrow = isNarrow();
  const room = barRoom(narrow);
  return { narrow, space: { width: s.width, height: s.height, top: room.top, bottom: room.bottom, pad: 12 } };
};

/** Shows the whole board, from the top: on a phone it fills the width instead of sitting mid-screen. */
function fitBoard(api: ExcalidrawImperativeAPI): void {
  const b = contentBounds(api.getSceneElements());
  if (!b) return;
  showView(api, fitTop(b, viewSpace(api).space));
}

/**
 * The first view: the first feature board's Product and Engineering areas, at a zoom where the
 * cards can be read (on a phone, one card across). "Fit all" shows the rest.
 */
function openView(api: ExcalidrawImperativeAPI): void {
  const b = firstBoardBounds(api.getSceneElements() as unknown as El[]);
  if (!b) return;
  const { narrow, space } = viewSpace(api);
  showView(api, firstView(b, space, readableZoom(space, narrow)));
}

/**
 * The board on an Excalidraw canvas. The doc stays the source of truth (see sync.ts); this only
 * wires Excalidraw's API to the bridge and reports the selection.
 */
export const BoardCanvas = memo(function BoardCanvas({
  doc,
  onSelection,
  onViewport,
  onReady,
  cursors,
  onPointer,
}: {
  doc: Y.Doc;
  onSelection: (s: Selection) => void;
  onViewport?: (v: Viewport) => void;
  /** Called once the first scene from the doc is on the canvas. */
  onReady?: () => void;
  /** Other people's pointers on a shared board, with their names. */
  cursors?: readonly CursorOf[];
  /** This person's pointer moved (scene coordinates). */
  onPointer?: (p: { x: number; y: number }) => void;
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  // Other people's pointers: Excalidraw's collaborators.
  useEffect(() => {
    if (!api || !cursors) return;
    const collaborators = new Map(
      cursors.map((c) => [
        c.id,
        { username: c.name, pointer: { x: c.x, y: c.y, tool: 'pointer' as const }, color: { background: c.color, stroke: c.color }, id: c.id },
      ]),
    );
    api.updateScene({ collaborators: collaborators as unknown as AppState['collaborators'], captureUpdate: CaptureUpdateAction.NEVER });
  }, [api, cursors]);
  const picked = useRef<string[]>([]);
  const lastKey = useRef('');
  const fitted = useRef(false);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  /** The selection as of the last change that activated nothing (see activation.ts). */
  const lastSelected = useRef<Record<string, true>>({});

  useEffect(() => {
    apiRef.current = api;
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
        // The first view when the board first shows, and again if the scene was replaced (scroll reset with it).
        const live = elements.some((e) => !e.isDeleted);
        const board = (window as unknown as { __board?: { opened?: boolean } }).__board;
        if (!live) {
          fitted.current = false;
          if (board) board.opened = false;
        } else if (!fitted.current) {
          fitted.current = true;
          openView(api);
          if (board) board.opened = true;
          onReady?.();
        }
      }),
    ];
    window.addEventListener('pointercancel', up);
    // For the end-to-end checks: the canvas draws on a <canvas>, so they read the scene here.
    (window as unknown as { __board?: unknown }).__board = { api, sync, opened: fitted.current };
    onViewport?.({
      center: () => {
        const s = api.getAppState();
        return { x: -s.scrollX + s.width / 2 / s.zoom.value, y: -s.scrollY + s.height / 2 / s.zoom.value };
      },
      fitAll: () => fitBoard(api),
      select: (ids) => {
        // A new item reaches the canvas with the next merge: wait for it (a few frames at most).
        let frames = 0;
        const go = () => {
          const on = new Set(api.getSceneElements().map((e) => e.id));
          if (ids.some((id) => !on.has(id)) && frames++ < 30) {
            requestAnimationFrame(go);
            return;
          }
          const els = api.getSceneElements().filter((e) => ids.includes(e.id));
          api.updateScene({
            appState: { selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true as const])) },
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          // Bring them into view if they are not (a new note can land past the edge of the view).
          const b = contentBounds(els);
          const s = api.getAppState();
          const room = barRoom(isNarrow());
          if (b && !inView(b, { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value, width: s.width, height: s.height, ...room })) {
            api.scrollToContent(els, { animate: false });
          }
        };
        go();
      },
    });
    return () => {
      stop();
      for (const off of offs) off();
      window.removeEventListener('pointercancel', up);
    };
  }, [api, doc, onReady, onViewport]);

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      const undo = undoActivation(appState as unknown as ActivationState, lastSelected.current);
      if (undo && apiRef.current) {
        apiRef.current.updateScene({ appState: undo, captureUpdate: CaptureUpdateAction.NEVER });
        return;
      }
      lastSelected.current = selectedIds(appState as unknown as ActivationState);
      const ids = Object.keys(lastSelected.current);
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
      onPointerUpdate={onPointer ? (p) => onPointer({ x: p.pointer.x, y: p.pointer.y }) : undefined}
      aiEnabled={false}
    >
      <MainMenu>
        <MainMenu.DefaultItems.ToggleTheme />
        <MainMenu.DefaultItems.Help />
      </MainMenu>
    </Excalidraw>
  );
});
