import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, Trash2, Download, Upload, Check, Pencil, Github, FileText, FolderGit2, PanelsTopLeft } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useFlowStore } from '../../stores/flowStore';
import { useChatStore } from '../../stores/chatStore';
import { exportWorkspace, importWorkspace } from '../../hooks/usePersistence';
import { exportMarkdown } from '../../utils/markdownExport';
import { nodeRunClient, type WorkspaceBinding } from '../../services/agent/nodeRunClient';

export function WorkspaceSelector() {
  const { t } = useTranslation();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [binding, setBinding] = useState<WorkspaceBinding>();
  const [bindingError, setBindingError] = useState<string>();
  const [workspaceError, setWorkspaceError] = useState<string>();
  const [isPickingFolder, setIsPickingFolder] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const displayWorkspaceName = useCallback((name: string) => {
    if (name === 'My Workspace' || name === 'Workspace' || name === '我的工作区' || name === '工作区') return t('workspace.defaultName');
    if (name === 'New Workspace' || name === '新建工作区') return t('workspace.newWorkspaceName');
    if (name === 'Imported Workspace' || name === '导入的工作区') return t('workspace.importedWorkspace');
    return name;
  }, [t]);

  useEffect(() => {
    let current = true;
    if (!activeWorkspaceId) {
      setBinding(undefined);
      return () => { current = false; };
    }
    setBindingError(undefined);
    setBinding(undefined);
    nodeRunClient.getWorkspaceBinding(activeWorkspaceId)
      .then((next) => { if (current) setBinding(next); })
      .catch((error) => { if (current) setBindingError(error instanceof Error ? error.message : String(error)); });
    return () => { current = false; };
  }, [activeWorkspaceId]);

  const handlePickRepository = useCallback(async () => {
    if (!activeWorkspaceId || isPickingFolder) return;
    setIsPickingFolder(true);
    setBindingError(undefined);
    try {
      const next = await nodeRunClient.pickWorkspaceBinding(activeWorkspaceId);
      if (next) setBinding(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const manualPath = window.prompt(t('workspace.folderPickerFallback', { message }));
      if (manualPath?.trim()) {
        try {
          setBinding(await nodeRunClient.bindWorkspace(activeWorkspaceId, manualPath));
          return;
        } catch (manualError) {
          setBindingError(manualError instanceof Error ? manualError.message : String(manualError));
          return;
        }
      }
      setBindingError(message);
    } finally {
      setIsPickingFolder(false);
    }
  }, [activeWorkspaceId, isPickingFolder, t]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  // Focus input when editing starts
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = useCallback(() => {
    if (!active) return;
    setEditValue(displayWorkspaceName(active.name));
    setEditing(true);
  }, [active, displayWorkspaceName]);

  const commitRename = useCallback(() => {
    if (!active) return;
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== active.name) {
      renameWorkspace(active.id, trimmed);
    }
    setEditing(false);
  }, [active, editValue, renameWorkspace]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        commitRename();
      } else if (e.key === 'Escape') {
        setEditing(false);
      }
    },
    [commitRename]
  );

  const handleSwitch = useCallback(
    (id: string) => {
      if (id !== activeWorkspaceId) {
        switchWorkspace(id);
      }
      setDropdownOpen(false);
    },
    [activeWorkspaceId, switchWorkspace]
  );

  const handleNew = useCallback(() => {
    const baseName = t('workspace.newWorkspaceName');
    const existingNames = new Set(useWorkspaceStore.getState().workspaces.map((workspace) => workspace.name));
    let nextName = baseName;
    let suffix = 2;
    while (existingNames.has(nextName)) {
      nextName = `${baseName} ${suffix}`;
      suffix += 1;
    }

    try {
      setWorkspaceError(undefined);
      const id = createWorkspace(nextName);
      const created = useWorkspaceStore.getState().workspaces.some((workspace) => workspace.id === id);
      if (!created) throw new Error(t('workspace.createFailed'));
      setDropdownOpen(false);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : t('workspace.createFailed'));
    }
  }, [createWorkspace, t]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      deleteWorkspace(id, t('workspace.defaultName'));
    },
    [deleteWorkspace, t]
  );

  const handleRenameFromDropdown = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      // Switch to the workspace first if it's not active, then start editing
      if (id !== activeWorkspaceId) {
        switchWorkspace(id);
      }
      setDropdownOpen(false);
      // Small delay so the dropdown closes and the name is visible before editing
      setTimeout(() => {
        const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === id);
        if (ws) {
          setEditValue(displayWorkspaceName(ws.name));
          setEditing(true);
        }
      }, 50);
    },
    [activeWorkspaceId, displayWorkspaceName, switchWorkspace]
  );

  const handleImport = useCallback(() => fileRef.current?.click(), []);

  const handleExportMarkdown = useCallback(() => {
    const flow = useFlowStore.getState();
    const chat = useChatStore.getState();
    const workspace = useWorkspaceStore.getState().getActiveWorkspace();
    
    // Get selected nodes
    const selectedNodes = flow.nodes.filter(n => n.selected);
    const selectedIds = selectedNodes.length > 0 ? selectedNodes.map(n => n.id) : undefined;
    
    exportMarkdown(
      flow.nodes,
      flow.edges,
      chat.conversations,
      workspace?.name ?? 'MeshCLI Workspace',
      { selectedNodeIds: selectedIds }
    );
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) importWorkspace(file);
      e.target.value = '';
    },
    []
  );

  return (
    <div className="relative z-[100] flex h-12 shrink-0 select-none items-center border-b border-border/75 bg-surface-900/82 px-4 shadow-[0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-2xl">
      {/* Left: workspace name + dropdown */}
      <div className="relative" ref={dropdownRef}>
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            className="w-48 rounded-lg border border-border-hover bg-surface-800 px-2.5 py-1 text-[13px] text-text-primary outline-none focus:border-accent-500"
          />
        ) : (
          <div className="group/name flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDropdownOpen((o) => !o)}
              aria-expanded={dropdownOpen}
              aria-haspopup="listbox"
              className={`flex min-w-52 items-center gap-2.5 rounded-xl border px-3 py-1.5 text-[13px] font-medium transition-all ${dropdownOpen ? 'border-accent-400/35 bg-accent-500/8 text-text-primary shadow-[0_0_0_3px_var(--selection-ring)]' : 'border-border/80 bg-surface-800/58 text-text-secondary hover:border-border-hover hover:bg-surface-800/85 hover:text-text-primary'}`}
            >
              <PanelsTopLeft size={15} className="shrink-0 text-accent-400" />
              <span className="min-w-0 flex-1 truncate text-left">{active ? displayWorkspaceName(active.name) : t('workspace.defaultName')}</span>
              <ChevronDown size={14} className={`shrink-0 text-text-muted transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            <button
              onClick={startEditing}
              className="rounded-lg p-1.5 text-text-muted opacity-0 transition-all hover:bg-surface-800 hover:text-text-primary group-hover/name:opacity-100 focus:opacity-100"
              title={t('workspace.renameWorkspace')}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={handleNew}
              className="rounded-lg border border-transparent p-1.5 text-text-muted transition-colors hover:border-accent-400/20 hover:bg-accent-500/10 hover:text-accent-400"
              title={t('workspace.newWorkspace')}
              aria-label={t('workspace.newWorkspace')}
            >
              <Plus size={14} />
            </button>
          </div>
        )}

        {dropdownOpen && (
          <div className="mesh-panel absolute left-0 top-full z-[120] mt-2.5 w-72 overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-border/70 px-3.5 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{t('workspace.workspaceList')}</span>
              <span className="rounded-full bg-surface-800/80 px-2 py-0.5 text-[10px] tabular-nums text-text-muted">{t('workspace.workspaceCount', { count: workspaces.length })}</span>
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5" role="listbox" aria-label={t('workspace.workspaceList')}>
              {workspaces.map((ws) => (
                <div key={ws.id} className={`group flex items-center rounded-xl px-1 py-0.5 text-[13px] transition-colors ${ws.id === activeWorkspaceId ? 'bg-accent-500/9 text-text-primary' : 'text-text-secondary hover:bg-surface-800/80 hover:text-text-primary'}`}>
                  <button
                    type="button"
                    onClick={() => handleSwitch(ws.id)}
                    role="option"
                    aria-selected={ws.id === activeWorkspaceId}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left"
                    aria-current={ws.id === activeWorkspaceId ? 'true' : undefined}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/70 bg-surface-900/65">
                      {ws.id === activeWorkspaceId ? <Check size={13} className="text-accent-400" /> : <PanelsTopLeft size={11} className="text-text-muted" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{displayWorkspaceName(ws.name)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleRenameFromDropdown(e, ws.id)}
                    className="rounded-md p-1 text-text-muted opacity-0 transition-all hover:bg-surface-700 hover:text-text-primary group-hover:opacity-100 focus:opacity-100"
                    title={t('workspace.renameWorkspace')}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, ws.id)}
                    className="rounded-md p-1 text-text-muted opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
                    title={t('workspace.deleteWorkspace')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-border/70 p-1.5">
              <button
                onClick={handleNew}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-accent-500/9 hover:text-accent-400"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-md border border-accent-400/20 bg-accent-500/8"><Plus size={12} /></span>
                <span>{t('workspace.newWorkspace')}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {workspaceError && (
        <div role="alert" className="mesh-panel absolute left-4 top-12 z-50 max-w-md rounded-xl border-red-500/30 px-3 py-2 text-xs text-red-400">
          {workspaceError}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      <button
        type="button"
        onClick={handlePickRepository}
        disabled={!activeWorkspaceId || isPickingFolder}
        className={`mr-3 flex max-w-80 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] transition-colors ${binding ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-400' : 'border-amber-500/25 bg-amber-500/5 text-amber-400'} disabled:opacity-40`}
        title={bindingError || binding?.sourceRoot || t('workspace.bindRepository')}
      >
        <FolderGit2 size={13} />
        <span className="truncate">{isPickingFolder ? t('workspace.selectingRepository') : binding ? `${binding.sourceRoot}${binding.defaultWorkingDirectory ? ` · ${binding.defaultWorkingDirectory}` : ''}` : t('workspace.bindRepository')}</span>
      </button>
      {bindingError && (
        <div role="alert" className="mesh-panel absolute right-24 top-12 z-50 max-w-md rounded-xl border-red-500/30 px-3 py-2 text-xs text-red-400">
          {bindingError}
        </div>
      )}

      {/* Right: export + import + github */}
      <div className="flex items-center gap-0.5 rounded-xl border border-border/70 bg-surface-800/60 p-0.5">
        <button
          onClick={handleExportMarkdown}
          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-700 hover:text-text-primary"
          title={t('workspace.exportMarkdown')}
        >
          <FileText size={15} />
        </button>
        <button
          onClick={exportWorkspace}
          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-700 hover:text-text-primary"
          title={t('workspace.exportWorkspace')}
        >
          <Download size={15} />
        </button>
        <button
          onClick={handleImport}
          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-700 hover:text-text-primary"
          title={t('workspace.importWorkspace')}
        >
          <Upload size={15} />
        </button>
        <a
          href="https://github.com/yanzihan0320/MeshCLI"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-700 hover:text-text-primary"
          title={t('workspace.github')}
        >
          <Github size={15} />
        </a>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}
