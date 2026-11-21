# Review of the v1 screens

Date: 2026-11-20.
Input: the mockups in `docs/screens/round-1/screens/` (six screens) and the spec of 2026-11-20 (a copy is in that folder as `design.md`).
Status: part 1 is the first review (2026-11-20). Part 2 is the second review (2026-11-22), after the
spec update of 2026-11-21. Each finding in part 1 now has a status line.

# Part 1: first review

## Verdict

The screens are strong and faithful to the spec. They show every v1 item in section 12, and the
messy but readable look fits the meeting. They also expose gaps in the spec that need a decision
before the build.

**What works well:**

- **Main board:** the four soft zones, live cursors, the "agent is writing" line and the "3 of 4
  linked" badge make it easy to see who does what.
- **Join:** the flow matches the spec step by step. The warning "only send it if you know this is
  Rina" is the right nudge.
- **Network panel:** the "We can't reach Mei Ling" message is honest and says what to do.
- **Slices:** "Tan edited, accepts reset", the L flag and the "Push 2 to Linear" bar make the
  approval rules visible without extra text.

## Findings, by impact

Each finding names the screen, the problem and a proposed change to the spec.

### 1. Agreement makes a copy, not a move

**Status: partly done.** Zone is now a state (3.1), but section 6 still says agreed blocks "move". The screens keep the live block and add a snapshot card.


- **Screens:** Main, Block.
- **Problem:** the spec (section 6) says agreed blocks move to the agreed zone. The screens keep the
  live block in its owner's zone and put a snapshot card in the agreed zone, joined by a "snapshot"
  edge. The screens' model is better: the live block keeps streaming, and the agreed version stays
  fixed.
- **Proposal:**
  - Agreeing makes a frozen snapshot card in the agreed zone. The live block stays where it is.
  - If the owner's file changes, the snapshot card shows "changed after agreement". The change never
    overwrites the snapshot.
  - The block view has a Compare tab: snapshot and current file side by side, with changed lines
    marked.

### 2. Snapshot scope conflicts

**Status: done.** Snapshots are v1 (sections 6 and 12).


- **Screens:** Main, Block.
- **Problem:** section 6 makes frozen snapshots part of agreement, which reads as v1. Section 12
  lists "frozen snapshots" under v2.
- **Proposal:** the agreed snapshot and the Compare tab are v1, because agreement means little
  without them. Only the full history view of a block stays in v2.

### 3. Partial links need a rule

**Status: partly done.** The spike has the three-peer test (point 4). The forwarding rule is open point 15, and the settings screen still says "no link".


- **Screen:** Settings.
- **Problem:** the network panel says Mei Ling "still syncs with anyone she can reach". That only
  helps the others if peers forward the updates they get. The spec does not say.
- **Proposal:**
  - Each peer forwards each update it gets to every other peer it can reach. If A cannot reach C,
    but both reach B, A's changes get to C through B.
  - Updates are encrypted with the room secret, so a forwarding peer adds no new risk.
  - The panel shows such a peer as "synced through B", not "no link".
  - Add a sixth point to the spike: with three peers where A cannot reach C, a change from A reaches
    C through B.

### 4. Nowhere to connect Linear

**Status: open.** Open point 12.


- **Screen:** Slices, Settings.
- **Problem:** the screens show a push and a refresh, but no place to enter a Linear key or pick a
  team.
- **Proposal:**
  - Add "Connect Linear" to the board settings. A person pastes their own Linear API key, and it
    stays on that device only. It never goes into the board document.
  - The Linear team and project are board state, so every member pushes to the same place.
  - If a person has not connected Linear, the push bar asks them to connect first.

### 5. Several members can answer one join request

**Status: open.** Open point 14.


- **Screen:** Join.
- **Problem:** every online member's page shows the request and a code. Two members can send two
  different codes.
- **Proposal:**
  - When one member opens the request, the other pages show "Dewi is handling this". Only that
    member's page shows a code.
  - A code expires after one wrong attempt or after 5 minutes. The guest then asks again.

### 6. "Agree again" has no rule

**Status: done.** Section 6.


- **Screen:** Block.
- **Problem:** the screen shows "Keep snapshot" and "Agree again", but the spec does not say who can
  click them.
- **Proposal:**
  - "Agree again" replaces the snapshot with the current file. It needs one product accept and one
    engineering accept, the same rule as for slices.
  - "Keep snapshot" hides the warning until the file changes again. Anyone can click it, and the
    agreement does not change.

### 7. Slice rules are unclear

**Status: partly done.** Section 5.6 says which edits reset accepts. "Owner and check are required" is open point 11.


- **Screen:** Slices.
- **Problem:** some approved cards show no owner. The spec says "an edit resets both accepts", but
  not which edits.
