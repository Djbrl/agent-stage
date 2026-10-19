// The landing page, shown on a first visit before anything else. Three features told as scroll scenes (the map,
// learning, engines), each with a drawn mockup that changes as you read, then a finish line and Try it live.
// The page itself is a route: an orange line draws down the side as you scroll, with the tandem at its tip.
// "Try it" opens the first-launch tutorial in Welcome.tsx.
import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from './i18n';
import { useApp } from './useSettings';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
export const landed = () => read('landed') === '1';
export const markLanded = () => { try { localStorage.setItem('landed', '1'); } catch { /* private mode */ } };
// Settings → Reset onboarding: forget the first-launch flags and the tips seen, then show it all again.
export const REPLAY = 'replayOnboarding';
export function resetOnboarding() {
  try {
    for (const k of ['landed', 'langPicked', 'defaultsNoted', 'tips-seen', 'thread']) localStorage.removeItem(k);
    localStorage.setItem(REPLAY, '1');
  } catch { /* private mode */ }
  location.reload();
}

const Bike = ({ w = 54, wheel = '#141414', back = '#ff5a1f', front = '#2f45e8', spin = false }: { w?: number; wheel?: string; back?: string; front?: string; spin?: boolean }) => (
  <svg width={w} height={Math.round(w * 0.6)} viewBox="0 0 120 72" aria-hidden="true" className={spin ? 'lp-spin' : undefined}>
    <g fill="none" stroke={wheel} strokeWidth="7" strokeLinejoin="round" strokeLinecap="round">
      <g className="lp-wheel" style={{ transformOrigin: '26px 50px' }}><circle cx="26" cy="50" r="17" /><path d="M26 33 V67 M9 50 H43" strokeWidth="3" /></g>
      <g className="lp-wheel" style={{ transformOrigin: '94px 50px' }}><circle cx="94" cy="50" r="17" /><path d="M94 33 V67 M77 50 H111" strokeWidth="3" /></g>
      <path d="M26 50 L44 27 L60 50 L74 27 L94 50 M44 27 L84 23 L89 17" />
    </g>
    <circle cx="42" cy="11" r="9" fill={back} /><circle cx="72" cy="9" r="9" fill={front} />
  </svg>
);

// Scroll engine: one listener on the page sets --gp (whole page, 0..1) on the page, and on each scene --p (0..1)
// and data-beat (which of its beats is on screen). Elements with data-in get an "in" class once seen.
function useScroll(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const route = el.querySelector<SVGPathElement>('.lp-route-path');
    const rider = el.querySelector<HTMLElement>('.lp-rider');
    const len = route?.getTotalLength() ?? 0;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const max = el.scrollHeight - el.clientHeight;
      el.style.setProperty('--gp', (max > 0 ? el.scrollTop / max : 0).toFixed(4));
      for (const s of el.querySelectorAll<HTMLElement>('[data-scene]')) {
        const r = s.getBoundingClientRect();
        const run = r.height - el.clientHeight;
        const p = Math.min(1, Math.max(0, run > 0 ? -r.top / run : 0));
        const beats = Number(s.dataset.scene);
        s.style.setProperty('--p', p.toFixed(4));
        s.dataset.beat = String(Math.min(beats - 1, Math.floor(p * beats)));
      }
      for (const n of el.querySelectorAll<HTMLElement>('[data-in]:not(.in)')) if (n.getBoundingClientRect().top < el.clientHeight * 0.8) n.classList.add('in');
      // The route: drawn as far as you've read, the tandem at its tip, a checkpoint at the start of each scene.
      const story = el.querySelector<HTMLElement>('.lp-story');
      if (route && rider && story && len) {
        const sr = story.getBoundingClientRect();
        const box = route.ownerSVGElement!.getBoundingClientRect();
        const k = box.height / 1000; // the route is mostly vertical: its length on screen is close to len × k
        const sp = Math.min(1, Math.max(0, (el.clientHeight * 0.5 - sr.top) / sr.height));
        route.style.strokeDasharray = `${len * k + 40}`;
        route.style.strokeDashoffset = `${(len * k + 40) * (1 - sp)}`;
        const at = (f: number) => { // the route's point at a fraction of the story's height
          let lo = 0, hi = len;
          for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (route.getPointAtLength(mid).y < f * 1000) lo = mid; else hi = mid; }
          const pt = route.getPointAtLength(lo);
          return [(pt.x / 80) * box.width, (pt.y / 1000) * box.height];
        };
        const [rx, ry] = at(sp);
        rider.style.transform = `translate(${rx}px, ${ry}px)`;
        for (const c of el.querySelectorAll<HTMLElement>('.lp-cp')) {
          const scene = el.querySelector<HTMLElement>(`#${c.dataset.for}`);
          if (!scene) continue;
          const f = (scene.getBoundingClientRect().top - sr.top) / sr.height + 0.02;
          const [cx, cy] = at(f);
          c.style.transform = `translate(${cx}px, ${cy}px)`;
          c.classList.toggle('on', sp >= f);
        }
      }
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(tick); };
    tick();
    el.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { el.removeEventListener('scroll', on); window.removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, []);
}

