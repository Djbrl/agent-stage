// "What you learned": a lime card after a finished task, like the landing page shows it. The ideas as pills (tap one
// for its explanation), Quiz me, the exercise to try yourself, and Save to notes (it lands in Scratchpad's notes).
import { useState } from 'react';
import type { Concept, Entry } from './useAgent';
import { Icon } from './icons';
import { useT } from './i18n';

export function Learned({ entry, all, latest, onQuiz, onSave }: {
  entry: Extract<Entry, { kind: 'learned' }>; all: Concept[]; latest: boolean;
  onQuiz?: () => void; onSave?: (title: string, text: string) => Promise<boolean>;
}) {
  const t = useT();
  const [shown, setShown] = useState<string | null>(null);
  const [saved, setSaved] = useState<'no' | 'saving' | 'yes'>('no');
  const [open, setOpen] = useState(false);
  const pick = entry.concepts.find((c) => c.name === shown);
  const save = async () => {
    if (!onSave || saved !== 'no') return;
    setSaved('saving');
    const text = [`**${t('What you learned', 'Ce que tu as appris')}**`, '', ...entry.concepts.map((c) => `- **${c.name}**: ${c.line}`),
      ...(entry.exercise ? ['', `**${t('Your turn', 'À toi')}:** ${entry.exercise}`] : [])].join('\n');
    setSaved((await onSave(entry.concepts.map((c) => c.name).join(' · '), text).catch(() => false)) ? 'yes' : 'no');
  };
  return (
    <div className="learned">
      <div className="learned-head">{t('What you learned', 'Ce que tu as appris')}</div>
      <div className="learned-chips2">
        {entry.concepts.map((c) => (
          <button key={c.name} className={shown === c.name ? 'on' : ''} aria-expanded={shown === c.name} onClick={() => setShown(shown === c.name ? null : c.name)}>{c.name}</button>
        ))}
      </div>
      {pick && <p className="learned-line">{pick.line}</p>}
      <div className="learned-row">
        {onQuiz && <button className="learned-quiz" onClick={onQuiz}>{t('Quiz me', 'Interroge-moi')}</button>}
        {entry.exercise && <span><b>{t('Your turn:', 'À toi :')}</b> {entry.exercise}</span>}
      </div>
      <div className="learned-foot">
        {latest && all.length > entry.concepts.length && (
          <button className="learned-more" aria-expanded={open} onClick={() => setOpen(!open)}>
            {t(`${all.length} concepts so far`, `${all.length} notions jusqu’ici`)} <Icon name="chevron" size={9} className={open ? 'open' : ''} />
          </button>
        )}
        <span className="spacer" />
        {onSave && <button className="learned-save" disabled={saved !== 'no'} onClick={save}>
          {saved === 'yes' ? <><Icon name="check" size={12} />{t('Saved to notes', 'Gardé dans tes notes')}</> : <><Icon name="write" size={12} />{t('Save to notes', 'Garder dans mes notes')}</>}
        </button>}
      </div>
      {open && <div className="learned-chips2 small">{all.map((c) => <span key={c.name} title={c.line}>{c.name}</span>)}</div>}
    </div>
  );
}
