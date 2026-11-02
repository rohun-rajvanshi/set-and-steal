// Screen layout on a phone (portrait and landscape) and a desktop:
// the table stays usable, nothing scrolls sideways, and the chat is never hidden behind the top bar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startServer, openPage, startLocalGame, rig, until, BANNED_TEXT } from './helpers.js';

const SCREENS = {
  'phone portrait': { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'phone landscape': { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'small phone landscape': { viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1280, height: 800 } },
};

let server, browser;
before(async () => { server = await startServer(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

const box = (page, sel) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });

for (const [name, options] of Object.entries(SCREENS)) {
  test(name + ': the table, prompt and hand all fit and work', async () => {
    const page = await openPage(browser, server.url, options);
    const vw = options.viewport.width, vh = options.viewport.height;
    await startLocalGame(page);
    await rig(page, "A.hand = Array.from({length: 7}, (_, i) => mk({id:'h' + i, type:'money', value: (i % 5) + 1})); g.plays = 3;");

    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling');

    const dock = await box(page, '#dock');
    const covered = (Math.min(dock.bottom, vh) - Math.max(dock.top, 0)) * (Math.min(dock.right, vw) - Math.max(dock.left, 0));
    assert.ok(covered / (vw * vh) <= 0.5, 'prompt and hand cover ' + Math.round(100 * covered / (vw * vh)) + '% of the screen');

    const prompt = await box(page, '#prompt');
    assert.ok(prompt.top >= 0 && prompt.bottom <= vh + 1 && prompt.left >= -1 && prompt.right <= vw + 1, 'prompt fully on screen');

    for (const id of ['h0', 'h6']) {
      const card = page.locator('#hand [data-id="' + id + '"]');
      await card.scrollIntoViewIfNeeded(); await card.click();
      assert.equal(await page.evaluate(() => window.__deal.ui.selected), id, 'can select hand card ' + id);
      await page.click('[data-do="deselect"]');
    }

    // The player's own table must be reachable and not permanently hidden under the dock.
    await page.locator('#mine').scrollIntoViewIfNeeded();
    const mine = await box(page, '#mine .seat-head');
    const hidden = mine.bottom > dock.top && mine.top < dock.bottom && mine.right > dock.left && mine.left < dock.right;
    assert.ok(!hidden, 'your table header is visible, not under the hand');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test(name + ': chat opens fully visible, above the top bar', async () => {
    const page = await openPage(browser, server.url, options);
    const vw = options.viewport.width, vh = options.viewport.height;
    await page.click('[data-tab="online"]'); await page.fill('#roomName', 'Asha'); await page.click('#createRoomBtn');
    await page.waitForSelector('#chatBtn:not([hidden])');
    // Simulate a notch / installed app: the top bar grows taller than usual.
    await page.evaluate(() => { document.querySelector('.topbar').style.paddingTop = '60px'; window.dispatchEvent(new Event('resize')); });
    await page.click('#chatBtn');
    await page.waitForTimeout(400);
    const panel = await box(page, '#chatPanel');
    assert.ok(panel.top >= 0 && panel.bottom <= vh + 1 && panel.left >= -1 && panel.right <= vw + 1, 'chat panel inside the screen');
    for (const sel of ['.chat-head', '#chatInput', '#chatClose']) {
      const r = await box(page, sel);
      const onTop = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('#chatPanel'), [r.left + r.width / 2, r.top + r.height / 2]);
      assert.ok(onTop, sel + ' is not covered by anything');
    }
    await page.click('#chatClose');
    await until(async () => !(await page.locator('#chatPanel').evaluate((el) => el.classList.contains('open'))), 'chat closes');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

test('home screen and rules use clean wording', async () => {
  const page = await openPage(browser, server.url);
  const home = await page.locator('body').innerText();
  for (const re of BANNED_TEXT) assert.doesNotMatch(home, re, 'home screen contains ' + re);
  assert.match(home, /Set & Steal/);
  await page.context().close();
});
