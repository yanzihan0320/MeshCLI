import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  X, Send, MessageSquare, Loader2, Copy, Check, Wrench, Undo2, ShieldAlert,
  Network, Sparkles, Database, CheckCircle2, ChevronDown,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkspaceAssistantEvent } from '../../../packages/protocol/src/assistant';
import { useAgent } from '../../services/agent';
import { TurnDeleteControl } from '../ui/TurnDeleteControl';

interface CustomCopilotChatProps {
  isOpen: boolean;
  onClose: () => void;
}

function activityLabel(event: WorkspaceAssistantEvent, t: TFunction): { title: string; detail: string; tone: string } {
  const command = event.payload.command as { type?: string } | undefined;
  if (event.type === 'turn_started') return { title: t('copilot.chat.traceLangGraphStarted'), detail: String(event.payload.graphId ?? t('copilot.chat.workspaceAssistant')), tone: 'text-accent-400' };
  if (event.type === 'skill_activated') return { title: t('copilot.chat.traceSkillActivated'), detail: String(event.payload.name ?? ''), tone: 'text-accent-400' };
  if (event.type === 'mcp_started') return { title: t('copilot.chat.traceMcpCall'), detail: `${String(event.payload.serverId ?? '')} · ${String(event.payload.tool ?? '')}`, tone: 'text-accent-400' };
  if (event.type === 'mcp_finished') return { title: t('copilot.chat.traceMcpCompleted'), detail: String(event.payload.tool ?? ''), tone: 'text-emerald-400' };
  if (event.type === 'mcp_failed') return { title: t('copilot.chat.traceMcpFailed'), detail: String(event.payload.tool ?? ''), tone: 'text-red-400' };
  if (event.type === 'canvas_command') return { title: t('copilot.chat.traceCanvasCommand'), detail: String(command?.type ?? ''), tone: 'text-accent-400' };
  if (event.type === 'action_resolved') return { title: t('copilot.chat.traceCanvasResult'), detail: String(event.payload.status ?? ''), tone: event.payload.status === 'applied' ? 'text-emerald-400' : 'text-amber-400' };
  if (event.type === 'tool_started') return { title: t('copilot.chat.traceToolStarted'), detail: String(event.payload.tool ?? event.payload.name ?? ''), tone: 'text-accent-400' };
  if (event.type === 'tool_finished') return { title: t('copilot.chat.traceToolCompleted'), detail: String(event.payload.tool ?? event.payload.name ?? ''), tone: 'text-emerald-400' };
  return { title: event.type.replaceAll('_', ' '), detail: '', tone: 'text-text-muted' };
}

