import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlowStore } from '../stores/flowStore';
import { useChatStore } from '../stores/chatStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { nodeRunClient } from '../services/agent/nodeRunClient';

const EMPTY_RUNS = [] as const;

export function useNodeAgentRun(nodeId: string, topic: string) {
  const [clientError, setClientError] = useState<string>();
  const streamControllerRef = useRef<AbortController | undefined>(undefined);
  const runs = useFlowStore((state) =>
    state.nodes.find((node) => node.id === nodeId)?.data.agentRuns ?? EMPTY_RUNS
  );
  const latestRun = runs.at(-1);
  const isRunning = latestRun?.status === 'queued' || latestRun?.status === 'running';

  useEffect(() => () => streamControllerRef.current?.abort(), []);

  const startRun = useCallback(async (prompt: string) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    const trimmedPrompt = prompt.trim();
    if (!workspaceId || !trimmedPrompt || isRunning) return;
    setClientError(undefined);

    const messages = useChatStore.getState().getMessages(nodeId);
    try {
      const created = await nodeRunClient.createRun({
        nodeId,
        workspaceId,
        prompt: trimmedPrompt,
        context: {
          topic,
          messages: messages.map(({ role, content }) => ({ role, content })),
        },
      });
      useFlowStore.getState().beginNodeRun(nodeId, created.runId);
      const controller = new AbortController();
      streamControllerRef.current = controller;
      await nodeRunClient.streamEvents(created.runId, (event) => {
        useFlowStore.getState().appendNodeRunEvent(nodeId, event);
      }, controller.signal);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setClientError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      streamControllerRef.current = undefined;
    }
  }, [isRunning, nodeId, topic]);

  const cancelRun = useCallback(async () => {
    if (!latestRun || !isRunning) return;
    setClientError(undefined);
    try {
      await nodeRunClient.cancelRun(latestRun.runId);
    } catch (error) {
      setClientError(error instanceof Error ? error.message : String(error));
    }
  }, [isRunning, latestRun]);

  return {
    latestRun,
    isRunning,
    clientError,
    startRun,
    cancelRun,
  };
}
