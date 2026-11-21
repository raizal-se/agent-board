import { FRAME_HEADER, layoutMap, type FileItem } from '@agent-board/model';
import type { ConnectionStatus } from '@agent-board/sync';
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type NodeChangeset,
  type EdgeTypes,
  type NodeTypes,
  type OnNodeDrag,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FrameNode } from './blocks/FrameNode';
import { FullView } from './blocks/FullView';
import { HiddenList } from './blocks/HiddenList';
import { HtmlBlock } from './blocks/HtmlBlock';
import { MarkdownBlock } from './blocks/MarkdownBlock';
import { BoardActionsContext, type BoardActions } from './board/actions';
import type { BoardConnection } from './board/connection';
import { derive, type BoardNode } from './board/derive';
import { FloatingEdge } from './board/FloatingEdge';
import { useBoardState } from './board/useBoard';

const nodeTypes: NodeTypes = { frame: FrameNode, markdown: MarkdownBlock, html: HtmlBlock };
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

function Board({ conn }: { conn: BoardConnection }) {
  const { doc } = conn;
  const state = useBoardState(doc);
  const derived = useMemo(() => derive(state), [state]);
  const status = useStatus(conn);
  const [nodes, setNodes] = useState<BoardNode[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const rf = useReactFlow();
  const fitted = useRef(false);

  // Doc → nodes. Keep what React Flow owns locally (measured size, selection, a drag in progress).
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return derived.nodes.map((n) => {
        const p = byId.get(n.id);
        if (!p) return n;
        return { ...n, measured: p.measured, selected: p.selected, dragging: p.dragging, position: p.dragging ? p.position : n.position } as BoardNode;
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

  const onNodesChange = useCallback((changes: NodeChangeset<BoardNode>) => setNodes((ns) => changes.applyTo(ns)), []);

  // Drag end → layout in the doc, which the CLI saves to disk.
  const onNodeDragStop: OnNodeDrag<BoardNode> = useCallback(
    (_e, _node, dragged) => {
      const layout = layoutMap(doc);
      doc.transact(() => {
        for (const n of dragged) {
          const isBlock = n.type !== 'frame';
          const x = Math.round(isBlock ? Math.max(0, n.position.x) : n.position.x);
          const y = Math.round(isBlock ? Math.max(FRAME_HEADER, n.position.y) : n.position.y);
          layout.set(n.id, { ...layout.get(n.id), x, y });
        }
      });
    },
    [doc],
  );

  const actions = useMemo<BoardActions>(() => ({ open: (item: FileItem) => setOpenId(item.id) }), []);
  const openItem = openId ? state.items.find((i) => i.id === openId) : undefined;
  const close = useCallback(() => setOpenId(null), []);

  return (
    <BoardActionsContext.Provider value={actions}>
      <ReactFlow<BoardNode>
        nodes={nodes}
        edges={derived.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Layers as derive() sets them: frames 0, edges 1, blocks 1 (later in the page, so on top).
        zIndexMode="manual"
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
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
          <strong>{state.name ?? 'agent-board'}</strong>
          <span className={`status status-${status}`} data-testid="status" data-status={status}>
            {STATUS_TEXT[status]}
          </span>
        </Panel>
        <Panel position="bottom-left" className="board-footer">
          <HiddenList items={derived.hidden} onOpen={actions.open} />
          {status === 'online' && state.items.length === 0 && (
            <div className="empty">No files yet. Add .md or .html files to the watched folder.</div>
          )}
        </Panel>
      </ReactFlow>
      {openItem && <FullView item={openItem} onClose={close} />}
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
