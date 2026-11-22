import { isMilestonePath, parseMilestoneFile } from '@agent-board/formats';
import {
  addHumanEdge,
  addMilestone,
  addStory,
  addSticky,
  agreeItem,
  agreeStory,
  addCover,
  blockerChoices,
  editMilestone,
  editStory,
  importMilestone,
  rejectStory,
  setBlockedBy,
  setCovers,
  BLOCK_W,
  deleteHumanEdge,
  isSnapId,
  layoutMap,
  rejectItem,
  setEdgeLabel,
  switchArea,
  type FileItem,
  type Person,
} from '@agent-board/model';
import type { ConnectionStatus } from '@agent-board/sync';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { CompareView } from './blocks/CompareView';
import { FullView } from './blocks/FullView';
import { HiddenList } from './blocks/HiddenList';
import { TextDialog } from './blocks/TextDialog';
import { ThreadPanel } from './blocks/ThreadPanel';
import { BoardActionsContext, type BoardActions } from './board/actions';
import type { BoardConnection } from './board/connection';
import { AREA_LABEL, nameOf, milestoneName, storyName, views } from './board/derive';
import { ChooseDialog, MilestoneDialog, PickDialog, StoryDialog, type Choice } from './blocks/StoryDialogs';
import { noteSpot } from './board/place';
import { useBoardState } from './board/useBoard';
import { useNarrow } from './canvas/bars';
import { BoardCanvas, type CursorOf, type Selection, type Viewport } from './canvas/BoardCanvas';
import { ViewsContext } from './canvas/embeds';
import { cursorOf } from './peer/session';
import { SharedBar } from './peer/SharedBar';
import { useSession } from './peer/useSession';

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: 'connecting…',
  online: 'live',
  offline: 'CLI not reachable, retrying…',
  'other-board': 'the CLI serves another board now, reloading…',
};

/** A browser peer has no CLI: offline means it works on its own copy. */
const PEER_STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: 'connecting…',
  online: 'live',
  offline: 'on your own copy',
  'other-board': 'another board',
};

const SIDE_COLOR = { product: '#c2410c', engineering: '#1d4ed8' } as const;

function useStatus(conn: BoardConnection): ConnectionStatus {
  return useSyncExternalStore(conn.onStatus, conn.status);
}

type Ask =
  | { kind: 'link'; from: string; to: string }
  | { kind: 'reject'; item: string }
  | { kind: 'label'; edge: string; initial: string }
  | { kind: 'reject-story'; story: string }
  | { kind: 'story'; story: string }
  | { kind: 'covers'; story: string }
  | { kind: 'milestone'; milestone: string }
  | { kind: 'add-to-story'; item: string };

const NONE: Selection = { items: [], link: null };

