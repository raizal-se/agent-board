import {
  addHumanEdge,
  addSticky,
  agreeItem,
  BLOCK_W,
  deleteHumanEdge,
  isSnapId,
  layoutMap,
  rejectItem,
  setEdgeLabel,
  switchArea,
  type FileItem,
  type Person,
} from '@agent-board/model';
import type { ConnectionStatus } from '@agent-board/sync';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { CompareView } from './blocks/CompareView';
import { FullView } from './blocks/FullView';
import { HiddenList } from './blocks/HiddenList';
import { TextDialog } from './blocks/TextDialog';
import { ThreadPanel } from './blocks/ThreadPanel';
import { BoardActionsContext, type BoardActions } from './board/actions';
import type { BoardConnection } from './board/connection';
import { nameOf, views } from './board/derive';
import { noteSpot } from './board/place';
import { useBoardState } from './board/useBoard';
import { useNarrow } from './canvas/bars';
import { BoardCanvas, type Selection, type Viewport } from './canvas/BoardCanvas';
import { ViewsContext } from './canvas/embeds';

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: 'connecting…',
  online: 'live',
  offline: 'CLI not reachable, retrying…',
  'other-board': 'the CLI serves another board now, reloading…',
};

function useStatus(conn: BoardConnection): ConnectionStatus {
  return useSyncExternalStore(conn.onStatus, conn.status);
}

type Ask =
  | { kind: 'link'; from: string; to: string }
  | { kind: 'reject'; item: string }
  | { kind: 'label'; edge: string; initial: string };

const NONE: Selection = { items: [], link: null };

