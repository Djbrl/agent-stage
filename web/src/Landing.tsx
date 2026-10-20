// The landing page, shown on a first visit before anything else. Three features told as scroll scenes (the map,
// learning, engines), each with a drawn mockup that changes as you read, then a finish line and Try it live.
// The page itself is a route: an orange line draws down the side as you scroll, from a start circle to an end circle
// on the finish line, with a blue tip.
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
// The route down the side is laid out in real pixels (from the top of the story to the finish line), so the drawn
// line and its blue tip come from the same lookup table, and both glide toward the scroll position.
const ROUTE = 'M40 0 C 78 70, 2 170, 40 240 S 78 400, 40 480 S 2 640, 40 720 S 78 880, 40 1000'; // in a 80 × 1000 box
function useScroll(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const track = el.querySelector<HTMLElement>('.lp-track');
    const svg = el.querySelector<SVGSVGElement>('svg.lp-route');
    const paths = [...el.querySelectorAll<SVGPathElement>('.lp-route path')];
    const route = el.querySelector<SVGPathElement>('.lp-route-path');
    const rider = el.querySelector<HTMLElement>('.lp-rider');
    const finish = el.querySelector<HTMLElement>('.lp-checker');
    let H = 0, L = 0, table: { len: number; x: number; y: number }[] = [];
    const cps: { node: HTMLElement; f: number }[] = [];
    let cur = 0, goal = 0, raf = 0;

    const layout = () => {
      if (!track || !svg || !route) return;
      const tr = track.getBoundingClientRect();
      const fr = finish?.getBoundingClientRect();
      H = Math.max(200, fr ? fr.top + fr.height / 2 - tr.top : tr.height); // the route ends on the finish line
      svg.style.height = `${H}px`;
      svg.setAttribute('viewBox', `0 0 80 ${H}`);
      const d = ROUTE.replace(/(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/g, (_, x, y) => `${x} ${((Number(y) / 1000) * H).toFixed(1)}`);
      for (const p of paths) p.setAttribute('d', d);
      L = route.getTotalLength();
      table = Array.from({ length: 401 }, (_, i) => { const len = (L * i) / 400, pt = route.getPointAtLength(len); return { len, x: pt.x, y: pt.y }; });
      route.style.strokeDasharray = `${L} ${L}`;
      cps.length = 0;
      for (const c of el.querySelectorAll<HTMLElement>('.lp-cp')) {
        const id = c.dataset.for!, scene = el.querySelector<HTMLElement>(`#${id}`);
        const f = id === 'start' ? 0 : id === 'end' ? 1 : scene ? Math.min(1, (scene.getBoundingClientRect().top - tr.top) / H + 0.02) : -1;
        if (f < 0) continue;
        const p = at(f);
        c.style.transform = `translate(${p.x}px, ${p.y}px)`;
        cps.push({ node: c, f });
      }
    };
    // The route's point at a fraction of its height (the route only ever goes down, so y picks one point).
    const at = (f: number) => {
      const y = f * H;
      let lo = 0, hi = table.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (table[mid].y < y) lo = mid; else hi = mid; }
      const a = table[lo], b = table[hi], k = b && b.y > a.y ? (y - a.y) / (b.y - a.y) : 0;
      return b ? { len: a.len + (b.len - a.len) * k, x: a.x + (b.x - a.x) * k, y } : { len: 0, x: 40, y: 0 };
    };
    const drawRoute = () => {
      if (!route || !rider || !table.length) return;
      const p = at(cur);
      route.style.strokeDashoffset = `${L - p.len}`;
      rider.style.transform = `translate(${p.x}px, ${p.y}px)`;
      rider.classList.toggle('done', cur >= 0.999); // at the end circle: the circle takes over
      for (const c of cps) c.node.classList.toggle('on', cur >= c.f - 0.001);
    };

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
        const beat = String(Math.min(beats - 1, Math.floor(p * beats)));
        if (s.dataset.beat !== beat) { // a drawing that plays on this beat starts from the beginning
          s.dataset.beat = beat;
          for (const svg of s.querySelectorAll<SVGSVGElement>(`svg[data-replay="${beat}"]`)) svg.setCurrentTime(0);
        }
      }
      for (const n of el.querySelectorAll<HTMLElement>('[data-in]:not(.in)')) if (n.getBoundingClientRect().top < el.clientHeight * 0.8) n.classList.add('in');
      if (track && H) {
        const tr = track.getBoundingClientRect();
        goal = el.scrollTop >= max - 2 ? 1 : Math.min(1, Math.max(0, (el.clientHeight * 0.55 - tr.top) / H));
      }
      // Glide toward where you've scrolled: smooth even when the wheel jumps in steps.
      cur += (goal - cur) * 0.22;
      if (Math.abs(goal - cur) < 0.0004) cur = goal;
      drawRoute();
      if (cur !== goal) raf = requestAnimationFrame(tick);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const relayout = () => { layout(); on(); };
    layout(); cur = goal; tick();
    const settle = setTimeout(relayout, 600); // fonts and mockups settle the heights
    el.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', relayout);
    return () => { clearTimeout(settle); el.removeEventListener('scroll', on); window.removeEventListener('resize', relayout); cancelAnimationFrame(raf); };
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
            <button onClick={() => go('lp-learn')}>Tandem</button>
            <button onClick={() => go('lp-engines')}>{t('Engines', 'Moteurs')}</button>
            <span className="lp-lang" role="group" aria-label={t('Language', 'Langue')}>
              <button className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
              <button className={lang === 'fr' ? 'on' : ''} aria-pressed={lang === 'fr'} onClick={() => setLang('fr')}>FR</button>
            </span>
          </nav>
          <button className="lp-cta lp-sm" onClick={onStart}>{t('Try the demo', 'Essayer la démo')}</button>
        </div>
        <div className="lp-lane" aria-hidden="true" />
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
        <div className="lp-lights" aria-hidden="true"><i /><i /><i /></div>
        <p className="lp-eyebrow">{t('The harness you learn with', 'L’orchestrateur d’agents pour apprendre')}</p>
        <h1><span className="lp-from-l">{t('It pedals.', 'Il pédale.')}</span><span className="lp-from-r">{t('You steer.', 'Tu guides.')}</span></h1>
        <p className="lp-lede">{t('Follow your agents on a map. Use Tandem mode to stay active in decisions, take notes, and draw when words aren’t enough. Plug in Claude or any open model.',
          'Suis tes agents sur une carte. Avec le mode Tandem, garde la main sur les décisions, prends des notes, et dessine quand les mots ne suffisent pas. Branche Claude ou n’importe quel modèle ouvert.')}</p>
        <div className="lp-cta-row">
          <button className="lp-cta" onClick={onStart}>{t('Take a ride', 'Faire un tour')}</button>
          <button className="lp-ghost" onClick={() => go('lp-map')}>{t('See how it works', 'Voir comment ça marche')} ↓</button>
        </div>
        </div>
        <Fork t={t} />
      </section>

      <div className="lp-track">
        <svg className="lp-route" aria-hidden="true">
          <path className="lp-route-bg" />
          <path className="lp-route-path" />
        </svg>
        {['start', 'lp-map', 'lp-learn', 'lp-engines', 'end'].map((id) => <span key={id} className={`lp-cp ${id === 'start' || id === 'end' ? 'lp-cp-end' : ''}`} data-for={id} aria-hidden="true" />)}
        <span className="lp-rider" aria-hidden="true" />
      <div className="lp-story">

        <Scene id="lp-map" tone="blue" kicker={t('The map · a Rundown integration', 'La carte · une intégration Rundown')}
          title={[t('Every move.', 'Chaque geste.'), t('On the map.', 'Sur la carte.')]}
          beats={[
            [t('Follow your agents', 'Suis tes agents'), t('See your entire project as an interactive map that agents move through, and keep track of every change. Places they visit outside your computer are on the map too, so you never have to dig through your chat history again.', 'Vois tout ton projet comme une carte interactive que les agents parcourent, et garde la trace de chaque changement. Les endroits qu’ils visitent hors de ton ordinateur sont aussi sur la carte : plus besoin de fouiller l’historique du chat.')],
            [t('Rewind any step', 'Rembobine chaque étape'), t('Every step is recorded, whether it’s a read, a write, an output or a tool call.', 'Chaque étape est enregistrée, que ce soit une lecture, une écriture, un résultat ou un appel d’outil.')],
            [t('Ask them anything', 'Pose-leur tes questions'), t('Ask about any step or file, and get an answer grounded in your thread’s context.', 'Pose une question sur n’importe quelle étape ou fichier, et reçois une réponse fondée sur le contexte de ta session.')],
          ]}
          mock={<MapMock t={t} />} />

        <Scene id="lp-learn" tone="lime" kicker={t('Tandem mode', 'Mode Tandem')}
          title={[t('In tandem.', 'En tandem.'), t('You learn.', 'Tu apprends.')]}
          beats={[
            [t('Code in Tandem', 'Code en Tandem'), t('Agents shouldn’t make all your decisions. In Tandem mode, they ask for your input, explain their reasoning, and talk through edge cases. Solo mode is there when you just want the work done.', 'Les agents ne devraient pas prendre toutes les décisions à ta place. En mode Tandem, ils te demandent ton avis, expliquent leur raisonnement et parlent des cas limites. Le mode Solo est là quand tu veux juste que ce soit fait.')],
            [t('Keep a scratchpad', 'Garde un brouillon'), t('Use the scratchpad anywhere to ask questions without derailing your agents, and keep the answers you want to remember as notes. When words aren’t enough, sketch over a screenshot or a blank page.', 'Utilise le Brouillon n’importe où pour poser tes questions sans faire dérailler tes agents, et garde les réponses à retenir dans tes notes. Quand les mots ne suffisent pas, dessine sur une capture d’écran ou une page blanche.')],
            [t('What you learned', 'Ce que tu as appris'), t('Every Tandem task ends with the ideas it used, explained at your level, a quick quiz, and a practice exercise to try yourself. Save it to your notes in one click.', 'Chaque tâche en Tandem se termine par les notions utilisées, expliquées à ton niveau, un petit quiz, et un exercice à essayer toi-même. Garde-le dans tes notes en un clic.')],
          ]}
          mock={<LearnMock t={t} />} flip />

        <Scene id="lp-engines" tone="orange" kicker={t('Engines', 'Moteurs')}
          title={[t('Change your wheels.', 'Change de roues.'), t('Any time.', 'Quand tu veux.')]}
          beats={[
            [t('Open-weight models', 'Modèles à poids ouverts'), t('Install any open-weight model, whether it runs on your computer, on your own GPU with vLLM, or in the cloud.', 'Installe n’importe quel modèle à poids ouverts, qu’il tourne sur ton ordinateur, sur ton propre GPU avec vLLM, ou dans le cloud.')],
            [t('Claude, built in', 'Claude, intégré'), t('Want to stick with Claude? It’s available through the Claude Code SDK for agentic work, and through the API inside our own Codetandem agent. Switch models anytime: the context carries over.', 'Tu préfères rester sur Claude ? Il est disponible via le SDK de Claude Code pour le travail agentique, et via l’API dans notre propre agent Codetandem. Change de modèle quand tu veux : le contexte suit.')],
            [t('Codex, coming next', 'Codex, bientôt'), t('Codex is next on the list.', 'Codex est le prochain sur la liste.')],
          ]}
          mock={<GearMock t={t} />} />
      </div>

      <section className="lp-finish" data-in>
        <div className="lp-checker" aria-hidden="true" />
        <h2>{t('Ready to ride?', 'Prêt à rouler ?')}</h2>
        <p>{t('Open one of your projects, or start the guided demo. Open source, MIT, runs on your own computer.', 'Ouvre un de tes projets, ou lance la démo guidée. Open source, MIT, tourne sur ton ordinateur.')}</p>
        <div className="lp-cta-row">
          <button className="lp-cta lp-big" onClick={onStart}>{t('Try it live', 'Essayer en direct')}</button>
          <a className="lp-ghost" href="https://github.com/Djbrl/agent-stage" target="_blank" rel="noreferrer">{t('Source on GitHub', 'Code sur GitHub')}</a>
        </div>
      </section>
      </div>
      <footer className="lp-foot">{t('Built for the Open Source × AI Hackathon 2026.', 'Fait pour l’Open Source × AI Hackathon 2026.')}</footer>
    </div>
  );
}

