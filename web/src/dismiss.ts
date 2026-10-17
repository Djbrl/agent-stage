// Close a popover or modal with Escape, and (when given an element) with a click outside it.
import { useEffect, type RefObject } from 'react';

// `inside`: the popover and anything that toggles it (so clicking the toggle doesn't close-then-reopen).
export function useDismiss(open: boolean, close: () => void, ...inside: RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const down = (e: MouseEvent) => { if (!inside.some((r) => r.current?.contains(e.target as Node))) close(); };
    window.addEventListener('keydown', key, true);
    if (inside.length) window.addEventListener('mousedown', down, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('mousedown', down, true); };
  }, [open]);
}
