// "What you learned": a small card after a finished task. 2-3 ideas tied to what the agent just did, one
// exercise to try by hand, and (on the newest card) every concept met in this thread so far.
import { useState } from 'react';
import type { Concept, Entry } from './useAgent';
import { Icon } from './icons';
import { useT } from './i18n';

export function Learned({ entry, all, latest, onTry }: {
  entry: Extract<Entry, { kind: 'learned' }>; all: Concept[]; latest: boolean; onTry?: (text: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="learned">
      <div className="learned-head"><Icon name="spark" size={12} /> {t('What you learned', 'Ce que tu as appris')}</div>
      <ul className="learned-list">
        {entry.concepts.map((c) => <li key={c.name}><b>{c.name}</b><span>{c.line}</span></li>)}
      </ul>
      {entry.exercise && (
        <div className="learned-try">
          <div><span className="learned-label">{t('Try it yourself', 'À toi de jouer')}</span>{entry.exercise}</div>
          {onTry && <button className="btn ghost sm" title={t('Put this in the message box: do it by hand, then send it so the agent checks your work', 'Le mettre dans la zone de message : fais-le à la main, puis envoie pour que l’agent vérifie')}
            onClick={() => onTry(`${t('I tried this exercise myself, check my work and tell me what to fix (don\'t change the files): ', 'J’ai fait cet exercice moi-même, vérifie mon travail et dis-moi quoi corriger (sans modifier les fichiers) : ')}${entry.exercise}`)}>
            {t('Try it', 'Essayer')}</button>}
        </div>
      )}
      {latest && all.length > entry.concepts.length && (
        <div className="learned-sofar">
          <button className="learned-more" aria-expanded={open} onClick={() => setOpen(!open)}>
            {t(`${all.length} concepts so far`, `${all.length} notions jusqu’ici`)} <Icon name="chevron" size={9} className={open ? 'open' : ''} />
          </button>
          {open && <div className="learned-chips">{all.map((c) => <span key={c.name} className="chip" title={c.line}>{c.name}</span>)}</div>}
        </div>
      )}
    </div>
  );
}
