import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillRegistry } from './skillRegistry';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('SkillRegistry', () => {
  it('discovers metadata first and loads only explicitly activated safe content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meshcli-skills-'));
    roots.push(root);
    const skill = join(root, 'canvas-review');
    await mkdir(join(skill, 'references'), { recursive: true });
    await mkdir(join(skill, 'scripts'));
    await writeFile(join(skill, 'SKILL.md'), '---\nname: canvas-review\ndescription: Review a MeshCLI canvas; 画布 节点 创建\n---\n# Instructions\n');
    await writeFile(join(skill, 'references', 'rules.md'), 'reference rules');
    await writeFile(join(skill, 'scripts', 'unsafe.js'), 'throw new Error("must not run")');
    const registry = new SkillRegistry(root);
    const catalog = await registry.list('unbound-workspace');
    expect(catalog.find((item) => item.name === 'canvas-review')).toMatchObject({ source: 'built-in', enabled: true });
    const activated = await registry.activate('unbound-workspace', 'Use $canvas-review please');
    expect(activated[0]?.content).toContain('reference rules');
    expect(activated[0]?.content).not.toContain('must not run');
    const automatic = await registry.activate('unbound-workspace', '请创建三个画布节点');
    expect(automatic.map((item) => item.name)).toContain('canvas-review');
  });

  it('reports invalid frontmatter without enabling the skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meshcli-skills-'));
    roots.push(root);
    await mkdir(join(root, 'Bad Skill'));
    await writeFile(join(root, 'Bad Skill', 'SKILL.md'), '# missing frontmatter');
    const catalog = await new SkillRegistry(root).list('unbound-workspace');
    expect(catalog[0]).toMatchObject({ enabled: false });
  });
});
