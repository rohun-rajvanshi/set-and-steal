# Deploy to Cloudflare (free)

Set & Steal runs entirely on **Cloudflare Workers**, deployed straight from this GitHub repository:

- The game files in `public/` are served as static assets. These requests are free and unlimited.
- `worker/index.js` answers `/api/*`. Each online room is a **Durable Object** that stores the room, the game and its chat, and pushes every change to the players over a live connection (`/api/live`).
- Every push to `main` on GitHub redeploys automatically.

It stays on Cloudflare's free plan, which needs no card. The free plan allows 100,000 Worker requests a day. A live connection costs one request to open, and each move or chat message the server receives counts as one twentieth of a request, so ordinary play uses a few hundred requests per game. If a limit were ever reached, online rooms would return errors until the next day (00:00 UTC); nothing is charged. Same-device games are pure static files and keep working regardless.

## First-time setup

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. In the dashboard open **Compute → Workers & Pages → Create**, then **Connect GitHub** (it says **Continue with GitHub** once connected).
3. In the GitHub window, install the Cloudflare app for your account, choosing the `set-and-steal` repository, and authorise it.
4. Select the `set-and-steal` repository and click **Next**. Keep the detected settings: project name `set-and-steal`, build command empty, deploy command `npx wrangler deploy`. Click **Deploy**.
5. After about a minute the site is live at `https://set-and-steal.<your-account>.workers.dev`. This repository's live copy is https://set-and-steal.setandstealfree.workers.dev.

`wrangler.jsonc` in the repository holds the whole configuration: the static files folder, the `ROOMS` Durable Object binding and its SQLite storage migration. Nothing else needs to be set up in the dashboard.

## Updating the site

Commit and push to `main`. Cloudflare rebuilds and deploys within a minute or two; the **Deployments** tab of the Worker shows progress and lets you roll back to an earlier version.

Remember to bump the `?v=` numbers in `public/index.html` and the `VERSION` and `SHELL` entries in `public/sw.js` when you change `app.js`, `table.css` or `config.js`, so installed apps pick up the change.

## Deploying from your own computer instead

```bash
npm install
npx wrangler login     # opens the browser to sign in to Cloudflare
npm run deploy         # same as npx wrangler deploy
```

## Previewing locally

```bash
npm install
npm run dev            # http://localhost:8787, with local Durable Objects
```

## A custom domain

In the Worker's **Settings → Domains & Routes → Add → Custom domain**, enter a domain that's on your Cloudflare account. Domains bought through Cloudflare Registrar are sold at cost (roughly 10 US dollars a year for a `.com`). The `workers.dev` address keeps working alongside it.

## Pausing or removing it

- **Pause:** Worker → **Settings → Domains & Routes**, turn off the `workers.dev` route.
- **Remove:** Worker → **Settings → Delete**. This also deletes all saved rooms.

## Limits worth knowing

| Free plan limit | What it means here |
| --- | --- |
| 100,000 Worker requests a day | Room and chat calls, plus opening live connections. Static files don't count. |
| 10 ms CPU per request | The room code does very little work per request; far below this. |
| Durable Objects: 5 GB storage, 100,000 rows written a day | Each move writes one small record. Rooms delete themselves after 7 days without activity. |

Check Cloudflare's current [pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [limits](https://developers.cloudflare.com/workers/platform/limits/) pages, as these can change.
