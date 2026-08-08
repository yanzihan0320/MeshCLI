/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A2UIRenderer } from './A2UIRenderer';
import type { ChecklistBlock, ConfirmationBlock, TaskBoardBlock } from '../../../packages/protocol/src/a2ui';

describe('A2UIRenderer', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('updates a controlled checklist item', () => {
    const onChange = vi.fn();
    const block: ChecklistBlock = {
      version: 1,
      id: 'checklist-1',
      type: 'checklist',
      title: 'Release checklist',
      fallbackText: 'Release checklist',
      items: [{ id: 'item-1', label: 'Run tests', checked: false, disabled: false }],
    };
    act(() => root.render(<A2UIRenderer block={block} onChange={onChange} />));
    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    act(() => input?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({ id: 'item-1', checked: true })],
    }));
  });

  it('returns a bound confirmation action', () => {
    const onAction = vi.fn();
    const block: ConfirmationBlock = {
      version: 1,
      id: 'confirmation-1',
      type: 'confirmation',
      title: 'Apply changes?',
      description: 'Review the patch first.',
      fallbackText: 'Approval required',
      riskLevel: 'medium',
      status: 'pending',
      subject: { kind: 'change_set', runId: 'run-1', actionId: 'review-change-1', changeSetId: 'change-1' },
      actions: [{ id: 'apply', label: 'Apply all', decision: 'approve', variant: 'primary' }],
    };
    act(() => root.render(<A2UIRenderer block={block} onAction={onAction} />));
    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Apply all'));
    act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      blockId: 'confirmation-1',
      decision: 'approve',
      subject: expect.objectContaining({ changeSetId: 'change-1' }),
    }));
  });

  it('moves task-board items through controlled updates', () => {
    const onChange = vi.fn();
    const block: TaskBoardBlock = {
      version: 1,
      id: 'board-1',
      type: 'task_board',
      title: 'Plan',
      fallbackText: 'Plan',
      columns: [
        { id: 'todo', title: 'To do', tasks: [{ id: 'task-1', title: 'Implement', priority: 'high', sourceNodeIds: [], dependencies: [] }] },
        { id: 'done', title: 'Done', tasks: [] },
      ],
    };
    act(() => root.render(<A2UIRenderer block={block} onChange={onChange} />));
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Move Implement right"]');
    act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      columns: [expect.objectContaining({ tasks: [] }), expect.objectContaining({ tasks: [expect.objectContaining({ id: 'task-1' })] })],
    }));
  });

  it('renders accessible fallback text for invalid blocks', () => {
    act(() => root.render(<A2UIRenderer block={{ fallbackText: 'Plain text fallback' }} />));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Plain text fallback');
  });

  it('renders a mind map inside the message renderer', () => {
    act(() => root.render(<A2UIRenderer block={{
      version: 1,
      id: 'map-1',
      type: 'mind_map',
      title: 'Key ideas',
      fallbackText: 'Key ideas',
      layout: 'tree',
      root: {
        id: 'root', label: 'System', kind: 'topic', children: [
          { id: 'branch', label: 'Feedback', kind: 'idea', children: [] },
        ],
      },
    }} />));
    expect(container.textContent).toContain('System');
    expect(container.textContent).toContain('Feedback');
  });
});
