# agent-board: implementation plan

Date: 2026-11-22.
Input: `docs/design.md` (updated 2026-11-21, with open points 7 to 16) and the screens in
`docs/screens/agent-board-v1-screens.html`.
Status: a proposal. Nothing is built yet.

The plan uses the board's own format: milestones with stories, in the milestone file format of
design section 5.5. When the board works, this file can be its first import.

## 1. Approach

- **Spike first.** The spike (design section 13) decides if the network plan holds. Nothing else
  starts until points 3, 4 and 5 pass.
- **A walking skeleton next.** One file, two peers, live. Each later milestone adds one part of the
  process: join, converge, plan, Linear.
- **The model is pure code.** All rules (accepts reset, "can start", L flag, zone from state, the
  JSON export) live in one package with no UI and no network. It gets most of the tests.
- **Agents test the agent path.** From milestone 3, we use real agents (Claude Code) to write files,
  links, review files and milestone files, and we read their results on the board.

## 2. Architecture

### 2.1 Repo layout

A pnpm monorepo, TypeScript everywhere.

| Package | What it holds | Runs in |
|---|---|---|
| `packages/model` | The Yjs document schema, the types, all field rules, the JSON export | browser, Node |
| `packages/formats` | Parsers: front matter links, `board:link` meta tags, milestone markdown | browser, Node |
| `packages/sync` | Trystero room, Yjs sync over Trystero, forwarding, device keys, the join handshake | browser, Node |
| `apps/web` | Vite + React + Excalidraw. The canvas, blocks, story blocks, panels | browser |
| `apps/cli` | `agent-board`: setup, join, watch, export, stories import | Node |

`apps/web` builds to static files for Cloudflare Pages. It has no server code.

### 2.2 The board document (Yjs)

One `Y.Doc` per board. Top-level maps, keyed by id:

- `frames`, `items` (file blocks, sticky notes, decisions, review files, milestones, stories,
  comment threads), `edges`, `devices`, `layout`, `meta` (board name, Linear team and project).
- **Meaning and layout are separate.** `items` holds the fields from design section 3.1 (`state`,
  `zone`, `blocked_by`, `links`, `accepts`, `author`). `layout` holds `x`, `y`, size and tilt. The
  JSON export reads `items` and `edges`, and adds `layout` only as "layout only".
