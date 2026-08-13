import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const configPath = resolve(process.env.MESHCLI_CAPABILITIES_PATH
  || (process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'MeshCLI', 'capabilities.json')
    : join(homedir(), '.meshcli', 'capabilities.json')));

function emptyConfig() {
  return { version: 1, skillEnabled: {}, skillUsage: [], mcpServers: [] };
}

async function readConfig() {
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'));
    return { ...emptyConfig(), ...parsed, version: 1 };
  } catch {
    return emptyConfig();
  }
}

async function writeConfig(config) {
  await mkdir(dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await rename(temporary, configPath);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function has(args, name) {
  return args.includes(name);
}

function repeatedOptions(args, name) {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]] : []);
}

function inside(root, target) {
  const value = relative(resolve(root), resolve(target));
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`));
}

function parseSkill(text, folderName) {
  const block = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!block) throw new Error('SKILL.md must start with YAML frontmatter.');
  const read = (name) => block[1].match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
  const name = read('name');
  const description = read('description');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name) || name.includes('--')) throw new Error('Skill name must be lower-case kebab-case.');
  if (folderName && name !== folderName) throw new Error(`Skill name ${name} must match its directory ${folderName}.`);
  if (!description) throw new Error('Skill description is required.');
  return { name, description };
}

async function validateSkillDirectory(directory) {
  const root = resolve(directory);
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Skill source must be a real directory, not a symbolic link.');
  const skillMd = join(root, 'SKILL.md');
  const skillStat = await lstat(skillMd);
  if (!skillStat.isFile() || skillStat.isSymbolicLink()) throw new Error('SKILL.md is missing or is a symbolic link.');
  const parsed = parseSkill(await readFile(skillMd, 'utf8'), basename(root));
  let total = 0;
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${entry.name}`);
      const path = join(folder, entry.name);
      if (!inside(root, path)) throw new Error('Skill content escapes its directory.');
      if (entry.isDirectory()) await walk(path);
      else total += (await lstat(path)).size;
      if (total > 10 * 1024 * 1024) throw new Error('Installed Skill exceeds the 10MB package limit.');
    }
  }
  await walk(root);
  return { ...parsed, root, bytes: total };
}

async function discoverSkills(root, source) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      result.push({ ...(await validateSkillDirectory(join(root, entry.name))), source });
    } catch (error) {
      result.push({ name: entry.name, description: '', source, error: error.message });
    }
  }
  return result;
}

function skillRoot(scope, workspace) {
  return scope === 'workspace'
    ? resolve(workspace || process.cwd(), '.meshcli', 'skills')
    : resolve(homedir(), '.meshcli', 'skills');
}

async function cloneSource(source) {
  if (!/^(?:https?:\/\/|git@|ssh:\/\/)/i.test(source)) return { root: resolve(source), cleanup: async () => {} };
  const temporary = await mkdtemp(join(tmpdir(), 'meshcli-skill-'));
  await new Promise((resolveClone, rejectClone) => {
    const child = spawn('git', ['clone', '--depth', '1', source, temporary], { stdio: 'inherit', windowsHide: true });
    child.on('error', rejectClone);
    child.on('exit', (code) => code === 0 ? resolveClone() : rejectClone(new Error(`git clone failed (${code}).`)));
  });
  return { root: temporary, cleanup: () => rm(temporary, { recursive: true, force: true }) };
}

