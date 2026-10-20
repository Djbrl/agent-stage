// The conversation. Text stays quiet: each burst of tool calls is ONE line ("Editing greet.js · 5 steps"),
// and the detail lives on the stage. What stays prominent: your messages, the agent's words, and anything that
// needs you (checkpoints).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVoice, voiceSupported } from './voice';
import { useDismiss } from './dismiss';
import type { State, Step, Entry } from './useAgent';
import { Icon } from './icons';
import { confirmAsk } from './Confirm';
import { stepText } from './StepsSheet';
import { Markdown } from './Markdown';
import { useApp } from './useSettings';
import { useHighlight } from './highlight';
import { engineOf, agentName, isReady, type Engine } from './api';
import type { HealthView } from './useHealth';
import { GpuPanel, type GpuView } from './useGpu';
import { Learned, QUIZ } from './Learned';
import { parseAsk, Sketches } from './AskWindow';
import { useT, useLang, tr, modeName, serverText } from './i18n';

function summarize(steps: Step[], fr: boolean) {
  const c = (n: string[]) => steps.filter((s) => n.includes(s.name) && s.ok !== false).length;
  const parts: string[] = [];
  const read = c(['read_file', 'list_files', 'search']), ran = c(['run_command']);
  const wrote = new Set(steps.filter((s) => (s.name === 'write_file' || s.name === 'edit_file') && s.ok !== false).map((s) => s.target)).size; // files, not edits
  const failed = steps.filter((s) => s.ok === false).length;
  const web = steps.filter((s) => s.name.startsWith('browser_')).length;
  const pl = (n: number) => (n > 1 ? 's' : '');
  if (fr) {
    if (wrote) parts.push(`${wrote} fichier${pl(wrote)} modifié${pl(wrote)}`);
    if (web) parts.push('navigateur utilisé');
    if (ran) parts.push(`${ran} commande${pl(ran)} lancée${pl(ran)}`);
    if (read && !parts.length) parts.push(`${read} élément${pl(read)} consulté${pl(read)}`);
    if (failed) parts.push(`${failed} étape${pl(failed)} en échec`);
  } else {
    if (wrote) parts.push(`changed ${wrote} file${pl(wrote)}`);
    if (web) parts.push('used the browser');
    if (ran) parts.push(`ran ${ran} command${pl(ran)}`);
    if (read && !parts.length) parts.push(`looked at ${read} thing${pl(read)}`);
    if (failed) parts.push(`${failed} step${pl(failed)} failed`);
  }
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}


