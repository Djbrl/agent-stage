// One-click GPU for self-hosted models: create a Brev machine, install vLLM, load the model, keep the tunnel up,
// and destroy the machine when you stop or after N idle minutes. Destroying (not pausing) is the cheapest route:
// no storage bill between sessions, and no risk of data stuck on a sold-out GPU (see docs/GPU.md).
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkModel } from './health.ts';
import { toConfig, type Provider } from './store.ts';

export type GpuPhase = 'off' | 'creating' | 'connecting' | 'installing' | 'loading' | 'ready' | 'stopping' | 'error';
export type GpuState = { phase: GpuPhase; name?: string; type?: string; startedAt?: number; readyAt?: number; error?: string; log: string[]; idleStopAt?: number };

const BREV = process.env.BREV_BIN ?? 'brev';
const SSH = process.env.SSH_BIN ?? 'ssh';
const SCP = process.env.SCP_BIN ?? 'scp';
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'serve-vllm.sh');
export const DEFAULT_TYPES = 'massedcompute_L40S,massedcompute_L40,hyperstack_L40,massedcompute_RTX6000Ada,hyperstack_A100_80G';
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15'];

function run(cmd: string, args: string[], opts: { input?: string; timeoutMs?: number; onLine?: (l: string) => void } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const take = (d: Buffer) => { const s = String(d); out += s; s.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => opts.onLine?.(l)); };
    p.stdout.on('data', take); p.stderr.on('data', take);
    const timer = opts.timeoutMs ? setTimeout(() => p.kill(), opts.timeoutMs) : undefined;
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: 1, out: String(e) }); });
    if (opts.input !== undefined) p.stdin.end(opts.input); else p.stdin.end();
  });
}
const POLL_MS = Number(process.env.GPU_POLL_MS ?? 10_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function brevInstances(): Promise<{ name: string; status: string }[]> {
  return new Promise((ok) => execFile(BREV, ['ls', '--json'], { timeout: 20_000 }, (_e, stdout) => {
    try { ok((JSON.parse(stdout).workspaces ?? []).map((w: any) => ({ name: w.name, status: String(w.status ?? '').toUpperCase() }))); } catch { ok([]); }
  }));
}

type GpuHooks = { provider: () => Provider; saveKey: (key: string) => Promise<void>; onReady: () => void; anyRunning: () => boolean };

export class GpuManager {
  state: GpuState = { phase: 'off', log: [] };
  private lastActivity = Date.now();
  private busy = false;
  private hooks: GpuHooks;
  constructor(hooks: GpuHooks) {
    this.hooks = hooks;
    setInterval(() => void this.autoStop(), 30_000);
  }

  touch() { this.lastActivity = Date.now(); }
  private log(line: string) {
    this.state.log = [...this.state.log, `${new Date().toLocaleTimeString([], { hour12: false })}  ${line}`].slice(-40);
  }
  private set(patch: Partial<GpuState>) { this.state = { ...this.state, ...patch }; }

  view() {
    const p = this.hooks.provider();
    const min = p.autoStopMin ?? 20;
    const idleStopAt = ['ready', 'error'].includes(this.state.phase) && min > 0 ? this.lastActivity + min * 60_000 : undefined;
    const cost = this.state.startedAt && p.gpuHourly ? ((Date.now() - this.state.startedAt) / 3_600_000) * p.gpuHourly : 0;
    return { ...this.state, idleStopAt, autoStopMin: min, sessionCost: cost, managed: Boolean(p.brevInstance) };
  }

  // On server boot: adopt a machine that's already running.
  async adopt() {
    const p = this.hooks.provider();
    if (!p.brevInstance) return;
    const w = (await brevInstances()).find((x) => x.name === p.brevInstance);
    if (!w) return;
    const ok = (await checkModel(toConfig(p))).state === 'ok';
    this.set({ phase: ok ? 'ready' : 'loading', name: w.name, startedAt: Date.now(), readyAt: ok ? Date.now() : undefined });
    this.log(`Found ${w.name} already ${w.status.toLowerCase()}${ok ? ', model answering' : ''}.`);
    if (!ok) void this.waitForModel(p).catch((e) => { this.log(`✗ ${e.message}`); this.set({ phase: 'error', error: e.message }); });
  }

  async start() {
    const p = this.hooks.provider();
    if (!p.brevInstance) throw new Error('This model has no Brev instance name set (Settings → Models).');
    if (this.busy || !['off', 'error'].includes(this.state.phase)) return;
    this.busy = true;
    const name = p.brevInstance;
    this.state = { phase: 'creating', name, startedAt: Date.now(), log: [] };
    this.touch();
    try {
      // 1. Create (or reuse) the machine. --type tries each type in order until one has capacity.
      const existing = (await brevInstances()).find((x) => x.name === name);
      if (existing) this.log(`Reusing ${name} (${existing.status.toLowerCase()}).`);
      else {
        const types = (p.gpuTypes || DEFAULT_TYPES).split(',').map((t) => t.trim()).filter(Boolean);
        this.log(`Creating ${name}: trying ${types.join(', ')}…`);
        const r = await run(BREV, ['create', name, '--type', types.join(','), '--jupyter=false', '--timeout', '900'],
          { timeoutMs: 20 * 60_000, onLine: (l) => { if (/Success|Trying|Ready|fail|error/i.test(l)) this.log(l.replace(/^\[Worker \d+\]\s*/, '')); const m = l.match(/Trying (\S+)/); if (m) this.set({ type: m[1] }); } });
        if (r.code !== 0 || !(await brevInstances()).some((x) => x.name === name)) throw new Error(`brev create failed: ${r.out.trim().split('\n').at(-1)}`);
      }
      if (this.state.phase === 'stopping') return;

      // 2. SSH in (Brev writes the host into ~/.ssh/config on refresh).
      this.set({ phase: 'connecting' });
      await run(BREV, ['refresh'], { timeoutMs: 60_000 });
      let connected = false;
      for (let i = 0; i < 30 && !connected; i++) {
        connected = (await run(SSH, [...SSH_OPTS, name, 'true'], { timeoutMs: 30_000 })).code === 0;
        if (!connected) { if (i % 3 === 0) this.log('Waiting for SSH…'); await sleep(10_000); }
        if ((this.state.phase as GpuPhase) === 'stopping') return; // stop() can change it while we wait
      }
      if (!connected) throw new Error('Could not reach the machine over SSH.');
      this.log('Connected.');

      // 3. Install vLLM and start the model. Reuse the saved key so existing settings keep working.
      this.set({ phase: 'installing' });
      let key = p.apiKey;
      if (!key || key === 'mock') { key = randomBytes(24).toString('hex'); await this.hooks.saveKey(key); }
      await run(SSH, [...SSH_OPTS, name, 'umask 077; cat > ~/.vllm-key'], { input: key, timeoutMs: 30_000 });
      const cp = await run(SCP, [...SSH_OPTS, SCRIPT, `${name}:~/serve-vllm.sh`], { timeoutMs: 60_000 });
      if (cp.code !== 0) throw new Error(`Could not upload the setup script: ${cp.out.trim()}`);
      this.log('Installing vLLM (about a minute)…');
      const parser = /qwen/i.test(p.model) ? 'qwen3_coder' : 'hermes';
      const inst = await run(SSH, [...SSH_OPTS, name, `MODEL='${p.model}' PARSER=${parser} bash ~/serve-vllm.sh > ~/setup.log 2>&1; tail -3 ~/setup.log`], { timeoutMs: 15 * 60_000 });
      if (inst.code !== 0) throw new Error(`Setup failed: ${inst.out.trim().split('\n').at(-1)}`);
      this.hooks.onReady(); // (re)open the tunnel now that the port exists

      // 4. Wait for the model to load and answer.
      this.set({ phase: 'loading' });
      this.log(`Downloading and loading ${p.model.split('/').pop()} (5–10 min the first time)…`);
      await this.waitForModel(p);
    } catch (e: any) {
      this.log(`✗ ${e.message}`);
      this.set({ phase: 'error', error: e.message });
    } finally {
      this.busy = false;
    }
  }

  private async waitForModel(p: Provider) {
    for (let i = 0; i < 120; i++) {
      if (this.state.phase === 'stopping' || this.state.phase === 'off') return;
      // Re-read the provider: setup may have just generated and saved a new key.
      if ((await checkModel(toConfig(this.hooks.provider()))).state === 'ok') {
        this.set({ phase: 'ready', readyAt: Date.now(), error: undefined });
        this.log(`Ready in ${Math.round((Date.now() - (this.state.startedAt ?? Date.now())) / 60_000)} min.`);
        this.touch();
        return;
      }
      if (i % 6 === 5) {
        const tail = await run(SSH, [...SSH_OPTS, p.brevInstance!, "grep -m1 -E 'Engine core initialization failed|Error' ~/vllm.log || tail -1 ~/vllm.log"], { timeoutMs: 30_000 });
        const line = tail.out.trim().split('\n').at(-1) ?? '';
        if (/initialization failed/i.test(line)) throw new Error('vLLM failed to start: see ~/vllm.log on the machine.');
        if (line) this.log(line.slice(0, 120));
      }
      await sleep(POLL_MS);
    }
    throw new Error('The model did not come up within 20 minutes.');
  }

  async stop(reason = 'Stopped') {
    const name = this.hooks.provider().brevInstance ?? this.state.name;
    if (!name || this.state.phase === 'stopping') return;
    this.set({ phase: 'stopping' });
    this.log(`${reason}: destroying ${name}…`);
    const r = await run(BREV, ['delete', name], { timeoutMs: 120_000 });
    for (let i = 0; i < 12; i++) {
      if (!(await brevInstances()).some((x) => x.name === name)) {
        const mins = this.state.startedAt ? Math.round((Date.now() - this.state.startedAt) / 60_000) : 0;
        this.log(`Destroyed after ${mins} min. Nothing is billing now.`);
        this.set({ phase: 'off', readyAt: undefined, startedAt: undefined, error: undefined });
        return;
      }
      await sleep(5_000);
    }
    this.log(`✗ Delete may not have finished: ${r.out.trim().split('\n').at(-1)}. Check \`brev ls\`.`);
    this.set({ phase: 'error', error: 'Delete not confirmed: check brev ls' });
  }

  private async autoStop() {
    const p = this.hooks.provider();
    const min = p.autoStopMin ?? 20;
    if (!p.brevInstance || min <= 0 || !['ready', 'error', 'loading'].includes(this.state.phase)) return;
    if (this.hooks.anyRunning()) { this.touch(); return; }
    if (Date.now() - this.lastActivity > min * 60_000) await this.stop(`Idle for ${min} min`);
  }
}
