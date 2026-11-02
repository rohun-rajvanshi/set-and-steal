// Rules on one device: every action card, payments, the hand limit, auto end-turn and winning.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startServer, openPage, startLocalGame, state, rig, clickHand, clickDo, clickTableCard, promptText, reveal, BANNED_TEXT } from './helpers.js';

let server, browser;
before(async () => { server = await startServer(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

async function game(names) { const page = await openPage(browser, server.url); await startLocalGame(page, names); return page; }
const noErrors = (page) => assert.deepEqual(page.errors, [], 'page errors');

test('the deck has 106 cards in the classic mix', async () => {
  const page = await game();
  const counts = await state(page, `(() => { const all = g.deck.concat(...g.players.map(p => p.hand)); const c = {}; all.forEach(x => c[x.type] = (c[x.type] || 0) + 1); c.total = all.length; return c; })()`);
  assert.deepEqual(counts, { total: 106, money: 20, property: 28, wild: 11, rent: 13, action: 34 });
  noErrors(page);
});

test('banking a money card uses a play and shows a coloured coin in the bank', async () => {
  const page = await game();
  await rig(page, "A.hand = [mk({id:'m5', type:'money', value:5}), mk({id:'m1', type:'money', value:1})]; g.plays = 3;");
  await clickHand(page, 'm5'); await clickDo(page, 'bank');
  assert.equal(await state(page, 'g.plays'), 2);
  const coin = page.locator('.seat.me [data-act="bank"]').first();
  assert.equal((await coin.innerText()).trim(), '5');
  assert.match(await coin.getAttribute('class'), /\bcoin\b.*\bc5\b|\bc5\b.*\bcoin\b/);
  const radius = await coin.evaluate((el) => getComputedStyle(el).borderRadius);
  assert.match(radius, /50%|999|9999/, 'coins are round');
  noErrors(page);
});

test('Steal skips full sets, takes a loose property, and Nope! chains work', async () => {
  const page = await game();
  await rig(page, `
    A.hand = [mk({id:'st', type:'action', effect:'sly', value:3}), mk({id:'an', type:'action', effect:'no', value:4})];
    A.props = [mk({type:'property', color:'red', value:3})];
    B.props = [mk({id:'g1', type:'property', color:'green', value:4}), mk({id:'g2', type:'property', color:'green', value:4}), mk({id:'g3', type:'property', color:'green', value:4}), mk({id:'or', type:'property', color:'orange', value:2})];
    B.hand = [mk({id:'bn1', type:'action', effect:'no', value:4}), mk({id:'bn2', type:'action', effect:'no', value:4})];
    g.plays = 3;`);
  const b = await state(page, 'g.players[1].id');
  assert.match(await page.locator('#hand [data-id="st"]').innerText(), /Steal/);
  await clickHand(page, 'st'); await clickDo(page, 'play');
  await clickTableCard(page, b, 'g1');
  assert.match(await page.locator('#toast').innerText(), /full set/i);
  await clickTableCard(page, b, 'or'); await clickDo(page, 'confirm');
  await reveal(page);
  assert.match(await promptText(page), /Nope/);
  await clickDo(page, 'no');
  assert.match(await page.locator('#flash').innerText(), /NOPE!/);
  await reveal(page); await clickDo(page, 'no');      // Asha counters
  await reveal(page); await clickDo(page, 'accept');  // Ben lets it go
  assert.equal(await state(page, "g.players.find(p => p.props.some(c => c.id === 'or')).name"), 'Asha');
  assert.equal(await state(page, 'g.pending'), null);
  noErrors(page);
});

test('Swap may give away a card from your own full set', async () => {
  const page = await game();
  await rig(page, `
    A.hand = [mk({id:'sw', type:'action', effect:'forced', value:3})];
    A.props = [mk({id:'b1', type:'property', color:'brown', value:1}), mk({id:'b2', type:'property', color:'brown', value:1})];
    B.props = [mk({id:'or', type:'property', color:'orange', value:2})]; B.hand = [];
    g.plays = 3;`);
  const [a, b] = await state(page, 'g.players.map(p => p.id)');
  await clickHand(page, 'sw'); await clickDo(page, 'play');
  await clickTableCard(page, b, 'or'); await clickTableCard(page, a, 'b1'); await clickDo(page, 'confirm');
  assert.deepEqual(await state(page, 'g.players.map(p => p.props.map(c => c.id).sort())'), [['b2', 'or'], ['b1']]);
  noErrors(page);
});

test('Takeover takes a complete set together with its House', async () => {
  const page = await game();
  await rig(page, `
    A.hand = [mk({id:'to', type:'action', effect:'breaker', value:5})];
    B.props = [mk({type:'property', color:'darkblue', value:4}), mk({type:'property', color:'darkblue', value:4})];
    B.builds = { darkblue: { house: mk({type:'action', effect:'house', value:3}), hotel: null } }; B.hand = [];
    g.plays = 3;`);
  const b = await state(page, 'g.players[1].id');
  await clickHand(page, 'to'); await clickDo(page, 'play');
  await page.click('[data-act="stack"][data-owner="' + b + '"][data-color="darkblue"] .stack-foot');
  await clickDo(page, 'confirm');
  assert.equal(await state(page, "g.players[0].props.filter(c => c.color === 'darkblue').length"), 2);
  assert.ok(await state(page, 'g.players[0].builds.darkblue && g.players[0].builds.darkblue.house'));
  assert.equal(await state(page, 'g.players[1].props.length'), 0);
  noErrors(page);
});

test('rent gives no change, and properties used to pay go to the collector', async () => {
  const page = await game();
  await rig(page, `
    A.hand = [mk({id:'rt', type:'rent', colors:['red','yellow'], value:1})];
    A.props = [mk({type:'property', color:'red', value:3}), mk({type:'property', color:'red', value:3})];
    B.bank = []; B.hand = [];
    B.props = [mk({id:'or', type:'property', color:'orange', value:2}), mk({id:'pk', type:'property', color:'pink', value:2})];
    g.plays = 3;`);
  const b = await state(page, 'g.players[1].id');
  await clickHand(page, 'rt'); await clickDo(page, 'play'); await clickDo(page, 'confirm');
  await reveal(page);
  assert.match(await promptText(page), /Pay 3 coins/);
  await clickTableCard(page, b, 'or'); await clickTableCard(page, b, 'pk'); await clickDo(page, 'pay');
  assert.deepEqual(await state(page, "g.players[0].props.map(c => c.color).sort()"), ['orange', 'pink', 'red', 'red']);
  assert.equal(await state(page, 'g.players[1].props.length'), 0);
  noErrors(page);
});

test('a hand over 7 cards must be cut down before the turn ends', async () => {
  const page = await game();
  await rig(page, "A.hand = Array.from({length: 10}, (_, i) => mk({id:'h' + i, type:'money', value:1})); g.plays = 3;");
  await page.click('#endTurnBtn');
  assert.match(await promptText(page), /Hand limit is 7/);
  for (const id of ['h0', 'h1', 'h2']) await clickHand(page, id);
  await clickDo(page, 'confirm');
  assert.equal(await state(page, 'g.players[g.current].name'), 'Ben');
  assert.equal(await state(page, 'g.players[0].hand.length'), 7);
  noErrors(page);
});

test('the turn passes on by itself after the third play', async () => {
  const page = await game();
  await rig(page, "A.hand = [1,2,3,4].map(v => mk({id:'c' + v, type:'money', value:v})); g.plays = 3;");
  for (const id of ['c1', 'c2', 'c3']) { await clickHand(page, id); await clickDo(page, 'bank'); }
  assert.match(await page.locator('#toast').innerText(), /3 plays used/);
  await page.waitForFunction(() => window.__deal.game.current === 1, null, { timeout: 4000 });
  noErrors(page);
});

test('three complete sets of different colours win the game', async () => {
  const page = await game();
  await rig(page, `
    A.props = [mk({type:'property', color:'brown', value:1}), mk({type:'property', color:'brown', value:1}),
               mk({type:'property', color:'darkblue', value:4}), mk({type:'property', color:'darkblue', value:4}),
               mk({type:'property', color:'utility', value:2})];
    A.hand = [mk({id:'pw', type:'property', color:'utility', value:2})]; g.plays = 3;`);
  await clickHand(page, 'pw'); await clickDo(page, 'property');
  assert.equal(await state(page, 'g.winner'), await state(page, 'g.players[0].id'));
  assert.match(await promptText(page), /wins/);
  noErrors(page);
});

test('cards, sets and text use the new names with no banned wording', async () => {
  const page = await game();
  await rig(page, `
    A.hand = ['passgo','debt','birthday','no','breaker','forced','sly','double','house','hotel'].map(e => mk({type:'action', effect:e, value:1}))
      .concat([mk({type:'money', value:10}), mk({type:'wild', any:true, colors:Object.keys(D.COLORS), color:null, value:0})]);
    A.props = [mk({type:'property', color:'railroad', value:2}), mk({type:'property', color:'utility', value:2})];
    A.bank = [mk({type:'money', value:2})]; g.plays = 3;`);
  const hand = await page.locator('#hand').innerText();
  for (const name of ['Payday', 'Collections', 'Housewarming', 'Nope!', 'Takeover', 'Swap', 'Steal', 'Rent Hike', 'House', 'Tower']) assert.ok(hand.includes(name), 'hand shows ' + name);
  const table = await page.locator('#mine').innerText();
  assert.match(table, /Transit/); assert.match(table, /Power/);
  const texts = { game: await page.locator('body').innerText() };
  await page.click('#rulesBtn'); texts.rules = await page.locator('#modal').innerText();
  for (const [where, text] of Object.entries(texts)) for (const re of BANNED_TEXT) assert.doesNotMatch(text, re, where + ' contains ' + re);
  assert.equal(await page.title(), 'Set & Steal');
  noErrors(page);
});
