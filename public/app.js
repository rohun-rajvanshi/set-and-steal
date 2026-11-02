(() => {
"use strict";
/* ============================================================
   Set & Steal: rules engine and interactive tabletop.
   106 playing cards; 3 plays a turn; first to 3 complete sets wins.
   ============================================================ */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATE_VERSION = 3;
// Where the online-room API lives. Empty means this same site; config.js can point it elsewhere (for example from GitHub Pages).
const API = String(window.SET_AND_STEAL_API || "").replace(/\/+$/, "");

const COLORS = {
  brown:     { name: "Brown",      hex: "#8a5a3b", ink: "#fff", need: 2, rent: [1, 2],       value: 1 },
  lightblue: { name: "Light Blue", hex: "#9ad7f2", ink: "#123", need: 3, rent: [1, 2, 3],    value: 1 },
  pink:      { name: "Pink",       hex: "#d6488c", ink: "#fff", need: 3, rent: [1, 2, 4],    value: 2 },
  orange:    { name: "Orange",     hex: "#f08a24", ink: "#fff", need: 3, rent: [1, 3, 5],    value: 2 },
  red:       { name: "Red",        hex: "#df3a35", ink: "#fff", need: 3, rent: [2, 3, 6],    value: 3 },
  yellow:    { name: "Yellow",     hex: "#f4d03a", ink: "#3a2f00", need: 3, rent: [2, 4, 6], value: 3 },
  green:     { name: "Green",      hex: "#2f9b58", ink: "#fff", need: 3, rent: [2, 4, 7],    value: 4 },
  darkblue:  { name: "Dark Blue",  hex: "#2c4b9a", ink: "#fff", need: 2, rent: [3, 8],       value: 4 },
  railroad:  { name: "Transit",    hex: "#2b2b2b", ink: "#fff", need: 4, rent: [1, 2, 3, 4], value: 2, noBuild: true },
  utility:   { name: "Power",      hex: "#bccaa6", ink: "#253018", need: 2, rent: [1, 2],    value: 2, noBuild: true },
};
const ORDER = Object.keys(COLORS);
const ACTIONS = {
  passgo:   { name: "Payday",       value: 1, icon: "↻", text: "Draw 2 extra cards." },
  debt:     { name: "Collections",  value: 3, icon: "$", text: "Make any one player pay you 5 coins." },
  birthday: { name: "Housewarming", value: 2, icon: "✿", text: "Every other player pays you 2 coins." },
  no:       { name: "Nope!",        value: 4, icon: "✋", text: "Cancel an action played against you. Use it any time; it doesn't use a play." },
  breaker:  { name: "Takeover",     value: 5, icon: "⚡", text: "Take a complete set, with any buildings, from any player." },
  forced:   { name: "Swap",         value: 3, icon: "⇄", text: "Swap one of your properties for another player's property that isn't part of a full set." },
  sly:      { name: "Steal",        value: 3, icon: "☞", text: "Take one property from any player. It can't be part of a full set." },
  double:   { name: "Rent Hike",    value: 1, icon: "×2", text: "Play with a Rent card to double it. Counts as one of your 3 plays." },
  house:    { name: "House",        value: 3, icon: "⌂", text: "Add to a full set you own (not Transit or Power). +3 coins rent." },
  hotel:    { name: "Tower",        value: 4, icon: "▣", text: "Add to a full set that already has a House. +4 coins rent." },
};
const AVATAR_COLORS = ["#f2b544", "#5bc0be", "#ef6f6c", "#a594f9", "#7bc67e"];

/* ---------------- utilities ---------------- */
let seq = 0;
const newId = () => Math.random().toString(36).slice(2, 8) + (seq++).toString(36);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const sum = (arr) => arr.reduce((s, c) => s + (c.value || 0), 0);
// Money is counted in coins. Each denomination has its own colour; other amounts use a plain gold coin.
const DENOMS = [1, 2, 3, 4, 5, 10];
const coins = (n) => n + (n === 1 ? " coin" : " coins");
const coin = (n, cls = "") => '<span class="coin c' + (DENOMS.includes(n) ? n : "x") + (cls ? " " + cls : "") + '">' + n + "</span>";

function buildDeck() {
  const d = [];
  const add = (o) => d.push({ id: newId(), ...o });
  const propCounts = { brown: 2, lightblue: 3, pink: 3, orange: 3, red: 3, yellow: 3, green: 3, darkblue: 2, railroad: 4, utility: 2 };
  ORDER.forEach((k) => { for (let i = 0; i < propCounts[k]; i++) add({ type: "property", color: k, value: COLORS[k].value }); });
  [
    [["lightblue", "brown"], 1, 1], [["lightblue", "railroad"], 4, 1], [["pink", "orange"], 2, 2],
    [["red", "yellow"], 3, 2], [["darkblue", "green"], 4, 1], [["green", "railroad"], 4, 1], [["railroad", "utility"], 2, 1],
  ].forEach(([colors, value, n]) => { for (let i = 0; i < n; i++) add({ type: "wild", colors, color: null, value }); });
  for (let i = 0; i < 2; i++) add({ type: "wild", any: true, colors: ORDER.slice(), color: null, value: 0 });
  [["brown", "lightblue"], ["pink", "orange"], ["red", "yellow"], ["green", "darkblue"], ["railroad", "utility"]]
    .forEach((colors) => { for (let i = 0; i < 2; i++) add({ type: "rent", colors, value: 1 }); });
  for (let i = 0; i < 3; i++) add({ type: "rent", any: true, colors: ORDER.slice(), value: 3 });
  Object.entries({ breaker: 2, forced: 3, sly: 3, no: 3, debt: 3, birthday: 3, double: 2, house: 3, hotel: 2, passgo: 10 })
    .forEach(([effect, n]) => { for (let i = 0; i < n; i++) add({ type: "action", effect, value: ACTIONS[effect].value }); });
  [[1, 6], [2, 5], [3, 3], [4, 3], [5, 2], [10, 1]].forEach(([v, n]) => { for (let i = 0; i < n; i++) add({ type: "money", value: v }); });
  return shuffle(d); // 106 playing cards (+4 rules cards in the box = 110)
}

function cardName(c) {
  if (!c) return "";
  if (c.type === "property") return COLORS[c.color].name;
  if (c.type === "wild") return c.any ? "Wild (any colour)" : c.colors.map((k) => COLORS[k].name).join(" / ") + " Wild";
  if (c.type === "rent") return c.any ? "Wild Rent" : "Rent · " + c.colors.map((k) => COLORS[k].name).join(" / ");
  if (c.type === "action") return ACTIONS[c.effect].name;
  return coins(c.value);
}

/* ---------------- game state ---------------- */
let game = null;
const ui = { selected: null, mode: null, paySel: new Set(), revealedFor: null, lastViewer: null, logOpen: false };

const P = (id) => game.players.find((p) => p.id === id);
const cur = () => game.players[game.current];
const others = (pid) => { const i = game.players.findIndex((p) => p.id === pid); return game.players.slice(i + 1).concat(game.players.slice(0, i)); };
function log(text) { game.log.unshift({ t: Date.now(), text }); game.log = game.log.slice(0, 40); }

function newPlayer(name, i) { return { id: "p" + i + newId(), name, color: AVATAR_COLORS[i % AVATAR_COLORS.length], hand: [], bank: [], props: [], builds: {} }; }

function newGame(names) {
  const deck = buildDeck();
  const players = names.map(newPlayer);
  players.forEach((p) => { for (let i = 0; i < 5; i++) p.hand.push(deck.pop()); });
  game = { v: STATE_VERSION, id: newId(), players, deck, discard: [], current: 0, plays: 3, turnNo: 0, turnStarted: Date.now(), pending: null, winner: null, log: [], drew: 0 };
  log("New game: " + names.join(", ") + ".");
  beginTurn();
}

function drawCards(p, n) {
  let got = 0;
  for (let i = 0; i < n; i++) {
    if (!game.deck.length) {
      if (!game.discard.length) break;
      game.deck = shuffle(game.discard.splice(0));
      log("Draw pile reshuffled from the discard pile.");
    }
    p.hand.push(game.deck.pop()); got++;
  }
  return got;
}

function beginTurn() {
  const p = cur();
  game.plays = 3; game.turnNo++; game.turnStarted = Date.now(); game.pending = null;
  const n = p.hand.length === 0 ? 5 : 2;
  game.drew = drawCards(p, n);
  log(p.name + "'s turn. Drew " + game.drew + ".");
  checkWin();
}

/* ---------------- property helpers ---------------- */
function stacksFor(p, color) {
  const cards = p.props.filter((c) => c.color === color), need = COLORS[color].need, out = [];
  for (let i = 0; i < cards.length; i += need) { const s = cards.slice(i, i + need); out.push({ color, idx: out.length, cards: s, complete: s.length === need }); }
  return out;
}
function allStacks(p) { return ORDER.flatMap((k) => stacksFor(p, k)); }
const completeColors = (p) => ORDER.filter((k) => stacksFor(p, k).some((s) => s.complete));
const setCount = (p) => completeColors(p).length;
function inFullSet(p, cardId) { const c = p.props.find((x) => x.id === cardId); if (!c) return false; return stacksFor(p, c.color).some((s) => s.complete && s.cards.some((x) => x.id === cardId)); }
function rentFor(p, color) {
  const cards = p.props.filter((c) => c.color === color);
  if (!cards.length || cards.every((c) => c.any)) return 0; // no rent on a lone multicolour wild
  const k = COLORS[color], n = Math.min(cards.length, k.need), complete = cards.length >= k.need, b = p.builds[color] || {};
  return k.rent[n - 1] + (complete && b.house ? 3 : 0) + (complete && b.hotel ? 4 : 0);
}
function buildingCards(p) { const out = []; ORDER.forEach((k) => { const b = p.builds[k]; if (!b) return; if (b.house) out.push({ card: b.house, color: k, slot: "house" }); if (b.hotel) out.push({ card: b.hotel, color: k, slot: "hotel" }); }); return out; }
function normalize(p) {
  ORDER.forEach((k) => {
    const b = p.builds[k]; if (!b) return;
    const complete = stacksFor(p, k).some((s) => s.complete);
    if (!complete || COLORS[k].noBuild) { if (b.house) p.bank.push(b.house); if (b.hotel) p.bank.push(b.hotel); delete p.builds[k]; return; }
    if (b.hotel && !b.house) { p.bank.push(b.hotel); b.hotel = null; }
    if (!b.house && !b.hotel) delete p.builds[k];
  });
}
function payable(p) {
  return [
    ...p.bank.map((c) => ({ id: c.id, kind: "bank", value: c.value, card: c })),
    ...p.props.filter((c) => c.value > 0).map((c) => ({ id: c.id, kind: "prop", value: c.value, card: c })),
    ...buildingCards(p).map((b) => ({ id: b.card.id, kind: "build", value: b.card.value, card: b.card, color: b.color, slot: b.slot })),
  ];
}
function checkWin() {
  if (game.winner) return true;
  const p = cur();
  if (setCount(p) >= 3) { game.winner = p.id; game.pending = null; log("🏆 " + p.name + " wins with 3 full sets!"); return true; }
  return false;
}

/* ---------------- whose move is it? ---------------- */
function responderId() {
  const pd = game && game.pending; if (!pd) return null;
  return pd.stage === "counter" ? pd.from : pd.targets[pd.ti];
}
function actorId() { if (!game || game.winner) return null; return game.pending ? responderId() : cur().id; }
function viewerId() { if (isOnline()) return myOnlineId() || cur().id; return actorId() || cur().id; }
const iCanAct = () => !!game && !game.winner && actorId() === viewerId();
const myTurnFree = () => iCanAct() && !game.pending;

/* ---------------- playing cards from hand ---------------- */
function takeFromHand(p, id) { const c = p.hand.find((x) => x.id === id); if (c) p.hand = p.hand.filter((x) => x.id !== id); return c; }
function usePlay(n = 1) { game.plays = Math.max(0, game.plays - n); }

function playProperty(cardId, color) {
  const p = cur(), c = takeFromHand(p, cardId); if (!c) return;
  if (c.type === "wild") c.color = color;
  p.props.push(c); usePlay();
  log(p.name + " played a " + COLORS[c.color].name + (c.type === "wild" ? " wild" : " property") + ".");
  checkWin();
}
function bankCard(cardId) {
  const p = cur(), c = takeFromHand(p, cardId); if (!c) return;
  p.bank.push(c); usePlay(); log(p.name + " banked " + (c.type === "money" ? coins(c.value) : cardName(c) + " as " + coins(c.value)) + ".");
}
function recolorWild(cardId, color) {
  const p = cur(), c = p.props.find((x) => x.id === cardId); if (!c || c.type !== "wild" || c.color === color) return;
  p.props = p.props.filter((x) => x.id !== cardId); c.color = color; p.props.push(c); normalize(p);
  log(p.name + " flipped a wild to " + COLORS[color].name + ".");
  checkWin();
}
function playPassGo(cardId) {
  const p = cur(), c = takeFromHand(p, cardId); if (!c) return;
  game.discard.push(c); usePlay(); const n = drawCards(p, 2); log(p.name + " played Payday and drew " + n + ".");
}
function playBuilding(cardId, color) {
  const p = cur(), c = takeFromHand(p, cardId); if (!c) return;
  p.builds[color] = p.builds[color] || { house: null, hotel: null };
  p.builds[color][c.effect] = c; usePlay();
  log(p.name + " added a " + ACTIONS[c.effect].name + " to " + COLORS[color].name + ".");
}
function discardFromHand(ids) {
  const p = cur(); ids.forEach((id) => { const c = takeFromHand(p, id); if (c) game.discard.push(c); });
  log(p.name + " discarded " + ids.length + " card" + (ids.length === 1 ? "" : "s") + ".");
}
function endTurn() {
  if (game.pending || game.winner) return;
  game.current = (game.current + 1) % game.players.length;
  beginTurn();
}

/* ---------------- action resolution (with Nope! chains) ---------------- */
const STEAL = ["sly", "forced", "breaker"];
function launchAction(spec) {
  const p = cur(), c = takeFromHand(p, spec.cardId); if (!c) return;
  game.discard.push(c);
  const doubles = (spec.doubleIds || []).map((id) => takeFromHand(p, id)).filter(Boolean);
  doubles.forEach((d) => game.discard.push(d));
  usePlay(1 + doubles.length);
  const pd = { id: newId(), kind: spec.kind, from: p.id, label: cardName(c), targets: spec.targets, ti: 0, stage: "respond", chain: 0,
    amount: spec.amount || 0, color: spec.color || null, doubles: doubles.length, takeId: spec.takeId || null, giveId: spec.giveId || null, stackColor: spec.stackColor || null, results: [] };
  game.pending = pd;
  log(p.name + " played " + describeLaunch(pd) + ".");
  advance();
}
function describeLaunch(pd) {
  const t = pd.targets.map((id) => P(id).name).join(", ");
  switch (pd.kind) {
    case "sly": return "Steal on " + t + "'s " + cardName(findProp(pd.targets[0], pd.takeId));
    case "forced": return "Swap with " + t;
    case "breaker": return "Takeover on " + t + "'s " + COLORS[pd.stackColor].name + " set";
    case "rent": return pd.label + " (" + COLORS[pd.color].name + ", " + coins(pd.amount) + (pd.doubles ? ", doubled" : "") + ") against " + t;
    case "debt": return "Collections on " + t + " (5 coins)";
    case "birthday": return "Housewarming (2 coins from everyone)";
  }
  return pd.label;
}
function findProp(pid, cardId) { const p = P(pid); return p && p.props.find((x) => x.id === cardId); }
const hasNo = (p) => p.hand.some((c) => c.type === "action" && c.effect === "no");

function advance() {
  let guard = 0;
  while (game.pending && guard++ < 50) {
    const pd = game.pending;
    if (pd.ti >= pd.targets.length) { finishPending(); return; }
    const target = P(pd.targets[pd.ti]), from = P(pd.from);
    if (pd.stage === "respond") {
      if (hasNo(target)) return; // wait for the target to decide
      acceptCurrent(); continue;
    }
    if (pd.stage === "counter") {
      if (hasNo(from)) return; // wait for the attacker to decide
      blockCurrent(); continue;
    }
    if (pd.stage === "pay") {
      const assets = payable(target), total = sum(assets);
      if (!assets.length) { pd.results.push(target.name + " had nothing to pay"); log(target.name + " has nothing on the table to pay with."); nextTarget(); continue; }
      if (total <= pd.amount) { transferPayment(target, from, assets.map((a) => a.id)); nextTarget(); continue; }
      return; // wait for the payer to pick cards
    }
  }
}
function nextTarget() { const pd = game.pending; pd.ti++; pd.stage = "respond"; pd.chain = 0; }
function acceptCurrent() {
  const pd = game.pending, target = P(pd.targets[pd.ti]), from = P(pd.from);
  if (STEAL.includes(pd.kind)) { executeSteal(pd, from, target); nextTarget(); }
  else { pd.stage = "pay"; }
}
function blockCurrent() {
  const pd = game.pending, target = P(pd.targets[pd.ti]);
  pd.results.push(target.name + " blocked it"); log("✋ " + target.name + "'s Nope! stands, so " + pd.label + " is cancelled for them.");
  nextTarget();
}
function respondNo() {
  const pd = game.pending, who = P(responderId()); if (!pd || !who) return;
  const card = who.hand.find((c) => c.type === "action" && c.effect === "no"); if (!card) return;
  takeFromHand(who, card.id); game.discard.push(card); pd.chain++;
  if (pd.stage === "respond") { pd.stage = "counter"; log("✋ " + who.name + " played Nope!"); }
  else { pd.stage = "respond"; log("✋ " + who.name + " countered with Nope!"); }
  flash("NOPE!", who.name + (pd.chain > 1 ? " counters" : " blocks") + " the " + pd.label, "no");
  advance();
}
function respondAccept() {
  const pd = game.pending; if (!pd) return;
  if (pd.stage === "respond") acceptCurrent(); else if (pd.stage === "counter") blockCurrent();
  advance();
}
function submitPayment(ids) {
  const pd = game.pending; if (!pd || pd.stage !== "pay") return;
  const target = P(pd.targets[pd.ti]), from = P(pd.from);
  transferPayment(target, from, ids); nextTarget(); advance();
}
function transferPayment(payer, receiver, ids) {
  const assets = payable(payer).filter((a) => ids.includes(a.id)); let paid = 0;
  assets.forEach((a) => {
    paid += a.value;
    if (a.kind === "bank") { payer.bank = payer.bank.filter((x) => x.id !== a.id); receiver.bank.push(a.card); }
    else if (a.kind === "prop") { payer.props = payer.props.filter((x) => x.id !== a.id); receiver.props.push(a.card); }
    else { const b = payer.builds[a.color]; if (b) b[a.slot] = null; receiver.bank.push(a.card); }
  });
  normalize(payer); normalize(receiver);
  const pd = game.pending; if (pd) pd.results.push(payer.name + " paid " + coins(paid));
  log(payer.name + " paid " + receiver.name + " " + coins(paid) + " (" + assets.map((a) => cardName(a.card)).join(", ") + ").");
}
function executeSteal(pd, from, target) {
  if (pd.kind === "sly") {
    const c = target.props.find((x) => x.id === pd.takeId); if (!c) return;
    target.props = target.props.filter((x) => x.id !== c.id); from.props.push(c);
    pd.results.push(from.name + " took " + cardName(c)); log("☞ " + from.name + " stole " + target.name + "'s " + cardName(c) + ".");
    flash("STEAL!", from.name + " took " + target.name + "'s " + cardName(c), "steal");
  } else if (pd.kind === "forced") {
    const take = target.props.find((x) => x.id === pd.takeId), give = from.props.find((x) => x.id === pd.giveId); if (!take || !give) return;
    target.props = target.props.filter((x) => x.id !== take.id); from.props = from.props.filter((x) => x.id !== give.id);
    from.props.push(take); target.props.push(give);
    pd.results.push("swapped"); log("⇄ " + from.name + " swapped their " + cardName(give) + " for " + target.name + "'s " + cardName(take) + ".");
    flash("SWAP!", cardName(give) + " ⇄ " + cardName(take), "steal");
  } else if (pd.kind === "breaker") {
    const stack = stacksFor(target, pd.stackColor).find((s) => s.complete); if (!stack) return;
    const ids = stack.cards.map((c) => c.id);
    target.props = target.props.filter((x) => !ids.includes(x.id)); from.props.push(...stack.cards);
    const tb = target.builds[pd.stackColor];
    if (tb && !stacksFor(target, pd.stackColor).some((s) => s.complete)) {
      const fb = from.builds[pd.stackColor] = from.builds[pd.stackColor] || { house: null, hotel: null };
      ["house", "hotel"].forEach((slot) => { if (tb[slot]) { if (fb[slot]) from.bank.push(tb[slot]); else fb[slot] = tb[slot]; } });
      delete target.builds[pd.stackColor];
    }
    normalize(target); normalize(from);
    pd.results.push(from.name + " took the set"); log("⚡ " + from.name + " took over " + target.name + "'s " + COLORS[pd.stackColor].name + " set!");
    flash("TAKEOVER!", from.name + " takes the " + COLORS[pd.stackColor].name + " set", "steal");
  }
}
function finishPending() { game.pending = null; checkWin(); }

/* ---------------- what can be targeted? ---------------- */
function slyTargets(pid) { return others(pid).flatMap((o) => o.props.filter((c) => !inFullSet(o, c.id)).map((c) => ({ owner: o.id, id: c.id }))); }
function ownLoose(p) { return p.props.filter((c) => !inFullSet(p, c.id)); }
function breakerTargets(pid) { return others(pid).flatMap((o) => ORDER.filter((k) => stacksFor(o, k).some((s) => s.complete)).map((k) => ({ owner: o.id, color: k }))); }
function rentColors(p, card) { return (card.any ? ORDER : card.colors).filter((k) => rentFor(p, k) > 0); }
function buildColors(p, effect) {
  return completeColors(p).filter((k) => !COLORS[k].noBuild && (effect === "house" ? !(p.builds[k] && p.builds[k].house) : (p.builds[k] && p.builds[k].house && !p.builds[k].hotel)));
}
function doublesInHand(p) { return p.hand.filter((c) => c.type === "action" && c.effect === "double"); }

/* ---------------- UI: card faces ---------------- */
function cardFace(c, extra = "") {
  if (!c) return "";
  const v = coin(c.value, "cv");
  if (c.type === "property") {
    const k = COLORS[c.color];
    return '<div class="card prop ' + extra + '" style="--c:' + k.hex + ";--bi:" + k.ink + '">' + v +
      '<div class="band">' + esc(k.name) + "</div>" +
      '<ol class="ladder">' + k.rent.map((r, i) => "<li><i>" + (i + 1) + "</i><b>" + r + '<span class="cn"></span></b></li>').join("") + "</ol>" +
      '<div class="need">' + k.need + " for a set</div></div>";
  }
  if (c.type === "wild") {
    const placed = c.color ? COLORS[c.color] : null;
    const bg = c.any ? "conic-gradient(from 200deg,#df3a35,#f08a24,#f4d03a,#2f9b58,#9ad7f2,#2c4b9a,#d6488c,#df3a35)" :
      "linear-gradient(115deg," + COLORS[c.colors[0]].hex + " 0 50%," + COLORS[c.colors[1]].hex + " 50% 100%)";
    const label = placed ? placed.name : (c.any ? "Any colour" : c.colors.map((k) => COLORS[k].name).join(" / "));
    return '<div class="card wild ' + extra + '" style="--bg:' + bg + (placed ? ";--c:" + placed.hex + ";--bi:" + placed.ink : "") + '">' + (c.value ? v : '<span class="coin cv none">0</span>') +
      '<div class="band ' + (placed ? "placed" : "") + '"><span>' + esc(label) + "</span></div>" +
      '<div class="wild-mark">WILD</div>' +
      (placed && !c.any ? '<ol class="ladder">' + placed.rent.map((r, i) => "<li><i>" + (i + 1) + "</i><b>" + r + '<span class="cn"></span></b></li>').join("") + "</ol>" : '<div class="wild-sub">' + (c.any ? "No cash value" : "Flip on your turn") + "</div>") + "</div>";
  }
  if (c.type === "rent") {
    const bg = c.any ? "conic-gradient(#df3a35,#f08a24,#f4d03a,#2f9b58,#9ad7f2,#2c4b9a,#d6488c,#8a5a3b,#df3a35)" :
      "linear-gradient(90deg," + COLORS[c.colors[0]].hex + " 0 50%," + COLORS[c.colors[1]].hex + " 50% 100%)";
    return '<div class="card rent ' + extra + '">' + v + '<div class="disc" style="--bg:' + bg + '"><span>RENT</span></div>' +
      '<div class="ctitle">' + (c.any ? "Wild Rent" : "Rent") + '</div><div class="csub">' + (c.any ? "Any colour · one player" : esc(c.colors.map((k) => COLORS[k].name).join(" / ")) + " · all players") + "</div></div>";
  }
  if (c.type === "action") {
    const a = ACTIONS[c.effect];
    return '<div class="card action fx-' + c.effect + " " + extra + '">' + v + '<div class="disc"><span>' + a.icon + "</span></div>" +
      '<div class="ctitle">' + esc(a.name) + '</div><div class="csub">' + esc(a.text) + "</div></div>";
  }
  return '<div class="card money m' + c.value + " " + extra + '">' + coin(c.value, "big") + '<div class="csub">' + (c.value === 1 ? "Coin" : "Coins") + "</div></div>";
}
function cardBack(n) { return '<span class="backs" title="' + n + ' cards in hand">' + '<i></i>'.repeat(Math.min(n, 7)) + "<b>" + n + "</b></span>"; }

/* ---------------- UI: highlight rules ---------------- */
function highlightInfo() {
  // returns {cards:Set("owner:id"), stacks:Set("owner:color"), seats:Set(owner), picked:Set, targeted:Set}
  const h = { cards: new Set(), stacks: new Set(), seats: new Set(), picked: new Set(), targeted: new Set(), bank: new Set(), builds: new Set() };
  if (!game) return h;
  const pd = game.pending;
  if (pd) {
    const tId = pd.targets[pd.ti];
    if (pd.kind === "sly" || pd.kind === "forced") h.targeted.add(tId + ":" + pd.takeId);
    if (pd.kind === "forced") h.targeted.add(pd.from + ":" + pd.giveId);
    if (pd.kind === "breaker") h.stacks.add("T" + tId + ":" + pd.stackColor);
    if (pd.stage === "pay" && iCanAct()) {
      const me = P(viewerId());
      payable(me).forEach((a) => { if (a.kind === "bank") h.bank.add(a.id); else if (a.kind === "prop") h.cards.add(me.id + ":" + a.id); else h.builds.add(a.id); });
      ui.paySel.forEach((id) => h.picked.add(id));
    }
    return h;
  }
  const m = ui.mode; if (!m || !myTurnFree()) return h;
  const me = cur();
  if (m.kind === "sly") { slyTargets(me.id).forEach((t) => h.cards.add(t.owner + ":" + t.id)); if (m.takeId) h.picked.add(m.takeId); }
  if (m.kind === "forced") {
    slyTargets(me.id).forEach((t) => h.cards.add(t.owner + ":" + t.id));
    me.props.forEach((c) => h.cards.add(me.id + ":" + c.id));
    if (m.takeId) h.picked.add(m.takeId); if (m.giveId) h.picked.add(m.giveId);
  }
  if (m.kind === "breaker") { breakerTargets(me.id).forEach((t) => h.stacks.add(t.owner + ":" + t.color)); if (m.owner) h.picked.add(m.owner + ":" + m.stackColor); }
  if (m.kind === "rent") {
    const card = me.hand.find((x) => x.id === m.cardId);
    if (card) rentColors(me, card).forEach((k) => h.stacks.add(me.id + ":" + k));
    if (m.color) h.picked.add(me.id + ":" + m.color);
    if (card && card.any) { others(me.id).forEach((o) => h.seats.add(o.id)); if (m.target) h.picked.add("seat:" + m.target); }
  }
  if (m.kind === "debt") { others(me.id).forEach((o) => h.seats.add(o.id)); if (m.target) h.picked.add("seat:" + m.target); }
  if (m.kind === "build") { buildColors(me, m.effect).forEach((k) => h.stacks.add(me.id + ":" + k)); if (m.color) h.picked.add(me.id + ":" + m.color); }
  if (m.kind === "wildplay") {}
  return h;
}

/* ---------------- UI: rendering ---------------- */
function render() {
  if (!game) return;
  validateUi();
  const vid = viewerId(), me = P(vid), h = highlightInfo();
  document.body.classList.toggle("targeting", !!(ui.mode && myTurnFree()) || !!(game.pending && game.pending.stage === "pay" && iCanAct()));
  renderStatus(me);
  $("opponents").innerHTML = others(vid).map((o) => seatHTML(o, h, false)).join("");
  $("opponents").className = "opponents n" + (game.players.length - 1);
  $("mine").innerHTML = seatHTML(me, h, true);
  renderCenter();
  renderPrompt(me);
  renderHand(me);
  renderCurtain(me);
  renderTimer();
  syncDock();
  autoScroll();
  maybeAutoEnd();
}
/* After the 3rd play resolves, pass the turn on automatically (a moment later, so the last play is visible). */
let autoEndKey = null, autoEndT = null;
function autoEndReady() {
  return !!game && !game.winner && !game.pending && game.plays <= 0 && myTurnFree() &&
    !(ui.mode && ui.mode.kind === "discard") && (isOnline() ? myOnlineId() === cur().id : true);
}
function maybeAutoEnd() {
  if (!autoEndReady()) return;
  const key = game.id + ":" + game.turnNo;
  if (autoEndKey === key) return;
  autoEndKey = key;
  const next = game.players[(game.current + 1) % game.players.length];
  toast(cur().hand.length > 7 ? "3 plays used. Discard down to 7 to end your turn." : "3 plays used. Passing to " + next.name + "…");
  clearTimeout(autoEndT);
  autoEndT = setTimeout(() => { if (autoEndReady() && game.id + ":" + game.turnNo === key) tryEndTurn(); }, 1300);
}
function syncDock() { const d = $("dock"); if (d) document.documentElement.style.setProperty("--dock-h", d.offsetHeight + "px"); }
window.addEventListener("resize", syncDock);
// Overlays sit below the top bar, whose height changes with notches, the installed app and wrapping buttons.
// On phones the chat is sized to the visible area, so the on-screen keyboard never covers it.
const rootStyle = document.documentElement.style, topbar = document.querySelector(".topbar");
function syncTop() { rootStyle.setProperty("--top-h", topbar.offsetHeight + "px"); }
function syncViewport() { const v = window.visualViewport; if (!v) return; rootStyle.setProperty("--vv-h", v.height + "px"); rootStyle.setProperty("--vv-top", v.offsetTop + "px"); }
if (window.ResizeObserver) new ResizeObserver(syncTop).observe(topbar);
window.addEventListener("resize", syncTop); syncTop();
if (window.visualViewport) { visualViewport.addEventListener("resize", syncViewport); visualViewport.addEventListener("scroll", syncViewport); syncViewport(); }
let scrolledKey = null;
function autoScroll() {
  // bring the relevant part of the table into view (mainly for phones)
  if (window.innerWidth > 900 || !game) return;
  const pd = game.pending, m = ui.mode;
  let key = null, target = null;
  if (pd && iCanAct()) { key = pd.id + pd.stage + pd.ti; target = $("mine"); }
  else if (m && myTurnFree() && ["sly", "forced", "breaker", "debt"].includes(m.kind) && !m.takeId && !m.owner && !m.target) { key = "m" + m.kind + m.cardId; target = $("opponents"); }
  else if (m && myTurnFree() && ["rent", "build"].includes(m.kind) && !m.color) { key = "m" + m.kind + m.cardId; target = $("mine"); }
  if (key && key !== scrolledKey) { scrolledKey = key; requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: target.id === "mine" ? "end" : "start" })); }
}

