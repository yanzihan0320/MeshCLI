import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, FileDiff, LoaderCircle, Square, Terminal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentEvent, AgentRunRecord } from '../../../packages/protocol/src/agent';

interface AgentRunPanelProps {
  run?: AgentRunRecord;
  isRunning: boolean;
  clientError?: string;
  isReviewing: boolean;
  onCancel: () => void;
  onApply: () => void;
  onReject: () => void;
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
  if (event.type === 'run_failed') return String(event.payload.error ?? 'Run failed');
  if (event.type === 'run_finished') return String(event.payload.summary ?? 'Run completed');
  if (event.type === 'run_cancelled') return String(event.payload.reason ?? 'Run cancelled');
  return String(event.payload.message ?? event.payload.adapter ?? '');
}

export function AgentRunPanel({
  run,
  isRunning,
  clientError,
  isReviewing,
  onCancel,
  onApply,
  onReject,
}: AgentRunPanelProps) {
  const { t } = useTranslation();
  const [emptyPanelExpanded, setEmptyPanelExpanded] = useState(false);
  const [collapsedRunId, setCollapsedRunId] = useState<string>();
  const visibleEvents = useMemo(() => run?.events ?? [], [run]);
  const expanded = run ? collapsedRunId !== run.runId : emptyPanelExpanded;

  const toggleExpanded = () => {
    if (!run) {
      setEmptyPanelExpanded((value) => !value);
      return;
    }
    setCollapsedRunId(expanded ? run.runId : undefined);
  };

  return (
    <section className="nodrag nopan border-b border-border bg-surface-900">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={toggleExpanded}
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
        <div className="nowheel max-h-72 overflow-y-auto border-t border-border/70 bg-surface-950 px-2 py-1.5 font-mono text-[10px]">
          {visibleEvents.length === 0 && !clientError ? (
            <div className="py-2 text-center font-sans text-text-muted">{t('agentRun.empty')}</div>
          ) : (
            <div className="space-y-1">
              {visibleEvents.map((event) => (
                <div key={event.eventId} className="grid grid-cols-[88px_1fr] gap-2">
                  <span className={
                    event.type === 'run_failed' ? 'text-red-400'
                      : event.type === 'run_finished' ? 'text-green-400'
                        : 'text-accent-400'
                  }>
                    {event.type}
                  </span>
                  <span className="whitespace-pre-wrap break-words text-text-secondary">
                    {eventDetail(event)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {clientError && <div className="mt-1 text-red-400">{clientError}</div>}
          {run?.changeSet && (
            <div className="mt-2 border-t border-border/70 pt-2 font-sans">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-primary">
                  <FileDiff size={13} className="text-accent-400" />
                  {t('agentRun.changedFiles', { count: run.changeSet.files.length })}
                </div>
                {run.status === 'review_ready' && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={isReviewing}
                      onClick={onReject}
                      className="flex items-center gap-1 rounded bg-surface-800 px-2 py-1 text-[10px] text-text-secondary hover:text-red-400 disabled:opacity-50"
                    >
                      <X size={11} /> {t('agentRun.rejectAll')}
                    </button>
                    <button
                      type="button"
                      disabled={isReviewing}
                      onClick={onApply}
                      className="flex items-center gap-1 rounded bg-green-500/15 px-2 py-1 text-[10px] text-green-400 hover:bg-green-500/25 disabled:opacity-50"
                    >
                      {isReviewing ? <LoaderCircle size={11} className="animate-spin" /> : <Check size={11} />}
                      {t('agentRun.applyAll')}
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                {run.changeSet.files.map((file) => (
                  <div key={file.path} className="flex items-center gap-2 rounded bg-surface-900 px-2 py-1 text-[10px]">
                    <span className="w-12 shrink-0 uppercase text-text-muted">{file.status}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-text-secondary">{file.path}</span>
                    {file.additions != null && <span className="text-green-400">+{file.additions}</span>}
                    {file.deletions != null && <span className="text-red-400">-{file.deletions}</span>}
                  </div>
                ))}
              </div>
              <details className="mt-1.5 rounded border border-border/70 bg-surface-900">
                <summary className="cursor-pointer px-2 py-1 text-[10px] text-text-secondary">
                  {t('agentRun.viewDiff')}{run.changeSet.truncated ? ` · ${t('agentRun.diffTruncated')}` : ''}
                </summary>
                <pre className="nowheel max-h-52 overflow-auto border-t border-border/70 p-2 font-mono text-[9px] leading-relaxed text-text-secondary">
                  {run.changeSet.diff || t('agentRun.noChanges')}
                </pre>
              </details>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