export function App({ conn }: { conn: BoardConnection }) {
  const { doc } = conn;
  const state = useBoardState(doc);
  const v = useMemo(() => views(state), [state]);
  const status = useStatus(conn);
  const [openId, setOpenId] = useState<string | null>(null);
  const [threadOn, setThreadOn] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [sel, setSel] = useState<Selection>(NONE);
  const [viewport, setViewport] = useState<Viewport | null>(null);

  const session = conn.session;
  const view = useSession(session);
  const shared = !!view.peer;

  const itemsRef = useMemo(() => new Map(state.items.map((i) => [i.id, i])), [state.items]);
  const me: Person = useMemo(() => {
    // On a shared board each page has its own person: the CLI's or the browser's.
    if (view.me) return view.me;
    const owner = state.owner || 'me';
    return { name: owner, side: state.devices.get(owner)?.side ?? 'product' };
  }, [view.me, state.owner, state.devices]);

  const cursors = useMemo<CursorOf[] | undefined>(() => {
    if (!view.peer) return undefined;
    return view.peer.online.flatMap((o) => {
      const c = cursorOf(o.cursor);
      return c ? [{ id: o.id, name: o.name, ...c, color: SIDE_COLOR[o.side] ?? '#555' }] : [];
    });
  }, [view.peer]);
  const onPointer = useMemo(() => (session ? (p: { x: number; y: number }) => session.setCursor(p) : undefined), [session]);

  const actions = useMemo<BoardActions>(
    () => ({
      doc,
      me,
      open: (item: FileItem) => setOpenId(item.id),
      openThread: (target) => setThreadOn(target),
      compare: (itemId) => setCompareId(itemId),
      selectEdge: (id) => viewport?.select([id]),
      agree: (itemId) => agreeItem(doc, itemId, { by: me }),
      reject: (itemId) => setAsk({ kind: 'reject', item: itemId }),
      switchArea: (itemId, side) => switchArea(doc, itemId, side, { by: me }),
      // On a shared board a file card is its owner's: only the owner's devices can change it.
      canChange: shared ? (item) => item.owner === me.name : undefined,
      fitHeight: (layoutId, h) => {
        const layout = layoutMap(doc);
        const l = layout.get(layoutId);
        if (l && l.h !== h) layout.set(layoutId, { ...l, w: l.w ?? BLOCK_W, h });
      },
      show: (id) => viewport?.select([id]),
      agreeStory: (id) => void agreeStory(doc, id, { by: me }),
      rejectStory: (id) => setAsk({ kind: 'reject-story', story: id }),
      editStory: (id) => setAsk({ kind: 'story', story: id }),
      pickCovers: (id) => setAsk({ kind: 'covers', story: id }),
      addStory: (milestone) => {
        const id = addStory(doc, milestone, {}, { author: me.name });
        if (!id) return;
        viewport?.select([id]);
        setAsk({ kind: 'story', story: id });
      },
      startMilestone: (frame) => {
        let id: string | null = null;
        doc.transact(() => {
          const m = addMilestone(doc, { frame, author: me.name });
          id = addStory(doc, m, {}, { author: me.name });
        });
        if (!id) return;
        viewport?.select([id]);
        setAsk({ kind: 'story', story: id });
      },
      editMilestone: (id) => setAsk({ kind: 'milestone', milestone: id }),
      importMilestone: (fileId) => {
        const f = itemsRef.get(fileId);
        const parsed = f && parseMilestoneFile(f.path, f.text);
        if (f && parsed) importMilestone(doc, f, parsed);
      },
    }),
    [doc, me, viewport, shared, itemsRef],
  );

  /** A new note in the middle of the view (inside the frame there, clear of its blocks), selected. */
  const addNoteInView = useCallback(() => {
    const id = addSticky(doc, { by: me, ...noteSpot(doc, v.frames, viewport?.center() ?? { x: 0, y: 0 }) });
    viewport?.select([id]);
  }, [doc, me, v.frames, viewport]);

  const clearSelection = useCallback(() => viewport?.select([]), [viewport]);

  const byId = useMemo(() => {
    const m = new Map<string, Parameters<typeof nameOf>[0]>();
    for (const i of [...state.items, ...state.stickies, ...state.decisions]) m.set(i.id, i);
    // A snapshot card stands for its file: its comments and "open" are the file's.
    for (const s of v.snapshots.values()) m.set(s.id, s.item);
    return m;
  }, [state, v.snapshots]);

  const openItem = openId ? state.items.find((i) => i.id === openId) : undefined;
  const compareItem = compareId ? state.items.find((i) => i.id === compareId) : undefined;
  const compareAgreement = compareId ? state.agreements.get(compareId) : undefined;
  /** A name for anything that can be picked or commented on. */
  const nameFor = (id: string): string => {
    const st = v.stories.get(id);
    if (st) return storyName(st.story);
    const m = v.milestones.get(id);
    if (m) return milestoneName(m.milestone);
    const i = byId.get(id);
    if (!i) return id;
    return isSnapId(id) ? `snapshot of ${nameOf(i)}` : nameOf(i);
  };
  const selectedEdge = sel.link && v.edges.some((e) => e.id === sel.link) ? state.humanEdges.find((e) => e.id === sel.link) : undefined;
  const close = useCallback(() => setOpenId(null), []);
  const closeThread = useCallback(() => setThreadOn(null), []);
  const closeCompare = useCallback(() => setCompareId(null), []);

  // What the selection bar offers.
  const known = sel.items.filter((id) => byId.has(id) || v.stories.has(id) || v.milestones.has(id));
  const pickedItems = sel.items.map((id) => byId.get(id)).filter((i) => !!i);
  const oneId = known.length === 1 ? known[0] : undefined;
  const one = oneId ? byId.get(oneId) : undefined;
  const oneStory = oneId ? v.stories.get(oneId) : undefined;
  const canLink = pickedItems.length === 2 && known.length === 2;
  const oneBlock = one?.kind === 'file' ? v.blocks.get(one.id) : undefined;
  const onePin = oneId ? (v.blocks.get(oneId) ?? v.decisions.get(oneId) ?? v.stickies.get(oneId) ?? v.stories.get(oneId) ?? v.milestones.get(oneId))?.pin : undefined;

  // The selection bar: at the top on a wide screen, at the bottom on a narrow one (see bars.ts).
  const narrow = useNarrow();
  const selectionBar = (known.length > 0 || selectedEdge) && (
    <div className="selection-bar" data-testid="selection-bar">
      {selectedEdge ? (
        <>
          <span className="selection-count">Link by {selectedEdge.author}</span>
          <button type="button" className="btn" onClick={() => setAsk({ kind: 'label', edge: selectedEdge.id, initial: selectedEdge.label })}>
            Edit label
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              deleteHumanEdge(doc, selectedEdge.id);
              clearSelection();
            }}
          >
            Delete link
          </button>
        </>
      ) : (
        <>
          <span className="selection-count">{oneId ? nameFor(oneId) : `${known.length} selected`}</span>
          {one?.kind === 'file' && (
            <button type="button" className="btn" onClick={() => setOpenId(one.id)}>
              Open
            </button>
          )}
          {oneId && (
            <button type="button" className="btn" onClick={() => setThreadOn(oneId)}>
              Comments{onePin?.count ? ` (${onePin.count})` : ''}
            </button>
          )}
          {oneBlock && !isMilestonePath(oneBlock.item.path) && (
            <button type="button" className="btn" data-testid="add-to-story" onClick={() => setAsk({ kind: 'add-to-story', item: oneBlock.item.id })}>
              Add to story
            </button>
          )}
          {oneStory && (
            <>
              <button type="button" className="btn" onClick={() => setAsk({ kind: 'story', story: oneStory.story.id })}>
                Edit story
              </button>
              <button type="button" className="btn" onClick={() => setAsk({ kind: 'covers', story: oneStory.story.id })}>
                Cards
              </button>
            </>
          )}
          {oneBlock?.agreement && (
            <button type="button" className="btn" onClick={() => setCompareId(oneBlock.item.id)}>
              Compare
            </button>
          )}
          {canLink && (
            <button type="button" className="btn" onClick={() => setAsk({ kind: 'link', from: pickedItems[0]!.id, to: pickedItems[1]!.id })}>
              Link
            </button>
          )}
        </>
      )}
      <button type="button" className="btn" onClick={clearSelection}>
        Clear
      </button>
    </div>
  );

  return (
    <BoardActionsContext.Provider value={actions}>
      <ViewsContext.Provider value={v}>
        <div className="board-root">
          <BoardCanvas doc={doc} onSelection={setSel} onViewport={setViewport} cursors={cursors} onPointer={onPointer} />
          <div className="board-overlay board-overlay-top">
            <div className="board-header">
              <strong>{state.name || 'agent-board'}</strong>
              <span className={`status status-${status}`} data-testid="status" data-status={status}>
                {(view.mode === 'peer' ? PEER_STATUS_TEXT : STATUS_TEXT)[status]}
              </span>
              <button type="button" className="btn" onClick={addNoteInView} title="Add a note in the middle of the view">
                + note
              </button>
              <button type="button" className="btn" onClick={() => viewport?.fitAll()} title="Show the whole board">
                Fit all
              </button>
              {session && <SharedBar view={view} session={session} />}
            </div>
            {!narrow && selectionBar}
          </div>
          <div className="board-overlay board-overlay-bottom">
            <HiddenList items={v.hidden} onOpen={actions.open} />
            {status === 'online' && state.items.length === 0 && state.stickies.length === 0 && (
              <div className="empty">
                {view.mode === 'peer' ? 'No files yet. Add a note, or connect your agent.' : 'No files yet. Add .md or .html files to the watched folder, or add a note.'}
              </div>
            )}
            {narrow && selectionBar}
          </div>
        </div>
        {openItem && <FullView item={openItem} onClose={close} />}
        {threadOn && (
          <ThreadPanel
            target={threadOn}
            name={nameFor(threadOn)}
            comments={state.comments.filter((c) => c.target === threadOn).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))}
            thread={state.threads.get(threadOn)}
            onClose={closeThread}
          />
        )}
        {compareItem && compareAgreement && <CompareView item={compareItem} agreement={compareAgreement} onClose={closeCompare} />}
        {ask?.kind === 'link' && (
          <TextDialog
            title="Link"
            label={`From ${nameOf(byId.get(ask.from)!)} to ${nameOf(byId.get(ask.to)!)}. Label (optional)`}
            submit="Link"
            onCancel={() => setAsk(null)}
            onSubmit={(label) => {
              addHumanEdge(doc, { from: ask.from, to: ask.to, label, by: me });
              setAsk(null);
              clearSelection();
            }}
          />
        )}
        {ask?.kind === 'reject' && (
          <TextDialog
            title={`Reject ${byId.get(ask.item) ? nameOf(byId.get(ask.item)!) : 'block'}`}
            label="What needs to change (required)"
            submit="Reject"
            multiline
            required
            onCancel={() => setAsk(null)}
            onSubmit={(reason) => {
              if (rejectItem(doc, ask.item, { by: me, reason })) setAsk(null);
            }}
          />
        )}
        {ask?.kind === 'reject-story' && (
          <TextDialog
            title={`Reject ${nameFor(ask.story)}`}
            label="What needs to change (required)"
            submit="Reject"
            multiline
            required
            onCancel={() => setAsk(null)}
            onSubmit={(reason) => {
              if (rejectStory(doc, ask.story, { by: me, reason })) setAsk(null);
            }}
          />
        )}
        {ask?.kind === 'story' &&
          (() => {
            const st = state.stories.find((x) => x.id === ask.story);
            if (!st) return null;
            const all = new Map(state.stories.map((x) => [x.id, x]));
            const blockers: Choice[] = blockerChoices(st, all).map((b) => ({ id: b.id, label: storyName(b) }));
            return (
              <StoryDialog
                title={storyName(st, false)}
                initial={{ title: st.title, story: st.story, check: st.check, size: st.size, owner: st.owner, blockedBy: st.blockedBy }}
                blockers={blockers}
                hasAccepts={st.accepts.length > 0}
                onCancel={() => setAsk(null)}
                onSubmit={(f) => {
                  doc.transact(() => {
                    editStory(doc, st.id, { title: f.title, story: f.story, check: f.check, size: f.size, owner: f.owner });
                    if (f.blockedBy.join() !== st.blockedBy.join()) setBlockedBy(doc, st.id, f.blockedBy);
                  });
                  setAsk(null);
                }}
              />
            );
          })()}
        {ask?.kind === 'covers' &&
          (() => {
            const st = state.stories.find((x) => x.id === ask.story);
            if (!st) return null;
            const frameName = (id: string) => state.frames.find((f) => f.id === id)?.name ?? id;
            const choices: Choice[] = state.items
              .filter((i) => !i.gone && !isMilestonePath(i.path) && v.blocks.has(i.id))
              .sort((a, b) => Number(a.frame !== st.frame) - Number(b.frame !== st.frame) || a.path.localeCompare(b.path))
              .map((i) => ({
                id: i.id,
                label: i.path,
                note: `${AREA_LABEL[v.blocks.get(i.id)!.area]}${i.frame !== st.frame ? ` · in ${frameName(i.frame)}` : ''}${state.agreements.has(i.id) ? ' · agreed' : ''}`,
              }));
            return (
              <PickDialog
                title={`Cards in ${storyName(st, false)}`}
                label="The cards this story covers"
                choices={choices}
                initial={st.covers.filter((c) => choices.some((ch) => ch.id === c))}
                empty="No cards on the board yet."
                onCancel={() => setAsk(null)}
                onSubmit={(ids) => {
                  // Keep covers that are not in the list (a deleted file), so nothing is lost by a save.
                  setCovers(doc, st.id, [...st.covers.filter((c) => !choices.some((ch) => ch.id === c)), ...ids]);
                  setAsk(null);
                }}
              />
            );
          })()}
        {ask?.kind === 'milestone' &&
          (() => {
            const m = state.milestones.find((x) => x.id === ask.milestone);
            if (!m) return null;
            return (
              <MilestoneDialog
                initial={{ number: m.number, name: m.name, goal: m.goal }}
                onCancel={() => setAsk(null)}
                onSubmit={(f) => {
                  if (editMilestone(doc, m.id, f)) setAsk(null);
                }}
              />
            );
          })()}
        {ask?.kind === 'add-to-story' &&
          (() => {
            const f = itemsRef.get(ask.item);
            if (!f) return null;
            const choices: Choice[] = [...v.stories.values()]
              .sort((a, b) => Number(a.story.frame !== f.frame) - Number(b.story.frame !== f.frame))
              .map((st) => ({
                id: st.story.id,
                label: storyName(st.story),
                note: `${milestoneName(st.milestone)}${st.story.covers.includes(f.id) ? ' · covers it already' : ''}`,
              }));
            return (
              <ChooseDialog
                title={`Add ${f.path} to a story`}
                label="Story"
                choices={choices}
                empty="No stories yet. Add one with + story in the Milestone area."
                onCancel={() => setAsk(null)}
                onPick={(id) => {
                  addCover(doc, id, f.id);
                  setAsk(null);
                }}
              />
            );
          })()}
        {ask?.kind === 'label' && (
          <TextDialog
            title="Link label"
            label="Label"
            initial={ask.initial}
            submit="Save"
            onCancel={() => setAsk(null)}
            onSubmit={(label) => {
              setEdgeLabel(doc, ask.edge, label);
              setAsk(null);
            }}
          />
        )}
      </ViewsContext.Provider>
    </BoardActionsContext.Provider>
  );
}
