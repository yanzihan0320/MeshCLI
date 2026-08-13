import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

export type CapabilityScope = 'user' | 'workspace' | 'built-in';
export type MCPTransport = 'stdio' | 'streamable-http';

export interface StoredMCPServer {
  id: string;
  name: string;
  scope: 'user' | 'workspace';
  workspaceId?: string;
  transport: MCPTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  url?: string;
  headersFromEnv?: Record<string, string>;
  toolAllowlist?: string[];
  readOnly?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SkillUsageRecord {
  workspaceId: string;
  name: string;
  source: CapabilityScope;
  agentType: 'assistant' | 'node-agent';
  activatedAt: number;
}

interface CapabilityFile {
  version: 1;
  skillEnabled: Record<string, boolean>;
  skillUsage: SkillUsageRecord[];
  mcpServers: StoredMCPServer[];
}

const EMPTY_FILE: CapabilityFile = {
  version: 1,
  skillEnabled: {},
  skillUsage: [],
  mcpServers: [],
};

export class CapabilityStore {
  private data?: CapabilityFile;
  private loading?: Promise<CapabilityFile>;

  constructor(
    readonly storagePath = resolve(
      process.env.MESHCLI_CAPABILITIES_PATH
        || (process.env.LOCALAPPDATA
          ? resolve(process.env.LOCALAPPDATA, 'MeshCLI', 'capabilities.json')
          : resolve(homedir(), '.meshcli', 'capabilities.json')),
    ),
  ) {}

  async snapshot(): Promise<CapabilityFile> {
    const data = await this.load();
    return structuredClone(data);
  }

  async skillEnabled(key: string): Promise<boolean> {
    return (await this.load()).skillEnabled[key] ?? true;
  }

  async setSkillEnabled(key: string, enabled: boolean): Promise<void> {
    const data = await this.load();
    data.skillEnabled[key] = enabled;
    await this.persist();
  }

  async recordSkillUsage(record: SkillUsageRecord): Promise<void> {
    const data = await this.load();
    data.skillUsage = [record, ...data.skillUsage
      .filter((item) => !(item.workspaceId === record.workspaceId
        && item.name === record.name
        && item.source === record.source
        && item.agentType === record.agentType))]
      .slice(0, 199);
    await this.persist();
  }

  async skillUsage(workspaceId?: string): Promise<SkillUsageRecord[]> {
    const records = (await this.load()).skillUsage;
    return records.filter((record) => !workspaceId || record.workspaceId === workspaceId);
  }

  async listMCPServers(): Promise<StoredMCPServer[]> {
    return structuredClone((await this.load()).mcpServers);
  }

  async upsertMCPServer(server: StoredMCPServer): Promise<void> {
    const data = await this.load();
    data.mcpServers = [...data.mcpServers.filter((item) => item.id !== server.id), server];
    await this.persist();
  }

  async setMCPEnabled(id: string, enabled: boolean): Promise<boolean> {
    const data = await this.load();
    const server = data.mcpServers.find((item) => item.id === id);
    if (!server) return false;
    server.enabled = enabled;
    server.updatedAt = Date.now();
    await this.persist();
    return true;
  }

  private load(): Promise<CapabilityFile> {
    this.loading ??= this.read();
    return this.loading;
  }

  private async read(): Promise<CapabilityFile> {
    if (this.data) return this.data;
    try {
      const parsed = JSON.parse(await readFile(this.storagePath, 'utf8')) as Partial<CapabilityFile>;
      this.data = {
        version: 1,
        skillEnabled: parsed.skillEnabled && typeof parsed.skillEnabled === 'object' ? parsed.skillEnabled : {},
        skillUsage: Array.isArray(parsed.skillUsage) ? parsed.skillUsage : [],
        mcpServers: Array.isArray(parsed.mcpServers) ? parsed.mcpServers : [],
      };
    } catch {
      this.data = structuredClone(EMPTY_FILE);
    }
    return this.data;
  }

  private async persist(): Promise<void> {
    const data = await this.load();
    await mkdir(dirname(this.storagePath), { recursive: true });
    const temporary = `${this.storagePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporary, this.storagePath);
  }
}

export const capabilityStore = new CapabilityStore();