export function Landing({ onStart }: { onStart: () => void }) {
  const t = useT();
  const { settings, save } = useApp();
  const learn = settings?.learn;
  const root = useRef<HTMLDivElement>(null);
  useScroll(root);
  // First visit: speak the browser's language from the very first screen (Welcome then keeps it).
  useEffect(() => {
    if (!learn || read('langPicked')) return;
    try { localStorage.setItem('langPicked', '1'); } catch { /* private mode */ }
    const fr = navigator.language?.toLowerCase().startsWith('fr');
    if (fr !== (learn.language === 'fr')) void save({ learn: { ...learn, language: fr ? 'fr' : 'en' } });
  }, [Boolean(learn)]);
  const lang = learn?.language ?? 'en';
  const setLang = (l: 'en' | 'fr') => { if (learn && l !== lang) void save({ learn: { ...learn, language: l } }); };
  const go = (id: string) => root.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="lp" ref={root}>
      <header className="lp-bar">
        <div className="lp-bar-in">
          <span className="lp-brand"><Bike w={40} /> <b>codetandem</b></span>
          <nav className="lp-links" aria-label={t('Sections', 'Sections')}>
            <button onClick={() => go('lp-map')}>{t('The map', 'La carte')}</button>
            <button onClick={() => go('lp-learn')}>{t('Learning', 'Apprendre')}</button>
            <button onClick={() => go('lp-engines')}>{t('Engines', 'Moteurs')}</button>
            <span className="lp-lang" role="group" aria-label={t('Language', 'Langue')}>
              <button className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
              <button className={lang === 'fr' ? 'on' : ''} aria-pressed={lang === 'fr'} onClick={() => setLang('fr')}>FR</button>
            </span>
          </nav>
          <button className="lp-cta lp-sm" onClick={onStart}>{t('Try it live', 'Essayer en direct')}</button>
        </div>
        <div className="lp-lane" aria-hidden="true"><span className="lp-lane-bike"><Bike w={30} spin /></span><span className="lp-lane-flag" /></div>
      </header>

      <section className="lp-hero">
        <div className="lp-lights" aria-hidden="true"><i /><i /><i /></div>
        <p className="lp-eyebrow">{t('The coding agent for learners', 'L’agent de code pour apprendre')}</p>
        <h1><span className="lp-from-l">{t('You steer.', 'Tu guides.')}</span><span className="lp-from-r">{t('It pedals.', 'Il pédale.')}</span></h1>
        <p className="lp-lede">{t('AI can write your code. Codetandem makes sure you understand it: follow every move on a map, ask anything along the way, and pick the engine you ride with.',
          'L’IA sait écrire ton code. Codetandem s’assure que tu le comprends : suis chaque geste sur une carte, pose tes questions en route, et choisis le moteur avec lequel tu roules.')}</p>
        <div className="lp-cta-row">
          <button className="lp-cta" onClick={onStart}>{t('Try it live', 'Essayer en direct')}</button>
          <button className="lp-ghost" onClick={() => go('lp-map')}>{t('See how it works', 'Voir comment ça marche')} ↓</button>
        </div>
      </section>

      <div className="lp-story">
        <svg className="lp-route" viewBox="0 0 80 1000" preserveAspectRatio="none" aria-hidden="true">
          <path className="lp-route-bg" d="M40 0 C 70 80, 10 160, 40 240 S 70 400, 40 480 S 10 640, 40 720 S 70 880, 40 1000" />
          <path className="lp-route-path" d="M40 0 C 70 80, 10 160, 40 240 S 70 400, 40 480 S 10 640, 40 720 S 70 880, 40 1000" />
        </svg>
        {['lp-map', 'lp-learn', 'lp-engines'].map((id) => <span key={id} className="lp-cp" data-for={id} aria-hidden="true" />)}
        <span className="lp-rider" aria-hidden="true"><Bike w={44} spin /></span>

        <Scene id="lp-map" tone="blue" kicker={t('The map · a Rundown integration', 'La carte · une intégration Rundown')}
          title={[t('Every move.', 'Chaque geste.'), t('On the map.', 'Sur la carte.')]}
          beats={[
            [t('See everything it does', 'Vois tout ce qu’il fait'), t('Your project is drawn as a map. Files it reads light up blue, files it edits turn orange, and its terminal and browser show up as stops. No more scrolling through logs.', 'Ton projet est dessiné comme une carte. Les fichiers qu’il lit s’allument en bleu, ceux qu’il modifie passent en orange, et son terminal et son navigateur apparaissent comme des étapes. Fini de fouiller les logs.')],
            [t('Rewind any step', 'Rembobine chaque étape'), t('Scrub back through the ride. Every stop keeps the exact change, the command and its output, and why it was made. One click undoes the whole task.', 'Reviens en arrière sur le parcours. Chaque étape garde le changement exact, la commande et son résultat, et la raison. Un clic annule toute la tâche.')],
            [t('Ask about anything', 'Pose ta question, n’importe où'), t('Click a file or a step and ask. The answer comes from what the agent actually did, not from a guess.', 'Clique sur un fichier ou une étape et demande. La réponse vient de ce que l’agent a vraiment fait, pas d’une supposition.')],
          ]}
          mock={<MapMock t={t} />} />

        <Scene id="lp-learn" tone="lime" kicker={t('Learning', 'Apprendre')}
          title={[t('Learn while', 'Apprends pendant'), t('it works.', 'qu’il travaille.')]}
          beats={[
            [t('Ask anytime, without stopping it', 'Demande, sans l’arrêter'), t('Press ⌘K or select any text to open a temporary thread on the side. The agent keeps going, and your question stays out of its way.', 'Appuie sur ⌘K ou sélectionne un texte pour ouvrir un fil temporaire à côté. L’agent continue, et ta question ne le gêne pas.')],
            [t('Notes for every project', 'Des notes pour chaque projet'), t('Keep any answer in your notes with one click. Each project builds its own study sheet, in Markdown, that you can take anywhere.', 'Garde une réponse dans tes notes en un clic. Chaque projet construit sa fiche de cours, en Markdown, à emporter partout.')],
            [t('Finish knowing more', 'Termine en sachant plus'), t('Every task ends with the ideas it used, explained for your level, a quick quiz, and one exercise to try on your own.', 'Chaque tâche se termine par les notions utilisées, expliquées à ton niveau, un petit quiz, et un exercice à faire seul.')],
          ]}
          mock={<LearnMock t={t} />} flip />

        <Scene id="lp-engines" tone="orange" kicker={t('Engines', 'Moteurs')}
          title={[t('Shift gears.', 'Change de braquet.'), t('Any time.', 'Quand tu veux.')]}
          beats={[
            [t('Open-weight models', 'Modèles à poids ouverts'), t('Run Qwen3-Coder on your own GPU in one click, on this computer with Ollama, or hosted on NVIDIA. Your code and your model stay yours.', 'Fais tourner Qwen3-Coder sur ton GPU en un clic, sur cet ordinateur avec Ollama, ou hébergé chez NVIDIA. Ton code et ton modèle restent à toi.')],
            [t('Claude, two ways', 'Claude, de deux façons'), t('Use Claude in our own agent loop, or switch to the Claude Code engine. Same map, same lessons.', 'Utilise Claude dans notre boucle d’agent, ou passe au moteur Claude Code. Même carte, mêmes leçons.')],
            [t('Codex, coming next', 'Codex, bientôt'), t('Codex is next on the list. Engines switch per session, so you can try one on the same project.', 'Codex est le prochain. Le moteur se choisit par session, alors tu peux en essayer un sur le même projet.')],
          ]}
          mock={<GearMock t={t} />} />
      </div>

      <section className="lp-finish" data-in>
        <div className="lp-checker" aria-hidden="true" />
        <div className="lp-tape" aria-hidden="true"><i /><i /></div>
        <h2>{t('Ready to ride?', 'Prêt à rouler ?')}</h2>
        <p>{t('Open one of your projects, or start the guided demo. Open source, MIT, runs on your own computer.', 'Ouvre un de tes projets, ou lance la démo guidée. Open source, MIT, tourne sur ton ordinateur.')}</p>
        <div className="lp-cta-row">
          <button className="lp-cta lp-big" onClick={onStart}>{t('Try it live', 'Essayer en direct')}</button>
          <a className="lp-ghost" href="https://github.com/Djbrl/agent-stage" target="_blank" rel="noreferrer">{t('Source on GitHub', 'Code sur GitHub')}</a>
        </div>
      </section>
      <footer className="lp-foot">{t('Built for the Open Source × AI Hackathon 2026.', 'Fait pour l’Open Source × AI Hackathon 2026.')}</footer>
    </div>
  );
}