export function App({ conn }: { conn: BoardConnection }) {
  const { doc } = conn;
  const state = useBoardState(doc);
  const v = useMemo(() => views(state), [state]);
  const status = useStatus(conn);
  const [openId, setOpenId] = useState<string | null>(null);
  const [threadOn, setThreadOn] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [sel, setSel] = useState<Selection>(NONE);
  const [viewport, setViewport] = useState<Viewport | null>(null);

  const me: Person = useMemo(() => {
    const owner = state.owner || 'me';
    return { name: owner, side: state.devices.get(owner)?.side ?? 'product' };
  }, [state.owner, state.devices]);

  const actions = useMemo<BoardActions>(
    () => ({
      doc,
      me,
      open: (item: FileItem) => setOpenId(item.id),
      openThread: (target) => setThreadOn(target),
      compare: (itemId) => setCompareId(itemId),
      selectEdge: (id) => viewport?.select([id]),
      agree: (itemId) => agreeItem(doc, itemId, { by: me }),
      reject: (itemId) => setAsk({ kind: 'reject', item: itemId }),
      switchArea: (itemId, side) => switchArea(doc, itemId, side, { by: me }),
      fitHeight: (layoutId, h) => {
        const layout = layoutMap(doc);
        const l = layout.get(layoutId);
        if (l && l.h !== h) layout.set(layoutId, { ...l, w: l.w ?? BLOCK_W, h });
      },
    }),
    [doc, me, viewport],
  );

  /** A new note in the middle of the view (inside the frame there, clear of its blocks), selected. */
  const addNoteInView = useCallback(() => {
    const id = addSticky(doc, { by: me, ...noteSpot(doc, v.frames, viewport?.center() ?? { x: 0, y: 0 }) });
    viewport?.select([id]);
  }, [doc, me, v.frames, viewport]);

  const clearSelection = useCallback(() => viewport?.select([]), [viewport]);

  const byId = useMemo(() => {
    const m = new Map<string, Parameters<typeof nameOf>[0]>();
    for (const i of [...state.items, ...state.stickies, ...state.decisions]) m.set(i.id, i);
    // A snapshot card stands for its file: its comments and "open" are the file's.
    for (const s of v.snapshots.values()) m.set(s.id, s.item);
    return m;
  }, [state, v.snapshots]);

  const openItem = openId ? state.items.find((i) => i.id === openId) : undefined;
  const compareItem = compareId ? state.items.find((i) => i.id === compareId) : undefined;
  const compareAgreement = compareId ? state.agreements.get(compareId) : undefined;
  const threadTarget = threadOn ? byId.get(threadOn) : undefined;
  const selectedEdge = sel.link && v.edges.some((e) => e.id === sel.link) ? state.humanEdges.find((e) => e.id === sel.link) : undefined;
  const close = useCallback(() => setOpenId(null), []);
  const closeThread = useCallback(() => setThreadOn(null), []);
  const closeCompare = useCallback(() => setCompareId(null), []);

  // What the selection bar offers.
  const pickedItems = sel.items.map((id) => byId.get(id)).filter((i) => !!i);
  const label = (id: string) => (isSnapId(id) ? `snapshot of ${nameOf(byId.get(id)!)}` : nameOf(byId.get(id)!));
  const one = pickedItems.length === 1 ? pickedItems[0] : undefined;
  const canLink = pickedItems.length === 2;
  const oneBlock = one?.kind === 'file' ? v.blocks.get(one.id) : undefined;
  const onePin = one ? (v.blocks.get(one.id) ?? v.decisions.get(one.id) ?? v.stickies.get(one.id))?.pin : undefined;

  // The selection bar: at the top on a wide screen, at the bottom on a narrow one (see bars.ts).
  const narrow = useNarrow();
  const selectionBar = (pickedItems.length > 0 || selectedEdge) && (
    <div className="selection-bar" data-testid="selection-bar">
      {selectedEdge ? (
        <>
          <span className="selection-count">Link by {selectedEdge.author}</span>
          <button type="button" className="btn" onClick={() => setAsk({ kind: 'label', edge: selectedEdge.id, initial: selectedEdge.label })}>
            Edit label
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              deleteHumanEdge(doc, selectedEdge.id);
              clearSelection();
            }}
          >
            Delete link
          </button>
        </>
      ) : (
        <>
          <span className="selection-count">{one ? label(sel.items[0]!) : `${pickedItems.length} selected`}</span>
          {one?.kind === 'file' && (
            <button type="button" className="btn" onClick={() => setOpenId(one.id)}>
              Open
            </button>
          )}
          {one && (
            <button type="button" className="btn" onClick={() => setThreadOn(one.id)}>
              Comments{onePin?.count ? ` (${onePin.count})` : ''}
            </button>
          )}
          {oneBlock?.agreement && (
            <button type="button" className="btn" onClick={() => setCompareId(oneBlock.item.id)}>
              Compare
            </button>
          )}
          {canLink && (
            <button type="button" className="btn" onClick={() => setAsk({ kind: 'link', from: pickedItems[0]!.id, to: pickedItems[1]!.id })}>
              Link
            </button>
          )}
        </>
      )}
      <button type="button" className="btn" onClick={clearSelection}>
        Clear
      </button>
    </div>
  );

  return (
    <BoardActionsContext.Provider value={actions}>
      <ViewsContext.Provider value={v}>
        <div className="board-root">
          <BoardCanvas doc={doc} onSelection={setSel} onViewport={setViewport} />
          <div className="board-overlay board-overlay-top">
            <div className="board-header">
              <strong>{state.name || 'agent-board'}</strong>
              <span className={`status status-${status}`} data-testid="status" data-status={status}>
                {STATUS_TEXT[status]}
              </span>
              <button type="button" className="btn" onClick={addNoteInView} title="Add a note in the middle of the view">
                + note
              </button>
              <button type="button" className="btn" onClick={() => viewport?.fitAll()} title="Show the whole board">
                Fit all
              </button>
            </div>
            {!narrow && selectionBar}
          </div>
          <div className="board-overlay board-overlay-bottom">
            <HiddenList items={v.hidden} onOpen={actions.open} />
            {status === 'online' && state.items.length === 0 && state.stickies.length === 0 && (
              <div className="empty">No files yet. Add .md or .html files to the watched folder, or add a note.</div>
            )}
            {narrow && selectionBar}
          </div>
        </div>
        {openItem && <FullView item={openItem} onClose={close} />}
        {threadOn && (
          <ThreadPanel
            target={threadOn}
            name={threadTarget ? nameOf(threadTarget) : threadOn}
            comments={state.comments.filter((c) => c.target === threadOn).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))}
            thread={state.threads.get(threadOn)}
            onClose={closeThread}
          />
        )}
        {compareItem && compareAgreement && <CompareView item={compareItem} agreement={compareAgreement} onClose={closeCompare} />}
        {ask?.kind === 'link' && (
          <TextDialog
            title="Link"
            label={`From ${nameOf(byId.get(ask.from)!)} to ${nameOf(byId.get(ask.to)!)}. Label (optional)`}
            submit="Link"
            onCancel={() => setAsk(null)}
            onSubmit={(label) => {
              addHumanEdge(doc, { from: ask.from, to: ask.to, label, by: me });
              setAsk(null);
              clearSelection();
            }}
          />
        )}
        {ask?.kind === 'reject' && (
          <TextDialog
            title={`Reject ${byId.get(ask.item) ? nameOf(byId.get(ask.item)!) : 'block'}`}
            label="What needs to change (required)"
            submit="Reject"
            multiline
            required
            onCancel={() => setAsk(null)}
            onSubmit={(reason) => {
              if (rejectItem(doc, ask.item, { by: me, reason })) setAsk(null);
            }}
          />
        )}
        {ask?.kind === 'label' && (
          <TextDialog
            title="Link label"
            label="Label"
            initial={ask.initial}
            submit="Save"
            onCancel={() => setAsk(null)}
            onSubmit={(label) => {
              setEdgeLabel(doc, ask.edge, label);
              setAsk(null);
            }}
          />
        )}
      </ViewsContext.Provider>
    </BoardActionsContext.Provider>
  );
}