async function skillCommand(args) {
  const action = args[0] || 'list';
  const workspace = option(args, '--workspace', process.cwd());
  const config = await readConfig();
  if (action === 'list') {
    const skills = [
      ...await discoverSkills(skillRoot('workspace', workspace), 'workspace'),
      ...await discoverSkills(skillRoot('user', workspace), 'global'),
      ...await discoverSkills(join(packageRoot, 'apps', 'agent', 'skills'), 'built-in'),
    ];
    if (!skills.length) return console.log('No user or workspace Skills installed.');
    for (const skill of skills) {
      const enabled = config.skillEnabled[`${skill.source}:${skill.name}`] ?? true;
      console.log(`${enabled ? 'enabled ' : 'disabled'} ${skill.source.padEnd(9)} ${skill.name}${skill.error ? ` — invalid: ${skill.error}` : ` — ${skill.description}`}`);
    }
    return;
  }
  if (action === 'validate') {
    const source = args[1];
    if (!source) throw new Error('Usage: meshcli skill validate <skill-directory>');
    const result = await validateSkillDirectory(source);
    console.log(`Valid Skill: ${result.name} (${result.bytes} bytes)\n${result.description}`);
    return;
  }
  if (action === 'add') {
    const source = args[1];
    if (!source) throw new Error('Usage: meshcli skill add <directory-or-git-url> [--skill subdir] [--scope user|workspace]');
    const scope = option(args, '--scope', 'user');
    if (!['user', 'workspace'].includes(scope)) throw new Error('--scope must be user or workspace.');
    const cloned = await cloneSource(source);
    try {
      const selected = option(args, '--skill') ? resolve(cloned.root, option(args, '--skill')) : cloned.root;
      if (!inside(cloned.root, selected)) throw new Error('--skill escapes the downloaded repository.');
      const skill = await validateSkillDirectory(selected);
      const target = join(skillRoot(scope, workspace), skill.name);
      if (await lstat(target).then(() => true).catch(() => false)) throw new Error(`Skill already exists: ${skill.name}`);
      await mkdir(dirname(target), { recursive: true });
      await cp(selected, target, { recursive: true, errorOnExist: true });
      console.log(`Installed ${skill.name} to ${target}. Scripts were preserved but MeshCLI will not execute them.`);
    } finally {
      await cloned.cleanup();
    }
    return;
  }
  if (['enable', 'disable'].includes(action)) {
    const name = args[1];
    const requestedScope = option(args, '--scope', 'user');
    const scope = requestedScope === 'user' ? 'global' : requestedScope;
    if (!['global', 'workspace', 'built-in'].includes(scope)) throw new Error('--scope must be user, workspace, or built-in.');
    if (!name) throw new Error(`Usage: meshcli skill ${action} <name> [--scope user|workspace|built-in]`);
    config.skillEnabled[`${scope}:${name}`] = action === 'enable';
    await writeConfig(config);
    console.log(`${action === 'enable' ? 'Enabled' : 'Disabled'} ${scope}:${name}.`);
    return;
  }
  if (action === 'remove') {
    const name = args[1];
    const scope = option(args, '--scope', 'user');
    if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error('Usage: meshcli skill remove <name> [--scope user|workspace]');
    const root = skillRoot(scope, workspace);
    const target = join(root, name);
    if (!inside(root, target)) throw new Error('Skill target escapes its root.');
    await rm(target, { recursive: true, force: true });
    console.log(`Removed ${scope} Skill ${name}.`);
    return;
  }
  throw new Error(`Unknown skill command: ${action}`);
}

