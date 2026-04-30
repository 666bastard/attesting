# Deploying Attesting — Self-Hosted Guide

Attesting is designed to be deployed as a self-hosted instance within your
organization's infrastructure. The open-source repository is the product;
your deployment adds configuration, credentials, branding, and data on top.

Updates flow from the upstream repo into your deployment without touching your
organization's data or configuration.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  GitHub: xtonyknucklesx/attesting  (upstream, public)        │
│  ─────────────────────────────────────────────────────────── │
│  Application code, catalogs, connectors, UI, migrations      │
│  MIT license — pull updates with git merge                   │
└──────────────────────┬───────────────────────────────────────┘
                       │ git fetch upstream && git merge upstream/main
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Your Deployment  (private, on your infrastructure)          │
│  ─────────────────────────────────────────────────────────── │
│  .env                 ← credentials, org config (gitignored) │
│  config/              ← branding, service accounts (ignored) │
│  ~/.attesting/        ← SQLite database (outside repo)       │
│                                                              │
│  Data never leaves your infrastructure.                      │
│  Config never enters the upstream repo.                      │
└──────────────────────────────────────────────────────────────┘
```

**What lives where:**

| Layer | Location | Contents | Git-tracked? |
|-------|----------|----------|--------------|
| Product code | `src/`, `data/catalogs/`, `data/mappings/` | Application, standard catalogs | ✅ Upstream |
| Org config | `.env`, `config/` | Credentials, branding, custom catalogs | ❌ Gitignored |
| Org data | `~/.attesting/attesting.db` | Controls, implementations, risks, audit log | ❌ Outside repo |

---

## Prerequisites

- **Node.js 20+** — required for the runtime
- **Git** — to clone and pull updates
- **A Linux server, VM, or container host** — any environment that runs Node.js
- **(Optional) Docker** — for containerized deployment

---

## Option A: Direct Deployment (Recommended for Getting Started)

### 1. Clone the Repository

```bash
git clone https://github.com/xtonyknucklesx/attesting.git
cd attesting
```

### 2. Install Dependencies and Build

```bash
npm ci
npm run build
```

### 3. Create Your Configuration

```bash
cp .env.example .env
mkdir -p config/branding config/connectors config/catalogs
```

Edit `.env` with your organization's values:

```bash
# Required
ATTESTING_ORG_NAME="Acme Corp"
ATTESTING_ORG_ID="acme"
ATTESTING_PORT=3000

# Connectors (add as needed)
JIRA_BASE_URL=https://jira.example.com
JIRA_EMAIL=user@example.com
JIRA_API_TOKEN=your-token-here
```

### 4. Initialize the Database

The database is created automatically on first run at `~/.attesting/attesting.db`.
Migrations run automatically.

### 5. Import Your Catalogs

```bash
# Import standard frameworks (shipped with the repo)
npx tsx src/index.ts import catalog data/catalogs/nist-800-53r5.json
npx tsx src/index.ts import catalog data/catalogs/nist-800-171r3.json
npx tsx src/index.ts import catalog data/catalogs/cmmc-2.0.json

# Import cross-framework mappings
npx tsx src/index.ts import mapping data/mappings/800-53-to-800-171.json
```

### 6. Start the Server

```bash
npx tsx src/index.ts serve --port 3000
```

The web UI is now available at `http://your-server:3000`.

---

## Option B: Docker Deployment

### 1. Clone and Configure

```bash
git clone https://github.com/xtonyknucklesx/attesting.git
cd attesting
cp .env.example .env
# Edit .env with your values
```

### 2. Build and Run

```bash
docker compose up -d
```

The container mounts a named volume for the database (`attesting-data`), so
your data persists across container rebuilds.

### 3. Import Catalogs (Inside Container)

```bash
docker compose exec attesting node dist/index.js import catalog data/catalogs/nist-800-171r3.json
```

---

## Option C: Systemd Service (Production Linux)

Create `/etc/systemd/system/attesting.service`:

```ini
[Unit]
Description=Attesting GRC Platform
After=network.target

[Service]
Type=simple
User=attesting
WorkingDirectory=/opt/attesting
EnvironmentFile=/opt/attesting/.env
ExecStart=/usr/bin/node dist/index.js serve --port 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable attesting
sudo systemctl start attesting
```

---

## Pulling Updates from Upstream

When the upstream repository has new features, bug fixes, or new connectors:

```bash
# Add upstream remote (one-time)
git remote add upstream https://github.com/xtonyknucklesx/attesting.git

# Fetch and merge
git fetch upstream
git merge upstream/main

# Rebuild
npm ci
npm run build

# Restart the server
# (systemd) sudo systemctl restart attesting
# (docker)  docker compose up -d --build
# (direct)  kill the old process, start again
```

**What happens during merge:**
- ✅ Source code updates (new features, fixes, adapters)
- ✅ New migrations auto-apply on next startup
- ✅ New catalogs available for import
- ❌ `.env` is untouched (gitignored)
- ❌ `config/` is untouched (gitignored)
- ❌ Database is untouched (outside repo)

**If you haven't modified any upstream files**, merges are clean (fast-forward).
If you have local code changes (rare), Git will merge them normally. Resolve any
conflicts in your favor for org-specific changes.

---

## Configuring Connectors

Connectors are registered at runtime via the CLI or API. The adapter code lives
in the upstream repo; the credentials and configuration live in your database.

### Register a Connector

```bash
npx tsx src/index.ts connector add \
  --name "Jira - PTCP" \
  --adapter JiraAdapter \
  --config '{"base_url":"https://jira.example.com","email":"user@example.com","api_token":"TOKEN"}'
```

### Trigger a Sync

```bash
# Sync a specific connector
npx tsx src/index.ts connector sync --name "Jira - PTCP"

# Sync all connectors
npx tsx src/index.ts connector sync --all
```

### Check Health

```bash
npx tsx src/index.ts connector health
```

Connector config (including credentials) is stored in the `connectors` table
in your database — never in the filesystem or repo.

---

## Backups

Back up your database regularly. It's a single file:

```bash
# Simple copy
cp ~/.attesting/attesting.db ~/backups/attesting-$(date +%Y%m%d).db

# Or use sqlite3 online backup (safe during writes)
sqlite3 ~/.attesting/attesting.db ".backup ~/backups/attesting-$(date +%Y%m%d).db"
```

**What to back up:**
- `~/.attesting/attesting.db` — all your data
- `.env` — your configuration
- `config/` — branding, service account keys

**What NOT to back up** (it's in the repo):
- `src/`, `data/`, `docs/`, `tests/` — pull from upstream

---

## Reverse Proxy (Production)

For production, put Attesting behind nginx or Caddy with TLS:

```nginx
server {
    listen 443 ssl;
    server_name attesting.internal.example.com;

    ssl_certificate /etc/ssl/certs/attesting.crt;
    ssl_certificate_key /etc/ssl/private/attesting.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Security Considerations

- **Database access** — The SQLite file contains all your compliance data.
  Restrict filesystem permissions: `chmod 600 ~/.attesting/attesting.db`
- **Network access** — Bind to `127.0.0.1` and use a reverse proxy for TLS.
  Don't expose port 3000 directly to the internet.
- **Connector credentials** — Stored in the database. Use least-privilege
  service accounts with read-only access where possible.
- **Backups** — Encrypt backups if they leave your secure infrastructure.
- **Updates** — Pull upstream updates regularly. Security fixes land in `main`.
