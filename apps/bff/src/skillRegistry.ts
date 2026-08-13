import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { workspaceBindingRegistry } from './workspaceBindingRegistry';
import { CapabilityStore, capabilityStore, type SkillUsageRecord } from './capabilityStore';

export type SkillSource = 'built-in' | 'global' | 'workspace';

export interface SkillDescriptor {
  name: string;
  description: string;
  source: SkillSource;
  enabled: boolean;
  path: string;
  error?: string;
  overriddenBy?: SkillSource;
  shadows?: SkillSource[];
  lastActivatedAt?: number;
}

export interface ActivatedSkill extends SkillDescriptor {
  content: string;
}

const MAX_CONTEXT_BYTES = 500 * 1024;
const SOURCE_PRIORITY: Record<SkillSource, number> = { 'built-in': 0, global: 1, workspace: 2 };

export function parseFrontmatter(text: string): { name: string; description: string } {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) throw new Error('SKILL.md must start with YAML frontmatter.');
  const field = (name: string) => match[1].match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1]
    ?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  const name = field('name');
  const description = field('description');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name) || name.includes('--')) throw new Error('Skill name must be lower-case kebab-case.');
  if (!description || description.length > 1024) throw new Error('Skill description is required and must be at most 1024 characters.');
  return { name, description };
}

export interface SkillInstallFile {
  path: string;
  content: string;
}

