import { describe, expect, it } from 'vitest';
import { agentPrompt, AGENT_BOARD_CLI } from './agent-prompt';

describe('the agent prompt', () => {
  const invite = 'https://board.example/#board-0001.c2VjcmV0c2VjcmV0c2VjcmV0.AAAA';

  it('holds who the person is, the board, the join command with the invite, and the rules', () => {
    const text = agentPrompt({ name: 'Dewi', side: 'product', boardName: 'checkout', invite });
    expect(text).toContain('Dewi (product)');
    expect(text).toContain('"checkout"');
    expect(text).toContain(`${AGENT_BOARD_CLI} join '${invite}' ./board`);
    expect(text).toContain('area: product');
    expect(text).toContain('mermaid');
    expect(text).toContain('review.md');
    expect(text).toContain('milestone-1.md');
    expect(text).toContain('.agent-board/board.json');
    expect(text).toContain('Write only files in your own folder');
    expect(text).toContain('Never make or change stickies, comments, accepts');
    expect(text).toContain('do not change `area` back');
    expect(text).toContain('changes requested');
  });

  it('without an invite it says to ask for one', () => {
    const text = agentPrompt({ name: 'Tan', side: 'engineering', boardName: 'b', invite: null, cli: 'agent-board', folder: './work' });
    expect(text).toContain("agent-board join '<invitation link: ask Tan for it>' ./work");
    expect(text).not.toContain('clone it');
    expect(text).toContain('area: engineering');
  });
});
