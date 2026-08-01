export interface ModelInfo {
  id: string;
  name: string;
}

export interface ServerLLMConfig {
  provider: string;
  displayName: string;
  model: string;
  configured: boolean;
  endpointHost: string;
}

async function readError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return (data as { error?: string }).error || fallback;
}

export async function fetchServerConfig(provider: string): Promise<ServerLLMConfig> {
  const response = await fetch(`/api/llm/config?provider=${encodeURIComponent(provider)}`);
  if (!response.ok) {
    throw new Error(await readError(response, `Unable to load server configuration (${response.status})`));
  }
  return response.json();
}

export async function fetchModels(provider: string): Promise<ModelInfo[]> {
  const response = await fetch(`/api/llm/models?provider=${encodeURIComponent(provider)}`);
  if (!response.ok) {
    throw new Error(await readError(response, `Unable to fetch models (${response.status})`));
  }

  const data = await response.json();
  const models = Array.isArray(data) ? data : data.data;
  if (!Array.isArray(models)) return [];

  return models.map((model: { id?: string; name?: string }) => ({
    id: model.id || model.name || '',
    name: model.name || model.id || '',
  })).filter((model: ModelInfo) => model.id);
}

export async function testConnection(provider: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`/api/llm/test?provider=${encodeURIComponent(provider)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    return {
      success: Boolean((data as { success?: boolean }).success),
      message: (data as { message?: string }).message || `Connection failed (${response.status})`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'BFF is unavailable',
    };
  }
}
