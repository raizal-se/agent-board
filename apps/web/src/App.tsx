import {
  addHumanEdge,
  addSticky,
  agree,
  deleteHumanEdge,
  FRAME_HEADER,
  layoutMap,
  moveSticky,
  setEdgeLabel,
  STICKY_H,
  STICKY_W,
  type FileItem,
  type Person,
} from '@agent-board/model';
import type { ConnectionStatus } from '@agent-board/sync';
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useReactFlowStoreApi,
  type EdgeTypes,
  type NodeChangeset,
  type NodeTypes,
  type OnNodeDrag,
  type OnSelectionChangeFunc,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { CompareView } from './blocks/CompareView';
import { DecisionNode } from './blocks/DecisionNode';
import { FrameNode } from './blocks/FrameNode';
import { FullView } from './blocks/FullView';
import { HiddenList } from './blocks/HiddenList';
import { HtmlBlock } from './blocks/HtmlBlock';
import { MarkdownBlock } from './blocks/MarkdownBlock';
import { StickyNode } from './blocks/StickyNode';
import { TextDialog } from './blocks/TextDialog';
import { ThreadPanel } from './blocks/ThreadPanel';
import { BoardActionsContext, type BoardActions } from './board/actions';
import type { BoardConnection } from './board/connection';
import { derive, nameOf, type BoardNode, type FrameNode as FrameNodeType } from './board/derive';
import { FloatingEdge } from './board/FloatingEdge';
import { useBoardState } from './board/useBoard';

const nodeTypes: NodeTypes = { frame: FrameNode, markdown: MarkdownBlock, html: HtmlBlock, sticky: StickyNode, decision: DecisionNode };
const edgeTypes: EdgeTypes = { floating: FloatingEdge };

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
  | { kind: 'agree'; covers: string[] }
  | { kind: 'label'; edge: string; initial: string };

interface Point {
  x: number;
  y: number;
}

/** The frame under a board point, if any. Frames are top-level nodes, so their position is absolute. */
function frameAt(frames: FrameNodeType[], p: Point): FrameNodeType | undefined {
  return frames.find((f) => {
    const w = Number(f.style?.width ?? 0);
    const h = Number(f.style?.height ?? 0);
    return p.x >= f.position.x && p.x <= f.position.x + w && p.y >= f.position.y && p.y <= f.position.y + h;
  });
}

