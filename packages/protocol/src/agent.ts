import { z } from 'zod';

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
});

export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const AgentRunRequestSchema = z.object({
  nodeId: z.string().min(1),
  workspaceId: z.string().min(1),
  prompt: z.string().trim().min(1).max(50_000),
  context: z.object({
    topic: z.string().max(10_000),
    sourceText: z.string().max(50_000).optional(),
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().max(50_000),
    })).max(200).default([]),
  }),
});

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentRunCreatedSchema = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  status: z.literal('queued'),
});

export type AgentRunCreated = z.infer<typeof AgentRunCreatedSchema>;

export const ChangedFileSchema = z.object({
  path: z.string().min(1),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'binary']),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
});

export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const ChangeSetSchema = z.object({
  changeSetId: z.string().min(1),
  runId: z.string().min(1),
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/i),
  files: z.array(ChangedFileSchema),
  diff: z.string(),
  truncated: z.boolean().default(false),
  createdAt: z.number().int().nonnegative(),
});

export type ChangeSet = z.infer<typeof ChangeSetSchema>;

export type AgentRunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'review_ready'
  | 'applying'
  | 'applied'
  | 'rejected'
  | 'conflicted'
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
}

export function statusAfterEvent(type: AgentEventType): AgentRunStatus {
  if (type === 'review_ready') return 'review_ready';
  if (type === 'patch_applied') return 'applied';
  if (type === 'patch_rejected') return 'rejected';
  if (type === 'patch_conflict') return 'conflicted';
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
    || type === 'run_failed'
    || type === 'run_cancelled';
}
