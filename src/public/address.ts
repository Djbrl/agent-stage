// Which addresses the sandboxes' internet proxy may reach: public ones only. Kept apart from relay.ts so it can be
// tested without starting the relay's servers.
import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

// This computer, the home network, the other containers, carrier NAT, multicast, and the IPv6 equivalents.
// A BlockList compares addresses, not text, so '0:0:0:0:0:0:0:1' is caught like '::1'.
const PRIVATE = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['100.64.0.0', 10], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) PRIVATE.addSubnet(net, bits, 'ipv4');
// IPv4 written as IPv6 (::ffff:127.0.0.1) is checked against the IPv4 rules by BlockList itself.
for (const [net, bits] of [['::', 96], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10]] as const) PRIVATE.addSubnet(net, bits, 'ipv6');

export const isPrivate = (ip: string) => {
  const family = isIP(ip);
  return family === 0 || PRIVATE.check(ip, family === 6 ? 'ipv6' : 'ipv4'); // not an address: refuse
};

// The address to connect to. The name is resolved here, once, so a DNS trick can't swap in a private address later.
export async function publicAddress(host: string, lookup: (h: string) => Promise<{ address: string }> = dnsLookup) {
  const h = host.replace(/^\[|\]$/g, '');
  const ip = isIP(h) ? h : (await lookup(h)).address;
  if (isPrivate(ip)) throw new Error('private address');
  return ip;
}