// A feature told in three beats: the text column scrolls past a pinned mockup that changes with each beat.
function Scene({ id, tone, kicker, title, beats, mock, flip }: { id: string; tone: string; kicker: string; title: [string, string]; beats: [string, string][]; mock: ReactNode; flip?: boolean }) {
  return (
    <section id={id} className={`lp-scene lp-t-${tone}${flip ? ' lp-flip' : ''}`} data-scene={beats.length} data-beat="0">
      <div className="lp-pin">
        <div className="lp-copy">
          <span className="lp-kicker">{kicker}</span>
          <h2>{title[0]}<br /><em>{title[1]}</em></h2>
          <ol className="lp-beats">
            {beats.map(([h, p], i) => <li key={h} data-i={i}><b>{h}</b><p>{p}</p></li>)}
          </ol>
          <div className="lp-meter" aria-hidden="true"><i /></div>
        </div>
        <div className="lp-stage">{mock}</div>
      </div>
    </section>
  );
}

type T = (en: string, fr: string) => string;

function Window({ title, children }: { title: string; children: ReactNode }) {
  return <div className="lp-win"><div className="lp-win-bar"><i /><i /><i /><span>{title}</span></div><div className="lp-win-body">{children}</div></div>;
}

function MapMock({ t }: { t: T }) {
  return (
    <Window title="weather-app · Codetandem">
      <svg className="mk-map" viewBox="0 0 640 420" role="img" aria-label={t('A project map: the agent moves from file to file', 'Une carte du projet : l’agent va de fichier en fichier')}>
        <defs><pattern id="mk-dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.2" fill="#e2e2d8" /></pattern></defs>
        <rect width="640" height="420" fill="url(#mk-dots)" />
        <circle cx="240" cy="210" r="130" fill="#ecede3" /><text x="240" y="98" textAnchor="middle" className="mk-folder">src</text>
        <circle cx="480" cy="275" r="78" fill="#ecede3" /><text x="480" y="216" textAnchor="middle" className="mk-folder">tests</text>
        <path id="mk-route" className="mk-route" d="M175 165 C 220 150, 260 200, 285 245 S 420 320, 470 285 S 330 240, 285 245" />
        <g className="mk-files">
          <g className="mk-f f1"><circle cx="175" cy="165" r="15" /><text x="195" y="170">app.js</text></g>
          <g className="mk-f f2"><circle cx="285" cy="245" r="17" /><text x="307" y="250">greet.js</text></g>
          <g className="mk-f f0"><circle cx="210" cy="285" r="12" /><text x="160" y="318">format.js</text></g>
          <g className="mk-f f3"><circle cx="470" cy="285" r="15" /><text x="440" y="325">greet.test.js</text></g>
          <g className="mk-f f0"><circle cx="500" cy="110" r="12" /><text x="520" y="115">package.json</text></g>
          <g className="mk-hub"><circle cx="575" cy="200" r="16" /><text x="552" y="236">terminal</text></g>
        </g>
        <g className="mk-marker"><circle r="11" fill="#141414" /><circle r="5" fill="#c8f169" />
          <animateMotion dur="7s" repeatCount="indefinite"><mpath href="#mk-route" /></animateMotion></g>
      </svg>
      <div className="mk-caption"><span className="c1">{t('Reading app.js', 'Lit app.js')}</span><span className="c2">{t('Editing greet.js', 'Modifie greet.js')}</span><span className="c3">{t('Running npm test', 'Lance npm test')}</span></div>
      <div className="mk-rewind">
        <div className="mk-diff"><b>greet.js · {t('step 2', 'étape 2')}</b><code className="del">- return name;</code><code className="add">+ return `Hello, ${'${name}'}!`;</code><span>{t('Why: you asked for a greeting, not just the name.', 'Pourquoi : tu voulais une salutation, pas juste le nom.')}</span></div>
        <div className="mk-scrub"><i /><i /><i /><i /><i /><span className="mk-knob" /></div>
      </div>
      <div className="mk-ask">
        <div className="mk-q">{t('Why put greet() in its own file?', 'Pourquoi greet() dans son propre fichier ?')}</div>
        <div className="mk-a">{t('So index.js and the test can both import it. I split it at step 2, after you chose “one file per job”.', 'Pour que index.js et le test puissent l’importer. Je l’ai séparé à l’étape 2, quand tu as choisi « un fichier par rôle ».')}</div>
      </div>
    </Window>
  );
}

