import { beforeEach, describe, expect, it } from 'vitest';
import { useAssistantStore } from '../../stores/assistantStore';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { executeCanvasCommand, undoCanvasCommand } from './canvasCommandExecutor';

const workspaceId = 'executor-workspace';

beforeEach(() => {
  useFlowStore.getState().setNodes([]);
  useFlowStore.getState().setEdges([]);
  useChatStore.getState().setConversations({});
  useAssistantStore.setState({ workspaces: {} });
  useWorkspaceStore.setState({ activeWorkspaceId: workspaceId });
});

describe('CanvasCommandExecutor', () => {
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
});
