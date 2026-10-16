// Optional SSH tunnel to a remote GPU (e.g. Brev): keeps `ssh -N -L <port>:localhost:8000 <host>`
// alive and restarts it if it drops. One at a time, following the active model provider.
import { spawn, type ChildProcess } from 'node:child_process';

// vLLM always listens on 8000 on the GPU; the local end follows the provider's URL (18000 by default, because
// 8000 is a popular port on dev machines and a clash silently sends model calls to the wrong server).
const REMOTE = 8000;

export type TunnelState = { enabled: boolean; host?: string; up: boolean; restarts: number; lastError?: string };

export function startTunnel(host: string | undefined, port: number) {
  const state: TunnelState = { enabled: Boolean(host), host, up: false, restarts: 0 };
  let proc: ChildProcess | null = null, stopped = false, retry: NodeJS.Timeout | undefined;
  const open = () => {
    if (stopped || !host) return;
    proc = spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
      '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-L', `${port}:localhost:${REMOTE}`, host], { stdio: ['ignore', 'ignore', 'pipe'] });
    // ssh -N prints nothing on success: call it up once it has survived past its connect timeout.
    const alive = setTimeout(() => { state.up = true; state.lastError = undefined; }, 12_000);
    proc.stderr?.on('data', (d) => { state.lastError = String(d).trim().split('\n').at(-1); });
    proc.on('exit', () => {
      clearTimeout(alive);
      state.up = false;
      if (stopped) return;
      state.restarts++;
      retry = setTimeout(open, Math.min(30_000, 2000 * state.restarts)); // back off while the GPU is down
    });
  };
  open();
  return {
    state: () => state,
    stop: () => { stopped = true; clearTimeout(retry); proc?.kill(); },
  };
}