function seatHTML(p, h, mine) {
  const isTurn = cur().id === p.id, isResponder = game.pending && responderId() === p.id;
  const bankTotal = sum(p.bank), seatable = h.seats.has(p.id), seatPicked = h.picked.has("seat:" + p.id);
  const stacks = allStacks(p);
  const bodyStacks = stacks.length ? stacks.map((s) => stackHTML(p, s, h)).join("") : '<div class="empty">' + (mine ? "Your properties land here" : "No properties yet") + "</div>";
  const chips = p.bank.length ? p.bank.map((c) => {
    const el = h.bank.has(c.id), pk = h.picked.has(c.id);
    const d = DENOMS.includes(c.value) ? c.value : "x";
    return '<button class="coin c' + d + (el ? " elig" : "") + (pk ? " picked" : "") + '" data-act="bank" data-owner="' + p.id + '" data-id="' + c.id + '" title="' + esc(c.type === "money" ? coins(c.value) : cardName(c) + ", banked as " + coins(c.value)) + '" aria-label="' + esc(coins(c.value)) + '"' + (el ? "" : " tabindex=-1") + ">" + c.value + "</button>";
  }).join("") : '<span class="empty sm">Empty</span>';
  return '<section class="seat' + (mine ? " me" : "") + (isTurn ? " turn" : "") + (isResponder ? " responding" : "") + (seatable ? " elig" : "") + (seatPicked ? " picked" : "") + (game.winner === p.id ? " winner" : "") + '"' + (seatable ? ' data-act="seat" data-owner="' + p.id + '"' : "") + ">" +
    '<header class="seat-head"><span class="avatar" style="--av:' + p.color + '">' + esc(p.name.charAt(0).toUpperCase()) + "</span>" +
    '<div class="who"><b>' + esc(p.name) + (mine && isOnline() ? ' <em>(you)</em>' : "") + "</b><small>" + (game.winner === p.id ? "Winner!" : isResponder ? "Responding…" : isTurn ? "Playing now" : "Waiting") + "</small></div>" +
    '<div class="stats">' + (mine ? "" : cardBack(p.hand.length)) + '<span class="pill bank-pill" title="Bank total: ' + coins(bankTotal) + '"><span class="cn"></span>' + bankTotal + '</span><span class="pill sets-pill' + (setCount(p) >= 2 ? " hot" : "") + '" title="Complete sets">' + setCount(p) + "/3 sets</span></div></header>" +
    '<div class="tableau"><div class="bank"><span class="lbl">Bank</span><div class="chips">' + chips + "</div></div>" +
    '<div class="stacks">' + bodyStacks + "</div></div></section>";
}

