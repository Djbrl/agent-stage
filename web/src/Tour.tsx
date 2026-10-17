// First-run tour: a spotlight walks through the interface in ~60 seconds (English or French).
import { useEffect, useLayoutEffect, useState } from 'react';
import { useApp } from './useSettings';

type Stop = { sel: string; en: [string, string]; fr: [string, string] };
const STOPS: Stop[] = [
  { sel: '.sidebar', en: ['Your threads', 'Each thread is a conversation with the agent, in a folder on your computer. Start one with “New thread”.'],
    fr: ['Tes fils', 'Chaque fil est une conversation avec l’agent, dans un dossier de ton ordinateur. Commence avec « New thread ».'] },
  { sel: '.agent-panel .seg', en: ['Build or Learn', 'Build: the agent does the work. Learn: you design, it teaches, and it can only write code after you approve.'],
    fr: ['Construire ou apprendre', 'Build : l’agent travaille. Learn : tu conçois, il t’explique, et il n’écrit du code qu’après ton accord.'] },
  { sel: '.composer', en: ['Talk to it', 'Give a task and press Enter. While it works, typing steers it. “Ask” opens a side thread that can read but never change anything.'],
    fr: ['Parle-lui', 'Donne une tâche et appuie sur Entrée. Pendant qu’il travaille, ton message le réoriente. « Ask » ouvre un fil à part qui lit sans rien modifier.'] },
  { sel: '.stage', en: ['The stage', 'Your project as a map: folders are circles, files are dots. The agent is the blue marker. Fresh edits glow orange, failures turn red.'],
    fr: ['La scène', 'Ton projet en carte : les dossiers sont des cercles, les fichiers des points. L’agent est le point bleu. Les fichiers modifiés brillent en orange, les erreurs en rouge.'] },
  { sel: '.readmap', en: ['The readmap', 'Lit by what the agent reads. Agents read far more than they write: that’s how they understand your code before changing it.'],
    fr: ['La carte des lectures', 'Elle s’allume selon ce que l’agent lit. Un agent lit bien plus qu’il n’écrit : c’est comme ça qu’il comprend ton code avant de le changer.'] },
  { sel: '.stage-tools .steps', en: ['Every step, explained', 'Open the steps: each action in plain words. Click one for the exact change and “Explain this change”. Replay plays it all back on the map.'],
    fr: ['Chaque étape, expliquée', 'Ouvre les étapes : chaque action en mots simples. Clique pour voir le changement exact et « Explain this change ». Replay rejoue tout sur la carte.'] },
  { sel: '.stage-tools', en: ['Your camera, if you want it', 'The camera follows the agent by itself. Scroll or drag to take over; Follow gives it back. The eye shows what the agent reads.'],
    fr: ['La caméra, si tu veux', 'La caméra suit l’agent toute seule. Fais défiler ou glisse pour la prendre ; Follow la lui rend. L’œil montre ce que l’agent lit.'] },
  { sel: '.hdot', en: ['Is it ready?', 'Green means your model is connected. Hover for GPU, connection, tokens and cost.'],
    fr: ['Prêt ?', 'Vert : ton modèle est connecté. Survole pour le GPU, la connexion, les tokens et le coût.'] },
  { sel: '.side-account', en: ['Your models', 'Settings: plug in Claude, OpenAI, NVIDIA, Ollama or your own GPU. Choose your level and language for Learn mode.'],
    fr: ['Tes modèles', 'Réglages : branche Claude, OpenAI, NVIDIA, Ollama ou ton propre GPU. Choisis ton niveau et ta langue pour le mode Learn.'] },
];

export function Tour({ onDone }: { onDone: () => void }) {
  const { settings } = useApp();
  const fr = settings?.learn.language === 'fr';
  // Only what's on screen now (the chat may sit in a hidden tab).
  const stops = STOPS.filter((s) => { const r = document.querySelector(s.sel)?.getBoundingClientRect(); return Boolean(r && r.width && r.height); });
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const stop = stops[i];
  useLayoutEffect(() => {
    const el = stop && document.querySelector(stop.sel);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [i, stop?.sel]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.stopPropagation(); i < stops.length - 1 ? setI(i + 1) : onDone(); }
      if (e.key === 'ArrowLeft') { e.stopPropagation(); setI(Math.max(0, i - 1)); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  if (!stop || !rect) return null;
  const [title, body] = fr ? stop.fr : stop.en;
  const pad = 6;
  // Tall targets get the card beside them; short ones get it below (or above if there's no room).
  const W = window.innerWidth, H = window.innerHeight, CW = 320, CH = 190;
  let left = Math.min(Math.max(12, rect.left), W - CW - 12), top: number;
  if (rect.height > H * 0.45) {
    left = rect.right + 16 + CW < W ? rect.right + 16 : Math.max(12, rect.left - CW - 16);
    top = Math.min(Math.max(12, rect.top + 40), H - CH - 12);
    if (left + CW > rect.left && left < rect.right) top = Math.max(12, rect.bottom - CH - 20); // no room beside: inside, at the bottom
  } else top = rect.bottom + 14 + CH < H ? rect.bottom + 14 : Math.max(12, rect.top - CH - 14);
  return (
    <div className="tour">
      <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div className="tour-card" style={{ left, top }}>
        <div className="tour-step mono">{i + 1}/{stops.length}</div>
        <div className="tour-title">{title}</div>
        <div className="tour-body">{body}</div>
        <div className="tour-actions">
          <button className="btn ghost sm" onClick={onDone}>{fr ? 'Passer' : 'Skip'}</button>
          <span className="spacer" />
          {i > 0 && <button className="btn ghost sm" onClick={() => setI(i - 1)}>{fr ? 'Retour' : 'Back'}</button>}
          <button className="btn primary sm" onClick={() => (i < stops.length - 1 ? setI(i + 1) : onDone())}>{i < stops.length - 1 ? (fr ? 'Suivant' : 'Next') : (fr ? 'C’est parti' : 'Let’s go')}</button>
        </div>
      </div>
    </div>
  );
}
