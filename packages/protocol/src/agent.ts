import { z } from 'zod';

export const AGENT_EVENT_TYPES = [
  'run_started',
  'text_delta',
  'plan_updated',
  'tool_started',
  'command_output',
  'file_change_proposed',
  'permission_required',
  'permission_resolved',
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

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'finished'
  | 'failed'
  | 'cancelled';

export interface AgentRunRecord {
  runId: string;
  status: AgentRunStatus;
  startedAt: number;
  finishedAt?: number;
  events: AgentEvent[];
}

export function statusAfterEvent(type: AgentEventType): AgentRunStatus {
  if (type === 'run_finished') return 'finished';
  if (type === 'run_failed') return 'failed';
  if (type === 'run_cancelled') return 'cancelled';
  return 'running';
}

export function isTerminalAgentEvent(type: AgentEventType): boolean {
  return type === 'run_finished' || type === 'run_failed' || type === 'run_cancelled';
}
