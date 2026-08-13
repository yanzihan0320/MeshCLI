import { beforeEach, describe, expect, it } from 'vitest';
import { useAssistantStore } from '../../stores/assistantStore';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { markChatCanvasMutated, markFlowCanvasMutated } from './canvasRevision';

const workspaceId = 'revision-workspace';

beforeEach(() => {
  useAssistantStore.setState({ workspaces: {} });
  useWorkspaceStore.setState({ activeWorkspaceId: workspaceId });
  useFlowStore.getState().setNodes([]);
  useFlowStore.getState().setEdges([]);
  useChatStore.getState().setConversations({});
  useAssistantStore.getState().ensureWorkspace(workspaceId);
});

describe('canvas revision semantics', () => {
  it('ignores React Flow measurement and selection-only updates', () => {
    const previous = useFlowStore.getState();
    const current = {
      ...previous,
      nodes: [{
        id: 'n1', type: 'chat' as const, position: { x: 0, y: 0 }, selected: true,
        measured: { width: 400, height: 500 }, data: { topic: 'A' },
      }],
    };
    const sameSemantic = {
      ...current,
      nodes: [{ ...current.nodes[0], selected: false, measured: { width: 420, height: 510 } }],
    };
    markFlowCanvasMutated(sameSemantic, current);
    expect(useAssistantStore.getState().ensureWorkspace(workspaceId).revision).toBe(0);
  });

  it('advances for semantic node and message changes', () => {
    const flow = useFlowStore.getState();
    markFlowCanvasMutated({
      ...flow,
      nodes: [{ id: 'n1', type: 'chat', position: { x: 0, y: 0 }, data: { topic: 'A' } }],
    }, flow);
    expect(useAssistantStore.getState().ensureWorkspace(workspaceId).revision).toBe(1);

    const chat = useChatStore.getState();
    markChatCanvasMutated({
      ...chat,
      conversations: { n1: { nodeId: 'n1', isStreaming: false, messages: [
        { id: 'm1', role: 'user', content: 'hello', timestamp: 1 },
      ] } },
    }, chat);
    expect(useAssistantStore.getState().ensureWorkspace(workspaceId).revision).toBe(2);
  });
});
