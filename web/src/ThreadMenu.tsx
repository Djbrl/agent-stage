// The thread's "⋯" menu: take the session with you. Lesson notes to study from, or a file someone else can replay.
import { useRef, useState } from 'react';
import { Icon } from './icons';
import { useDismiss } from './dismiss';

export function ThreadMenu({ id, mode }: { id: string; mode: 'build' | 'learn' }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useDismiss(open, () => setOpen(false), wrap);
  return (
    <span className="thread-menu-wrap" ref={wrap}>
      <button className="icon-btn" onClick={() => setOpen(!open)} title="Notes and sharing" aria-label="Notes and sharing" aria-expanded={open}><Icon name="more" size={14} /></button>
      {open && (
        <div className="tm-menu thread-menu" role="menu">
          <a role="menuitem" href={`/api/threads/${id}/notes`} download onClick={() => setOpen(false)}>
            <b>{mode === 'learn' ? 'Lesson notes' : 'Session notes'}</b>
            <span className="muted">A study sheet (.md): what you asked, the decisions, the ideas explained, what changed</span>
          </a>
          <a role="menuitem" href={`/api/threads/${id}/export`} download onClick={() => setOpen(false)}>
            <b>Share this session</b>
            <span className="muted">A file anyone can open in agent-stage to replay it on the map. It includes the code and command output shown here</span>
          </a>
        </div>
      )}
    </span>
  );
}
