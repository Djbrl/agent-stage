// Optional SSH tunnel to a remote GPU (e.g. Brev). When TUNNEL_HOST is set, the server keeps
// `ssh -N -L <port>:localhost:<port> <host>` alive and restarts it if it drops.
import { spawn, type ChildProcess } from 'node:child_process';

export type TunnelState = { enabled: boolean; host?: string; up: boolean; restarts: number; lastError?: string };

export function startTunnel(host: string | undefined, port: number): () => TunnelState {
  const state: TunnelState = { enabled: Boolean(host), host, up: false, restarts: 0 };
  if (!host) return () => state;

  let proc: ChildProcess | null = null;
  const open = () => {
    proc = spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
      '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-L', `${port}:localhost:${port}`, host], { stdio: ['ignore', 'ignore', 'pipe'] });
    // ssh -N prints nothing on success: call it up once it has survived past its connect timeout.
    const alive = setTimeout(() => { state.up = true; state.lastError = undefined; }, 12_000);
    proc.stderr?.on('data', (d) => { state.lastError = String(d).trim().split('\n').at(-1); });
    proc.on('exit', () => {
      clearTimeout(alive);
      state.up = false;
      state.restarts++;
      setTimeout(open, Math.min(30_000, 2000 * state.restarts)); // back off while the GPU is down
    });
  };
  open();
  const close = () => proc?.kill();
  process.on('exit', close);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { close(); process.exit(0); });
  return () => state;
}
