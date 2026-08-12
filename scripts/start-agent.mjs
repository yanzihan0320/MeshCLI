import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agentDir = join(repoRoot, 'apps', 'agent');
const isWindows = process.platform === 'win32';
const venvCommand = join(agentDir, '.venv', isWindows ? 'Scripts/langgraph.exe' : 'bin/langgraph');
const forceGlobal = process.argv.includes('--global');
const command = !forceGlobal && existsSync(venvCommand) ? venvCommand : 'langgraph';
const port = process.env.LANGGRAPH_PORT ?? '8133';

const result = spawnSync(command, ['dev', '--port', port], {
  cwd: agentDir,
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

