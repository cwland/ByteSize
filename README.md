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
- **Import weight history:** Settings › Data › Import weight history reads a CSV (up to 5 MB) from Lose It, MyFitnessPal,
  Happy Scale, Libra, Withings, Fitbit or your own sheet, shows a preview, then adds the weigh-ins. Apple Health only
  exports XML: use an app that exports Health data as CSV (for example Health Auto Export, metric "Weight & Body Mass").
- Sign-in with passwords, passkeys or OAuth / OpenID Connect, Forgot password by email, admin-managed accounts,
  AI services with failover, activity logs.

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

### Email

Settings › Email (admin) sets up the account ByteSize sends email from: pick Gmail, Outlook, iCloud, Fastmail or
your own server, then the from address, username and password (Gmail, iCloud and Fastmail need an *app password*).
The server, port and security are under More options. **Send test email** has to go through before **Save**.
The password is stored encrypted with `JWT_SECRET` and never shown unless you press the eye. Sent emails are
listed in Settings › Logs (Email).

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` and `APP_URL` in `.env` still work: they are used
when nothing is saved in Settings › Email.

### Forgot password

With email set up, the sign-in screen shows **Forgot password?**. Enter the email on your account; if an account
uses it, ByteSize emails a 6-digit code (the screen says the same either way, just as quickly). Enter the code and a new password and
you're signed in; every other device is signed out. A code works once, for 15 minutes; 5 wrong tries end it, and
asking again replaces it. At most 5 codes an hour per email and per address, and 10 code tries an hour per email. Accounts without an email, and
turned-off accounts, never get a code. Each reset is in Settings › Logs (who, never the code).

### OAuth sign-in

Settings › Security › OAuth sign-in (admin) lets people sign in with Authentik, Keycloak, Google, Microsoft or any
OpenID Connect provider:

1. At the provider, make an OAuth2 / OpenID application with the **Redirect URI** shown in ByteSize
   (`https://<your ByteSize>/api/auth/oauth/callback`). When ByteSize's address is set (Settings › Email, or
   `APP_URL` / `PASSKEY_ORIGINS` in `.env`), the redirect URI uses it and sign-ins from any other address are refused.
2. In ByteSize: turn it on, name the button, and enter the **Issuer URL**, **Client ID** and **Client secret**.
   Save, then **Test connection**.
3. Everyone (you first) uses **Link my account** in Settings › Security to sign in with the provider once.

The sign-in screen then shows **Sign in with …**. It only signs in accounts their owners linked with **Link my
account**; emails are never matched. OAuth never creates accounts: the admin adds people in Settings › Users.
**OAuth only** hides the password form (passkeys still work); it can only be turned on once your own account is
linked at that provider, and it turns itself off when you change the provider or the client ID.

### Locked out?

Reset a password from the server (no email needed). Without a username it resets the first admin. It prints a new
random password once (add `--password` to be asked for one instead, or set `NEW_PASSWORD`; a password is never given
as an argument) and signs that account out everywhere:

```
# Docker
docker compose exec -u node bytesize npm run reset-password -- <username>
# Mac (or any machine running from the source)
cd backend && npm run reset-password -- <username>
```

Locked out by OAuth (OAuth only, and the provider is down)? Turn OAuth only and OAuth sign-in off:

```
# Docker
docker compose exec -u node bytesize npm run auth:reset
# Mac
cd backend && npm run auth:reset
```

Or add `EMERGENCY_DISABLE_OAUTH=true` to `.env` and restart: the server does the same at every start. Remove it
once you're back in.

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
