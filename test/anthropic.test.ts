// Claude's thinking blocks: dropped after a shortened tool output, and a rejected signature is retried without them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Message } from '../src/model.ts';

const seen: any[] = [];
let reject = false; // answer the next request with the API's signature error
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const json = JSON.parse(body);
    seen.push(json);
    const thinking = json.messages.some((m: any) => m.role === 'assistant' && m.content.some((b: any) => b.type === 'thinking'));
    if (reject && thinking) {
      reject = false;
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'messages.3.content.0: Invalid `signature` in `thinking` block.' } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'm', stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise<void>((ok) => server.listen(0, ok));
process.env.ANTHROPIC_TEST_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const { chatAnthropic } = await import('../src/anthropic.ts');
const cfg = { baseUrl: '', apiKey: 'test-key', model: 'm', kind: 'anthropic' as const };

const think = (id: string): Message => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: '{}' } }],
  raw: [{ type: 'thinking', thinking: 'hmm', signature: 'sig' }, { type: 'tool_use', id, name: 'read_file', input: {} }] });
const loop = (first: string): Message[] => [
  { role: 'system', content: 'sys' }, { role: 'user', content: 'task' },
  think('a'), { role: 'tool', tool_call_id: 'a', content: first },
  think('b'), { role: 'tool', tool_call_id: 'b', content: 'second' },
];
const thinkingAt = (req: any) => req.messages.map((m: any) => m.role === 'assistant' && m.content.some((b: any) => b.type === 'thinking'));

test('the turn in progress keeps its thinking', async () => {
  seen.length = 0;
  await chatAnthropic(cfg, loop('first'), []);
  assert.deepEqual(thinkingAt(seen[0]), [false, true, false, true, false]);
});

test('thinking after a shortened tool output is dropped', async () => {
  seen.length = 0;
  await chatAnthropic(cfg, loop('[older output trimmed to save context (9000 chars); re-read the file]\nabc'), []);
  assert.deepEqual(thinkingAt(seen[0]), [false, true, false, false, false]); // only the thinking made before it stays
});

test('a rejected signature is sent again without thinking', async () => {
  seen.length = 0; reject = true;
  const r = await chatAnthropic(cfg, loop('first'), []);
  assert.equal(r.content, 'ok');
  assert.equal(seen.length, 2);
  assert.deepEqual(thinkingAt(seen[1]), [false, false, false, false, false]);
  server.close();
});
