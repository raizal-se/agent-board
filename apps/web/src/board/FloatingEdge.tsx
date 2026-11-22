import { BLOCK_H, BLOCK_W } from '@agent-board/model';
import { BaseEdge, EdgeLabelRenderer, getStraightPath, useInternalNode, type Edge, type EdgeProps, type InternalNode } from '@xyflow/react';
import { useBoardActions } from './actions';
import type { EdgeData } from './derive';
import { floatingEnds, type Box } from './geometry';

function boxOf(n: InternalNode): Box {
  return {
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    w: n.measured.width ?? BLOCK_W,
    h: n.measured.height ?? BLOCK_H,
  };
}

/**
 * A link between two items, drawn from border to border on the sides that face each other. Its
 * label sits at its own midpoint, as HTML above the canvas so it stays readable.
 *
 * A link from a file is dotted and names the file it comes from. A link a person drew is solid;
 * its label is a button that selects it, to edit the label or delete the link.
 */
export function FloatingEdge({ id, source, target, label, style, markerEnd, data, selected, interactionWidth }: EdgeProps<Edge<EdgeData>>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  const { selectEdge } = useBoardActions();
  if (!s || !t) return null;
  const ends = floatingEnds(boxOf(s), boxOf(t));
  const [path, labelX, labelY] = getStraightPath({
    sourceX: ends.source.x,
    sourceY: ends.source.y,
    targetX: ends.target.x,
    targetY: ends.target.y,
  });
  const at = { transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` };
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} />
      {data?.kind === 'file' ? (
        <EdgeLabelRenderer>
          <div className="edge-label" data-testid="edge-label" data-kind="file" data-edge={id} style={at}>
            {label ? <span className="edge-label-text">{label}</span> : null}
            <span className="edge-label-file">from {data.file}</span>
          </div>
        </EdgeLabelRenderer>
      ) : data?.kind === 'human' && label ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`edge-label edge-label-human nodrag nopan${selected ? ' selected' : ''}`}
            data-testid="edge-label"
            data-kind="human"
            data-edge={id}
            style={at}
            onClick={() => selectEdge(id)}
          >
            <span className="edge-label-text">{label}</span>
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
