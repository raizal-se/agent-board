# agent-board: design

Status: agreed in a grilling session on 2026-11-20, updated on 2026-11-21 after the screen
review. Nothing is built yet. "agent-board" is a working name.

## What changed on 2026-11-22

- The canvas is **Excalidraw**, not React Flow (section 11). The Yjs doc stays the source of truth.
- A feature board is **one big frame with four areas**: Product, Engineering, Agreed, Milestone.
  A file says its area with `area:` front matter or the `board:area` meta tag; a person can switch it.
- **Agree and reject are buttons on the card**. Agree takes a snapshot, shown as a snapshot card in
  the Agreed area. Reject needs a reason. Both are entries in the card's comment thread.

## What changed on 2026-11-21

- New rule: **layout is free, meaning is in the fields** (section 3.1).
- "Slices" are now **milestones** with **stories** (section 5). The third phase is now **Plan**.
- Stories have **no order**. "Blocked by" decides what starts first (section 5.4).
- Each story shows a **UI preview and an engineering preview** from the agreed snapshots (section 5.3).
- Agents still **only write files**. Links inside files become arrows. Agent findings go into
  review files (sections 4.3 and 8).
- **Sticky notes and accepts are for humans only** (sections 4.2 and 8).
- Frozen snapshots move to **v1**, because story previews need them (sections 6 and 12).
- Section 15 lists the decisions that still need a final yes.

## 1. What it is

An ideation and planning board for a product team and an engineering team. Agents do most of the
work. Humans stay in the loop and make every decision.

Each person works with their own AI agents. The agents write artifacts (markdown docs, mermaid
diagrams, HTML mockups) as files in the person's repo. The board streams those files into blocks on
one shared canvas.

The board supports one process, in three phases:

1. **Diverge.** Product brings the feature design. Engineering brings the system design. Each
   side made theirs with their own agents before the meeting.
2. **Converge.** Both sides meet in the middle, talk, adjust and agree on one concept.
3. **Plan.** An agent proposes a first cut of stories for a milestone. The team edits and accepts
   them together in a planning session (a modern grooming). Approved stories go to Linear.

The board is chaotic on purpose, like Miro. It must still be easy to read for humans and for
agents. The zones, the decisions, the milestones and the stories give it structure.

## 2. Users

- A small, trusted team: 2 to 6 people on one board.
- Product people and engineers. Each person has a side, product or engineering.
- Team members are in Indonesia and Singapore. There is no shared VPN yet.
- This is an internal company tool.

## 3. The board

- **One board for each project.**
- **Feature frames.** A feature is a frame on the board, like a Miro frame. People work inside it.
- **Four zones in each feature frame:** product, engineering, agreed, milestone. Zones are soft
  colour areas, not strict boxes.
- **Loose notes.** Sticky notes can also sit outside any frame.
- **Edges.** Arrows with an optional label, between any two blocks. A human draws them on the board,
  or an agent declares them in a file (section 4.3).
- **No links between features in v1.** A block can name another feature in text, but it gets no
  live edge.

### 3.1 Layout is free, meaning is in the fields

- Position, size, tilt and overlap are free. They carry **no meaning**.
- Meaning lives in fields: `state`, `zone`, `blocked_by`, `links`, `accepts`, `author`.
- **The zone comes from the state, not from the position.** An agreed block stays agreed if someone
  drags it out of the green area. A block can sit anywhere and keep its badge.
- Agents read the fields in the JSON export. They never need `x` and `y` to understand the board.
- The `x` and `y` position lives only in the board, never in the file.

## 4. Blocks

### 4.1 File blocks

File blocks show content that an agent wrote. Only the owner's agent changes the content, in the
owner's repo. Everyone can move, link and comment on a file block.