function stackHTML(p, s, h) {
  const key = p.id + ":" + s.color, k = COLORS[s.color];
  const elig = h.stacks.has(key) && (!ui.mode || ui.mode.kind !== "breaker" || s.complete);
  const picked = h.picked.has(key), threatened = h.stacks.has("T" + key) && s.complete;
  const b = (s.complete && p.builds[s.color]) || null;
  const builds = b ? [b.house && ["house", b.house], b.hotel && ["hotel", b.hotel]].filter(Boolean).map(([slot, c]) =>
    '<button class="bld' + (h.builds.has(c.id) ? " elig" : "") + (h.picked.has(c.id) ? " picked" : "") + '" data-act="build" data-owner="' + p.id + '" data-id="' + c.id + '" title="' + (slot === "house" ? "House, +3 coins rent" : "Tower, +4 coins rent") + '">' + (slot === "house" ? "⌂" : "▣") + "</button>").join("") : "";
  const cards = s.cards.map((c, i) => {
    const ck = p.id + ":" + c.id, ce = h.cards.has(ck), cp = h.picked.has(c.id), ct = h.targeted.has(ck);
    return '<div class="tc' + (ce ? " elig" : "") + (cp ? " picked" : "") + (ct ? " targeted" : "") + '" style="--i:' + i + '" data-act="tcard" data-owner="' + p.id + '" data-id="' + c.id + '">' + cardFace(c) + "</div>";
  }).join("");
  return '<div class="stack' + (s.complete ? " full" : "") + (elig ? " elig" : "") + (picked ? " picked" : "") + (threatened ? " targeted" : "") + '" style="--n:' + s.cards.length + ";--c:" + k.hex + '" data-act="stack" data-owner="' + p.id + '" data-color="' + s.color + '">' +
    '<div class="stack-cards">' + cards + "</div>" +
    '<div class="stack-foot"><span class="count">' + s.cards.length + "/" + k.need + "</span>" + (s.complete ? '<span class="tick">SET</span>' : "") + builds + "</div></div>";
}

