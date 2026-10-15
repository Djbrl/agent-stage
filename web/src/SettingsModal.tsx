// Settings: model providers (with keys + connection test), usage & spend, safety, about.
import { useEffect, useState } from 'react';
import { get, send, fmtTokens, type Provider } from './api';
import { useApp } from './useSettings';
import { Icon } from './icons';

type Tab = 'models' | 'learning' | 'usage' | 'safety' | 'about';
const KIND_LABEL = { mock: 'Scripted demo', openai: 'OpenAI-compatible', anthropic: 'Anthropic (Claude)' };

export function SettingsModal({ onClose, initialTab = 'models' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>Settings</span><button className="icon-btn" onClick={onClose}><Icon name="x" size={13} /></button></div>
        <div className="settings">
          <div className="settings-nav">
            {(['models', 'learning', 'usage', 'safety', 'about'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ models: 'Models', learning: 'Learning', usage: 'Usage & spend', safety: 'Safety', about: 'About' }[t]}</button>
            ))}
          </div>
          <div className="settings-body">
            {tab === 'models' && <Models />}
            {tab === 'learning' && <Learning />}
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
        {settings.providers.map((p) => (
          <button key={p.id} className={`model-row ${p.id === sel ? 'on' : ''}`} onClick={() => setSel(p.id)}>
            <Icon name={p.kind === 'mock' ? 'spark' : p.tunnelHost ? 'cpu' : 'list'} size={13} />
            <span className="grow"><span>{p.name}</span><span className="muted mono">{p.kind === 'mock' ? 'no model' : p.model || 'no model set'}</span></span>
            {p.id === settings.activeProvider && <span className="pill on">active</span>}
            {p.kind !== 'mock' && !p.apiKey && <span className="pill">no key</span>}
          </button>
        ))}
        <select className="add-model" value="" onChange={(e) => { const p = presets[Number(e.target.value)]; if (p) add(p); }}>
          <option value="">+ Add a model…</option>
          {presets.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
        </select>
      </div>

      {draft && (
        <div className="model-form">
          <div className="form-title">{draft.name}<span className="muted"> · {KIND_LABEL[draft.kind]}</span></div>
          {draft.kind === 'mock' ? (
            <p className="muted">A scripted run for demos and UI work. No model, no network, no cost.</p>
          ) : (
            <>
              <Field label="Name"><input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="API type">
                <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as Provider['kind'] })}>
                  <option value="openai">OpenAI-compatible (OpenAI, NVIDIA, vLLM, Ollama, OpenRouter…)</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                </select>
              </Field>
              {draft.kind === 'openai' && <Field label="Base URL"><input className="mono" value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></Field>}
              <Field label="Model"><input className="mono" value={draft.model} placeholder="model id" onChange={(e) => set({ model: e.target.value })} /></Field>
              <Field label="API key" hint="Stored only on this computer, in ~/.agent-stage/settings.json.">
                <input className="mono" type="password" value={draft.apiKey} placeholder="paste key" onChange={(e) => set({ apiKey: e.target.value })} />
              </Field>
              {draft.kind === 'openai' && (
                <details className="advanced" open={Boolean(draft.tunnelHost || draft.gpuHourly)}>
                  <summary>Self-hosted GPU (optional)</summary>
                  <Field label="SSH tunnel host" hint="The server keeps ssh -L open to this host."><input className="mono" value={draft.tunnelHost ?? ''} placeholder="agent-gpu" onChange={(e) => set({ tunnelHost: e.target.value || undefined })} /></Field>
                  <Field label="Brev instance" hint="Shows the GPU's state in the status bar."><input className="mono" value={draft.brevInstance ?? ''} placeholder="agent-gpu" onChange={(e) => set({ brevInstance: e.target.value || undefined })} /></Field>
                  <Field label="GPU price ($/hour)" hint="For the cost meter. You pay GPU time, not tokens."><input type="number" step="0.01" value={draft.gpuHourly ?? ''} onChange={(e) => set({ gpuHourly: e.target.value ? Number(e.target.value) : undefined })} /></Field>
                </details>
              )}
            </>
          )}
          {test && (
            <div className={`test ${test.state === 'ok' ? 'good' : test.state === 'testing' ? '' : 'bad'}`}>
              {test.state === 'testing' ? 'Testing…' : test.state === 'ok' ? `Connected · ${test.latencyMs} ms` : `${test.state}${test.detail ? `: ${test.detail}` : ''}`}
            </div>
          )}
          <div className="form-actions">
            {draft.kind !== 'mock' && <button className="btn ghost" onClick={remove}>Remove</button>}
            <span className="spacer" />
            {draft.kind !== 'mock' && <button className="btn ghost" onClick={runTest}>Test connection</button>}
            {draft.kind !== 'mock' && <button className="btn ghost" onClick={() => commit()}>Save</button>}
            <button className="btn primary" onClick={() => commit(true)}>{settings.activeProvider === draft.id ? 'Save' : 'Use this model'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Usage() {
  const { settings } = useApp();
  const [stats, setStats] = useState<any>(null);
  useEffect(() => { get('/api/stats').then(setStats); }, []);
  if (!stats || !settings) return <div className="muted">Loading…</div>;
  const name = (id: string) => settings.providers.find((p) => p.id === id)?.name ?? id;
  const rows = Object.entries(stats.byProvider) as [string, any][];
  const totalTokens = rows.reduce((a, [, b]) => a + b.tokens, 0);
  const totalCost = rows.reduce((a, [, b]) => a + b.gpuCost, 0);
  return (
    <div>
      <div className="stat-cards">
        <div className="stat"><div className="muted">Tokens</div><div className="big">{fmtTokens(totalTokens)}</div></div>
        <div className="stat"><div className="muted">Threads</div><div className="big">{stats.threads.length}</div></div>
        <div className="stat"><div className="muted">GPU spend (this run of the server)</div><div className="big">${totalCost.toFixed(2)}</div></div>
      </div>
      <div className="label">By model</div>
      <table className="table">
        <thead><tr><th>Model</th><th>Tokens</th><th>Calls</th><th>Threads</th><th>GPU hours</th><th>GPU $</th></tr></thead>
        <tbody>{rows.map(([id, b]) => (
          <tr key={id}><td>{name(id)}</td><td className="mono">{fmtTokens(b.tokens)}</td><td className="mono">{b.calls}</td><td className="mono">{b.threads}</td><td className="mono">{b.gpuHours.toFixed(2)}</td><td className="mono">${b.gpuCost.toFixed(2)}</td></tr>
        ))}</tbody>
      </table>
      <div className="label">Biggest threads</div>
      <table className="table">
        <tbody>{[...stats.threads].sort((a: any, b: any) => b.tokens - a.tokens).slice(0, 8).map((t: any) => (
          <tr key={t.id}><td>{t.title}</td><td className="muted">{name(t.providerId)}</td><td className="mono">{fmtTokens(t.tokens)}</td></tr>
        ))}</tbody>
      </table>
      <p className="hint">API models bill per token on your provider's account. Self-hosted models bill per GPU hour, whether you use them or not, so stop the GPU when you're done.</p>
    </div>
  );
}

function Learning() {
  const { settings, save } = useApp();
  if (!settings) return null;
  const l = settings.learn;
  const opt = <K extends keyof typeof l>(key: K, values: [typeof l[K], string, string][]) => values.map(([v, title, sub]) => (
    <label key={String(v)} className={`choice ${l[key] === v ? 'on' : ''}`}>
      <input type="radio" checked={l[key] === v} onChange={() => save({ learn: { ...l, [key]: v } })} />
      <span><b>{title}</b><span className="muted">{sub}</span></span>
    </label>
  ));
  return (
    <div>
      <p className="muted">Learn mode, inspired by VibeWise: you own the design, the agent teaches and implements what you agree on.</p>
      <div className="label">Your level</div>
      {opt('level', [['beginner', 'Beginner', 'More grounding: terms are defined the first time they appear.'], ['intermediate', 'Intermediate', 'Focus on how the parts interact.'], ['advanced', 'Advanced', 'Probe assumptions, failure modes and trust boundaries.']])}
      <div className="label">Checkpoints</div>
      {opt('frequency', [['light', 'Light', 'Only major decisions.'], ['normal', 'Normal', 'Meaningful decisions.'], ['frequent', 'Frequent', 'Smaller steps too.']])}
      <div className="label">Language</div>
      {opt('language', [['en', 'English', 'Explanations in English.'], ['fr', 'Français', 'Les explications en français (le code reste en anglais).']])}
      <div className="label">AI step labels & file summaries</div>
      {(['auto', 'on', 'off'] as const).map((v) => (
        <label key={v} className={`choice ${(settings.insights ?? 'auto') === v ? 'on' : ''}`}>
          <input type="radio" checked={(settings.insights ?? 'auto') === v} onChange={() => save({ insights: v })} />
          <span><b>{{ auto: 'Auto', on: 'Always', off: 'Off' }[v]}</b><span className="muted">{{
            auto: 'On for free models (your own GPU, Ollama, the demo), off for per-token APIs.',
            on: 'Also on paid APIs: every step costs a small extra call.', off: 'Plain rule-based labels only.' }[v]}</span></span>
        </label>
      ))}
    </div>
  );
}

function Safety() {
  const { settings, save } = useApp();
  if (!settings) return null;
  return (
    <div>
      <div className="label">Shell commands</div>
      {(['always', 'safe'] as const).map((v) => (
        <label key={v} className={`choice ${settings.approval === v ? 'on' : ''}`}>
          <input type="radio" checked={settings.approval === v} onChange={() => save({ approval: v })} />
          <span><b>{v === 'always' ? 'Always ask' : 'Auto-approve read-only commands'}</b>
            <span className="muted">{v === 'always' ? 'Every command waits for you.' : 'ls, cat, grep, git status/diff/log… run without asking. Anything else, or anything with pipes or redirects, still asks.'}</span></span>
        </label>
      ))}
      <div className="label">Step limit</div>
      <Field label="Max tool calls per task" hint="A runaway agent stops here.">
        <input type="number" min={5} max={200} value={settings.maxSteps} onChange={(e) => save({ maxSteps: Number(e.target.value) || 30 })} />
      </Field>
      <p className="hint">File tools can never leave the thread's folder.</p>
    </div>
  );
}

function About() {
  const { me } = useApp();
  return (
    <div className="about">
      <p><b>agent-stage</b>: a visual, open-source coding agent. Watch it work, stop it, steer it, and run it on the model you choose, including your own GPU.</p>
      <p className="muted">Data folder: <span className="mono">~/.agent-stage</span> · Sandbox: <span className="mono">{me?.sandbox}</span></p>
      <p className="muted">MIT licensed.</p>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
