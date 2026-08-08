import { ArrowLeft, ArrowRight, CircleDot, Flag } from 'lucide-react';
import type { TaskBoardBlock as TaskBoardBlockData } from '../../../packages/protocol/src/a2ui';

interface TaskBoardBlockProps {
  block: TaskBoardBlockData;
  onChange?: (block: TaskBoardBlockData) => void;
}

const priorityStyles = {
  low: 'text-sky-400',
  medium: 'text-amber-400',
  high: 'text-red-400',
};

export function TaskBoardBlock({ block, onChange }: TaskBoardBlockProps) {
  const moveTask = (columnIndex: number, taskIndex: number, direction: -1 | 1) => {
    const targetIndex = columnIndex + direction;
    if (targetIndex < 0 || targetIndex >= block.columns.length) return;
    const columns = block.columns.map((column) => ({ ...column, tasks: [...column.tasks] }));
    const [task] = columns[columnIndex].tasks.splice(taskIndex, 1);
    if (!task) return;
    columns[targetIndex].tasks.push(task);
    onChange?.({ ...block, columns });
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface-900 shadow-sm">
      <header className="flex items-center gap-2 border-b border-border bg-surface-800 px-3 py-2">
        <CircleDot size={15} className="text-accent-400" />
        <h3 className="text-xs font-semibold text-text-primary">{block.title}</h3>
      </header>
      <div className="nowheel flex gap-2 overflow-x-auto p-2.5">
        {block.columns.map((column, columnIndex) => (
          <div key={column.id} className="w-52 shrink-0 rounded-lg border border-border/70 bg-surface-950 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{column.title}</h4>
              <span className="rounded-full bg-surface-800 px-1.5 py-0.5 text-[9px] text-text-muted">{column.tasks.length}</span>
            </div>
            <div className="space-y-2">
              {column.tasks.map((task, taskIndex) => (
                <article key={task.id} className="rounded-md border border-border/70 bg-surface-900 p-2">
                  <div className="flex items-start gap-1.5">
                    <Flag size={11} className={`mt-0.5 shrink-0 ${priorityStyles[task.priority]}`} />
                    <div className="min-w-0 flex-1">
                      <h5 className="text-[10px] font-medium leading-snug text-text-primary">{task.title}</h5>
                      {task.description && <p className="mt-1 text-[9px] leading-relaxed text-text-muted">{task.description}</p>}
                    </div>
                  </div>
                  {block.columns.length > 1 && (
                    <div className="mt-2 flex justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`Move ${task.title} left`}
                        disabled={columnIndex === 0 || !onChange}
                        onClick={() => moveTask(columnIndex, taskIndex, -1)}
                        className="rounded p-1 text-text-muted hover:bg-surface-800 hover:text-text-primary disabled:opacity-25"
                      >
                        <ArrowLeft size={11} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${task.title} right`}
                        disabled={columnIndex === block.columns.length - 1 || !onChange}
                        onClick={() => moveTask(columnIndex, taskIndex, 1)}
                        className="rounded p-1 text-text-muted hover:bg-surface-800 hover:text-text-primary disabled:opacity-25"
                      >
                        <ArrowRight size={11} />
                      </button>
                    </div>
                  )}
                </article>
              ))}
              {column.tasks.length === 0 && <p className="py-3 text-center text-[9px] text-text-muted">No tasks</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
