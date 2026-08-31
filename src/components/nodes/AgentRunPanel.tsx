import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ChevronDown, ChevronRight, RotateCcw, Square, Terminal, Network,
  Box, Sparkles, Database, CheckCircle2, FileCheck2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentEvent, AgentRunRecord } from '../../../packages/protocol/src/agent';
import { A2UIBlockSchema, createChangeSetReviewBlocks, type A2UIBlock } from '../../../packages/protocol/src/a2ui';
import { A2UIRenderer } from '../a2ui/A2UIRenderer';
import { TurnDeleteControl } from '../ui/TurnDeleteControl';

interface AgentRunPanelProps {
  run?: AgentRunRecord;
  isRunning: boolean;
  clientError?: string;
  isReviewing: boolean;
  onCancel: () => void;
  onApply: (changeSetId?: string) => void;
  onReject: (changeSetId?: string) => void;
  onUndo: (changeSetId?: string) => void;
  onDelete: () => void;
  fullHeight?: boolean;
}

function eventDetail(event: AgentEvent): string {
  if (event.type === 'text_delta') return String(event.payload.delta ?? '');
  if (event.type === 'command_started') return `$ ${String(event.payload.command ?? '')}`;
  if (event.type === 'command_output') return String(event.payload.output ?? '');
  if (event.type === 'command_finished') return `exit ${String(event.payload.exitCode ?? '?')}`;
  if (event.type === 'file_changed') return String(event.payload.path ?? 'File changed');
  if (event.type === 'change_set_created') return 'Change set created';
  if (event.type === 'review_ready') return String(event.payload.message ?? 'Ready for review');
  if (event.type === 'patch_applied' || event.type === 'patch_rejected' || event.type === 'patch_reverted') return String(event.payload.message ?? '');
  if (event.type === 'undo_conflict') return String(event.payload.error ?? 'Undo conflict');
  if (event.type === 'change_set_rebased') return String(event.payload.message ?? 'Change set replayed on the latest project');
  if (event.type === 'patch_conflict') return String(event.payload.error ?? 'Patch conflict');
  if (event.type === 'a2ui_block') {
    const block = event.payload.block;
    return typeof block === 'object' && block !== null && 'type' in block
      ? `Rendered ${String(block.type)}`
      : 'Rendered interactive result';
  }
  if (event.type === 'run_failed') return String(event.payload.error ?? 'Run failed');
  if (event.type === 'run_finished') return String(event.payload.summary ?? 'Run completed');
  if (event.type === 'run_cancelled') return String(event.payload.reason ?? 'Run cancelled');
  return String(event.payload.message ?? event.payload.adapter ?? '');
}

function runVisualizationBlocks(run: AgentRunRecord, t: TFunction): A2UIBlock[] {
  const terminalError = run.status === 'failed' || run.status === 'conflicted' || run.status === 'rejected';
  const planSeen = run.events.some((event) => event.type === 'plan_updated');
  const executionSeen = run.events.some((event) => ['tool_started', 'command_started', 'file_changed', 'change_set_created'].includes(event.type));
  const reviewSeen = run.status === 'review_ready' || ['applying', 'applied', 'rejected', 'conflicted'].includes(run.status);
  const applied = run.status === 'applied' || run.status === 'reverted';
  const commandCount = run.events.filter((event) => event.type === 'command_started').length;
  const fileCount = run.changeSet?.files.length ?? run.events.filter((event) => event.type === 'file_changed').length;
  const stepStatus = (complete: boolean, active: boolean, error = false) => (
    error ? 'error' as const : complete ? 'complete' as const : active ? 'active' as const : 'pending' as const
  );

  return A2UIBlockSchema.array().parse([
    {
      version: 1,
      id: `agent-progress-${run.runId}`,
      type: 'process_timeline',
      title: t('agentRun.executionFlow'),
      fallbackText: `Agent run ${run.status}`,
      steps: [
        { id: 'plan', label: t('agentRun.stepPlan'), status: stepStatus(planSeen || executionSeen || reviewSeen, !planSeen && !executionSeen && !reviewSeen) },
        { id: 'execute', label: t('agentRun.stepExecute'), status: stepStatus(reviewSeen, !reviewSeen && (planSeen || executionSeen), run.status === 'failed') },
        { id: 'review', label: t('agentRun.stepReview'), status: stepStatus(applied, reviewSeen && !applied && !terminalError, run.status === 'conflicted' || run.status === 'rejected') },
        { id: 'apply', label: t('agentRun.stepApply'), status: stepStatus(applied, run.status === 'applying', terminalError) },
      ],
    },
    {
      version: 1,
      id: `agent-metrics-${run.runId}`,
      type: 'metric_cards',
      fallbackText: `${run.events.length} events, ${commandCount} commands, ${fileCount} files`,
      metrics: [
        { id: 'events', label: t('agentRun.metricEvents'), value: String(run.events.length), tone: 'info' },
        { id: 'commands', label: t('agentRun.metricCommands'), value: String(commandCount), tone: commandCount ? 'warning' : 'neutral' },
        { id: 'files', label: t('agentRun.metricFiles'), value: String(fileCount), tone: fileCount ? 'success' : 'neutral' },
      ],
    },
  ]);
}