function renderStatus(me) {
  const p = cur();
  $("turnName").textContent = game.winner ? P(game.winner).name + " wins!" : p.name;
  $("turnSub").textContent = game.winner ? "Three complete sets" : game.pending ? "Resolving " + game.pending.label : (p.id === me.id ? "Your turn" : "Their turn");
  $("pips").innerHTML = [0, 1, 2].map((i) => '<i class="' + (i < game.plays ? "on" : "") + '"></i>').join("");
  $("playsLbl").textContent = game.plays + " play" + (game.plays === 1 ? "" : "s") + " left";
  $("endTurnBtn").disabled = !myTurnFree() || (ui.mode && ui.mode.kind === "discard");
  $("endTurnBtn").classList.toggle("nudge", myTurnFree() && game.plays === 0);
}
function renderCenter() {
  $("deckCount").textContent = game.deck.length;
  const top = game.discard[game.discard.length - 1];
  $("discardTop").innerHTML = top ? cardFace(top) : '<div class="slot">Discard</div>';
  $("logList").innerHTML = game.log.slice(0, ui.logOpen ? 40 : 6).map((l) => "<li>" + esc(l.text) + "</li>").join("");
}

function renderPrompt(me) {
  const el = $("prompt"); let html = "", tone = "";
  const pd = game.pending;
  if (game.winner) {
    html = '<div class="pt"><b>🏆 ' + esc(P(game.winner).name) + " wins!</b><span>Three complete property sets of different colours.</span></div>" + btn("restart", "Play again", "primary");
    tone = "win";
  } else if (pd) {
    const from = P(pd.from), target = P(pd.targets[pd.ti]), rid = responderId(), resp = P(rid);
    const what = pendingDetail(pd, target);
    if (iCanAct()) {
      tone = "alert";
      if (pd.stage === "respond") {
        html = '<div class="pt"><b>' + esc(from.name) + " → you: " + esc(pd.label) + (pd.chain ? " (they countered your Nope!)" : "") + "</b><span>" + what + "</span></div>" +
          btn("no", "✋ Nope!", "no") + btn("accept", STEAL.includes(pd.kind) ? "Accept" : "Pay " + coins(pd.amount), "ghost");
      } else if (pd.stage === "counter") {
        html = '<div class="pt"><b>' + esc(target.name) + " said Nope!</b><span>Counter with your own Nope! to push the " + esc(pd.label) + " through?</span></div>" +
          btn("no", "✋ Nope! back", "no") + btn("accept", "Let it go", "ghost");
      } else if (pd.stage === "pay") {
        const total = sum(payable(me).filter((a) => ui.paySel.has(a.id)));
        html = '<div class="pt"><b>Pay ' + coins(pd.amount) + " to " + esc(from.name) + "</b><span>Tap coins, buildings or properties on <u>your</u> table. No change is given. Selected: <strong>" + coins(total) + "</strong></span></div>" +
          btn("pay", "Pay " + coins(total), "primary", total < pd.amount) + (ui.paySel.size ? btn("payclear", "Clear", "ghost") : "");
      }
    } else {
      tone = "wait";
      const verb = pd.stage === "pay" ? "choosing how to pay " + coins(pd.amount) : pd.stage === "counter" ? "deciding whether to counter the Nope!" : "deciding whether to play Nope!";
      html = '<div class="pt"><b>' + esc(pd.label) + " · " + esc(from.name) + " → " + esc(target.name) + "</b><span>" + what + " Waiting for " + esc(resp ? resp.name : "") + ", " + verb + "…</span></div>";
    }
  } else if (!myTurnFree()) {
    tone = "wait"; html = '<div class="pt"><b>' + esc(cur().name) + " is playing</b><span>You'll be asked if an action targets you.</span></div>";
  } else if (ui.mode) {
    html = modePrompt(me); tone = "aim";
  } else if (ui.selected) {
    html = cardOptions(me); tone = "pick";
  } else {
    html = '<div class="pt"><b>Your move · ' + game.plays + " play" + (game.plays === 1 ? "" : "s") + " left</b><span>" + (game.plays ? "Tap a card in your hand. Wild cards on your table can be flipped any time (free)." : "You've used your 3 plays. Your turn ends automatically.") + "</span></div>" + btn("end", "End turn →", game.plays ? "ghost" : "primary");
  }
  el.className = "prompt " + tone; el.innerHTML = html;
}
function btn(act, label, kind = "ghost", disabled = false) { return '<button class="pbtn ' + kind + '" data-act="btn" data-do="' + act + '"' + (disabled ? " disabled" : "") + ">" + label + "</button>"; }
function pendingDetail(pd, target) {
  if (pd.kind === "sly") return "Takes " + esc(target.name) + "'s " + esc(cardName(findProp(target.id, pd.takeId))) + " (highlighted).";
  if (pd.kind === "forced") return "Swaps " + esc(P(pd.from).name) + "'s " + esc(cardName(findProp(pd.from, pd.giveId))) + " for " + esc(target.name) + "'s " + esc(cardName(findProp(target.id, pd.takeId))) + ".";
  if (pd.kind === "breaker") return "Takes the complete " + esc(COLORS[pd.stackColor].name) + " set" + (target.builds[pd.stackColor] ? " with its buildings" : "") + ".";
  if (pd.kind === "rent") return esc(COLORS[pd.color].name) + " rent: " + coins(pd.amount) + (pd.doubles ? " (doubled)" : "") + ".";
  if (pd.kind === "debt") return "Owes 5 coins.";
  if (pd.kind === "birthday") return "Each player gives 2 coins.";
  return "";
}
function modePrompt(me) {
  const m = ui.mode;
  if (m.kind === "sly") { const c = m.takeId && findProp(m.owner, m.takeId);
    return '<div class="pt"><b>☞ Steal</b><span>' + (c ? "Take " + esc(P(m.owner).name) + "'s " + esc(cardName(c)) + "?" : "Tap a glowing property on an opponent's table (not part of a full set).") + "</span></div>" + btn("confirm", "Steal it", "primary", !c) + btn("cancel", "Cancel"); }
  if (m.kind === "forced") { const t = m.takeId && findProp(m.owner, m.takeId), g = m.giveId && findProp(me.id, m.giveId);
    return '<div class="pt"><b>⇄ Swap</b><span>' + (t ? "Take <strong>" + esc(cardName(t)) + "</strong> from " + esc(P(m.owner).name) : "① Tap the property you want from an opponent") + " · " + (g ? "give <strong>" + esc(cardName(g)) + "</strong>" : "② tap one of yours to give away") + "</span></div>" + btn("confirm", "Swap", "primary", !(t && g)) + btn("cancel", "Cancel"); }
  if (m.kind === "breaker") return '<div class="pt"><b>⚡ Takeover</b><span>' + (m.owner ? "Take " + esc(P(m.owner).name) + "'s complete " + esc(COLORS[m.stackColor].name) + " set?" : "Tap a complete set on an opponent's table.") + "</span></div>" + btn("confirm", "Take it over", "primary", !m.owner) + btn("cancel", "Cancel");
  if (m.kind === "rent") {
    const card = me.hand.find((x) => x.id === m.cardId), dbl = doublesInHand(me), maxD = Math.min(dbl.length, game.plays - 1);
    const base = m.color ? rentFor(me, m.color) : 0, amt = base * Math.pow(2, m.doubles || 0);
    const who = card.any ? (m.target ? esc(P(m.target).name) : "①&nbsp;tap an opponent") : "every other player";
    return '<div class="pt"><b>Charge rent</b><span>' + (m.color ? esc(COLORS[m.color].name) + " · <strong>" + coins(amt) + "</strong>" : "Tap one of your glowing property sets") + " → " + who + "</span></div>" +
      (maxD > 0 ? btn("double", "×2 Rent Hike" + (m.doubles ? " ✓" + (m.doubles > 1 ? m.doubles : "") : "") + " (" + dbl.length + ")", m.doubles ? "on" : "ghost") : "") +
      btn("confirm", m.color ? "Charge " + coins(amt) : "Charge", "primary", !m.color || (card.any && !m.target)) + btn("cancel", "Cancel");
  }
  if (m.kind === "debt") return '<div class="pt"><b>$ Collections</b><span>' + (m.target ? esc(P(m.target).name) + " pays you 5 coins." : "Tap an opponent's area to choose who pays 5 coins.") + "</span></div>" + btn("confirm", "Collect 5 coins", "primary", !m.target) + btn("cancel", "Cancel");
  if (m.kind === "build") return '<div class="pt"><b>' + (m.effect === "house" ? "⌂ House" : "▣ Tower") + "</b><span>" + (m.color ? "Add to your " + esc(COLORS[m.color].name) + " set?" : "Tap one of your glowing complete sets.") + "</span></div>" + btn("confirm", "Build", "primary", !m.color) + btn("cancel", "Cancel");
  if (m.kind === "wildplay" || m.kind === "flip") {
    const c = m.kind === "flip" ? me.props.find((x) => x.id === m.cardId) : me.hand.find((x) => x.id === m.cardId);
    return '<div class="pt"><b>' + (m.kind === "flip" ? "Flip wild card" : "Place wild card") + "</b><span>Choose a colour" + (m.kind === "flip" ? ". Moving wilds is free on your turn." : ".") + '</span></div><div class="swatches">' +
      c.colors.filter((k) => m.kind !== "flip" || k !== c.color).map((k) => '<button class="sw" data-act="btn" data-do="color" data-color="' + k + '" style="--c:' + COLORS[k].hex + ";--bi:" + COLORS[k].ink + '">' + esc(COLORS[k].name) + "</button>").join("") + "</div>" + btn("cancel", "Cancel");
  }
  if (m.kind === "discard") { const n = me.hand.length - 7;
    return '<div class="pt"><b>Hand limit is 7</b><span>Tap ' + n + " card" + (n === 1 ? "" : "s") + " in your hand to discard. Selected " + m.sel.length + "/" + n + "</span></div>" + btn("confirm", "Discard & end turn", "primary", m.sel.length !== n) + btn("cancel", "Back"); }
  return "";
}
function cardOptions(me) {
  const c = me.hand.find((x) => x.id === ui.selected); if (!c) return "";
  const noPlays = game.plays <= 0;
  let info = "", btns = "";
  const bankBtn = (kind) => btn("bank", "Bank " + coins(c.value), kind, noPlays);
  if (c.type === "money") { info = "Bank it to pay debts later."; btns = bankBtn("primary"); }
  else if (c.type === "property") { info = COLORS[c.color].name + " · " + COLORS[c.color].need + " make a full set. Worth " + coins(c.value) + " as payment."; btns = btn("property", "Play to table", "primary", noPlays); }
  else if (c.type === "wild") { info = (c.any ? "Counts as any colour. Worth nothing, so it can't be used to pay." : "Counts as " + c.colors.map((k) => COLORS[k].name).join(" or ") + ". Flip it any time on your turn."); btns = btn("property", "Play to table", "primary", noPlays); }
  else if (c.type === "rent") { info = c.any ? "Charge ONE player rent on any colour you own." : "Charge EVERY player rent on " + c.colors.map((k) => COLORS[k].name).join(" or ") + "."; btns = btn("play", "Charge rent", "primary", noPlays) + bankBtn("ghost"); }
  else {
    const a = ACTIONS[c.effect]; info = a.text;
    if (c.effect === "no") { info += " Keep it in your hand; you'll be offered it when an action hits you."; btns = bankBtn("ghost"); }
    else if (c.effect === "double") { info += " Choose it from the rent screen."; btns = bankBtn("ghost"); }
    else btns = btn("play", "Play " + a.name, "primary", noPlays) + bankBtn("ghost");
  }
  return '<div class="pt"><b>' + esc(cardName(c)) + "</b><span>" + esc(info) + (noPlays ? " <strong>No plays left.</strong>" : "") + "</span></div>" + btns + btn("deselect", "✕", "ghost x");
}

