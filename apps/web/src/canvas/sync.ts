import { boardMap, canvasMap, type Device, type Person } from '@agent-board/model';
import type * as Y from 'yjs';
import { views } from '../board/derive';
import { readBoard } from '../board/useBoard';
import { EMBED_SCHEME, kindOf, type El, type Measure } from './elements';
import { docElements, heldIds, inGesture, mergeScene, type GestureState } from './scene';
import { writeScene } from './writeBack';

/** What the controller needs from Excalidraw's imperative API (a fake one in tests). */
export interface SceneApi {
  getSceneElementsIncludingDeleted(): readonly El[];
  getAppState(): GestureState;
  /** Replace the scene. The canvas passes `captureUpdate: NEVER`, so doc changes stay out of undo. */
  updateScene(elements: El[]): void;
}

/** Who is drawing: the CLI's owner and their side. */
export function personOf(doc: Y.Doc): Person {
  const name = boardMap<string>(doc, 'meta').get('owner') || 'someone';
  const side = boardMap<Device>(doc, 'devices').get(name)?.side ?? 'product';
  return { name, side };
}

/**
 * Keeps the canvas and the doc in step. The doc is the truth: on each doc change the canvas gets
 * the doc laid over it (`mergeScene`), with whatever the user holds left alone. When the user is
 * done with a gesture, what they changed goes to the doc (`writeScene`), and only then.
 */
export class BoardSync {
  private pointerDown = false;
  private readonly seen = new Map<string, number>();
  private readonly known = new Set<string>();
  /** The live elements the last merge left on the canvas. */
  private pushed = new Set<string>();
  /** Blocks Excalidraw has checked as embeds (see `docElements`). */
  private readonly embedded = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** A merge was skipped while Excalidraw was still loading its initial scene. */
  private waiting = false;
  /** Merges pushed to the canvas, for tests and the spike numbers. */
  pushes = 0;

  constructor(
    private readonly doc: Y.Doc,
    private readonly api: SceneApi,
    private readonly opts: { measure: Measure; delayMs?: number } ,
  ) {}

  private readonly onUpdate = () => this.schedule();

  start(): () => void {
    this.doc.on('update', this.onUpdate);
    this.run();
    return () => this.stop();
  }

  stop(): void {
    this.stopped = true;
    this.doc.off('update', this.onUpdate);
    if (this.timer) clearTimeout(this.timer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  /** A doc change: merge soon (changes that come together merge once). */
  schedule(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.run();
    }, this.opts.delayMs ?? 0);
  }

  pointer(down: boolean): void {
    this.pointerDown = down;
    // The gesture ends: let the canvas finish its own pointer-up work first.
    if (!down) this.schedule();
  }

  /**
   * The canvas changed (Excalidraw's onChange: keys, menus, edits): write it to the doc when settled.
   * Merge now if the canvas just finished loading (see `run`), or if the scene was replaced under
   * us some other way (a file dropped on the canvas loads the same way).
   */
  changed(): void {
    if (this.stopped) return;
    if ((this.waiting && !this.api.getAppState().isLoading) || this.lost() || this.checkedEmbeds()) this.schedule();
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 120);
  }

  /** Writes the user's settled changes to the doc. Returns how many elements changed it. */
  flush(): number {
    if (this.stopped || inGesture(this.api.getAppState(), this.pointerDown)) return 0;
    return writeScene(this.doc, this.api.getSceneElementsIncludingDeleted(), this.seen, personOf(this.doc));
  }

  /** Whether elements we put on the canvas are gone from it entirely (a user delete keeps them, as deleted). */
  lost(): boolean {
    if (this.pushed.size === 0) return false;
    const now = new Set(this.api.getSceneElementsIncludingDeleted().map((e) => e.id));
    for (const id of this.pushed) if (!now.has(id)) return true;
    return false;
  }

  /**
   * Notes the blocks Excalidraw has now checked as embeds; true if there are new ones. Called from
   * onChange, which Excalidraw emits after it checks the embeds on the canvas (App.componentDidUpdate:
   * updateEmbeddables, then onChange), so every block with its link on the canvas now is checked.
   */
  private checkedEmbeds(): boolean {
    let added = false;
    for (const e of this.api.getSceneElementsIncludingDeleted()) {
      if (e.isDeleted || e.type !== 'embeddable' || !e.link?.startsWith(EMBED_SCHEME) || this.embedded.has(e.id)) continue;
      const kind = kindOf(e);
      if (kind !== 'file' && kind !== 'decision') continue;
      this.embedded.add(e.id);
      added = true;
    }
    return added;
  }

  /** Write settled changes, then lay the doc over the canvas. */
  run(): void {
    if (this.stopped) return;
    // Excalidraw hands out its API in its constructor, then, after mount, awaits `initialData` and
    // replaces the whole scene with it (App.initializeScene), with isLoading true until then.
    // Anything pushed before would be wiped: wait for the onChange that follows the load.
    this.waiting = !!this.api.getAppState().isLoading;
    if (this.waiting) return;
    this.flush();
    const local = this.api.getSceneElementsIncludingDeleted();
    const app = this.api.getAppState();
    const held = inGesture(app, this.pointerDown) ? heldIds(app, local, this.pointerDown) : new Set<string>();
    const state = readBoard(this.doc);
    const localById = new Map(local.map((e) => [e.id, e]));
    const desired = docElements(state, views(state), localById, this.opts.measure, this.embedded);
    const stored = new Map(canvasMap(this.doc).entries());
    const { elements, changed } = mergeScene({ desired, stored, local, held, known: this.known });
    for (const id of stored.keys()) this.known.add(id);
    if (!changed) return;
    this.api.updateScene(elements);
    this.pushes++;
    // What we pushed is the doc's state: nothing of it goes back. Held elements are the user's,
    // not yet written: they go to the doc when the gesture ends.
    const pushed = new Set<string>();
    for (const e of this.api.getSceneElementsIncludingDeleted()) {
      if (!held.has(e.id)) this.seen.set(e.id, e.version);
      if (!e.isDeleted) pushed.add(e.id);
    }
    this.pushed = pushed;
  }
}
