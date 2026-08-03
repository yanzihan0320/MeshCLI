import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, ChevronDown, MessageCircle, Paperclip, Play, Send, Square, X } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';

type InputMode = 'chat' | 'agent';

interface ChatInputProps {
  nodeId: string;
  onSend: (message: string, images: File[]) => void;
  onCancel: () => void;
  onRunAgent: (prompt: string) => void;
  onCancelAgent: () => void;
  isAgentRunning: boolean;
  supportsVision?: boolean;
}

export function ChatInput({
  nodeId,
  onSend,
  onCancel,
  onRunAgent,
  onCancelAgent,
  isAgentRunning,
  supportsVision = true,
}: ChatInputProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<InputMode>('chat');
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isStreaming = useChatStore(
    (s) => s.conversations[nodeId]?.isStreaming ?? false
  );
  const isBusy = mode === 'agent' ? isAgentRunning : isStreaming;

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (isBusy) return;

    if (mode === 'agent') {
      if (!trimmed) return;
      onRunAgent(trimmed);
      setInput('');
      return;
    }

    if (!trimmed && images.length === 0) return;

    onSend(trimmed, images);
    setInput('');
    setImages([]);
  }, [input, images, isBusy, mode, onRunAgent, onSend]);

  const selectMode = (nextMode: InputMode) => {
    setMode(nextMode);
    setModeMenuOpen(false);
    if (nextMode === 'agent') setImages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const files = Array.from(e.target.files).filter((f) =>
      f.type.startsWith('image/')
    );

    setImages((prev) => [...prev, ...files]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (mode === 'agent') return;

    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/')
    );

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
      className={`nodrag nopan border-t border-border p-2 transition ${
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

      <div className="flex items-end gap-1.5">
        

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={mode === 'agent' ? t('agentRun.promptPlaceholder') : t('chat.askSomething')}
          rows={1}
          className="flex-1 resize-none bg-surface-800 text-sm text-text-primary rounded-lg px-3 py-2 placeholder-text-muted border border-border focus:border-accent-500/50 focus:outline-none transition-colors"
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
          accept="image/*"
          multiple
          hidden
          onChange={handleFileSelect}
        />

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setModeMenuOpen((open) => !open)}
            className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-medium transition-colors ${
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
            <div className="absolute bottom-10 left-0 z-50 w-48 overflow-hidden rounded-lg border border-border bg-surface-950 p-1 shadow-xl shadow-black/40">
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
          disabled={!supportsVision || mode === 'agent'}
          className="shrink-0 p-2 rounded-lg bg-surface-800 text-text-secondary hover:bg-surface-700 transition disabled:opacity-30"
          title={
            supportsVision
              ? t('chat.attachImage')
              : t('chat.imagesNotSupported')
          }
        >
          <Paperclip size={16} />
        </button>

        {isBusy ? (
          <button
            onClick={mode === 'agent' ? onCancelAgent : onCancel}
            className="shrink-0 p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            title={mode === 'agent' ? t('agentRun.stop') : t('common.stop')}
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={mode === 'agent' ? !input.trim() : (!input.trim() && images.length === 0)}
            className="shrink-0 p-2 rounded-lg bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 transition-colors disabled:opacity-30"
            title={mode === 'agent' ? t('agentRun.run') : t('selection.send')}
          >
            {mode === 'agent' ? <Play size={16} /> : <Send size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