function renderHand(me) {
  const wrap = $("hand"), canSee = !isOnline() ? ui.revealedFor === me.id : true;
  if (!canSee) { wrap.innerHTML = '<div class="hand-hidden">' + me.hand.map(() => '<span class="hb"></span>').join("") + "</div>"; return; }
  const disc = ui.mode && ui.mode.kind === "discard";
  wrap.innerHTML = me.hand.map((c, i) => {
    const sel = ui.selected === c.id || (disc && ui.mode.sel.includes(c.id));
    return '<button class="hc' + (sel ? " sel" : "") + (disc ? " discarding" : "") + '" style="--i:' + i + ";--n:" + me.hand.length + '" data-act="hand" data-id="' + c.id + '" aria-label="' + esc(cardName(c)) + '">' + cardFace(c) + "</button>";
  }).join("") || '<div class="hand-empty">No cards in hand. You\'ll draw 5 next turn.</div>';
  $("handLbl").textContent = isOnline() ? "Your hand · " + me.hand.length : me.name + "'s hand · " + me.hand.length;
}
function renderCurtain(me) {
  const c = $("curtain");
  if (isOnline() || game.winner || ui.revealedFor === me.id) { c.hidden = true; return; }
  const pd = game.pending;
  const why = pd && responderId() === me.id ? (pd.stage === "counter" ? P(pd.targets[pd.ti]).name + " played Nope! on your " + pd.label + "." : P(pd.from).name + " played " + pd.label + " on you.") : "It's your turn.";
  c.hidden = false;
  c.innerHTML = '<div class="curtain-card"><span class="avatar xl" style="--av:' + me.color + '">' + esc(me.name.charAt(0).toUpperCase()) + "</span><h2>Pass to " + esc(me.name) + "</h2><p>" + esc(why) + "</p><button class=\"pbtn primary\" data-act=\"btn\" data-do=\"reveal\">I'm " + esc(me.name) + ", show my cards</button></div>";
}
let turnSeen = { key: null, at: 0 };
function turnStartedAt() {
  // Online, other devices' clocks can differ, so time each turn from when this device first saw it.
  const key = game.id + ":" + game.turnNo;
  if (turnSeen.key !== key) turnSeen = { key, at: isOnline() ? Date.now() : game.turnStarted };
  return turnSeen.at;
}
function renderTimer() {
  if (!game) return;
  const left = Math.max(0, 240 - Math.floor((Date.now() - turnStartedAt()) / 1000));
  $("timer").textContent = String(Math.floor(left / 60)).padStart(1, "0") + ":" + String(left % 60).padStart(2, "0");
  $("timer").classList.toggle("low", left <= 30);
}
setInterval(renderTimer, 1000);

/* keep ui consistent with state */
function validateUi() {
  if (!game) return;
  const vid = viewerId(), me = P(vid);
  if (ui.lastViewer !== vid) { ui.lastViewer = vid; ui.paySel.clear(); if (isOnline()) ui.revealedFor = vid; }
  if (game.pending || !myTurnFree()) { if (ui.mode && ui.mode.kind !== "discard") ui.mode = null; ui.selected = null; }
  if (ui.selected && !me.hand.some((c) => c.id === ui.selected)) ui.selected = null;
  if (ui.mode && ui.mode.cardId && ui.mode.kind !== "flip" && !me.hand.some((c) => c.id === ui.mode.cardId)) ui.mode = null;
  if (!(game.pending && game.pending.stage === "pay")) ui.paySel.clear();
}

/* ---------------- interaction ---------------- */
function act(fn) { fn(); ui.selected = null; ui.mode = null; render(); commit(); }

