// Settings: model providers (with keys + connection test), usage & spend, safety, about.
import { useEffect, useState } from 'react';
import { get, send, fmtTokens, engineOf, ENGINE_LABEL, type Provider, type Engine } from './api';
import { useApp } from './useSettings';
import { Icon } from './icons';
import { useTheme, type ThemePref } from './theme';
import { useDismiss } from './dismiss';

type Tab = 'models' | 'learning' | 'appearance' | 'usage' | 'safety' | 'about';

export function SettingsModal({ onClose, initialTab = 'models' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  useDismiss(true, onClose);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>Settings</span><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={13} /></button></div>
        <div className="settings">
          <div className="settings-nav">
            {(['models', 'learning', 'appearance', 'usage', 'safety', 'about'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ models: 'Models', learning: 'Learning', appearance: 'Appearance', usage: 'Usage', safety: 'Safety', about: 'About' }[t]}</button>
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
          <div className="engine-head">{ENGINE_LABEL[g]}</div>
        {settings.providers.filter((p) => engineOf(p) === g).map((p) => (
          <button key={p.id} className={`model-row ${p.id === sel ? 'on' : ''}`} onClick={() => setSel(p.id)}>
            <Icon name={p.kind === 'mock' ? 'spark' : p.tunnelHost ? 'cpu' : 'list'} size={13} />
            <span className="grow"><span>{p.name}</span>{p.kind !== 'mock' && <span className="muted mono">{!p.apiKey ? 'needs a key' : p.model || 'no model set'}</span>}</span>
            {p.id === settings.activeProvider && <span className="pill on">in use</span>}
          </button>
        ))}</div>)}
        <select className="add-model" value="" onChange={(e) => { const p = presets[Number(e.target.value)]; if (p) add(p); }}>
          <option value="">+ Add a model…</option>
          {presets.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
        </select>
      </div>

      {draft && (
        <div className="model-form">
          <div className="form-title">{draft.name}</div>
          {draft.kind === 'mock' ? (
            <p className="muted">A scripted run for demos. No model, no cost.</p>
          ) : (
            <>
              <Field label="Name"><input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Type">
                <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as Provider['kind'] })}>
                  <option value="openai">OpenAI-compatible</option>
                  <option value="anthropic">Anthropic API</option>
                  <option value="claude-code">Claude Code</option>
                </select>
              </Field>
              {draft.kind === 'openai' && <Field label="Base URL"><input className="mono" value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></Field>}
              <Field label="Model"><input className="mono" value={draft.model} placeholder="model id" onChange={(e) => set({ model: e.target.value })} /></Field>
              <Field label="API key" hint="Saved on this computer only.">
                <input className="mono" type="password" value={draft.apiKey} placeholder="paste key" onChange={(e) => set({ apiKey: e.target.value })} />
              </Field>
              {draft.kind === 'openai' && (
                <details className="advanced" open={Boolean(draft.tunnelHost || draft.gpuHourly)}>
                  <summary>Your own GPU</summary>
                  <Field label="SSH host"><input className="mono" value={draft.tunnelHost ?? ''} placeholder="agent-gpu" onChange={(e) => set({ tunnelHost: e.target.value || undefined })} /></Field>
                  <Field label="Brev instance" hint="Adds Start / Stop GPU."><input className="mono" value={draft.brevInstance ?? ''} placeholder="agent-gpu" onChange={(e) => set({ brevInstance: e.target.value || undefined })} /></Field>
                  <Field label="Machine types">
                    <input className="mono" value={draft.gpuTypes ?? ''} placeholder="massedcompute_L40S,hyperstack_L40,…" onChange={(e) => set({ gpuTypes: e.target.value || undefined })} />
                  </Field>
                  <Field label="Auto-stop (idle minutes)">
                    <input type="number" min={0} value={draft.autoStopMin ?? 20} onChange={(e) => set({ autoStopMin: Number(e.target.value) })} />
                  </Field>
                  <Field label="Price ($/hour)"><input type="number" step="0.01" value={draft.gpuHourly ?? ''} onChange={(e) => set({ gpuHourly: e.target.value ? Number(e.target.value) : undefined })} /></Field>
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
            {draft.kind !== 'mock' && <button className="btn ghost" onClick={runTest}>Test</button>}
            {draft.kind !== 'mock' && settings.activeProvider !== draft.id && <button className="btn ghost" onClick={() => commit()}>Save</button>}
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
  const spendOf = (b: any) => (b.apiCost ?? 0) + b.gpuCost;
  const totalSpend = rows.reduce((a, [, b]) => a + spendOf(b), 0);
  const $ = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);
  return (
    <div>
      <div className="stat-cards">
        <div className="stat"><div className="muted">Spend (estimate)</div><div className="big">{$(totalSpend)}</div></div>
        <div className="stat"><div className="muted">Tokens</div><div className="big">{fmtTokens(totalTokens)}</div></div>
        <div className="stat"><div className="muted">Threads</div><div className="big">{stats.threads.length}</div></div>
      </div>
      <table className="table">
        <thead><tr><th>Model</th><th>Tokens</th><th>Threads</th><th>Spend</th></tr></thead>
        <tbody>{rows.map(([id, b]) => (
          <tr key={id}><td>{name(id)}</td><td className="mono">{fmtTokens(b.tokens)}</td><td className="mono">{b.threads}</td>
            <td className="mono" title={b.gpuCost ? `GPU ${$(b.gpuCost)} (${b.gpuHours.toFixed(2)} h, since the server started)` : undefined}>{$(spendOf(b))}</td></tr>
        ))}</tbody>
      </table>
      <table className="table">
        <thead><tr><th>Biggest threads</th><th>Tokens</th><th>Spend</th></tr></thead>
        <tbody>{[...stats.threads].sort((a: any, b: any) => b.tokens - a.tokens).slice(0, 8).map((t: any) => (
          <tr key={t.id}><td>{t.title}<div className="muted">{name(t.providerId)}</div></td><td className="mono">{fmtTokens(t.tokens)}</td><td className="mono">{$(t.spend ?? 0)}</td></tr>
        ))}</tbody>
      </table>
      <p className="hint">Claude is priced from list prices (cache hits cost less, so this errs high); Claude Code reports its exact cost. Your GPU is billed per hour.</p>
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
  if (!settings) return null;
  const l = settings.learn;
  const setL = (patch: Partial<typeof l>) => save({ learn: { ...l, ...patch } });
  return (
    <div className="set-rows">
      <Row label="Level"><Seg value={l.level} onChange={(v) => setL({ level: v })} options={[['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']]} /></Row>
      <Row label="Checkpoints"><Seg value={l.frequency} onChange={(v) => setL({ frequency: v })} options={[['light', 'Few'], ['normal', 'Normal'], ['frequent', 'Many']]} /></Row>
      <Row label="Language"><Seg value={l.language} onChange={(v) => setL({ language: v })} options={[['en', 'English'], ['fr', 'Français']]} /></Row>
      <Row label="Step labels" hint={(settings.insights ?? 'auto') === 'on' ? 'One small extra call per step on paid APIs.' : undefined}>
        <Seg value={settings.insights ?? 'auto'} onChange={(v) => save({ insights: v })} options={[['auto', 'Auto'], ['on', 'Always'], ['off', 'Off']]} />
      </Row>
    </div>
  );
}

function Appearance() {
  const [pref, setPref] = useTheme();
  const opts: [ThemePref, string][] = [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']];
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
  if (!settings) return null;
  return (
    <div className="set-rows">
      <Row label="Shell commands" hint={settings.approval === 'safe' ? 'ls, cat, grep, git status… run without asking.' : undefined}>
        <Seg value={settings.approval} onChange={(v) => save({ approval: v })} options={[['always', 'Always ask'], ['safe', 'Skip read-only']]} />
      </Row>
      <Row label="Step limit">
        <input className="num" type="number" min={5} max={200} value={settings.maxSteps} onChange={(e) => save({ maxSteps: Number(e.target.value) || 30 })} />
      </Row>
    </div>
  );
}

function About() {
  return (
    <div className="about">
      <p><b>agent-stage</b>: watch a coding agent work, on a map.</p>
      <p className="muted">Data in <span className="mono">~/.agent-stage</span>. MIT licence; Learn mode adapted from VibeWise (MIT).</p>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
