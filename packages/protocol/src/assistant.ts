import { z } from 'zod';

export const CanvasNodeSnapshotSchema = z.object({
  id: z.string().min(1),
  topic: z.string().max(10_000),
  position: z.object({ x: z.number(), y: z.number() }),
  selected: z.boolean().default(false),
  parentNodeId: z.string().optional(),
  parentNodeIds: z.array(z.string()).optional(),
  label: z.string().optional(),
  color: z.string().optional(),
  collapsed: z.boolean().default(false),
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(50_000),
    timestamp: z.number(),
  })).max(200).default([]),
});

export const CanvasSnapshotSchema = z.object({
  version: z.literal(1),
  workspaceId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  activeNodeId: z.string().optional(),
  selectedNodeIds: z.array(z.string()).default([]),
  nodes: z.array(CanvasNodeSnapshotSchema).max(1_000),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),
  })).max(5_000),
});

export type CanvasSnapshot = z.infer<typeof CanvasSnapshotSchema>;

const CommandBaseSchema = z.object({
  version: z.literal(1),
  actionId: z.string().min(1),
  workspaceId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  risk: z.enum(['read', 'write', 'destructive']),
});

const command = <TType extends string, T extends z.ZodRawShape>(type: TType, payload: z.ZodObject<T>) =>
  CommandBaseSchema.extend({ type: z.literal(type), payload });

export const CanvasCommandSchema = z.discriminatedUnion('type', [
  command('read_canvas', z.object({})),
  command('search_nodes', z.object({ query: z.string().min(1).max(1_000) })),
  command('focus_node', z.object({ nodeId: z.string().min(1) })),
  command('create_node', z.object({
    topic: z.string().min(1).max(10_000),
    assistantMessage: z.string().max(50_000).optional(),
    label: z.string().max(1_000).optional(),
    color: z.string().max(100).optional(),
  })),
  command('create_nodes', z.object({
    nodes: z.array(z.object({
      topic: z.string().min(1).max(10_000),
      assistantMessage: z.string().max(50_000).optional(),
      label: z.string().max(1_000).optional(),
      color: z.string().max(100).optional(),
    })).min(1).max(20),
  })),
  command('create_branch', z.object({
    parentNodeId: z.string().min(1),
    topic: z.string().min(1).max(10_000),
    branchText: z.string().max(10_000).optional(),
    prompt: z.string().max(50_000).optional(),
    assistantMessage: z.string().max(50_000).optional(),
  })),
  command('merge_nodes', z.object({
    nodeIds: z.array(z.string().min(1)).min(2).max(20),
    topic: z.string().min(1).max(10_000),
    mergeAction: z.string().min(1).max(10_000),
    assistantSummary: z.string().max(50_000).optional(),
  })),
  command('append_message', z.object({
    nodeId: z.string().min(1),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1).max(50_000),
    triggeredBy: z.string().optional(),
  })),
  command('update_node', z.object({
    nodeId: z.string().min(1),
    topic: z.string().min(1).max(10_000).optional(),
    label: z.string().max(1_000).nullable().optional(),
    color: z.string().max(100).nullable().optional(),
    collapsed: z.boolean().optional(),
  })),
  command('connect_nodes', z.object({
    source: z.string().min(1),
    target: z.string().min(1),
    label: z.string().max(1_000).default('related'),
  })),
  command('delete_node', z.object({ nodeId: z.string().min(1) })),
]).superRefine((value, context) => {
  const expectedRisk = value.type === 'delete_node'
    ? 'destructive'
    : ['read_canvas', 'search_nodes', 'focus_node'].includes(value.type)
      ? 'read'
      : 'write';
  if (value.risk !== expectedRisk) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['risk'], message: `${value.type} must use ${expectedRisk} risk.` });
  }
});

export type CanvasCommand = z.infer<typeof CanvasCommandSchema>;

export const CanvasCommandResultSchema = z.object({
  version: z.literal(1),
  actionId: z.string().min(1),
  workspaceId: z.string().min(1),
  status: z.enum(['applied', 'approved', 'rejected', 'stale', 'failed']),
  revision: z.number().int().nonnegative(),
  message: z.string().max(50_000),
  affectedNodeIds: z.array(z.string()).default([]),
  affectedEdgeIds: z.array(z.string()).default([]),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type CanvasCommandResult = z.infer<typeof CanvasCommandResultSchema>;

export const AssistantTurnRequestSchema = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().uuid(),
  message: z.string().trim().min(1).max(50_000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(50_000),
  })).max(200).default([]),
  canvas: CanvasSnapshotSchema,
});

export const AssistantActionResolveSchema = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().uuid(),
  result: CanvasCommandResultSchema,
  canvas: CanvasSnapshotSchema,
});

export const WorkspaceAssistantEventSchema = z.object({
  version: z.literal(1),
  eventId: z.string().min(1),
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  type: z.enum([
    'turn_started', 'text_delta', 'skill_activated', 'tool_started', 'tool_finished',
    'mcp_started', 'mcp_finished', 'mcp_failed', 'canvas_command',
    'permission_required', 'action_resolved', 'turn_finished', 'turn_failed',
  ]),
  payload: z.record(z.string(), z.unknown()),
});

export type WorkspaceAssistantEvent = z.infer<typeof WorkspaceAssistantEventSchema>;
