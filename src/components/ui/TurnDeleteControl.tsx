import { useState } from 'react';
import { Trash2, X } from 'lucide-react';

interface TurnDeleteControlProps {
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void | Promise<void>;
  compact?: boolean;
  alwaysVisible?: boolean;
  className?: string;
}

export function TurnDeleteControl({
  label,
  confirmLabel,
  cancelLabel,
  onConfirm,
  compact = false,
  alwaysVisible = false,
  className = '',
}: TurnDeleteControlProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setConfirming(true);
        }}
        className={`inline-flex items-center justify-center gap-1 rounded-full border border-transparent text-current shadow-sm transition-[background-color,border-color,color,opacity,transform] hover:-translate-y-px hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-400 focus-visible:opacity-100 ${
          alwaysVisible ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:opacity-100'
        } ${
          compact ? 'h-7 w-7' : 'h-7 px-2 text-[10px] font-medium'
        } ${className}`}
        title={label}
        aria-label={label}
      >
        <Trash2 size={12} />
        {!compact && <span>{label}</span>}
      </button>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 rounded-xl border border-red-400/20 bg-surface-900/95 p-1.5 text-text-primary shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl ${className}`}
      role="group"
      aria-label={confirmLabel}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="max-w-36 truncate pl-1 text-[10px] text-text-secondary">{confirmLabel}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirming(false)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-800 hover:text-text-primary disabled:opacity-40"
        title={cancelLabel}
        aria-label={cancelLabel}
      >
        <X size={11} />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setConfirming(false);
          }
        }}
        className="inline-flex h-6 items-center gap-1 rounded-lg bg-red-500 px-2 text-[10px] font-semibold text-white shadow-sm transition-colors hover:bg-red-400 disabled:opacity-50"
      >
        <Trash2 size={10} /> {label}
      </button>
    </div>
  );
}
