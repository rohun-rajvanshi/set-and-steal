# Developing

## Run it

```bash
npm install
npm run dev                  # the Cloudflare version (Worker + Durable Objects): http://localhost:8787
npm start                    # or the Node server with its built-in database: http://localhost:3000
```

To work on same-device play only, you don't need either server. Open `public/` with any static file server, for example `npx serve public`.

## Tests

The tests drive the real game in a browser (Chromium via Playwright): every action card, Nope! chains, payments, the hand limit, auto end-turn, winning, a two-player online room with chat, and the layout on phones (upright and sideways) and desktop.

```bash
npm install --no-save playwright   # first time only
npx playwright install chromium    # first time only
npm run test:worker                # against the Cloudflare Worker (wrangler dev)
npm test                           # against the Node server
```

Each test run starts its own server on a free port with throwaway storage, so it never touches real games. Run both before shipping: the Cloudflare run also checks that live connections work and that polling stops while they're up. The files are in `tests/`; `tests/helpers.js` has helpers to start games and set up exact card situations.

## Testing an online room by yourself

Open the site in a normal window and in an **Incognito/Private** window, or a second browser. Each window keeps its own room session. Create a room in one, join with the code in the other, and play both seats side by side.

Two normal tabs share saved room details. Refreshing one can make it take over the other player.

## Where things are in `public/app.js`

| Section | What it does |
| --- | --- |
| `COLORS`, `ACTIONS`, `buildDeck()` | Card data and the 106-card deck |
| Property helpers (`stacksFor`, `rentFor`, `payable`, `normalize`) | Sets, rent, what can pay a debt, moving orphaned buildings to the bank |
| Playing cards (`playProperty`, `bankCard`, `recolorWild`, …) | Moves that only affect the current player |
| Action resolution (`launchAction`, `advance`, `respondNo`, …) | Pending actions, Nope! chains, payments, steals |
| `highlightInfo()` | Which cards, sets and players glow for the current targeting mode |
| Rendering (`render`, `seatHTML`, `stackHTML`, `renderPrompt`, …) | Builds the table and the action bar from state |
| Interaction (`onTableCard`, `onStack`, `onButton`, …) | Clicks, taps and confirm buttons |
| Online rooms | Room calls, live connection (`connectLive`), fallback polling, saving, rejoin |
| Room chat | Chat polling, sending, unread badge |

`render()` redraws the table from the state after every change, so state is the single source of truth.

## Making a change

1. Edit the files in `public/`. If you change `app.js`, `table.css` or `config.js`, bump `?v=` in `index.html` and the matching `SHELL` entries and `VERSION` in `sw.js`.
2. Run `npm test`, then try a same-device game and an online room yourself.
3. If you change the shape of the saved game state, raise `STATE_VERSION` in `app.js`. Rooms saved by older versions are then refused instead of breaking.
4. Database changes go in a new numbered file in `migrations/`. Files run once each, in name order. Don't edit old ones.
5. Commit and push to `main`. Cloudflare redeploys automatically.

Room logic exists twice: `worker/index.js` (Cloudflare, the live site) and `api/rooms.js` + `api/chat.js` (Node server). They answer the same requests with the same messages; keep them in step, and the tests cover both.
