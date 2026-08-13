import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X, Send, MessageSquare, Loader2, Copy, Check, Wrench, Undo2, ShieldAlert,
  Network, Sparkles, Database, CheckCircle2, ChevronDown,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkspaceAssistantEvent } from '../../../packages/protocol/src/assistant';
import { useAgent } from '../../services/agent';

interface CustomCopilotChatProps {
  isOpen: boolean;
  onClose: () => void;
}

function activityLabel(event: WorkspaceAssistantEvent): { title: string; detail: string; tone: string } {
  const command = event.payload.command as { type?: string } | undefined;
  if (event.type === 'turn_started') return { title: 'LangGraph started', detail: String(event.payload.graphId ?? 'workspace assistant'), tone: 'text-violet-300' };
  if (event.type === 'skill_activated') return { title: 'Skill activated', detail: String(event.payload.name ?? ''), tone: 'text-fuchsia-300' };
  if (event.type === 'mcp_started') return { title: 'MCP call', detail: `${String(event.payload.serverId ?? '')} · ${String(event.payload.tool ?? '')}`, tone: 'text-cyan-300' };
  if (event.type === 'mcp_finished') return { title: 'MCP completed', detail: String(event.payload.tool ?? ''), tone: 'text-emerald-300' };
  if (event.type === 'mcp_failed') return { title: 'MCP failed', detail: String(event.payload.tool ?? ''), tone: 'text-red-300' };
  if (event.type === 'canvas_command') return { title: 'Canvas command', detail: String(command?.type ?? ''), tone: 'text-blue-300' };
  if (event.type === 'action_resolved') return { title: 'Canvas result', detail: String(event.payload.status ?? ''), tone: event.payload.status === 'applied' ? 'text-emerald-300' : 'text-amber-300' };
  if (event.type === 'tool_started') return { title: 'Tool started', detail: String(event.payload.tool ?? event.payload.name ?? ''), tone: 'text-blue-300' };
  if (event.type === 'tool_finished') return { title: 'Tool completed', detail: String(event.payload.tool ?? event.payload.name ?? ''), tone: 'text-emerald-300' };
  return { title: event.type.replaceAll('_', ' '), detail: '', tone: 'text-text-muted' };
}

