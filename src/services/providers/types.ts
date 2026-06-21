import type { ChatMessage, LLMConfig } from '../../types/chat';

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

export interface LLMProvider {
  id: string;
  name: string;
  streamChat: (
    messages: ChatMessage[],
    config: LLMConfig,
    callbacks: StreamCallbacks,
    signal: AbortSignal
  ) => void;
  supportsVision?: boolean;
}
