// Settings: models (with keys + connection test), learning, appearance, usage & spend, safety, about.
import { useEffect, useState } from 'react';
import { get, send, fmtTokens, engineOf, agentName, type Provider, type Engine } from './api';
import { useApp } from './useSettings';
import { Icon } from './icons';
import { useTheme, type ThemePref } from './theme';
import { useDismiss } from './dismiss';
import { useT, useLang } from './i18n';

type Tab = 'models' | 'learning' | 'appearance' | 'usage' | 'safety' | 'about';

export function SettingsModal({ onClose, initialTab = 'models' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const t = useT();
  useDismiss(true, onClose);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>{t('Settings', 'Réglages')}</span><button className="icon-btn" onClick={onClose} aria-label={t('Close', 'Fermer')}><Icon name="x" size={13} /></button></div>
        <div className="settings">
          <div className="settings-nav">
            {(['models', 'learning', 'appearance', 'usage', 'safety', 'about'] as Tab[]).map((k) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{{ models: t('Models', 'Modèles'), learning: t('Learning', 'Apprentissage'), appearance: t('Appearance', 'Apparence'), usage: t('Usage', 'Utilisation'), safety: t('Safety', 'Sécurité'), about: t('About', 'À propos') }[k]}</button>
            ))}
          </div>
          <div className="settings-body">
            {tab === 'models' && <Models />}
            {tab === 'learning' && <Learning />}
            {tab === 'appearance' && <Appearance />}
            {tab === 'usage' && <Usage />}
            {tab === 'safety' && <Safety />}
            {tab === 'about' && <About />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Models() {
  const { settings, save } = useApp();
  const t = useT();
  const frLang = useLang() === 'fr';
  const [sel, setSel] = useState<string>(settings?.activeProvider ?? '');
  const [draft, setDraft] = useState<Provider | null>(null);
  const [test, setTest] = useState<{ state: string; detail?: string; latencyMs?: number } | null>(null);
  const [presets, setPresets] = useState<Omit<Provider, 'id'>[]>([]);
  useEffect(() => { get('/api/presets').then(setPresets); }, []);
  useEffect(() => { setDraft(settings?.providers.find((p) => p.id === sel) ?? null); setTest(null); }, [sel, settings]);
  if (!settings) return null;

  const set = (patch: Partial<Provider>) => draft && setDraft({ ...draft, ...patch });
  const commit = async (activate = false) => {
    if (!draft) return;
    const providers = settings.providers.map((p) => (p.id === draft.id ? draft : p));
    await save({ providers, ...(activate ? { activeProvider: draft.id } : {}) });
  };
  const add = async (preset: Omit<Provider, 'id'>) => {
    const id = `${preset.kind}-${Math.random().toString(36).slice(2, 7)}`;
    await save({ providers: [...settings.providers, { ...preset, id }] });
    setSel(id);
  };
  const remove = async () => {
    if (!draft || draft.kind === 'mock') return;
    await save({ providers: settings.providers.filter((p) => p.id !== draft.id) });
    setSel(settings.activeProvider === draft.id ? 'mock' : settings.activeProvider);
  };
  const runTest = async () => { setTest({ state: 'testing' }); setTest(await send('/api/providers/test', draft)); };

  return (
    <div className="models">
      <div className="model-list">
        {(['native', 'claude-code'] as Engine[]).map((g) => <div key={g}>
          <div className="engine-head">{agentName(g, frLang)}</div>
        {settings.providers.filter((p) => engineOf(p) === g).map((p) => (
          <button key={p.id} className={`model-row ${p.id === sel ? 'on' : ''}`} onClick={() => setSel(p.id)}>
            <Icon name={p.kind === 'mock' ? 'spark' : p.tunnelHost ? 'cpu' : 'list'} size={13} />
            <span className="grow"><span>{p.name}</span>{p.kind !== 'mock' && <span className="muted mono">{!p.apiKey ? t('needs a key', 'clé manquante') : p.model || t('no model set', 'aucun modèle choisi')}</span>}</span>
            {p.id === settings.activeProvider && <span className="pill on">{t('in use', 'utilisé')}</span>}
          </button>
        ))}</div>)}
        <select className="add-model" value="" onChange={(e) => { const p = presets[Number(e.target.value)]; if (p) add(p); }}>
          <option value="">{t('+ Add a model…', '+ Ajouter un modèle…')}</option>
          {presets.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
        </select>
      </div>

      {draft && (
        <div className="model-form">
          <div className="form-title">{draft.name}</div>
          {draft.kind === 'mock' ? (
            <p className="muted">{t('A scripted run for demos. No model, no cost.', 'Un déroulé écrit d’avance pour les démos. Pas de modèle, pas de coût.')}</p>
          ) : (
            <>
              <Field label={t('Name', 'Nom')}><input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label={t('Type', 'Type')}>
                <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as Provider['kind'] })}>
                  <option value="openai">{t('OpenAI-compatible', 'Compatible OpenAI')}</option>
                  <option value="anthropic">Anthropic API</option>
                  <option value="claude-code">Claude Code</option>
                </select>
              </Field>
              {draft.kind === 'openai' && <Field label={t('Address (base URL)', 'Adresse (base URL)')}><input className="mono" value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></Field>}
              <Field label={t('Model', 'Modèle')}><input className="mono" value={draft.model} placeholder={t('model id', 'id du modèle')} onChange={(e) => set({ model: e.target.value })} /></Field>
              <Field label={t('API key', 'Clé API')} hint={t('Saved on this computer only.', 'Enregistrée sur cet ordinateur seulement.')}>
                <input className="mono" type="password" value={draft.apiKey} placeholder={t('paste key', 'colle la clé')} onChange={(e) => set({ apiKey: e.target.value })} />
              </Field>
              {draft.kind === 'openai' && (
                <details className="advanced" open={Boolean(draft.tunnelHost || draft.gpuHourly)}>
                  <summary>{t('Your own GPU', 'Ton propre GPU')}</summary>
                  <Field label={t('SSH host', 'Hôte SSH')}><input className="mono" value={draft.tunnelHost ?? ''} placeholder="agent-gpu" onChange={(e) => set({ tunnelHost: e.target.value || undefined })} /></Field>
                  <Field label={t('Brev machine', 'Machine Brev')} hint={t('Adds Start / Stop GPU.', 'Ajoute Démarrer / Arrêter le GPU.')}><input className="mono" value={draft.brevInstance ?? ''} placeholder="agent-gpu" onChange={(e) => set({ brevInstance: e.target.value || undefined })} /></Field>
                  <Field label={t('Machine types', 'Types de machine')}>
                    <input className="mono" value={draft.gpuTypes ?? ''} placeholder="massedcompute_L40S,hyperstack_L40,…" onChange={(e) => set({ gpuTypes: e.target.value || undefined })} />
                  </Field>
                  <Field label={t('Turn off after (idle minutes)', 'Éteindre après (minutes sans activité)')}>
                    <input type="number" min={0} value={draft.autoStopMin ?? 20} onChange={(e) => set({ autoStopMin: Number(e.target.value) })} />
                  </Field>
                  <Field label={t('Price ($/hour)', 'Prix ($/heure)')}><input type="number" step="0.01" value={draft.gpuHourly ?? ''} onChange={(e) => set({ gpuHourly: e.target.value ? Number(e.target.value) : undefined })} /></Field>
                </details>
              )}
            </>
          )}
          {test && (
            <div className={`test ${test.state === 'ok' ? 'good' : test.state === 'testing' ? '' : 'bad'}`}>
              {test.state === 'testing' ? t('Testing…', 'Test…') : test.state === 'ok' ? t(`Connected · ${test.latencyMs} ms`, `Connecté · ${test.latencyMs} ms`) : `${({ unreachable: t('Can’t reach it', 'Injoignable'), auth: t('Key refused', 'Clé refusée'), missing: t('Model not found', 'Modèle introuvable') } as Record<string, string>)[test.state] ?? test.state}${test.detail ? `: ${test.detail}` : ''}`}
            </div>
          )}
          <div className="form-actions">
            {draft.kind !== 'mock' && <button className="btn ghost" onClick={remove}>{t('Remove', 'Retirer')}</button>}
            <span className="spacer" />
            {draft.kind !== 'mock' && <button className="btn ghost" onClick={runTest}>{t('Test', 'Tester')}</button>}
            {draft.kind !== 'mock' && settings.activeProvider !== draft.id && <button className="btn ghost" onClick={() => commit()}>{t('Save', 'Enregistrer')}</button>}
            <button className="btn primary" onClick={() => commit(true)}>{settings.activeProvider === draft.id ? t('Save', 'Enregistrer') : t('Use this model', 'Utiliser ce modèle')}</button>
          </div>
        </div>
      )}
    </div>
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
      <div className="stat-cards">
        <div className="stat"><div className="muted">{t('Spent (about)', 'Dépensé (environ)')}</div><div className="big">{$(totalSpend)}</div></div>
        <div className="stat"><div className="muted">Tokens</div><div className="big">{fmtTokens(totalTokens)}</div></div>
        <div className="stat"><div className="muted">{t('Sessions', 'Sessions')}</div><div className="big">{stats.threads.length}</div></div>
      </div>
      <table className="table">
        <thead><tr><th>{t('Model', 'Modèle')}</th><th>Tokens</th><th>{t('Sessions', 'Sessions')}</th><th>{t('Spent', 'Dépensé')}</th></tr></thead>
        <tbody>{rows.map(([id, b]) => (
          <tr key={id}><td>{name(id)}</td><td className="mono">{fmtTokens(b.tokens)}</td><td className="mono">{b.threads}</td>
            <td className="mono" title={b.gpuCost ? t(`GPU ${$(b.gpuCost)} (${b.gpuHours.toFixed(2)} h, since the server started)`, `GPU ${$(b.gpuCost)} (${b.gpuHours.toFixed(2)} h, depuis le démarrage du serveur)`) : undefined}>{$(spendOf(b))}</td></tr>
        ))}</tbody>
      </table>
      <table className="table">
        <thead><tr><th>{t('Biggest sessions', 'Plus grosses sessions')}</th><th>Tokens</th><th>{t('Spent', 'Dépensé')}</th></tr></thead>
        <tbody>{[...stats.threads].sort((a: any, b: any) => b.tokens - a.tokens).slice(0, 8).map((th: any) => (
          <tr key={th.id}><td>{th.title === 'New thread' ? t('New session', 'Nouvelle session') : th.title}<div className="muted">{name(th.providerId)}</div></td><td className="mono">{fmtTokens(th.tokens)}</td><td className="mono">{$(th.spend ?? 0)}</td></tr>
        ))}</tbody>
      </table>
      <p className="hint">{t('Claude is priced from list prices (cached reads cost less, so this errs high); Claude Code reports its exact cost. Your GPU is billed per hour.', 'Claude est compté au prix catalogue (les lectures en cache coûtent moins, donc c’est un peu surestimé) ; Claude Code donne son coût exact. Ton GPU est facturé à l’heure.')}</p>
    </div>
  );
}

