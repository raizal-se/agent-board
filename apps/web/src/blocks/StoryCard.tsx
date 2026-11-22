import { fileName, snapId } from '@agent-board/model';
import { memo } from 'react';
import { useBoardActions } from '../board/actions';
import { storyName, type CoverView, type StoryData } from '../board/derive';
import { CardBody } from './BlockChrome';
import { useCardFit } from './cardFit';
import { CommentPin } from './CommentPin';
import { HtmlThumb } from './HtmlBlock';
import { MarkdownBody } from './MarkdownBlock';

/** A button on a card does not select the card. */
const stop = (fn: () => void) => (e: { stopPropagation(): void }) => {
  e.stopPropagation();
  fn();
};

const TAG: Record<CoverView['state'], string | null> = {
  agreed: null,
  'not agreed': 'not agreed yet',
  'changed after agreement': 'changed after agreement',
  gone: 'file deleted',
};

/**
 * One half of a story: the first covered card on that side, previewed from its agreed snapshot,
 * plus "+N" for the others. Empty: a quiet line that says so.
 */
function Half({ side, covers, story }: { side: 'product' | 'engineering'; covers: CoverView[]; story: string }) {
  const { show } = useBoardActions();
  const label = side === 'product' ? 'Product' : 'Engineering';
  const first = covers[0];
  if (!first) {
    return (
      <div className={`story-half half-${side} is-empty`} data-testid={`story-half-${side}`} data-count={0}>
        <div className="story-half-head">
          <span className="story-half-label">{label}</span>
        </div>
        <div className="story-half-empty">{side === 'product' ? 'No UI for this story' : 'No engineering part'}</div>
      </div>
    );
  }
  const tag = TAG[first.state];
  const target = first.snapshot ? snapId(first.id) : first.id;
  const name = first.path ? fileName(first.path) : first.id;
  return (
    <div className={`story-half half-${side}`} data-testid={`story-half-${side}`} data-count={covers.length} data-state={first.state}>
      <div className="story-half-head">
        <span className="story-half-label">{label}</span>
        <span className="story-half-name" title={covers.map((c) => c.path ?? c.id).join('\n')}>
          {name}
        </span>
        {covers.length > 1 && (
          <span className="story-more" data-testid="story-more" title={covers.slice(1).map((c) => c.path ?? c.id).join('\n')}>
            +{covers.length - 1}
          </span>
        )}
        {tag && (
          <span className={`story-tag tag-${first.state === 'not agreed' ? 'draft' : 'changed'}`} data-testid="story-tag">
            {tag}
          </span>
        )}
      </div>
      {first.preview && (
        <div className="story-preview" data-testid="story-preview" data-from={first.snapshot ? 'snapshot' : 'file'}>
          {first.preview.type === 'html' ? (
            <div className="story-preview-scale">
              <HtmlThumb text={first.preview.text} title={`${name} in ${story}`} />
            </div>
          ) : (
            <div className="block-text story-preview-md">
              <MarkdownBody text={first.preview.text} />
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className="story-link"
        data-testid="story-source"
        onClick={stop(() => show(target))}
        aria-label={`${first.snapshot ? 'go to the snapshot of' : 'go to'} ${name}`}
      >
        {first.snapshot ? 'from snapshot' : 'go to card'} ↗
      </button>
    </div>
  );
}

/**
 * A story in the Milestone area (design 5.3): a big number and the short title, the story
 * sentence, the product half and the engineering half (previews of the agreed snapshots of the
 * cards it covers), and a quiet footer: check, size, owner, "can start" or "blocked by", accepts.
 * ✓ Agree and ✗ Reject go to its thread. All fields are edited on the board.
 */
export const StoryCard = memo(function StoryCard({ data }: { data: StoryData }) {
  const { agreeStory, rejectStory, editStory, pickCovers } = useBoardActions();
  const { story: s, facts, product, engineering, gone, blockerNames, pin } = data;
  const { card, body, content, overflow } = useCardFit(s.id);
  const name = storyName(s);
  const block = facts.acceptBlock;
  return (
    <div
      ref={card}
      className={`story${facts.approved ? ' is-approved' : ''}`}
      data-testid="story"
      data-id={s.id}
      data-number={s.number}
      data-approved={facts.approved ? 'yes' : 'no'}
      data-can-start={facts.canStart ? 'yes' : 'no'}
    >
      <div className="story-head">
        <span className="story-number" data-testid="story-number" aria-label={`Story ${s.number}`}>
          {s.number}
        </span>
        <span className="story-title" data-testid="story-title">
          {s.title || <em className="story-untitled">No title yet</em>}
        </span>
        <button type="button" className="card-btn" data-testid="story-edit" onClick={stop(() => editStory(s.id))} aria-label={`edit ${name}`}>
          Edit
        </button>
        <CommentPin target={s.id} name={name} pin={pin} />
      </div>
      <div className="block-actions story-actions">
        <button
          type="button"
          className="card-btn card-agree"
          data-testid="story-agree"
          disabled={!!block || facts.approved}
          aria-pressed={facts.approved}
          onClick={stop(() => agreeStory(s.id))}
          aria-label={block ? `${name} cannot be agreed: ${block}` : `agree on ${name}`}
        >
          {facts.approved ? '✓ Agreed' : '✓ Agree'}
        </button>
        <button type="button" className="card-btn card-reject" data-testid="story-reject" onClick={stop(() => rejectStory(s.id))} aria-label={`reject ${name}`}>
          ✗ Reject
        </button>
        <button type="button" className="card-btn" data-testid="story-covers" onClick={stop(() => pickCovers(s.id))} aria-label={`cards that ${name} covers`}>
          + card
        </button>
        {block && (
          <span className="story-block" data-testid="story-block">
            {block}
          </span>
        )}
      </div>
      {s.rejected && (
        <div className="review-mark review-requested story-rejected" data-testid="story-rejected">
          rejected by {s.rejected.by}: {s.rejected.reason}
        </div>
      )}
      {facts.coverChanged && (
        <div className="changed-mark story-warning" data-testid="story-cover-changed">
          <span>a covered card changed; keep the snapshot or agree again before it goes to Linear</span>
        </div>
      )}
      <CardBody body={body} content={content} overflow={overflow} name={name} onOpen={() => editStory(s.id)}>
        <div className="story-sentence" data-testid="story-sentence">
          {s.story || <em className="story-untitled">No story sentence yet</em>}
        </div>
        <div className="story-halves">
          <Half side="product" covers={product} story={name} />
          <Half side="engineering" covers={engineering} story={name} />
        </div>
        {(gone.length > 0 || (s.missing?.length ?? 0) > 0) && (
          <div className="block-missing" data-testid="story-missing">
            {gone.map((c) => (
              <div key={c.id}>covered card is gone: {c.path ?? c.id}</div>
            ))}
            {s.missing?.map((m) => (
              <div key={m}>no card found for: {m}</div>
            ))}
          </div>
        )}
        <div className="story-foot" data-testid="story-foot">
          <div className="story-check" data-testid="story-check">
            <span className="story-key">check</span> {s.check || <em>none yet</em>}
          </div>
          <div className="story-facts">
            <span data-testid="story-size">size {s.size ?? '?'}</span>
            <span data-testid="story-owner">{s.owner ? `owner ${s.owner}` : 'no owner'}</span>
            <span data-testid="story-start" className={facts.canStart ? 'can-start' : 'is-blocked'}>
              {facts.canStart ? 'can start' : `blocked by ${blockerNames.join(', ')}`}
            </span>
            <span data-testid="story-accepts">
              {s.accepts.length ? `accepted by ${s.accepts.map((a) => a.name).join(', ')}` : 'no accepts yet'}
            </span>
          </div>
        </div>
      </CardBody>
    </div>
  );
});
