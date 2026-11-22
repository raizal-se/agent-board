import type { NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import type { BlockNode } from '../board/derive';
import { BlockChrome } from './BlockChrome';
import { FIT_SCRIPT, fitToContent, PAGE_H, PAGE_W, THUMB_H, THUMB_W, WHOLE_PAGE, type ThumbFit } from './thumbFit';


/**
 * The sandbox for agent HTML: scripts run, but the page gets an opaque origin, so it cannot reach
 * the board, its socket, cookies or other blocks. Never add allow-same-origin.
 */
export const HTML_SANDBOX = 'allow-scripts';

/**
 * HTML thumbnail: a sandboxed srcdoc iframe, scaled down, that takes no clicks (a drag over it
 * moves the block). It loads the first time it comes on screen, and stays loaded after that.
 * The page reports the box of its content and the thumbnail zooms to it (see thumbFit.ts).
 */
export const HtmlBlock = memo(function HtmlBlock({ data }: NodeProps<BlockNode>) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(false);
  const [fit, setFit] = useState<ThumbFit>(WHOLE_PAGE);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only this block's own frame; its data is checked by fitToContent.
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const box = (e.data as { agentBoardFit?: unknown } | null)?.agentBoardFit;
      if (box !== undefined) setFit(fitToContent(box));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

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
    <BlockChrome data={data}>
      <div ref={boxRef} className="html-thumb" style={{ width: THUMB_W, height: THUMB_H }} data-loaded={visible ? 'yes' : 'no'} data-scale={fit.scale.toFixed(3)}>
        {visible ? (
          <iframe
            ref={frameRef}
            title={data.item.path}
            sandbox={HTML_SANDBOX}
            srcDoc={data.item.text + FIT_SCRIPT}
            tabIndex={-1}
            style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${fit.scale}) translate(${-fit.x}px, ${-fit.y}px)` }}
          />
        ) : (
          <div className="html-placeholder">loads when on screen</div>
        )}
      </div>
      <div className="html-path">{data.item.path}</div>
    </BlockChrome>
  );
});
