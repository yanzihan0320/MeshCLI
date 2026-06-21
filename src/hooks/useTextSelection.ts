import { useState, useCallback, useEffect } from 'react';

interface SelectionState {
  text: string;
  x: number;
  y: number;
}

export function useTextSelection(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [selection, setSelection] = useState<SelectionState | null>(null);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      return;
    }

    const text = sel.toString().trim();
    if (text.length < 2 || text.length > 200) {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    // Check that selection is within our container
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      return;
    }

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    setSelection({
      text,
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 8,
    });
  }, [containerRef]);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!selection) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-selection-popup]')) return;
      setSelection(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selection]);

  return { selection, handleMouseUp, clearSelection };
}