export function AgentPanel({ visible = true, threadProvider, state, title, mode, onMode, onCheckpoint, problem, onRun, onAsk, onAskAbout, onStop, onSelect, onOpenSettings, side, replaying, header, centered, banner, engine, hasHistory, status, onUndo, onKeep, git, shared, health, serverDown, gpu, onSaveNote }: {
  state: State; title: string; problem: string | null; onOpenSettings: () => void;
  mode: 'build' | 'learn'; onMode: (m: 'build' | 'learn') => void; onCheckpoint: (id: string, choice: 'confirm' | 'discuss' | 'skip', text?: string) => void;
  onRun: (t: string) => void; onAsk: (t: string) => void; onStop: () => void; onSelect: (id: string) => void;
  side?: { onKeep: () => void; onClose: () => void; kept: boolean };
  onAskAbout?: (quote: string) => void; // the "?" on an agent message: a side question about that message
  replaying?: boolean; header?: ReactNode; centered?: boolean; banner?: ReactNode; engine?: Engine; hasHistory?: boolean; status?: ReactNode;
  threadProvider?: string; // the model this thread last ran on (shown when the selected model is another engine's)
  visible?: boolean; // the Chat tab can be hidden: scroll to the newest item when it shows again
  onUndo?: (ref: string) => void; onKeep?: (ref: string) => Promise<string | null>; git?: { repo: boolean; onInit: () => void } | null;
  shared?: { project: string; onPlay: () => void }; // a session someone shared: replay only, no composer
  onSaveNote?: (title: string, text: string) => Promise<boolean>; // a card or answer kept in Scratchpad's notes
  health?: HealthView | null; serverDown?: boolean; gpu?: { gpu: GpuView | null; start: () => void; stop: () => void }; // the ✦ shows the model's state
}) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  // The input grows with what you type; CSS caps it at part of the screen height, then it scrolls.
  const grow = () => { const el = box.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
  useLayoutEffect(grow);
  const end = useRef<HTMLDivElement>(null);
  const { settings } = useApp();
  const voice = useVoice((t) => setText((x) => (x.trim() ? `${x.trimEnd()} ${t}` : t)), settings?.learn?.language === 'fr' ? 'fr-FR' : 'en-US');
  useEffect(() => { if (visible) end.current?.scrollIntoView({ block: 'end' }); }, [state.timeline.length, state.steps.length, visible]);
  const byId = Object.fromEntries(state.steps.map((s) => [s.id, s]));
  // Stay pinned to the newest text while it types in, unless the reader has scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let pinned = true;
    const onScroll = () => { pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
    const ro = new ResizeObserver(() => { if (pinned) el.scrollTop = el.scrollHeight; });
    el.addEventListener('scroll', onScroll);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);
  const mounted = useRef(Date.now()); // messages older than this were already there: no typing animation for them
  const now = useNow(state.running);
  const lastEnd = state.steps.at(-1)?.endedAt;
  const typed = (e: { text: string; at: number }) => <Typed text={e.text} animate={e.at > mounted.current - 1500} />;
  const hl = useHighlight();
  const t = useT();
  const fr = useLang() === 'fr';
  const askMsg = (text: string) => onAskAbout && !side && !shared ? (
    <button className="ask-msg" onClick={() => onAskAbout(text)} title={t('Ask about this message', 'Poser une question sur ce message')} aria-label={t('Ask about this message', 'Poser une question sur ce message')}>?</button>
  ) : null;

  // Enter = run (idle) or steer (running). "Ask" opens a side thread that never touches files.
  // While a checkpoint waits for you, what you type is your reply to it (one input box, never two).
  const waiting = !side ? state.timeline.findLast((t) => t.kind === 'checkpoint' && !t.answer) as Extract<State['timeline'][number], { kind: 'checkpoint' }> | undefined : undefined;
  // The agent ended its turn on a question: the box is for the answer.
  const last = state.timeline.at(-1);
  const asked = mode === 'learn' && last?.kind === 'done' && last.text.slice(-600).includes('?');
  // After a finished Learn step (not mid-quiz, not while the tutor waits for an answer), offer a quiz on it.
  const submit = (kind: 'run' | 'ask' = 'run') => {
    voice.stop();
    if (!text.trim()) return;
    if (kind === 'run' && waiting) onCheckpoint(waiting.id, 'discuss', text.trim());
    else (kind === 'ask' ? onAsk : onRun)(text.trim());
    setText('');
  };

  return (
    <aside className={`agent-panel ${side ? 'side' : ''} ${centered ? 'centered' : ''} ${state.timeline.length ? '' : 'empty'}`}>
      <div className="panel-head">
        <span className="title thread-title" title={title}>{!title || title === 'New thread' ? t('New session', 'Nouvelle session') : title}</span>
        {side ? (
          <span className="side-actions">
            <span className="pill">{side.kept ? t('saved', 'gardée') : t('temporary', 'temporaire')}</span>
            {!side.kept && <button className="btn ghost sm" onClick={side.onKeep} title={t('Keep this conversation in your sessions', 'Garder cette conversation dans tes sessions')}>{t('Keep', 'Garder')}</button>}
            <button className="icon-btn" onClick={side.onClose} title={t('Close', 'Fermer')} aria-label={t('Close', 'Fermer')}><Icon name="x" size={13} /></button>
          </span>
        ) : (
          <>
            <span className="spacer" />
            {header}
          </>
        )}
      </div>

      <div className="timeline" ref={scroller}>
        <div className="timeline-inner">
          {state.timeline.length === 0 && (
            <div className="intro">
              {side ? null : mode === 'learn' ? <>
                <div className="intro-title">{t('What do you want to build?', 'Que veux-tu construire ?')}</div>
                <div className="muted">{t('You decide, the agent explains. It asks how you’d do it, explains the ideas, and only writes code once you say yes.', 'Tu décides, l’agent explique. Il te demande comment tu ferais, t’explique les idées, et n’écrit du code qu’après ton accord.')}</div>
              </> : <>
                <div className="intro-title">{t('What should we build?', 'Qu’est-ce qu’on construit ?')}</div>
                <div className="muted">{t('Describe a task. Once the agent starts, you’ll watch it move through your project on the map.', 'Décris une tâche. Dès que l’agent commence, tu le vois avancer dans ton projet sur la carte.')}</div>
              </>}
            </div>
          )}
          {state.timeline.map((e, i) => {
            if (e.kind === 'user') {
              const a = parseAsk(e.text); // a saved side question: show the quote and the question, not the raw prompt
              return a.quote || e.images?.length ? <div key={i} className="ask-you">{a.quote && <blockquote className="ask-quote">{a.quote}</blockquote>}<Sketches names={e.images} />{a.question && <div className="bubble-user">{a.question}</div>}</div>
                : <div key={i} className="bubble-user">{e.text === QUIZ ? t('Quiz me', 'Interroge-moi') : e.text}</div>;
            }
            if (e.kind === 'thought') return <div key={i} className="thought askable">{typed(e)}{askMsg(e.text)}</div>;
            if (e.kind === 'checkpoint') return <CheckpointCard key={i} entry={e} onAnswer={onCheckpoint} fr={fr} />;
            if (e.kind === 'learned_wait') return <div key={i} className="learned waiting"><div className="learned-head">{t('What you learned', 'Ce que tu as appris')}</div><div className="learned-chips2"><span className="ph" /><span className="ph" /><span className="ph" /></div><div className="muted learned-writing">{t('Writing it up…', 'En cours d’écriture…')}</div></div>;
            if (e.kind === 'learned') return <Learned key={i} entry={e} all={state.concepts} latest={!state.timeline.slice(i + 1).some((x) => x.kind === 'learned')} onQuiz={side || shared ? undefined : () => onAsk(QUIZ)} onSave={side || shared ? undefined : onSaveNote} />;
            if (e.kind === 'qa') return (
              <div key={i} className="qa">
                <div className="qa-q"><span className="qa-tag">{t('Why?', 'Pourquoi ?')}</span>{e.question}</div>
                <div className="qa-a">{e.answer ? <Markdown text={e.answer} /> : <span className="spin" />}</div>
              </div>
            );
            if (e.kind === 'done' || e.kind === 'error') {
              // Undo for any task that changed files, however it ended (done, stopped, out of steps).
              const canUndo = e.ref && onUndo && !side && state.changed[e.ref] !== 0;
              const undone = e.ref && state.undone.includes(e.ref);
              const later = state.timeline.slice(i + 1).some((x) => (x.kind === 'done' || x.kind === 'error') && x.ref && !state.undone.includes(x.ref) && state.changed[x.ref] !== 0);
              const kept = e.ref ? state.kept[e.ref] : undefined;
              const undoRow = canUndo && (
                <div className="undo-row">
                  {kept ? <span className="muted kept" title={kept.message}>{t('Version saved', 'Version gardée')} <span className="mono">{kept.commit}</span> · {kept.message.split('\n')[0]}</span>
                  : undone ? <span className="muted">{t('Undone', 'Annulé')}</span> : (<>
                    {onKeep && !later && <KeepButton disabled={state.running} onKeep={() => onKeep(e.ref!)} fr={fr} />}
                    <button className="btn ghost sm" disabled={state.running}
                      title={later ? t('Puts back the files this task and the later ones changed', 'Remet les fichiers changés par cette tâche et les suivantes') : t('Puts back the files this task changed', 'Remet les fichiers changés par cette tâche')}
                      onClick={() => confirmAsk(later ? { title: t('Undo this task and every task after it?', 'Annuler cette tâche et toutes les suivantes ?'), body: t('The files they changed go back to how they were before.', 'Les fichiers qu’elles ont changés reviennent comme avant.'), ok: t('Undo them', 'Les annuler') }
                        : { title: t('Undo this task?', 'Annuler cette tâche ?'), body: t('The files it changed go back to how they were before.', 'Les fichiers qu’elle a changés reviennent comme avant.'), ok: t('Undo it', 'L’annuler') }).then((yes) => yes && onUndo!(e.ref!))}>
                      <Icon name="undo" size={12} /> {t('Undo', 'Annuler')}
                    </button>
                  </>)}
                </div>
              );
              if (e.kind === 'error') { // a stop you asked for isn't a failure: neutral icon
                const stopped = /^Stopped/.test(e.text);
                return <div key={i} className={`final bad ${stopped ? 'stopped' : ''}`}><div><Icon name={stopped ? 'stop' : 'x'} size={stopped ? 10 : 12} /> {serverText(e.text, fr)}</div>{undoRow}</div>;
              }
              return <div key={i} className="final askable">{typed({ ...e, text: serverText(e.text, fr) })}{askMsg(e.text)}{undoRow}</div>;
            }
            if (e.kind === 'verify') return <VerifyLine key={i} e={e} fr={fr} />;
            if (e.kind === 'context') return (
              <details key={i} className="context-line">
                <summary>{e.action === 'compact' ? t('Chat summarized: the agent goes on from a short summary', 'Conversation résumée : l’agent continue à partir d’un court résumé') : t('Fresh start: the agent forgets the chat before this point', 'Nouveau départ : l’agent oublie la conversation avant ce point')}</summary>
                {e.summary && <Markdown text={e.summary} />}
              </details>
            );
            if (e.kind === 'model') return (
              <div key={i} className="sys-note"><span className="sys-line" />
                <span>{t(`Now using ${e.name}`, `Maintenant avec ${e.name}`)}<span className="muted"> · {e.carried ? t('it picks up the conversation so far', 'il reprend la conversation jusqu’ici') : t('it sees the whole conversation so far', 'il voit toute la conversation jusqu’ici')}</span></span>
                <span className="sys-line" /></div>
            );
            if (e.kind === 'restored') return (
              <div key={i} className="restored muted">
                {e.files.length ? `${t(`Put back ${e.files.length} file${e.files.length > 1 ? 's' : ''}:`, `${e.files.length} fichier${e.files.length > 1 ? 's' : ''} remis comme avant :`)} ${e.files.slice(0, 4).map((f) => f.path.split('/').pop()).join(', ')}${e.files.length > 4 ? '…' : ''}` : t('Nothing to put back: the files were already like that.', 'Rien à remettre : les fichiers étaient déjà comme ça.')}
              </div>
            );
            // A burst of tool calls: one quiet line. Live while working, a summary after. Click → steps on the stage.
            if (e.kind !== 'actions') return null;
            const steps = e.steps.map((id) => byId[id]).filter((s) => s && s.name !== 'checkpoint'); // the card says it already
            if (!steps.length) return null;
            const live = steps.some((s) => s.ok === undefined);
            const bad = steps.some((s) => s.ok === false);
            const lastStep = steps.at(-1);
            return (
              <button key={i} className={`work ${live ? 'live' : ''} ${bad ? 'bad' : ''}`} onClick={() => lastStep && onSelect(lastStep.id)} title={t('Show these steps', 'Voir ces étapes')}
                onMouseEnter={() => hl.set(steps.map((s) => s.target).filter((t) => !t.startsWith('$')))} onMouseLeave={() => hl.set(null)}>
                <span className="work-icon">{live ? <span className="spin" /> : bad ? <Icon name="x" size={11} /> : <Icon name="check" size={11} />}</span>
                <span className="work-text">{live && lastStep ? (state.approval && lastStep.name === 'run_command' ? t(`Waiting for your OK to run ${lastStep.args?.command ?? 'a command'}`, `Attend ton accord pour lancer ${lastStep.args?.command ?? 'une commande'}`) : stepText(lastStep, fr)) : summarize(steps, fr)}</span>
                {live && lastStep && !state.approval && <span className="work-time">{secs(now - lastStep.startedAt)}</span>}
                <span className="work-count">{steps.length} {t(steps.length > 1 ? 'steps' : 'step', steps.length > 1 ? 'étapes' : 'étape')}</span>
              </button>
            );
          })}
          {state.running && !replaying && !state.approval && !state.timeline.some((t) => t.kind === 'checkpoint' && !t.answer) && state.steps.at(-1)?.ok !== undefined && (
            <div className="work live ghost"><span className="work-icon"><span className="spin" /></span><span className="work-text">{t('Thinking', 'Réflexion')}</span><span className="work-time">{secs(now - (lastEnd ?? state.startedAt ?? now))}</span></div>
          )}
          <div ref={end} />
        </div>
      </div>

      {banner && !side && <div className="banner">{banner}</div>}
      {git && !git.repo && !side && !banner && (
        <div className="git-note">{t('This folder isn’t saved with Git, so you can’t undo the agent’s changes.', 'Ce dossier n’est pas suivi par Git : tu ne pourras pas annuler les changements de l’agent.')}
          <button className="btn ghost sm" onClick={git.onInit}>{t('Set up Git…', 'Configurer Git…')}</button></div>
      )}
      {problem && !side && <div className="problem"><span className="sdot bad" />{problem}</div>}
      {shared && !replaying ? (
        <div className="composer composer-box shared-note">
          <span>{t('A session shared from', 'Une session partagée depuis')} <b>{shared.project || t('another computer', 'un autre ordinateur')}</b>. {t('You can replay it, not run it.', 'Tu peux la revoir, pas la lancer.')}</span>
          <button className="btn primary sm" onClick={shared.onPlay}><Icon name="play" size={10} /> {t('Watch it', 'La regarder')}</button>
        </div>
      ) : replaying ? <div className="composer composer-box replay-note">{t('You’re watching a replay. Press', 'Tu regardes une rediffusion. Appuie sur')} <b>● {t('Live', 'En direct')}</b> {t('(or End) to get back.', '(ou Fin) pour revenir.')}</div> :
      <div className="composer">
        <div className="composer-box">
          {waiting && <div className="composer-reply">{t('Replying to', 'Réponse à')} <b>{waiting.cp.title || t('this step', 'cette étape')}</b></div>}
          <div className="composer-input">
            <textarea
              ref={box}
              value={voice.interim ? `${text}${text && !text.endsWith(' ') ? ' ' : ''}${voice.interim}` : text}
              readOnly={Boolean(voice.interim)}
              rows={centered ? 3 : 2}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder={side ? t('Ask a follow-up…', 'Pose une autre question…') : waiting ? t('Ask about this step, or say what to change…', 'Pose une question sur cette étape, ou dis ce qu’il faut changer…') : state.running ? t('Steer the agent…', 'Guide l’agent…')
                : asked ? t('Type your answer…', 'Écris ta réponse…') : mode === 'learn' ? t('What do you want to build?', 'Que veux-tu construire ?') : t('Describe a task…', 'Décris une tâche…')}
            />
            <div className="composer-send">
              {voiceSupported && (
                <button className={`icon-btn mic ${voice.listening ? 'on' : ''}`} onClick={voice.toggle} aria-label={voice.listening ? t('Stop listening', 'Arrêter l’écoute') : t('Speak your prompt', 'Dicte ta demande')} aria-pressed={voice.listening}
                  title={voice.error || (voice.listening ? t('Listening… click to stop', 'J’écoute… clique pour arrêter') : t('Speak your prompt', 'Dicte ta demande'))}><Icon name="mic" size={20} /></button>
              )}
              {state.running && !side
                ? <button className="btn round stop-btn" onClick={onStop} title={t('Stop', 'Arrêter')} aria-label={t('Stop the agent', 'Arrêter l’agent')}><span className="stop-sq" aria-hidden="true" /></button>
                : <button className="btn primary round send-btn" onClick={() => submit()} disabled={!text.trim()} title={state.running ? t('Steer', 'Guider') : t('Send', 'Envoyer')} aria-label={state.running ? t('Steer', 'Guider') : t('Send', 'Envoyer')}><Icon name="arrow" size={14} /></button>}
              {state.running && !side && text.trim() && <button className="btn primary round" onClick={() => submit()} title={t('Steer: the agent reads this before its next step', 'Guider : l’agent lit ceci avant sa prochaine étape')} aria-label={t('Steer', 'Guider')}><Icon name="arrow" size={14} /></button>}
            </div>
          </div>
        </div>
        <div className="composer-bar">
          {!side && (
            <div className="mode-icons" role="group" aria-label={t('Mode', 'Mode')}>
              {(['learn', 'build'] as const).map((m) => (
                <button key={m} className={`mode-icon ${m} ${mode === m ? 'on' : ''}`} disabled={state.running} onClick={() => onMode(m)} aria-pressed={mode === m} aria-label={modeName(m, fr)}
                  title={state.running ? t('You can switch once the agent is done', 'Tu pourras changer quand l’agent aura fini')
                    : m === 'learn' ? t('Tandem: you ride together. You decide, it explains, and it only writes code once you say yes.', 'Tandem : vous roulez ensemble. Tu décides, il explique, et il n’écrit du code qu’après ton accord.')
                    : t('Solo: the agent rides alone and does the work.', 'Solo : l’agent roule seul et fait le travail.')}>
                  {m === 'learn' ? 'Tandem' : 'Solo'}
                </button>
              ))}
            </div>
          )}
          {!side && !shared && <button className="scratch-btn" onClick={() => onAsk('')} title={t('Ask a side question or sketch an idea. The agent keeps working.', 'Pose une question à part ou dessine une idée. L’agent continue.')}>
            <Icon name="write" size={14} />{t('Scratchpad', 'Brouillon')}</button>}
          {status}
          {!side && <TokenMeter tokens={state.tokens} engine={engine} />}
          <span className="spacer" />
          <ModelPicker disabled={state.running} onOpenSettings={onOpenSettings} health={health ?? null} serverDown={Boolean(serverDown)} gpu={gpu} />
        </div>
      </div>}
    </aside>
  );
}

