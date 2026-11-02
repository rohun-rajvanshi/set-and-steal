# Architecture

## Overview

```
┌──────────────── browser ────────────────┐            ┌──────── Cloudflare Worker ────────┐
│ public/index.html  layout               │  JSON      │ worker/index.js                   │
│ public/table.css   felt-table design    │ ─────────► │   /api/rooms  /api/chat           │
│ public/app.js      rules engine + UI    │ ◄───────── │   /api/live (WebSocket)           │
│ public/config.js   API address          │  live push │     └─ Durable Object "Room"      │
└─────────────────────────────────────────┘            │        one per room code:         │
                                                       │        room, game, chat           │
                                                       └───────────────────────────────────┘
```

- **All game rules run in the browser** (`app.js`). The server stores and shares state; it doesn't judge moves.
- There's **no build step**. The files in `public/` are served as they are (Cloudflare static assets).
- **Live site:** `worker/index.js` on Cloudflare Workers. Each room code maps to one Durable Object (`Room`), a tiny single-threaded server with its own storage. It keeps the room, the game state and the last 150 chat messages, and deletes itself after 7 days without activity.
- **Elsewhere:** `server.js` serves the same API from `api/rooms.js` and `api/chat.js`, using `lib/db.js` over PostgreSQL or the built-in PostgreSQL ([PGlite](https://pglite.dev)) in `DATA_DIR`. It has no live endpoint, so clients poll it.

## Game state

One JSON object describes the whole game:

```js
{
  v: 3,                       // state version; rooms from older versions are refused
  id, turnNo, current,        // whose turn (index into players)
  plays,                      // plays left this turn (3 at the start)
  deck: [card], discard: [card],
  players: [{ id, name, color, hand: [card], bank: [card], props: [card],
              builds: { red: { house: card, hotel: card } } }],
  pending: null | {...},      // an action waiting for responses (see below)
  winner: null | playerId,
  log: [{ t, text }]          // newest first, last 40
}
```

Card ids such as `sly`, `forced`, `breaker`, `no`, `debt`, `birthday`, `passgo`, `double` and `hotel` are internal names kept for saved games; on screen they are Steal, Swap, Takeover, Nope!, Collections, Housewarming, Payday, Rent Hike and Tower. Likewise the `railroad` and `utility` colours show as Transit and Power.

A **card** looks like `{ id, type, value, ... }`, where `type` is `money`, `property` (`color`), `wild` (`colors`, `color`, `any`), `rent` (`colors`, `any`) or `action` (`effect`).

**Sets** aren't stored. `stacksFor(player, color)` splits a player's cards of one colour into stacks of the set size. A full stack is a complete set, and the leftover cards form an incomplete set that can be stolen.

## Actions and Nope!

Actions that affect other players create `game.pending`:

```js
{ kind: 'sly' | 'forced' | 'breaker' | 'rent' | 'debt' | 'birthday',
  from, targets: [playerId], ti,      // ti = index of the target being resolved
  stage: 'respond' | 'counter' | 'pay',
  chain,                              // Nope! cards played in this exchange
  amount, color, takeId, giveId, stackColor, doubles }
```

`advance()` walks through the targets:

- **respond:** the target decides. With no Nope! in hand they accept automatically.
- **counter:** after a Nope!, the attacker decides whether to answer it. With none they give up automatically.
- **pay:** the payer picks cards. If everything they own is worth no more than the debt, it's taken automatically.

Whoever must decide is the **responder**. Only that player can act until `pending` clears, then play returns to the current player.

## Who sees what

- **Same device:** the viewer is whoever must act. When that changes, a curtain hides the hands until the right player taps to reveal.
- **Online:** each browser is one player, matched by name in the room. Other players' hands are shown only as card counts.

## Online sync

The API is deliberately small:

| Call | Purpose |
| --- | --- |
| `POST /api/rooms {action:'create', name}` | New room. Returns a 6-letter `code` and a private `token`. |
| `POST /api/rooms {action:'join', code, name}` | Join a lobby (up to 5 players) |
| `POST /api/rooms {action:'start', code, token, gameState}` | Host starts the game |
| `POST /api/rooms {action:'save', code, token, revision, gameState}` | Save the new state if `revision` still matches |
| `GET /api/rooms?code&token` | Current room and state |
| `POST /api/rooms {action:'leave', code, token}` | Leave |
| `GET /api/chat?code&token&after=id` | Chat messages after `id` |
| `POST /api/chat {code, token, text}` | Send a message (max 240 characters) |
| `GET /api/live?code&token` (WebSocket) | Cloudflare only: pushed room and chat updates |

- On Cloudflare, every `/api/rooms` response carries `live: true`, and the client then opens a WebSocket to `/api/live?code&token`. The room pushes `{type:"room", room}` after every join, start, save or leave, and `{type:"chat", message}` for each chat message. Durable Object hibernation means idle connections cost nothing; the client sends a `ping` every 25 seconds, answered automatically.
- With a live connection, the client still checks the room every 15 seconds and chat every 20 seconds as a safety net. Without one (Node server), it **polls** the room every 1.2 seconds and chat every 1.5 seconds. Dropped connections reconnect with back-off, and again when the page becomes visible.
- After each move the acting player **saves** the whole state. The save only succeeds if nobody else saved first; on a conflict the client loads the newer state.
- Only players holding the room `token` can read the state or chat.
- POST bodies are sent as `text/plain` JSON so browsers don't need a CORS preflight when the site and API are on different domains. The API sends `Access-Control-Allow-Origin: *`.

## Storage

**Cloudflare:** each `Room` Durable Object stores three keys: `room` (players with their private tokens, status, revision, game state), `messages` (last 150) and `seq` (chat message counter). A room code always reaches the same object, so there's no shared database and no cross-room locking.

**Node server:** `migrations/0001_game_rooms.sql` creates `game_rooms (code, host_token, players jsonb, game_state jsonb, revision, status, timestamps)`.

`migrations/0002_room_chat.sql` creates `room_messages (id, code → game_rooms, name, body, created_at)`. Messages are deleted when their room is.

## Limits and trade-offs

- The browser is trusted to play by the rules, which suits friendly games. A determined player could edit their own game state.
- On Cloudflare, moves appear on other screens almost instantly. On the Node server they appear within about 1 to 2 seconds.
- Cloudflare rooms clean themselves up after 7 idle days. On the Node server, old rooms stay until removed; a periodic `DELETE FROM game_rooms WHERE updated_at < now() - interval '7 days'` keeps that database small.
