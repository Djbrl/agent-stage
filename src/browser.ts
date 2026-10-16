// Computer use, text-first so open models can drive it too: a real browser (the Chrome already installed on
// this computer, through playwright-core) read as text with numbered controls, plus "open this on my Mac".
// Every browser action saves a screenshot for the stage. Local pages are free; other sites ask first.
import { chromium, type Browser, type Page } from 'playwright-core';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './store.ts';
import type { ToolContext } from './tools.ts';

export const SHOTS = join(DATA_DIR, 'shots');
let browser: Promise<Browser> | null = null;
const pages = new Map<string, Page>(); // one tab per project folder
const allowed = new Set<string>(); // origins the user already approved this session

const PUBLIC = process.env.PUBLIC === '1';
// In the demo container there is no Google Chrome: use the Chromium it ships (CHROME_PATH).
const launch = () => (browser ??= chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : { channel: 'chrome' }),
  headless: process.env.BROWSER_HEADED !== '1' })
  .catch((e) => { browser = null; throw new Error(`Couldn't start Chrome (${String(e.message).split('\n')[0]}). Is Google Chrome installed?`); }));

async function page(ctx: ToolContext) {
  let p = pages.get(ctx.root);
  if (!p || p.isClosed()) {
    p = await (await (await launch()).newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    pages.set(ctx.root, p);
  }
  return p;
}

const local = (u: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.hostname.endsWith('.localhost') || u.protocol === 'file:';

async function shot(p: Page) {
  await mkdir(SHOTS, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`;
  await p.screenshot({ path: join(SHOTS, name) }).catch(() => {});
  return `[screenshot: /api/shots/${name}]`;
}

// The page as the model sees it: title, address, readable text, and numbered controls it can click or type into.
async function describe(p: Page) {
  const { text, controls } = await p.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    document.querySelectorAll('[data-agst]').forEach((el) => el.removeAttribute('data-agst'));
    const els = [...document.querySelectorAll('a[href], button, input, textarea, select, [role=button], [role=link], [contenteditable=true]')].filter(vis).slice(0, 120);
    const controls = els.map((el, i) => {
      el.setAttribute('data-agst', String(i + 1));
      const tag = el.tagName.toLowerCase(), type = (el as HTMLInputElement).type;
      const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || (el as HTMLInputElement).placeholder || (el as HTMLInputElement).value || el.getAttribute('title') || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      const kind = tag === 'a' ? 'link' : tag === 'input' ? `input${type && type !== 'text' ? `:${type}` : ''}` : tag;
      return `[${i + 1}] ${kind} "${name}"`;
    });
    return { text: (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').slice(0, 6000), controls };
  });
  return `${await p.title()} — ${p.url()}\n\n${text}\n\nControls:\n${controls.join('\n') || '(none)'}`;
}

export const browserSchemas = [
  fn('browser_open', 'Open a web page in the browser (e.g. the app you are building on http://localhost:5173). Returns the page as text with numbered controls.', { url: { type: 'string' } }, ['url']),
  fn('browser_read', 'Read the current page again: text and numbered controls.', {}),
  fn('browser_click', 'Click a control by its number from the last page reading.', { n: { type: 'number' } }, ['n']),
  fn('browser_type', 'Type into a control by its number. Set submit to press Enter afterwards.', { n: { type: 'number' }, text: { type: 'string' }, submit: { type: 'boolean' } }, ['n', 'text']),
  fn('open_on_computer', "Open a file from the project, a folder, or a URL on the user's computer with its default app (needs approval).", { target: { type: 'string' } }, ['target']),
];
export const BROWSER_TOOLS = new Set(browserSchemas.map((s) => s.function.name));
export const READ_ONLY_BROWSER = ['browser_read'];

export async function runBrowserTool(ctx: ToolContext, name: string, args: any): Promise<string> {
  if (name === 'open_on_computer') {
    if (PUBLIC) return 'not available in the online demo';
    const target = String(args.target ?? '');
    const full = /^[a-z]+:\/\//i.test(target) ? target : join(ctx.root, target);
    if (!(await ctx.approve(`open ${full}`))) return 'user declined';
    return new Promise((ok) => execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [full], (err) => ok(err ? `couldn't open: ${err.message}` : `opened ${target}`)));
  }
  const p = await page(ctx);
  const settle = () => p.waitForLoadState('domcontentloaded', { timeout: 8000 }).then(() => p.waitForTimeout(400)).catch(() => {});
  switch (name) {
    case 'browser_open': {
      let u: URL;
      try { u = new URL(/^[a-z]+:/i.test(args.url) ? args.url : `http://${args.url}`); } catch { return `not a valid address: ${args.url}`; }
      if (!local(u) && PUBLIC) return 'the online demo can only open pages served inside it (localhost)';
      if (!local(u) && !allowed.has(u.origin)) {
        if (!(await ctx.approve(`browse ${u.origin}`))) return 'user declined to open this site';
        allowed.add(u.origin);
      }
      const r = await p.goto(u.href, { timeout: 20_000, waitUntil: 'domcontentloaded' }).catch((e) => e as Error);
      if (r instanceof Error) return `couldn't load ${u.href}: ${r.message.split('\n')[0]}`;
      await settle();
      return `${await shot(p)}\n${r && !r.ok() ? `HTTP ${r.status()}\n` : ''}${await describe(p)}`;
    }
    case 'browser_read':
      return `${await shot(p)}\n${await describe(p)}`;
    case 'browser_click': {
      const el = p.locator(`[data-agst="${Number(args.n)}"]`);
      if (!(await el.count())) return `no control [${args.n}]: read the page again`;
      await el.click({ timeout: 5000 }).catch((e) => { throw new Error(`click failed: ${e.message.split('\n')[0]}`); });
      await settle();
      // A click that leaves for another site is still a navigation: same rule as browser_open.
      const u = new URL(p.url());
      if (u.protocol.startsWith('http') && !local(u) && PUBLIC) { await p.goBack().catch(() => {}); return 'the online demo can only open local pages; went back'; }
      if (u.protocol.startsWith('http') && !local(u) && !allowed.has(u.origin)) {
        if (!(await ctx.approve(`browse ${u.origin}`))) { await p.goBack().catch(() => {}); return 'user declined to open that site; went back'; }
        allowed.add(u.origin);
      }
      return `${await shot(p)}\n${await describe(p)}`;
    }
    case 'browser_type': {
      const el = p.locator(`[data-agst="${Number(args.n)}"]`);
      if (!(await el.count())) return `no control [${args.n}]: read the page again`;
      await el.fill(String(args.text ?? ''), { timeout: 5000 });
      if (args.submit) { await el.press('Enter'); await settle(); }
      return `${await shot(p)}\n${await describe(p)}`;
    }
  }
  throw new Error(`unknown tool ${name}`);
}

export async function closeBrowser() { if (browser) await (await browser.catch(() => null))?.close().catch(() => {}); }

function fn(name: string, description: string, properties: object, required: string[] = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}
