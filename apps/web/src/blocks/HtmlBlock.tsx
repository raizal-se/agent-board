import { BLOCK_W } from '@agent-board/model';
import type { NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import type { BlockNode } from '../board/derive';
import { BlockChrome } from './BlockChrome';

/** The page renders at this size, then scales down into the thumbnail. */
const PAGE_W = 1280;
const PAGE_H = 800;
const THUMB_W = BLOCK_W - 2;
const SCALE = THUMB_W / PAGE_W;
const THUMB_H = Math.round(PAGE_H * SCALE);

/**
 * The sandbox for agent HTML: scripts run, but the page gets an opaque origin, so it cannot reach
 * the board, its socket, cookies or other blocks. Never add allow-same-origin.
 */
export const HTML_SANDBOX = 'allow-scripts';

/**
 * HTML thumbnail: a sandboxed srcdoc iframe, scaled down, that takes no clicks (a drag over it
 * moves the block). It loads the first time it comes on screen, and stays loaded after that.
 */
export const HtmlBlock = memo(function HtmlBlock({ data }: NodeProps<BlockNode>) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <BlockChrome item={data.item} missing={data.missing}>
      <div ref={boxRef} className="html-thumb" style={{ width: THUMB_W, height: THUMB_H }} data-loaded={visible ? 'yes' : 'no'}>
        {visible ? (
          <iframe
            title={data.item.path}
            sandbox={HTML_SANDBOX}
            srcDoc={data.item.text}
            tabIndex={-1}
            style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${SCALE})` }}
          />
        ) : (
          <div className="html-placeholder">loads when on screen</div>
        )}
      </div>
      <div className="html-path">{data.item.path}</div>
    </BlockChrome>
  );
});