// One row per setting: a short name and a segmented choice. No descriptions unless a choice costs something.
function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(([v, label]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}</div>;
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="set-row"><span className="set-label">{label}{hint && <span className="field-hint">{hint}</span>}</span>{children}</div>;
}

function Learning() {
  const { settings, save } = useApp();
  const t = useT();
  if (!settings) return null;
  const l = settings.learn;
  const setL = (patch: Partial<typeof l>) => save({ learn: { ...l, ...patch } });
  return (
    <div className="set-rows">
      <Row label={t('Your level', 'Ton niveau')}><Seg value={l.level} onChange={(v) => setL({ level: v })} options={[['beginner', t('Beginner', 'Débutant')], ['intermediate', t('Some basics', 'Les bases')], ['advanced', t('Experienced', 'Expérimenté')]]} /></Row>
      <Row label={t('How often it asks you', 'Il te demande')} hint={t('In Guide me', 'En mode Guide-moi')}><Seg value={l.frequency} onChange={(v) => setL({ frequency: v })} options={[['light', t('Rarely', 'Peu')], ['normal', t('Normal', 'Normal')], ['frequent', t('Often', 'Souvent')]]} /></Row>
      <Row label={t('Language', 'Langue')}><Seg value={l.language} onChange={(v) => setL({ language: v })} options={[['en', 'English'], ['fr', 'Français']]} /></Row>
      <Row label={t('Plain-words step names', 'Étapes en mots simples')} hint={(settings.insights ?? 'auto') === 'on' ? t('One small extra model call per step on paid APIs.', 'Un petit appel au modèle en plus par étape, sur les API payantes.') : undefined}>
        <Seg value={settings.insights ?? 'auto'} onChange={(v) => save({ insights: v })} options={[['auto', t('Auto', 'Auto')], ['on', t('Always', 'Toujours')], ['off', t('Off', 'Non')]]} />
      </Row>
    </div>
  );
}

