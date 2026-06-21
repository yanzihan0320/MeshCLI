import type { ChatMessage, LLMConfig } from '../types/chat';
import type { StreamCallbacks } from './providers/types';
import { getProvider } from './providers/registry';
import { useSettingsStore } from '../stores/settingsStore';

export function streamChat(
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal: AbortSignal
) {
  const config = useSettingsStore.getState().llmConfig;
  const provider = getProvider(config.providerId);

  if (!provider) {
    callbacks.onError(new Error(`Unknown provider: ${config.providerId}`));
    return;
  }

  provider.streamChat(messages, config, callbacks, signal);
}

export function generateTitle(
  userMessage: string,
  assistantMessage: string,
  onTitle: (title: string) => void
): void {
  const config = useSettingsStore.getState().llmConfig;
  const provider = getProvider(config.providerId);
  if (!provider) return;

  const titleConfig: LLMConfig = { ...config, maxTokens: 20 };
  const messages: ChatMessage[] = [
    {
      id: 'system',
      role: 'system',
      content:
        'Generate a concise 3-6 word title summarizing this conversation. Reply with ONLY the title, no quotes or extra punctuation.',
      timestamp: 0,
    },
    {
      id: 'context',
      role: 'user',
      content: `User: ${userMessage}\n\nAssistant: ${assistantMessage.slice(0, 300)}`,
      timestamp: 0,
    },
  ];

  let title = '';
  const controller = new AbortController();
  provider.streamChat(
    messages,
    titleConfig,
    {
      onToken: (token) => {
        title += token;
      },
      onDone: () => {
        const cleaned = title.trim().replace(/^["']|["']$/g, '');
        if (cleaned) onTitle(cleaned);
      },
      onError: () => {},
    },
    controller.signal,
  );
}
