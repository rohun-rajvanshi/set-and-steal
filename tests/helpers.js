// Shared helpers for the browser tests: start the real server on a free port with a throwaway
// built-in database, open pages, start games and set up exact card situations.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

/** Which build the tests run against: TARGET=worker for the Cloudflare Worker, otherwise the Node server. */
export const TARGET = process.env.TARGET === 'worker' ? 'worker' : 'node';

/**
 * Start the app with its own temporary storage. Returns { url, stop }.
 * Node: server.js with a throwaway built-in database. Worker: `wrangler dev` with throwaway local storage.
 */
export async function startServer() {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'set-and-steal-test-'));
  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, WRANGLER_SEND_METRICS: 'false', CI: '1' };
  delete env.DATABASE_URL; delete env.PGHOST;
  const [cmd, args, ready] = TARGET === 'worker'
    ? [path.join(ROOT, 'node_modules', '.bin', 'wrangler'), ['dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', dataDir, '--show-interactive-dev-session=false'], /Ready on/i]
    : [process.execPath, ['server.js'], /running on/i];
  const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Server did not start:\n' + out)), 60000);
    const onData = (d) => { out += d; if (ready.test(out)) { clearTimeout(t); setTimeout(resolve, TARGET === 'worker' ? 500 : 0); } };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(t); reject(new Error('Server exited (' + code + '):\n' + out)); });
  });
  return {
    url: 'http://localhost:' + port + '/',
    async stop() { child.kill(); await new Promise((r) => setTimeout(r, 150)); rmSync(dataDir, { recursive: true, force: true }); },
  };
}

/** Open a page that records script errors in page.errors. */
export async function openPage(browser, url, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...options });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(url);
  return page;
}

/** Read a value from the game state: state(page, 'g.plays'). */
export const state = (page, expr) => page.evaluate('(() => { const g = window.__deal.game; return ' + expr + '; })()');

/** Start a same-device game and show the first player's hand. */
export async function startLocalGame(page, names = ['Asha', 'Ben']) {
  if (names.length !== 2) await page.click('.count-btn[data-count="' + names.length + '"]');
  for (let i = 0; i < names.length; i++) await page.fill('#nameFields label:nth-child(' + (i + 1) + ') input', names[i]);
  await page.click('#startBtn');
  await reveal(page);
}

/** Dismiss the pass-the-device curtain if it is showing. */
export async function reveal(page) {
  if (await page.isVisible('#curtain [data-do="reveal"]')) await page.click('#curtain [data-do="reveal"]');
}

/**
 * Replace parts of the game state. `body` is JavaScript run in the page with:
 *   D (debug hook), g (game), A/B/C (players), mk({...}) to make a card.
 * Example: rig(page, "A.hand = [mk({type:'money', value:5})]")
 */
export async function rig(page, body, { commit = false } = {}) {
  await page.evaluate(({ body, commit }) => {
    const D = window.__deal, g = D.game;
    const mk = (o) => ({ id: 'x' + Math.random().toString(36).slice(2, 9), ...o });
    const [A, B, C] = g.players;
    new Function('D', 'g', 'mk', 'A', 'B', 'C', body)(D, g, mk, A, B, C);
    D.render(); if (commit) D.commit();
  }, { body, commit });
}

/** Click a card in the hand by its id, or the first card matching a game-state predicate. */
export async function clickHand(page, id) { await page.click('#hand [data-act="hand"][data-id="' + id + '"]'); }
export async function clickDo(page, action) { await page.click('[data-do="' + action + '"]'); }
/** Click a property card on the table near its top edge (cards in a stack overlap). */
export async function clickTableCard(page, owner, id) {
  await page.click('[data-act="tcard"][data-owner="' + owner + '"][data-id="' + id + '"]', { position: { x: 20, y: 8 } });
}
export const promptText = (page) => page.locator('#prompt').innerText();

/** Wait until fn() returns truthy (polling), or fail with a message. */
export async function until(fn, message = 'condition', timeout = 8000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('Timed out waiting for ' + message + ' (last value: ' + JSON.stringify(last) + ')');
}

/** Text that shouldn't appear anywhere in the app. */
export const BANNED_TEXT = [/—/, /–/, /monopoly/i, /hasbro/i, /\b\d+M\b/, /Sly Deal|Forced Deal|Deal Breaker|Just Say No|Pass Go|Debt Collector|It's My Birthday|Railroad|Utility/];
