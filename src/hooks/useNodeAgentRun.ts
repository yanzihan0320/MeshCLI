import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlowStore } from '../stores/flowStore';
import { useChatStore } from '../stores/chatStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { nodeRunClient } from '../services/agent/nodeRunClient';

const EMPTY_RUNS = [] as const;
const MAX_AGENT_ATTACHMENT_BYTES = 250_000;

export async function readAgentAttachments(files: File[]) {
  if (files.length > 10) throw new Error('Attach at most 10 text files to an Agent run.');
  return Promise.all(files.map(async (file) => {
    if (file.size > MAX_AGENT_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} is larger than 250 KB.`);
    }
    const content = await file.text();
    if (content.includes('\0')) throw new Error(`${file.name} is not a text file.`);
    return { name: file.name, content, mediaType: file.type || 'text/plain' };
  }));
}

export function useNodeAgentRun(nodeId: string, topic: string) {
  const [clientError, setClientError] = useState<string>();
  const [isReviewing, setIsReviewing] = useState(false);
  const streamControllerRef = useRef<AbortController | undefined>(undefined);
  const responseTextRef = useRef('');
  const finalizedRunsRef = useRef(new Set<string>());
  const runs = useFlowStore((state) =>
    state.nodes.find((node) => node.id === nodeId)?.data.agentRuns ?? EMPTY_RUNS
  );
  const latestRun = runs.at(-1);
  const isRunning = latestRun?.status === 'queued' || latestRun?.status === 'running';

  useEffect(() => () => streamControllerRef.current?.abort(), []);

  const startRun = useCallback(async (prompt: string, files: File[] = []) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    const trimmedPrompt = prompt.trim();
    if (!workspaceId || !trimmedPrompt || isRunning) return;
    setClientError(undefined);
    responseTextRef.current = '';

    const messages = useChatStore.getState().getMessages(nodeId);
    try {
      const attachments = await readAgentAttachments(files);
      const created = await nodeRunClient.createRun({
        nodeId,
        workspaceId,
        prompt: trimmedPrompt,
        context: {
          topic,
          messages: messages.map(({ role, content }) => ({ role, content })),
          attachments,
        },
      });
      useFlowStore.getState().beginNodeRun(nodeId, created.runId);
      const controller = new AbortController();
      streamControllerRef.current = controller;
      await nodeRunClient.streamEvents(created.runId, (event) => {
        useFlowStore.getState().appendNodeRunEvent(nodeId, event);
        if (event.type === 'text_delta') responseTextRef.current += String(event.payload.delta ?? '');
        if (event.type === 'run_finished' && !responseTextRef.current.trim()) {
          responseTextRef.current = String(event.payload.summary ?? '');
        }
        if (['review_ready', 'run_failed', 'run_cancelled'].includes(event.type)
          && !finalizedRunsRef.current.has(created.runId)) {
          finalizedRunsRef.current.add(created.runId);
          const existing = useChatStore.getState().getMessages(nodeId)
            .some((message) => message.triggeredBy === created.runId);
          if (!existing) {
            const rawError = String(event.payload.error ?? '');
            const response = event.type === 'run_failed'
              ? rawError.includes('Docker is not available')
                ? 'The Agent could not start because Docker Desktop is not running. Start Docker Desktop and retry this task.'
                : `The Agent run failed: ${rawError || 'Unknown execution error.'}`
              : responseTextRef.current.trim() || String(event.payload.message ?? 'Agent run completed.');
            useChatStore.getState().addMessage(nodeId, 'assistant', response, undefined, created.runId);
          }
        }
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

  const reviewRun = useCallback(async (action: 'apply' | 'reject', expectedChangeSetId?: string) => {
    if (!latestRun || latestRun.status !== 'review_ready' || isReviewing) return;
    const changeSetId = expectedChangeSetId ?? latestRun.changeSet?.changeSetId;
    if (!changeSetId) {
      setClientError('This run has no change set bound to the review action.');
      return;
    }
    setClientError(undefined);
    setIsReviewing(true);
    try {
      const event = await nodeRunClient.reviewRun(latestRun.runId, action, changeSetId);
      useFlowStore.getState().appendNodeRunEvent(nodeId, event);
      if (event.type === 'patch_conflict') {
        setClientError(String(event.payload.error ?? 'Patch could not be applied.'));
      }
    } catch (error) {
      setClientError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsReviewing(false);
    }
  }, [isReviewing, latestRun, nodeId]);

  return {
    latestRun,
    isRunning,
    clientError,
    isReviewing,
    startRun,
    cancelRun,
    applyRun: (changeSetId?: string) => reviewRun('apply', changeSetId),
    rejectRun: (changeSetId?: string) => reviewRun('reject', changeSetId),
  };
}
