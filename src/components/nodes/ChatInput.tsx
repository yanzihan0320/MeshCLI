import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, ChevronDown, FolderTree, Link2, MessageCircle, Paperclip, Play, Save, Send, Square, X } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { nodeRunClient } from '../../services/agent/nodeRunClient';
import type { AgentRunOptions } from '../../hooks/useNodeAgentRun';

export type InputMode = 'chat' | 'agent';

interface ChatInputProps {
  nodeId: string;
  onSend: (message: string, images: File[]) => void;
  onCancel: () => void;
  onRunAgent: (prompt: string, files?: File[], options?: AgentRunOptions) => void;
  onCancelAgent: () => void;
  isAgentRunning: boolean;
  supportsVision?: boolean;
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
}

export function ChatInput({
  nodeId,
  onSend,
  onCancel,
  onRunAgent,
  onCancelAgent,
  isAgentRunning,
  supportsVision = true,
  mode,
  onModeChange,
}: ChatInputProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [agentModelId, setAgentModelId] = useState('');
  const [agentModels, setAgentModels] = useState<Array<{ id: string; name: string }>>([]);
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [referenceNodeIds, setReferenceNodeIds] = useState<string[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeWorkspace = useWorkspaceStore((state) => state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId));
  const flowNodes = useFlowStore((state) => state.nodes);
  const referenceOptions = useMemo(() => flowNodes
    .filter((node) => node.id !== nodeId)
    .map((node) => ({ id: node.id, title: node.data.topic || node.data.label || t('node.untitled') })), [flowNodes, nodeId, t]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isStreaming = useChatStore(
    (s) => s.conversations[nodeId]?.isStreaming ?? false
  );
  const isBusy = mode === 'agent' ? isAgentRunning : isStreaming;

  useEffect(() => {
    if (mode !== 'agent') return;
    let active = true;
    nodeRunClient.getAgentModels().then((result) => {
      if (!active) return;
      setAgentModels(result.models);
      setAgentModelId((current) => current || activeWorkspace?.defaultAgentModelId || result.defaultModelId);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [activeWorkspace?.defaultAgentModelId, mode]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (isBusy) return;

    if (mode === 'agent') {
      if (!trimmed) return;
      onRunAgent(trimmed, images, { agentModelId: agentModelId || undefined, workingDirectory, referenceNodeIds });
      setInput('');
      setImages([]);
      return;
    }

    if (!trimmed && images.length === 0) return;

    onSend(trimmed, images);
    setInput('');
    setImages([]);
  }, [agentModelId, input, images, isBusy, mode, onRunAgent, onSend, referenceNodeIds, workingDirectory]);

  const selectMode = (nextMode: InputMode) => {
    onModeChange(nextMode);
    setModeMenuOpen(false);
    setImages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const files = Array.from(e.target.files).filter((f) => (
      mode === 'agent' || f.type.startsWith('image/')
    ));

    setImages((prev) => [...prev, ...files]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => (
      mode === 'agent' || f.type.startsWith('image/')
    ));

    setImages((prev) => [...prev, ...files]);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (mode === 'agent') return;
    const items = e.clipboardData.items;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          setImages((prev) => [...prev, file]);
        }
      }
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div
      className={`nodrag nopan border-t border-border/70 bg-surface-900/55 p-2.5 transition ${
        isDragging ? 'bg-surface-700' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {mode === 'chat' && images.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {images.map((file, i) => (
            <div
              key={i}
              className="relative w-16 h-16 rounded-md overflow-hidden border border-border-hover"
            >
              <img
                src={URL.createObjectURL(file)}
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => removeImage(i)}
                className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {mode === 'agent' && images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {images.map((file, index) => (
            <span key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-lg border border-border bg-surface-800 px-2 py-1 text-[10px] text-text-secondary">
              <Paperclip size={10} /> {file.name}
              <button type="button" onClick={() => removeImage(index)} aria-label={t('chat.removeAttachment', { name: file.name })}><X size={10} /></button>
            </span>
          ))}
        </div>
      )}

      {mode === 'agent' && (
        <div className="mb-2 rounded-xl border border-border/70 bg-surface-950/45 p-2 text-[10px]">
          <button type="button" onClick={() => setOptionsOpen((open) => !open)} className="flex w-full items-center gap-1.5 text-text-secondary hover:text-text-primary">
            <FolderTree size={11} /> {t('agentRun.options')}
            <span className="ml-auto text-text-muted">{agentModelId || t('agentRun.model')} · {workingDirectory || t('agentRun.repositoryRoot')}{referenceNodeIds.length ? ` · ${t('agentRun.referenceCount', { count: referenceNodeIds.length })}` : ''}</span>
            <ChevronDown size={11} className={optionsOpen ? 'rotate-180' : ''} />
          </button>
          {optionsOpen && (
            <div className="mt-2 grid gap-2 border-t border-border pt-2">
              <label className="grid grid-cols-[72px_1fr_auto] items-center gap-1.5 text-text-muted">
                <span>{t('agentRun.model')}</span>
                <select value={agentModelId} onChange={(event) => setAgentModelId(event.target.value)} className="rounded border border-border bg-surface-800 px-2 py-1 text-text-primary outline-none">
                  {agentModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
                <button type="button" title={t('agentRun.saveWorkspaceDefault')} disabled={!activeWorkspaceId || !agentModelId} onClick={() => activeWorkspaceId && useWorkspaceStore.getState().setDefaultAgentModel(activeWorkspaceId, agentModelId)} className="rounded p-1 text-text-muted hover:text-accent-400 disabled:opacity-30"><Save size={12} /></button>
              </label>
              <label className="grid grid-cols-[96px_1fr] items-center gap-1.5 text-text-muted">
                <span>{t('agentRun.workingSubdirectory')}</span>
                <input value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} placeholder={t('agentRun.workingSubdirectoryPlaceholder')} className="rounded border border-border bg-surface-800 px-2 py-1 text-text-primary outline-none" />
                <span />
                <span className="leading-4 text-text-muted">{t('agentRun.workingSubdirectoryHelp')}</span>
              </label>
              {referenceOptions.length > 0 && (
                <div className="grid grid-cols-[72px_1fr] gap-1.5 text-text-muted">
                  <span className="flex items-center gap-1"><Link2 size={10} /> {t('agentRun.context')}</span>
                  <div className="max-h-24 space-y-1 overflow-y-auto rounded border border-border bg-surface-800 p-1.5">
                    {referenceOptions.map((option) => (
                      <label key={option.id} className="flex items-center gap-1.5 text-text-secondary">
                        <input type="checkbox" checked={referenceNodeIds.includes(option.id)} onChange={() => setReferenceNodeIds((ids) => ids.includes(option.id) ? ids.filter((id) => id !== option.id) : [...ids, option.id])} />
                        <span className="truncate">{option.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={mode === 'agent' ? t('agentRun.promptPlaceholder') : t('chat.askSomething')}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border bg-surface-800/80 px-3 py-2 text-sm text-text-primary placeholder-text-muted transition-colors focus:border-accent-500/60 focus:bg-surface-800 focus:outline-none"
          style={{ minHeight: '36px', maxHeight: '100px' }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height =
              Math.min(target.scrollHeight, 100) + 'px';
          }}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept={mode === 'agent' ? '.txt,.md,.mdx,.json,.yaml,.yml,.toml,.csv,.ts,.tsx,.js,.jsx,.py,.java,.go,.rs,.css,.html,.xml,.sql,.sh,.ps1' : 'image/*'}
          multiple
          hidden
          onChange={handleFileSelect}
        />

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setModeMenuOpen((open) => !open)}
            className={`flex h-9 items-center gap-1 rounded-xl border px-2.5 text-[10px] font-medium transition-colors ${
              mode === 'agent'
                ? 'border-accent-500/50 bg-accent-500/15 text-accent-400'
                : 'border-border bg-surface-800 text-text-secondary hover:bg-surface-700'
            }`}
            aria-label={t('agentRun.selectMode')}
            aria-expanded={modeMenuOpen}
          >
            {mode === 'agent' ? <Bot size={13} /> : <MessageCircle size={13} />}
            <span>{mode === 'agent' ? t('agentRun.agentMode') : t('agentRun.chatMode')}</span>
            <ChevronDown size={11} />
          </button>
          {modeMenuOpen && (
            <div className="mesh-panel absolute bottom-11 left-0 z-50 w-52 overflow-hidden rounded-2xl p-1.5">
              <button
                type="button"
                onClick={() => selectMode('chat')}
                className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-surface-800"
              >
                <MessageCircle size={14} className="mt-0.5 text-text-secondary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-text-primary">{t('agentRun.chatMode')}</span>
                  <span className="block text-[10px] leading-4 text-text-muted">{t('agentRun.chatModeDescription')}</span>
                </span>
                {mode === 'chat' && <Check size={13} className="mt-0.5 text-accent-400" />}
              </button>
              <button
                type="button"
                onClick={() => selectMode('agent')}
                className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-surface-800"
              >
                <Bot size={14} className="mt-0.5 text-accent-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-text-primary">{t('agentRun.agentMode')}</span>
                  <span className="block text-[10px] leading-4 text-text-muted">{t('agentRun.agentModeDescription')}</span>
                </span>
                {mode === 'agent' && <Check size={13} className="mt-0.5 text-accent-400" />}
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={mode === 'chat' && !supportsVision}
          className="shrink-0 rounded-xl border border-border bg-surface-800 p-2.5 text-text-secondary transition hover:bg-surface-700 disabled:opacity-30"
          title={
            mode === 'agent'
              ? t('agentRun.attachFiles')
              : supportsVision ? t('chat.attachImage') : t('chat.imagesNotSupported')
          }
        >
          <Paperclip size={16} />
        </button>

        {isBusy ? (
          <button
            onClick={mode === 'agent' ? onCancelAgent : onCancel}
            className="shrink-0 rounded-xl border border-red-500/15 bg-red-500/15 p-2.5 text-red-400 transition-colors hover:bg-red-500/25"
            title={mode === 'agent' ? t('agentRun.stop') : t('common.stop')}
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={mode === 'agent' ? !input.trim() : (!input.trim() && images.length === 0)}
            className="shrink-0 rounded-xl bg-accent-500 p-2.5 text-white shadow-[0_6px_18px_rgba(70,70,170,0.18)] transition-colors hover:bg-accent-600 disabled:opacity-30"
            title={mode === 'agent' ? t('agentRun.run') : t('selection.send')}
          >
            {mode === 'agent' ? <Play size={16} /> : <Send size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
