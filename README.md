# ByteSize

A self-hosted nutrition tracker built for people on a GLP-1: a calorie *range* instead of a hard cap, and
protein, fiber and water floors front and center. Single server, separate data for every person on it.

**Milestone 1 (this version):** sign-in (password and passkeys), admin-managed accounts, profile settings,
AI services with automatic failover, activity logs, Docker image. Food logging, goals and the weight-loss
plan picker arrive in Milestone 2.

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

- Data lives in `./data` (`./data/postgres` for the database, `./data/app` for uploads).
- Health check: `GET /health` → `{"ok":true,"db":true,"version":"…"}`.
- Behind Nginx Proxy Manager / Traefik: proxy to port 4100. Passkeys need `https://` (or `localhost`);
  set `PASSKEY_ORIGINS=https://bytesize.example.com` to allow only your address.

### Locked out?

```
docker compose exec bytesize npm run reset-password -- <username>
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