function LearnMock({ t }: { t: T }) {
  return (
    <Window title={t('Tandem · weather-app', 'Tandem · weather-app')}>
      <div className="mk-chat">
        <div className="mk-user">{t('Show the weather for my city', 'Affiche la météo de ma ville')}</div>
        <div className="mk-step done">✓ {t('Read 3 files', 'A lu 3 fichiers')}</div>
        <div className="mk-step done">✓ {t('Agreed: fetch in its own module', 'D’accord : le fetch dans son module')}</div>
        <div className="mk-step run"><span className="mk-spin" />{t('Writing weather.js', 'Écrit weather.js')}</div>
        <div className="mk-bar"><i /></div>
        <div className="mk-keeps">{t('The agent keeps working', 'L’agent continue de travailler')}</div>
      </div>
      <div className="mk-side">
        <div className="mk-side-head"><b>{t('Side question', 'Question à côté')}</b><kbd>⌘K</kbd></div>
        <div className="mk-q">{t('What does “await” do here?', 'Que fait « await » ici ?')}</div>
        <div className="mk-a">{t('It waits for the weather to arrive before showing it, without freezing the page.', 'Il attend que la météo arrive avant de l’afficher, sans bloquer la page.')}</div>
        <span className="mk-save">{t('Save to notes', 'Garder dans mes notes')}</span>
      </div>
      <div className="mk-notes">
        <div className="mk-notes-head"><b>{t('Notes · weather-app', 'Notes · weather-app')}</b><span>Markdown</span></div>
        <p><b>await</b><i style={{ width: '70%' }} /></p>
        <p><b>{t('module', 'module')}</b><i style={{ width: '55%' }} /></p>
        <p><b>{t('API key', 'clé d’API')}</b><i style={{ width: '62%' }} /></p>
      </div>
      <div className="mk-learned">
        <b>{t('What you learned', 'Ce que tu as appris')}</b>
        <div className="mk-chips"><span>async / await</span><span>{t('modules', 'modules')}</span><span>{t('error handling', 'gestion d’erreurs')}</span></div>
        <div className="mk-learned-row"><span className="mk-quiz">{t('Quiz me', 'Interroge-moi')}</span><span>{t('Try it yourself: show the temperature in °F too.', 'À toi : affiche aussi la température en °F.')}</span></div>
      </div>
    </Window>
  );
}

