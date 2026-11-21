Redesign screen 3, "Slice planning", for agent-board. Keep everything else.

## Context

agent-board is a live meeting board for a product team and an engineering team. Each person's AI
agents write artifacts (markdown docs, mermaid diagrams, HTML mockups) as files, and the board
streams them into blocks on one canvas. The spec is in `design.md`. Your earlier screens are in
this folder.

## What to keep

`Main.dc.html` and `Block.dc.html` are right. Keep their visual language exactly: the soft zones,
the file blocks with a mono header line (`file.md · Owner`), the sticky notes, the live cursors,
the edges with small labels, the snapshot cards, and the focused block with Now / Snapshot / Compare
tabs and the comment thread.

## What is wrong with the current slice screen

The slice cards are small task tickets. They read like a backlog tool, not like the board. A person
cannot tell what a slice delivers without opening the linked files.

## The new idea: a slice is a story block

- **A slice is a block,** like the file blocks on the main board, not a small ticket.
- **Slices are numbered in delivery order:** Story 1, Story 2, Story 3, Story 4. The number is large
  and easy to see across the room.
- **Each slice is one user story, or one single feature.** Write it so a human understands it in a
  few seconds. Use the story form: "As a shopper, I want to see the card form only after my payment
  is ready, so that I don't type my card twice."
- **Each story block shows the product side:** a live preview of the UI/UX for this story, if one
  exists. It is a small rendered thumbnail of the agreed HTML mockup (for example
  `card-form.html`), not just a link.
- **Each story block shows the engineering side:** the engineering result for this story, for
  example a small rendered mermaid diagram (sequence or flow), the API lines it adds, or the table
  it changes. Again a rendered preview, not just a file name.
- **Product preview and engineering preview sit side by side,** so a person understands the story
  fast without opening anything.
- **The previews come from the agreed snapshots.** Show a thin "from snapshot" edge or tag back to the
  source block. If the source changed after agreement, the preview shows a small "changed after
  agreement" mark.
- **A story with no UI** (backend only) shows "No UI for this story" in the product half. A story
  with no engineering artifact shows the empty half in the same way.

Each story block also keeps the slice fields from the spec, in a quiet footer or side strip:

- size: S or M. An L story shows "slice again" in red.
- owner
- one acceptance check ("We know it works when...")
- accepts: one product accept and one engineering accept, with names
- the Linear issue ID and status, after the push

## Artboards to make

1. **Story map on the canvas.** The slices zone of the "checkout" feature, at meeting zoom. Show 4 to
   5 story blocks in a loose row or two, in delivery order, with the big numbers. Keep the board
   feel: a few sticky notes ("who owns webhooks?"), cursors of 2 to 3 people, edges from story blocks
   to the agreed snapshots. Show these states across the blocks:
   - Story 1: approved and pushed, with Linear ID and status "In Progress".
   - Story 2: approved, waiting for the push.
   - Story 3: draft from the agent, with one accept of two.
   - Story 4: backend only, with no UI preview.
   - One story at size L, flagged "slice again", with a sticky that shows how to split it.
   Keep the bottom push bar: "2 approved · 1 too big · 2 waiting · Push to Linear".
2. **One story opened.** The same focus pattern as `Block.dc.html`. Show the full story text, a large
   UI preview, a large engineering diagram, the acceptance check, the fields, the accept buttons for
   each side, and the comment thread on the right.
3. **The agent's first cut arriving.** Draft story blocks that just came from the agent, marked
   "from Arif's agent · draft", with the previews already filled in from the agreed blocks.

## Content to use

Use the same checkout example and names as the other screens (Dewi, Tan, Arif, Mei Ling). Suggested
stories:

1. As a shopper, I want my payment to be ready before I see the card form, so that checkout feels
   instant. (UI: loading state into card form. Eng: sequence Web → API → PSP, `POST /intents`.)
2. As a shopper, I want to see a clear message when my payment fails, so that I know what to do
   next. (UI: error state on the card form. Eng: `last_error` on the intent.)
3. As a shopper, I want to pass the 3DS check of my bank, so that my card payment is accepted.
   (UI: 3DS challenge screen. Eng: 3DS flow diagram.)
4. As the payments team, we want a webhook when a payment succeeds, so that orders are marked paid.
   (No UI. Eng: webhook sequence and the `intents` table change.)
5. Size L: "Card form + 3DS + retries", flagged "slice again".

## Do not

- Do not make slices look like Jira or Linear tickets.
- Do not hide the previews behind a click on the canvas view. The previews are the point.
- Do not add features that are not in the spec, except the story form and the previews above.
