# agent-board: design

Status: agreed in a grilling session on 2026-11-20. Nothing is built yet.
"agent-board" is a working name.

## 1. What it is

A live meeting board for a product team and an engineering team. Each person works with their
own AI agents. The agents write artifacts (markdown docs, mermaid diagrams, HTML mockups) as files
in the person's repo. The board streams those files into blocks on one shared canvas.

The board supports one process, in three phases:

1. **Diverge.** Product brings the feature design. Engineering brings the system design. Each
   side made theirs with their own agents before the meeting.
2. **Converge.** Both sides meet in the middle, talk, adjust and agree on one concept.
3. **Slice.** An agent proposes a first cut of slices. The team edits and approves them together
   in a planning session (a modern grooming). Approved slices go to Linear.

The board is chaotic on purpose. The zones, the decisions and the slices give it structure.

## 2. Users

- A small, trusted team: 2 to 6 people on one board.
- Product people and engineers. Each person has a side, product or engineering.
- Team members are in Indonesia and Singapore. There is no shared VPN yet.
- This is an internal company tool.

## 3. The board

- **One board for each project.**
- **Feature frames.** A feature is a frame on the board, like a Miro frame. People work inside it.
- **Four zones in each feature frame:** product, engineering, agreed, slices.
- **Loose notes.** Sticky notes can also sit outside any frame.
- **Edges.** Plain arrows with an optional label, between any two blocks.
- **No links between features in v1.** A block can name another feature in text, but it gets no
  live edge.

## 4. Blocks

### 4.1 File blocks

File blocks show content that an agent wrote. Only the owner's agent changes the content, in the
owner's repo. Everyone can move, link and comment on a file block.

