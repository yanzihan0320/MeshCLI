import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { CapabilityStore, capabilityStore, type StoredMCPServer } from './capabilityStore';
import { WorkspaceBindingRegistry, workspaceBindingRegistry } from './workspaceBindingRegistry';

const FILESYSTEM_TOOLS = [
  'read_text_file',
  'read_multiple_files',
  'list_directory',
  'directory_tree',
  'search_files',
  'get_file_info',
  'list_allowed_directories',
];

export interface MCPServerStatus {
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

function builtInFilesystem(enabled = process.env.MESHCLI_FILESYSTEM_MCP_ENABLED !== 'false'): StoredMCPServer {
  const now = Date.now();
  return {
    id: 'workspace-filesystem',
    name: 'Workspace Filesystem (read-only)',
    scope: 'user',
    transport: 'stdio',
    enabled,
    command: process.env.MESHCLI_FILESYSTEM_MCP_COMMAND || 'npx',
    args: ['-y', process.env.MESHCLI_FILESYSTEM_MCP_PACKAGE || '@modelcontextprotocol/server-filesystem', '{workspaceRoot}'],
    toolAllowlist: FILESYSTEM_TOOLS,
    readOnly: true,
    createdAt: now,
    updatedAt: now,
  };
}

function publicStatus(server: StoredMCPServer, builtIn: boolean): MCPServerStatus {
  const missingEnvironment = Object.values(server.headersFromEnv ?? {}).some((name) => !process.env[name]);
  const tools = server.toolAllowlist ?? [];
  return {
    id: server.id,
    name: server.name,
    scope: builtIn ? 'built-in' : server.scope,
    transport: server.transport,
    enabled: server.enabled,
    status: !server.enabled ? 'disabled' : missingEnvironment ? 'authentication-required' : 'configured',
    tools,
    toolCount: tools.length,
    readOnly: Boolean(server.readOnly),
    authentication: Object.keys(server.headersFromEnv ?? {}).length ? 'environment' : 'none',
    updatedAt: server.updatedAt,
  };
}

function commandForPlatform(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform === 'win32' && basename(command).toLowerCase() === 'npx') {
    const npxCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (existsSync(npxCli)) return { command: process.execPath, args: [npxCli, ...args] };
  }
  return { command, args };
}

export class MCPCapabilityRegistry {
  constructor(
    private readonly store: CapabilityStore = capabilityStore,
    private readonly bindings: WorkspaceBindingRegistry = workspaceBindingRegistry,
  ) {}

  async registrations(workspaceId?: string): Promise<Array<{ server: StoredMCPServer; builtIn: boolean }>> {
    const stored = await this.store.listMCPServers();
    const storedFilesystem = stored.find((server) => server.id === 'workspace-filesystem');
    const filesystem = storedFilesystem ?? builtInFilesystem();
    const others = stored.filter((server) => server.id !== 'workspace-filesystem')
      .filter((server) => server.scope !== 'workspace' || server.workspaceId === workspaceId);
    return [{ server: filesystem, builtIn: true }, ...others.map((server) => ({ server, builtIn: false }))];
  }

  async list(workspaceId?: string): Promise<MCPServerStatus[]> {
    return (await this.registrations(workspaceId)).map(({ server, builtIn }) => publicStatus(server, builtIn));
  }

  async setEnabled(id: string, enabled: boolean): Promise<MCPServerStatus> {
    const registration = (await this.registrations()).find(({ server }) => server.id === id);
    if (!registration) throw new Error(`Unknown MCP server: ${id}`);
    if (registration.builtIn && !(await this.store.listMCPServers()).some((server) => server.id === id)) {
      await this.store.upsertMCPServer({ ...registration.server, enabled, updatedAt: Date.now() });
    } else {
      await this.store.setMCPEnabled(id, enabled);
    }
    const updated = { ...registration.server, enabled, updatedAt: Date.now() };
    return publicStatus(updated, registration.builtIn);
  }

  async test(id: string, workspaceId?: string): Promise<{ success: boolean; message: string; tools: string[] }> {
    const registration = (await this.registrations(workspaceId)).find(({ server }) => server.id === id);
    if (!registration) throw new Error(`Unknown MCP server: ${id}`);
    const server = registration.server;
    if (!server.enabled) return { success: false, message: 'MCP server is disabled.', tools: [] };
    let workspaceRoot = '';
    if (server.args?.includes('{workspaceRoot}')) {
      if (!workspaceId) throw new Error('workspaceId is required for the Workspace Filesystem MCP server.');
      workspaceRoot = (await this.bindings.resolve(workspaceId)).sourceRoot;
    }
    const tools = server.transport === 'stdio'
      ? await this.probeStdio(server, workspaceRoot)
      : await this.probeHttp(server);
    const allowed = server.toolAllowlist?.length ? tools.filter((tool) => server.toolAllowlist!.includes(tool)) : tools;
    return { success: true, message: `Connected. ${allowed.length} allowed tools discovered.`, tools: allowed };
  }

  private probeStdio(server: StoredMCPServer, workspaceRoot: string): Promise<string[]> {
    if (!server.command) throw new Error('stdio MCP server has no command.');
    const args = (server.args ?? []).map((argument) => argument === '{workspaceRoot}' ? workspaceRoot : argument);
    return new Promise((resolveProbe, rejectProbe) => {
      const invocation = commandForPlatform(server.command!, args);
      const child = spawn(invocation.command, invocation.args, {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const timer = setTimeout(() => finish(new Error('MCP connection timed out after 30 seconds.')), 30_000);
      let settled = false;
      let stdout = '';
      let stderr = '';
      const finish = (error?: Error, tools: string[] = []) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!child.killed) child.kill();
        if (error) rejectProbe(error);
        else resolveProbe(tools);
      };
      const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
      child.on('error', (error) => finish(error));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-2_000); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim().startsWith('{')) continue;
          try {
            const response = JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name?: string }> }; error?: { message?: string } };
            if (response.error) return finish(new Error(response.error.message || 'MCP initialization failed.'));
            if (response.id === 1) {
              send({ jsonrpc: '2.0', method: 'notifications/initialized' });
              send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
            }
            if (response.id === 2) return finish(undefined, (response.result?.tools ?? []).map((tool) => tool.name ?? '').filter(Boolean));
          } catch { /* ignore server log lines */ }
        }
      });
      child.on('exit', (code) => {
        if (!settled) finish(new Error(`MCP server exited before initialization (${code ?? 'unknown'}). ${stderr.trim()}`.trim()));
      });
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'meshcli-doctor', version: '2.0.0' },
        },
      });
    });
  }

  private async probeHttp(server: StoredMCPServer): Promise<string[]> {
    if (!server.url) throw new Error('HTTP MCP server has no URL.');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    for (const [header, envName] of Object.entries(server.headersFromEnv ?? {})) {
      const value = process.env[envName];
      if (!value) throw new Error(`Missing environment variable required by MCP authentication: ${envName}`);
      headers[header] = value;
    }
    const response = await fetch(server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'meshcli-doctor', version: '2.0.0' } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`MCP HTTP server returned ${response.status}.`);
    return server.toolAllowlist ?? [];
  }
}

export const mcpCapabilityRegistry = new MCPCapabilityRegistry();