// A Tandem decision, laid out like the "What you learned" card: a sun-yellow card, the plan in a white bubble, the
// proposals as pills (tap one for its detail), then Go ahead or Explain. Skipping is still possible by typing it.
function CheckpointCard({ entry, onAnswer, fr }: { entry: Extract<State['timeline'][number], { kind: 'checkpoint' }>; onAnswer: (id: string, c: 'confirm' | 'discuss' | 'skip', t?: string) => void; fr: boolean }) {
  const { cp, answer } = entry;
  const impl = cp.kind === 'implementation';
  const t = tr(fr);
  const [shown, setShown] = useState<number | null>(null);
  const pick = shown !== null ? cp.additions?.[shown] : undefined;
  const explain = t('Explain this step before I decide: why this way, what the alternatives are, and what could go wrong.',
    'Explique cette étape avant que je décide : pourquoi comme ça, quelles sont les alternatives, et ce qui pourrait mal tourner.');
  return (
    <div className={`decision ${cp.kind} ${answer ? 'done' : ''}`}>
      <div className="decision-head">{t('Your call', 'À toi de décider')}</div>
      <div className="decision-title">{cp.title}</div>
      <div className="decision-body"><Markdown text={cp.summary} /></div>
      {cp.additions?.length ? (
        <div className="decision-pills">{cp.additions.map((a, i) => (
          <button key={i} className={shown === i ? 'on' : ''} aria-expanded={shown === i} onClick={() => setShown(shown === i ? null : i)}>{a.proposal}</button>
        ))}</div>
      ) : null}
      {pick && (pick.detail || pick.why) && <div className="decision-line">{pick.detail && <span className="mono">{pick.detail}</span>}{pick.why && <span>{pick.why}</span>}</div>}
      {cp.files?.length ? <div className="decision-files">{cp.files.map((f) => <span key={f}>{f}</span>)}</div> : null}
      {answer ? (
        <div className={`decision-answer ${answer.choice}`}>{answer.choice === 'confirm' ? (impl ? t('✓ You said go ahead', '✓ Tu as dit oui') : t('✓ You agreed with the plan', '✓ Tu as validé le plan'))
          : answer.choice === 'skip' ? t('You skipped this step', 'Tu as passé cette étape') : answer.text === explain ? t('You asked for an explanation', 'Tu as demandé une explication') : t(`You asked: “${answer.text ?? ''}”`, `Tu as demandé : « ${answer.text ?? ''} »`)}</div>
      ) : (
        <>
          <div className="decision-row">
            <button className="decision-go" onClick={() => onAnswer(entry.id, 'confirm')}>{impl ? t('Go ahead', 'Vas-y') : t('Sounds good', 'D’accord')}</button>
            <button className="decision-explain" onClick={() => onAnswer(entry.id, 'discuss', explain)}>{t('Explain', 'Explique')}</button>
          </div>
          <div className="decision-hint">{impl ? t('Nothing changes until you say go. ', 'Rien ne change avant ton feu vert. ') : ''}{t('Something else? Type it below.', 'Autre chose ? Écris-le en dessous.')}</div>
        </>
      )}
    </div>
  );
}

