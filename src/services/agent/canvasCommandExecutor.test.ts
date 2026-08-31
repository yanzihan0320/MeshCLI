import { beforeEach, describe, expect, it } from 'vitest';
import { useAssistantStore } from '../../stores/assistantStore';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import {
  executeCanvasCommand,
  getCanvasUndoHistory,
  retractableCanvasActionIds,
  undoAllCanvasCommands,
  undoCanvasCommand,
} from './canvasCommandExecutor';

const workspaceId = 'executor-workspace';

beforeEach(() => {
  useFlowStore.getState().setNodes([]);
  useFlowStore.getState().setEdges([]);
  useChatStore.getState().setConversations({});
  useAssistantStore.setState({ workspaces: {} });
  useWorkspaceStore.setState({ activeWorkspaceId: workspaceId });
});

describe('CanvasCommandExecutor', () => {
  it('identifies only applied mutating actions from one assistant turn', () => {
    const base = { version: 1 as const, workspaceId, threadId: 'thread-1', timestamp: 1 };
    expect(retractableCanvasActionIds([
      { ...base, eventId: 'e1', type: 'canvas_command', payload: { command: {
        version: 1, actionId: 'write-1', workspaceId, expectedRevision: 0, risk: 'write',
        type: 'create_node', payload: { topic: 'New node' },
      } } },
      { ...base, eventId: 'e2', type: 'action_resolved', payload: { actionId: 'write-1', status: 'applied' } },
      { ...base, eventId: 'e3', type: 'canvas_command', payload: { command: {
        version: 1, actionId: 'read-1', workspaceId, expectedRevision: 1, risk: 'read',
        type: 'read_canvas', payload: {},
      } } },
      { ...base, eventId: 'e4', type: 'action_resolved', payload: { actionId: 'read-1', status: 'applied' } },
      { ...base, eventId: 'e5', type: 'canvas_command', payload: { command: {
        version: 1, actionId: 'write-2', workspaceId, expectedRevision: 1, risk: 'write',
        type: 'create_node', payload: { topic: 'Failed node' },
      } } },
      { ...base, eventId: 'e6', type: 'action_resolved', payload: { actionId: 'write-2', status: 'failed' } },
    ])).toEqual(['write-1']);
  });

  it('creates a node atomically and restores the full transaction on undo', () => {
    const result = executeCanvasCommand({
      version: 1, actionId: 'create-1', workspaceId, expectedRevision: 0, risk: 'write',
      type: 'create_node', payload: { topic: 'Frontend refactor', assistantMessage: 'Evidence' },
    });
    expect(result.status).toBe('applied');
    expect(result.revision).toBe(1);
    expect(useFlowStore.getState().nodes).toHaveLength(1);
    expect(Object.values(useChatStore.getState().conversations)[0]?.messages[0]?.content).toBe('Evidence');
    expect(undoCanvasCommand(workspaceId, 'create-1')).toBe(true);
    expect(useFlowStore.getState().nodes).toHaveLength(0);
    expect(useChatStore.getState().conversations).toEqual({});
  });

  it('rejects a stale command without changing canvas state', () => {
    useAssistantStore.getState().ensureWorkspace(workspaceId);
    useAssistantStore.getState().setRevision(workspaceId, 3);
    const result = executeCanvasCommand({
      version: 1, actionId: 'stale-1', workspaceId, expectedRevision: 2, risk: 'write',
      type: 'create_node', payload: { topic: 'Should not exist' },
    });
    expect(result.status).toBe('stale');
    expect(useFlowStore.getState().nodes).toHaveLength(0);
  });

  it('creates multiple nodes in one revision and undoes the whole batch', () => {
    const applied = executeCanvasCommand({
      version: 1, actionId: 'batch-1', workspaceId, expectedRevision: 0, risk: 'write',
      type: 'create_nodes',
      payload: { nodes: [
        { topic: 'Direction A', assistantMessage: 'A evidence' },
        { topic: 'Direction B', assistantMessage: 'B evidence' },
        { topic: 'Risk A', assistantMessage: 'Risk evidence' },
      ] },
    });
    expect(applied.status).toBe('applied');
    expect(applied.revision).toBe(1);
    expect(applied.affectedNodeIds).toHaveLength(3);
    expect(useFlowStore.getState().nodes).toHaveLength(3);
    expect(undoCanvasCommand(workspaceId, 'batch-1')).toBe(true);
    expect(useFlowStore.getState().nodes).toHaveLength(0);
  });

  it('keeps a multi-level history and can undo every assistant transaction', () => {
    const first = executeCanvasCommand({
      version: 1, actionId: 'history-1', workspaceId, expectedRevision: 0, risk: 'write',
      type: 'create_node', payload: { topic: 'First direction' },
    });
    const second = executeCanvasCommand({
      version: 1, actionId: 'history-2', workspaceId, expectedRevision: 1, risk: 'write',
      type: 'create_nodes', payload: { nodes: [{ topic: 'Second direction' }, { topic: 'Third direction' }] },
    });
    expect(first.status).toBe('applied');
    expect(second.status).toBe('applied');
    expect(getCanvasUndoHistory(workspaceId).map((entry) => entry.actionId)).toEqual(['history-1', 'history-2']);
    expect(useFlowStore.getState().nodes).toHaveLength(3);

    expect(undoAllCanvasCommands(workspaceId)).toBe(2);
    expect(useFlowStore.getState().nodes).toHaveLength(0);
    expect(useChatStore.getState().conversations).toEqual({});
    expect(getCanvasUndoHistory(workspaceId)).toEqual([]);
  });
});