function Board({ conn }: { conn: BoardConnection }) {
  const { doc } = conn;
  const state = useBoardState(doc);
  const derived = useMemo(() => derive(state), [state]);
  const status = useStatus(conn);
  const [nodes, setNodes] = useState<BoardNode[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [threadOn, setThreadOn] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [several, setSeveral] = useState(false);
  /** Selected items in the order they were picked: a link goes from the first to the second. */
  const [picked, setPicked] = useState<string[]>([]);
  const rf = useReactFlow();
  const storeApi = useReactFlowStoreApi();
  const fitted = useRef(false);

  const me: Person = useMemo(() => {
    const owner = state.owner || 'me';
    return { name: owner, side: state.devices.get(owner)?.side ?? 'product' };
  }, [state.owner, state.devices]);

  // Doc → nodes. Keep what React Flow owns locally (measured size, selection, a drag in progress).
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return derived.nodes.map((n) => {
        const p = byId.get(n.id);
        if (!p) return n;
        // A note that moved into or out of a frame keeps the position the doc gives it.
        const sameParent = p.parentId === n.parentId;
        return {
          ...n,
          measured: p.measured,
          selected: p.selected,
          dragging: p.dragging,
          position: p.dragging && sameParent ? p.position : n.position,
        } as BoardNode;
      });
    });
  }, [derived.nodes]);

  // Fit once, after React Flow has measured the nodes, so the fit uses their real size.
  const measured = useNodesInitialized();
  useEffect(() => {
    if (fitted.current || !measured || nodes.length === 0) return;
    fitted.current = true;
    void rf.fitView({ padding: 0.03, maxZoom: 1 });
  }, [measured, nodes.length, rf]);

  // "Select several" (for touch screens): each tap adds to the selection, as Ctrl/Cmd+click does.
  useEffect(() => {
    storeApi.optionsStore.setState({ multiSelectionActive: several });
  }, [several, storeApi]);

  const onNodesChange = useCallback((changes: NodeChangeset<BoardNode>) => setNodes((ns) => changes.applyTo(ns)), []);

  const onSelectionChange: OnSelectionChangeFunc<BoardNode> = useCallback(({ nodes: sel }) => {
    const ids = sel.filter((n) => n.type !== 'frame').map((n) => n.id);
    setPicked((prev) => [...prev.filter((id) => ids.includes(id)), ...ids.filter((id) => !prev.includes(id))]);
  }, []);

  const frames = useMemo(() => derived.nodes.filter((n): n is FrameNodeType => n.type === 'frame'), [derived.nodes]);

  // Drag end → layout in the doc, which the CLI saves to disk. A note can move into or out of a frame.
  const onNodeDragStop: OnNodeDrag<BoardNode> = useCallback(
    (_e, _node, dragged) => {
      const layout = layoutMap(doc);
      doc.transact(() => {
        for (const n of dragged) {
          if (n.type === 'sticky') {
            const parent = n.parentId ? frames.find((f) => f.id === n.parentId) : undefined;
            const abs = { x: n.position.x + (parent?.position.x ?? 0), y: n.position.y + (parent?.position.y ?? 0) };
            const into = frameAt(frames, { x: abs.x + STICKY_W / 2, y: abs.y + 12 });
            if (into) moveSticky(doc, n.id, into.id, abs.x - into.position.x, Math.max(FRAME_HEADER, abs.y - into.position.y));
            else moveSticky(doc, n.id, null, abs.x, abs.y);
            continue;
          }
          const inFrame = n.type !== 'frame';
          const x = Math.round(inFrame ? Math.max(0, n.position.x) : n.position.x);
          const y = Math.round(inFrame ? Math.max(FRAME_HEADER, n.position.y) : n.position.y);
          layout.set(n.id, { ...layout.get(n.id), x, y });
        }
      });
    },
    [doc, frames],
  );

  /** A new note at a board point: inside the frame under it, or on its own. */
  const noteAt = useCallback(
    (p: Point) => {
      const at = { x: p.x - STICKY_W / 2, y: p.y - 16 };
      const frame = frameAt(frames, p);
      const id = frame
        ? addSticky(doc, { by: me, frame: frame.id, x: at.x - frame.position.x, y: Math.max(FRAME_HEADER, at.y - frame.position.y) })
        : addSticky(doc, { by: me, frame: null, x: at.x, y: at.y });
      // Focus the new note's text, so you can type at once.
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-testid="sticky"][data-id="${id}"] textarea`)?.focus());
    },
    [doc, frames, me],
  );

  // Double-click on the empty canvas or on a frame's background adds a note there.
  const onDoubleClick = useCallback(
    (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const onPane = el.classList.contains('react-flow__pane');
      const onFrame = !!el.closest('.react-flow__node-frame');
      if (!onPane && !onFrame) return;
      noteAt(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [noteAt, rf],
  );

  const addNoteInView = useCallback(() => {
    const box = document.querySelector('.react-flow')!.getBoundingClientRect();
    const center = rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    noteAt({ x: center.x, y: center.y - STICKY_H / 2 + 16 });
  }, [noteAt, rf]);

  const clearSelection = useCallback(() => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setEdgeId(null);
  }, []);

  const actions = useMemo<BoardActions>(
    () => ({
      doc,
      me,
      open: (item: FileItem) => setOpenId(item.id),
      openThread: (target) => setThreadOn(target),
      compare: (itemId) => setCompareId(itemId),
      selectEdge: (id) => setEdgeId(id),
    }),
    [doc, me],
  );

  const byId = useMemo(() => {
    const m = new Map<string, Parameters<typeof nameOf>[0]>();
    for (const i of [...state.items, ...state.stickies, ...state.decisions]) m.set(i.id, i);
    return m;
  }, [state]);

  const openItem = openId ? state.items.find((i) => i.id === openId) : undefined;
  const compareItem = compareId ? state.items.find((i) => i.id === compareId) : undefined;
  const compareAgreement = compareId ? state.agreements.get(compareId) : undefined;
  const threadTarget = threadOn ? byId.get(threadOn) : undefined;
  const selectedEdge = edgeId ? state.humanEdges.find((e) => e.id === edgeId) : undefined;
  const close = useCallback(() => setOpenId(null), []);
  const closeThread = useCallback(() => setThreadOn(null), []);
  const closeCompare = useCallback(() => setCompareId(null), []);

  // What the selection bar offers.
  const pickedItems = picked.map((id) => byId.get(id)).filter((i) => !!i);
  const canLink = pickedItems.length === 2;
  const files = pickedItems.filter((i) => i.kind === 'file');
  const canAgree = files.length > 0 && files.length === pickedItems.length && files.every((f) => f.frame === files[0]!.frame);

  const edges = useMemo(() => derived.edges.map((e) => (e.id === edgeId ? { ...e, selected: true } : e)), [derived.edges, edgeId]);

  return (
    <BoardActionsContext.Provider value={actions}>
      <ReactFlow<BoardNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Layers as derive() sets them: frames 0, edges 1, blocks 1 (later in the page, so on top), notes 2.
        zIndexMode="manual"
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onEdgeClick={(_e, edge) => setEdgeId(edge.data?.kind === 'human' ? edge.id : null)}
        onPaneClick={() => setEdgeId(null)}
        onDoubleClick={onDoubleClick}
        zoomOnDoubleClick={false}
        multiSelectionKeyCode={['Meta', 'Control']}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <Panel position="top-left" className="board-header">
          <strong>{state.name || 'agent-board'}</strong>
          <span className={`status status-${status}`} data-testid="status" data-status={status}>
            {STATUS_TEXT[status]}
          </span>
          <button type="button" className="btn" onClick={addNoteInView} title="Add a note (or double-click the board)">
            + note
          </button>
          <button type="button" className={`btn${several ? ' btn-on' : ''}`} aria-pressed={several} onClick={() => setSeveral(!several)} title="Each tap adds to the selection (Ctrl/Cmd+click does the same)">
            Select several
          </button>
        </Panel>
        {(pickedItems.length > 0 || selectedEdge) && (
          <Panel position="top-center" className="selection-bar" data-testid="selection-bar">
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
                    setEdgeId(null);
                  }}
                >
                  Delete link
                </button>
              </>
            ) : (
              <>
                <span className="selection-count">{pickedItems.length} selected</span>
                {canLink && (
                  <button type="button" className="btn" onClick={() => setAsk({ kind: 'link', from: pickedItems[0]!.id, to: pickedItems[1]!.id })}>
                    Link
                  </button>
                )}
                {canAgree && (
                  <button type="button" className="btn btn-agree" onClick={() => setAsk({ kind: 'agree', covers: files.map((f) => f.id) })}>
                    Agree
                  </button>
                )}
              </>
            )}
            <button type="button" className="btn" onClick={clearSelection}>
              Clear
            </button>
          </Panel>
        )}
        <Panel position="bottom-left" className="board-footer">
          <HiddenList items={derived.hidden} onOpen={actions.open} />
          {status === 'online' && state.items.length === 0 && state.stickies.length === 0 && (
            <div className="empty">No files yet. Add .md or .html files to the watched folder, or double-click to add a note.</div>
          )}
        </Panel>
      </ReactFlow>
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
      {ask?.kind === 'agree' && (
        <TextDialog
          title={`Agree on ${ask.covers.length} block${ask.covers.length === 1 ? '' : 's'}`}
          label="What is agreed"
          submit="Agree"
          multiline
          required
          onCancel={() => setAsk(null)}
          onSubmit={(text) => {
            agree(doc, { text, covers: ask.covers, by: me });
            setAsk(null);
            clearSelection();
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
    </BoardActionsContext.Provider>
  );
}

export function App({ conn }: { conn: BoardConnection }) {
  return (
    <div className="board-root">
      <ReactFlowProvider>
        <Board conn={conn} />
      </ReactFlowProvider>
    </div>
  );
}
