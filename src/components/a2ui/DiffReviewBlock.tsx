import { FileDiff } from 'lucide-react';
import type { DiffReviewBlock as DiffReviewBlockData } from '../../../packages/protocol/src/a2ui';

interface DiffReviewBlockProps {
  block: DiffReviewBlockData;
}

export function DiffReviewBlock({ block }: DiffReviewBlockProps) {
  const { changeSet } = block;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface-900 shadow-sm">
      <header className="flex items-center gap-2 border-b border-border bg-surface-800 px-3 py-2">
        <FileDiff size={15} className="text-accent-400" />
        <h3 className="min-w-0 flex-1 text-xs font-semibold text-text-primary">{block.title}</h3>
        <span className="text-[9px] uppercase text-text-muted">{block.status}</span>
      </header>
      <div className="space-y-1 px-3 py-2">
        {changeSet.files.length === 0 && <p className="text-[10px] text-text-muted">No file changes</p>}
        {changeSet.files.map((file) => (
          <div key={file.path} className="flex items-center gap-2 rounded-md bg-surface-800/80 px-2 py-1.5 text-[10px]">
            <span className="w-12 shrink-0 uppercase text-text-muted">{file.status}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-text-secondary" title={file.path}>{file.path}</span>
            {file.additions != null && <span className="text-green-400">+{file.additions}</span>}
            {file.deletions != null && <span className="text-red-400">-{file.deletions}</span>}
          </div>
        ))}
        <details className="mt-2 rounded-md border border-border/70 bg-surface-950">
          <summary className="cursor-pointer px-2 py-1.5 text-[10px] text-text-secondary">
            View unified diff{changeSet.truncated ? ' · UI truncated' : ''}
          </summary>
          <pre className="nowheel max-h-64 overflow-auto border-t border-border/70 p-2 font-mono text-[9px] leading-relaxed text-text-secondary">
            {changeSet.diff || 'No file changes'}
          </pre>
        </details>
      </div>
    </section>
  );
}