function GearMock({ t }: { t: T }) {
  const engines: [string, string, number][] = [
    ['Qwen3-Coder', t('open weights · your GPU, one click', 'poids ouverts · ton GPU, en un clic'), 0],
    ['Ollama', t('open weights · this computer', 'poids ouverts · cet ordinateur'), 0],
    ['NVIDIA', t('open weights · hosted', 'poids ouverts · hébergé'), 0],
    ['Claude', t('our agent loop', 'notre boucle d’agent'), 1],
    ['Claude Code', t('engine', 'moteur'), 1],
    ['Codex', t('coming soon', 'bientôt'), 2],
  ];
  const cog = (r: number, teeth: number) => { const c = (2 * Math.PI * r) / teeth / 2; return `${c} ${c}`; };
  return (
    <div className="mk-gears">
      <svg className="mk-cassette" viewBox="0 0 360 360" aria-hidden="true">
        <circle className="mk-chain" cx="180" cy="180" r="166" />
        <g className="mk-cogs">
          {[148, 118, 90, 64].map((r, i) => <circle key={r} className={`mk-cog g${i}`} cx="180" cy="180" r={r} strokeDasharray={cog(r, 34 - i * 6)} />)}
          <circle cx="180" cy="180" r="30" fill="#141414" /><circle cx="180" cy="180" r="9" fill="#fafaf7" />
        </g>
      </svg>
      <ul className="mk-engines">
        {engines.map(([n, d, g]) => <li key={n} data-g={g}><b>{n}</b><span>{d}</span></li>)}
      </ul>
    </div>
  );
}
