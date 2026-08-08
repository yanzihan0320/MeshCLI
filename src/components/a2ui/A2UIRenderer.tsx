import type { ReactNode } from 'react';
import {
  A2UIBlockSchema,
  type A2UIBlock,
  type ChecklistBlock as ChecklistBlockData,
  type ConfirmationBlock as ConfirmationBlockData,
  type DiffReviewBlock as DiffReviewBlockData,
  type ComparisonTableBlock as ComparisonTableBlockData,
  type MetricCardsBlock as MetricCardsBlockData,
  type MindMapBlock as MindMapBlockData,
  type ProcessTimelineBlock as ProcessTimelineBlockData,
  type TaskBoardBlock as TaskBoardBlockData,
} from '../../../packages/protocol/src/a2ui';
import { ChecklistBlock } from './ChecklistBlock';
import { ConfirmationBlock, type A2UIConfirmationAction } from './ConfirmationBlock';
import { DiffReviewBlock } from './DiffReviewBlock';
import { TaskBoardBlock } from './TaskBoardBlock';
import { ComparisonTableBlock } from './ComparisonTableBlock';
import { MetricCardsBlock } from './MetricCardsBlock';
import { MindMapBlock } from './MindMapBlock';
import { ProcessTimelineBlock } from './ProcessTimelineBlock';

interface RendererContext {
  busy: boolean;
  onAction?: (action: A2UIConfirmationAction) => void;
  onChange?: (block: A2UIBlock) => void;
}

type BlockRenderer = (block: A2UIBlock, context: RendererContext) => ReactNode;

const a2uiRendererRegistry: Record<A2UIBlock['type'], BlockRenderer> = {
  checklist: (block, context) => (
    <ChecklistBlock
      block={block as ChecklistBlockData}
      onChange={(updated) => context.onChange?.(updated)}
    />
  ),
  confirmation: (block, context) => (
    <ConfirmationBlock
      block={block as ConfirmationBlockData}
      busy={context.busy}
      onAction={context.onAction}
    />
  ),
  diff_review: (block) => <DiffReviewBlock block={block as DiffReviewBlockData} />,
  task_board: (block, context) => (
    <TaskBoardBlock
      block={block as TaskBoardBlockData}
      onChange={(updated) => context.onChange?.(updated)}
    />
  ),
  mind_map: (block) => <MindMapBlock block={block as MindMapBlockData} />,
  comparison_table: (block) => <ComparisonTableBlock block={block as ComparisonTableBlockData} />,
  process_timeline: (block) => <ProcessTimelineBlock block={block as ProcessTimelineBlockData} />,
  metric_cards: (block) => <MetricCardsBlock block={block as MetricCardsBlockData} />,
};

interface A2UIRendererProps {
  block: unknown;
  busy?: boolean;
  onAction?: (action: A2UIConfirmationAction) => void;
  onChange?: (block: A2UIBlock) => void;
}

export function A2UIRenderer({ block, busy = false, onAction, onChange }: A2UIRendererProps) {
  const parsed = A2UIBlockSchema.safeParse(block);
  if (!parsed.success) {
    const fallbackText = typeof block === 'object' && block !== null && 'fallbackText' in block
      ? String(block.fallbackText)
      : 'This interactive result could not be displayed.';
    return (
      <div role="status" className="rounded-lg border border-dashed border-border bg-surface-900 px-3 py-2 text-[11px] text-text-muted">
        {fallbackText}
      </div>
    );
  }

  return a2uiRendererRegistry[parsed.data.type](parsed.data, { busy, onAction, onChange });
}