- **File content.** The CLI writes the full file text into the item on each save (a plain string, not
  `Y.Text`, because only the owner's CLI writes it).
- **Snapshots** are copies of the file text at agreement, stored on the item. They never change.
  "Changed after agreement" is a compare of the snapshot and the current text.
- **Ownership.** Each file item records its owner device. Peers drop file updates for an item from
  any other device. This is how "only the owner changes the content" holds in a peer-to-peer doc.

### 2.3 Sync and network

- **Transport.** Trystero, with the Nostr strategy, and the room secret as the Trystero password. Yjs
  updates travel as one Trystero action, and awareness (cursors, online list) as a second action.
- **Forwarding.** When a peer applies an update from peer A, it sends it on to every other peer
  except A. Yjs ignores updates it already has, so loops do no harm. This gives "synced through Tan".
- **Local copy.** `y-indexeddb` in the browser. The CLI keeps a copy on disk.
- **Device gate.** A peer syncs only with devices on the approved list. On connect, both sides sign a
  challenge with their device key.

### 2.4 The join handshake

The 6-digit code must be bound to the key exchange (design 9.1). **A hash or HMAC of a 6-digit code
is not enough**: a person in the middle can try all one million codes offline. Use a PAKE, for
example CPace or SPAKE2, with the code as the password. The guest's device key and the member's
device key go into the PAKE transcript. A wrong code makes the keys differ, and the join fails.

Picking a PAKE library that runs in the browser and in Node is part of the spike.

### 2.5 Blocks

- **Markdown:** a markdown renderer. Mermaid fences render with Pele. If Pele does not run offline,
  use `mermaid` directly.
- **HTML:** an iframe with `srcdoc` and `sandbox="allow-scripts"`, without `allow-same-origin`. A
  thumbnail is the same iframe, scaled down, and loaded only when it is on screen.
- **Broken content:** broken mermaid shows the raw text and the parse error. An HTML page that fails
  shows a clear message.

### 2.6 The CLI

- `agent-board setup`: name, side, project folder, shared folder, invite link, then the join code.
- `agent-board watch`: watches the shared folder (chokidar). A subfolder picks the frame. It reads
  links from front matter and `board:link`, and detects a rename by content hash.
- `agent-board export`: the JSON export, for agents.
- `agent-board stories import <file>`: imports a milestone file.
- WebRTC in Node needs a polyfill (`node-datachannel` or `@roamhq/wrtc`). This is spike point 5.

### 2.7 Linear

- The web app calls the Linear GraphQL API from the browser, with the person's own key. The key stays
  in that device's local storage. It never goes into the board document.
- A push makes the milestone, then the issues, then the "blocked by" relations. It writes each issue
  ID onto the story at once, so a failed push can resume without duplicates.

## 3. Tests

- `packages/model` and `packages/formats`: unit tests (Vitest). Every rule in design sections 3.1,
  5 and 6 gets a test.
- `packages/sync`: tests with several in-process peers and a fake transport. These include the
  three-peer case, where A cannot reach C.
- `apps/web`: Playwright with two or three browser contexts, on a local Nostr relay.
- `apps/cli`: tests that use a temp folder and a fake board.
- Real-network checks run by hand, from the team's real networks in Indonesia and Singapore.

## 4. Decide before the build

These open points change the model, so they need a decision before the milestone that uses them.

| Before | Decide |
|---|---|
| Milestone 1 | 15 (forwarding) |
| Milestone 2 | 14 (one join request, several members) |
| Milestone 3 | 13 (phase), 16 (comment threads), and decision 6 in section 15 |
| Milestone 4 | 7 (changed snapshot), 8 (milestone file), 9 (several files on one side), 10 (split L story), 11 (owner and check), and decisions 1, 3 and 4 |
| Milestone 5 | 12 (connect Linear), and decision 2 |

## 5. Milestones and stories

Sizes are guesses. An owner is set in the planning session.

```markdown
# Milestone 0: Spike
Goal: we know the network plan works, before we build on it.

## Mermaid block in a frame
- story: As an engineer, I want a markdown block with a Pele mermaid diagram inside a canvas frame, so that we know the canvas can hold our blocks.
- size: S
- owner:
- covers: design.md
- blocked-by:
- check: a change to the file shows on the block within 1 second.

## HTML thumbnails stay smooth
- story: As an engineer, I want five or more sandboxed HTML thumbnails on screen at once, so that we know a story map stays usable.
- size: S
- owner:
- covers: design.md
- blocked-by:
- check: panning with 6 thumbnails stays above 50 fps on a normal laptop.

## Two browsers across two countries
- story: As an engineer, I want two browsers on different networks to sync one Yjs document through Trystero and public STUN, so that we know peer-to-peer works for the team.
- size: M
- owner:
- covers: design.md
- blocked-by:
- check: a browser in Indonesia and one in Singapore see each other's change within 2 seconds.

## Three peers with one broken pair
- story: As an engineer, I want a change from A to reach C through B when A cannot reach C, so that one strict network does not cut a person off.
- size: M
- owner:
- covers: design.md
- blocked-by: Two browsers across two countries
- check: with the A to C link blocked in a test, a change from A shows on C.

## CLI joins the room
- story: As an engineer, I want the Node CLI to join the same Trystero room and stream a file, so that we know the CLI can work without a server.
- size: M
- owner:
- covers: design.md
- blocked-by: Two browsers across two countries
- check: a saved file on the CLI laptop shows in a browser on another network.

## File link becomes an edge
- story: As an engineer, I want a link in a file's front matter to become an edge, so that we know agents can link blocks without touching the board.
- size: S
- owner:
- covers: design.md
- blocked-by: Mermaid block in a frame
- check: adding the link draws the edge, and removing it deletes the edge.

## Join code bound to the key exchange
- story: As an engineer, I want the join code used as a PAKE password, so that a person in the middle cannot join with a guessed code.
- size: M
- owner:
- covers: design.md
- blocked-by:
- check: a right code joins, a wrong code fails, and a test with a fake middle peer fails.

# Milestone 1: One file, two people, live
Goal: a person saves a file, and a team member sees it on the board at once.

## Board model and export
- story: As an engineer, I want one package that holds the board document and its rules, so that the web app and the CLI share one model.
- size: M
- owner:
- covers: design.md
- blocked-by:
- check: unit tests cover frames, items, edges, layout, and a JSON export without x and y in the fields.

## CLI setup and watch
- story: As a team member, I want to run setup once and then watch my shared folder, so that my agent's files reach the board without extra steps.
- size: M
- owner:
- covers: design.md
- blocked-by: Board model and export
- check: a new file in board/checkout/ makes a block in the checkout frame, in my side's zone.

## Canvas with frames and zones
- story: As a team member, I want to see feature frames with their four soft zones, so that I know where each thing belongs.
- size: M
- owner:
- covers: design.md, agent-board-v1-screens.html
- blocked-by: Board model and export
- check: a block dragged out of its zone keeps its zone badge.

## Live cursors and online list
- story: As a team member, I want to see who is online and where their cursor is, so that the meeting feels like one room.
- size: S
- owner:
- covers: agent-board-v1-screens.html
- blocked-by: Canvas with frames and zones
- check: two browsers see each other's cursor with the right name and side.

## Gone and renamed files
- story: As a team member, I want a deleted file to hide its block and a renamed file to keep its block, so that edges and comments are not lost.
- size: S
- owner:
- covers: design.md
- blocked-by: CLI setup and watch
- check: a rename keeps the block id and edges, and a delete moves the block to the list of hidden blocks.

## Owner offline
- story: As a team member, I want a block to show "owner offline" and the time of the last update, so that I know the content may be old.
- size: S
- owner:
- covers: screens-review.md
- blocked-by: CLI setup and watch
- check: when the owner's CLI stops, the block shows the time of its last update.

# Milestone 2: Join safely
Goal: a new team member joins from a Slack link and a code, and nobody else can.

## Join with a code
- story: As a guest, I want to open the invite link and type the code a member sends me in Slack, so that I can join without an account.
- size: M
- owner:
- covers: agent-board-v1-screens.html, design.md
- blocked-by:
- check: the guest joins with the right code, and a wrong code stops the join.

## One member handles a request
- story: As a member, I want to see "Dewi is handling this" when someone else opens a join request, so that the guest does not get two codes.
- size: S
- owner:
- covers: design.md
- blocked-by: Join with a code
- check: only one page shows a code, and the code expires after 5 minutes or one wrong try.

## Approved devices
- story: As a member, I want to see, approve and revoke devices, so that a lost laptop cannot read the board.
- size: M
- owner:
- covers: agent-board-v1-screens.html
- blocked-by: Join with a code
- check: a revoked device stops getting updates at once and cannot join again without a code.

## Network panel
- story: As a team member, I want to see how I link to each person, so that I know who I cannot reach and what to do.
- size: S
- owner:
- covers: agent-board-v1-screens.html
- blocked-by:
- check: a peer reached through another peer shows "synced through Tan".

## Save the board as JSON
- story: As a team member, I want to save the board as a JSON file, so that I have a backup when nobody is online.
- size: S
- owner:
- covers: design.md
- blocked-by:
- check: the saved file loads into a new empty board with the same items.

# Milestone 3: Converge
Goal: product and engineering agree on one concept on the board.

## Edges by hand and from files
- story: As a team member, I want to draw labeled arrows, and see the arrows that agents declare in files, so that the links between ideas are clear.
- size: M
- owner:
- covers: design.md
- blocked-by:
- check: an edge from a file looks dotted with the file name, and only a file change can remove it.

## Sticky notes
- story: As a team member, I want to put sticky notes anywhere, so that I can add a thought fast.
- size: S
- owner:
- covers: design.md
- blocked-by:
- check: a sticky note shows its author, and the CLI never makes one.

## Comment threads
- story: As a team member, I want a comment thread on a block, so that we discuss it in one place.
- size: M
- owner:
- covers: agent-board-v1-screens.html
- blocked-by:
- check: a comment pin shows the count, and the thread is in the JSON export.

## Agree and snapshot
- story: As a team member, I want to write a decision and agree on blocks, so that the agreed version stays fixed while the files keep changing.
- size: M
- owner:
- covers: design.md, agent-board-v1-screens.html
- blocked-by:
- check: an agreed block gets a frozen snapshot, and a later file change shows "changed after agreement".

## Compare, keep or agree again
- story: As a team member, I want to compare a snapshot with the current file and choose "keep snapshot" or "agree again", so that a change after the meeting is never silent.
- size: M
- owner:
- covers: agent-board-v1-screens.html
- blocked-by: Agree and snapshot
- check: "agree again" needs one product accept and one engineering accept, and a changed line shows as one line.

## Review files
- story: As a team member, I want an agent's findings to show as a review block linked to the files it names, so that we fix mismatches before we agree.
- size: S
- owner:
- covers: design.md
- blocked-by: Edges by hand and from files
- check: a review.md with two links shows as a block with two edges, and it goes away when the file is deleted.

## Agent work looks different
- story: As a team member, I want agent work to look different from human work, so that I know what a person decided.
- size: S
- owner:
- covers: design.md
- blocked-by:
- check: every item with an agent author shows the agent mark.

# Milestone 4: Plan
Goal: the team turns the agreed concept into approved stories in one planning session.

## Milestone file import
- story: As a team member, I want my agent's milestone file to become a milestone with draft stories, so that the planning session starts from a first cut.
- size: M
- owner:
- covers: design.md
- blocked-by:
- check: the 5-story example file makes 5 draft stories, and the L story shows "split it".

## Story block with previews
- story: As a team member, I want each story to show its UI preview and its engineering preview side by side, so that I understand it without opening anything.
- size: M
- owner:
- covers: agent-board-v1-screens.html, design.md
- blocked-by: Milestone file import
- check: the previews come from the agreed snapshots, and a backend-only story shows "No UI for this story".

## Blocking and can start
- story: As a team member, I want to mark a story as blocked by another, so that we know what can start first.
- size: S
- owner:
- covers: design.md
- blocked-by: Story block with previews
- check: a story with no open blockers shows "can start", and moving a story changes nothing.

## Accepts
- story: As a product person or an engineer, I want to accept a story for my side, so that we approve it together.
- size: M
- owner:
- covers: design.md
- blocked-by: Story block with previews
- check: an edit to the title, story, check or size resets both accepts, and a story with no owner cannot be accepted.

## One story opened
- story: As a team member, I want to open a story with large previews, the fields and the comments, so that we can discuss it in the meeting.
- size: M
- owner:
- covers: agent-board-v1-screens.html
- blocked-by: Story block with previews
- check: the opened story shows the accept buttons for each side and the agent view of its JSON.

## Split an L story
- story: As a team member, I want to mark an L story as split into other stories, so that it leaves the board but its history stays.
- size: S
- owner:
- covers: design.md
- blocked-by: Milestone file import
- check: the split story is hidden, and its arrows point to the new stories.

# Milestone 5: Linear
Goal: approved stories reach Linear with one click, and their status comes back.

## Connect Linear
- story: As a team member, I want to connect my own Linear key, so that I can push stories without sharing a secret.
- size: S
- owner:
- covers: design.md
- blocked-by:
- check: the key is in local storage only, and it is not in the board document or the JSON export.

## Push approved stories
- story: As a team member, I want to push the approved stories of a milestone to Linear, so that engineers can start work.
- size: M
- owner:
- covers: design.md
- blocked-by: Connect Linear
- check: the push makes one Linear milestone, one issue per story and the blocked-by relations, and a second push makes no duplicates.

## Refresh status
- story: As a team member, I want to pull the newest Linear status onto the stories, so that the board shows where work is.
- size: S
- owner:
- covers: design.md
- blocked-by: Push approved stories
- check: after refresh, a story shows the status from Linear.

## Push failed
- story: As a team member, I want a failed push to show the error and a retry, so that I can finish it without duplicates.
- size: S
- owner:
- covers: screens-review.md
- blocked-by: Push approved stories
- check: a push that fails halfway resumes and skips the issues it already made.
```

## 6. Order and parallel work

- Milestone 0 runs first. Its seven points can run in parallel, in about one or two days.
- Milestone 1 is the base for everything else.
- After milestone 1, milestones 2 and 3 can run in parallel.
- Milestone 4 needs milestone 3, because previews use snapshots.
- Milestone 5 needs milestone 4.
- The team must finish milestone 2 before it puts company work on the board.

## 7. Risks

| Risk | What we do |
|---|---|
| Direct WebRTC links fail between real networks | Spike point 3 on real networks. Forwarding (point 4). Tailscale later. |
| Trystero does not run well in Node | Spike point 5. A fallback: the CLI talks only to the owner's own browser tab through a local port. |
| The 6-digit code is brute-forced | A PAKE, not a hash (section 2.4). |
| Many HTML iframes are slow | Spike point 2. Lazy loading. A static image of the page if needed. |
| A peer changes another person's file block | Peers drop file updates that do not come from the owner's device (section 2.2). |
| Big HTML files make the document large | Watch the size in milestone 1. Keep only the current text and the snapshots, not each save. |
