import type { A2UIBlock } from '../../packages/protocol/src/a2ui';

export type MessageRole = 'user' | 'assistant' | 'system';
export type ChatStreamStatus = 'thinking' | 'answering' | 'retrying';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  images?: {
    base64: string;
    mimeType: string;
  }[];
  triggeredBy?: string;
  blocks?: A2UIBlock[];
  streamStatus?: ChatStreamStatus;
}

export interface Conversation {
  nodeId: string;
  messages: ChatMessage[];
  isStreaming: boolean;
}

export interface LLMConfig {
  providerId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  mockDelay: number;
}
