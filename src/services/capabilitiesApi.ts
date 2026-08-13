export interface SkillCatalogItem {
  name: string;
  description: string;
  source: 'built-in' | 'global' | 'workspace';
  enabled: boolean;
  error?: string;
  overriddenBy?: string;
  shadows?: Array<'built-in' | 'global' | 'workspace'>;
  lastActivatedAt?: number;
}

export interface SkillUsageItem {
  workspaceId: string;
  name: string;
  source: string;
  agentType: 'assistant' | 'node-agent';
  activatedAt: number;
}

export interface MCPServerItem {
  id: string;
  name: string;
  scope: 'built-in' | 'user' | 'workspace';
  transport: 'stdio' | 'streamable-http';
  enabled: boolean;
  status: 'configured' | 'disabled' | 'authentication-required' | 'error';
  tools: string[];
  toolCount: number;
  readOnly: boolean;
  authentication: 'none' | 'environment';
  updatedAt?: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `Request failed (${response.status})`);
  return data as T;
}

export async function fetchSkills(workspaceId: string) {
  return request<{ skills: SkillCatalogItem[]; usage: SkillUsageItem[] }>(
    `/api/capabilities/skills?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}

export async function setSkillEnabled(workspaceId: string, name: string, enabled: boolean) {
  return request<{ skill: SkillCatalogItem }>(`/api/capabilities/skills/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, enabled }),
  });
}

export async function fetchMCPServers(workspaceId: string) {
  return request<{ servers: MCPServerItem[] }>(`/api/capabilities/mcp?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export async function setMCPEnabled(id: string, enabled: boolean) {
  return request<{ server: MCPServerItem }>(`/api/capabilities/mcp/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export async function testMCPServer(id: string, workspaceId: string) {
  return request<{ success: boolean; message: string; tools: string[] }>(
    `/api/capabilities/mcp/${encodeURIComponent(id)}/test`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    },
  );
}
