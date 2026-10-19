// The session's "⋯" menu: what the agent remembers (summarize or start fresh), and taking the session with you
// (lesson notes to study from, or a file someone else can replay).
import { useRef, useState } from 'react';
import { Icon } from './icons';
import { useDismiss } from './dismiss';
import { useT, useLang, serverText } from './i18n';

export function ThreadMenu({ id, mode, running, onContext }: {
  id: string; mode: 'build' | 'learn'; running?: boolean; onContext?: (a: 'clear' | 'compact') => Promise<string | null>;
}) {
  const t = useT();
  const fr = useLang() === 'fr';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState('');
  const wrap = useRef<HTMLSpanElement>(null);
  useDismiss(open, () => setOpen(false), wrap);
  const go = async (a: 'clear' | 'compact') => { setBusy(a); setErr(''); const e = await onContext!(a); setBusy(null); if (e) setErr(serverText(e, fr)); else setOpen(false); };
  return (
    <span className="thread-menu-wrap" ref={wrap}>
      <button className="icon-btn" onClick={() => setOpen(!open)} title={t('More', 'Plus')} aria-label={t('More', 'Plus')} aria-expanded={open}><Icon name="more" size={14} /></button>
      {open && (
        <div className="tm-menu thread-menu" role="menu">
          {onContext && <>
            <button role="menuitem" disabled={running || Boolean(busy)} onClick={() => go('compact')}>
              <b>{busy === 'compact' ? t('Summarizing…', 'Résumé en cours…') : t('Summarize the chat so far', 'Résumer la conversation')}</b>
              <span className="muted">{t('The agent goes on from a short summary. Useful when the chat gets long', 'L’agent continue à partir d’un court résumé. Utile quand la conversation devient longue')}</span>
            </button>
            <button role="menuitem" disabled={running || Boolean(busy)} onClick={() => go('clear')}>
              <b>{t('Start fresh', 'Repartir de zéro')}</b>
              <span className="muted">{t('The agent forgets the chat so far. What you see here stays', 'L’agent oublie la conversation. Ce que tu vois ici reste')}</span>
            </button>
            {(running || err) && <span className="muted tm-note">{err || t('Stop the agent first.', 'Arrête d’abord l’agent.')}</span>}
          </>}
          <a role="menuitem" href={`/api/threads/${id}/notes`} download onClick={() => setOpen(false)}>
            <b>{mode === 'learn' ? t('Lesson notes', 'Notes de cours') : t('Session notes', 'Notes de session')}</b>
            <span className="muted">{t('A study sheet (.md): what you asked, the decisions, the ideas explained, what changed', 'Une fiche (.md) : tes demandes, les décisions, les idées expliquées, ce qui a changé')}</span>
          </a>
          <a role="menuitem" href={`/api/threads/${id}/export`} download onClick={() => setOpen(false)}>
            <b>{t('Share this session', 'Partager cette session')}</b>
            <span className="muted">{t('A file anyone can open in agent-stage to replay it on the map. It includes the code and command output shown here', 'Un fichier que n’importe qui peut ouvrir dans agent-stage pour la revoir sur la carte. Il contient le code et les résultats affichés ici')}</span>
          </a>
        </div>
      )}
    </span>
  );
}
