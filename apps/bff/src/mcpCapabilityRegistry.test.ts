import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CapabilityStore } from './capabilityStore';
import { MCPCapabilityRegistry } from './mcpCapabilityRegistry';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('MCPCapabilityRegistry', () => {
  it('keeps commands and URLs out of the public catalog and persists enablement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meshcli-mcp-'));
    roots.push(root);
    const store = new CapabilityStore(join(root, 'capabilities.json'));
    await store.upsertMCPServer({
      id: 'docs', name: 'Docs', scope: 'user', transport: 'streamable-http', enabled: true,
      url: 'https://secret.example/mcp', headersFromEnv: { Authorization: 'DOCS_TOKEN' },
      toolAllowlist: ['search_docs'], readOnly: true, createdAt: 1, updatedAt: 1,
    });
    const registry = new MCPCapabilityRegistry(store);
    const catalog = await registry.list('workspace-1');
    expect(catalog.find((server) => server.id === 'docs')).toMatchObject({
      transport: 'streamable-http', readOnly: true, tools: ['search_docs'],
    });
    expect(JSON.stringify(catalog)).not.toContain('secret.example');
    expect((await registry.setEnabled('docs', false)).enabled).toBe(false);
    expect((await registry.list()).find((server) => server.id === 'docs')?.status).toBe('disabled');
  });
});
