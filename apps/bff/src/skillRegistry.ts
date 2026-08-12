import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { workspaceBindingRegistry } from './workspaceBindingRegistry';

export type SkillSource = 'built-in' | 'global' | 'workspace';

export interface SkillDescriptor {
  name: string;
  description: string;
  source: SkillSource;
  enabled: boolean;
  path: string;
  error?: string;
}

export interface ActivatedSkill extends SkillDescriptor {
  content: string;
}

const MAX_CONTEXT_BYTES = 500 * 1024;
const SOURCE_PRIORITY: Record<SkillSource, number> = { 'built-in': 0, global: 1, workspace: 2 };

function parseFrontmatter(text: string): { name: string; description: string } {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) throw new Error('SKILL.md must start with YAML frontmatter.');
  const field = (name: string) => match[1].match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1]
    ?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  const name = field('name');
  const description = field('description');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('Skill name must be lower-case kebab-case.');
  if (!description) throw new Error('Skill description is required.');
  return { name, description };
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
  constructor(private readonly builtInRoot = resolve(process.cwd(), 'apps', 'agent', 'skills')) {}

  async list(workspaceId: string): Promise<SkillDescriptor[]> {
    const roots: Array<[string, SkillSource]> = [
      [this.builtInRoot, 'built-in'],
      [resolve(homedir(), '.meshcli', 'skills'), 'global'],
    ];
    const binding = await workspaceBindingRegistry.resolve(workspaceId).catch(() => undefined);
    if (binding) roots.push([resolve(binding.sourceRoot, '.meshcli', 'skills'), 'workspace']);
    const discovered = (await Promise.all(roots.map(([root, source]) => discoverRoot(root, source)))).flat();
    const merged = new Map<string, SkillDescriptor>();
    for (const skill of discovered.sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source])) {
      merged.set(skill.name, skill);
    }
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async activate(workspaceId: string, message: string): Promise<ActivatedSkill[]> {
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
    }
    return activated;
  }
}

export const skillRegistry = new SkillRegistry();
