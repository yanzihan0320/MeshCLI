import { useCallback, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';
import { streamChat } from '../services/llm';
import { getRootSystemPrompt, getBranchSystemPrompt, getMergeSystemPrompt } from '../utils/systemPrompts';
import { useFlowStore } from '../stores/flowStore';
import type { ChatMessage } from '../types/chat';
import { validateImage, fileToBase64 } from '../utils/image';
import { deriveExplanationPresentation } from '../services/explanationBlocks';

export function useChatNode(nodeId: string, topic: string, parentNodeId?: string, branchText?: string, parentNodeIds?: string[], mergeAction?: string) {
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async(content: string, files: File[] = []) => {
      const processedImages = await Promise.all(
        files.map(async (file) => {
          validateImage(file);
          return await fileToBase64(file);
        })
      );      
      const store = useChatStore.getState();
      store.addMessage(nodeId, 'user', content, processedImages);
      const messages = store.getMessages(nodeId);

      // Build messages array with system prompt
      let systemPrompt: string;
      if (parentNodeIds && parentNodeIds.length >= 2 && mergeAction) {
        const flowNodes = useFlowStore.getState().nodes;
        const parents = parentNodeIds
          .map((pid) => {
            const node = flowNodes.find((n) => n.id === pid);
            if (!node) return null;
            const msgs = useChatStore.getState().getMessages(pid)
              .map((m) => ({ role: m.role, content: m.content }));
            return { topic: node.data.topic, messages: msgs };
          })
          .filter((p) => p !== null);
        systemPrompt = getMergeSystemPrompt(parents, mergeAction);
      } else if (parentNodeId && branchText) {
        const parentMessages = useChatStore
          .getState()
          .getMessages(parentNodeId)
          .map((m) => ({ role: m.role, content: m.content }));
        const parentTopic =
          parentMessages.find((m) => m.role === 'user')?.content ?? topic;
        systemPrompt = getBranchSystemPrompt(parentTopic, parentMessages);
      } else {
        systemPrompt = getRootSystemPrompt();
      }

      const fullMessages: ChatMessage[] = [
        {
          id: 'system',
          role: 'system',
          content: systemPrompt,
          timestamp: 0,
        },
        ...messages,
      ];

      // Create placeholder assistant message
      const assistantMessageId = store.addMessage(nodeId, 'assistant', '');
      store.setMessageStreamStatus(nodeId, assistantMessageId, 'thinking');
      store.setStreaming(nodeId, true);

      // Cancel previous stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      streamChat(
        fullMessages,
        {
          onToken: (token) => {
            const currentStore = useChatStore.getState();
            currentStore.setMessageStreamStatus(nodeId, assistantMessageId, 'answering');
            currentStore.appendToLastMessage(nodeId, token);
          },
          onReasoning: () => {
            useChatStore.getState().setMessageStreamStatus(nodeId, assistantMessageId, 'thinking');
          },
          onRetry: () => {
            useChatStore.getState().setMessageStreamStatus(nodeId, assistantMessageId, 'retrying');
          },
          onDone: () => {
            const currentStore = useChatStore.getState();
            currentStore.setMessageStreamStatus(nodeId, assistantMessageId, undefined);
            const answer = currentStore.getMessages(nodeId).find((message) => message.id === assistantMessageId)?.content ?? '';
            const presentation = deriveExplanationPresentation(answer, topic);
            currentStore.setMessagePresentation(nodeId, assistantMessageId, presentation.content, presentation.blocks);
            currentStore.setStreaming(nodeId, false);
          },
          onError: (error) => {
            const currentStore = useChatStore.getState();
            currentStore.setMessageStreamStatus(nodeId, assistantMessageId, undefined);
            currentStore.appendToLastMessage(
              nodeId,
              `\n\n**Error:** ${error.message}`
            );
            currentStore.setStreaming(nodeId, false);
          },
        },
        controller.signal
      );
    },
    [nodeId, topic, parentNodeId, branchText, parentNodeIds, mergeAction]
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    const store = useChatStore.getState();
    const assistantMessage = store.getMessages(nodeId).at(-1);
    if (assistantMessage?.role === 'assistant') {
      store.setMessageStreamStatus(nodeId, assistantMessage.id, undefined);
    }
    store.setStreaming(nodeId, false);
  }, [nodeId]);

  return { sendMessage, cancelStream };
}
