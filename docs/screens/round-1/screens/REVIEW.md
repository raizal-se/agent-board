# agent-board screens: review brief

You are reviewing UI mockups for **agent-board**. The spec is in `design.md`.

## Files

| File | Screen |
|---|---|
| `Main.dc.html` | 1 · Board in the converge phase. A Miro-style, messy canvas: a feature frame, 4 soft zones, file blocks, stickies, edges, cursors, comment pins. |
| `Block.dc.html` | 2 · One block opened on the canvas: agreed snapshot vs current file, "changed after agreement", comments. |
| `Slices.dc.html` | 3 · Slice planning on the canvas: loose card groups, accepts, an L slice being split, Linear IDs, push bar. |
| `Join.dc.html` | 4 · Join flow: the guest types the code, and the member sees the request and the code. |
| `Settings.dc.html` | 5 · Approved devices, network status for each peer, the "no direct link" message. |
| `Cli.dc.html` | 6 · CLI setup, watch log, export, slice import. |
| `canvas.json` | Layout of the artboards on the design canvas. Not part of the product. |

## Notes on the format

- Each `.dc.html` is a static mockup made for a design canvas tool. It loads `./support.js`,
  which is not in this folder, so the files will not render on their own in a browser. Read the
  markup. Most of it is plain HTML with inline styles and absolute positions.
- Names (Dewi, Tan, Arif, Mei Ling, Rina), endpoints and Linear IDs are placeholders.

## What to review

1. **Spec coverage.** Check each v1 item in `design.md` section 12. Is it shown? Is anything shown that is v2 or later?
2. **Spec conflicts.** Find places where the screens and the spec disagree, or the spec disagrees with itself.
   Known: frozen snapshots are v1 in section 6 but v2 in section 12.
3. **Open questions the screens expose.** Known ones:
   - Is a block's zone set by its position on the canvas or by its state?
   - Who resolves "changed after agreement": the owner, or both sides again?
   - Which slice edits reset the accepts?
   - Can a slice with no owner be approved?
   - Partial links: if A can reach B and B can reach C, but A can't reach C, does A's change reach C?
4. **Usability in a live meeting** with 2 to 6 people: can you tell who did what, what changed and what is agreed?
5. **Missing states:** empty board, first join, everyone offline, deleted file block, rename.

Give findings ranked by impact, each with the screen, the problem and a suggested fix.
