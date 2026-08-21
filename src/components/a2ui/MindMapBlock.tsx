import { BrainCircuit, CircleDot, Lightbulb, ShieldAlert, Sparkles } from 'lucide-react';
import type { MindMapBlock as MindMapBlockData, MindMapNode } from '../../../packages/protocol/src/a2ui';

const kindStyles = {
  topic: 'border-accent-500/50 bg-accent-500/15 text-accent-300',
  idea: 'border-accent-500/30 bg-accent-500/8 text-accent-400',
  fact: 'border-border bg-surface-800 text-text-secondary',
  risk: 'border-red-500/30 bg-red-500/8 text-red-400',
  decision: 'border-border-hover bg-surface-800 text-text-primary',
};

const kindIcons = {
  topic: BrainCircuit,
  idea: Lightbulb,
  fact: CircleDot,
  risk: ShieldAlert,
  decision: Sparkles,
};

function BranchCard({ node }: { node: MindMapNode }) {
  const Icon = kindIcons[node.kind];
  return (
    <article className={`w-40 shrink-0 rounded-xl border p-2.5 ${kindStyles[node.kind]}`}>
      <div className="flex items-start gap-1.5">
        <Icon size={13} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h4 className="text-[10px] font-semibold leading-snug text-text-primary">{node.label}</h4>
          {node.description && <p className="mt-1 text-[10px] leading-relaxed text-text-muted">{node.description}</p>}
        </div>
      </div>
      {node.children.length > 0 && (
        <div className="mt-2 space-y-1 border-l border-current/25 pl-2">
          {node.children.map((child) => (
            <div key={child.id} className="text-[10px] leading-snug text-text-secondary">{child.label}</div>
          ))}
        </div>
      )}
    </article>
  );
}

export function MindMapBlock({ block }: { block: MindMapBlockData }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-surface-900 shadow-sm" aria-label={block.title}>
      <header className="flex items-center gap-2 border-b border-border bg-surface-800 px-3 py-2">
        <BrainCircuit size={15} className="text-accent-400" />
        <h3 className="text-xs font-semibold text-text-primary">{block.title}</h3>
      </header>
      <div className="p-3">
        <div className="mx-auto w-fit max-w-full rounded-xl border border-accent-500/50 bg-accent-500/15 px-4 py-2 text-center">
          <div className="text-[11px] font-semibold text-text-primary">{block.root.label}</div>
          {block.root.description && <div className="mt-0.5 text-[9px] text-text-muted">{block.root.description}</div>}
        </div>
        <div className="mx-auto h-4 w-px bg-border-hover" />
        <div className="nowheel flex gap-2 overflow-x-auto border-t border-border-hover pt-3">
          {block.root.children.map((node) => <BranchCard key={node.id} node={node} />)}
        </div>
      </div>
    </section>
  );
}