// The hero picture: the agent (orange) rides up to a fork and waits; your cursor (blue) picks the way; it rides on.
const FORK_MAIN = 'M80 520 C 200 500, 260 420, 320 330 C 360 270, 400 200, 470 160';
const FORK_SIDE = 'M320 330 C 380 360, 460 400, 560 400';
function Fork({ t }: { t: T }) {
  return (
    <svg className="lp-fork" viewBox="0 0 620 580" role="img" aria-label={t('The agent rides to a fork; you pick the way', 'L’agent roule jusqu’à un carrefour ; tu choisis la route')}>
      <path className="road" d={FORK_MAIN} /><path className="road" d={FORK_SIDE} />
      <path className="lane" d={FORK_MAIN} /><path className="lane" d={FORK_SIDE} />
      <path className="taken" d={FORK_MAIN} />
      <g transform="translate(400 120)"><rect className="choice" x="0" y="-26" width="160" height="40" rx="20" strokeWidth="2" /><text className="sign choice-text" x="80" y="0" textAnchor="middle">localStorage</text></g>
      <g transform="translate(460 440)"><rect x="0" y="-26" width="160" height="40" rx="20" fill="#fff" stroke="#c5c5b8" strokeWidth="2" /><text className="sign" x="80" y="0" textAnchor="middle">{t('a database', 'une base de données')}</text></g>
      <g><circle r="14" fill="#141414" /><circle r="6" fill="#ff5a1f" />
        <animateMotion dur="6s" repeatCount="indefinite" keyPoints="0;0;0.55;0.55;1" keyTimes="0;0.1;0.3;0.38;0.85" calcMode="linear" path={FORK_MAIN} /></g>
      <g className="cursor"><path d="M0 0 L0 26 L7 19 L12 30 L17 28 L12 17 L22 17 Z" fill="#2f45e8" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /></g>
    </svg>
  );
}

