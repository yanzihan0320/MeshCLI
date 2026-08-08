import { AlertTriangle, Check, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import type { ConfirmationBlock as ConfirmationBlockData } from '../../../packages/protocol/src/a2ui';

export interface A2UIConfirmationAction {
  blockId: string;
  actionId: string;
  decision: 'approve' | 'reject';
  subject: ConfirmationBlockData['subject'];
}

interface ConfirmationBlockProps {
  block: ConfirmationBlockData;
  busy?: boolean;
  onAction?: (action: A2UIConfirmationAction) => void;
}

const riskStyles = {
  low: 'border-green-500/30 bg-green-500/10 text-green-300',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  high: 'border-red-500/30 bg-red-500/10 text-red-300',
};

export function ConfirmationBlock({ block, busy = false, onAction }: ConfirmationBlockProps) {
  const resolved = block.status !== 'pending';

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface-900 shadow-sm">
      <header className="flex items-center gap-2 border-b border-border bg-surface-800 px-3 py-2">
        {block.riskLevel === 'low'
          ? <ShieldCheck size={15} className="text-green-400" />
          : <AlertTriangle size={15} className={block.riskLevel === 'high' ? 'text-red-400' : 'text-amber-400'} />}
        <h3 className="min-w-0 flex-1 text-xs font-semibold text-text-primary">{block.title}</h3>
        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase ${riskStyles[block.riskLevel]}`}>
          {block.riskLevel}
        </span>
      </header>
      <div className="px-3 py-2.5">
        <p className="text-[11px] leading-relaxed text-text-secondary">{block.description}</p>
        {resolved ? (
          <div className={`mt-2 flex items-center gap-1.5 text-[11px] ${block.status === 'approved' ? 'text-green-400' : 'text-text-muted'}`}>
            {block.status === 'approved' ? <Check size={13} /> : <X size={13} />}
            {block.status}
          </div>
        ) : (
          <div className="mt-3 flex justify-end gap-2">
            {block.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={busy || !onAction}
                onClick={() => onAction?.({
                  blockId: block.id,
                  actionId: action.id,
                  decision: action.decision,
                  subject: block.subject,
                })}
                className={action.variant === 'primary'
                  ? 'inline-flex items-center gap-1.5 rounded-md bg-green-500/15 px-3 py-1.5 text-[10px] font-semibold text-green-400 hover:bg-green-500/25 disabled:opacity-50'
                  : action.variant === 'danger'
                    ? 'inline-flex items-center gap-1.5 rounded-md bg-red-500/15 px-3 py-1.5 text-[10px] font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-50'
                    : 'inline-flex items-center gap-1.5 rounded-md bg-surface-800 px-3 py-1.5 text-[10px] font-semibold text-text-secondary hover:text-text-primary disabled:opacity-50'}
              >
                {busy ? <LoaderCircle size={12} className="animate-spin" /> : action.decision === 'approve' ? <Check size={12} /> : <X size={12} />}
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
