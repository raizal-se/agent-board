import { memo } from 'react';
import { useBoardActions } from '../board/actions';
import { milestoneName, type MilestoneData } from '../board/derive';
import { CardBody } from './BlockChrome';
import { useCardFit } from './cardFit';
import { CommentPin } from './CommentPin';

const stop = (fn: () => void) => (e: { stopPropagation(): void }) => {
  e.stopPropagation();
  fn();
};

/** The milestone card at the top of the Milestone area: number, name, goal and a count of its stories. */
export const MilestoneCard = memo(function MilestoneCard({ data }: { data: MilestoneData }) {
  const { editMilestone, addStory } = useBoardActions();
  const { milestone: m, count, pin } = data;
  const { card, body, content, overflow } = useCardFit(m.id);
  const name = milestoneName(m);
  return (
    <div ref={card} className="milestone" data-testid="milestone" data-id={m.id} data-number={m.number}>
      <div className="milestone-head">
        <span className="milestone-label">Milestone {m.number}</span>
        <span className="milestone-name" data-testid="milestone-name">
          {m.name || <em className="story-untitled">No name yet</em>}
        </span>
        <button type="button" className="card-btn" data-testid="milestone-edit" onClick={stop(() => editMilestone(m.id))} aria-label={`edit ${name}`}>
          Edit
        </button>
        <button type="button" className="card-btn card-agree" data-testid="add-story" onClick={stop(() => addStory(m.id))} aria-label={`add a story to ${name}`}>
          + story
        </button>
        <CommentPin target={m.id} name={name} pin={pin} />
      </div>
      <CardBody body={body} content={content} overflow={overflow} name={name} onOpen={() => editMilestone(m.id)}>
        <div className="milestone-goal" data-testid="milestone-goal">
          {m.goal ? `Goal: ${m.goal}` : <em className="story-untitled">No goal yet</em>}
        </div>
        <div className="milestone-count" data-testid="milestone-count">
          {count}
        </div>
        {m.source && <div className="milestone-source">from {m.source.path}</div>}
      </CardBody>
    </div>
  );
});

/** In an empty Milestone area: start Milestone 1 with a first story. */
export const MilestoneStart = memo(function MilestoneStart({ frame }: { frame: string }) {
  const { startMilestone } = useBoardActions();
  return (
    <div className="milestone-start" data-testid="milestone-start" data-frame={frame}>
      <div className="milestone-start-text">No milestone yet. Save a milestone-1.md file in this feature folder, or start one here.</div>
      <button type="button" className="card-btn card-agree" data-testid="start-story" onClick={stop(() => startMilestone(frame))}>
        + story
      </button>
    </div>
  );
});
