import { boardMap, canvasMap, type Device, type Person } from '@agent-board/model';
import type * as Y from 'yjs';
import { views } from '../board/derive';
import { readBoard } from '../board/useBoard';
import type { El, Measure } from './elements';
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
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
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

  /** The canvas changed (Excalidraw's onChange: keys, menus, edits): write it to the doc when settled. */
  changed(): void {
    if (this.stopped || this.flushTimer) return;
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

  /** Write settled changes, then lay the doc over the canvas. */
  run(): void {
    if (this.stopped) return;
    this.flush();
    const local = this.api.getSceneElementsIncludingDeleted();
    const app = this.api.getAppState();
    const held = inGesture(app, this.pointerDown) ? heldIds(app, local, this.pointerDown) : new Set<string>();
    const state = readBoard(this.doc);
    const localById = new Map(local.map((e) => [e.id, e]));
    const desired = docElements(state, views(state), localById, this.opts.measure);
    const stored = new Map(canvasMap(this.doc).entries());
    const { elements, changed } = mergeScene({ desired, stored, local, held, known: this.known });
    for (const id of stored.keys()) this.known.add(id);
    if (!changed) return;
    this.api.updateScene(elements);
    this.pushes++;
    // What we pushed is the doc's state: nothing of it goes back. Held elements are the user's,
    // not yet written: they go to the doc when the gesture ends.
    for (const e of this.api.getSceneElementsIncludingDeleted()) if (!held.has(e.id)) this.seen.set(e.id, e.version);
  }
}
