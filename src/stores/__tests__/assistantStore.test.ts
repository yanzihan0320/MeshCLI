import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceAssistantEvent } from '../../../packages/protocol/src/assistant';
import { useAssistantStore } from '../assistantStore';

const workspaceId = 'assistant-workspace';

function assistantEvent(
  eventId: string,
  type: WorkspaceAssistantEvent['type'],
  timestamp: number,
  payload: WorkspaceAssistantEvent['payload'] = {},
): WorkspaceAssistantEvent {
  return {
    version: 1,
    eventId,
    workspaceId,
    threadId: 'thread-old',
    timestamp,
    type,
    payload,
  };
}

beforeEach(() => {
  useAssistantStore.setState({ workspaces: {} });
});

describe('assistantStore retractLatestTurn', () => {
  it('removes the latest turn and rebuilds a clean server thread from retained history', () => {
    const store = useAssistantStore.getState();
    const originalThreadId = store.ensureWorkspace(workspaceId).threadId;

    store.appendMessage(workspaceId, {
      id: 'user-old', role: 'user', content: 'Keep this question', timestamp: 100,
    });
    store.appendMessage(workspaceId, {
      id: 'assistant-old', role: 'assistant', content: 'Keep this answer', timestamp: 110,
    });
    store.appendActivity(workspaceId, assistantEvent('old-start', 'turn_started', 101));
    store.appendActivity(workspaceId, assistantEvent('old-skill', 'skill_activated', 102, { name: 'meshcli-canvas' }));
    store.appendActivity(workspaceId, assistantEvent('old-finish', 'turn_finished', 111));

    store.appendMessage(workspaceId, {
      id: 'user-latest', role: 'user', content: 'Remove this question', timestamp: 200,
    });
    store.appendMessage(workspaceId, {
      id: 'assistant-latest', role: 'assistant', content: 'Remove this answer', timestamp: 210,
    });
    store.appendActivity(workspaceId, assistantEvent('latest-start', 'turn_started', 201));
    store.appendActivity(workspaceId, assistantEvent('latest-tool', 'tool_started', 202, { tool: 'canvas' }));
    store.setRunning(workspaceId, true);

    const retracted = useAssistantStore.getState().retractLatestTurn(workspaceId);
    const next = useAssistantStore.getState().workspaces[workspaceId];

    expect(retracted?.userMessageId).toBe('user-latest');
    expect(retracted?.activity.map((event) => event.eventId)).toEqual([
      'latest-start', 'latest-tool',
    ]);
    expect(next.messages.map((message) => message.id)).toEqual(['user-old', 'assistant-old']);
    expect(next.activity.map((event) => event.eventId)).toEqual(['old-start', 'old-skill', 'old-finish']);
    expect(next.usedSkills).toEqual(['meshcli-canvas']);
    expect(next.threadId).not.toBe(originalThreadId);
    expect(next.historyStartIndex).toBe(0);
    expect(next.running).toBe(false);
    expect(next.pendingCommand).toBeUndefined();
  });

  it('keeps previous activity when the latest message was cancelled before a turn started', () => {
    const store = useAssistantStore.getState();
    store.ensureWorkspace(workspaceId);
    store.appendMessage(workspaceId, {
      id: 'user-old', role: 'user', content: 'Previous question', timestamp: 100,
    });
    store.appendMessage(workspaceId, {
      id: 'assistant-old', role: 'assistant', content: 'Previous answer', timestamp: 110,
    });
    store.appendActivity(workspaceId, assistantEvent('old-start', 'turn_started', 101));
    store.appendActivity(workspaceId, assistantEvent('old-finish', 'turn_finished', 111));
    store.appendMessage(workspaceId, {
      id: 'user-unsent', role: 'user', content: 'Cancel before request starts', timestamp: 200,
    });
    store.setRunning(workspaceId, true);

    const retracted = useAssistantStore.getState().retractLatestTurn(workspaceId);
    const next = useAssistantStore.getState().workspaces[workspaceId];

    expect(retracted?.activity).toEqual([]);
    expect(next.messages.map((message) => message.id)).toEqual(['user-old', 'assistant-old']);
    expect(next.activity.map((event) => event.eventId)).toEqual(['old-start', 'old-finish']);
  });

  it('does not retract a turn after the assistant has finished', () => {
    const store = useAssistantStore.getState();
    store.ensureWorkspace(workspaceId);
    store.appendMessage(workspaceId, {
      id: 'user-finished', role: 'user', content: 'Completed question', timestamp: 100,
    });
    store.appendMessage(workspaceId, {
      id: 'assistant-finished', role: 'assistant', content: 'Completed answer', timestamp: 110,
    });
    store.appendActivity(workspaceId, assistantEvent('finished-start', 'turn_started', 101));
    store.appendActivity(workspaceId, assistantEvent('finished-end', 'turn_finished', 111));
    store.setRunning(workspaceId, false);

    expect(useAssistantStore.getState().retractLatestTurn(workspaceId)).toBeUndefined();
    expect(useAssistantStore.getState().workspaces[workspaceId].messages.map((message) => message.id))
      .toEqual(['user-finished', 'assistant-finished']);
  });
});
