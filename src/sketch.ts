// Scratchpad sketches: a PNG drawn (or a screenshot marked up) in the browser, sent with a question or a task.
// Saved next to the browser screenshots, so /api/shots serves them; models get them as images.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { SHOTS } from './browser.ts';

const MAX_BYTES = 6 * 1024 * 1024;
export const MAX_SKETCHES = 4;
export const isSketch = (name: unknown): name is string => typeof name === 'string' && /^sketch-[0-9a-f-]{36}\.png$/.test(name);

export async function saveSketch(dataUrl: unknown): Promise<string> {
  const m = typeof dataUrl === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!m) throw new Error('A sketch must be a PNG image.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new Error('This sketch is too big (6 MB at most).');
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('A sketch must be a PNG image.');
  await mkdir(SHOTS, { recursive: true });
  const name = `sketch-${randomUUID()}.png`;
  await writeFile(join(SHOTS, name), buf);
  return name;
}

// The sketches a request may attach: known names that exist, at most a few.
export async function sketchesFrom(list: unknown): Promise<string[]> {
  if (!Array.isArray(list)) return [];
  const names = list.filter(isSketch).slice(0, MAX_SKETCHES);
  const ok = await Promise.all(names.map((n) => stat(join(SHOTS, n)).then(() => true, () => false)));
  return names.filter((_, i) => ok[i]);
}

export const loadSketch = (name: string) => readFile(join(SHOTS, name)).then((b) => b.toString('base64'));
