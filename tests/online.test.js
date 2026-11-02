// Two players in an online room on separate "devices": steals with Nope! chains, payments, auto end-turn and chat.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startServer, openPage, state, rig, clickHand, clickDo, clickTableCard, promptText, until, TARGET } from './helpers.js';

let server, browser, asha, ben;
before(async () => {
  server = await startServer(); browser = await chromium.launch();
  asha = await openPage(browser, server.url);
  ben = await openPage(browser, server.url, { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true });
});
after(async () => { await browser?.close(); await server?.stop(); });

test('create a room, join it and start the game', async () => {
  await asha.click('[data-tab="online"]'); await asha.fill('#roomName', 'Asha'); await asha.click('#createRoomBtn');
  const code = (await until(async () => { const t = (await asha.locator('#roomCode').innerText()).trim(); return /^[A-Z0-9]{6}$/.test(t) && t; }, 'room code'));
  await ben.click('[data-tab="online"]'); await ben.fill('#roomName', 'Ben'); await ben.fill('#roomCodeIn', code); await ben.click('#joinRoomBtn');
  await until(async () => /2 players/.test(await asha.locator('#lobbyStatus').innerText()), 'Ben in the lobby');
  await asha.click('#startRoomBtn');
  await ben.waitForSelector('#game:not([hidden])', { timeout: 8000 });
  assert.equal(await state(ben, 'g.players.length'), 2);
});

test('both players have a live connection on Cloudflare (polling elsewhere)', async () => {
  const live = async (page) => page.evaluate(() => window.__deal.live());
  if (TARGET === 'worker') {
    await until(async () => (await live(asha)) && (await live(ben)), 'live connections');
    // With a live connection the game stops asking every second; that's what keeps the free plan free.
    let calls = 0; const count = (r) => { if (/\/api\/(rooms|chat)\?/.test(r.url())) calls++; };
    asha.on('request', count); await asha.waitForTimeout(6000); asha.off('request', count);
    assert.ok(calls <= 2, calls + ' polling requests in 6 seconds');
  }
  else { await asha.waitForTimeout(3500); assert.equal(await live(asha), false, 'the Node server has no live endpoint, so the game polls'); }
});

test('a Steal is blocked with Nope!, countered, and goes through', async () => {
  await rig(asha, `
    A.hand = [mk({id:'st', type:'action', effect:'sly', value:3}), mk({id:'an', type:'action', effect:'no', value:4}), mk({id:'hw', type:'action', effect:'birthday', value:2}), mk({id:'a2', type:'money', value:2})];
    A.props = []; A.bank = [];
    B.props = [mk({id:'or', type:'property', color:'orange', value:2})];
    B.hand = [mk({id:'bn', type:'action', effect:'no', value:4}), mk({id:'m1', type:'money', value:1})];
    B.bank = [mk({id:'b3', type:'money', value:3})];
    g.plays = 3; g.current = 0;`, { commit: true });
  const b = await state(asha, 'g.players[1].id');
  await clickHand(asha, 'st'); await clickDo(asha, 'play'); await clickTableCard(asha, b, 'or'); await clickDo(asha, 'confirm');
  await until(async () => /Nope/.test(await promptText(ben)), 'Ben offered Nope!');
  await clickDo(ben, 'no');
  await until(async () => /Nope/.test(await promptText(asha)), 'Asha offered a counter');
  await clickDo(asha, 'no');
  await until(async () => (await state(ben, "g.players[0].props.some(c => c.id === 'or')")), 'orange moves to Asha on Ben\'s screen');
});

test('Housewarming: Ben pays with a coin and gets no change', async () => {
  await clickHand(asha, 'hw'); await clickDo(asha, 'play');
  await until(async () => /Pay 2 coins/.test(await promptText(ben)), 'Ben asked to pay');
  await ben.click('.seat.me [data-act="bank"][data-id="b3"]'); await clickDo(ben, 'pay');
  await until(async () => (await state(asha, "g.players[0].bank.some(c => c.id === 'b3')")), 'coin arrives in Asha\'s bank');
});

test('after Asha\'s third play the turn passes to Ben on both screens', async () => {
  // Nope! never uses a play, so Asha has used 2 so far (Steal, Housewarming). Banking a coin is her third.
  await clickHand(asha, 'a2'); await clickDo(asha, 'bank');
  await until(async () => (await state(asha, 'g.current')) === 1 && (await state(ben, 'g.current')) === 1, 'Ben\'s turn', 10000);
  assert.match(await promptText(ben), /Your move/);
});

test('room chat delivers messages both ways', async () => {
  await asha.click('#chatBtn'); await asha.fill('#chatInput', 'Nice steal'); await asha.press('#chatInput', 'Enter');
  await until(async () => (await ben.locator('#chatBadge').isVisible()) || (await ben.locator('#chatPeek').innerText()).includes('Nice steal'), 'Ben notified');
  await ben.click('#chatBtn');
  await until(async () => (await ben.locator('#chatList').innerText()).includes('Nice steal'), 'message in Ben\'s chat');
  await ben.fill('#chatInput', 'Thanks!'); await ben.press('#chatInput', 'Enter');
  await until(async () => (await asha.locator('#chatList').innerText()).includes('Thanks!'), 'reply in Asha\'s chat');
  assert.deepEqual([...asha.errors, ...ben.errors], []);
});