- **Proposal:**
  - Nobody can accept a slice that has no owner or no acceptance check.
  - An edit to the title, the check, the covered blocks or the size resets both accepts.
  - A move, a change of owner, a comment or a Linear status change does not reset them.
  - A compact slice card always shows the size, the owner and the accept state.

### 8. The phase switcher is not in the spec

**Status: open.** Open point 13.


- **Screens:** Main, Slices.
- **Problem:** the header has a "Converge / Slice" control. The spec has no phase setting.
- **Proposal:** make the phase a label on each feature frame (diverge, converge or slice), because
  two features can be in different phases. The label does not lock or hide anything.

### 9. Zone by position or by state

**Status: done.** Section 3.1.


- **Screens:** Main.
- **Problem:** the spec does not say whether an item's zone comes from where it sits or from a stored
  value.
- **Proposal:** zone is a stored state. A drag does not change it. A new item gets its zone from
  where it was made, for example its owner's side.

### 10. Comment threads are not in the spec

**Status: open.** Section 8 says agents never write comments, but comments are not defined. Open point 16.


- **Screens:** Main, Block.
- **Problem:** the screens use comment pins with a count and a thread. The spec only has sticky
  notes.
- **Proposal:** add the comment thread as a board-native item. It is pinned to a block or card, and
  each comment shows its author. Add comments to the JSON export for agents.

## Missing states

The screens do not show these states. Each one needs a screen or a clear message.

- **Empty board:** the first person opens a new board. Show how to invite people and start the CLI.
- **First join:** a guest is approved for the first time. Show where things are.
- **Only you online:** the board works from the local copy. Show that nobody else is linked.
- **Owner's CLI offline:** a file block shows the last version it got, with "owner offline" and the
  time of the last update.
- **Gone file:** the block is hidden with a small marker. Today only the CLI log shows it.
- **Renamed file:** the block keeps its place, edges and comments, and shows the new name.
- **Broken mermaid:** the block shows the raw text and the parse error, not a blank space. Agents
  often write broken mermaid.
- **Broken HTML:** the iframe fails or shows nothing. The block says so.
- **Linear push failed:** the card keeps its approved state, shows the error and offers a retry.
- **Join request expired or denied:** the guest sees why and how to ask again.

## Small notes on the screens

- Cursor labels cover card text, for example on the "Retry" card and on `db-schema.md`.
- The Compare tab shows a changed line as one removed and one added line. Mark it as one changed
  line.
- The CLI screen uses `npx agent-board` in one step and plain `agent-board` in the next. Use one form.

# Part 2: second review

Date: 2026-11-22.
Input: `docs/screens/agent-board-v1-screens.html` (eight artboards) and `docs/design.md` (updated
2026-11-21).

## Verdict

The story map now reads like the board, not like a backlog. Each story shows a UI preview and an
engineering preview side by side, so a person understands it in a few seconds. The new rules
"layout is free, meaning is in the fields", "agents only write files" and "no order, only blocked by"
are strong, and they make the board readable for agents.

## Screens that do not match the spec

1. **Story 2 previews a change that nobody agreed.** Its engineering half shows `last_error`. Screen 2
   shows that `last_error` came after the agreement. The story is still "approved · ready to push".
   See open point 7.
2. **The settings screen is out of date.** It says Mei Ling's changes do not sync with you. With
   forwarding, they reach you through Tan. See open point 15.
3. **No place to connect Linear.** See open point 12.
4. **The phase switcher** (`Converge ▾`, `Plan ▾`) is still not in the spec. See open point 13.
5. **Compact story chips.** The main board shows small story chips. Section 5.3 only describes the
   full story block. Add the compact form for a far zoom.
6. **The CLI screen** mixes `npx agent-board` and `agent-board`, and it says "in history" where the
   spec says "list of hidden blocks".

## Gaps in the spec

7. **The milestone file is both a file block and an import.** See open point 8.
8. **Several covered files on one side.** Story 4 merges `webhooks.md` and `db-schema.md` in one
   preview. See open point 9.
9. **A split L story has no end state.** See open point 10.
10. **A story with no owner can collect accepts** (Story 4). See open point 11.
11. **Two members can answer one join request.** See open point 14.
12. **Draft story 2 covers `card-form.html`** in screen 3c, but `card-form-error.html` in screen 3. The
    milestone file in 3c also uses short names (`card-form, sequence`). The spec example uses full
    file names. Agents copy the example, so keep the screens and the example the same.

## Small notes

- The push bar says "2 approved", but Story 1 is already pushed. The button should say "Push 1 to
  Linear".
- The "blocks" label between Story 1 and Story 2 is cut off ("ocks").
- "3 agents active" can only come from file writes. Live agent presence is "Later". Use "3 agents
  writing".
