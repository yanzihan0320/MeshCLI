import type { MetricCardsBlock as MetricCardsBlockData } from '../../../packages/protocol/src/a2ui';

const toneStyles = {
  neutral: 'border-border bg-surface-950',
  info: 'border-accent-500/25 bg-accent-500/8',
  success: 'border-emerald-500/30 bg-emerald-500/10',
  warning: 'border-amber-500/30 bg-amber-500/10',
  danger: 'border-red-500/30 bg-red-500/10',
};

export function MetricCardsBlock({ block }: { block: MetricCardsBlockData }) {
  return (
    <section aria-label={block.title ?? block.fallbackText}>
      {block.title && <h3 className="mb-2 text-xs font-semibold text-text-primary">{block.title}</h3>}
      <div className="grid grid-cols-3 gap-2">
        {block.metrics.map((metric) => (
          <div key={metric.id} className={`rounded-xl border px-2 py-2.5 text-center ${toneStyles[metric.tone]}`}>
            <div className="text-base font-semibold tracking-[-0.02em] text-text-primary">{metric.value}</div>
            <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-text-muted">{metric.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
