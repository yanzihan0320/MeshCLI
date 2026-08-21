import { CheckCircle2, Circle } from 'lucide-react';
import type { ChecklistBlock as ChecklistBlockData } from '../../../packages/protocol/src/a2ui';

interface ChecklistBlockProps {
  block: ChecklistBlockData;
  onChange?: (block: ChecklistBlockData) => void;
}

export function ChecklistBlock({ block, onChange }: ChecklistBlockProps) {
  const completed = block.items.filter((item) => item.checked).length;

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-surface-900 shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-800 px-3 py-2">
        <h3 className="text-xs font-semibold text-text-primary">{block.title}</h3>
        <span className="text-[10px] text-text-muted">{completed}/{block.items.length}</span>
      </header>
      <div className="divide-y divide-border/60">
        {block.items.map((item) => (
          <label
            key={item.id}
            className={`flex gap-2.5 px-3 py-2 text-xs ${item.disabled ? 'opacity-50' : 'cursor-pointer hover:bg-surface-800/70'}`}
          >
            <input
              type="checkbox"
              checked={item.checked}
              disabled={item.disabled}
              className="sr-only"
              onChange={() => onChange?.({
                ...block,
                items: block.items.map((candidate) => (
                  candidate.id === item.id ? { ...candidate, checked: !candidate.checked } : candidate
                )),
              })}
            />
            {item.checked
              ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-400" />
              : <Circle size={16} className="mt-0.5 shrink-0 text-text-muted" />}
            <span className="min-w-0">
              <span className={item.checked ? 'text-text-muted line-through' : 'text-text-primary'}>{item.label}</span>
              {item.description && <span className="mt-0.5 block text-[10px] leading-relaxed text-text-muted">{item.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
