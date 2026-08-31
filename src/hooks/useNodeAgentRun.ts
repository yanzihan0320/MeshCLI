import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlowStore } from '../stores/flowStore';
import { useChatStore } from '../stores/chatStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { nodeRunClient } from '../services/agent/nodeRunClient';

const EMPTY_RUNS = [] as const;
const MAX_AGENT_ATTACHMENT_BYTES = 250_000;

function upsertAgentMessage(nodeId: string, runId: string, content: string) {
  const chat = useChatStore.getState();
  const existing = chat.getMessages(nodeId)
    .find((message) => message.role === 'assistant' && message.triggeredBy === runId);
  if (existing) {
    chat.addOrUpdateMessage(nodeId, { ...existing, content });
  } else {
    chat.addMessage(nodeId, 'assistant', content, undefined, runId);
  }
}

function terminalAgentMessage(event: { type: string; payload: Record<string, unknown> }, responseText: string): string {
  const partial = responseText.trim();
  if (event.type === 'run_failed') {
    const rawError = String(event.payload.error ?? 'Unknown execution error.');
    const failure = rawError.includes('Docker is not available')
      ? 'The Agent could not start because Docker Desktop is not running. Start Docker Desktop and retry this task.'
      : `The Agent run failed: ${rawError}`;
    return partial ? `${partial}\n\n${failure}` : failure;
  }
  if (event.type === 'run_cancelled') {
    const cancelled = String(event.payload.reason ?? 'Agent run cancelled.');
    return partial ? `${partial}\n\n${cancelled}` : cancelled;
  }
  return partial || String(event.payload.message ?? 'Agent run completed.');
}

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

export interface AgentRunOptions {
  agentModelId?: string;
  workingDirectory?: string;
  referenceNodeIds?: string[];
}

