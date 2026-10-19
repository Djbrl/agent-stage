// Settings: models (with keys + connection test), learning, appearance, usage & spend, safety, about.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, send, fmtTokens, engineOf, recipeOf, isReady, type Provider, type Recipe, type Settings } from './api';
import { useApp } from './useSettings';
import { Icon, type IconName } from './icons';
import { useTheme, type ThemePref } from './theme';
import { useDismiss } from './dismiss';
import { useT, useLang } from './i18n';

type Tab = 'models' | 'learning' | 'appearance' | 'usage' | 'safety' | 'about';

// The bottom bar of the window: a page puts its Save changes there while it has unsaved edits.
const FootCtx = createContext<(n: ReactNode) => void>(() => {});

const TABS: { k: Tab; icon: IconName }[] = [
  { k: 'models', icon: 'cpu' }, { k: 'learning', icon: 'book' }, { k: 'safety', icon: 'shield' },
  { k: 'appearance', icon: 'sun' }, { k: 'usage', icon: 'chart' }, { k: 'about', icon: 'info' },
];

export function SettingsModal({ onClose, initialTab = 'models' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [foot, setFoot] = useState<ReactNode>(null);
  const t = useT();
  useDismiss(true, onClose);
  const names: Record<Tab, string> = { models: t('Agents', 'Agents'), learning: t('Learning', 'Apprentissage'), appearance: t('Appearance', 'Apparence'), usage: t('Usage', 'Utilisation'), safety: t('Safety', 'Sécurité'), about: t('About', 'À propos') };
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal wide settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="icon-btn settings-close" onClick={onClose} aria-label={t('Close', 'Fermer')}><Icon name="x" size={14} /></button>
        <div className="settings">
          <nav className="settings-nav">
            <div className="settings-nav-title">{t('Settings', 'Réglages')}</div>
            {TABS.map(({ k, icon }) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon name={icon} size={15} />{names[k]}</button>
            ))}
          </nav>
          <div className="settings-main">
          <div className="settings-body">
            <FootCtx.Provider value={setFoot}>
            <h2 className="set-title">{names[tab]}</h2>
            {tab === 'models' && <Models />}
            {tab === 'learning' && <Learning />}
            {tab === 'appearance' && <Appearance />}
            {tab === 'usage' && <Usage />}
            {tab === 'safety' && <Safety />}
            {tab === 'about' && <About />}
            </FootCtx.Provider>
          </div>
          {foot && <div className="settings-foot">{foot}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Agents: one list (the built-ins, then what you added). An agent that isn't set up opens its setup; adding one is a setup too.
function Models() {
  const { settings, save } = useApp();
  const t = useT();
  const [sel, setSel] = useState<string | 'add'>(settings?.activeProvider ?? 'mock');
  const [finished, setFinished] = useState<string | null>(null); // a setup that just finished keeps showing its "ready" screen
  if (!settings) return null;
  const selected = sel === 'add' ? null : settings.providers.find((p) => p.id === sel) ?? null;
  const builtins = settings.providers.filter((p) => p.builtin);
  const added = settings.providers.filter((p) => !p.builtin);
  const row = (p: Provider) => (
    <button key={p.id} className={`model-row ${p.id === sel ? 'on' : ''}`} onClick={() => { setFinished(null); setSel(p.id); }}>
      <Icon name={RECIPE_ICON[recipeOf(p)]} size={15} />
      <span className="grow"><span>{p.name}</span><span className="model-sub">{isReady(p) ? (p.kind === 'mock' ? t('No model, no cost', 'Pas de modèle, pas de coût') : p.model) : t('Not set up', 'Pas configuré')}</span></span>
      {p.id === settings.activeProvider && <span className="pill on">{t('in use', 'utilisé')}</span>}
    </button>
  );
  return (
    <>
      <p className="set-intro">{t('The agent that does the work. Set one up once, then switch any time from the ✦ under the chat box.', 'L’agent qui fait le travail. Configure-le une fois, puis change quand tu veux avec le ✦ sous la zone de texte.')}</p>
      <div className="models">
        <div className="model-list">
          <h3 className="set-section-title">{t('Available agents', 'Agents disponibles')}</h3>
          {builtins.map(row)}
          {added.length > 0 && <h3 className="set-section-title sub">{t('Added by you', 'Ajoutés par toi')}</h3>}
          {added.map(row)}
          <button className={`model-row add-row ${sel === 'add' ? 'on' : ''}`} onClick={() => setSel('add')}><Icon name="plus" size={15} /><span className="grow"><span>{t('Add an agent', 'Ajouter un agent')}</span></span></button>
        </div>
        <div className="model-form">
          {sel === 'add' ? <Setup key="add" onFinish={setFinished} onDone={(id) => { setFinished(null); setSel(id); }} />
            : selected && (!isReady(selected) || finished === selected.id) ? <Setup key={selected.id} base={selected} onFinish={setFinished} onDone={(id) => { setFinished(null); setSel(id); }} />
            : selected ? <AgentDetails key={selected.id} p={selected} onRemoved={() => setSel(settings.activeProvider)} /> : null}
        </div>
      </div>
    </>
  );
}

const RECIPE_ICON: Record<Recipe, IconName> = { demo: 'spark', claude: 'list', 'claude-code': 'terminal', nvidia: 'globe', gpu: 'cpu', ollama: 'folder', openai: 'globe' };
const CLAUDE_MODELS: [string, string][] = [['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5']];
const OLLAMA_PICKS = ['qwen3-coder:30b', 'gpt-oss:20b', 'devstral', 'qwen2.5-coder:7b'];

function engineLine(p: Provider, t: ReturnType<typeof useT>) {
  return engineOf(p) === 'claude-code' ? t('Runs inside Claude Code, Anthropic’s own agent. Sessions stay on it.', 'Tourne dans Claude Code, l’agent d’Anthropic. Les sessions y restent.')
    : t('Runs in Codetandem’s own agent, so you see every step on the map.', 'Tourne dans l’agent de Codetandem : tu vois chaque étape sur la carte.');
}

// A set-up agent: edit it, test it, use it. Changes wait for Save changes at the bottom of the window.
function AgentDetails({ p, onRemoved }: { p: Provider; onRemoved: () => void }) {
  const { settings, save } = useApp();
  const t = useT();
  const setFoot = useContext(FootCtx);
  const [draft, setDraft] = useState<Provider>(p);
  const [test, setTest] = useState<TestResult | null>(null);
  useEffect(() => { setDraft(p); setTest(null); }, [p]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(p);
  const set = (patch: Partial<Provider>) => setDraft({ ...draft, ...patch });
  const commit = (extra: Partial<Settings> = {}) => save({ providers: settings!.providers.map((o) => (o.id === draft.id ? draft : o)), ...extra });
  useEffect(() => {
    setFoot(dirty ? <><span className="muted">{t('Unsaved changes', 'Modifications non enregistrées')}</span><span className="spacer" />
      <button className="btn ghost" onClick={() => setDraft(p)}>{t('Discard', 'Annuler')}</button>
      <button className="btn primary" onClick={() => commit()}>{t('Save changes', 'Enregistrer')}</button></> : null);
    return () => setFoot(null);
  }, [dirty, draft, p]);
  if (!settings) return null;
  const r = recipeOf(draft);
  const active = settings.activeProvider === p.id;
  const remove = async () => {
    await save({ providers: settings.providers.filter((o) => o.id !== p.id), ...(active ? { activeProvider: 'mock' } : {}) });
    onRemoved();
  };
  const runTest = async () => { setTest({ state: 'testing' }); setTest(await send('/api/providers/test', draft)); };
  return (
    <>
      <div className="form-head">
        <div className="form-title">{p.name}</div>
        {active ? <span className="pill on">{t('in use', 'utilisé')}</span>
          : <button className="btn primary" onClick={() => commit({ activeProvider: p.id })}>{t('Use this agent', 'Utiliser cet agent')}</button>}
      </div>
      <p className="muted form-desc">{r === 'demo' ? t('A scripted run for demos and for trying the app. No model, no cost.', 'Un déroulé écrit d’avance pour les démos et pour essayer l’app. Pas de modèle, pas de coût.') : engineLine(p, t)}</p>
      {r !== 'demo' && <>
        <Field label={t('Name', 'Nom')}><input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        {(r === 'claude' || r === 'claude-code') ? (
          <Field label={t('Model', 'Modèle')}>
            <select value={draft.model} onChange={(e) => set({ model: e.target.value })}>
              {CLAUDE_MODELS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              {!CLAUDE_MODELS.some(([id]) => id === draft.model) && <option value={draft.model}>{draft.model}</option>}
            </select>
          </Field>
        ) : r === 'ollama' ? (
          <Field label={t('Model', 'Modèle')} hint={t('To use another open model, add it with Add an agent.', 'Pour un autre modèle ouvert, ajoute-le avec Ajouter un agent.')}><input className="mono" value={draft.model} readOnly /></Field>
        ) : (
          <Field label={t('Model', 'Modèle')}><input className="mono" value={draft.model} onChange={(e) => set({ model: e.target.value })} /></Field>
        )}
        {r === 'openai' && <Field label={t('Address (base URL)', 'Adresse (base URL)')}><input className="mono" value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></Field>}
        {r !== 'ollama' && r !== 'gpu' && (
          <Field label={t('API key', 'Clé API')} hint={t('Saved on this computer only.', 'Enregistrée sur cet ordinateur seulement.')}>
            <input className="mono" type="password" value={draft.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />
          </Field>
        )}
        {r === 'gpu' && <GpuFields draft={draft} set={set} />}
        {test && <TestLine test={test} />}
        <div className="form-actions">
          {!p.builtin && <button className="btn ghost" onClick={remove}>{t('Remove', 'Retirer')}</button>}
          <span className="spacer" />
          <button className="btn ghost" onClick={runTest}>{t('Test connection', 'Tester la connexion')}</button>
        </div>
      </>}
    </>
  );
}

function GpuFields({ draft, set }: { draft: Provider; set: (p: Partial<Provider>) => void }) {
  const t = useT();
  return (
    <>
      <Field label={t('Brev machine name', 'Nom de la machine Brev')}><input className="mono" value={draft.brevInstance ?? ''} placeholder="agent-gpu" onChange={(e) => set({ brevInstance: e.target.value || undefined, tunnelHost: e.target.value || undefined })} /></Field>
      <details className="advanced">
        <summary>{t('Machine and cost', 'Machine et coût')}</summary>
        <Field label={t('Machine types, in order of preference', 'Types de machine, par ordre de préférence')}>
          <input className="mono" value={draft.gpuTypes ?? ''} placeholder="massedcompute_L40S,hyperstack_L40,…" onChange={(e) => set({ gpuTypes: e.target.value || undefined })} />
        </Field>
        <Field label={t('Turn off after (idle minutes)', 'Éteindre après (minutes sans activité)')}>
          <input type="number" min={0} value={draft.autoStopMin ?? 20} onChange={(e) => set({ autoStopMin: Number(e.target.value) })} />
        </Field>
        <Field label={t('Price ($/hour)', 'Prix ($/heure)')}><input type="number" step="0.01" value={draft.gpuHourly ?? ''} onChange={(e) => set({ gpuHourly: e.target.value ? Number(e.target.value) : undefined })} /></Field>
      </details>
    </>
  );
}

type TestResult = { state: string; detail?: string; latencyMs?: number };
function TestLine({ test }: { test: TestResult }) {
  const t = useT();
  const bad = test.state !== 'ok' && test.state !== 'testing';
  const why = ({ unreachable: t('Can’t reach it', 'Injoignable'), auth: t('Key refused', 'Clé refusée'), missing: t('Model not found', 'Modèle introuvable'), mock: t('It needs an API key', 'Il faut une clé API') } as Record<string, string>)[test.state] ?? test.state;
  return <div className={`test ${test.state === 'ok' ? 'good' : bad ? 'bad' : ''}`}>
    {test.state === 'testing' ? t('Testing…', 'Test…') : test.state === 'ok' ? t(`Connected · ${test.latencyMs} ms`, `Connecté · ${test.latencyMs} ms`) : `${why}${test.detail && test.state !== 'mock' ? `: ${test.detail}` : ''}`}
  </div>;
}

type Check = { id: string; ok: boolean; label: string; fix?: string; link?: string };
const CHOICES: { r: Recipe; icon: IconName; en: [string, string]; fr: [string, string] }[] = [
  { r: 'ollama', icon: 'folder', en: ['Open model on this computer', 'Any open-weight model from Ollama or Hugging Face. Free and private; needs a strong computer.'], fr: ['Modèle ouvert sur cet ordinateur', 'N’importe quel modèle ouvert d’Ollama ou de Hugging Face. Gratuit et privé ; il faut un ordinateur puissant.'] },
  { r: 'gpu', icon: 'cpu', en: ['Open model on your own GPU', 'Any Hugging Face model on a rented NVIDIA GPU (Brev). About $1 an hour while it’s on.'], fr: ['Modèle ouvert sur ton GPU', 'N’importe quel modèle Hugging Face sur un GPU NVIDIA loué (Brev). Environ 1 $ l’heure quand il tourne.'] },
  { r: 'openai', icon: 'globe', en: ['Hosted API', 'OpenRouter, OpenAI, Together or any OpenAI-style API, with your key.'], fr: ['API hébergée', 'OpenRouter, OpenAI, Together ou toute API au format OpenAI, avec ta clé.'] },
  { r: 'nvidia', icon: 'globe', en: ['NVIDIA API', 'Open models hosted by NVIDIA, with your key.'], fr: ['API NVIDIA', 'Des modèles ouverts hébergés par NVIDIA, avec ta clé.'] },
  { r: 'claude', icon: 'list', en: ['Claude', 'Anthropic’s models in Codetandem’s agent, with your key.'], fr: ['Claude', 'Les modèles d’Anthropic dans l’agent de Codetandem, avec ta clé.'] },
  { r: 'claude-code', icon: 'terminal', en: ['Claude Code', 'Anthropic’s own coding agent, with your key.'], fr: ['Claude Code', 'L’agent de code d’Anthropic, avec ta clé.'] },
];
const TEMPLATE: Record<Exclude<Recipe, 'demo'>, Omit<Provider, 'id' | 'name'>> = {
  claude: { kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-opus-5-5', recipe: 'claude' },
  'claude-code': { kind: 'claude-code', baseUrl: '', apiKey: '', model: 'claude-sonnet-5-5', recipe: 'claude-code' },
  nvidia: { kind: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '', model: 'nvidia/nemotron-3-super-120b-a12b', recipe: 'nvidia' },
  openai: { kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: '', recipe: 'openai' },
  ollama: { kind: 'openai', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'qwen3-coder:30b', recipe: 'ollama' },
  gpu: { kind: 'openai', baseUrl: 'http://localhost:18000/v1', apiKey: '', model: 'Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8', recipe: 'gpu', tunnelHost: 'agent-gpu', brevInstance: 'agent-gpu', gpuHourly: 1.06, autoStopMin: 20 },
};
const autoName = (r: Recipe, model: string) => {
  const claude = CLAUDE_MODELS.find(([id]) => id === model)?.[1] ?? model;
  return r === 'claude' ? `Claude ${claude}` : r === 'claude-code' ? `Claude Code · ${claude}` : r === 'ollama' ? `${model} (this computer)`
    : r === 'gpu' ? `${model.split('/').pop()} (your GPU)` : r === 'nvidia' ? `${model.split('/').pop()} (NVIDIA)` : model.split('/').pop() || 'Hosted API';
};

// Setting up an agent: what it needs on this computer, which model, then install (Ollama) or a connection test.
function Setup({ base, onFinish, onDone }: { base?: Provider; onFinish: (id: string) => void; onDone: (id: string) => void }) {
  const { settings, save } = useApp();
  const t = useT();
  const fr = useLang() === 'fr';
  const [recipe, setRecipe] = useState<Recipe | null>(base ? recipeOf(base) : null);
  const [draft, setDraft] = useState<Provider | null>(base ? { ...base, apiKey: recipeOf(base) === 'ollama' ? 'ollama' : base.apiKey } : null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<'form' | 'working' | 'done'>('form');
  const [test, setTest] = useState<TestResult | null>(null);
  const [pull, setPull] = useState<{ state: string; status: string; completed: number; total: number; error?: string } | null>(null);
  const [local, setLocal] = useState<string[]>([]);
  const [finalId, setFinalId] = useState<string | null>(null);
  const needsChecks = recipe === 'ollama' || recipe === 'gpu';
  const recheck = async () => { if (!recipe || !needsChecks) return; setChecking(true); setChecks(await get(`/api/setup/check?recipe=${recipe}`)); setChecking(false); if (recipe === 'ollama') setLocal(await get('/api/setup/ollama/models')); };
  useEffect(() => { setChecks(null); void recheck(); }, [recipe]);
  if (!settings) return null;
  const pick = (r: Recipe) => { setRecipe(r); setDraft({ id: '', name: '', ...TEMPLATE[r as Exclude<Recipe, 'demo'>] }); setTest(null); setPull(null); setPhase('form'); };
  const set = (patch: Partial<Provider>) => draft && setDraft({ ...draft, ...patch });
  const ready = !needsChecks || (checks?.every((c) => c.ok) ?? false);

  const finish = async (p: Provider) => {
    const id = base?.id ?? `${p.recipe}-${Math.random().toString(36).slice(2, 7)}`;
    const name = base?.name ?? autoName(p.recipe!, p.model);
    const next = { ...p, id, name, installed: true, builtin: base?.builtin };
    onFinish(id);
    await save({ providers: base ? settings.providers.map((o) => (o.id === id ? next : o)) : [...settings.providers, next] });
    setFinalId(id); setPhase('done');
  };
  const install = async () => {
    if (!draft || !recipe) return;
    setTest(null); setPull(null);
    if (recipe === 'gpu') return finish(draft);
    if (recipe === 'ollama') {
      setPhase('working');
      const model = draft.model.trim();
      try { setPull(await send('/api/setup/ollama/pull', { model })); } catch (e: any) { setPull({ state: 'error', status: '', completed: 0, total: 0, error: e.message }); setPhase('form'); return; }
      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        const s = await get(`/api/setup/ollama/pull?model=${encodeURIComponent(model)}`);
        setPull(s);
        if (!s || s.state === 'error') { setPhase('form'); return; }
        if (s.state === 'done') return finish({ ...draft, model, apiKey: 'ollama' });
      }
    }
    setPhase('working'); setTest({ state: 'testing' });
    const r: TestResult = await send('/api/providers/test', draft);
    setTest(r);
    if (r.state === 'ok') return finish(draft);
    setPhase('form');
  };

  if (!recipe || !draft) return (
    <>
      <div className="form-title">{t('Add an agent', 'Ajouter un agent')}</div>
      <p className="muted form-desc">{t('Where should the model run?', 'Où le modèle doit-il tourner ?')}</p>
      <div className="recipe-list">
        {CHOICES.map((c) => (
          <button key={c.r} className="recipe" onClick={() => pick(c.r)}>
            <Icon name={c.icon} size={16} />
            <span className="grow"><span>{(fr ? c.fr : c.en)[0]}</span><span className="model-sub">{(fr ? c.fr : c.en)[1]}</span></span>
            <Icon name="chevron" size={13} />
          </button>
        ))}
      </div>
    </>
  );

  const choice = CHOICES.find((c) => c.r === recipe)!;
  if (phase === 'done') {
    const p = settings.providers.find((o) => o.id === finalId);
    return (
      <div className="setup-done">
        <div className="done-mark"><Icon name="check" size={18} /></div>
        <div className="form-title">{t(`${p?.name ?? 'The agent'} is ready`, `${p?.name ?? 'L’agent'} est prêt`)}</div>
        <p className="muted form-desc">{recipe === 'gpu' ? t('Start the GPU from the map when you want it. The first start installs vLLM and downloads the model (5 to 10 minutes).', 'Démarre le GPU depuis la carte quand tu en as besoin. Le premier démarrage installe vLLM et télécharge le modèle (5 à 10 minutes).') : engineLine(p ?? draft, t)}</p>
        <div className="form-actions">
          <button className="btn ghost" onClick={() => finalId && onDone(finalId)}>{t('Done', 'Terminé')}</button>
          <button className="btn primary" onClick={async () => { await save({ activeProvider: finalId! }); onDone(finalId!); }}>{t('Use this agent', 'Utiliser cet agent')}</button>
        </div>
      </div>
    );
  }

  const step = (n: number, title: string, body: ReactNode, state: 'done' | 'now' | 'later') => (
    <li className={`setup-step ${state}`}><span className="step-n">{state === 'done' ? <Icon name="check" size={11} /> : n}</span>
      <div className="step-body"><div className="step-title">{title}</div>{state !== 'later' && body}</div></li>
  );
  const isClaude = recipe === 'claude' || recipe === 'claude-code';
  const modelOk = Boolean(draft.model.trim()) && (recipe !== 'ollama' || /^[\w.\-]+(\/[\w.\-]+)*(:[\w.\-]+)?$/.test(draft.model.trim()));
  const keyOk = recipe === 'ollama' || recipe === 'gpu' || Boolean(draft.apiKey);
  let n = 0;
  return (
    <>
      <div className="form-head">
        <div className="form-title">{base ? t(`Set up ${base.name}`, `Configurer ${base.name}`) : (fr ? choice.fr : choice.en)[0]}</div>
        {!base && phase === 'form' && <button className="btn ghost" onClick={() => { setRecipe(null); setDraft(null); }}>{t('Back', 'Retour')}</button>}
      </div>
      <p className="muted form-desc">{(fr ? choice.fr : choice.en)[1]}</p>
      <ol className="setup-steps">
        {needsChecks && step(++n, t('Check this computer', 'Vérifier cet ordinateur'), (
          <div className="checks">
            {!checks ? <div className="muted">{t('Checking…', 'Vérification…')}</div> : checks.map((c) => (
              <div key={c.id} className={`check ${c.ok ? 'ok' : 'no'}`}>
                <span className="check-dot">{c.ok ? <Icon name="check" size={11} /> : <Icon name="x" size={10} />}</span>
                <span>{c.label}{!c.ok && c.fix && <span className="muted"> {c.fix}{c.link && <> <a href={c.link} target="_blank" rel="noreferrer">{t('Open', 'Ouvrir')}</a></>}</span>}</span>
              </div>
            ))}
            {checks && !ready && <button className="btn ghost" disabled={checking} onClick={recheck}>{checking ? t('Checking…', 'Vérification…') : t('Check again', 'Vérifier à nouveau')}</button>}
          </div>
        ), ready ? 'done' : 'now')}
        {step(++n, isClaude || recipe === 'nvidia' || recipe === 'openai' ? t('Model and key', 'Modèle et clé') : t('Choose a model', 'Choisir un modèle'), (
          <div className="step-fields">
            {recipe === 'openai' && <Field label={t('Address (base URL)', 'Adresse (base URL)')}><input className="mono" value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></Field>}
            {isClaude ? (
              <Seg value={draft.model} onChange={(v) => set({ model: v })} options={CLAUDE_MODELS} />
            ) : (
              <Field label={t('Model', 'Modèle')} hint={recipe === 'ollama' ? t('A name from ollama.com/library, or a Hugging Face GGUF like hf.co/user/repo.', 'Un nom de ollama.com/library, ou un GGUF Hugging Face comme hf.co/user/repo.')
                : recipe === 'gpu' ? t('Any Hugging Face model id that vLLM can serve, like Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8.', 'N’importe quel id de modèle Hugging Face que vLLM sait servir, comme Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8.') : undefined}>
                <input className="mono" value={draft.model} placeholder={recipe === 'openai' ? 'qwen/qwen3-coder' : ''} onChange={(e) => set({ model: e.target.value })} />
              </Field>
            )}
            {recipe === 'ollama' && (
              <div className="picks">{[...new Set([...local, ...OLLAMA_PICKS])].map((m) => (
                <button key={m} className={`chip ${draft.model === m ? 'on' : ''}`} onClick={() => set({ model: m })}>{m}{local.includes(m) && <span className="muted"> · {t('downloaded', 'téléchargé')}</span>}</button>
              ))}</div>
            )}
            {recipe === 'gpu' && <GpuFields draft={draft} set={set} />}
            {(isClaude || recipe === 'nvidia' || recipe === 'openai') && (
              <Field label={t('API key', 'Clé API')} hint={t('Saved on this computer only.', 'Enregistrée sur cet ordinateur seulement.')}>
                <input className="mono" type="password" value={draft.apiKey} placeholder={t('paste your key', 'colle ta clé')} onChange={(e) => set({ apiKey: e.target.value })} />
              </Field>
            )}
          </div>
        ), !ready ? 'later' : 'now')}
        {step(++n, recipe === 'ollama' ? t('Download', 'Télécharger') : recipe === 'gpu' ? t('Finish', 'Terminer') : t('Test the connection', 'Tester la connexion'), (
          <div className="step-fields">
            {pull && pull.state !== 'error' && (
              <div className="pull">
                <div className="pull-bar"><span style={{ width: `${pull.total ? Math.round((pull.completed / pull.total) * 100) : 0}%` }} /></div>
                <div className="muted">{pull.status}{pull.total ? ` · ${(pull.completed / 1e9).toFixed(1)} / ${(pull.total / 1e9).toFixed(1)} GB` : ''}</div>
              </div>
            )}
            {pull?.state === 'error' && <div className="test bad">{pull.error}</div>}
            {test && <TestLine test={test} />}
            <div className="form-actions">
              <span className="spacer" />
              <button className="btn primary" disabled={!ready || !modelOk || !keyOk || phase === 'working'} onClick={install}>
                {phase === 'working' ? (recipe === 'ollama' ? t('Downloading…', 'Téléchargement…') : t('Testing…', 'Test…'))
                  : recipe === 'ollama' ? (local.includes(draft.model.trim()) ? t('Set it up', 'Configurer') : t('Download and set up', 'Télécharger et configurer'))
                  : recipe === 'gpu' ? t('Set it up', 'Configurer') : t('Test and set up', 'Tester et configurer')}
              </button>
            </div>
          </div>
        ), !ready ? 'later' : 'now')}
      </ol>
    </>
  );
}

function Usage() {
  const { settings } = useApp();
  const t = useT();
  const [stats, setStats] = useState<any>(null);
  useEffect(() => { get('/api/stats').then(setStats); }, []);
  if (!stats || !settings) return <div className="muted">{t('Loading…', 'Chargement…')}</div>;
  const name = (id: string) => settings.providers.find((p) => p.id === id)?.name ?? id;
  const rows = Object.entries(stats.byProvider) as [string, any][];
  const totalTokens = rows.reduce((a, [, b]) => a + b.tokens, 0);
  const spendOf = (b: any) => (b.apiCost ?? 0) + b.gpuCost;
  const totalSpend = rows.reduce((a, [, b]) => a + spendOf(b), 0);
  const $ = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);
  return (
    <div>
      <p className="set-intro">{t('What your sessions have used so far, on this computer.', 'Ce que tes sessions ont utilisé jusqu’ici, sur cet ordinateur.')}</p>
      <div className="stat-cards">
        <div className="stat"><div className="muted">{t('Spent (about)', 'Dépensé (environ)')}</div><div className="big">{$(totalSpend)}</div></div>
        <div className="stat"><div className="muted">Tokens</div><div className="big">{fmtTokens(totalTokens)}</div></div>
        <div className="stat"><div className="muted">{t('Sessions', 'Sessions')}</div><div className="big">{stats.threads.length}</div></div>
      </div>
      <h3 className="set-section-title">{t('By model', 'Par modèle')}</h3>
      <table className="table">
        <thead><tr><th>{t('Model', 'Modèle')}</th><th>Tokens</th><th>{t('Sessions', 'Sessions')}</th><th>{t('Spent', 'Dépensé')}</th></tr></thead>
        <tbody>{rows.map(([id, b]) => (
          <tr key={id}><td>{name(id)}</td><td className="mono">{fmtTokens(b.tokens)}</td><td className="mono">{b.threads}</td>
            <td className="mono" title={b.gpuCost ? t(`GPU ${$(b.gpuCost)} (${b.gpuHours.toFixed(2)} h, since the server started)`, `GPU ${$(b.gpuCost)} (${b.gpuHours.toFixed(2)} h, depuis le démarrage du serveur)`) : undefined}>{$(spendOf(b))}</td></tr>
        ))}</tbody>
      </table>
      <h3 className="set-section-title">{t('Biggest sessions', 'Plus grosses sessions')}</h3>
      <table className="table">
        <thead><tr><th>{t('Session', 'Session')}</th><th>Tokens</th><th>{t('Spent', 'Dépensé')}</th></tr></thead>
        <tbody>{[...stats.threads].sort((a: any, b: any) => b.tokens - a.tokens).slice(0, 8).map((th: any) => (
          <tr key={th.id}><td>{th.title === 'New thread' ? t('New session', 'Nouvelle session') : th.title}<div className="muted">{name(th.providerId)}</div></td><td className="mono">{fmtTokens(th.tokens)}</td><td className="mono">{$(th.spend ?? 0)}</td></tr>
        ))}</tbody>
      </table>
      <p className="hint">{t('Claude is priced from list prices (cached reads cost less, so this errs high); Claude Code reports its exact cost. Your GPU is billed per hour.', 'Claude est compté au prix catalogue (les lectures en cache coûtent moins, donc c’est un peu surestimé) ; Claude Code donne son coût exact. Ton GPU est facturé à l’heure.')}</p>
    </div>
  );
}

// A settings page is sections of rows: a name and one line on what it does, the control on the right.
function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(([v, label]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}</div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="set-section"><h3 className="set-section-title">{title}</h3><div className="set-rows">{children}</div></section>;
}
function Row({ label, desc, children }: { label: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return <div className="set-row"><span className="set-label">{label}{desc && <span className="set-desc">{desc}</span>}</span><span className="set-control">{children}</span></div>;
}

function Learning() {
  const { settings, save } = useApp();
  const t = useT();
  if (!settings) return null;
  const l = settings.learn;
  const setL = (patch: Partial<typeof l>) => save({ learn: { ...l, ...patch } });
  const ins = settings.insights ?? 'auto';
  return (
    <>
      <p className="set-intro">{t('How Guide me teaches you. Changes apply to your next message.', 'Comment Guide-moi t’apprend. Les changements s’appliquent à ton prochain message.')}</p>
      <Section title={t('About you', 'Toi')}>
        <Row label={t('Your level', 'Ton niveau')} desc={{ beginner: t('It defines terms the first time they come up.', 'Il définit les termes la première fois qu’ils apparaissent.'), intermediate: t('It focuses on how the parts fit together.', 'Il se concentre sur comment les parties s’assemblent.'), advanced: t('It digs into assumptions, edge cases and what can break.', 'Il creuse les hypothèses, les cas limites et ce qui peut casser.') }[l.level]}>
          <Seg value={l.level} onChange={(v) => setL({ level: v })} options={[['beginner', t('Beginner', 'Débutant')], ['intermediate', t('Some basics', 'Les bases')], ['advanced', t('Experienced', 'Expérimenté')]]} />
        </Row>
        <Row label={t('Coding with AI', 'Coder avec l’IA')} desc={{ none: t('It says what it’s about to do, and why, before every move.', 'Il dit ce qu’il va faire, et pourquoi, avant chaque geste.'), chat: t('It shows what changes when an agent works in your real files.', 'Il montre ce qui change quand un agent travaille dans tes vrais fichiers.'), agents: t('It focuses on reviewing and steering an agent.', 'Il se concentre sur relire et piloter un agent.') }[l.ai ?? 'none']}>
          <Seg value={l.ai ?? 'none'} onChange={(v) => setL({ ai: v })} options={[['none', t('New to it', 'Nouveau')], ['chat', t('Chatbots', 'Chatbots')], ['agents', t('Coding agents', 'Agents de code')]]} />
        </Row>
        <Row label={t('Your language', 'Ta langue')} desc={t('For the app and the agent’s explanations. Code stays in English.', 'Pour l’app et les explications de l’agent. Le code reste en anglais.')}>
          <Seg value={l.language} onChange={(v) => setL({ language: v })} options={[['en', 'English'], ['fr', 'Français']]} />
        </Row>
      </Section>
      <Section title={t('While it works', 'Pendant qu’il travaille')}>
        <Row label={t('How often it stops for you', 'Il s’arrête pour toi')} desc={t('In Guide me, how often it pauses to check you follow or let you decide.', 'En Guide-moi, à quelle fréquence il fait une pause pour vérifier que tu suis ou te laisser décider.')}>
          <Seg value={l.frequency} onChange={(v) => setL({ frequency: v })} options={[['light', t('Rarely', 'Peu')], ['normal', t('Normal', 'Normal')], ['frequent', t('Often', 'Souvent')]]} />
        </Row>
        <Row label={t('Plain-words step names', 'Étapes en mots simples')} desc={ins === 'on' ? t('Always on. One small extra model call per step on paid APIs.', 'Toujours. Un petit appel au modèle en plus par étape, sur les API payantes.') : ins === 'off' ? t('Steps show the raw tool names.', 'Les étapes montrent le nom brut des outils.') : t('Names steps like “Reads the login page”. On when the model is free to run.', 'Nomme les étapes comme « Lit la page de connexion ». Actif quand le modèle est gratuit.')}>
          <Seg value={ins} onChange={(v) => save({ insights: v })} options={[['auto', t('Auto', 'Auto')], ['on', t('Always', 'Toujours')], ['off', t('Off', 'Non')]]} />
        </Row>
      </Section>
    </>
  );
}

function Appearance() {
  const [pref, setPref] = useTheme();
  const t = useT();
  const opts: [ThemePref, string][] = [['light', t('Light', 'Clair')], ['dark', t('Dark', 'Sombre')], ['system', t('Like my computer', 'Comme mon ordinateur')]];
  return (
    <>
      <p className="set-intro">{t('How Codetandem looks on this computer.', 'L’apparence de Codetandem sur cet ordinateur.')}</p>
      <Section title={t('Theme', 'Thème')}>
        <div className="theme-pick">
          {opts.map(([v, name]) => (
            <button key={v} className={pref === v ? 'on' : ''} onClick={() => setPref(v)}><span className={`theme-swatch ${v}`} />{name}</button>
          ))}
        </div>
      </Section>
    </>
  );
}

function Safety() {
  const { settings, save } = useApp();
  const t = useT();
  if (!settings) return null;
  return (
    <>
      <p className="set-intro">{t('What the agent can do without asking you first.', 'Ce que l’agent peut faire sans te demander.')}</p>
      <Section title={t('Commands', 'Commandes')}>
        <Row label={t('Before running a command', 'Avant une commande')} desc={settings.approval === 'safe' ? t('Commands that only look (ls, cat, grep, git status…) run without asking.', 'Les commandes qui ne font que regarder (ls, cat, grep, git status…) passent sans demander.') : t('It asks you before every command it runs in your terminal.', 'Il te demande avant chaque commande lancée dans ton terminal.')}>
          <Seg value={settings.approval} onChange={(v) => save({ approval: v })} options={[['always', t('Always ask', 'Toujours demander')], ['safe', t('Ask for changes only', 'Seulement si ça change')]]} />
        </Row>
      </Section>
      <Section title={t('Limits', 'Limites')}>
        <Row label={t('Most steps per task', 'Étapes max par tâche')} desc={t('It stops after this many steps. Send “continue” to keep going.', 'Il s’arrête après ce nombre d’étapes. Envoie « continue » pour reprendre.')}>
          <input className="num" type="number" min={5} max={200} value={settings.maxSteps} onChange={(e) => save({ maxSteps: Number(e.target.value) || 30 })} />
        </Row>
      </Section>
    </>
  );
}

function About() {
  const t = useT();
  return (
    <>
      <p className="set-intro">{t('The coding agent you can follow and learn from, on a map.', 'L’agent de code que tu suis et qui t’apprend, sur une carte.')}</p>
      <Section title={t('This app', 'Cette app')}>
        <Row label={t('Your data', 'Tes données')} desc={t('Settings, sessions and notes stay on this computer.', 'Réglages, sessions et notes restent sur cet ordinateur.')}><span className="mono muted">~/.agent-stage</span></Row>
      </Section>
      <Section title={t('Credits', 'Crédits')}>
        <Row label={t('Licence', 'Licence')}><span className="muted">MIT</span></Row>
        <Row label={t('Guide me', 'Guide-moi')} desc={t('Its teaching prompts are adapted from VibeWise.', 'Ses consignes d’enseignement sont adaptées de VibeWise.')}><span className="muted">VibeWise (MIT)</span></Row>
      </Section>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