export function AgentRunPanel({
  run,
  isRunning,
  clientError,
  isReviewing,
  onCancel,
  onApply,
  onReject,
  onUndo,
  onDelete,
  fullHeight = false,
}: AgentRunPanelProps) {
  const { t } = useTranslation();
  const [emptyPanelExpanded, setEmptyPanelExpanded] = useState(false);
  const [collapsedRunId, setCollapsedRunId] = useState<string>();
  const [collapsedEventLogRunId, setCollapsedEventLogRunId] = useState<string>();
  const [panelHeight, setPanelHeight] = useState(300);
  const panelRef = useRef<HTMLElement>(null);
  const resizeStartRef = useRef<{ clientY: number; height: number } | null>(null);
  const visibleEvents = useMemo(() => run?.events ?? [], [run]);
  const responseText = useMemo(() => {
    if (!run) return '';
    const streamed = run.events
      .filter((event) => event.type === 'text_delta')
      .map((event) => String(event.payload.delta ?? ''))
      .join('')
      .trim();
    if (streamed) return streamed;
    const finished = [...run.events].reverse().find((event) => event.type === 'run_finished');
    return String(finished?.payload.summary ?? '').trim();
  }, [run]);
  const visibleBlocks = useMemo(() => {
    if (!run) return [];
    const processBlocks = runVisualizationBlocks(run, t);
    if (run.blocks?.length) return [...processBlocks, ...run.blocks];
    if (!run.changeSet) return processBlocks;
    const status = run.status === 'applied' || run.status === 'reverted' || run.status === 'rejected' || run.status === 'conflicted'
      ? run.status
      : 'pending';
    return [...processBlocks, ...createChangeSetReviewBlocks(run.changeSet, status)];
  }, [run, t]);
  const expanded = fullHeight || (run ? collapsedRunId !== run.runId : emptyPanelExpanded);
  const eventLogExpanded = run ? collapsedEventLogRunId !== run.runId : Boolean(clientError);
  const appliedEvent = run?.events.findLast((event) => event.type === 'patch_applied');
  const supervisorEvent = run?.events.findLast((event) => (
    event.type === 'tool_finished' && event.payload.tool === 'langgraph-node-supervisor'
  ));
  const activatedSkills = Array.isArray(supervisorEvent?.payload.activatedSkills)
    ? supervisorEvent.payload.activatedSkills as Array<{ name?: string; source?: string }>
    : [];
  const availableMcpServers = Array.isArray(supervisorEvent?.payload.mcpServers)
    ? supervisorEvent.payload.mcpServers.map(String)
    : [];
  const usedMcpCalls = Array.isArray(supervisorEvent?.payload.mcpCalls)
    ? supervisorEvent.payload.mcpCalls as Array<{ serverId?: string; tool?: string; status?: string }>
    : [];
  const usedFallback = supervisorEvent?.payload.fallback === true;
  const fileCount = run?.changeSet?.files.length ?? Number(appliedEvent?.payload.fileCount ?? 0);
  const readOnlyComplete = run?.status === 'applied' && fileCount === 0;
  const undoExpiresAt = Number(appliedEvent?.payload.undoExpiresAt ?? 0);
  const [undoRemainingMs, setUndoRemainingMs] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    if (!undoExpiresAt) return;
    const timer = window.setInterval(() => {
      setUndoRemainingMs(Math.max(0, undoExpiresAt - Date.now()));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [undoExpiresAt]);
  const canUndo = run?.status === 'applied'
    && fileCount > 0
    && appliedEvent?.payload.undoAvailable !== false
    && undoExpiresAt > 0
    && undoRemainingMs > 0;
  const undoRemainingHours = Math.max(1, Math.ceil(undoRemainingMs / 3_600_000));
  const renderedBlocks = readOnlyComplete
    ? visibleBlocks.filter((block) => block.type !== 'confirmation' && block.type !== 'diff_review')
    : visibleBlocks;

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();
    resizeStartRef.current = { clientY: event.clientY, height: panel.getBoundingClientRect().height };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current;
    const panel = panelRef.current;
    if (!start || !panel) return;
    const nodeHeight = panel.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
    const maxHeight = Math.max(180, nodeHeight - 150);
    setPanelHeight(Math.min(maxHeight, Math.max(140, start.height + event.clientY - start.clientY)));
  };

  const handleResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const toggleExpanded = () => {
    if (!run) {
      setEmptyPanelExpanded((value) => !value);
      return;
    }
    setCollapsedRunId(expanded ? run.runId : undefined);
  };

  return (
    <section
      ref={panelRef}
      style={!fullHeight && expanded ? { height: panelHeight } : undefined}
      className={`nodrag nopan border-b border-border/70 bg-surface-900/72 ${
        fullHeight
          ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
          : expanded ? 'flex shrink-0 flex-col overflow-hidden' : ''
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={fullHeight ? undefined : toggleExpanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Terminal size={13} className="text-accent-400" />
          <span className="font-medium">{t('agentRun.title')}</span>
          {run && <span className={`rounded-full px-2 py-0.5 text-[10px] ${
            run.status === 'failed' || run.status === 'conflicted'
              ? 'bg-red-400/10 text-red-300'
              : readOnlyComplete || run.status === 'applied' || run.status === 'reverted'
                ? 'bg-emerald-400/10 text-emerald-300'
                : isRunning ? 'bg-accent-500/10 text-accent-400' : 'bg-surface-800 text-text-muted'
          }`}>{readOnlyComplete ? t('agentRun.readOnlyComplete') : t(`agentRun.status.${run.status}`)}</span>}
        </button>
        {isRunning && (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 rounded-lg border border-red-500/15 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/20"
          >
            <Square size={11} /> {t('agentRun.stop')}
          </button>
        )}
        {canUndo && (
          <button
            type="button"
            onClick={() => onUndo(run?.changeSet?.changeSetId)}
            disabled={isReviewing}
            className="flex items-center gap-1 rounded-lg border border-amber-500/15 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
            title={t('agentRun.undoAvailableUntil', { time: new Date(undoExpiresAt).toLocaleString() })}
          >
            <RotateCcw size={11} /> {t('agentRun.undoCodeApply')}{Number.isFinite(undoRemainingMs) ? ` · ${undoRemainingHours}h` : ''}
          </button>
        )}
        {run && (
          <TurnDeleteControl
            compact
            alwaysVisible
            label={t('agentRun.deleteRun')}
            confirmLabel={t('agentRun.deleteRunConfirm')}
            cancelLabel={t('common.cancel')}
            onConfirm={onDelete}
            className="shrink-0"
          />
        )}
      </div>

      {expanded && (
        <>
        <div className="nowheel min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border/70 bg-surface-950/55 px-3 py-3">
          {run && (
            <section className="mb-3 rounded-2xl border border-border/70 bg-surface-900/72 p-3 font-sans">
              <div className="flex flex-wrap gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] ${usedFallback ? 'bg-amber-400/10 text-amber-400' : 'bg-accent-500/10 text-accent-400'}`}>
                  <Network size={10} /> LangGraph · {usedFallback ? t('agentRun.fallback') : t('agentRun.supervisor')}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/10 px-2 py-1 text-[9px] text-accent-400">
                  <Box size={10} /> OpenHands · {t('agentRun.executor')}
                </span>
                {activatedSkills.map((skill) => (
                  <span key={`${skill.name}-${skill.source}`} className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-800 px-2 py-1 text-[9px] text-text-secondary" title={skill.source}>
                    <Sparkles size={10} /> Skill · {skill.name}
                  </span>
                ))}
                {usedMcpCalls.map((call) => (
                  <span key={`${call.serverId}-${call.tool}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] ${call.status === 'failed' ? 'bg-red-400/10 text-red-400' : 'border border-border/70 bg-surface-800 text-text-secondary'}`}>
                    <Database size={10} /> MCP · {t('agentRun.used')} · {call.serverId}/{call.tool}
                  </span>
                ))}
                {usedMcpCalls.length === 0 && availableMcpServers.map((server) => (
                  <span key={server} className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-800 px-2 py-1 text-[9px] text-text-secondary" title={t('agentRun.mcpAvailableDescription')}>
                    <Database size={10} /> MCP · {t('agentRun.available')} · {server}
                  </span>
                ))}
              </div>
            </section>
          )}

          {readOnlyComplete && (
            <div className="mb-3 flex items-start gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-3 font-sans">
              <FileCheck2 size={15} className="mt-0.5 shrink-0 text-emerald-300" />
              <div>
                <p className="text-xs font-medium text-emerald-400">{t('agentRun.readOnlyAnalysisComplete')}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-text-muted">{t('agentRun.readOnlyAnalysisDescription')}</p>
              </div>
            </div>
          )}

          {responseText && (
            <section className="mb-3 rounded-2xl border border-border/70 bg-surface-900 p-3.5 font-sans">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-primary"><CheckCircle2 size={13} className="text-emerald-400" />{t('agentRun.response')}</h3>
              <div className="prose prose-sm max-w-none text-xs leading-5 text-text-secondary prose-headings:text-text-primary prose-strong:text-text-primary prose-code:rounded-md prose-code:bg-surface-800 prose-code:px-1.5 prose-code:text-accent-400 prose-li:my-0.5 prose-p:my-1.5">
                <Markdown remarkPlugins={[remarkGfm]}>{responseText}</Markdown>
              </div>
            </section>
          )}
          {renderedBlocks.length > 0 && (
            <div className="mb-3 space-y-2 font-sans">
              {renderedBlocks.map((block) => (
                <A2UIRenderer
                  key={block.id}
                  block={block}
                  busy={isReviewing}
                  onAction={(action) => {
                    const changeSetId = action.subject.changeSetId;
                    if (action.decision === 'approve') onApply(changeSetId);
                    else onReject(changeSetId);
                  }}
                />
              ))}
            </div>
          )}
          {visibleEvents.length === 0 && !clientError ? (
            <div className="py-2 text-center font-sans text-text-muted">{t('agentRun.empty')}</div>
          ) : (
            <details
              open={eventLogExpanded}
              onToggle={(event) => {
                setCollapsedEventLogRunId(event.currentTarget.open ? undefined : run?.runId);
              }}
              className="rounded-lg border border-border bg-surface-900 p-2 font-mono text-[10px]"
            >
              <summary className="cursor-pointer font-sans text-[10px] text-text-muted">{t('agentRun.eventLog')} ({visibleEvents.length})</summary>
              <div className="mt-2 space-y-1">
                {visibleEvents.map((event) => (
                  <div key={event.eventId} className="grid grid-cols-[88px_1fr] gap-2">
                    <span className={event.type === 'run_failed' ? 'text-red-400' : event.type === 'run_finished' ? 'text-green-400' : 'text-accent-400'}>{event.type}</span>
                    <span className="whitespace-pre-wrap break-words text-text-secondary">{eventDetail(event)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          {clientError && <div className="mt-2 rounded-lg border border-red-400/20 bg-red-400/5 p-2 font-sans text-[10px] text-red-300">{clientError}</div>}
        </div>
        {!fullHeight && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('agentRun.resizePanel')}
            title={t('agentRun.resizePanel')}
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            className="nodrag nopan nowheel group flex h-3 shrink-0 touch-none cursor-row-resize items-center justify-center border-t border-border/60 bg-surface-900/85"
          >
            <span className="h-1 w-10 rounded-full bg-border-hover transition-colors group-hover:bg-accent-400" />
          </div>
        )}
        </>
      )}
    </section>
  );
}