// A feature told in three beats: the text column scrolls past a pinned mockup that changes with each beat.
function Scene({ id, tone, kicker, title, beats, mock, flip }: { id: string; tone: string; kicker: string; title: [string, string]; beats: [string, string][]; mock: ReactNode; flip?: boolean }) {
  return (
    <section id={id} className={`lp-scene lp-t-${tone}${flip ? ' lp-flip' : ''}`} data-scene={beats.length} data-beat="0">
      <div className="lp-pin">
        <div className="lp-copy">
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

// The map in three beats: the agent moving through the project, rewinding its steps (the marker runs back, the
// scrubber slides back, the step list counts down), then one step opened and a question asked about it.
function MapMock({ t }: { t: T }) {
  const steps = [t('Read app.js', 'Lit app.js'), t('Edit greet.js', 'Modifie greet.js'), t('Write greet.test.js', 'Écrit greet.test.js'), t('Run npm test', 'Lance npm test')];
  return (
    <Window title="weather-app · Codetandem">
      <svg className="mk-map" viewBox="0 0 640 420" role="img" aria-label={t('A project map: the agent moves from file to file', 'Une carte du projet : l’agent va de fichier en fichier')}>
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
        <g className="mk-marker fw"><circle r="11" fill="#141414" /><circle r="5" fill="#c8f169" />
          <animateMotion dur="7s" repeatCount="indefinite"><mpath href="#mk-route" /></animateMotion></g>
        <g className="mk-marker rw"><circle r="11" fill="#141414" /><circle r="5" fill="#ff5a1f" />
          <animateMotion dur="4s" repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1" calcMode="linear"><mpath href="#mk-route" /></animateMotion></g>
        <g className="mk-marker park" transform="translate(285 245)"><circle r="11" fill="#141414" /><circle r="5" fill="#c8f169" /></g>
      </svg>
      <div className="mk-caption"><span className="c1">{t('Reading app.js', 'Lit app.js')}</span><span className="c2">{t('Editing greet.js', 'Modifie greet.js')}</span><span className="c3">{t('Running npm test', 'Lance npm test')}</span></div>
      <div className="mk-rewind">
        <span className="mk-rw-badge">⏪ {t('Rewinding', 'Retour en arrière')}</span>
        <ol className="mk-steps">{steps.map((x, i) => <li key={x} className={`s${i}`}><b>{i + 1}</b>{x}</li>)}</ol>
        <div className="mk-scrub"><i /><i /><i /><i /><span className="mk-knob" /></div>
      </div>
      <div className="mk-ask">
        <div className="mk-open">
          <div className="mk-open-head"><b>2</b>{t('Edit greet.js', 'Modifie greet.js')}</div>
          <code className="del">- return name;</code><code className="add">+ return `Hello, ${'${name}'}!`;</code>
          <span>{t('Why: you asked for a greeting, not just the name.', 'Pourquoi : tu voulais une salutation, pas juste le nom.')}</span>
        </div>
        <div className="mk-q">{t('Why put greet() in its own file?', 'Pourquoi greet() dans son propre fichier ?')}</div>
        <div className="mk-a">{t('So index.js and the test can both import it. I split it at step 2, after you chose “one file per job”.', 'Pour que index.js et le test puissent l’importer. Je l’ai séparé à l’étape 2, quand tu as choisi « un fichier par rôle ».')}</div>
      </div>
    </Window>
  );
}

// Tandem mode, Scratchpad and What you learned, one per beat. Beat 0 is a real design decision; from beat 1 the
// chat dims so the eye goes to Scratchpad (a screenshot, then a pencil circling the button) and then the card.
function LearnMock({ t }: { t: T }) {
  return (
    <Window title={t('Tandem · weather-app', 'Tandem · weather-app')}>
      <div className="mk-chat">
        <div className="mk-user">{t('Save my favourite cities', 'Garde mes villes préférées')}</div>
        <div className="mk-step done">✓ {t('Read 3 files', 'A lu 3 fichiers')}</div>
        <div className="mk-call">
          <b>✦ {t('Your call: where do favourites live?', 'À toi de décider : où ranger les favoris ?')}</b>
          <ul>
            <li className="pick"><em>localStorage</em>{t('simple, only in this browser', 'simple, seulement dans ce navigateur')}</li>
            <li><em>{t('a small database', 'une petite base de données')}</em>{t('syncs across devices, more setup', 'synchronisée partout, plus de travail')}</li>
          </ul>
          <div><i className="go">{t('Go with localStorage', 'Va pour localStorage')}</i><i>{t('Explain', 'Explique')}</i></div>
        </div>
        <div className="mk-keeps">{t('Nothing changes until you say go', 'Rien ne change avant ton feu vert')}</div>
        <div className="mk-modes"><span className="on">Tandem</span><span>Solo</span><em>✎ {t('Scratchpad', 'Brouillon')}</em></div>
      </div>
      <div className="mk-dim" />
      <div className="mk-side mk-scratch">
        <svg viewBox="0 0 220 110" className="mk-shot" data-replay="1" aria-hidden="true">
          <rect width="220" height="110" rx="10" fill="#141414" />
          <rect x="14" y="14" width="120" height="10" rx="5" fill="#3a3a36" /><rect x="14" y="32" width="90" height="8" rx="4" fill="#2a2a28" />
          <rect x="14" y="62" width="70" height="26" rx="13" fill="#2f45e8" /><rect x="150" y="14" width="56" height="74" rx="8" fill="#2a2a28" />
          <path d="M95 75 A46 22 0 1 1 3 75 A46 22 0 1 1 95 75" fill="none" stroke="#ff5a1f" strokeWidth="4" strokeLinecap="round" strokeDasharray="232" strokeDashoffset="232">
            <animate attributeName="stroke-dashoffset" values="232;232;0;0" keyTimes="0;0.3;0.75;1" dur="3.4s" fill="freeze" />
          </path>
          <g className="mk-pencil" opacity="0">
            <path d="M0 0 L5 -2 L30 -27 L27 -30 L2 -5 Z" fill="#ffd23f" stroke="#141414" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M0 0 L5 -2 L2 -5 Z" fill="#141414" />
            <animateMotion dur="3.4s" keyPoints="0;0;1;1" keyTimes="0;0.3;0.75;1" calcMode="linear" fill="freeze" path="M95 75 A46 22 0 1 1 3 75 A46 22 0 1 1 95 75" />
            <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.27;0.3;0.8;0.9" dur="3.4s" fill="freeze" />
          </g>
        </svg>
        <div className="mk-q">{t('Can this button be bigger?', 'Ce bouton peut être plus grand ?')}</div>
        <div className="mk-a">{t('Yes: it’s the .cta class in style.css. Want me to add it to the plan?', 'Oui : c’est la classe .cta dans style.css. Je l’ajoute au plan ?')}</div>
        <div className="mk-sp-notes"><span>{t('Your notes', 'Tes notes')}</span><i>{t('Why localStorage?', 'Pourquoi localStorage ?')}</i><i>{t('What does “await” do?', 'Que fait « await » ?')}</i></div>
      </div>
      <div className="mk-learned">
        <b>{t('What you learned', 'Ce que tu as appris')}</b>
        <div className="mk-chips"><span>localStorage</span><span>JSON</span><span>{t('trade-offs', 'compromis')}</span></div>
        <div className="mk-learned-row"><span className="mk-quiz">{t('Quiz me', 'Interroge-moi')}</span><span>{t('Your turn: add a button to remove a city.', 'À toi : ajoute un bouton pour retirer une ville.')}</span></div>
        <span className="mk-saved">✓ {t('Saved to notes', 'Gardé dans tes notes')}</span>
      </div>
    </Window>
  );
}

// Engines as wheels: one spinning wheel that changes with the beat. Spoked for open-weight models, deep aero rims
// for Claude, a closed disc for Codex (coming soon). The list on the right lights up the matching engines.
function GearMock({ t }: { t: T }) {
  const engines: [string, string, number][] = [
    ['Ollama', t('open weights · this computer', 'poids ouverts · cet ordinateur'), 0],
    ['vLLM', t('open weights · your own GPU', 'poids ouverts · ton propre GPU'), 0],
    ['NVIDIA', t('open weights · hosted', 'poids ouverts · hébergé'), 0],
    ['Claude', t('in Codetandem’s agent', 'dans l’agent de Codetandem'), 1],
    ['Claude Code', t('Anthropic’s agent', 'l’agent d’Anthropic'), 1],
    ['Codex', t('coming soon', 'bientôt'), 2],
  ];
  const spokes = (n: number, r0: number, r1: number) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, b = a + (i % 2 ? 0.08 : -0.08);
    return <line key={i} x1={180 + r0 * Math.cos(b)} y1={180 + r0 * Math.sin(b)} x2={180 + r1 * Math.cos(a)} y2={180 + r1 * Math.sin(a)} />;
  });
  return (
    <div className="mk-gears">
      <svg className="mk-wheel" viewBox="0 0 360 360" aria-hidden="true">
        <g className="mk-spin">
          <g className="w w0">{/* spoked: a light road wheel */}
            <circle cx="180" cy="180" r="160" className="tyre" /><circle cx="180" cy="180" r="146" className="rim" />
            <g className="spokes">{spokes(28, 16, 146)}</g>
          </g>
          <g className="w w1">{/* aero: deep rim, few bladed spokes */}
            <circle cx="180" cy="180" r="160" className="tyre" /><circle cx="180" cy="180" r="132" className="rim deep" />
            <g className="blades">{spokes(12, 18, 118)}</g>
          </g>
          <g className="w w2">{/* disc: closed, for later */}
            <circle cx="180" cy="180" r="160" className="tyre" /><circle cx="180" cy="180" r="146" className="disc" />
            <circle cx="180" cy="180" r="110" className="disc-ring" />
          </g>
          <circle cx="180" cy="180" r="22" fill="#141414" /><circle cx="180" cy="180" r="7" fill="#fafaf7" />
        </g>
      </svg>
      <ul className="mk-engines">
        {engines.map(([n, d, g]) => <li key={n} data-g={g}><b>{n}</b><span>{d}</span></li>)}
      </ul>
    </div>
  );
}
