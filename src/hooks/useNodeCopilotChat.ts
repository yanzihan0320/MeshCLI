import { useCallback, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useFlowStore } from '../stores/flowStore';
import { streamChat, generateTitle } from '../services/llm';
import { getRootSystemPrompt, getBranchSystemPrompt, getMergeSystemPrompt } from '../utils/systemPrompts';
import type { ChatMessage } from '../types/chat';
import { validateImage, fileToBase64 } from '../utils/image';

export function useNodeCopilotChat(
  nodeId: string,
  topic: string,
  parentNodeId?: string,
  branchText?: string,
  parentNodeIds?: string[],
  mergeAction?: string,
) {
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string, files: File[] = []) => {
      const processedImages = await Promise.all(
        files.map(async (file) => {
          validateImage(file);
          return await fileToBase64(file);
        }),
      );

      const store = useChatStore.getState();
      store.addMessage(nodeId, 'user', content, processedImages.length ? processedImages : undefined);
      const messages = store.getMessages(nodeId);

      // Tell the agent which node is active — the bridge picks this up on the next sync
      const mode: 'root' | 'branch' | 'merge' =
        (parentNodeIds?.length ?? 0) >= 2 ? 'merge' : parentNodeId ? 'branch' : 'root';
      useChatStore.getState().setActiveNodeContext({ nodeId, mode, topic, mergeAction });

      // Build system prompt (same logic as useChatNode)
      let systemPrompt: string;
      if ((parentNodeIds?.length ?? 0) >= 2 && mergeAction) {
        const flowNodes = useFlowStore.getState().nodes;
        const parents = parentNodeIds!
          .map((pid) => {
            const node = flowNodes.find((n) => n.id === pid);
            if (!node) return null;
            const msgs = useChatStore
              .getState()
              .getMessages(pid)
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
        { id: 'system', role: 'system', content: systemPrompt, timestamp: 0 },
        ...messages,
      ];

      store.addMessage(nodeId, 'assistant', '');
      store.setStreaming(nodeId, true);

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
            // Auto-generate title for default-named nodes after first exchange
            const currentNode = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
            if (currentNode?.data.topic === 'New Chat') {
              const msgs = useChatStore.getState().getMessages(nodeId);
              const userMsg = msgs.find((m) => m.role === 'user');
              const assistantMsg = msgs.find((m) => m.role === 'assistant' && m.content);
              if (userMsg && assistantMsg) {
                generateTitle(userMsg.content, assistantMsg.content, (title) => {
                  useFlowStore.getState().updateNodeData(nodeId, { topic: title });
                });
              }
            }
          },
          onError: (error) => {
            useChatStore
              .getState()
              .appendToLastMessage(nodeId, `\n\n**Error:** ${error.message}`);
            useChatStore.getState().setStreaming(nodeId, false);
          },
        },
        controller.signal,
      );
    },
    [nodeId, topic, parentNodeId, branchText, parentNodeIds, mergeAction],
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    useChatStore.getState().setStreaming(nodeId, false);
  }, [nodeId]);

  return { sendMessage, cancelStream };
}
