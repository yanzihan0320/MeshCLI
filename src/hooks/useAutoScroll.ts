import { useEffect, useRef } from 'react';

export function useAutoScroll(dependency: unknown) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const isNearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;

    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [dependency]);

  return ref;
}
