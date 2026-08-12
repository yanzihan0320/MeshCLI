import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WorkspaceBinding {
  version: 1;
  workspaceId: string;
  sourceRoot: string;
  defaultWorkingDirectory: string;
  updatedAt: number;
}

interface RegistryFile {
  version: 1;
  bindings: WorkspaceBinding[];
}

function safeRelative(root: string, target: string): string {
  const value = relative(resolve(root), resolve(target));
  if (value === '') return '.';
  if (value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error('Selected directory is outside its Git repository.');
  }
  return value.replaceAll('\\', '/');
}

export class WorkspaceBindingRegistry {
  private readonly bindings = new Map<string, WorkspaceBinding>();
  private loadPromise?: Promise<void>;

  constructor(
    private readonly storagePath = resolve(
      process.env.LOCALAPPDATA || process.cwd(),
      'MeshCLI',
      'workspace-bindings.json',
    ),
  ) {}

  async list(): Promise<WorkspaceBinding[]> {
    await this.load();
    return [...this.bindings.values()].sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
  }

  async get(workspaceId: string): Promise<WorkspaceBinding | undefined> {
    await this.load();
    return this.bindings.get(workspaceId);
  }

  async resolve(workspaceId: string): Promise<WorkspaceBinding> {
    const existing = await this.get(workspaceId);
    if (existing) return existing;
    const fallback = process.env.AGENT_WORKSPACE_ROOT;
    if (!fallback) throw new Error('This MeshCLI workspace is not bound to a project directory.');
    return this.validate(workspaceId, fallback);
  }

  async bindPath(workspaceId: string, selectedPath: string): Promise<WorkspaceBinding> {
    await this.load();
    const binding = await this.validate(workspaceId, selectedPath);
    this.bindings.set(workspaceId, binding);
    await this.persist();
    return binding;
  }

  async pickAndBind(workspaceId: string): Promise<WorkspaceBinding | undefined> {
    if (process.platform !== 'win32') {
      throw new Error('Native folder selection is currently available only on Windows.');
    }
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
      '$owner = New-Object System.Windows.Forms.Form',
      '$owner.TopMost = $true',
      '$owner.ShowInTaskbar = $false',
      '$owner.Opacity = 0',
      '$owner.Show()',
      '$owner.Activate()',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = 'Select a Git workspace for MeshCLI'",
      '$dialog.ShowNewFolderButton = $false',
      'if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  [Console]::Out.Write($dialog.SelectedPath)',
      '}',
      '$dialog.Dispose()',
      '$owner.Close()',
      '$owner.Dispose()',
    ].join('\r\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-STA', '-EncodedCommand', encoded],
      { encoding: 'utf8', windowsHide: true, timeout: 10 * 60 * 1000 },
    );
    const selectedPath = stdout.trim();
    if (!selectedPath) return undefined;
    return this.bindPath(workspaceId, selectedPath);
  }

  private async validate(workspaceId: string, selectedPath: string): Promise<WorkspaceBinding> {
    if (!workspaceId.trim()) throw new Error('workspaceId is required.');
    const selected = resolve(selectedPath);
    const selectedStat = await stat(selected).catch(() => undefined);
    if (!selectedStat?.isDirectory()) throw new Error('Selected workspace directory does not exist.');
    let sourceRoot: string;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: selected,
        encoding: 'utf8',
        windowsHide: true,
      });
      sourceRoot = resolve(stdout.trim());
    } catch {
      throw new Error('Selected directory is not inside a Git working tree.');
    }
    const defaultWorkingDirectory = safeRelative(sourceRoot, selected);
    const normalized = selected.replaceAll('\\', '/').toLowerCase();
    if (normalized.includes('/.meshcli/runs/') || normalized.endsWith('/.meshcli/runs')) {
      throw new Error('A managed MeshCLI run directory cannot be used as a real workspace.');
    }
    return {
      version: 1,
      workspaceId,
      sourceRoot,
      defaultWorkingDirectory,
      updatedAt: Date.now(),
    };
  }

  private load(): Promise<void> {
    this.loadPromise ??= this.loadFile();
    return this.loadPromise;
  }

  private async loadFile(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.storagePath, 'utf8')) as RegistryFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.bindings)) return;
      for (const binding of parsed.bindings) {
        if (binding.version === 1 && binding.workspaceId) this.bindings.set(binding.workspaceId, binding);
      }
    } catch { /* first run has no registry */ }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true });
    const value: RegistryFile = { version: 1, bindings: await this.list() };
    await writeFile(this.storagePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

export const workspaceBindingRegistry = new WorkspaceBindingRegistry();
