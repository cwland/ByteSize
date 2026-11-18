# ByteSize

A self-hosted nutrition tracker built for people on a GLP-1: a calorie *range* instead of a hard cap, and
protein, fiber and water floors front and center. Single server, separate data for every person on it.

**What it does now:**
- **Plan picker:** tell it your height, weight, goal, age and activity (and whether you're on a GLP-1) and it offers four
  plans — Relaxed to Vigorous — with a safe, GLP-1-aware "Recommended for you". Your plan sets a calorie *range* plus
  protein, fiber and water targets (editable under Goals).
- **Dashboard:** calorie gauge counting down to the top of your range, protein/fiber/water rings that fill to their
  minimums, quick water buttons, logging streak.
- **Log:** Lose It!-style meal cards with food icons; add food from recents, search (your foods → saved foods → Open Food
  Facts → USDA), a typed barcode, or an AI estimate; ¼ ⅓ ½ ¾ portions; move or copy entries to another day or meal.
- **Your foods:** create foods (with a barcode), and fix any database food — your correction sticks to that barcode.
- Sign-in with passwords and passkeys, admin-managed accounts, AI services with failover, activity logs.

USDA search needs a free key from https://fdc.nal.usda.gov/api-key-signup — add it in Settings › Integrations › Food databases (admin).

## Run it (Docker)

```
mkdir bytesize && cd bytesize
curl -O https://raw.githubusercontent.com/cwland/ByteSize/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/cwland/ByteSize/main/.env.example
# edit .env: POSTGRES_PASSWORD, and JWT_SECRET (make one with: openssl rand -base64 48)
docker compose up -d
```

Open `http://<server>:4100`. The first visit asks you to set up the admin account. There is no sign-up page:
the admin adds everyone else in Settings › Users.

- Data lives in `./data` (`./data/postgres` for the database, `./data/app` for photos and backups).
- Health check: `GET /health` → `{"ok":true,"db":true,"version":"…"}`.
- Behind Nginx Proxy Manager / Traefik: proxy to port 4100. Passkeys need `https://` (or `localhost`);
  set `PASSKEY_ORIGINS=https://bytesize.example.com` to allow only your address.

### Backups

ByteSize backs up the whole server (everyone's data and photos) once a day, soon after 03:00 server time (`TZ` in `.env`),
into `./data/app/backups` as `bytesize-<date>-<time>.tar.gz`. The newest 14 are kept. `BACKUP_HOUR` and
`BACKUP_KEEP` in `.env` change that (`BACKUP_KEEP=0` turns the daily backup off). The server checks every hour,
so if it was off at 03:00 it backs up when it's next running. The admin can also back up, download, delete
and restore in Settings › Data. Copy the backups folder somewhere else with your usual backup tools.
Foods that turned up in a search but that nobody logged, starred, corrected or put in a recipe aren't kept in backups.

A restore replaces everything on the server with the backup. A `…-before-restore` backup is saved first, and
everyone has to sign in again afterwards.

Restore onto a fresh server: start ByteSize, create the first admin account, then Settings › Data › Restore from
a file. Keep the same `JWT_SECRET` as the old server: saved keys (AI, USDA, Spoonacular, FatSecret, Culury) only
open with it. With a different one, Settings › Data lists the keys to enter again.
Behind a reverse proxy, restoring a large backup file needs the proxy's upload size limit and timeout raised.

### Locked out?

```
docker compose exec -u node bytesize npm run reset-password -- <username>
```

It asks for the new password and signs that account out everywhere.

## Develop

Needs Node 22 and PostgreSQL 16 (or `docker compose -f docker-compose.dev.yml up -d`, which creates
`bytesize` and `bytesize_test`).

```
npm run setup                     # installs root, backend and frontend
cp backend/.env.example backend/.env
npm run dev                       # API on :4100, web app on :5173
npm test                          # backend (real Postgres test DB) + frontend
```

Every push to GitHub runs the tests; pushes to `main` publish `ghcr.io/cwland/bytesize:latest` (linux/amd64).

Design and plans: `docs/superpowers/specs/` and `docs/superpowers/plans/`.
