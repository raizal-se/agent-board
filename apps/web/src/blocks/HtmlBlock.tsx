import { memo, useEffect, useRef, useState } from 'react';
import type { BlockData } from '../board/derive';
import { BlockChrome } from './BlockChrome';
import { FIT_SCRIPT, fitToContent, PAGE_W, thumbSize, WHOLE_PAGE, type ThumbFit } from './thumbFit';

/**
 * The sandbox for agent HTML: scripts run, but the page gets an opaque origin, so it cannot reach
 * the board, its socket, cookies or other blocks. Never add allow-same-origin.
 */
export const HTML_SANDBOX = 'allow-scripts';

/**
 * An HTML page as a thumbnail: a sandboxed srcdoc iframe, scaled down (never below 0.6), that takes
 * no clicks (a drag over it moves the card). It loads the first time it comes on screen and stays
 * loaded after that. The page reports the box of its content; the thumbnail zooms to its width and
 * shows its full height (see thumbFit.ts).
 */
export function HtmlThumb({ text, title }: { text: string; title: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(false);
  const [fit, setFit] = useState<ThumbFit>(WHOLE_PAGE);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only this thumbnail's own frame; its data is checked by fitToContent.
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
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const size = thumbSize(fit);
  return (
    <div
      ref={boxRef}
      className="html-thumb"
      style={{ width: size.w, height: size.h }}
      data-testid="html-thumb"
      data-loaded={visible ? 'yes' : 'no'}
      data-scale={fit.scale.toFixed(3)}
    >
      {visible ? (
        <iframe
          ref={frameRef}
          title={title}
          sandbox={HTML_SANDBOX}
          srcDoc={text + FIT_SCRIPT}
          tabIndex={-1}
          style={{ width: PAGE_W, height: fit.y + fit.h, transform: `scale(${fit.scale}) translate(${-fit.x}px, ${-fit.y}px)` }}
        />
      ) : (
        <div className="html-placeholder">loads when on screen</div>
      )}
    </div>
  );
}

export const HtmlBlock = memo(function HtmlBlock({ data }: { data: BlockData }) {
  return (
    <BlockChrome data={data}>
      <HtmlThumb text={data.item.text} title={data.item.path} />
    </BlockChrome>
  );
});
