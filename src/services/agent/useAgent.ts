import { useCallback, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { agentClient } from './client';
import { buildCanvasSnapshot, executeCanvasCommand, undoCanvasCommand } from './canvasCommandExecutor';
import { CanvasCommandSchema, type CanvasCommandResult, type WorkspaceAssistantEvent } from '../../../packages/protocol/src/assistant';
import { useAssistantStore } from '../../stores/assistantStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

export function useAgent() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspace = useAssistantStore((state) => activeWorkspaceId ? state.workspaces[activeWorkspaceId] : undefined);
  const nodeProviderId = useSettingsStore((state) => state.llmConfig.providerId);
  const assistantProviderId = useSettingsStore((state) => state.assistantProviderId);
  const resolvedProviderId = assistantProviderId === 'same' ? nodeProviderId : assistantProviderId;
  const { getNode, setCenter } = useReactFlow();

  useEffect(() => {
    if (activeWorkspaceId) useAssistantStore.getState().ensureWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId]);

  const focus = useCallback((nodeId: string) => {
    const node = getNode(nodeId);
    if (!node) return false;
    const width = typeof node.measured?.width === 'number' ? node.measured.width : 400;
    const height = typeof node.measured?.height === 'number' ? node.measured.height : 500;
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 0.9, duration: 350 });
    return true;
  }, [getNode, setCenter]);

  const handleEvent = useCallback(async (event: WorkspaceAssistantEvent) => {
    const store = useAssistantStore.getState();
    store.appendActivity(event.workspaceId, event);
    if (event.type === 'text_delta') {
      store.appendAssistantDelta(event.workspaceId, String(event.payload.delta ?? ''));
    }
    if (event.type === 'skill_activated') {
      const skill = String(event.payload.name ?? '');
      const current = store.ensureWorkspace(event.workspaceId).usedSkills;
      if (skill) store.setUsedSkills(event.workspaceId, [...new Set([...current, skill])]);
    }
    if (event.type === 'canvas_command' || event.type === 'permission_required') {
      const parsed = CanvasCommandSchema.safeParse(event.payload.command);
      if (!parsed.success) return;
      if (event.type === 'permission_required' || parsed.data.risk === 'destructive') {
        store.setPendingCommand(event.workspaceId, parsed.data);
        store.setRunning(event.workspaceId, false);
        return;
      }
      const result = executeCanvasCommand(parsed.data, focus);
      await resolve(result);
    }
    if (event.type === 'turn_finished' || event.type === 'turn_failed') {
      store.setRunning(event.workspaceId, false);
      if (event.type === 'turn_failed') {
        store.appendMessage(event.workspaceId, {
          id: crypto.randomUUID(), role: 'assistant', timestamp: Date.now(),
          content: `Error: ${String(event.payload.error ?? 'Assistant turn failed.')}`,
        });
      }
    }
  // resolve is stable over one active workspace and intentionally invoked after events.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, resolvedProviderId]);

  const resolve = useCallback(async (result: CanvasCommandResult) => {
    const state = useAssistantStore.getState().ensureWorkspace(result.workspaceId);
    useAssistantStore.getState().appendActivity(result.workspaceId, {
      version: 1,
      eventId: crypto.randomUUID(),
      workspaceId: result.workspaceId,
      threadId: state.threadId,
      timestamp: Date.now(),
      type: 'action_resolved',
      payload: {
        actionId: result.actionId,
        status: result.status,
        message: result.message,
        revision: result.revision,
        affectedNodeIds: result.affectedNodeIds,
        affectedEdgeIds: result.affectedEdgeIds,
      },
    });
    useAssistantStore.getState().setPendingCommand(result.workspaceId, undefined);
    useAssistantStore.getState().setRunning(result.workspaceId, true);
    await agentClient.resolveAction(result.actionId, {
      workspaceId: result.workspaceId,
      threadId: state.threadId,
      result,
      canvas: buildCanvasSnapshot(result.workspaceId),
    }, resolvedProviderId, (event) => { void handleEvent(event); });
  }, [handleEvent, resolvedProviderId]);

  const send = useCallback(async (message: string) => {
    if (!activeWorkspaceId) return;
    const state = useAssistantStore.getState().ensureWorkspace(activeWorkspaceId);
    useAssistantStore.getState().appendMessage(activeWorkspaceId, {
      id: crypto.randomUUID(), role: 'user', content: message, timestamp: Date.now(),
    });
    useAssistantStore.getState().setRunning(activeWorkspaceId, true);
    await agentClient.sendTurn({
      workspaceId: activeWorkspaceId,
      threadId: state.threadId,
      message,
      history: state.messages.map(({ role, content }) => ({ role, content })),
      canvas: buildCanvasSnapshot(activeWorkspaceId),
    }, resolvedProviderId, (event) => { void handleEvent(event); });
  }, [activeWorkspaceId, handleEvent, resolvedProviderId]);

  const decidePending = useCallback(async (approved: boolean) => {
    if (!activeWorkspaceId) return;
    const pending = useAssistantStore.getState().ensureWorkspace(activeWorkspaceId).pendingCommand;
    if (!pending) return;
    if (!approved) {
      const revision = useAssistantStore.getState().ensureWorkspace(activeWorkspaceId).revision;
      await resolve({ version: 1, actionId: pending.actionId, workspaceId: activeWorkspaceId, status: 'rejected', revision, message: 'User rejected the canvas action.', affectedNodeIds: [], affectedEdgeIds: [] });
      return;
    }
    await resolve(executeCanvasCommand(pending, focus));
  }, [activeWorkspaceId, focus, resolve]);

  const abort = useCallback(() => {
    agentClient.abort();
    if (activeWorkspaceId) useAssistantStore.getState().setRunning(activeWorkspaceId, false);
  }, [activeWorkspaceId]);

  return {
    messages: workspace?.messages ?? [],
    activity: workspace?.activity ?? [],
    usedSkills: workspace?.usedSkills ?? [],
    pendingCommand: workspace?.pendingCommand,
    isRunning: workspace?.running ?? false,
    send,
    abort,
    decidePending,
    undo: (actionId?: string) => activeWorkspaceId ? undoCanvasCommand(activeWorkspaceId, actionId) : false,
  };
}
