// The landing page, shown on a first visit before anything else. A scroll story in the spirit of a sports product
// page: a sticky bar with the call to action, then one chapter per feature with a real shot of the app.
// "Try it" opens the first-launch tutorial in Welcome.tsx.
import { useEffect, useRef, type ReactNode } from 'react';
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

// Fades a block in the first time it scrolls into view (always visible without motion or observers).
function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.classList.add('lp-hide');
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.remove('lp-hide'); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`lp-reveal ${className}`}>{children}</div>;
}

const Shot = ({ src, alt, tone }: { src: string; alt: string; tone: string }) => (
  <div className={`lp-shot lp-${tone}`}><img src={src} alt={alt} loading="lazy" /></div>
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
  const lang = learn?.language ?? 'en';
  const setLang = (l: 'en' | 'fr') => { if (learn && l !== lang) void save({ learn: { ...learn, language: l } }); };
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  const ticker = [t('Guide me', 'Guide-moi'), t('Live project map', 'Carte du projet en direct'), t('Done means tested', 'Fini veut dire testé'), t('Undo anything', 'Tout s’annule'),
    t('Ask from anywhere', 'Une question, partout'), t('Quiz me', 'Interroge-moi'), t('Lesson notes', 'Fiches de cours'), t('Open models', 'Modèles ouverts'), 'Français · English'];

  return (
    <div className="lp">
      <header className="lp-bar">
        <div className="lp-bar-in">
          <span className="lp-brand"><Bike w={40} /> <b>codetandem</b></span>
          <nav className="lp-links" aria-label={t('Sections', 'Sections')}>
            <button onClick={() => go('lp-features')}>{t('Features', 'Fonctions')}</button>
            <button onClick={() => go('lp-engines')}>{t('Models', 'Modèles')}</button>
            <button onClick={() => go('lp-open')}>{t('Open source', 'Open source')}</button>
            <span className="lp-lang" role="group" aria-label={t('Language', 'Langue')}>
              <button className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
              <button className={lang === 'fr' ? 'on' : ''} aria-pressed={lang === 'fr'} onClick={() => setLang('fr')}>FR</button>
            </span>
          </nav>
          <button className="lp-pill lp-go lp-sm" onClick={onStart}>{t('Try it live', 'Essayer en direct')}</button>
        </div>
      </header>

      <section className="lp-hero">
        <p className="lp-eyebrow">{t('The coding agent for learners', 'L’agent de code pour apprendre')}</p>
        <h1>{t('You steer.', 'Tu guides.')}<br />{t('It pedals.', 'Il pédale.')}</h1>
        <p className="lp-lede">{t('AI can write your code. Codetandem makes sure you understand it. Ride along on every change, decide before it writes, and finish each task knowing more than when you started.',
          'L’IA sait écrire ton code. Codetandem s’assure que tu le comprends. Suis chaque changement, décide avant qu’il écrive, et termine chaque tâche en sachant plus qu’au départ.')}</p>
        <div className="lp-cta">
          <button className="lp-pill lp-go" onClick={onStart}>{t('Try it live', 'Essayer en direct')}</button>
          <button className="lp-pill lp-ghost" onClick={() => go('lp-features')}>{t('See what it does', 'Voir ce qu’il fait')}</button>
        </div>
        <Reveal className="lp-hero-shot">
          <Shot tone="lime" src="/landing/ask.png" alt={t('Codetandem in Guide me: the agent asks how you would build it, next to a map of the project', 'Codetandem en mode Guide-moi : l’agent te demande comment tu ferais, à côté de la carte du projet')} />
        </Reveal>
      </section>

      <div className="lp-ticker" aria-hidden="true">
        <div className="lp-ticker-in">{[...ticker, ...ticker].map((x, i) => <span key={i}>{x}<i /></span>)}</div>
      </div>

      <section className="lp-problem">
        <Reveal>
          <h2>{t('AI writes more of our code every day.', 'L’IA écrit chaque jour plus de notre code.')}<br /><em>{t('We learn less from it every day.', 'Et on en apprend chaque jour moins.')}</em></h2>
          <p>{t('Most coding agents are built to make you faster. Codetandem is built to make you better: it works in your real project, with your real files, and keeps you in the front seat the whole ride.',
            'La plupart des agents de code sont faits pour aller plus vite. Codetandem est fait pour te faire progresser : il travaille dans ton vrai projet, sur tes vrais fichiers, et te garde à l’avant pendant toute la sortie.')}</p>
        </Reveal>
      </section>

      <div id="lp-features">
        <Chapter tone="orange" kicker={t('Guide me', 'Guide-moi')} title={[t('It asks first.', 'Il demande d’abord.'), t('You decide.', 'Tu décides.')]}
          body={t('Before any code, it asks how you would do it, and pushes back when your plan has a real flaw. Then it shows you a checkpoint: what it will change, in which files, and what it is adding beyond your idea. Nothing is written until you say yes.',
            'Avant tout code, il te demande comment tu ferais, et te contredit quand ton plan a un vrai défaut. Puis il te montre un point d’étape : ce qu’il va changer, dans quels fichiers, et ce qu’il ajoute à ton idée. Rien n’est écrit avant ton oui.')}
          points={[t('Design and code checkpoints', 'Points d’étape de conception et de code'), t('Files stay locked until your yes', 'Fichiers verrouillés jusqu’à ton oui'), t('In a hurry? Switch to Just build it', 'Pressé ? Passe en Fais-le')]}
          shot={<Shot tone="orange" src="/landing/decide.png" alt={t('A code checkpoint waiting for the learner’s yes', 'Un point d’étape de code qui attend le oui de l’apprenant')} />} />

        <Chapter tone="blue" kicker={t('Live project map', 'Carte du projet en direct')} title={[t('Watch every move.', 'Vois chaque mouvement.'), t('On a map.', 'Sur une carte.')]}
          body={t('Your project is drawn as a map of folders and files. The agent’s marker moves to each file it reads or edits, the camera follows, and changed files light up. You never wonder what it touched.',
            'Ton projet est dessiné comme une carte de dossiers et de fichiers. Le marqueur de l’agent va sur chaque fichier qu’il lit ou modifie, la caméra suit, et les fichiers changés s’allument. Tu sais toujours ce qu’il a touché.')}
          points={[t('Reads and edits, in color', 'Lectures et modifications, en couleur'), t('Its terminal and browser, on the map too', 'Son terminal et son navigateur, aussi sur la carte'), t('Commands wait for your approval', 'Les commandes attendent ton accord')]}
          shot={<Shot tone="blue" src="/landing/steps.png" alt={t('The project map with the files the agent changed lit in orange', 'La carte du projet, les fichiers changés par l’agent en orange')} />} flip />

        <Chapter tone="sun" kicker={t('Steps', 'Étapes')} title={[t('Rewind any step.', 'Rejoue chaque étape.'), t('See why.', 'Comprends pourquoi.')]}
          body={t('Every step is kept: the file it opened, the exact change, the command and its output. Ask why on any of them, or select any text and press ⌘K to ask a side question without stopping the agent.',
            'Chaque étape est gardée : le fichier ouvert, le changement exact, la commande et son résultat. Demande pourquoi sur n’importe laquelle, ou sélectionne un texte et appuie sur ⌘K pour poser une question à côté, sans arrêter l’agent.')}
          points={[t('Diffs in plain sight', 'Les changements, ligne par ligne'), t('Ask why, on any step', 'Pourquoi ?, sur chaque étape'), t('Ask from anywhere with ⌘K', 'Une question, partout, avec ⌘K')]}
          shot={<Shot tone="sun" src="/landing/diff.png" alt={t('A step opened, with the change and an explanation', 'Une étape ouverte, avec le changement et son explication')} />} />

        <Chapter tone="lime" kicker={t('What you learned', 'Ce que tu as appris')} title={[t('Finish every ride', 'Termine chaque sortie'), t('a little stronger.', 'un peu plus fort.')]}
          body={t('Each task ends with the ideas it used, explained for your level, and one small exercise to try on your own. Quiz yourself on a session, keep a study sheet of it, and watch your concepts add up.',
            'Chaque tâche se termine par les notions utilisées, expliquées à ton niveau, et un petit exercice à faire seul. Interroge-toi sur une session, garde-en une fiche de cours, et regarde tes notions s’accumuler.')}
          points={[t('Try it yourself exercises', 'Exercices « À toi de jouer »'), t('Quiz me', 'Interroge-moi'), t('Lesson notes in Markdown', 'Fiches de cours en Markdown')]}
          shot={<Shot tone="lime" src="/landing/learned.png" alt={t('What you learned: the ideas from the task and an exercise', 'Ce que tu as appris : les notions de la tâche et un exercice')} />} flip />
      </div>

      <section className="lp-duo">
        <Reveal className="lp-tile lp-ink">
          <span className="lp-kicker">{t('Done-check', 'Vérification')}</span>
          <h3>{t('Done means tested.', 'Fini veut dire testé.')}</h3>
          <p>{t('When the agent says it’s done, Codetandem runs your project’s tests, typecheck or build. If they fail, it goes back to fix them, up to three times, and you see every try.',
            'Quand l’agent dit qu’il a fini, Codetandem lance les tests, la vérification de types ou le build du projet. S’ils échouent, il retourne corriger, jusqu’à trois fois, et tu vois chaque essai.')}</p>
          <div className="lp-checks"><span className="bad">✕ npm test</span><span>→</span><span className="ok">✓ npm test</span></div>
        </Reveal>
        <Reveal className="lp-tile lp-chalk">
          <span className="lp-kicker">{t('Checkpoints', 'Sauvegardes')}</span>
          <h3>{t('Undo anything.', 'Tout s’annule.')}</h3>
          <p>{t('A checkpoint is saved before every task, without touching your branch. One click puts the files back. Happy with it? Keep writes the commit message for you.',
            'Une sauvegarde est faite avant chaque tâche, sans toucher à ta branche. Un clic remet les fichiers. Content ? Garder écrit le message de commit pour toi.')}</p>
          <div className="lp-btns"><span className="lp-fake">{t('Keep', 'Garder')}</span><span className="lp-fake ghost">{t('Undo', 'Annuler')}</span></div>
        </Reveal>
      </section>

      <section className="lp-grid">
        <Reveal><h2 className="lp-center">{t('Everything a training partner should do.', 'Tout ce qu’un partenaire d’entraînement doit faire.')}</h2></Reveal>
        <div className="lp-tiles">
          {[
            ['orange', t('Uses a real browser', 'Utilise un vrai navigateur'), t('It opens your local site, clicks through it and shows you a screenshot of each action.', 'Il ouvre ton site local, clique dedans et te montre une capture de chaque action.')],
            ['blue', t('Talk to it', 'Parle-lui'), t('Describe a task out loud. Voice input is built in.', 'Décris une tâche à voix haute. La saisie vocale est intégrée.')],
            ['sun', t('Share a session', 'Partage une session'), t('Export a session and anyone can replay it, step by step, read-only.', 'Exporte une session et n’importe qui peut la rejouer, étape par étape, en lecture seule.')],
            ['lime', t('Adapts to you', 'S’adapte à toi'), t('Your level, how you already code with AI, and your language shape every explanation.', 'Ton niveau, ta pratique de l’IA et ta langue façonnent chaque explication.')],
            ['chalk', t('Knows its cost', 'Connaît son coût'), t('A token meter, one click to compact the context, and an estimate of what you spent.', 'Un compteur de jetons, un clic pour compacter le contexte, et une estimation de ce que tu as dépensé.')],
            ['ink', t('Français et English', 'Français et English'), t('The whole interface, and the tutor, in French or English.', 'Toute l’interface, et le tuteur, en français ou en anglais.')],
          ].map(([tone, h, p]) => (
            <Reveal key={h} className={`lp-mini lp-${tone}`}><h3>{h}</h3><p>{p}</p></Reveal>
          ))}
        </div>
      </section>

      <section className="lp-adapt">
        <Reveal className="lp-adapt-copy">
          <span className="lp-kicker">{t('Your coach', 'Ton coach')}</span>
          <h2>{t('Starts where you are.', 'Part de là où tu en es.')}</h2>
          <p>{t('Three questions on the first launch: have you coded with AI, how much do you code, which language. A first-timer gets every move explained. Someone who already uses agents learns to review and steer one.',
            'Trois questions au premier lancement : as-tu codé avec l’IA, à quel point tu codes, dans quelle langue. Un débutant a chaque geste expliqué. Quelqu’un qui utilise déjà des agents apprend à en relire et en piloter un.')}</p>
        </Reveal>
        <Reveal className="lp-adapt-shot"><Shot tone="chalk" src="/landing/tutorial.png" alt={t('The first-launch questions', 'Les questions du premier lancement')} /></Reveal>
      </section>

      <section className="lp-stats">
        <Reveal className="lp-stats-in">
          <div><b>0</b><span>{t('lines written before your yes', 'ligne écrite avant ton oui')}</span></div>
          <div><b>1</b><span>{t('click to undo a whole task', 'clic pour annuler une tâche')}</span></div>
          <div><b>3</b><span>{t('tries to make your tests pass', 'essais pour faire passer tes tests')}</span></div>
          <div><b>2</b><span>{t('languages, French and English', 'langues, français et anglais')}</span></div>
        </Reveal>
      </section>

      <section id="lp-engines" className="lp-engines">
        <Reveal>
          <span className="lp-kicker">{t('Engines', 'Moteurs')}</span>
          <h2>{t('Your engine. Your choice.', 'Ton moteur. Ton choix.')}</h2>
          <p>{t('Run open models on your own machine or GPU, or plug in Claude. Codetandem has its own agent loop, and can also drive Claude Code.',
            'Fais tourner des modèles ouverts sur ta machine ou ton GPU, ou branche Claude. Codetandem a sa propre boucle d’agent, et sait aussi piloter Claude Code.')}</p>
          <div className="lp-chips">
            <span>{t('Qwen3-Coder on your own GPU, in one click', 'Qwen3-Coder sur ton GPU, en un clic')}</span><span>Ollama</span><span>NVIDIA API</span><span>Claude</span><span>{t('Claude Code engine', 'Moteur Claude Code')}</span>
          </div>
        </Reveal>
      </section>

      <section id="lp-open" className="lp-open">
        <Reveal className="lp-open-in">
          <div>
            <h2>{t('Open source. MIT.', 'Open source. MIT.')}</h2>
            <p>{t('Read every line, run it on your laptop, make it yours. Tests and CI included, and good first issues waiting.', 'Lis chaque ligne, lance-le sur ton ordinateur, fais-le tien. Tests et CI inclus, et des premières issues qui t’attendent.')}</p>
          </div>
          <code>git clone https://github.com/Djbrl/agent-stage</code>
        </Reveal>
      </section>

      <section className="lp-final">
        <Reveal>
          <Bike w={120} />
          <h2>{t('Ready to ride?', 'Prêt à rouler ?')}</h2>
          <p>{t('Open one of your projects, or start the guided demo. It takes a minute.', 'Ouvre un de tes projets, ou lance la démo guidée. Ça prend une minute.')}</p>
          <button className="lp-pill lp-go lp-big" onClick={onStart}>{t('Try it live', 'Essayer en direct')}</button>
        </Reveal>
      </section>

      <footer className="lp-foot">
        <span>{t('Built for the Open Source × AI Hackathon 2026.', 'Fait pour l’Open Source × AI Hackathon 2026.')}</span>
        <a href="https://github.com/Djbrl/agent-stage" target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  );
}

function Chapter({ tone, kicker, title, body, points, shot, flip }: { tone: string; kicker: string; title: [string, string]; body: string; points: string[]; shot: ReactNode; flip?: boolean }) {
  return (
    <section className={`lp-chapter${flip ? ' lp-flip' : ''}`}>
      <Reveal className="lp-chapter-copy">
        <span className={`lp-kicker lp-k-${tone}`}>{kicker}</span>
        <h2>{title[0]}<br /><em>{title[1]}</em></h2>
        <p>{body}</p>
        <ul>{points.map((p) => <li key={p}>{p}</li>)}</ul>
      </Reveal>
      <Reveal className="lp-chapter-shot">{shot}</Reveal>
    </section>
  );
}