| Type | Source | Renderer |
|---|---|---|
| Markdown | `.md` file | Markdown renderer. Mermaid code fences render with [Pele](https://pele.run/) (MIT, from Obsidian). |
| HTML | `.html` file | Sandboxed iframe. Scripts and CDN links work. The page has no access to the board, cookies or other blocks. |

HTML designs are throwaway. The team rebuilds them later as Next.js and React code.

**How a file becomes a block:**

- Each person runs the CLI and shares one folder, for example `board/`.
- A subfolder picks the feature frame: `board/checkout/api.md` lands in the "checkout" frame. If the
  frame does not exist, the board makes it.
- The block lands in the owner's side zone, in the next free spot.
- The x and y position lives only in the board, never in the file. Files stay clean.
- Each save streams to the board. A dot on the block shows that its file is changing.
- **A deleted file** marks its block as gone and hides it. Its edges and comments stay. Anyone can
  open it from the history.
- **A renamed file** keeps the same block if the CLI detects the rename.

### 4.2 Board-native items

People make these on the board. Anyone can edit them.

- **Sticky note:** free text.
- **Decision block:** a short note with the decision, the blocks it covers and who agreed.
- **Slice card:** see section 5.

## 5. Slices

A slice is one story or task. It must be small enough to build, test and merge fast.

**Fields on a slice card:**

- title
- reason (why this slice)
- links to the agreed blocks it covers
- one acceptance check (how we know it works)
- owner
- size: S or M. The board flags an L slice as "slice again".

**The first cut comes from an agent.** The agent reads the JSON export of the board and writes a
markdown file in its owner's folder. The CLI turns each entry into a draft slice card. From then on,
the cards are board-native and the team owns them.

```markdown
## Checkout API: add payment intent
- size: S
- owner:
- covers: api-doc, payment-sequence
- check: a POST to /intents returns 201 with an intent ID

Why: the frontend needs an intent before it shows the card form.
```

Each `##` heading is one slice. The fields under it are fixed.

**Approval:**

- A slice is approved when one product person and one engineer accept it.
- Each accept shows the person's name on the card.
- An edit to an approved slice resets both accepts.
- Only approved slices can go to Linear.

**Linear:**

- Any team member can volunteer to push approved slices to Linear, with their own Linear access.
- The board records the Linear issue ID on the card, so nobody pushes it twice.
- The push is one way. Anyone can click "refresh" to pull the newest status onto the cards.
  Linear owns the status.

## 6. Agreement

- Both sides agree in the meeting, and someone writes a decision block.
- The agreed blocks move to the agreed zone and get a frozen snapshot.
- If the owner's file changes after the agreement, the block shows "changed after agreement". The
  change does not overwrite the snapshot silently.

## 7. People and presence

- Live cursors with names.
- A list of who is online.
- A dot on a block while its file changes.
- Each person has a name and a side, set once in the CLI setup.

## 8. Agents

- Each owner prompts their own agent during the meeting. The board shows the result. No shared
  agent sits on the board in v1.
- Agents read the board through a JSON export: blocks, edges, frames, zones, decisions and slices.
- Agents never write to the board directly. They write files, and the CLI streams them.
- A live read API for agents comes later.

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
- **Imports the slice markdown file** as draft slice cards.
- **Exports the board as JSON** for agents.

## 11. Stack

- **Canvas:** [xyflow / React Flow](https://reactflow.dev) (MIT). Blocks, cards, frames and labeled
  edges are custom nodes and edges.
- **Sync:** Yjs. React Flow's own multiplayer guide shows how to sync nodes and edges with Yjs. Its
  official example uses a WebSocket server, so the WebRTC wiring is our own work.
- **Mermaid:** Pele.
- **Peer discovery:** Trystero.

**Why not the others:**

- **tldraw** has the best canvas, but production use needs a paid license key, and its sync uses a
  server.
- **Excalidraw** is MIT and has native sketching and the best mermaid converter. But markdown and
  card blocks need a custom embed renderer, which is untested, and its Yjs binding is immature.
- **AFFiNE / BlockSuite** is too heavy to extract.
- **No open-source project** covers most of this design. These projects are worth reading:
  - [doop](https://github.com/kgoedecke/doop) (AGPL): sandboxed HTML frames, per-frame history, MCP tools.
  - [Noteriv](https://github.com/thejacedev/Noteriv) (MIT): Yjs over WebRTC with markdown and mermaid.

## 12. Scope

### v1

- The one-day spike (section 13).
- The CLI: setup, join, the folder watch, the slice import and the JSON export.
- Joining with a Slack link and a code. The list of approved devices.
- A canvas with feature frames, four zones, labeled edges, cursors and the online list.
- Markdown blocks with Pele, and sandboxed HTML blocks.
- Sticky notes, decision blocks and slice cards.
- Slice approval, the push to Linear and the refresh from Linear.

### v2

- A sketch layer: boxes, arrows and text that anyone can edit.
- Sketch to mermaid: an agent reads the sketch from the JSON export and writes a mermaid diagram
  into its owner's markdown file.
- Mermaid to editable shapes: start with flowcharts. The result is a board-native copy, and the
  owner's file does not change. Excalidraw's MIT converter may be reusable as a parser for more
  types (unverified).
- The per-block history view and frozen snapshots.
- An always-on seed peer.

### Later

- Links between features.
- A live read API for agents.
- Figma embed blocks.
- Tailscale or a company VPN for peers whose networks block direct links.

## 13. The one-day spike

The spike must prove these points before the build starts:

1. A markdown block with a mermaid diagram (rendered by Pele) lives inside a frame on xyflow, and it
   updates live when its file changes.
2. A sandboxed HTML block works inside the same frame.
3. Two browsers on different networks (one in Indonesia, one in Singapore) sync one Yjs document
   through Trystero and public STUN.
4. The CLI, on Node, joins the same room through Trystero and streams a file.
5. The join code is bound to the key exchange.

If point 3 or 4 fails, revisit the network section before more work.

## 14. Open facts to check

These came from web research and were not verified at the source.

- Trystero: its current state, and whether it runs in Node for the CLI.
- How often direct WebRTC links fail between the team's real networks.
- Cloudflare Pages: whether the move toward Workers static assets affects a new Pages site.
- Pele: whether it runs offline in the browser.
- Tailscale: the free plan is for non-commercial use, so company use needs a paid plan.
- ngrok: its free terms for company use, if a tunnel is ever needed.
