import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { ChatMessage, Conversation, MessageRole } from '../types/chat';

export interface ActiveNodeContext {
  nodeId: string;
  mode: 'root' | 'branch' | 'merge';
  topic: string;
  mergeAction?: string;
}

interface ChatState {
  conversations: Record<string, Conversation>;
  activeNodeContext: ActiveNodeContext | null;
  setActiveNodeContext: (ctx: ActiveNodeContext | null) => void;
  initConversation: (nodeId: string) => void;
  addMessage: (nodeId: string, role: MessageRole, content: string, images?: {
    base64: string;
    mimeType: string;
  }[], triggeredBy?: string) => string;
  appendToLastMessage: (nodeId: string, chunk: string) => void;
  setStreaming: (nodeId: string, streaming: boolean) => void;
  getMessages: (nodeId: string) => ChatMessage[];
  removeConversation: (nodeId: string) => void;
  setConversations: (conversations: Record<string, Conversation>) => void;
  setConversationMessages: (nodeId: string, messages: ChatMessage[]) => void;
  addOrUpdateMessage: (nodeId: string, message: ChatMessage) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: {},
  activeNodeContext: null,
  setActiveNodeContext: (ctx) => set({ activeNodeContext: ctx }),

  initConversation: (nodeId) => {
    if (get().conversations[nodeId]) return;
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { nodeId, messages: [], isStreaming: false },
      },
    });
  },

  addMessage: (nodeId, role, content, images, triggeredBy) => {
    const id = nanoid();
    const message: ChatMessage = { id, role, content, timestamp: Date.now(), images, triggeredBy };
    const conv = get().conversations[nodeId];
    if (!conv) return id;
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { ...conv, messages: [...conv.messages, message] },
      },
    });
    return id;
  },

  appendToLastMessage: (nodeId, chunk) => {
    const conv = get().conversations[nodeId];
    if (!conv || conv.messages.length === 0) return;
    const messages = [...conv.messages];
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = { ...last, content: last.content + chunk };
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { ...conv, messages },
      },
    });
  },

  setStreaming: (nodeId, streaming) => {
    const conv = get().conversations[nodeId];
    if (!conv) return;
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { ...conv, isStreaming: streaming },
      },
    });
  },

  getMessages: (nodeId) => {
    return get().conversations[nodeId]?.messages ?? [];
  },

  removeConversation: (nodeId) => {
    const { [nodeId]: _, ...rest } = get().conversations;
    void _;
    set({ conversations: rest });
  },

  setConversations: (conversations) => set({ conversations }),

  setConversationMessages: (nodeId, messages) => {
    const conv = get().conversations[nodeId];
    if (!conv) return;
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { ...conv, messages },
      },
    });
  },

  addOrUpdateMessage: (nodeId, message) => {
    const conv = get().conversations[nodeId];
    if (!conv) return;
    const existing = conv.messages.findIndex((m) => m.id === message.id);
    const messages =
      existing >= 0
        ? conv.messages.map((m, i) => (i === existing ? { ...m, ...message } : m))
        : [...conv.messages, message];
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { ...conv, messages },
      },
    });
  },
}));