function startCardPlay(c) {
  const me = cur();
  if (game.plays <= 0) return toast("No plays left this turn.");
  if (c.type === "rent") {
    const cols = rentColors(me, c);
    if (!cols.length) return toast(c.any ? "You need at least one property to charge rent." : "You don't own any " + c.colors.map((k) => COLORS[k].name).join(" or ") + " to charge rent on.");
    ui.mode = { kind: "rent", cardId: c.id, color: cols.length === 1 ? cols[0] : null, target: null, doubles: 0 };
    if (c.any && game.players.length === 2) ui.mode.target = others(me.id)[0].id;
    return render();
  }
  switch (c.effect) {
    case "passgo": return act(() => playPassGo(c.id));
    case "birthday": return act(() => launchAction({ kind: "birthday", cardId: c.id, targets: others(me.id).map((o) => o.id), amount: 2 }));
    case "debt": ui.mode = { kind: "debt", cardId: c.id, target: game.players.length === 2 ? others(me.id)[0].id : null }; return render();
    case "sly": if (!slyTargets(me.id).length) return toast("No opponent has a property outside a full set."); ui.mode = { kind: "sly", cardId: c.id }; return render();
    case "forced":
      if (!slyTargets(me.id).length) return toast("No opponent has a property outside a full set.");
      if (!me.props.length) return toast("You need a property of your own to swap.");
      ui.mode = { kind: "forced", cardId: c.id }; return render();
    case "breaker": if (!breakerTargets(me.id).length) return toast("Nobody has a complete set to steal yet."); ui.mode = { kind: "breaker", cardId: c.id }; return render();
    case "house": case "hotel": {
      const cols = buildColors(me, c.effect);
      if (!cols.length) return toast(c.effect === "house" ? "You need a complete set (not Transit or Power) without a House." : "You need a complete set that already has a House.");
      ui.mode = { kind: "build", effect: c.effect, cardId: c.id, color: cols.length === 1 ? cols[0] : null }; return render();
    }
  }
}

function confirmMode() {
  const m = ui.mode, me = cur(); if (!m) return;
  if (m.kind === "sly" && m.takeId) return act(() => launchAction({ kind: "sly", cardId: m.cardId, targets: [m.owner], takeId: m.takeId }));
  if (m.kind === "forced" && m.takeId && m.giveId) return act(() => launchAction({ kind: "forced", cardId: m.cardId, targets: [m.owner], takeId: m.takeId, giveId: m.giveId }));
  if (m.kind === "breaker" && m.owner) return act(() => launchAction({ kind: "breaker", cardId: m.cardId, targets: [m.owner], stackColor: m.stackColor }));
  if (m.kind === "debt" && m.target) return act(() => launchAction({ kind: "debt", cardId: m.cardId, targets: [m.target], amount: 5 }));
  if (m.kind === "build" && m.color) return act(() => playBuilding(m.cardId, m.color));
  if (m.kind === "rent" && m.color) {
    const card = me.hand.find((x) => x.id === m.cardId); if (card.any && !m.target) return;
    const doubleIds = doublesInHand(me).slice(0, m.doubles || 0).map((c) => c.id);
    const amount = rentFor(me, m.color) * Math.pow(2, doubleIds.length);
    return act(() => launchAction({ kind: "rent", cardId: m.cardId, targets: card.any ? [m.target] : others(me.id).map((o) => o.id), amount, color: m.color, doubleIds }));
  }
  if (m.kind === "discard") {
    const n = me.hand.length - 7; if (m.sel.length !== n) return;
    return act(() => { discardFromHand(m.sel); endTurn(); });
  }
}

function onTableCard(owner, id) {
  const m = ui.mode, pd = game.pending;
  if (pd && pd.stage === "pay" && iCanAct()) { if (owner !== viewerId()) return; togglePay(id); return; }
  if (!myTurnFree()) return;
  const me = cur();
  if (m && m.kind === "debt" && owner !== me.id) { m.target = owner; return render(); }
  if (m && m.kind === "sly") {
    if (owner === me.id) return toast("Pick a card from an opponent's table.");
    if (inFullSet(P(owner), id)) return toast("That card is part of a full set, so Steal can't take it.");
    m.owner = owner; m.takeId = id; return render();
  }
  if (m && m.kind === "forced") {
    if (owner === me.id) { m.giveId = id; }
    else { if (inFullSet(P(owner), id)) return toast("That card is part of a full set, so it can't be swapped."); m.owner = owner; m.takeId = id; }
    return render();
  }
  if (m && (m.kind === "breaker" || m.kind === "rent" || m.kind === "build")) {
    const c = P(owner).props.find((x) => x.id === id); if (c) onStack(owner, c.color); return;
  }
  if (!m && owner === me.id) {
    const c = me.props.find((x) => x.id === id);
    if (c && c.type === "wild") { ui.selected = null; ui.mode = { kind: "flip", cardId: c.id }; return render(); }
  }
}
function onStack(owner, color) {
  const m = ui.mode, me = cur(); if (!m || !myTurnFree()) return;
  if (m.kind === "debt") { if (owner !== me.id) { m.target = owner; render(); } return; }
  if (m.kind === "breaker") {
    if (owner === me.id) return toast("Choose an opponent's complete set.");
    if (!stacksFor(P(owner), color).some((s) => s.complete)) return toast("Takeover only takes complete sets.");
    m.owner = owner; m.stackColor = color; return render();
  }
  if (m.kind === "rent") {
    if (owner !== me.id) { const card = me.hand.find((x) => x.id === m.cardId); if (card && card.any) { m.target = owner; return render(); } return toast("Tap one of your own sets to charge rent on."); }
    const card = me.hand.find((x) => x.id === m.cardId);
    if (!rentColors(me, card).includes(color)) return toast("This rent card can't charge " + COLORS[color].name + ".");
    m.color = color; return render();
  }
  if (m.kind === "build") {
    if (owner !== me.id || !buildColors(me, m.effect).includes(color)) return toast("Not an eligible set for this building.");
    m.color = color; return render();
  }
}
function togglePay(id) { if (ui.paySel.has(id)) ui.paySel.delete(id); else ui.paySel.add(id); render(); }

document.addEventListener("click", (e) => {
  if (!game) return;
  const t = e.target.closest("[data-act]"); if (!t) return;
  const a = t.dataset.act;
  if (a === "btn") return onButton(t.dataset.do, t);
  if (!isOnline() && $("curtain") && !$("curtain").hidden) return;
  if (a === "hand") return onHand(t.dataset.id);
  if (a === "bank" || a === "build") { const pd = game.pending; if (pd && pd.stage === "pay" && iCanAct() && t.dataset.owner === viewerId()) togglePay(t.dataset.id); return; }
  if (a === "tcard") { e.stopPropagation(); return onTableCard(t.dataset.owner, t.dataset.id); }
  if (a === "stack") return onStack(t.dataset.owner, t.dataset.color);
  if (a === "seat") {
    const m = ui.mode; if (!m || !myTurnFree()) return;
    if (m.kind === "debt") { m.target = t.dataset.owner; return render(); }
    if (m.kind === "rent") { const card = cur().hand.find((x) => x.id === m.cardId); if (card && card.any) { m.target = t.dataset.owner; render(); } }
  }
});
function onHand(id) {
  if (!myTurnFree()) { if (game.pending) toast("Respond to the action first."); return; }
  const m = ui.mode;
  if (m && m.kind === "discard") { m.sel = m.sel.includes(id) ? m.sel.filter((x) => x !== id) : m.sel.length < cur().hand.length - 7 ? [...m.sel, id] : m.sel; return render(); }
  ui.mode = null; ui.selected = ui.selected === id ? null : id; render();
}
function onButton(d, el) {
  const me = game ? P(viewerId()) : null;
  switch (d) {
    case "reveal": ui.revealedFor = viewerId(); return render();
    case "newgame": return confirmNewGame();
    case "restart": if (room && !room.host) return toast("Only the room host can start a new round."); return restartGame();
    case "deselect": ui.selected = null; return render();
    case "cancel": if (ui.mode && ui.mode.kind === "discard") { ui.mode = null; return render(); } ui.mode = null; ui.selected = null; return render();
    case "end": return tryEndTurn();
    case "bank": if (myTurnFree() && ui.selected) return act(() => bankCard(ui.selected)); return;
    case "property": {
      if (!myTurnFree() || !ui.selected) return;
      const c = me.hand.find((x) => x.id === ui.selected); if (!c) return;
      if (c.type === "wild") { ui.mode = { kind: "wildplay", cardId: c.id }; ui.selected = null; return render(); }
      return act(() => playProperty(c.id));
    }
    case "play": { if (!myTurnFree() || !ui.selected) return; const c = me.hand.find((x) => x.id === ui.selected); ui.selected = null; if (c) startCardPlay(c); return; }
    case "color": {
      const m = ui.mode, k = el.dataset.color; if (!m || !myTurnFree()) return;
      if (m.kind === "wildplay") return act(() => playProperty(m.cardId, k));
      if (m.kind === "flip") return act(() => recolorWild(m.cardId, k));
      return;
    }
    case "double": { const m = ui.mode; if (!m) return; const maxD = Math.min(doublesInHand(cur()).length, game.plays - 1); m.doubles = ((m.doubles || 0) + 1) % (maxD + 1); return render(); }
    case "confirm": return confirmMode();
    case "no": if (iCanAct()) { ui.paySel.clear(); respondNo(); render(); commit(); } return;
    case "accept": if (iCanAct()) { respondAccept(); render(); commit(); } return;
    case "payclear": ui.paySel.clear(); return render();
    case "pay": {
      if (!iCanAct()) return; const pd = game.pending; if (!pd || pd.stage !== "pay") return;
      const ids = [...ui.paySel], total = sum(payable(me).filter((a) => ids.includes(a.id)));
      if (total < pd.amount) return toast("Select at least " + coins(pd.amount) + ".");
      ui.paySel.clear(); submitPayment(ids); render(); commit(); return;
    }
  }
}
function tryEndTurn() {
  if (!myTurnFree()) return;
  const me = cur();
  if (me.hand.length > 7) { ui.selected = null; ui.mode = { kind: "discard", sel: [] }; return render(); }
  act(() => endTurn());
}
$("endTurnBtn").addEventListener("click", tryEndTurn);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && game) { ui.mode = null; ui.selected = null; render(); } });

/* ---------------- feedback ---------------- */
let toastT = null;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.className = "toast show"; clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), 2400); }
let flashT = null;
function flash(title, sub, kind) {
  const f = $("flash"); f.className = "flash show " + (kind || "");
  f.innerHTML = "<b>" + esc(title) + "</b><span>" + esc(sub) + "</span>";
  clearTimeout(flashT); flashT = setTimeout(() => (f.className = "flash"), 1700);
}
let lastLogTop = null;
function announceRemote() {
  if (!game || !game.log.length) return;
  const top = game.log[0];
  const title = /Nope!/.test(top.text) ? "NOPE!" : / stole /.test(top.text) ? "STEAL!" : / swapped /.test(top.text) ? "SWAP!" : / took over /.test(top.text) ? "TAKEOVER!" : null;
  if (lastLogTop && top.t !== lastLogTop && title) flash(title, top.text.replace(/^[^A-Za-z]+/, ""), title === "NOPE!" ? "no" : "steal");
  lastLogTop = top.t;
}

