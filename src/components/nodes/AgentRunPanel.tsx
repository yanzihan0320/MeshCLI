import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Square, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentEvent, AgentRunRecord } from '../../../packages/protocol/src/agent';
import { A2UIBlockSchema, createChangeSetReviewBlocks, type A2UIBlock } from '../../../packages/protocol/src/a2ui';
import { A2UIRenderer } from '../a2ui/A2UIRenderer';

interface AgentRunPanelProps {
  run?: AgentRunRecord;
  isRunning: boolean;
  clientError?: string;
  isReviewing: boolean;
  onCancel: () => void;
  onApply: (changeSetId?: string) => void;
  onReject: (changeSetId?: string) => void;
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
  if (event.type === 'patch_applied' || event.type === 'patch_rejected') return String(event.payload.message ?? '');
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

function runVisualizationBlocks(run: AgentRunRecord): A2UIBlock[] {
  const terminalError = run.status === 'failed' || run.status === 'conflicted' || run.status === 'rejected';
  const planSeen = run.events.some((event) => event.type === 'plan_updated');
  const executionSeen = run.events.some((event) => ['tool_started', 'command_started', 'file_changed', 'change_set_created'].includes(event.type));
  const reviewSeen = run.status === 'review_ready' || ['applying', 'applied', 'rejected', 'conflicted'].includes(run.status);
  const applied = run.status === 'applied';
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
      title: 'Agent execution flow',
      fallbackText: `Agent run ${run.status}`,
      steps: [
        { id: 'plan', label: 'Plan', status: stepStatus(planSeen || executionSeen || reviewSeen, !planSeen && !executionSeen && !reviewSeen) },
        { id: 'execute', label: 'Execute', status: stepStatus(reviewSeen, !reviewSeen && (planSeen || executionSeen), run.status === 'failed') },
        { id: 'review', label: 'Review', status: stepStatus(applied, reviewSeen && !applied && !terminalError, run.status === 'conflicted' || run.status === 'rejected') },
        { id: 'apply', label: 'Apply', status: stepStatus(applied, run.status === 'applying', terminalError) },
      ],
    },
    {
      version: 1,
      id: `agent-metrics-${run.runId}`,
      type: 'metric_cards',
      fallbackText: `${run.events.length} events, ${commandCount} commands, ${fileCount} files`,
      metrics: [
        { id: 'events', label: 'Events', value: String(run.events.length), tone: 'info' },
        { id: 'commands', label: 'Commands', value: String(commandCount), tone: commandCount ? 'warning' : 'neutral' },
        { id: 'files', label: 'Files', value: String(fileCount), tone: fileCount ? 'success' : 'neutral' },
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
  fullHeight = false,
}: AgentRunPanelProps) {
  const { t } = useTranslation();
  const [emptyPanelExpanded, setEmptyPanelExpanded] = useState(false);
  const [collapsedRunId, setCollapsedRunId] = useState<string>();
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
    const processBlocks = runVisualizationBlocks(run);
    if (run.blocks?.length) return [...processBlocks, ...run.blocks];
    if (!run.changeSet) return processBlocks;
    const status = run.status === 'applied' || run.status === 'rejected' || run.status === 'conflicted'
      ? run.status
      : 'pending';
    return [...processBlocks, ...createChangeSetReviewBlocks(run.changeSet, status)];
  }, [run]);
  const expanded = fullHeight || (run ? collapsedRunId !== run.runId : emptyPanelExpanded);

  const toggleExpanded = () => {
    if (!run) {
      setEmptyPanelExpanded((value) => !value);
      return;
    }
    setCollapsedRunId(expanded ? run.runId : undefined);
  };

  return (
    <section className={`nodrag nopan border-b border-border bg-surface-900 ${fullHeight ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={fullHeight ? undefined : toggleExpanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] text-text-secondary hover:text-text-primary"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Terminal size={13} className="text-accent-400" />
          <span className="font-medium">{t('agentRun.title')}</span>
          {run && (
            <span className="truncate text-[10px] text-text-muted">
              {t(`agentRun.status.${run.status}`)}
            </span>
          )}
        </button>
        {isRunning && (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/25"
          >
            <Square size={11} /> {t('agentRun.stop')}
          </button>
        )}
      </div>

      {expanded && (
        <div className={`nowheel overflow-y-auto border-t border-border/70 bg-surface-950 px-2 py-1.5 font-mono text-[10px] ${fullHeight ? 'min-h-0 flex-1' : 'max-h-72'}`}>
          {responseText && (
            <section className="mb-3 rounded-xl border border-border bg-surface-900 p-3 font-sans">
              <h3 className="mb-2 text-xs font-semibold text-text-primary">{t('agentRun.response')}</h3>
              <div className="text-xs leading-relaxed text-text-secondary">
                <Markdown remarkPlugins={[remarkGfm]}>{responseText}</Markdown>
              </div>
            </section>
          )}
          {visibleBlocks.length > 0 && (
            <div className="mb-3 space-y-2 font-sans">
              {visibleBlocks.map((block) => (
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
            <details className="rounded-lg border border-border bg-surface-900 p-2">
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
          {clientError && <div className="mt-1 text-red-400">{clientError}</div>}
        </div>
      )}
    </section>
  );
}
