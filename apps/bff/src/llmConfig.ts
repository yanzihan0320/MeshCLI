export type LLMProviderId = 'openai' | 'custom' | 'anthropic';

export interface UpstreamLLMConfig {
  provider: LLMProviderId;
  displayName: string;
  endpoint: string;
  modelsEndpoint?: string;
  apiKey?: string;
  model?: string;
  envKey: string;
  authHeaders: Record<string, string>;
}

export function normalizeOpenAIBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.slice(0, -'/chat/completions'.length);
  }
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

export function resolveLLMConfig(
  provider: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): UpstreamLLMConfig | undefined {
  if (provider === 'openai' || provider === 'custom') {
    const baseUrl = normalizeOpenAIBaseUrl(
      env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    );
    const apiKey = env.OPENAI_API_KEY;
    const model = env.OPENAI_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : undefined);

    return {
      provider,
      displayName: provider === 'openai' ? 'OpenAI' : 'OpenAI Compatible',
      endpoint: `${baseUrl}/chat/completions`,
      modelsEndpoint: `${baseUrl}/models`,
      apiKey,
      model,
      envKey: 'OPENAI_API_KEY',
      authHeaders: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    };
  }

  if (provider === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY;
    return {
      provider,
      displayName: 'Anthropic',
      endpoint: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages',
      apiKey,
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
      envKey: 'ANTHROPIC_API_KEY',
      authHeaders: apiKey
        ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        : {},
    };
  }

  return undefined;
}

export function publicLLMConfig(config: UpstreamLLMConfig) {
  let endpointHost = '';
  try {
    endpointHost = new URL(config.endpoint).host;
  } catch {
    endpointHost = 'Invalid server URL';
  }

  return {
    provider: config.provider,
    displayName: config.displayName,
    model: config.model || '',
    configured: Boolean(config.apiKey && config.model),
    endpointHost,
  };
}
