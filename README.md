# Rexona x HYROX — 72 Seconds Challenge

Real-time leaderboard web app for the Rexona x HYROX 72 Seconds Challenge. Hostesses register participants via a protected admin interface; scores appear instantly on the public leaderboard screen.

---

## URLs

| URL | Access | Description |
|-----|--------|-------------|
| `/leaderboard` | Public | Fullscreen live leaderboard (men/women, alternates every 7s) |
| `/admin` | `ADMIN_PASSWORD` | Register participants + manage scores |
| `/export` | `EXPORT_PASSWORD` | View and download participant data as CSV |

---

## Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env file and fill in your values
cp .env.example .env

# 3. Start the server
npm start
# or for development with auto-reload:
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Minimum `.env` for local development

```
PORT=3000
NODE_ENV=development
DB_PATH=./challenge.db
ADMIN_PASSWORD=testadmin
EXPORT_PASSWORD=testexport
SESSION_SECRET=any_long_random_string_here
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | HTTP port (default: 3000) |
| `NODE_ENV` | Yes | Set to `production` on Railway |
| `DB_PATH` | Yes | Path to SQLite file (e.g. `/data/challenge.db`) |
| `ADMIN_PASSWORD` | Yes | Password for hostess admin interface |
| `EXPORT_PASSWORD` | Yes | Password for data export (separate from admin) |
| `SESSION_SECRET` | Yes | Random secret for session signing (min 32 chars) |

Generate a strong session secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Deploy to Railway

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### Step 2 — Create Railway project

1. Go to [railway.app](https://railway.app) and log in
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your repository

### Step 3 — Add a persistent volume (critical for SQLite)

Without a persistent volume, the database resets on every deploy.

1. In your Railway project, click **+ New** → **Volume**
2. Set **Mount Path** to `/data`
3. Click **Add**

### Step 4 — Set environment variables

In Railway dashboard → your service → **Variables**, add:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `DB_PATH` | `/data/challenge.db` |
| `ADMIN_PASSWORD` | *(your chosen admin password)* |
| `EXPORT_PASSWORD` | *(your chosen export password)* |
| `SESSION_SECRET` | *(64-char random hex — see command above)* |

> **Do not set `PORT`** — Railway injects this automatically.

### Step 5 — Deploy

Railway will automatically deploy when you push to GitHub. The app will be available at your Railway-provided domain, e.g.:

```
https://your-app.railway.app/leaderboard
https://your-app.railway.app/admin
https://your-app.railway.app/export
```

---

## Security Notes

- Passwords are **never stored** — they are hashed with bcrypt (12 rounds) at startup only
- Login endpoints are rate-limited: **5 attempts per 15 minutes per IP**
- Sessions expire after **8 hours** of inactivity
- The leaderboard only shows first name + last initial (e.g. "Lars K.") — no full personal data
- Personal data and scores are in separate database tables; the leaderboard query never touches the `participants` table directly
- All SQL queries use prepared statements — no string concatenation of user input

---

## CSV Export Format

The CSV export includes a UTF-8 BOM for correct display in Microsoft Excel with Dutch special characters (é, ë, ü, etc.).

Columns: `Voornaam, Achternaam, Email, Geslacht, Score (meters), Evenement, Datum, Opt-in`
