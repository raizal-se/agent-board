import { BLOCK_H, BLOCK_W } from '@agent-board/model';
import { BaseEdge, EdgeLabelRenderer, getStraightPath, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
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
 * A link between two blocks, drawn from border to border on the sides that face each other. Its
 * label sits at its own midpoint, as HTML above the canvas so it stays readable.
 */
export function FloatingEdge({ id, source, target, label, style, markerEnd }: EdgeProps) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const ends = floatingEnds(boxOf(s), boxOf(t));
  const [path, labelX, labelY] = getStraightPath({
    sourceX: ends.source.x,
    sourceY: ends.source.y,
    targetX: ends.target.x,
    targetY: ends.target.y,
  });
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            data-testid="edge-label"
            data-edge={id}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
