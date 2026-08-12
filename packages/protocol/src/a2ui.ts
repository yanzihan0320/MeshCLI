import { z } from 'zod';
import { ChangeSetSchema, type ChangeSet } from './changes';

export const A2UI_BLOCK_VERSION = 1 as const;

const A2UIBlockBaseSchema = z.object({
  version: z.literal(A2UI_BLOCK_VERSION),
  id: z.string().min(1),
  fallbackText: z.string().min(1),
});

export const ChecklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(500),
  description: z.string().max(2_000).optional(),
  checked: z.boolean().default(false),
  disabled: z.boolean().default(false),
});

export const ChecklistBlockSchema = A2UIBlockBaseSchema.extend({
  type: z.literal('checklist'),
  title: z.string().min(1).max(500),
  items: z.array(ChecklistItemSchema).min(1).max(100),
});

export const ConfirmationSubjectSchema = z.object({
  kind: z.enum(['change_set', 'command', 'tool']),
  runId: z.string().min(1),
  actionId: z.string().min(1),
  changeSetId: z.string().min(1).optional(),
});

export const ConfirmationActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
  decision: z.enum(['approve', 'reject']),
  variant: z.enum(['primary', 'secondary', 'danger']).default('secondary'),
});

export const ConfirmationBlockSchema = A2UIBlockBaseSchema.extend({
  type: z.literal('confirmation'),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(5_000),
  riskLevel: z.enum(['low', 'medium', 'high']),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']).default('pending'),
  subject: ConfirmationSubjectSchema,
  actions: z.array(ConfirmationActionSchema).min(1).max(4),
});

export const DiffReviewBlockSchema = A2UIBlockBaseSchema.extend({
  type: z.literal('diff_review'),
  title: z.string().min(1).max(500),
  status: z.enum(['pending', 'applied', 'rejected', 'conflicted', 'reverted']).default('pending'),
  changeSet: ChangeSetSchema,
});

export const TaskItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().max(2_000).optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  sourceNodeIds: z.array(z.string().min(1)).max(50).default([]),
  dependencies: z.array(z.string().min(1)).max(50).default([]),
});

export const TaskColumnSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  tasks: z.array(TaskItemSchema).max(100),
});

export const TaskBoardBlockSchema = A2UIBlockBaseSchema.extend({
  type: z.literal('task_board'),
  title: z.string().min(1).max(500),
  columns: z.array(TaskColumnSchema).min(1).max(12),
});

export interface MindMapNode {
  id: string;
  label: string;
  description?: string;
  kind: 'topic' | 'idea' | 'fact' | 'risk' | 'decision';
  children: MindMapNode[];
}

export const MindMapNodeSchema: z.ZodType<MindMapNode> = z.lazy(() => z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(300),
  description: z.string().max(1_000).optional(),
  kind: z.enum(['topic', 'idea', 'fact', 'risk', 'decision']),
  children: z.array(MindMapNodeSchema).max(12),
}));

export const MindMapBlockSchema = A2UIBlockBaseSchema.extend({
  type: z.literal('mind_map'),
  title: z.string().min(1).max(500),
  layout: z.enum(['tree', 'radial']).default('tree'),
  root: MindMapNodeSchema,
});

export const ComparisonTableBlockSchema = A2UIBlockBaseSchema.extend({
  type: z.literal('comparison_table'),
  title: z.string().min(1).max(500),
  columns: z.array(z.string().min(1).max(200)).min(2).max(8),
  rows: z.array(z.object({
    id: z.string().min(1),
    cells: z.array(z.string().max(1_000)).min(2).max(8),
    emphasis: z.boolean().default(false),
  })).min(1).max(30),
});

export const ProcessTimelineBlockSchema = A2UIBlockBaseSchema.extend({
  type: z.literal('process_timeline'),
  title: z.string().min(1).max(500),
  steps: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(300),
    detail: z.string().max(1_000).optional(),
    status: z.enum(['pending', 'active', 'complete', 'error']),
  })).min(2).max(12),
});

