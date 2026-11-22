import { ZONES } from '@agent-board/model';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import type { FrameNode as FrameNodeType } from '../board/derive';

const ZONE_NAMES = { product: 'Product', engineering: 'Engineering', agreed: 'Agreed', milestone: 'Milestone' } as const;

/**
 * A feature frame with its four soft zones. A zone is a colour area: a block's zone comes from its
 * state, and its column is only where a new block starts.
 */
export const FrameNode = memo(function FrameNode({ data }: NodeProps<FrameNodeType>) {
  return (
    <div className="frame" data-testid="frame" data-frame={data.frame.name}>
      <div className="frame-title">
        {data.frame.name}
        <span className="frame-count">{data.count}</span>
      </div>
      {ZONES.map((z) => {
        const r = data.zones[z];
        return (
          <div key={z} className={`zone-area zone-area-${z}`} data-testid="zone" data-zone={z} style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
            <span className="zone-label">{ZONE_NAMES[z]}</span>
          </div>
        );
      })}
    </div>
  );
});