async function mcpCommand(args) {
  const action = args[0] || 'list';
  const config = await readConfig();
  if (action === 'list') {
    console.log('configured built-in  workspace-filesystem — stdio, read-only');
    for (const server of config.mcpServers.filter((item) => item.id !== 'workspace-filesystem')) {
      console.log(`${server.enabled ? 'configured' : 'disabled  '} ${server.scope.padEnd(9)} ${server.id} — ${server.transport}${server.readOnly ? ', read-only' : ''}`);
    }
    return;
  }
  if (action === 'add') {
    const id = args[1];
    if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('MCP id must be lower-case kebab-case.');
    if (config.mcpServers.some((item) => item.id === id)) throw new Error(`MCP server already exists: ${id}`);
    const transport = option(args, '--transport', 'stdio');
    if (!['stdio', 'streamable-http'].includes(transport)) throw new Error('--transport must be stdio or streamable-http.');
    const separator = args.indexOf('--');
    const invocation = separator >= 0 ? args.slice(separator + 1) : [];
    const url = option(args, '--url');
    if (transport === 'stdio' && !invocation.length) throw new Error('stdio registration requires `-- <command> [args...]`.');
    if (transport === 'streamable-http' && !url) throw new Error('HTTP registration requires --url.');
    const allowlist = (option(args, '--allow-tools', '') || '').split(',').map((item) => item.trim()).filter(Boolean);
    const now = Date.now();
    const scope = option(args, '--scope', 'user');
    if (!['user', 'workspace'].includes(scope)) throw new Error('--scope must be user or workspace.');
    const headersFromEnv = Object.fromEntries(repeatedOptions(args, '--header-env').map((entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex < 1 || separatorIndex === entry.length - 1) throw new Error('--header-env must use Header=ENV_NAME.');
      return [entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)];
    }));
    config.mcpServers.push({
      id,
      name: option(args, '--name', id),
      scope,
      workspaceId: option(args, '--workspace-id'),
      transport,
      enabled: true,
      command: invocation[0],
      args: invocation.slice(1),
      url,
      headersFromEnv,
      toolAllowlist: allowlist,
      readOnly: has(args, '--read-only'),
      createdAt: now,
      updatedAt: now,
    });
    await writeConfig(config);
    console.log(`Added MCP server ${id}. Restart the Agent service to refresh its tool catalog.`);
    return;
  }
  if (action === 'test' || action === 'tools') {
    const id = args[1];
    const builtIn = { id: 'workspace-filesystem', transport: 'stdio', enabled: true, command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{workspaceRoot}'], headersFromEnv: {}, toolAllowlist: [] };
    const server = id === builtIn.id ? (config.mcpServers.find((item) => item.id === id) || builtIn) : config.mcpServers.find((item) => item.id === id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    if (!server.enabled) throw new Error(`MCP server is disabled: ${id}`);
    const workspaceRoot = resolve(option(args, '--workspace-root', process.cwd()));
    if (server.transport === 'streamable-http') {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      for (const [header, envName] of Object.entries(server.headersFromEnv || {})) {
        if (!process.env[envName]) throw new Error(`Missing environment variable: ${envName}`);
        headers[header] = process.env[envName];
      }
      const response = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'meshcli-cli', version: '2.0.0' } } }), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`MCP HTTP server returned ${response.status}.`);
      console.log(`Connected to ${id}. Allowed tools: ${(server.toolAllowlist || []).join(', ') || '(none configured)'}`);
      return;
    }
    let command = server.command;
    let invocation = (server.args || []).map((value) => value === '{workspaceRoot}' ? workspaceRoot : value);
    if (process.platform === 'win32' && basename(command).toLowerCase() === 'npx') {
      const npxCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
      if (existsSync(npxCli)) { command = process.execPath; invocation = [npxCli, ...invocation]; }
    }
    const tools = await new Promise((resolveProbe, rejectProbe) => {
      const child = spawn(command, invocation, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let buffer = ''; let stderr = ''; let settled = false;
      const timer = setTimeout(() => finish(new Error('MCP connection timed out after 30 seconds.')), 30_000);
      const finish = (error, value = []) => { if (settled) return; settled = true; clearTimeout(timer); if (!child.killed) child.kill(); error ? rejectProbe(error) : resolveProbe(value); };
      const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
      child.on('error', (error) => finish(error));
      child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
      child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk) => { buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; for (const line of lines) { if (!line.trim().startsWith('{')) continue; try { const response = JSON.parse(line); if (response.error) return finish(new Error(response.error.message || 'MCP error')); if (response.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }); } if (response.id === 2) return finish(undefined, (response.result?.tools || []).map((tool) => tool.name)); } catch { /* log line */ } } });
      child.on('exit', (code) => { if (!settled) finish(new Error(`MCP server exited (${code}). ${stderr}`)); });
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'meshcli-cli', version: '2.0.0' } } });
    });
    const allowed = server.toolAllowlist?.length ? tools.filter((tool) => server.toolAllowlist.includes(tool)) : tools;
    console.log(`Connected to ${id}. Tools: ${allowed.join(', ') || '(none)'}`);
    return;
  }
  if (['enable', 'disable'].includes(action)) {
    const id = args[1];
    const existing = config.mcpServers.find((item) => item.id === id);
    if (!existing && id === 'workspace-filesystem') {
      const now = Date.now();
      config.mcpServers.push({ id, name: 'Workspace Filesystem (read-only)', scope: 'user', transport: 'stdio', enabled: action === 'enable', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{workspaceRoot}'], toolAllowlist: ['read_text_file', 'read_multiple_files', 'list_directory', 'directory_tree', 'search_files', 'get_file_info', 'list_allowed_directories'], readOnly: true, createdAt: now, updatedAt: now });
    } else if (!existing) throw new Error(`Unknown MCP server: ${id}`);
    else { existing.enabled = action === 'enable'; existing.updatedAt = Date.now(); }
    await writeConfig(config);
    console.log(`${action === 'enable' ? 'Enabled' : 'Disabled'} MCP server ${id}.`);
    return;
  }
  if (action === 'remove') {
    const id = args[1];
    if (id === 'workspace-filesystem') throw new Error('Built-in filesystem MCP cannot be removed; disable it instead.');
    const before = config.mcpServers.length;
    config.mcpServers = config.mcpServers.filter((item) => item.id !== id);
    if (config.mcpServers.length === before) throw new Error(`Unknown MCP server: ${id}`);
    await writeConfig(config);
    console.log(`Removed MCP server ${id}.`);
    return;
  }
  if (action === 'inspect') {
    const id = args[1];
    const server = config.mcpServers.find((item) => item.id === id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    const safe = { ...server, command: server.command ? basename(server.command) : undefined, headersFromEnv: server.headersFromEnv ? Object.keys(server.headersFromEnv) : undefined };
    console.log(JSON.stringify(safe, null, 2));
    return;
  }
  throw new Error(`Unknown mcp command: ${action}`);
}

export async function runCapabilityCommand(argv) {
  const [group, ...args] = argv;
  if (group === 'skill') await skillCommand(args);
  else if (group === 'mcp') await mcpCommand(args);
  else if (group === 'help' || group === '--help' || group === '-h') {
    console.log(`MeshCLI\n\n  meshcli skill list|validate|add|enable|disable|remove\n  meshcli mcp list|add|enable|disable|test|tools|inspect|remove\n  meshcli                 Start the built UI server`);
  } else return false;
  return true;
}
