import { useCallback, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';
import { streamChat } from '../services/llm';
import { getRootSystemPrompt, getBranchSystemPrompt, getMergeSystemPrompt } from '../utils/systemPrompts';
import { useFlowStore } from '../stores/flowStore';
import type { ChatMessage } from '../types/chat';
import { validateImage, fileToBase64 } from '../utils/image';

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
      store.addMessage(nodeId, 'assistant', '');
      store.setStreaming(nodeId, true);

      // Cancel previous stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      streamChat(
        fullMessages,
        {
          onToken: (token) => {
            useChatStore.getState().appendToLastMessage(nodeId, token);
          },
          onDone: () => {
            useChatStore.getState().setStreaming(nodeId, false);
          },
          onError: (error) => {
            useChatStore.getState().appendToLastMessage(
              nodeId,
              `\n\n**Error:** ${error.message}`
            );
            useChatStore.getState().setStreaming(nodeId, false);
          },
        },
        controller.signal
      );
    },
    [nodeId, topic, parentNodeId, branchText, parentNodeIds, mergeAction]
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    useChatStore.getState().setStreaming(nodeId, false);
  }, [nodeId]);

  return { sendMessage, cancelStream };
}
