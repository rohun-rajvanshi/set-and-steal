# Self-hosting (Node, Docker, Azure)

The live site runs on Cloudflare (see [deploy-cloudflare.md](deploy-cloudflare.md)). This page is for running it somewhere else.

`server.js` runs the whole app on your own server: the site in `public/` plus the online rooms and chat API. It needs **Node.js 20+**. It uses PostgreSQL if you give it one, and otherwise a built-in database. Tables are created automatically on first start from `migrations/`.

The Node server has no live-update endpoint, so the game polls it about once a second for moves and chat. That works well; it just uses more requests than the Cloudflare version.

## Settings

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | No | PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/dealtable` |
| `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPORT` | No | The same thing as separate settings, instead of `DATABASE_URL` |
| `DATA_DIR` | No | Where the built-in database keeps its files when no PostgreSQL server is set (default `./data`) |
| `PORT` | No | Port to listen on (default 3000; most hosts set it for you) |
| `PGSSL` | No | `disable` to turn off TLS to the database (local databases only) |
| `PGPOOL_MAX` | No | Maximum database connections (default 10) |

Put them in a `.env` file (copy `.env.example`) or set them in your host's settings.

**No database server needed.** If you don't set `DATABASE_URL` or `PGHOST`, the server uses a built-in PostgreSQL ([PGlite](https://pglite.dev)) that stores rooms and chat in `DATA_DIR`. That suits a single small server. Use a real PostgreSQL server if you run more than one copy of the app.

## Run locally

**Node** (built-in database, nothing else to install):

```bash
npm install
npm start               # http://localhost:3000
```

**Docker** with its own PostgreSQL server:

```bash
docker compose up
# open http://localhost:8080
```

## Azure (free)

This runs the game, online rooms and chat on **Azure App Service, Free (F1) plan**, with the built-in database. It costs nothing: the F1 plan is always free, and when its daily limit (60 CPU minutes) is used up, Azure pauses the app until the next day instead of charging.

Run these in **Azure Cloud Shell** (the `>_` icon at the top of the Azure portal, choose Bash). Pick an allowed region; Azure for Students subscriptions only allow some (find them under **Policy → Assignments**, or try `centralindia`).

```bash
RG=set-and-steal-rg; L=centralindia; APP=set-and-steal-$RANDOM
az group create -n $RG -l $L
az appservice plan create -g $RG -n set-and-steal-plan -l $L --is-linux --sku F1
az webapp create -g $RG -p set-and-steal-plan -n $APP --runtime "NODE:24-lts"
az webapp config appsettings set -g $RG -n $APP --settings DATA_DIR=/home/data SCM_DO_BUILD_DURING_DEPLOYMENT=true
az webapp deployment source config -g $RG -n $APP --branch main --manual-integration \
  --repo-url https://github.com/<your-username>/set-and-steal
echo "https://$APP.azurewebsites.net"
```

- `/home` is the App Service's permanent storage, so rooms survive restarts and redeploys.
- The first visit after a quiet spell takes a few seconds while the free app wakes up.
- **After you push changes to GitHub**, redeploy with:
  `az webapp deployment source sync -g set-and-steal-rg -n <your-app-name>`
- **Pause:** `az webapp stop -g set-and-steal-rg -n <your-app-name>` (and `start` to resume). **Remove everything:** `az group delete -n set-and-steal-rg`.

### Azure with a PostgreSQL server

For more traffic, use a paid plan (e.g. `--sku B1`) and **Azure Database for PostgreSQL Flexible Server**, then set `PGHOST`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` on the web app. Both cost money; check current Azure pricing first.

## Other hosts

Any host that runs Node works the same way: run `npm start`, and set `DATABASE_URL` if you have a PostgreSQL server. Examples are Render, Railway, Fly.io, a VM, or the Docker image on Azure Container Apps.

## Hosting only the game

To offer just same-device play, upload the contents of `public/` to any static host, such as GitHub Pages or Netlify. To add online rooms, put the address of a running API (the Cloudflare Worker or a Node server) in `public/config.js`. Both send `Access-Control-Allow-Origin: *`, so cross-site calls work.
