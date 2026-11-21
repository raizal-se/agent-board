import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import type { FrameNode as FrameNodeType } from '../board/derive';

export const FrameNode = memo(function FrameNode({ data }: NodeProps<FrameNodeType>) {
  return (
    <div className="frame" data-testid="frame" data-frame={data.frame.name}>
      <div className="frame-title">
        {data.frame.name}
        <span className="frame-count">{data.count}</span>
      </div>
    </div>
  );
});