function Appearance() {
  const [pref, setPref] = useTheme();
  const t = useT();
  const opts: [ThemePref, string][] = [['dark', t('Dark', 'Sombre')], ['light', t('Light', 'Clair')], ['system', t('Like my computer', 'Comme mon ordinateur')]];
  return (
    <div className="theme-pick">
      {opts.map(([v, name]) => (
        <button key={v} className={pref === v ? 'on' : ''} onClick={() => setPref(v)}><span className={`theme-swatch ${v}`} />{name}</button>
      ))}
    </div>
  );
}

function Safety() {
  const { settings, save } = useApp();
  const t = useT();
  if (!settings) return null;
  return (
    <div className="set-rows">
      <Row label={t('Commands', 'Commandes')} hint={settings.approval === 'safe' ? t('Commands that only look (ls, cat, grep, git status…) run without asking.', 'Les commandes qui ne font que regarder (ls, cat, grep, git status…) passent sans demander.') : undefined}>
        <Seg value={settings.approval} onChange={(v) => save({ approval: v })} options={[['always', t('Always ask', 'Toujours demander')], ['safe', t('Ask for changes only', 'Seulement si ça change')]]} />
      </Row>
      <Row label={t('Most steps per task', 'Étapes max par tâche')}>
        <input className="num" type="number" min={5} max={200} value={settings.maxSteps} onChange={(e) => save({ maxSteps: Number(e.target.value) || 30 })} />
      </Row>
    </div>
  );
}

function About() {
  const t = useT();
  const fr = useLang() === 'fr';
  return (
    <div className="about">
      <p><b>agent-stage</b>{fr ? ' : ' : ': '}{t('the coding agent you can follow and learn from, on a map.', 'l’agent de code que tu suis et qui t’apprend, sur une carte.')}</p>
      <p className="muted">{t('Data in', 'Données dans')} <span className="mono">~/.agent-stage</span>. {t('MIT licence; Guide me is adapted from VibeWise (MIT).', 'Licence MIT ; Guide-moi est adapté de VibeWise (MIT).')}</p>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