/* ---------------- modals ---------------- */
function openModal(title, body) {
  const r = $("modal"); r.hidden = false;
  r.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true"><header><h2>' + esc(title) + '</h2><button class="x" id="modalX" aria-label="Close">×</button></header><div class="modal-body">' + body + "</div></div>";
  $("modalX").onclick = closeModal; r.onclick = (e) => { if (e.target === r) closeModal(); };
}
function closeModal() { $("modal").hidden = true; $("modal").innerHTML = ""; }
function showRules() {
  openModal("How to play", `
  <p class="lead">Be the first to collect <b>3 complete property sets in different colours</b>.</p>
  <h3>Your turn</h3><ol><li>Draw 2 cards, or 5 if your hand is empty.</li><li>Play up to <b>3 cards</b>: bank coins or actions, lay down properties, or play actions.</li><li>End with 7 cards or fewer. After your third play the turn ends by itself.</li></ol>
  <h3>Paying</h3><p>Pay with coins from your bank, buildings or properties on your table, never from your hand. No change is given. If you can't cover the bill, you pay everything you have. The Rainbow Wild is worth nothing.</p>
  <h3>Coins</h3><p class="coin-key">${DENOMS.map((n) => coin(n)).join("")}<span>Each colour is a different value.</span></p>
  <h3>Taking cards (tap the table)</h3><ul><li><b>Steal</b>: tap one opponent property that isn't in a full set.</li><li><b>Swap</b>: tap their card (not from a full set), then any one of yours, even from a full set.</li><li><b>Takeover</b>: tap an opponent's complete set. Its buildings come with it.</li></ul>
  <h3>Nope!</h3><p>When an action targets you, you can block it with a Nope! card. The attacker can Nope! you back, you can reply again, and so on. It never uses one of your 3 plays. Against Housewarming or a two-colour Rent it only protects you.</p>
  <h3>Rent</h3><ul><li><b>Two-colour Rent</b> charges <b>every</b> player. <b>Wild Rent</b> charges <b>one</b> player for any colour you own.</li><li><b>Rent Hike</b> doubles a Rent card and uses a play too.</li><li>A <b>House</b> adds 3 coins and a <b>Tower</b> adds 4 coins to a full set's rent (not Transit or Power).</li></ul>
  <h3>Wild properties</h3><p>Tap a wild on your table to flip or move it. It's free, any time on your turn.</p>`);
}
$("rulesBtn").addEventListener("click", showRules);
$("logToggle").addEventListener("click", () => { ui.logOpen = !ui.logOpen; $("logToggle").textContent = ui.logOpen ? "Less" : "More"; render(); });
function confirmNewGame() {
  const online = !!room;
  openModal(online ? "Leave this game?" : "Quit this game?", "<p>" + (online ? "You'll leave room " + esc(room.code) + " and go back to the home screen. Friends can keep playing without you." : "This ends the current game and takes you back to the home screen.") + '</p><div class="mrow"><button class="pbtn ghost" id="ngNo">Keep playing</button><button class="pbtn primary" id="ngYes">' + (online ? "Leave game" : "Quit game") + "</button></div>");
  $("ngNo").onclick = closeModal;
  $("ngYes").onclick = async () => { closeModal(); if (room) await leaveRoom(); showSetup(); };
}
$("newGameBtn").addEventListener("click", confirmNewGame);
function confirmRestart() {
  if (!game) return;
  if (room && !room.host) return toast("Only the room host can restart.");
  openModal("Restart the game?", "<p>Everyone gets a fresh deal" + (room ? " and stays in room " + esc(room.code) : " with the same players") + '.</p><div class="mrow"><button class="pbtn ghost" id="rsNo">Keep playing</button><button class="pbtn primary" id="rsYes">Restart</button></div>');
  $("rsNo").onclick = closeModal;
  $("rsYes").onclick = () => { closeModal(); restartGame(); };
}
function restartGame() {
  const names = game ? game.players.map((p) => p.name) : [];
  if (!names.length) return;
  newGame(names); ui.mode = null; ui.selected = null; ui.paySel.clear();
  ui.revealedFor = cur().id; log("↻ Game restarted" + (room ? " by " + room.name : "") + ".");
  render(); commit(); toast("Fresh deal. Good luck!");
}
$("restartBtn").addEventListener("click", confirmRestart);

/* ---------------- setup screen ---------------- */
let localCount = 2;
function renderNameFields() {
  const prev = [...$("nameFields").querySelectorAll("input")].map((i) => i.value);
  $("nameFields").innerHTML = Array.from({ length: localCount }, (_, i) =>
    '<label class="name-row"><span class="avatar" style="--av:' + AVATAR_COLORS[i] + '">' + (i + 1) + '</span><input maxlength="18" autocomplete="off" placeholder="Player ' + (i + 1) + '" value="' + esc(prev[i] ?? (i < 2 ? "Player " + (i + 1) : "")) + '"></label>').join("");
  document.querySelectorAll(".count-btn").forEach((b) => b.classList.toggle("on", Number(b.dataset.count) === localCount));
}
document.querySelectorAll(".count-btn").forEach((b) => b.addEventListener("click", () => { localCount = Number(b.dataset.count); renderNameFields(); }));
$("startBtn").addEventListener("click", () => {
  const names = [...$("nameFields").querySelectorAll("input")].map((i, n) => i.value.trim() || "Player " + (n + 1));
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return toast("Give each player a different name.");
  newGame(names); ui.revealedFor = cur().id; showGame(); render();
});
function showSetup() { game = null; ui.mode = null; ui.selected = null; $("setup").hidden = false; $("game").hidden = true; $("newGameBtn").hidden = true; $("restartBtn").hidden = true; $("curtain").hidden = true; renderNameFields(); }
function showGame() { $("setup").hidden = true; $("game").hidden = false; $("newGameBtn").hidden = false; $("newGameBtn").textContent = room ? "🚪 Leave game" : "🚪 Quit game"; $("restartBtn").hidden = !!(room && !room.host); }

/* ---------------- online rooms ---------------- */
let room = null, roomInfo = null, pollT = null, saving = false, saveQueued = false;
const isOnline = () => !!(room && room.status === "playing");
function myOnlineId() { if (!game || !room) return null; const p = game.players.find((x) => x.name === room.name); return p ? p.id : null; }
function roomMsg(m, err) { $("roomMsg").textContent = m || ""; $("roomMsg").classList.toggle("err", !!err); }
async function roomCall(body, method = "POST") {
  const url = API + "/api/rooms" + (method === "GET" ? "?code=" + encodeURIComponent(body.code) + "&token=" + encodeURIComponent(body.token || "") : "");
  let r;
  try { r = await fetch(url, { method, headers: method === "GET" ? {} : { "Content-Type": "text/plain;charset=UTF-8" }, body: method === "GET" ? undefined : JSON.stringify(body) }); }
  catch (e) { throw new Error(navigator.onLine === false ? "You're offline. Online rooms need an internet connection; same-device games still work." : "Couldn't reach the room service. Check your connection and try again."); }
  const data = await r.json().catch(() => ({ error: "The room service returned an unreadable response." }));
  if (data && data.live) liveSupported = true;
  if (!r.ok) { const err = new Error(data.error || "Room request failed."); err.data = data; err.status = r.status; throw err; }
  return data;
}
function saveRoomLocal() { try { if (room) localStorage.setItem("dealTableRoom3", JSON.stringify({ code: room.code, token: room.token, name: room.name, host: room.host })); else localStorage.removeItem("dealTableRoom3"); } catch (e) {} }
function renderLobby(r) {
  roomInfo = r; $("lobby").hidden = false; $("roomCode").textContent = r.code;
  $("lobbyPlayers").innerHTML = (r.players || []).map((p, i) => '<li><span class="avatar" style="--av:' + AVATAR_COLORS[i % 5] + '">' + esc(p.name.charAt(0).toUpperCase()) + "</span>" + esc(p.name) + (p.isHost ? "<small>host</small>" : "") + (room && p.name === room.name ? "<small>you</small>" : "") + "</li>").join("");
  $("lobbyStatus").textContent = r.status === "playing" ? "Game in progress" : r.players.length < 2 ? "Waiting for at least one more player…" : r.players.length + " players ready";
  $("startRoomBtn").hidden = !(room && room.host && r.status === "lobby");
  $("startRoomBtn").disabled = (r.players || []).length < 2;
  $("modeLbl").textContent = "ROOM " + r.code;
}
function applyRemote(r) {
  if (!r.gameState) return;
  if (r.gameState.v !== STATE_VERSION) { roomMsg("This room was started on an older version of the table. Create a new room.", true); return; }
  game = r.gameState; room.revision = r.revision; room.status = "playing";
  showGame(); announceRemote(); render();
}
function onRoomData(r) {
  if (!room || !r) return;
  if (r.status !== "playing") { room.status = r.status; renderLobby(r); return; }
  if (!game || r.revision > (room.revision || 0) || room.status !== "playing") { renderLobby(r); applyRemote(r); }
}
async function poll() {
  if (!room || saving) return;
  try {
    const { room: r } = await roomCall({ code: room.code, token: room.token }, "GET");
    if (!room) return; // left while the request was in flight
    onRoomData(r);
    if (liveSupported && !live && !liveT && liveTries < 5) connectLive();
  } catch (e) { if (e.status === 403 || e.status === 404) { roomMsg(e.message, true); closeLive(); stopChat(); room = null; saveRoomLocal(); clearInterval(pollT); } }
}
// Polling is the fallback. With a live connection it only runs as a slow safety net.
function setPolling() {
  clearInterval(pollT); pollT = setInterval(poll, liveUp ? 15000 : 1200);
  if (chat.timer) { clearInterval(chat.timer); chat.timer = setInterval(pollChat, liveUp ? 20000 : 1500); }
}
function startPolling() { poll(); setPolling(); if (liveSupported) connectLive(); }

/* Live connection: the Cloudflare server pushes room and chat changes over a WebSocket the moment they happen.
   Servers without /api/live (the Node server, Hatchable) simply keep polling. */
