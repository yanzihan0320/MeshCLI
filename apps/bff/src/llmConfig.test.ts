import { describe, expect, it } from 'vitest';
import { normalizeOpenAIBaseUrl, publicLLMConfig, resolveLLMConfig } from './llmConfig';

describe('OpenAI-compatible BFF configuration', () => {
  it('normalizes base and chat-completions URLs', () => {
    expect(normalizeOpenAIBaseUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1');
    expect(normalizeOpenAIBaseUrl('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1');
    expect(normalizeOpenAIBaseUrl('https://api.deepseek.com/v1/chat/completions')).toBe('https://api.deepseek.com/v1');
  });

  it('resolves a custom provider entirely from server environment values', () => {
    const config = resolveLLMConfig('custom', {
      OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
      OPENAI_API_KEY: 'server-only-secret',
      OPENAI_MODEL: 'deepseek-chat',
    });

    expect(config?.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(config?.model).toBe('deepseek-chat');
    expect(config?.authHeaders.Authorization).toBe('Bearer server-only-secret');
  });

  it('never exposes the API key in public configuration', () => {
    const config = resolveLLMConfig('custom', {
      OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
      OPENAI_API_KEY: 'server-only-secret',
      OPENAI_MODEL: 'deepseek-chat',
    });

    expect(config).toBeDefined();
    const publicConfig = publicLLMConfig(config!);
    expect(publicConfig).toEqual({
      provider: 'custom',
      displayName: 'OpenAI Compatible',
      model: 'deepseek-chat',
      configured: true,
      endpointHost: 'api.deepseek.com',
    });
    expect(JSON.stringify(publicConfig)).not.toContain('server-only-secret');
  });
});
