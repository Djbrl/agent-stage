// The landing page, shown on a first visit before anything else (same look as public/site). "Try it" opens the
// first-launch tutorial in Welcome.tsx.
import { useEffect } from 'react';
import { useT } from './i18n';
import { useApp } from './useSettings';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
export const landed = () => read('landed') === '1';
export const markLanded = () => { try { localStorage.setItem('landed', '1'); } catch { /* private mode */ } };

const Bike = ({ w = 54, wheel = '#141414', back = '#ff5a1f', front = '#2f45e8' }: { w?: number; wheel?: string; back?: string; front?: string }) => (
  <svg width={w} height={Math.round(w * 0.6)} viewBox="0 0 120 72" aria-hidden="true">
    <g fill="none" stroke={wheel} strokeWidth="7" strokeLinejoin="round" strokeLinecap="round">
      <circle cx="26" cy="50" r="17" /><circle cx="94" cy="50" r="17" /><path d="M26 50 L44 27 L60 50 L74 27 L94 50 M44 27 L84 23 L89 17" />
    </g>
    <circle cx="42" cy="11" r="9" fill={back} /><circle cx="72" cy="9" r="9" fill={front} />
  </svg>
);

export function Landing({ onStart }: { onStart: () => void }) {
  const t = useT();
  const { settings, save } = useApp();
  const learn = settings?.learn;
  // First visit: speak the browser's language from the very first screen (Welcome then keeps it).
  useEffect(() => {
    if (!learn || read('langPicked')) return;
    try { localStorage.setItem('langPicked', '1'); } catch { /* private mode */ }
    const fr = navigator.language?.toLowerCase().startsWith('fr');
    if (fr !== (learn.language === 'fr')) void save({ learn: { ...learn, language: fr ? 'fr' : 'en' } });
  }, [Boolean(learn)]);
  return (
    <div className="lp">
      <div className="lp-wrap">
        <nav className="lp-nav">
          <span className="lp-brand"><Bike /> <b>codetandem</b></span>
          <div className="lp-links">
            <a href="#lp-how">{t('How it works', 'Comment ça marche')}</a>
            <a href="https://github.com/Djbrl/agent-stage" target="_blank" rel="noreferrer">GitHub</a>
            <button className="lp-pill lp-ink" onClick={onStart}>{t('Try it', 'Essayer')}</button>
          </div>
        </nav>

        <section className="lp-hero">
          <div className="lp-copy">
            <h1>{t('You steer.', 'Tu guides.')}<br />{t('It pedals.', 'Il pédale.')}</h1>
            <p className="lp-lede">{t('The coding agent for learners. You ride along on every change, it asks before it writes, and each task ends with what you learned.',
              'L’agent de code pour apprendre. Tu suis chaque changement, il demande avant d’écrire, et chaque tâche se termine par ce que tu as appris.')}</p>
            <div className="lp-cta">
              <button className="lp-pill lp-go" onClick={onStart}>{t('Try it now', 'Essayer maintenant')}</button>
              <a className="lp-pill lp-alt" href="https://github.com/Djbrl/agent-stage" target="_blank" rel="noreferrer">{t('Source on GitHub', 'Code sur GitHub')}</a>
            </div>
            <p className="lp-note">{t('Runs on this computer. Your code stays here.', 'Tourne sur cet ordinateur. Ton code reste ici.')}</p>
          </div>
          <div className="lp-board">
            <svg viewBox="0 0 480 340" role="img" aria-label={t('A map of a project: the tandem rides from file to file and stops to ask before writing', 'Une carte du projet : le tandem va de fichier en fichier et s’arrête pour demander avant d’écrire')}>
              <rect width="480" height="340" rx="14" fill="#f1f1ea" />
              <circle cx="170" cy="180" r="104" fill="#e6e7dc" />
              <text x="170" y="98" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="12" fill="#5b5b55">src</text>
              <path id="lp-route" d="M110 205 C 150 120, 230 120, 250 200 S 360 290, 400 120" fill="none" stroke="#ff5a1f" strokeWidth="9" strokeLinecap="round" />
              <g fontFamily="Figtree, sans-serif" fontSize="14" fontWeight="600" fill="#141414">
                <circle cx="110" cy="205" r="14" fill="#2f45e8" /><text x="70" y="240">app.js</text>
                <circle cx="250" cy="200" r="14" fill="#ffd23f" stroke="#141414" strokeWidth="3" /><text x="270" y="205">greet.js</text>
                <circle cx="400" cy="120" r="14" fill="#c8f169" stroke="#141414" strokeWidth="3" /><text x="358" y="160">test.js</text>
                <circle cx="430" cy="50" r="10" fill="#e6e7dc" /><text x="368" y="40">README.md</text>
                <circle cx="200" cy="140" r="10" fill="#d4d6c8" /><circle cx="160" cy="250" r="10" fill="#d4d6c8" />
              </g>
              <g className="lp-move">
                <animateMotion dur="9s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0;.48;.48;1;1" keyTimes="0;.06;.36;.62;.9;1"><mpath href="#lp-route" /></animateMotion>
                <rect x="-35" y="-31" width="70" height="46" rx="12" fill="#141414" />
                <g transform="translate(-27 -25)"><Bike wheel="#fafaf7" front="#c8f169" /></g>
              </g>
              <g className="lp-move" transform="translate(272 236)">
                <animate attributeName="opacity" dur="9s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="0;.37;.40;.60;.63;1" />
                <rect width="184" height="76" rx="16" fill="#ffffff" stroke="#141414" strokeWidth="2" />
                <text x="16" y="30" fontFamily="Figtree, sans-serif" fontSize="15" fontWeight="600" fill="#141414">{t('Write the test first?', 'Le test d’abord ?')}</text>
                <rect x="16" y="42" width="56" height="24" rx="12" fill="#ff5a1f" />
                <text x="44" y="59" textAnchor="middle" fontFamily="Figtree, sans-serif" fontSize="13" fontWeight="700" fill="#141414">{t('Yes', 'Oui')}</text>
                <text x="86" y="59" fontFamily="Figtree, sans-serif" fontSize="13" fontWeight="600" fill="#5b5b55">{t('Not yet', 'Pas encore')}</text>
              </g>
            </svg>
          </div>
        </section>

        <section id="lp-how" className="lp-how">
          <h2>{t('Code in tandem.', 'Coder en tandem.')}</h2>
          <div className="lp-cards">
            <div className="lp-card lp-c1"><span className="lp-n">1</span><h3>{t('It asks first', 'Il demande d’abord')}</h3><p>{t('You pick the approach. No code is written before you say yes.', 'Tu choisis l’approche. Aucun code n’est écrit avant ton oui.')}</p></div>
            <div className="lp-card lp-c2"><span className="lp-n">2</span><h3>{t('You ride along', 'Tu suis le parcours')}</h3><p>{t('Its route through your project is drawn as it goes. Tap any stop to see the change and why.', 'Son trajet dans ton projet se dessine au fur et à mesure. Touche une étape pour voir le changement et pourquoi.')}</p></div>
            <div className="lp-card lp-c3"><span className="lp-n">3</span><h3>{t('You keep what you learned', 'Tu gardes ce que tu as appris')}</h3><p>{t('Every ride ends with the ideas it used and one small exercise. One click undoes anything.', 'Chaque sortie se termine par les notions utilisées et un petit exercice. Un clic annule tout.')}</p></div>
          </div>
        </section>

        <section className="lp-open">
          <div><h3>{t('Open source, MIT.', 'Open source, MIT.')}</h3><p>{t('Runs open models like Qwen3-Coder on your own GPU or through Ollama, or Claude.', 'Fonctionne avec des modèles ouverts comme Qwen3-Coder sur ton GPU ou via Ollama, ou avec Claude.')}</p></div>
          <button className="lp-pill lp-lime" onClick={onStart}>{t('Try it now', 'Essayer maintenant')}</button>
        </section>
      </div>
    </div>
  );
}