let live = null, liveUp = false, liveTries = 0, liveT = null, liveQueued = null, liveSupported = false;
function liveURL() { return (API || location.origin).replace(/^http/, "ws") + "/api/live?code=" + encodeURIComponent(room.code) + "&token=" + encodeURIComponent(room.token); }
function connectLive() {
  closeLive();
  if (!room || !window.WebSocket) return;
  let ws; try { ws = new WebSocket(liveURL()); } catch (e) { return; }
  live = ws;
  ws.onopen = () => { if (live !== ws) return; liveUp = true; liveTries = 0; setPolling(); };
  ws.onmessage = (e) => {
    if (live !== ws) return; let d; try { d = JSON.parse(e.data); } catch (err) { return; }
    if (d.type === "room") { if (saving || saveQueued) liveQueued = d.room; else onRoomData(d.room); }
    else if (d.type === "chat" && d.message) addMessages([d.message]);
  };
  ws.onclose = () => {
    if (live !== ws) return;
    const wasUp = liveUp; live = null; liveUp = false;
    if (!room) return;
    setPolling(); poll();
    // Reconnect after drops; give up quietly on servers that have no live endpoint.
    if (wasUp || liveTries < 5) liveT = setTimeout(connectLive, Math.min(15000, 1000 * 2 ** liveTries++));
  };
}
function closeLive() { clearTimeout(liveT); liveT = null; const ws = live; live = null; liveUp = false; if (ws) { try { ws.close(); } catch (e) {} } }
setInterval(() => { if (live && liveUp) { try { live.send("ping"); } catch (e) {} } }, 25000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && room && !live) { liveTries = 0; connectLive(); } });
async function commit() {
  if (!isOnline() || !game) return;
  if (saving) { saveQueued = true; return; }
  saving = true;
  try {
    const { room: r } = await roomCall({ action: "save", code: room.code, token: room.token, revision: room.revision, gameState: game });
    room.revision = r.revision;
  } catch (e) {
    if (e.data && e.data.room) { toast("Another move landed first. The table is up to date now."); applyRemote(e.data.room); }
    else toast("Connection hiccup. Retrying…");
  } finally {
    saving = false;
    if (saveQueued) { saveQueued = false; commit(); }
    else if (liveQueued) { const q = liveQueued; liveQueued = null; onRoomData(q); }
  }
}
$("createRoomBtn").addEventListener("click", async () => {
  const name = $("roomName").value.trim(); if (!name) return roomMsg("Enter your name first.", true);
  roomMsg("Creating room…");
  try { const d = await roomCall({ action: "create", name }); room = { code: d.room.code, token: d.token, name, host: true, status: "lobby", revision: d.room.revision }; saveRoomLocal(); renderLobby(d.room); startPolling(); startChat(); roomMsg("Share the code with your friends."); }
  catch (e) { roomMsg(e.message, true); }
});
$("joinRoomBtn").addEventListener("click", async () => {
  const name = $("roomName").value.trim(), code = $("roomCodeIn").value.trim().toUpperCase();
  if (!name) return roomMsg("Enter your name first.", true); if (!code) return roomMsg("Enter the room code.", true);
  roomMsg("Joining…");
  try { const d = await roomCall({ action: "join", code, name }); room = { code: d.room.code, token: d.token, name, host: false, status: d.room.status, revision: d.room.revision }; saveRoomLocal(); renderLobby(d.room); startPolling(); startChat(); roomMsg("You're in. Waiting for the host to start."); }
  catch (e) { roomMsg(e.message, true); }
});
$("startRoomBtn").addEventListener("click", async () => {
  if (!room || !room.host || !roomInfo || roomInfo.players.length < 2) return;
  newGame(roomInfo.players.map((p) => p.name));
  try { const d = await roomCall({ action: "start", code: room.code, token: room.token, gameState: game }); room.status = "playing"; room.revision = d.room.revision; showGame(); render(); }
  catch (e) { game = null; roomMsg(e.message, true); }
});
async function leaveRoom() {
  clearInterval(pollT); closeLive();
  if (room) { try { await roomCall({ action: "leave", code: room.code, token: room.token }); } catch (e) {} }
  stopChat(); room = null; roomInfo = null; savedRoom = null; saveRoomLocal(); $("lobby").hidden = true; $("rejoin").hidden = true; $("modeLbl").textContent = "LOCAL TABLE"; roomMsg("");
}
$("leaveRoomBtn").addEventListener("click", async () => { await leaveRoom(); roomMsg("Left the room."); });
$("copyCodeBtn").addEventListener("click", async () => { if (!room) return; try { await navigator.clipboard.writeText(room.code); roomMsg("Code copied."); } catch (e) { roomMsg("Your code is " + room.code); } });
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
  $("tabLocal").hidden = b.dataset.tab !== "local"; $("tabOnline").hidden = b.dataset.tab !== "online";
}));
// A remembered room is offered as "Rejoin" on the home screen instead of pulling the player straight back in.
let savedRoom = null;
try { const s = JSON.parse(localStorage.getItem("dealTableRoom3") || "null"); if (s && s.code && s.token) savedRoom = s; } catch (e) {}
if (savedRoom) { $("rejoin").hidden = false; $("rejoinTxt").textContent = "Room " + savedRoom.code + " · playing as " + savedRoom.name; $("roomName").value = savedRoom.name; }
$("rejoinBtn").addEventListener("click", () => {
  if (!savedRoom) return; room = { ...savedRoom, status: "lobby", revision: 0 }; $("rejoin").hidden = true;
  document.querySelector('[data-tab="online"]').click(); roomMsg("Rejoining…"); startPolling(); startChat();
});
$("forgetBtn").addEventListener("click", async () => { if (!savedRoom) return; room = { ...savedRoom }; await leaveRoom(); roomMsg("Left the room. Start a new game whenever you like."); });

/* ---------------- room chat ---------------- */
const QUICK = ["👍", "😂", "😱", "😡", "Nice move!", "Nope! 😏", "Your turn!", "GG"];
const chat = { after: 0, msgs: [], open: false, unread: 0, timer: null, busy: false, primed: false };
function chatColor(name) { const i = roomInfo ? roomInfo.players.findIndex((p) => p.name === name) : -1; return AVATAR_COLORS[(i < 0 ? 0 : i) % 5]; }
function startChat() { $("chatBtn").hidden = false; clearInterval(chat.timer); pollChat(); chat.timer = setInterval(pollChat, liveUp ? 20000 : 1500); }
function stopChat() { clearInterval(chat.timer); chat.timer = null; chat.primed = false; chat.after = 0; chat.msgs = []; chat.unread = 0; setChatOpen(false); $("chatBtn").hidden = true; }
async function pollChat() {
  if (!room || chat.busy) return; chat.busy = true;
  try {
    const r = await fetch(API + "/api/chat?code=" + encodeURIComponent(room.code) + "&token=" + encodeURIComponent(room.token) + "&after=" + chat.after);
    if (r.ok && room) { const d = await r.json(); if (!room) return; addMessages(d.messages || [], !chat.primed); chat.primed = true; }
  } catch (e) {} finally { chat.busy = false; }
}
function addMessages(list, backlog = false) {
  const fresh = list.filter((m) => m && m.id > chat.after && !chat.msgs.some((x) => x.id === m.id));
  if (!fresh.length) return;
  chat.msgs.push(...fresh); chat.msgs = chat.msgs.slice(-150); chat.after = Math.max(chat.after, ...fresh.map((m) => m.id));
  const theirs = fresh.filter((m) => !room || m.name !== room.name);
  if (!chat.open && theirs.length && !backlog) { chat.unread += theirs.length; peek(theirs[theirs.length - 1]); }
  renderChat();
}
function renderChat() {
  const badge = $("chatBadge"); badge.hidden = !chat.unread; badge.textContent = chat.unread > 9 ? "9+" : String(chat.unread);
  const list = $("chatList"), nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  list.innerHTML = chat.msgs.length ? chat.msgs.map((m) => {
    const mine = room && m.name === room.name, emoji = /^(\p{Extended_Pictographic}️?){1,3}$/u.test(m.body);
    return '<li class="msg' + (mine ? " mine" : "") + (emoji ? " emoji" : "") + '"><div class="mwho" style="--av:' + chatColor(m.name) + '"><i></i>' + esc(mine ? "You" : m.name) + "</div><p>" + esc(m.body) + "</p></li>";
  }).join("") : '<li class="chat-empty">No messages yet. Say hi 👋</li>';
  if (nearBottom || chat.open) list.scrollTop = list.scrollHeight;
}
let peekT = null;
function peek(m) { const el = $("chatPeek"); el.innerHTML = "<b>" + esc(m.name) + "</b>" + esc(m.body); el.classList.add("show"); clearTimeout(peekT); peekT = setTimeout(() => el.classList.remove("show"), 4000); }
function setChatOpen(v) {
  chat.open = v; $("chatPanel").classList.toggle("open", v); $("chatPanel").setAttribute("aria-hidden", String(!v));
  if (v) { chat.unread = 0; $("chatPeek").classList.remove("show"); renderChat(); $("chatList").scrollTop = $("chatList").scrollHeight; if (window.innerWidth > 600) setTimeout(() => $("chatInput").focus(), 220); }
  else renderChat();
}
async function sendChat(text) {
  text = String(text || "").trim(); if (!text || !room) return;
  try {
    const r = await fetch(API + "/api/chat", { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ code: room.code, token: room.token, text }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast(d.error || "Message not sent.");
    addMessages([d.message]); $("chatList").scrollTop = $("chatList").scrollHeight;
  } catch (e) { toast("Message not sent. Check your connection."); }
}
$("chatBtn").addEventListener("click", () => setChatOpen(!chat.open));
$("chatClose").addEventListener("click", () => setChatOpen(false));
$("chatPeek").addEventListener("click", () => setChatOpen(true));
$("chatForm").addEventListener("submit", (e) => { e.preventDefault(); const i = $("chatInput"), t = i.value; i.value = ""; sendChat(t); });
$("chatQuick").innerHTML = QUICK.map((q) => '<button type="button" data-q="' + esc(q) + '">' + esc(q) + "</button>").join("");
$("chatQuick").addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) sendChat(b.dataset.q); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && chat.open) setChatOpen(false); });

/* ---------------- install as an app (PWA) ---------------- */
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installPrompt = null;
function showInstall(v) { $("installBtn").hidden = !v || standalone(); }
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; showInstall(true); });
window.addEventListener("appinstalled", () => { installPrompt = null; showInstall(false); toast("Set & Steal is installed. Find it on your home screen."); });
if (isIOS() && !standalone()) showInstall(true); // iPhone/iPad: Safari has no install prompt, so show instructions instead
$("installBtn").addEventListener("click", async () => {
  if (installPrompt) { installPrompt.prompt(); const r = await installPrompt.userChoice.catch(() => null); installPrompt = null; if (r && r.outcome === "accepted") showInstall(false); return; }
  if (isIOS()) return openModal("Install on iPhone / iPad", '<ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button <span class="kbd">⬆︎</span> at the bottom (or top on iPad).</li><li>Scroll and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p>Set & Steal then opens full-screen from its own icon, and same-device games work offline.</p>');
  openModal("Install the app", '<p>In Chrome or Edge, open the browser menu <span class="kbd">⋮</span> and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>');
});
if (standalone()) document.documentElement.classList.add("is-app");
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

renderNameFields();
window.__deal = { get game() { return game; }, ui, COLORS, rentFor, stacksFor, payable, inFullSet, render, commit, live: () => liveUp }; // debugging hook
})();
