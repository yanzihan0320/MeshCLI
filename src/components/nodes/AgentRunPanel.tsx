import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Square, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentEvent, AgentRunRecord } from '../../../packages/protocol/src/agent';

interface AgentRunPanelProps {
  run?: AgentRunRecord;
  isRunning: boolean;
  clientError?: string;
  onCancel: () => void;
}

function eventDetail(event: AgentEvent): string {
  if (event.type === 'text_delta') return String(event.payload.delta ?? '');
  if (event.type === 'run_failed') return String(event.payload.error ?? 'Run failed');
  if (event.type === 'run_finished') return String(event.payload.summary ?? 'Run completed');
  if (event.type === 'run_cancelled') return String(event.payload.reason ?? 'Run cancelled');
  return String(event.payload.message ?? event.payload.adapter ?? '');
}

export function AgentRunPanel({ run, isRunning, clientError, onCancel }: AgentRunPanelProps) {
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
        <div className="nowheel max-h-36 overflow-y-auto border-t border-border/70 bg-surface-950 px-2 py-1.5 font-mono text-[10px]">
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
        </div>
      )}
    </section>
  );
}
