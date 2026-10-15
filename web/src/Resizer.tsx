// A vertical drag handle between two panels. Double-click resets.
import { useRef } from 'react';

export function Resizer({ onDrag, onReset, title }: { onDrag: (dx: number) => void; onReset?: () => void; title?: string }) {
  const last = useRef(0);
  return (
    <div className="resizer" title={title ?? 'Drag to resize'} onDoubleClick={onReset}
      onPointerDown={(e) => {
        last.current = e.clientX;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        document.body.classList.add('resizing');
      }}
      onPointerMove={(e) => {
        if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return;
        onDrag(e.clientX - last.current);
        last.current = e.clientX;
      }}
      onPointerUp={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); document.body.classList.remove('resizing'); }}
    />
  );
}

// A width remembered across visits.
export function storedNumber(key: string, fallback: number) {
  try { const n = Number(localStorage.getItem(key)); return Number.isFinite(n) && n > 0 ? n : fallback; } catch { return fallback; }
}
export function store(key: string, value: string | number) { try { localStorage.setItem(key, String(value)); } catch { /* private mode */ } }
