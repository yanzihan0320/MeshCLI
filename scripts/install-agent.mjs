import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agentDir = join(repoRoot, 'apps', 'agent');
const isWindows = process.platform === 'win32';
const candidates = process.env.MESHCLI_PYTHON
  ? [[process.env.MESHCLI_PYTHON, []]]
  : isWindows
    ? [['py', ['-3.12']], ['py', ['-3.11']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: agentDir, stdio: 'inherit', shell: false, ...options });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}

let selected;
for (const [command, prefix] of candidates) {
  const probe = spawnSync(command, [...prefix, '--version'], { cwd: agentDir, encoding: 'utf8', shell: false });
  const text = `${probe.stdout ?? ''} ${probe.stderr ?? ''}`;
  const match = text.match(/Python\s+(\d+)\.(\d+)/);
  if (probe.status === 0 && match && (Number(match[1]) > 3 || Number(match[2]) >= 11)) {
    selected = [command, prefix];
    break;
  }
}

if (!selected) {
  console.error('MeshCLI Agent requires Python 3.11 or newer. Set MESHCLI_PYTHON to a compatible executable.');
  process.exit(1);
}

const [python, prefix] = selected;
run(python, [...prefix, '-m', 'venv', '.venv']);
const venvPython = join(agentDir, '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');
run(venvPython, ['-m', 'pip', 'install', '-U', 'pip']);
run(venvPython, ['-m', 'pip', 'install', '-e', '.[dev]']);
