import { z } from 'zod';
import { A2UIBlockEventPayloadSchema, type A2UIBlock } from './a2ui';
export {
  ChangedFileSchema,
  ChangeSetSchema,
  type ChangedFile,
  type ChangeSet,
} from './changes';
import type { ChangeSet } from './changes';

export const AGENT_EVENT_TYPES = [
  'run_started',
  'text_delta',
  'plan_updated',
  'tool_started',
  'command_started',
  'command_output',
  'command_finished',
  'file_changed',
  'file_change_proposed',
  'change_set_created',
  'review_ready',
  'permission_required',
  'permission_resolved',
  'patch_applied',
  'patch_rejected',
  'patch_conflict',
  'change_set_rebased',
  'patch_reverted',
  'undo_conflict',
  'a2ui_block',
  'run_finished',
  'run_failed',
  'run_cancelled',
] as const;

export const AgentEventTypeSchema = z.enum(AGENT_EVENT_TYPES);
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

export const AgentEventSchema = z.object({
  version: z.literal(1),
  eventId: z.string().min(1),
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  type: AgentEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
}).superRefine((event, context) => {
  if (event.type !== 'a2ui_block') return;
  const parsed = A2UIBlockEventPayloadSchema.safeParse(event.payload);
  if (!parsed.success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'a2ui_block events must contain a valid A2UIBlock payload',
      path: ['payload', 'block'],
    });
  }
});

export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const AgentRunRequestSchema = z.object({
  nodeId: z.string().min(1),
  workspaceId: z.string().min(1),
  prompt: z.string().trim().min(1).max(50_000),
  workingDirectory: z.string().max(1_000).optional(),
  agentModelId: z.string().max(300).optional(),
  context: z.object({
    topic: z.string().max(10_000),
    sourceText: z.string().max(50_000).optional(),
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().max(50_000),
    })).max(200).default([]),
    attachments: z.array(z.object({
      name: z.string().min(1).max(260),
      content: z.string().max(250_000),
      mediaType: z.string().max(200).optional(),
    })).max(10).optional(),
    references: z.array(z.object({
      nodeId: z.string().min(1),
      title: z.string().max(1_000),
      content: z.string().max(50_000),
    })).max(20).optional(),
  }),
});

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentRunCreatedSchema = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  status: z.literal('queued'),
});

export type AgentRunCreated = z.infer<typeof AgentRunCreatedSchema>;

export const AgentReviewDecisionSchema = z.object({
  changeSetId: z.string().min(1),
  actionId: z.string().min(1),
});

export type AgentReviewDecision = z.infer<typeof AgentReviewDecisionSchema>;

export type AgentRunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'review_ready'
  | 'applying'
  | 'applied'
  | 'rejected'
  | 'conflicted'
  | 'reverted'
  | 'finished'
  | 'failed'
  | 'cancelled';

export interface AgentRunRecord {
  runId: string;
  status: AgentRunStatus;
  startedAt: number;
  finishedAt?: number;
  events: AgentEvent[];
  changeSet?: ChangeSet;
  blocks?: A2UIBlock[];
}

export function statusAfterEvent(type: AgentEventType): AgentRunStatus {
  if (type === 'review_ready') return 'review_ready';
  if (type === 'patch_applied') return 'applied';
  if (type === 'patch_rejected') return 'rejected';
  if (type === 'patch_conflict') return 'conflicted';
  if (type === 'patch_reverted') return 'reverted';
  if (type === 'undo_conflict') return 'applied';
  if (type === 'change_set_rebased') return 'running';
  if (type === 'run_finished') return 'running';
  if (type === 'run_failed') return 'failed';
  if (type === 'run_cancelled') return 'cancelled';
  return 'running';
}

export function isTerminalAgentEvent(type: AgentEventType): boolean {
  return type === 'review_ready'
    || type === 'patch_applied'
    || type === 'patch_rejected'
    || type === 'patch_conflict'
    || type === 'patch_reverted'
    || type === 'undo_conflict'
    || type === 'run_failed'
    || type === 'run_cancelled';
}