async function discoverRoot(root: string, source: SkillSource): Promise<SkillDescriptor[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const skills: SkillDescriptor[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const skillPath = resolve(root, entry.name, 'SKILL.md');
    try {
      const stat = await lstat(skillPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed.');
      const parsed = parseFrontmatter(await readFile(skillPath, 'utf8'));
      if (parsed.name !== entry.name) throw new Error('Skill name must match its parent directory.');
      skills.push({ ...parsed, source, enabled: true, path: skillPath });
    } catch (error) {
      skills.push({
        name: entry.name,
        description: '',
        source,
        enabled: false,
        path: skillPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return skills;
}

function inside(root: string, target: string): boolean {
  const value = relative(resolve(root), resolve(target));
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}

async function loadSkillContent(skill: SkillDescriptor): Promise<string> {
  const root = dirname(skill.path);
  const canonicalRoot = await realpath(root);
  const files = [skill.path];
  for (const folder of ['references', 'assets']) {
    const folderPath = resolve(root, folder);
    const entries = await readdir(folderPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      files.push(resolve(folderPath, entry.name));
    }
  }
  let bytes = 0;
  const parts: string[] = [];
  for (const file of files) {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed in Skills.');
    const canonical = await realpath(file);
    if (!inside(canonicalRoot, canonical)) throw new Error('Skill content escapes its directory.');
    const content = await readFile(canonical);
    bytes += content.byteLength;
    if (bytes > MAX_CONTEXT_BYTES) throw new Error('Activated Skill content exceeds the 500KB context budget.');
    parts.push(`\n## ${basename(canonical)}\n${content.toString('utf8')}`);
  }
  return parts.join('\n');
}

export class SkillRegistry {
  constructor(
    private readonly builtInRoot = resolve(process.cwd(), 'apps', 'agent', 'skills'),
    private readonly preferences: CapabilityStore = capabilityStore,
  ) {}

  private key(skill: Pick<SkillDescriptor, 'source' | 'name'>): string {
    return `${skill.source}:${skill.name}`;
  }

  validate(skillMd: string): { name: string; description: string } {
    if (Buffer.byteLength(skillMd, 'utf8') > MAX_CONTEXT_BYTES) {
      throw new Error('SKILL.md exceeds the 500KB Skill budget.');
    }
    return parseFrontmatter(skillMd);
  }

  async install(
    workspaceId: string,
    scope: 'global' | 'workspace',
    files: SkillInstallFile[],
    overwrite = false,
  ): Promise<SkillDescriptor> {
    if (!files.length || files.length > 100) throw new Error('A Skill bundle must contain 1-100 files.');
    const skillFile = files.find((file) => file.path.replaceAll('\\', '/') === 'SKILL.md');
    if (!skillFile) throw new Error('A Skill bundle must contain SKILL.md.');
    const parsed = this.validate(skillFile.content);
    let total = 0;
    const normalized = files.map((file) => {
      const path = file.path.replaceAll('\\', '/');
      if (!/^(?:SKILL\.md|(?:references|assets)\/[a-zA-Z0-9._ -]+)$/.test(path)) {
        throw new Error(`Unsupported Skill file path: ${file.path}. Scripts and nested paths are not accepted by the UI installer.`);
      }
      total += Buffer.byteLength(file.content, 'utf8');
      return { path, content: file.content };
    });
    if (total > MAX_CONTEXT_BYTES) throw new Error('Skill bundle exceeds the 500KB context budget.');
    const root = scope === 'global'
      ? resolve(homedir(), '.meshcli', 'skills')
      : resolve((await workspaceBindingRegistry.resolve(workspaceId)).sourceRoot, '.meshcli', 'skills');
    const target = resolve(root, parsed.name);
    if (!inside(root, target)) throw new Error('Skill install target escapes the configured root.');
    if (!overwrite && await lstat(target).then(() => true).catch(() => false)) {
      throw new Error(`Skill already exists: ${parsed.name}`);
    }
    const temporary = resolve(root, `.${parsed.name}.${crypto.randomUUID()}.tmp`);
    await mkdir(temporary, { recursive: true });
    try {
      for (const file of normalized) {
        const destination = resolve(temporary, file.path);
        if (!inside(temporary, destination)) throw new Error('Skill file escapes its install directory.');
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.content, 'utf8');
      }
      if (overwrite) await rm(target, { recursive: true, force: true });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    const installed = (await discoverRoot(root, scope)).find((skill) => skill.name === parsed.name);
    if (!installed) throw new Error('Installed Skill could not be rediscovered.');
    return installed;
  }

  async remove(workspaceId: string, name: string): Promise<void> {
    const skill = (await this.list(workspaceId)).find((candidate) => candidate.name === name);
    if (!skill) throw new Error(`Unknown Skill: ${name}`);
    if (skill.source === 'built-in') throw new Error('Built-in Skills cannot be removed; disable them instead.');
    const root = dirname(dirname(skill.path));
    const target = dirname(skill.path);
    if (!inside(root, target)) throw new Error('Skill removal target escapes its root.');
    await rm(target, { recursive: true, force: true });
  }

  async list(workspaceId: string): Promise<SkillDescriptor[]> {
    const roots: Array<[string, SkillSource]> = [
      [this.builtInRoot, 'built-in'],
      [resolve(homedir(), '.meshcli', 'skills'), 'global'],
    ];
    const binding = await workspaceBindingRegistry.resolve(workspaceId).catch(() => undefined);
    if (binding) roots.push([resolve(binding.sourceRoot, '.meshcli', 'skills'), 'workspace']);
    const discovered = (await Promise.all(roots.map(([root, source]) => discoverRoot(root, source)))).flat();
    const merged = new Map<string, SkillDescriptor>();
    const sources = new Map<string, SkillSource[]>();
    for (const skill of discovered.sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source])) {
      const previous = merged.get(skill.name);
      if (previous) previous.overriddenBy = skill.source;
      sources.set(skill.name, [...(sources.get(skill.name) ?? []), skill.source]);
      merged.set(skill.name, {
        ...skill,
        enabled: skill.enabled && await this.preferences.skillEnabled(this.key(skill)),
      });
    }
    const usage = await this.preferences.skillUsage(workspaceId);
    return [...merged.values()].map((skill) => ({
      ...skill,
      shadows: (sources.get(skill.name) ?? []).filter((source) => source !== skill.source),
      lastActivatedAt: usage.find((record) => record.name === skill.name && record.source === skill.source)?.activatedAt,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async setEnabled(workspaceId: string, name: string, enabled: boolean): Promise<SkillDescriptor> {
    const skill = (await this.list(workspaceId)).find((candidate) => candidate.name === name);
    if (!skill) throw new Error(`Unknown Skill: ${name}`);
    if (skill.error) throw new Error(`Invalid Skill cannot be enabled: ${skill.error}`);
    await this.preferences.setSkillEnabled(this.key(skill), enabled);
    return { ...skill, enabled };
  }

  async usage(workspaceId: string): Promise<SkillUsageRecord[]> {
    return this.preferences.skillUsage(workspaceId);
  }

  async activate(
    workspaceId: string,
    message: string,
    agentType: SkillUsageRecord['agentType'] = 'assistant',
  ): Promise<ActivatedSkill[]> {
    const skills = await this.list(workspaceId);
    const explicit = [...message.matchAll(/(?:^|\s)\$([a-z0-9][a-z0-9-]{0,63})\b/g)].map((match) => match[1]);
    const normalized = message.toLocaleLowerCase();
    const selected = skills.filter((skill) => skill.enabled && (
      explicit.includes(skill.name)
      || (explicit.length === 0 && [skill.name, ...skill.description.toLocaleLowerCase().split(/[^\p{L}\p{N}-]+/u)]
        .filter((token) => token.length >= 4 || (/[^\p{ASCII}]/u.test(token) && token.length >= 2))
        .some((token) => normalized.includes(token)))
    ));
    const activated: ActivatedSkill[] = [];
    for (const skill of selected) {
      activated.push({ ...skill, content: await loadSkillContent(skill) });
      await this.preferences.recordSkillUsage({
        workspaceId,
        name: skill.name,
        source: skill.source,
        agentType,
        activatedAt: Date.now(),
      });
    }
    return activated;
  }
}

export const skillRegistry = new SkillRegistry();
