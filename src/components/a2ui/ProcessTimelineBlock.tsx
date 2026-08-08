import { AlertCircle, CheckCircle2, Circle, LoaderCircle } from 'lucide-react';
import type { ProcessTimelineBlock as ProcessTimelineBlockData } from '../../../packages/protocol/src/a2ui';

const statusIcon = {
  pending: Circle,
  active: LoaderCircle,
  complete: CheckCircle2,
  error: AlertCircle,
};

const statusStyle = {
  pending: 'text-text-muted',
  active: 'text-accent-400',
  complete: 'text-emerald-400',
  error: 'text-red-400',
};

export function ProcessTimelineBlock({ block }: { block: ProcessTimelineBlockData }) {
  return (
    <section className="rounded-xl border border-border bg-surface-900 p-3">
      <h3 className="mb-3 text-xs font-semibold text-text-primary">{block.title}</h3>
      <ol className="grid grid-cols-4 gap-1">
        {block.steps.map((step, index) => {
          const Icon = statusIcon[step.status];
          return (
            <li key={step.id} className="relative min-w-0 text-center">
              {index > 0 && <span className="absolute right-1/2 top-2 h-px w-full bg-border-hover" />}
              <Icon size={16} className={`relative z-10 mx-auto bg-surface-900 ${statusStyle[step.status]} ${step.status === 'active' ? 'animate-spin' : ''}`} />
              <div className="mt-1 truncate text-[9px] font-medium text-text-secondary">{step.label}</div>
              {step.detail && <div className="mt-0.5 text-[8px] leading-tight text-text-muted">{step.detail}</div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
