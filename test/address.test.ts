// The online demo's internet proxy: public websites yes, this computer and the home network no.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivate, publicAddress } from '../src/public/address.ts';

const PRIVATE = [
  '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254', // cloud metadata
  '0.0.0.0', '100.64.0.1', '100.127.255.255', '192.0.0.8', '198.18.0.1', '224.0.0.1', '255.255.255.255',
  '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'FE80::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1',
  '::127.0.0.1', '64:ff9b::7f00:1', 'fec0::1', // old IPv4-compatible form, NAT64, old site-local
];
const PUBLIC = ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8'];

test('private, loopback and link-local addresses are refused', () => {
  for (const ip of PRIVATE) assert.equal(isPrivate(ip), true, ip);
});

test('public addresses are allowed', () => {
  for (const ip of PUBLIC) assert.equal(isPrivate(ip), false, ip);
});

test('IPv6 written the long way is still caught', () => {
  for (const ip of ['0:0:0:0:0:0:0:1', '0::1', '::0:1', '0:0:0:0:0:0:0:0', 'fe80:0:0:0:0:0:0:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:7f00:1'])
    assert.equal(isPrivate(ip), true, ip);
});

test('anything that is not an address is refused', () => {
  for (const ip of ['', 'localhost', '127.1', '0177.0.0.1', 'not-an-ip']) assert.equal(isPrivate(ip), true, ip);
});

test('a name is resolved once, and refused if it points inside', async () => {
  const dns = (map: Record<string, string>) => async (h: string) => ({ address: map[h] });
  assert.equal(await publicAddress('example.com', dns({ 'example.com': '93.184.216.34' })), '93.184.216.34');
  await assert.rejects(publicAddress('evil.example', dns({ 'evil.example': '127.0.0.1' })), /private/);
  await assert.rejects(publicAddress('router.example', dns({ 'router.example': '192.168.1.1' })), /private/);
});

test('bracketed IPv6 literals from CONNECT are checked without a lookup', async () => {
  const noLookup = async () => { throw new Error('should not resolve a literal'); };
  await assert.rejects(publicAddress('[::1]', noLookup), /private/);
  await assert.rejects(publicAddress('[0:0:0:0:0:0:0:1]', noLookup), /private/);
  assert.equal(await publicAddress('[2606:4700::1111]', noLookup), '2606:4700::1111');
});
