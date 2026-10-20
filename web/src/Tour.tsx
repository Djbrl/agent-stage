// A short walkthrough of the interface, the first time you land in a session (before any contextual tip): the
// panel, the chat box, Scratchpad, the map, the model and Settings. One spotlight at a time; Esc or "Skip" ends it.
// Remembered in this browser (TOUR_DONE); Reset onboarding and Erase all my data bring it back.
import { useEffect, useLayoutEffect, useState } from 'react';
import { useT } from './i18n';

export const TOUR_DONE = 'tourDone';
export const tourDone = () => { try { return localStorage.getItem(TOUR_DONE) === '1'; } catch { return true; } };

type Stop = { at: () => DOMRect | null; title: [string, string]; text: [string, string] };
const rect = (sel: string) => { for (const el of document.querySelectorAll(sel)) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return r; } return null; };
// The map is whatever the floating panel leaves free.
const mapArea = () => {
  const s = rect('.studio'), p = rect('.studio-panel');
  if (!s) return null;
  const left = p ? p.right + 16 : s.left + 16;
  return new DOMRect(left, s.top + 16, Math.max(120, s.right - left - 16), s.height - 32);
};

const STOPS: Stop[] = [
  { at: () => rect('.studio-panel'), title: ['Your panel', 'Ton panneau'],
    text: ['Your conversation with the agent. Tabs show up here as you go: Sessions lists your other projects, Steps lists everything the agent did. New session starts another one.', 'Ta conversation avec l’agent. Des onglets apparaissent ici au fil du temps : Sessions liste tes autres projets, Étapes tout ce qu’a fait l’agent. Nouvelle session en démarre une autre.'] },
  { at: () => rect('.agent-panel .composer-box'), title: ['Tell it what to build', 'Dis-lui quoi construire'],
    text: ['Type or say what you want. In Tandem mode it asks before it writes code; Solo just builds.', 'Écris ou dis ce que tu veux. En mode Tandem, il demande avant d’écrire du code ; Solo construit directement.'] },
  { at: () => rect('.scratch-btn'), title: ['Scratchpad', 'Le Brouillon'],
    text: ['Ask a side question, sketch an idea or mark up a screenshot, without stopping the agent. Answers stay in your notes.', 'Pose une question à part, dessine une idée ou annote une capture, sans arrêter l’agent. Les réponses restent dans tes notes.'] },
  { at: mapArea, title: ['The map', 'La carte'],
    text: ['Your project, drawn as a map. Watch the agent move: files light up blue when it reads them, orange when it edits them.', 'Ton projet, dessiné comme une carte. Suis l’agent : les fichiers s’allument en bleu quand il les lit, en orange quand il les modifie.'] },
  { at: () => rect('.spark-btn'), title: ['The model', 'Le modèle'],
    text: ['Pick which AI does the work. Grey means it can’t answer right now.', 'Choisis l’IA qui fait le travail. Gris veut dire qu’elle ne peut pas répondre pour l’instant.'] },
  { at: () => rect('.head-settings'), title: ['Settings', 'Réglages'],
    text: ['Your agents and keys, your level, and what the agent may do without asking.', 'Tes agents et clés, ton niveau, et ce que l’agent peut faire sans demander.'] },
];

export function Tour({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [i, setI] = useState(0);
  const [r, setR] = useState<DOMRect | null>(null);
  const stops = STOPS.filter((s) => s.at()); // only what's on screen
  const stop = stops[Math.min(i, stops.length - 1)];
  const [, force] = useState(0);
  const finish = () => { try { localStorage.setItem(TOUR_DONE, '1'); } catch { /* private mode */ } window.dispatchEvent(new Event('tour-done')); onDone(); };
  useLayoutEffect(() => {
    const place = () => { const at = stop?.at() ?? null; setR(at); if (!at) force((n) => n + 1); }; // not drawn yet: look again
    place();
    const iv = setInterval(place, 300);
    window.addEventListener('resize', place);
    return () => { clearInterval(iv); window.removeEventListener('resize', place); };
  }, [i, stops.length]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); i < stops.length - 1 ? setI(i + 1) : finish(); }
      if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  if (!stop || !r) return null;
  const fr = t('en', 'fr') === 'fr';
  const pad = 8, W = 320;
  const below = r.bottom + 180 < window.innerHeight;
  const right = r.width > window.innerWidth * 0.45; // a big area (the map): put the card inside it, on the left
  const tall = !right && r.height > window.innerHeight * 0.5; // a tall panel: put the card beside it
  const left = right ? r.left + 24 : tall ? r.right + pad + 16 : Math.max(16, Math.min(window.innerWidth - W - 16, r.left + r.width / 2 - W / 2));
  const top = right || tall ? r.top + 24 : below ? r.bottom + pad + 12 : Math.max(16, r.top - pad - 12 - 170);
  const last = i >= stops.length - 1;
  return (
    <div className="tour" role="dialog" aria-label={t('A quick tour', 'Petite visite')}>
      <div className="tour-hole" style={{ left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }} />
      <div className="tour-card" style={{ left, top, width: W }}>
        <div className="tour-count">{i + 1} / {stops.length}</div>
        <b>{stop.title[fr ? 1 : 0]}</b>
        <p>{stop.text[fr ? 1 : 0]}</p>
        <div className="tour-row">
          <button className="tour-skip" onClick={finish}>{t('Skip the tour', 'Passer la visite')}</button>
          <span className="spacer" />
          {i > 0 && <button className="btn ghost" onClick={() => setI(i - 1)}>{t('Back', 'Retour')}</button>}
          <button className="btn primary" autoFocus onClick={() => (last ? finish() : setI(i + 1))}>{last ? t('Let’s go', 'C’est parti') : t('Next', 'Suivant')}</button>
        </div>
      </div>
    </div>
  );
}