export function CustomCopilotChat({ isOpen, onClose }: CustomCopilotChatProps) {
  const { t } = useTranslation();
  const { messages, activity, undoHistory, pendingCommand, isRunning, canRetract, send, abort, retractLatestTurn, decidePending, undo, undoAll } = useAgent();
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
  const latestUserMessageId = useMemo(() => (
    [...messages].reverse().find((message) => message.role === 'user')?.id
  ), [messages]);

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

  const handleRetractLatestTurn = () => {
    const result = retractLatestTurn();
    if (!result.removed) {
      setUndoFeedback(t('copilot.chat.retractTurnUnavailable'));
    } else if (result.undoneCanvasActionCount < result.canvasActionCount) {
      setUndoFeedback(t('copilot.chat.retractTurnPartial'));
    } else if (result.canvasActionCount > 0) {
      setUndoFeedback(t('copilot.chat.retractTurnCanvasSuccess', { count: result.undoneCanvasActionCount }));
    } else {
      setUndoFeedback(t('copilot.chat.retractTurnSuccess'));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="mesh-panel fixed bottom-3 right-3 top-[60px] z-50 flex w-[min(520px,calc(100vw-24px))] flex-col overflow-hidden rounded-[22px] max-sm:bottom-0 max-sm:right-0 max-sm:top-12 max-sm:w-full max-sm:rounded-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/70 bg-surface-900/65 px-4 py-3.5 backdrop-blur-xl">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-accent-400" />
            <h2 className="text-sm font-semibold text-text-primary">{t('copilot.chat.title')}</h2>
            <span className="inline-flex items-center gap-1 rounded-full border border-accent-400/20 bg-accent-500/8 px-2 py-0.5 text-[10px] font-medium text-accent-400">
              <Network size={10} /> LangGraph
            </span>
          </div>
          <p className="mt-0.5 pl-6 text-[11px] text-text-muted">
            {t('copilot.chat.orchestrationSubtitle')}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-xl p-2 text-text-secondary transition-colors hover:bg-surface-800 hover:text-text-primary"
          aria-label={t('common.close')}
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-5 overflow-y-auto bg-surface-950/45 px-4 py-5">
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
              className={`group max-w-[88%] rounded-[18px] px-4 py-3 ${
                  msg.role === 'user'
                    ? 'mesh-user-bubble rounded-br-md'
                    : 'rounded-bl-md border border-border/75 bg-surface-900/76 text-text-primary shadow-[0_8px_28px_rgba(0,0,0,0.07)] backdrop-blur-xl'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm max-w-none break-words text-[13px] leading-6 text-text-secondary prose-headings:tracking-[-0.015em] prose-headings:text-text-primary prose-strong:text-text-primary prose-code:rounded-md prose-code:bg-surface-800 prose-code:px-1.5 prose-code:text-accent-400 prose-li:my-0.5 prose-p:my-2">
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-5">{msg.content}</p>
                )}
                {msg.role === 'user' && msg.id === latestUserMessageId && canRetract && (
                  <div className="mt-2 flex justify-end">
                    <TurnDeleteControl
                      compact
                      alwaysVisible
                      label={t('copilot.chat.retractTurn')}
                      confirmLabel={t('copilot.chat.retractTurnShortConfirm')}
                      cancelLabel={t('common.cancel')}
                      onConfirm={handleRetractLatestTurn}
                    />
                  </div>
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
          <section className="overflow-hidden rounded-2xl border border-border/75 bg-surface-900/65">
            <button
              type="button"
              onClick={() => setTraceOpen((value) => !value)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-text-secondary">
                <Wrench size={13} className="text-accent-400" /> {t('copilot.chat.executionTrace')}
                <span className="text-[10px] text-text-muted">{t('copilot.chat.eventCount', { count: currentTrace.length })}</span>
              </span>
              <ChevronDown size={13} className={`text-text-muted transition-transform ${traceOpen ? '' : '-rotate-90'}`} />
            </button>

            <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 py-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/10 px-2 py-1 text-[9px] text-accent-400">
                <Network size={10} /> LangGraph · {String(graphEvent?.payload.graphId ?? 'default')}
              </span>
              {currentSkills.map((skill) => (
                <span key={skill} className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-800 px-2 py-1 text-[9px] text-text-secondary">
                  <Sparkles size={10} /> Skill · {skill}
                </span>
              ))}
              {mcpCalls.map((call) => (
                <span key={call} className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-800 px-2 py-1 text-[9px] text-text-secondary">
                  <Database size={10} /> MCP · {call}
                </span>
              ))}
            </div>

            {traceOpen && (
              <div className="space-y-1 border-t border-border/60 px-3 py-2">
                {currentTrace.slice(-10).map((event) => {
                  const label = activityLabel(event, t);
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
          <section className="rounded-2xl border border-accent-400/20 bg-accent-400/5 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-text-primary">{t('copilot.chat.canvasUndoHistory')}</p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {t('copilot.chat.reversibleOperationCount', { count: undoHistory.length })}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => setUndoFeedback(undo() ? t('copilot.chat.undoLatestSuccess') : t('copilot.chat.undoUnavailable'))}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-900 px-2 py-1.5 text-[10px] text-accent-300 hover:bg-surface-800"
                >
                  <Undo2 size={11} /> {t('copilot.chat.undoLast')}
                </button>
                {undoHistory.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const count = undoAll();
                      setUndoFeedback(count ? t('copilot.chat.undoAllSuccess', { count }) : t('copilot.chat.undoUnavailable'));
                    }}
                    className="rounded-md bg-accent-500 px-2 py-1.5 text-[10px] font-medium text-white hover:bg-accent-600"
                  >
                    {t('copilot.chat.undoAll', { count: undoHistory.length })}
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
            <div className="flex items-center gap-2 text-sm font-medium text-amber-400">
              <ShieldAlert size={16} /> {t('copilot.chat.confirmationRequired')}
            </div>
            <p className="mt-2 text-xs text-text-secondary">
              {pendingCommand.type}: {JSON.stringify(pendingCommand.payload)}
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => void decidePending(true)} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-black">{t('copilot.chat.approve')}</button>
              <button onClick={() => void decidePending(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary">{t('copilot.chat.reject')}</button>
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
      <div className="border-t border-border/70 bg-surface-900/78 p-4 backdrop-blur-xl">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('copilot.chat.chatInputPlaceholder')}
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-border bg-surface-800/80 px-4 py-3 text-sm text-text-primary placeholder-text-muted transition-colors focus:border-accent-500/60 focus:bg-surface-800 focus:outline-none"
            style={{ minHeight: '48px', maxHeight: '120px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={isRunning ? abort : handleSubmit}
            className={`shrink-0 rounded-2xl p-3 text-white transition-all disabled:cursor-not-allowed disabled:opacity-40 ${isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-accent-500 hover:-translate-y-0.5 hover:bg-accent-600'}`}
            aria-label={isRunning ? t('common.stop') : t('merge.send')}
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
