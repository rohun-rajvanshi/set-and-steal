# Handoff notes

Everything someone needs to pick up Set & Steal: what it is, where it runs, how to change and ship it, and the traps already found. Read this first, then [architecture.md](architecture.md) for the code.

## What it is

A browser card game for 2 to 5 players. Build 3 complete property sets to win; steal, swap and take over other players' sets; block actions with Nope! chains. Same-device play (pass the phone) or online rooms with chat. Installable as an app (PWA). Plain HTML/CSS/JS, no build step.

## Where it runs

| Place | Address | Notes |
| --- | --- | --- |
| Cloudflare Workers (live site) | https://set-and-steal.rohunrajvanshi.workers.dev | Free plan. Worker `set-and-steal`, configured entirely by `wrangler.jsonc`. Static files from `public/`; `/api/*` handled by `worker/index.js` with one Durable Object (`Room`) per room. Connected to the GitHub repo: every push to `main` deploys. |
| GitHub | `rohun-rajvanshi/set-and-steal` | Source of truth. |

Cloudflare account: the owner's (Workers & Pages → `set-and-steal`). Measured on the live site: a move reaches the other player's screen in about 0.1 seconds.

Retired: the Azure App Service copy (`deal-table-rg`, stopped, free) and the Hatchable projects. See [Retired hosts](#retired-hosts).

Costs: none. The Cloudflare free plan needs no card. Static files are free and unlimited; the API has 100,000 requests a day, and live connections keep each game to a few hundred. Past a limit, online rooms error until 00:00 UTC; nothing is billed. The site never sleeps.

## Shipping a change

1. Edit files in `public/` or `worker/` (and `api/` too if the room API changes, to keep the Node server in step).
2. If `app.js`, `table.css` or `config.js` changed: bump `?v=N` in `public/index.html`, the same `?v=N` in the `SHELL` list in `public/sw.js`, and its `VERSION` name. Installed apps only update when these change.
3. If the saved game shape changed: raise `STATE_VERSION` in `app.js`.
4. Run `npm run test:worker` and `npm test` (25 browser tests each, about 2 minutes). See [developing.md](developing.md) for first-time setup.
5. Push to `main` on GitHub. Cloudflare deploys within a minute or two (Worker → Deployments shows progress and allows rollback).

## Product decisions

- **Rules are the classic set-collecting rules, unchanged**: 106 cards, 3 plays a turn, 7-card hand limit, no change given, Rainbow Wild worth nothing, Swap may give away a card from your own full set.
- **Names** (shown on screen) versus **internal ids** (kept so saved games keep working):

  | On screen | Internal id |
  | --- | --- |
  | Steal, Swap, Takeover, Nope! | `sly`, `forced`, `breaker`, `no` |
  | Collections, Housewarming, Payday, Rent Hike | `debt`, `birthday`, `passgo`, `double` |
  | House, Tower | `house`, `hotel` |
  | Transit, Power (sets) | `railroad`, `utility` |

- **Money is coins.** Banked cards show as round coins coloured by value: 1 copper, 2 silver, 3 green, 4 blue, 5 gold, 10 purple. Text says "5 coins"; never "5M".
- **Turns end by themselves** about 1.3 seconds after the third play resolves. Nope! never uses a play.
- **Writing style:** no em or en dashes anywhere; ranges are written "2 to 5". The tests fail if one slips in, or if any old brand or card name appears.

## Online play

- On Cloudflare, `/api/rooms` responses include `live: true`; the game then opens a WebSocket (`/api/live`) and the room pushes every change. Polling drops to a 15 to 20 second safety net. On servers without a live endpoint the game polls about once a second.
- The room's Durable Object is the only place a room exists. Rooms delete themselves after 7 days without activity.
- `worker/index.js` and `api/rooms.js` + `api/chat.js` implement the same API with the same error messages. Change both together.

## Layout rules

- The top bar's height changes (notches, the installed app, wrapping buttons). `app.js` publishes it as `--top-h`; anything fixed near the top (chat, toasts, chat previews) must use it, never a fixed pixel offset.
- On phones (up to 600px wide) the chat is a full-screen sheet sized with `--vv-h` / `--vv-top` from `visualViewport`, so the keyboard never hides it.
- Phones held sideways (landscape, up to 520px tall) move the prompt and hand into a right-hand panel (`--side-w`), so the table keeps most of the screen.

## Traps already found

| Trap | What to do |
| --- | --- |
| Overlays positioned at a fixed `top` slid under a taller top bar | Use `--top-h` (see above). The layout tests simulate a notch. |
| Two CSS components shared a class name (`.prompt.card`) and shrank the action bar | Keep component class names unique; search before adding one. |
| A room saved on another device's clock made the turn timer read 0:00 | Online, time turns from when this device first saw them (`turnStartedAt`). |
| The pass-the-device curtain covered the top bar | The top bar sits above it (`z-index: 42`). |
| Remembered rooms pulled players back in after "Leave" | The home screen offers **Rejoin** instead; polling stops when `room` is null. |
| Cross-site API calls failed preflight | Clients send JSON as `text/plain`; the API allows `OPTIONS` and sends `Access-Control-Allow-Origin: *`. |
| The built-in database (PGlite) is one process | Only matters for the Node server. Use `DATABASE_URL` if you run more than one copy. |
| Free hosts that sleep (Azure F1) made the first visit take up to a minute | Cloudflare Workers don't sleep; that's one reason the site moved. |
| Polling every second costs a request each time | Live connections on Cloudflare; the Cloudflare test run checks polling stops while live. |
| GitHub web upload can't add folders | Use GitHub Desktop or git. |

## Accounts and access

The owner holds the GitHub and Cloudflare accounts. No passwords or keys are stored in this repository, and the Worker needs no secrets.

## Retired hosts

- **Azure** (Azure for Students subscription): web app `deal-table` in resource group `deal-table-rg` on the free F1 plan, stopped. Delete the resource group in the Azure portal to remove it completely.
- **Hatchable**: the original project from before the rebrand, and "Set & Steal" (never deployed). Delete them in the Hatchable console if they're no longer wanted.

## Selling or transferring

- Transfer the GitHub repository (Settings → Transfer) or give the buyer a copy.
- The buyer connects it to their own Cloudflare account ([deploy-cloudflare.md](deploy-cloudflare.md), about 5 minutes) and ideally adds their own domain. Rooms in progress don't move with it.
- Before selling, do a proper trademark check on the name "Set & Steal".
