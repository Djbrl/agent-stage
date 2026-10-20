// The public landing page (tandemcode-app.vercel.app): the app's own landing page, with no server behind it.
// "Try the demo" goes to the live demo's current link (live.json, written by scripts/public.sh).
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './Landing';
import { SiteProvider } from './useSettings';
import { useT } from './i18n';
import './style.css';

function Site() {
  const t = useT();
  const [note, setNote] = useState('');
  const start = async () => {
    setNote(t('Opening the live demo…', 'Ouverture de la démo…'));
    const url = await fetch('live.json', { cache: 'no-store' }).then((r) => r.json()).then((j) => j.url as string | null).catch(() => null);
    const status = url ? await fetch(`${url}/__status`, { cache: 'no-store', signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null) : null;
    if (!url || !status) return setNote(t('The live demo is offline right now. Come back a little later.', 'La démo est hors ligne pour le moment. Reviens un peu plus tard.'));
    if (status.free === false) return setNote(t('Every sandbox is busy. Try again in a few minutes.', 'Tous les bacs à sable sont pris. Réessaie dans quelques minutes.'));
    location.href = `${url.replace(/\/$/, '')}/?lang=${t('en', 'fr')}`; // the demo speaks the language picked here
  };
  return <>
    <Landing onStart={() => void start()} />
    {note && <div className="site-note" role="status" onClick={() => setNote('')}>{note}</div>}
  </>;
}

createRoot(document.getElementById('root')!).render(<SiteProvider><Site /></SiteProvider>);
