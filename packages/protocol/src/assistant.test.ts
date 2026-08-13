import { describe, expect, it } from 'vitest';
import { CanvasCommandResultSchema, CanvasCommandSchema, CanvasSnapshotSchema } from './assistant';

const base = {
  version: 1 as const,
  actionId: 'action-1',
  workspaceId: 'workspace-1',
  expectedRevision: 2,
};

describe('Canvas assistant protocol', () => {
  it.each([
    ['read_canvas', 'read', {}],
    ['search_nodes', 'read', { query: 'auth' }],
    ['focus_node', 'read', { nodeId: 'n1' }],
    ['create_node', 'write', { topic: 'Direction' }],
    ['create_nodes', 'write', { nodes: [{ topic: 'Direction A' }, { topic: 'Direction B' }] }],
    ['create_branch', 'write', { parentNodeId: 'n1', topic: 'Branch' }],
    ['merge_nodes', 'write', { nodeIds: ['n1', 'n2'], topic: 'Merge', mergeAction: 'synthesize' }],
    ['append_message', 'write', { nodeId: 'n1', role: 'assistant', content: 'evidence' }],
    ['update_node', 'write', { nodeId: 'n1', collapsed: true }],
    ['connect_nodes', 'write', { source: 'n1', target: 'n2' }],
    ['delete_node', 'destructive', { nodeId: 'n1' }],
  ])('validates %s', (type, risk, payload) => {
    expect(CanvasCommandSchema.safeParse({ ...base, type, risk, payload }).success).toBe(true);
  });

  it('rejects unknown commands, invalid payloads, and incorrect risk', () => {
    expect(CanvasCommandSchema.safeParse({ ...base, type: 'move_everything', risk: 'write', payload: {} }).success).toBe(false);
    expect(CanvasCommandSchema.safeParse({ ...base, type: 'merge_nodes', risk: 'write', payload: { nodeIds: ['n1'] } }).success).toBe(false);
    expect(CanvasCommandSchema.safeParse({ ...base, type: 'create_nodes', risk: 'write', payload: { nodes: [] } }).success).toBe(false);
    expect(CanvasCommandSchema.safeParse({ ...base, type: 'delete_node', risk: 'write', payload: { nodeId: 'n1' } }).success).toBe(false);
  });

  it('validates workspace snapshots and action results', () => {
    expect(CanvasSnapshotSchema.safeParse({ version: 1, workspaceId: 'w', revision: 0, nodes: [], edges: [] }).success).toBe(true);
    expect(CanvasSnapshotSchema.safeParse({ version: 1, workspaceId: 'w', revision: -1, nodes: [], edges: [] }).success).toBe(false);
    expect(CanvasCommandResultSchema.safeParse({
      version: 1, actionId: 'a', workspaceId: 'w', status: 'stale', revision: 2,
      message: 'revision changed', affectedNodeIds: [], affectedEdgeIds: [],
    }).success).toBe(true);
  });
});
