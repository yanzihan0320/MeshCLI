import { Columns3 } from 'lucide-react';
import type { ComparisonTableBlock as ComparisonTableBlockData } from '../../../packages/protocol/src/a2ui';

export function ComparisonTableBlock({ block }: { block: ComparisonTableBlockData }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-surface-900 shadow-sm">
      <header className="flex items-center gap-2 border-b border-border bg-surface-800 px-3 py-2">
        <Columns3 size={15} className="text-accent-400" />
        <h3 className="text-xs font-semibold text-text-primary">{block.title}</h3>
      </header>
      <div className="nowheel overflow-x-auto">
        <table className="w-full min-w-max text-left text-[10px]">
          <thead className="bg-surface-950 text-text-secondary">
            <tr>{block.columns.map((column) => <th key={column} className="border-b border-border px-3 py-2 font-semibold">{column}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.id} className={row.emphasis ? 'bg-accent-500/10' : 'odd:bg-surface-950/40'}>
                {row.cells.map((cell, index) => <td key={`${row.id}-${index}`} className="border-b border-border/50 px-3 py-2 text-text-primary">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