export function useNodeAgentRun(nodeId: string, topic: string) {
  const [clientError, setClientError] = useState<string>();
  const [isReviewing, setIsReviewing] = useState(false);
  const streamControllerRef = useRef<AbortController | undefined>(undefined);
  const responseTextRef = useRef('');
  const finalizedRunsRef = useRef(new Set<string>());
  const removedRunsRef = useRef(new Set<string>());
  const runs = useFlowStore((state) =>
    state.nodes.find((node) => node.id === nodeId)?.data.agentRuns ?? EMPTY_RUNS
  );
  const latestRun = runs.at(-1);
  const isRunning = latestRun?.status === 'queued' || latestRun?.status === 'running';

  useEffect(() => () => streamControllerRef.current?.abort(), []);

  const startRun = useCallback(async (prompt: string, files: File[] = [], options: AgentRunOptions = {}) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    const trimmedPrompt = prompt.trim();
    if (!workspaceId || !trimmedPrompt || isRunning) return;
    setClientError(undefined);
    responseTextRef.current = '';

    const chatState = useChatStore.getState();
    const flowState = useFlowStore.getState();
    const messages = chatState.getMessages(nodeId);
    const currentNode = flowState.nodes.find((node) => node.id === nodeId);
    const references = (options.referenceNodeIds ?? []).flatMap((referenceNodeId) => {
      const node = flowState.nodes.find((candidate) => candidate.id === referenceNodeId);
      if (!node || node.id === nodeId) return [];
      const nodeMessages = chatState.getMessages(node.id);
      return [{
        nodeId: node.id,
        title: node.data.topic || node.data.label || 'Untitled node',
        content: [node.data.branchText, ...nodeMessages.map((message) => `${message.role}: ${message.content}`)]
          .filter(Boolean).join('\n'),
      }];
    });
    let activeRunId: string | undefined;
    let userMessageId: string | undefined;
    try {
      const attachments = await readAgentAttachments(files);
      userMessageId = useChatStore.getState().addMessage(nodeId, 'user', trimmedPrompt);
      const created = await nodeRunClient.createRun({
        nodeId,
        workspaceId,
        prompt: trimmedPrompt,
        workingDirectory: options.workingDirectory?.trim() || undefined,
        agentModelId: options.agentModelId,
        context: {
          topic,
          sourceText: currentNode?.data.branchText,
          messages: messages.map(({ role, content }) => ({ role, content })),
          attachments,
          references,
        },
      });
      activeRunId = created.runId;
      const userMessage = useChatStore.getState().getMessages(nodeId)
        .find((message) => message.id === userMessageId);
      if (userMessage) {
        useChatStore.getState().addOrUpdateMessage(nodeId, { ...userMessage, triggeredBy: created.runId });
      }
      useFlowStore.getState().beginNodeRun(nodeId, created.runId);
      const controller = new AbortController();
      streamControllerRef.current = controller;
      await nodeRunClient.streamEvents(created.runId, (event) => {
        if (removedRunsRef.current.has(created.runId)) return;
        useFlowStore.getState().appendNodeRunEvent(nodeId, event);
        if (event.type === 'text_delta') {
          responseTextRef.current += String(event.payload.delta ?? '');
          upsertAgentMessage(nodeId, created.runId, responseTextRef.current);
        }
        if (event.type === 'run_finished' && !responseTextRef.current.trim()) {
          responseTextRef.current = String(event.payload.summary ?? '');
        }
        if (['review_ready', 'patch_applied', 'patch_reverted', 'run_failed', 'run_cancelled'].includes(event.type)
          && !finalizedRunsRef.current.has(created.runId)) {
          finalizedRunsRef.current.add(created.runId);
          upsertAgentMessage(nodeId, created.runId, terminalAgentMessage(event, responseTextRef.current));
        }
      }, controller.signal);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const message = error instanceof Error ? error.message : String(error);
        setClientError(message);
        if (activeRunId) {
          const run = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
            ?.data.agentRuns?.find((candidate) => candidate.runId === activeRunId);
          if (run && !['failed', 'cancelled', 'review_ready', 'applied', 'rejected', 'conflicted', 'reverted'].includes(run.status)) {
            const sequence = Math.max(-1, ...run.events.map((event) => event.sequence)) + 1;
            useFlowStore.getState().appendNodeRunEvent(nodeId, {
              version: 1,
              eventId: `client-failure-${crypto.randomUUID()}`,
              runId: activeRunId,
              nodeId,
              sequence,
              timestamp: Date.now(),
              type: 'run_failed',
              payload: { error: message, source: 'client' },
            });
            finalizedRunsRef.current.add(activeRunId);
            upsertAgentMessage(nodeId, activeRunId, terminalAgentMessage({
              type: 'run_failed', payload: { error: message },
            }, responseTextRef.current));
          }
        }
      }
    } finally {
      streamControllerRef.current = undefined;
    }
  }, [isRunning, nodeId, topic]);

  const cancelRun = useCallback(async () => {
    if (!latestRun || !isRunning) return;
    setClientError(undefined);
    try {
      const event = await nodeRunClient.cancelRun(latestRun.runId);
      if (event) {
        useFlowStore.getState().appendNodeRunEvent(nodeId, event);
        if (!finalizedRunsRef.current.has(latestRun.runId)) {
          finalizedRunsRef.current.add(latestRun.runId);
          upsertAgentMessage(nodeId, latestRun.runId, terminalAgentMessage(event, responseTextRef.current));
        }
      }
    } catch (error) {
      setClientError(error instanceof Error ? error.message : String(error));
    }
  }, [isRunning, latestRun, nodeId]);

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
      if (event.type === 'review_ready') {
        await nodeRunClient.streamEvents(latestRun.runId, (historicalEvent) => {
          useFlowStore.getState().appendNodeRunEvent(nodeId, historicalEvent);
        });
      }
      if (event.type === 'patch_conflict') {
        setClientError(String(event.payload.error ?? 'Patch could not be applied.'));
      }
    } catch (error) {
      setClientError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsReviewing(false);
    }
  }, [isReviewing, latestRun, nodeId]);

  const undoRun = useCallback(async (expectedChangeSetId?: string) => {
    if (!latestRun || latestRun.status !== 'applied' || isReviewing) return;
    if (!latestRun.changeSet?.files.length) {
      setClientError('This was a read-only Agent run; no project files were changed, so there is nothing to undo.');
      return;
    }
    const changeSetId = expectedChangeSetId ?? latestRun.changeSet?.changeSetId;
    if (!changeSetId) return setClientError('This run has no applied change set to undo.');
    setClientError(undefined);
    setIsReviewing(true);
    try {
      const event = await nodeRunClient.undoRun(latestRun.runId, changeSetId);
      useFlowStore.getState().appendNodeRunEvent(nodeId, event);
      if (event.type === 'undo_conflict') setClientError(String(event.payload.error ?? 'Undo is no longer safe.'));
    } catch (error) {
      setClientError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsReviewing(false);
    }
  }, [isReviewing, latestRun, nodeId]);

  const deleteTurnFromMessage = useCallback((messageId: string): boolean => {
    const chat = useChatStore.getState();
    const messages = chat.getMessages(nodeId);
    const selectedIndex = messages.findIndex((message) => message.id === messageId);
    if (selectedIndex < 0) return false;
    const turnStartIndex = messages[selectedIndex].role === 'user'
      ? selectedIndex
      : messages.findLastIndex((message, index) => index <= selectedIndex && message.role === 'user');
    if (turnStartIndex < 0) return false;

    const cutoff = messages[turnStartIndex].timestamp;
    const removedMessages = messages.slice(turnStartIndex);
    const linkedRunIds = new Set(removedMessages
      .map((message) => message.triggeredBy)
      .filter((runId): runId is string => Boolean(runId)));
    for (const run of runs) {
      if (run.startedAt >= cutoff) linkedRunIds.add(run.runId);
    }

    const runIds = [...linkedRunIds];
    if (runIds.length > 0) {
      streamControllerRef.current?.abort();
      for (const runId of runIds) {
        removedRunsRef.current.add(runId);
        finalizedRunsRef.current.add(runId);
        const run = runs.find((candidate) => candidate.runId === runId);
        if (run?.status === 'queued' || run?.status === 'running') {
          void nodeRunClient.cancelRun(runId).catch(() => undefined);
        }
      }
      useFlowStore.getState().removeNodeRuns(nodeId, runIds);
      responseTextRef.current = '';
    }
    chat.deleteTurnFromMessage(nodeId, messageId);
    setClientError(undefined);
    return true;
  }, [nodeId, runs]);

  const deleteLatestRun = useCallback((): boolean => {
    if (!latestRun) return false;
    const messages = useChatStore.getState().getMessages(nodeId);
    const linkedUser = [...messages].reverse().find((message) => (
      message.role === 'user' && message.triggeredBy === latestRun.runId
    ));
    const fallbackUser = [...messages].reverse().find((message) => (
      message.role === 'user' && message.timestamp <= latestRun.startedAt
    ));
    const target = linkedUser ?? fallbackUser;
    if (!target) {
      streamControllerRef.current?.abort();
      removedRunsRef.current.add(latestRun.runId);
      finalizedRunsRef.current.add(latestRun.runId);
      if (isRunning) void nodeRunClient.cancelRun(latestRun.runId).catch(() => undefined);
      useFlowStore.getState().removeNodeRuns(nodeId, [latestRun.runId]);
      return true;
    }
    return deleteTurnFromMessage(target.id);
  }, [deleteTurnFromMessage, isRunning, latestRun, nodeId]);

  return {
    latestRun,
    isRunning,
    clientError,
    isReviewing,
    startRun,
    cancelRun,
    applyRun: (changeSetId?: string) => reviewRun('apply', changeSetId),
    rejectRun: (changeSetId?: string) => reviewRun('reject', changeSetId),
    undoRun,
    deleteTurnFromMessage,
    deleteLatestRun,
  };
}