// Save this version: commit this task's files with a message the model writes. Shows progress and any error inline.
function KeepButton({ disabled, onKeep, fr }: { disabled: boolean; onKeep: () => Promise<string | null>; fr: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const t = tr(fr);
  return (
    <>
      <button className="btn ghost sm" disabled={disabled || busy} title={t('Save the files this task changed as a version in git, with a note written from the change', 'Enregistre les fichiers changés par cette tâche comme une version dans git, avec une note tirée du changement')}
        onClick={async () => { setBusy(true); setErr(''); const e = await onKeep(); setBusy(false); if (e) setErr(e); }}>
        {busy ? <span className="spin" /> : <Icon name="check" size={12} />} {busy ? t('Saving…', 'Enregistrement…') : t('Save this version', 'Garder cette version')}
      </button>
      {err && <span className="problem-inline">{serverText(err, fr)}</span>}
    </>
  );
}

// A clock that ticks once a second while the agent works (for elapsed times).
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}
const secs = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

// New agent text types itself in (about a second, however long it is); older text and reduced-motion users get it at once.
function Typed({ text, animate }: { text: string; animate: boolean }) {
  const still = !animate || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [n, setN] = useState(still ? text.length : 0);
  useEffect(() => {
    if (still) { setN(text.length); return; }
    let raf = 0;
    const step = Math.max(3, Math.ceil(text.length / 60));
    const tick = () => setN((x) => { const y = Math.min(text.length, x + step); if (y < text.length) raf = requestAnimationFrame(tick); return y; });
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  // The "What you learned" card says it better, so the tutor's own section of that name isn't shown twice.
  return <Markdown text={n >= text.length ? text : text.slice(0, n)} skip={['what-you-learned']} />;
}

// How big the conversation is now (what the model reads on each step) and what this session has used so far.
// Summarize / Start fresh live in the session's "⋯" menu.
function TokenMeter({ tokens, engine }: { tokens: State['tokens']; engine?: Engine }) {
  const t = useT();
  if (!tokens.total) return null;
  // Rough window size (Claude models read about 200k, open models usually 128k): past 60% it stays in view.
  const full = tokens.context / (engine === 'claude-code' ? 200_000 : 128_000) > 0.6;
  const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  const cost = tokens.cost ? ` (${t('about', 'environ')} $${tokens.cost.toFixed(2)})` : '';
  return (
    <span className={`token-meter ${full ? '' : 'quiet'}`}>
      <span className="tm-btn" title={t(`The model reads about ${tokens.context.toLocaleString()} tokens per step; ${tokens.total.toLocaleString()} used in this session${cost}.${full ? ' The chat is getting long: ⋯ → Summarize the chat so far.' : ''}`,
        `Le modèle lit environ ${tokens.context.toLocaleString('fr')} tokens par étape ; ${tokens.total.toLocaleString('fr')} utilisés dans cette session${cost}.${full ? ' La conversation devient longue : ⋯ → Résumer la conversation.' : ''}`)}>
        {k(tokens.context)}<span className="muted"> / {k(tokens.total)}</span>
      </span>
    </span>
  );
}

// The model chip: "engine · model". Grouped by engine; once a thread has history only its own engine's models
// are switchable (each engine keeps its own memory of the conversation).
// The ✦ is blue when the model is ready, grey when it can't answer right now (no key, server or GPU off).
// The tooltip says which model and why.
function ModelPicker({ disabled, onOpenSettings, health, serverDown, gpu }: { disabled: boolean; onOpenSettings: () => void;
  health: HealthView | null; serverDown: boolean; gpu?: { gpu: GpuView | null; start: () => void; stop: () => void } }) {
  const { settings, save, me } = useApp();
  const t = useT();
  const fr = useLang() === 'fr';
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), wrap);
  if (!settings) return null;
  // One usable model: nothing to pick here, so the ✦ opens Settings, where models are added.
  const few = settings.providers.filter((p) => p.id === settings.activeProvider || isReady(p)).length <= 1;
  // Any model that's set up can take over between tasks, even on the other engine (the session carries over).
  const active = settings.providers.find((p) => p.id === settings.activeProvider);
  const groups: Engine[] = ['native', 'claude-code'];
  const m = health?.model;
  const why = serverDown ? t('Tandemcode’s server isn’t answering', 'Le serveur de Tandemcode ne répond pas')
    : !active || !isReady(active) ? t('not set up yet', 'pas encore configuré')
    : !m || m.state === 'ok' || m.state === 'mock' || m.state === 'checking' ? ''
    : ({ auth: t('key refused', 'clé refusée'), missing: t('model not found', 'modèle introuvable'), unreachable: t('can’t reach it', 'injoignable') } as Record<string, string>)[m.state] ?? t('not answering', 'ne répond pas');
  const name = active ? (engineOf(active) === 'claude-code' && !active.name.startsWith('Claude Code') ? `Claude Code · ${active.name}` : active.name) : t('no model', 'aucun modèle');
  const g = gpu?.gpu?.managed ? gpu.gpu : null;
  return (
    <div className="picker" ref={wrap}>
      <button className={`spark-btn ${why ? 'off' : ''}`} disabled={disabled} onClick={() => (few ? onOpenSettings() : setOpen(!open))}
        aria-label={`${t('Model', 'Modèle')}: ${name}${why ? ` (${why})` : ''}`}
        title={`${name}${why ? ` · ${why}` : ` · ${t('ready', 'prêt')}`}${disabled ? `\n${t('You can switch models once the agent is done', 'Tu pourras changer de modèle quand l’agent aura fini')}` : ''}`}>
        <span className="sparkle" aria-hidden="true">✦</span>
      </button>
      {open && (
        <div className="picker-menu" onMouseLeave={() => setOpen(false)}>
          {groups.map((g) => {
            const list = settings.providers.filter((p) => engineOf(p) === g && (isReady(p) || p.id === settings.activeProvider));
            if (!list.length) return null;
            return (
              <div key={g} className="picker-group">
                <div className="picker-head">{agentName(g, fr)}</div>
                {list.map((p) => (
                  <button key={p.id} className={p.id === settings.activeProvider ? 'on' : ''} onClick={() => { save({ activeProvider: p.id }).catch(() => {}); setOpen(false); }}>
                    <span>{p.name.replace(/^Claude Code · /, '')}</span><span className="muted mono">{p.kind === 'mock' ? t('demo', 'démo') : p.model}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {g && gpu && <div className="picker-gpu"><GpuPanel gpu={g} start={gpu.start} stop={gpu.stop} /></div>}
          {!me?.public && <>
            <button className="manage" onClick={() => { setOpen(false); onOpenSettings(); }}>{t('Agents…', 'Agents…')}</button>
          </>}
        </div>
      )}
    </div>
  );
}


// agent-stage checking the agent's work before accepting "done".
function VerifyLine({ e, fr }: { e: Extract<Entry, { kind: 'verify' }>; fr: boolean }) {
  const [open, setOpen] = useState(false);
  const t = tr(fr);
  const cmd = e.command?.replace(/ --silent$/, '');
  const text = {
    running: t(`Checking the work: ${cmd}`, `Vérification du travail : ${cmd}`),
    pass: t(`Check passed: ${cmd}`, `Vérification réussie : ${cmd}`),
    fail: t(`Check failed: ${cmd}. Sent back to the agent`, `Vérification ratée : ${cmd}. Renvoyé à l’agent`),
    nudge: t('Asked the agent to test its work before finishing', 'On a demandé à l’agent de tester son travail avant de finir'),
    declined: t('Check skipped', 'Vérification passée'),
    unavailable: t(`Couldn’t check the work: the tool behind ${cmd} isn’t installed here`, `Impossible de vérifier : l’outil derrière ${cmd} n’est pas installé ici`),
  }[e.state];
  return (
    <div className={`verify ${e.state}`}>
      <button className={`work ${e.state === 'running' ? 'live' : ''} ${e.state === 'fail' ? 'bad' : ''}`} onClick={() => e.output && setOpen(!open)}
        title={e.output ? t('Show the output', 'Voir le résultat') : undefined}>
        <span className="work-icon">{e.state === 'running' ? <span className="spin" /> : e.state === 'pass' ? <Icon name="check" size={11} /> : e.state === 'fail' ? <Icon name="x" size={11} /> : <Icon name="shield" size={11} />}</span>
        <span className="work-text">{text}</span>
      </button>
      {open && e.output && <pre className={`output ${e.state === 'fail' ? 'bad' : ''}`}>{e.output}</pre>}
    </div>
  );
}
