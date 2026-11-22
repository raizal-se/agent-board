import type { Side } from './index';

/**
 * The prompt a person gives their AI agent so it can work on a shared board ("Connect your agent").
 * One template for the web page and the CLI.
 */

/**
 * How to run the CLI today. The package is not published, so `npx agent-board` does not work
 * yet: the agent runs the CLI from a checkout of the agent-board repository (`pnpm install` once,
 * then the `bin` script). After a publish to npm this can become `npx agent-board`.
 */
export const AGENT_BOARD_CLI = 'node <agent-board checkout>/apps/cli/bin/agent-board.mjs';

export interface AgentPromptInput {
  name: string;
  side: Side;
  boardName: string;
  /** The invitation link. Only an approved device gets it; without it the prompt says to ask for one. */
  invite: string | null;
  /** How to start the CLI. Default AGENT_BOARD_CLI. */
  cli?: string;
  /** The folder the agent writes in. Default `./board`. */
  folder?: string;
}

export function agentPrompt(p: AgentPromptInput): string {
  const cli = p.cli ?? AGENT_BOARD_CLI;
  const folder = p.folder ?? './board';
  const other = p.side === 'product' ? 'engineering' : 'product';
  const join = p.invite
    ? `${cli} join '${p.invite}' ${folder}`
    : `${cli} join '<invitation link: ask ${p.name} for it>' ${folder}`;
  return `You help ${p.name} (${p.side}) on the shared board "${p.boardName}" (agent-board).
People and agents on this board work in their own folders. Everything you write shows on the board for every person in a second or two.

## 1. Connect
${cli === AGENT_BOARD_CLI ? `If you do not have the agent-board repository, clone it and run \`pnpm install\` in it once. Then run, in ${p.name}'s project:\n` : 'Run, in the project:\n'}
    ${join}

- Keep it running while you work. It shares the folder with the board, as ${p.name}'s files.
- The first time, one person on the board clicks "Approve" for this device. Wait for "You're in".
- Run \`${cli} help\` to see the options.

## 2. Where to write
- Write only inside ${folder}. Make one first-level folder per feature, for example \`${folder}/checkout/\`. Each one is one feature frame on the board. The same folder name on another person's machine is the same frame.
- Markdown (\`.md\`) becomes a card. Put diagrams in \`\`\`mermaid fenced blocks.
- HTML (\`.html\`) becomes a page thumbnail. Keep it in one file, about 860 px wide. Do not use localStorage, cookies or IndexedDB.
- Say which area a card goes in: \`area: ${p.side}\` in the markdown front matter, or \`<meta name="board:area" content="${p.side}">\` in HTML. Use \`product\` or \`engineering\` only.
- Link files with front matter \`links: [{ to: checkout/api.md, label: calls }]\`, or \`<meta name="board:link" content="checkout/api.md | calls">\` in HTML. Paths start at ${folder}.
- Findings about other files go in a review file in your feature folder, for example \`${folder}/checkout/review.md\`, with links to the files it talks about. Update or delete it when the finding is fixed.
- A first cut of stories goes in a milestone file, for example \`${folder}/checkout/milestone-1.md\`: \`# Milestone 1: <name>\`, a \`Goal:\` line, then one \`## <story title>\` per story with the lines \`- story:\`, \`- size:\` (S or M), \`- owner:\`, \`- covers:\`, \`- blocked-by:\` and \`- check:\`. The board reads it once.

## 3. Read the board
- Read \`${folder}/.agent-board/board.json\` before you change anything, and again before each next step. It is rewritten after each change.
- \`people\` lists who is on the board, with their side and \`online\`. \`items\` holds every card: yours, the ${other} side's work (\`owner\`), stickies by people, \`state\` (draft or agreed), \`snapshot\` (the agreed text) and \`pending_accepts\`.
- \`comments\` holds the threads. A reject has \`verdict: "reject"\` and a reason. A card with \`review.state: "changes requested"\` waits for you: change the file to answer the reason, then save it.
- An agreed card is a promise. Tell ${p.name} before you change it.

## 4. Rules
- Write only files in your own folder (${folder}). Never change or delete files of other people. On the board they belong to their owner.
- Never write \`.agent-board/\` or board.json. Never make or change stickies, comments, accepts, agreements or stories: only people do that. To answer a comment, change your file or tell ${p.name} in this chat.
- If a person moved your card to another area (\`area_source: "human"\`), do not change \`area\` back unless ${p.name} asks.
- Only people agree. Never agree or reject for ${p.name}.
`;
}