| Type | Source | Renderer |
|---|---|---|
| Markdown | `.md` file | Markdown renderer. Mermaid code fences render with [Pele](https://pele.run/) (MIT, from Obsidian). |
| HTML | `.html` file | Sandboxed iframe. Scripts and CDN links work. The page has no access to the board, cookies or other blocks. |

HTML designs are throwaway. The team rebuilds them later as Next.js and React code.

**One file for each mockup state.** If a story needs a different look of a page (for example the
error state of the card form), the agent writes it as its own file: `card-form.html` and
`card-form-error.html`. A block always renders the page as it opens.

**How a file becomes a block:**

- Each person runs the CLI and shares one folder, for example `board/`.
- A subfolder picks the feature frame: `board/checkout/api.md` lands in the "checkout" frame. If the
  frame does not exist, the board makes it.
- The block lands in the owner's side zone, in the next free spot.
- Each save streams to the board. A dot on the block shows that its file is changing.
- **A deleted file** marks its block as gone and hides it. Its edges and comments stay. Anyone can
  open it from the list of hidden blocks.
- **A renamed file** keeps the same block if the CLI detects the rename.

### 4.2 Board-native items

People make these on the board.

- **Sticky note:** free text. **Humans only.** Agents never write sticky notes.
- **Decision block:** a short note with the decision, the blocks it covers and who agreed.
- **Milestone and story blocks:** see section 5.

### 4.3 Links in files

An agent never draws on the board. It declares links in a file it owns, and the CLI turns each link
into an edge.

In a markdown file, in the front matter:

```markdown
---
links:
  - to: checkout/api.md
    label: calls
---
```

In an HTML file:

```html
<meta name="board:link" content="checkout/db-schema.md | reads status">
```

- An edge from a file link always points **from the file that holds the link**.
- The edge belongs to that file. If the agent removes the link, the edge goes away.
- Edges from files look different from edges drawn by humans (dotted, with the file name in the
  label).

### 4.4 Review files

Agents put findings (for example "the timeout is 30s in api.md but 60s in payment-sequence.md") in
a review file in their owner's folder, for example `board/checkout/review.md`. The review file links
to the files it talks about. It shows as a normal file block. When the finding is fixed, the owner's
agent updates or deletes the review file.

## 5. Milestones and stories

### 5.1 Milestone

A milestone is the **goal of a phase**: what the engineers build first.

- Fields: number, name, goal. Example: "Milestone 1 · Pay by card. Goal: a shopper can pay by card,
  with 3DS."
- A milestone belongs to **one feature frame**.
- A milestone holds stories.
- In Linear, a milestone becomes a **Linear milestone**.

### 5.2 Story

A story is one user story or one single feature. It must be small enough to build, test and merge
fast.

**Fields on a story:**

- id (set by the board, for example `story-3`)
- number (a name only, not an order: "Story 3")
- title (short, used as the Linear issue title)
- story ("As a …, I want …, so that …")
- covers (the agreed blocks it covers)
- one acceptance check ("We know it works when …")
- owner
- size: S or M. The board flags an L story as "split it". An L story cannot be approved.
- blocked by (other stories in the same milestone)
- accepts (one product, one engineering)
- Linear issue ID and status, after the push
- author (a person, or a person's agent)

### 5.3 Story block

A story block is a block like a file block, not a small ticket. It is made so a person understands
the story in a few seconds without opening anything.

- A big story number and the short title.
- The story sentence.
- **Product half:** a rendered preview of the agreed UI mockup it covers. A backend-only story shows
  "No UI for this story".
- **Engineering half:** a rendered preview of the agreed engineering block it covers (a mermaid
  diagram, API lines or a table change). If there is none, the half shows that it is empty, in the
  same way.
- The previews come from the **agreed snapshots**. A thin "from snapshot" tag points back to the
  source block. If the source changed after agreement, the preview shows "changed after agreement".
- A quiet footer: the acceptance check, size, owner, "can start" or "blocked by", accepts, and the
  Linear ID and status.

A file in `covers` goes to the product half or the engineering half by the **side of its owner**.

### 5.4 Blocking

- Stories have **no order**. Moving a story on the board changes nothing.
- A story can be blocked by other stories **in the same milestone**.
- Blocking shows as a "blocks" arrow between story blocks.
- A story with no open blockers shows **"can start"**. The others show "blocked by Story N".
- Approved does not mean "can start". A story can be approved and still blocked.

### 5.5 The first cut comes from an agent

The agent reads the JSON export of the board and writes a markdown file in its owner's folder, one
file per milestone, for example `board/checkout/milestone-1.md`. The CLI turns each entry into a
draft story block, with the previews already filled in. From then on, the stories are board-native
and the team owns them. The file is read once, at import. Later changes on the board do not go back
into the file.

```markdown
# Milestone 1: Pay by card
Goal: a shopper can pay by card, with 3DS.

## Payment ready before form
- story: As a shopper, I want my payment to be ready before I see the card form, so that checkout feels instant.
- size: S
- owner:
- covers: card-form.html, payment-sequence.md
- blocked-by:
- check: the card form opens with an intent ID already set.

## Pass the 3DS check
- story: As a shopper, I want to pass the 3DS check of my bank, so that my card payment is accepted.
- size: M
- owner: Mei Ling
- covers: 3ds.html, 3ds-flow.md
- blocked-by: Payment ready before form
- check: a 3DS test card shows the bank challenge, and the intent status is succeeded.
```

The `#` heading is the milestone. Each `##` heading is one story title. The fields under it are
fixed. `blocked-by` names other story titles in the same file.

### 5.6 Approval

- A story is approved when one product person and one engineer accept it.
- Each accept shows the person's name on the story.
- **Only humans accept.** Agents never accept.
- An edit to the title, story, check or size of an approved story resets both accepts. Moving it,
  changing the owner or changing "blocked by" does not.
- Only approved stories can go to Linear.

### 5.7 Linear

- Any team member can volunteer to push approved stories to Linear, with their own Linear access.
- The milestone becomes a Linear milestone. Each story becomes an issue with the short title.
- "Blocked by" becomes a Linear "blocked by" relation.
- The board records the Linear issue ID on the story, so nobody pushes it twice.
- The push is one way. Anyone can click "refresh" to pull the newest status onto the stories.
  Linear owns the status.

## 6. Agreement

- Both sides agree in the meeting, and someone writes a decision block.
- The agreed blocks move to the agreed zone (their state becomes "agreed") and get a frozen
  snapshot. **Snapshots are in v1**, because story previews use them.
- If the owner's file changes after the agreement, the block shows "changed after agreement". The
  change does not overwrite the snapshot silently.
- A human chooses "keep snapshot" or "agree again". Agreeing again needs one product person and one
  engineer, like a story.

## 7. People and presence

- Live cursors with names.
- A list of who is online.
- A dot on a block while its file changes.
- Each person has a name and a side, set once in the CLI setup.
- Agent work looks different from human work (a colour and a small mark), so people can tell them
  apart.

## 8. Agents

Agents drive the work. Humans stay in the loop.

**Agents can read:**

- Everything on the board, from all participants: every file block, its current content, its agreed
  snapshot, edges, frames, zones, decisions, milestones and stories.
- They read it through the JSON export.
- Agents **cannot** read other people's repos. Only what is in the shared folders and on the board.

**Agents can write, only through files in their owner's folder:**

- File blocks (markdown and HTML).
- Links between blocks (section 4.3).
- Review files with findings (section 4.4).
- Milestone files with draft stories (section 5.5).

**Agents change only their own items.** They can add, edit and delete what their owner's files
produce. They never change items from other people or other agents.

**Agents never:**

- write to the board directly
- write sticky notes or comments
- accept a story or an agreement

Each owner prompts their own agent during the meeting. No shared agent sits on the board in v1.

**Trust:** files can contain instructions for other agents, if they are about the project. This is
accepted because the board is a trusted space for trusted people. It is a known risk, and we review
it if the board is ever opened to more people.

## 9. Network and sync

The goal is fully peer-to-peer. The team runs no server.

- **Sync:** Yjs. Each peer keeps a full copy of the board in the browser (IndexedDB).
- **Transport:** WebRTC data channels between peers.
- **Finding peers:** [Trystero](https://github.com/dmotz/trystero). It sends the WebRTC handshake
  through free public relays (Nostr or BitTorrent trackers), encrypted with the room secret. The
  relays never see board content.
- **NAT traversal:** free public STUN servers. There is no TURN relay in v1.
- **App hosting:** Cloudflare Pages, on a personal free account. It holds only the app code.
- **Room secret:** after the `#` in the invite link. Browsers never send that part to a server.
- **If a direct link fails** because of a strict network, the board says so clearly. Tailscale or a
  company VPN comes later for those cases.

### 9.1 Joining a board

1. A team member sends the invite link in Slack.
2. The guest opens the link in the browser.
3. An approved member's page shows "someone wants to join", with the guest's name and a code.
4. The member sends the code to the guest in Slack.
5. The guest types the code on their page.
6. The code is mixed into the key exchange. A wrong code, or someone in the middle, makes the
   join fail.

- Each device makes its own key pair on the first join.
- The board keeps a list of approved devices. An approved device joins later without a prompt.
- Any approved member can approve new devices and revoke a device.
- The approved list travels with the board, so no single "host" is needed.

### 9.2 When nobody is online

- The board lives in each peer's local copy. The next person who opens it syncs from whoever is
  online.
- Anyone can save the board as a JSON file.
- An always-on seed peer comes in v2.

## 10. The CLI

The CLI runs on each person's laptop.

- **Setup, once:** your name, your side (product or engineering), the project folder, the shared
  folder and the board to connect to. The CLI walks you through it.
- **Joins the room** the same way a browser does: Trystero, then the join code.
- **Watches the shared folder** and streams each file to its block.
- **Reads links** from front matter and `board:link` meta tags, and turns them into edges.
- **Imports a milestone file** as a milestone with draft story blocks.
- **Exports the board as JSON** for agents, with all the fields from section 3.1 and the content of
  every file block and snapshot.

## 11. Stack

- **Canvas:** [Excalidraw](https://github.com/excalidraw/excalidraw) 0.18 (MIT), self-hosted with
  its fonts in our build. Each folder is an Excalidraw frame split into four areas. File blocks are
  locked embeddables that render our own markdown, mermaid and HTML blocks. Notes, shapes and arrows
  are Excalidraw's own tools.
- **Sync:** Yjs. **The Yjs doc is the source of truth; Excalidraw is only the view.** A bridge
  (`apps/web/src/canvas/sync.ts`) maps the doc to scene elements and back, never moves an element
  the user is dragging, and never echoes its own writes.
- **Mermaid:** Pele.
- **Peer discovery:** Trystero.

**Why not the others:**

- **tldraw** has the best canvas, but production use needs a paid license key, and its sync uses a
  server.
- **xyflow / React Flow** was the first canvas (slices 1 and 2). We left it on 2026-11-22: building a
  free whiteboard (drawing, notes, arrows, selection, touch) on it meant rebuilding Excalidraw.
  Excalidraw's custom embed renderer worked for our blocks (spike, 2026-11-22).
- **AFFiNE / BlockSuite** is too heavy to extract.
- **No open-source project** covers most of this design. These projects are worth reading:
  - [doop](https://github.com/kgoedecke/doop) (AGPL): sandboxed HTML frames, per-frame history, MCP tools.
  - [Noteriv](https://github.com/thejacedev/Noteriv) (MIT): Yjs over WebRTC with markdown and mermaid.

## 12. Scope

### v1

- The one-day spike (section 13).
- The CLI: setup, join, the folder watch, links from files, the milestone import and the JSON export.
- Joining with a Slack link and a code. The list of approved devices.
- A canvas with feature frames, four zones, labeled edges, cursors and the online list.
- Markdown blocks with Pele, and sandboxed HTML blocks.
- Sticky notes and decision blocks.
- Frozen snapshots and "changed after agreement".
- Milestones and story blocks with UI and engineering previews, blocking and "can start".
- Story approval, the push to Linear (milestone, issues, blocked-by relations) and the refresh
  from Linear.

### v2

- A sketch layer: boxes, arrows and text that anyone can edit.
- Sketch to mermaid: an agent reads the sketch from the JSON export and writes a mermaid diagram
  into its owner's markdown file.
- Mermaid to editable shapes: start with flowcharts. The result is a board-native copy, and the
  owner's file does not change. Excalidraw's MIT converter may be reusable as a parser for more
  types (unverified).
- The per-block history view.
- An always-on seed peer.
- A "hide agent items" filter.

### Later

- Links between features, and blocking across milestones.
- A live read API for agents.
- Live agent presence on the board (for example "Mei Ling's agent is reading api.md").
- Figma embed blocks.
- Tailscale or a company VPN for peers whose networks block direct links.

## 13. The one-day spike

The spike must prove these points before the build starts:

1. A markdown block with a mermaid diagram (rendered by Pele) lives inside a frame on the canvas, and it
   updates live when its file changes.
2. A sandboxed HTML block works inside the same frame. **Five or more HTML thumbnails on screen at
   once** stay smooth (one story map has several previews).
3. Two browsers on different networks (one in Indonesia, one in Singapore) sync one Yjs document
   through Trystero and public STUN.
4. **Three peers, where one pair cannot link directly.** A change from A still reaches C through B.
5. The CLI, on Node, joins the same room through Trystero and streams a file.
6. A link in a file's front matter becomes an edge on the board, and it goes away when the link is
   removed.
7. The join code is bound to the key exchange.

If point 3, 4 or 5 fails, revisit the network section before more work.

## 14. Open facts to check

These came from web research and were not verified at the source.

- Trystero: its current state, and whether it runs in Node for the CLI.
- How often direct WebRTC links fail between the team's real networks.
- Cloudflare Pages: whether the move toward Workers static assets affects a new Pages site.
- Pele: whether it runs offline in the browser.
- Tailscale: the free plan is for non-commercial use, so company use needs a paid plan.
- ngrok: its free terms for company use, if a tunnel is ever needed.
- Linear API: milestones and "blocked by" relations can be created with a personal key.

## 15. Decisions to confirm

These were proposed in the review and need a final yes.

1. Blocking only inside one milestone (section 5.4).
2. "Blocked by" is pushed to Linear as a relation (section 5.7).
3. Which edits reset accepts: title, story, check and size only (section 5.6).
4. The side of a covered file comes from its owner's side (section 5.3).
5. Agreeing again after a change needs one product person and one engineer (section 6).
6. A file link edge points from the file that holds the link (section 4.3).

### 15.1 Open points from the second screen review (2026-11-22)

Details are in `screens-review.md`, part 2. Each point needs a decision.

7. **A story covers a changed snapshot.** Story 2 is approved, but its engineering preview shows
   `last_error`, which was added after the agreement. Proposal: a story whose covered block is
   "changed after agreement" shows a warning and cannot be pushed until someone chooses "keep
   snapshot" or "agree again".
8. **The milestone file after import.** The file is read once, but it is also a file block. Proposal:
   after the import, the file block shows "imported · N stories". If the agent saves the file again,
   the block offers "import new entries". Existing stories never change from the file.
9. **Several covered files on one side.** Proposal: the half shows the first covered file and a
   "+1" tag. The opened story shows all of them.
10. **A split L story.** Proposal: a human marks it "split into Story 1, Story 3, …". It is then
    hidden like a gone file, and its arrows move to the new stories.
11. **Owner and check are required.** Proposal: nobody can accept a story with no owner or no
    acceptance check.
12. **Connect Linear.** Proposal: each person pastes their own Linear key in the board settings. It
    stays on that device. The Linear team and project are board fields.
13. **Phase.** Proposal: the phase (diverge, converge, plan) is a label on each feature frame, not a
    mode of the whole board. It locks nothing.
14. **One join request, several members.** Proposal: when one member opens the request, the other
    pages show "Dewi is handling this". A code expires after one wrong try or 5 minutes.
15. **Forwarding.** Each peer forwards each update it gets to every other peer it can reach. The
    network panel shows "synced through Tan", not "no link".
16. **Comment threads.** Proposal: a comment thread is a board-native item, pinned to a block or a
    story. Humans only. It is in the JSON export.