export function CustomCopilotChat({ isOpen, onClose }: CustomCopilotChatProps) {
  const { t } = useTranslation();
  const { messages, activity, undoHistory, pendingCommand, isRunning, send, abort, decidePending, undo, undoAll } = useAgent();
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [undoFeedback, setUndoFeedback] = useState<string>();
  const [traceOpen, setTraceOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentTrace = useMemo(() => {
    const start = activity.findLastIndex((event) => event.type === 'turn_started');
    const turn = activity.slice(Math.max(0, start));
    return turn.filter((event) => [
      'turn_started', 'skill_activated', 'tool_started', 'tool_finished',
      'mcp_started', 'mcp_finished', 'mcp_failed', 'canvas_command', 'action_resolved',
    ].includes(event.type));
  }, [activity]);
  const mcpCalls = useMemo(() => [...new Set(currentTrace
    .filter((event) => event.type === 'mcp_started')
    .map((event) => `${String(event.payload.serverId ?? 'MCP')}/${String(event.payload.tool ?? 'tool')}`))], [currentTrace]);
  const currentSkills = useMemo(() => [...new Set(currentTrace
    .filter((event) => event.type === 'skill_activated')
    .map((event) => String(event.payload.name ?? ''))
    .filter(Boolean))], [currentTrace]);
  const graphEvent = currentTrace.find((event) => event.type === 'turn_started');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activity]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!input.trim() || isRunning) return;
    const message = input.trim();
    setInput('');
    await send(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[min(500px,100vw)] flex-col border-l border-border bg-surface-950 shadow-2xl shadow-black/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-surface-900/90 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-accent-400" />
            <h2 className="text-sm font-semibold text-text-primary">{t('copilot.chat.title')}</h2>
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/25 bg-violet-400/10 px-2 py-0.5 text-[9px] font-medium text-violet-300">
              <Network size={10} /> LangGraph
            </span>
          </div>
          <p className="mt-0.5 pl-6 text-[10px] text-text-muted">
            Canvas tools · Skills · MCP orchestration
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-800 rounded-lg transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare size={48} className="text-surface-700 mb-4" />
            <p className="text-text-muted text-sm">
              {t('copilot.chat.welcomeMessageText')}
            </p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[90%] rounded-2xl px-4 py-3 shadow-sm ${
                  msg.role === 'user'
                    ? 'rounded-br-md bg-accent-500 text-white'
                    : 'rounded-bl-md border border-border/80 bg-surface-900 text-text-primary'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm max-w-none break-words text-[13px] leading-6 text-text-secondary prose-headings:text-text-primary prose-strong:text-text-primary prose-code:rounded prose-code:bg-surface-800 prose-code:px-1 prose-code:text-accent-300 prose-li:my-0.5 prose-p:my-2">
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-5">{msg.content}</p>
                )}
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <button
                      onClick={() => handleCopy(`${index}`, msg.content)}
                      className="text-text-muted hover:text-text-primary transition-colors"
                    >
                      {copiedId === `${index}` ? (
                        <Check size={12} />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {currentTrace.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-border bg-surface-900/80">
            <button
              type="button"
              onClick={() => setTraceOpen((value) => !value)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left"
            >
              <span className="flex items-center gap-2 text-[11px] font-medium text-text-secondary">
                <Wrench size={13} className="text-accent-400" /> Execution trace
                <span className="text-[9px] text-text-muted">{currentTrace.length} events</span>
              </span>
              <ChevronDown size={13} className={`text-text-muted transition-transform ${traceOpen ? '' : '-rotate-90'}`} />
            </button>

            <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 py-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/10 px-2 py-1 text-[9px] text-violet-300">
                <Network size={10} /> LangGraph · {String(graphEvent?.payload.graphId ?? 'default')}
              </span>
              {currentSkills.map((skill) => (
                <span key={skill} className="inline-flex items-center gap-1 rounded-full bg-fuchsia-400/10 px-2 py-1 text-[9px] text-fuchsia-300">
                  <Sparkles size={10} /> Skill · {skill}
                </span>
              ))}
              {mcpCalls.map((call) => (
                <span key={call} className="inline-flex items-center gap-1 rounded-full bg-cyan-400/10 px-2 py-1 text-[9px] text-cyan-300">
                  <Database size={10} /> MCP · {call}
                </span>
              ))}
            </div>

            {traceOpen && (
              <div className="space-y-1 border-t border-border/60 px-3 py-2">
                {currentTrace.slice(-10).map((event) => {
                  const label = activityLabel(event);
                  return (
                    <div key={event.eventId} className="grid grid-cols-[14px_108px_1fr] items-center gap-2 text-[10px]">
                      <CheckCircle2 size={11} className={label.tone} />
                      <span className={label.tone}>{label.title}</span>
                      <span className="truncate text-text-muted">{label.detail}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {undoHistory.length > 0 && (
          <section className="rounded-xl border border-accent-400/25 bg-accent-400/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-text-primary">Canvas undo history</p>
                <p className="mt-0.5 text-[10px] text-text-muted">
                  {undoHistory.length} reversible {undoHistory.length === 1 ? 'operation' : 'operations'} in this page session
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => setUndoFeedback(undo() ? 'Undid the latest canvas operation.' : 'Undo is unavailable because the canvas changed or the page was reloaded.')}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-900 px-2 py-1.5 text-[10px] text-accent-300 hover:bg-surface-800"
                >
                  <Undo2 size={11} /> Undo last
                </button>
                {undoHistory.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const count = undoAll();
                      setUndoFeedback(count ? `Undid all ${count} canvas operations.` : 'Undo is unavailable because the canvas changed or the page was reloaded.');
                    }}
                    className="rounded-md bg-accent-500 px-2 py-1.5 text-[10px] font-medium text-white hover:bg-accent-600"
                  >
                    Undo all ({undoHistory.length})
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {undoFeedback && (
          <div className="rounded-lg border border-border bg-surface-900 px-3 py-2 text-[11px] text-text-secondary">
            {undoFeedback}
          </div>
        )}

        {pendingCommand && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-amber-300 text-sm font-medium">
              <ShieldAlert size={16} /> Confirmation required
            </div>
            <p className="mt-2 text-xs text-text-secondary">
              {pendingCommand.type}: {JSON.stringify(pendingCommand.payload)}
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => void decidePending(true)} className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-black">Approve</button>
              <button onClick={() => void decidePending(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary">Reject</button>
            </div>
          </div>
        )}

        {isRunning && (
          <div className="flex justify-start">
            <div className="bg-surface-800 rounded-xl px-4 py-3">
              <Loader2 size={16} className="text-accent-400 animate-spin" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border bg-surface-900 p-4">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('copilot.chat.chatInputPlaceholder')}
            rows={1}
            className="flex-1 resize-none bg-surface-800 text-sm text-text-primary rounded-xl px-4 py-3 placeholder-text-muted border border-border focus:border-accent-500/50 focus:outline-none transition-colors"
            style={{ minHeight: '48px', maxHeight: '120px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={isRunning ? abort : handleSubmit}
            className="shrink-0 p-3 rounded-xl bg-accent-500 text-white hover:bg-accent-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isRunning ? <X size={16} /> : <Send size={16} />}
          </button>
        </div>
        <p className="text-[10px] text-text-muted mt-2 text-center">
          {t('copilot.chat.chatDisclaimerText')}
        </p>
      </div>
    </div>
  );
}
