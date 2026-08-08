import { describe, expect, it } from 'vitest';
import { formatAgentPrompt, planTaskBoard } from './openHandsAdapter';

describe('planTaskBoard', () => {
  it('maps agent plan statuses into To do, Doing, and Done columns', () => {
    const board = planTaskBoard('run-1', [
      { id: 'one', title: 'Inspect', status: 'pending' },
      { id: 'two', title: 'Implement', status: 'in_progress' },
      { id: 'three', title: 'Verify', status: 'completed' },
    ]);
    expect(board?.type).toBe('task_board');
    expect(board?.columns.map((column) => [column.title, column.tasks.map((task) => task.title)])).toEqual([
      ['To do', ['Inspect']],
      ['Doing', ['Implement']],
      ['Done', ['Verify']],
    ]);
  });
});

describe('formatAgentPrompt', () => {
  it('adds user text attachments as reference context', () => {
    const prompt = formatAgentPrompt({
      nodeId: 'node-1', workspaceId: 'workspace-1', prompt: 'Review this design',
      context: {
        topic: 'Design', messages: [],
        attachments: [{ name: 'notes.md', content: '# Notes\nImportant', mediaType: 'text/markdown' }],
      },
    });
    expect(prompt).toContain('Attached reference: notes.md');
    expect(prompt).toContain('# Notes\nImportant');
  });
});
