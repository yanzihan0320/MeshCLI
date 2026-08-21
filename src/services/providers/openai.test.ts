import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, LLMConfig } from '../../types/chat';
import { OpenAIProvider } from './openai';

const messages: ChatMessage[] = [
  { id: '1', role: 'user', content: 'Hello', timestamp: 0 },
];

const config: LLMConfig = {
  providerId: 'openai',
  model: 'kimi-k3',
  temperature: 0.2,
  maxTokens: 100,
  mockDelay: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAIProvider', () => {
  it('surfaces reasoning activity before streaming visible content', async () => {
    const stream = [
      'data: {"choices":[{"delta":{"reasoning_content":"planning"}}]}',
      'data: {"choices":[{"delta":{"content":"answer"}}]}',
      'data: [DONE]',
      '',
    ].join('\n');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream));
    const onReasoning = vi.fn();
    const onToken = vi.fn();
    const onDone = vi.fn();

    await OpenAIProvider.streamChat(messages, config, {
      onReasoning,
      onToken,
      onDone,
      onError: vi.fn(),
    }, new AbortController().signal);

    expect(onReasoning).toHaveBeenCalledWith('planning');
    expect(onToken).toHaveBeenCalledWith('answer');
    expect(onDone).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0][1];
    expect(JSON.parse(String(request?.body)).temperature).toBe(1);
  });
});
