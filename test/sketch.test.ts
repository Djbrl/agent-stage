// Scratchpad sketches: only real PNGs are saved, and a request can only attach sketches that exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENT_STAGE_HOME = await mkdtemp(join(tmpdir(), 'agst-sketch-'));
const { saveSketch, sketchesFrom, isSketch, loadSketch, MAX_SKETCHES } = await import('../src/sketch.ts');

// A 1×1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a PNG is saved under a sketch name and reads back', async () => {
  const name = await saveSketch(PNG);
  assert.ok(isSketch(name), name);
  assert.equal(await loadSketch(name), PNG.split(',')[1]);
});

test('anything that is not a PNG is refused', async () => {
  await assert.rejects(saveSketch('data:image/jpeg;base64,/9j/4AAQ'), /PNG/);
  await assert.rejects(saveSketch('data:image/png;base64,' + Buffer.from('not a png').toString('base64')), /PNG/);
  await assert.rejects(saveSketch(42), /PNG/);
});

test('only existing sketches can be attached, and only a few', async () => {
  const names = await Promise.all(Array.from({ length: MAX_SKETCHES + 2 }, () => saveSketch(PNG)));
  const ok = await sketchesFrom([...names, '../settings.json', 'sketch-00000000-0000-0000-0000-000000000000.png', 7]);
  assert.deepEqual(ok, names.slice(0, MAX_SKETCHES));
  assert.deepEqual(await sketchesFrom('nope'), []);
});