export const MetricCardsBlockSchema = A2UIBlockBaseSchema.extend({
  type: z.literal('metric_cards'),
  title: z.string().min(1).max(500).optional(),
  metrics: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(200),
    value: z.string().min(1).max(200),
    tone: z.enum(['neutral', 'info', 'success', 'warning', 'danger']).default('neutral'),
  })).min(1).max(8),
});

export const A2UIBlockSchema = z.discriminatedUnion('type', [
  ChecklistBlockSchema,
  ConfirmationBlockSchema,
  DiffReviewBlockSchema,
  TaskBoardBlockSchema,
  MindMapBlockSchema,
  ComparisonTableBlockSchema,
  ProcessTimelineBlockSchema,
  MetricCardsBlockSchema,
]);

export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type ChecklistBlock = z.infer<typeof ChecklistBlockSchema>;
export type ConfirmationAction = z.infer<typeof ConfirmationActionSchema>;
export type ConfirmationBlock = z.infer<typeof ConfirmationBlockSchema>;
export type DiffReviewBlock = z.infer<typeof DiffReviewBlockSchema>;
export type TaskItem = z.infer<typeof TaskItemSchema>;
export type TaskColumn = z.infer<typeof TaskColumnSchema>;
export type TaskBoardBlock = z.infer<typeof TaskBoardBlockSchema>;
export type MindMapBlock = z.infer<typeof MindMapBlockSchema>;
export type ComparisonTableBlock = z.infer<typeof ComparisonTableBlockSchema>;
export type ProcessTimelineBlock = z.infer<typeof ProcessTimelineBlockSchema>;
export type MetricCardsBlock = z.infer<typeof MetricCardsBlockSchema>;
export type A2UIBlock = z.infer<typeof A2UIBlockSchema>;

export const A2UIBlockEventPayloadSchema = z.object({
  block: A2UIBlockSchema,
});

export type A2UIBlockEventPayload = z.infer<typeof A2UIBlockEventPayloadSchema>;

export function createChangeSetReviewBlocks(
  changeSet: ChangeSet,
  status: 'pending' | 'applied' | 'rejected' | 'conflicted' | 'reverted' = 'pending',
): A2UIBlock[] {
  const diffStatus = status;
  const confirmationStatus = status === 'applied'
    ? 'approved'
    : status === 'rejected'
      ? 'rejected'
      : status === 'conflicted'
        ? 'expired'
        : status === 'reverted'
          ? 'expired'
        : 'pending';
  const fileLabel = changeSet.files.length === 1 ? '1 file' : `${changeSet.files.length} files`;

  return A2UIBlockSchema.array().parse([
    {
      version: 1,
      id: `diff-review-${changeSet.changeSetId}`,
      type: 'diff_review',
      title: `Review ${fileLabel}`,
      fallbackText: `${fileLabel} changed in run ${changeSet.runId}.`,
      status: diffStatus,
      changeSet,
    },
    {
      version: 1,
      id: `confirmation-${changeSet.changeSetId}`,
      type: 'confirmation',
      title: 'Apply changes to the real workspace?',
      description: changeSet.files.length
        ? `The Agent changed ${fileLabel} in an isolated workspace. Review the diff before allowing the Gateway to modify the real project.`
        : 'The Agent completed without file changes. Resolve this review to finish the run.',
      fallbackText: `Approve or reject change set ${changeSet.changeSetId}.`,
      riskLevel: changeSet.files.some((file) => file.status === 'deleted') ? 'high' : 'medium',
      status: confirmationStatus,
      subject: {
        kind: 'change_set',
        runId: changeSet.runId,
        actionId: `review-${changeSet.changeSetId}`,
        changeSetId: changeSet.changeSetId,
      },
      actions: [
        { id: 'reject', label: 'Reject all', decision: 'reject', variant: 'secondary' },
        { id: 'apply', label: 'Apply all', decision: 'approve', variant: 'primary' },
      ],
    },
  ]);
}
