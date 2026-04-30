# config/ — Organization-Specific Configuration

This directory is **gitignored**. It holds your organization's deployment-specific
configuration that should never be committed to the upstream repository.

## Directory Structure

```
config/
├── README.md           ← this file (committed as a template)
├── branding/           ← logo, custom colors, org-specific UI overrides
│   ├── logo.svg
│   └── theme.json
├── connectors/         ← service account keys, connector-specific config
│   ├── gdrive-service-account.json
│   └── gcp-service-account.json
└── catalogs/           ← org-specific catalog overrides or custom frameworks
    └── (custom OSCAL catalogs go here)
```

## How It Works

Attesting follows a **two-layer configuration** model:

1. **Upstream defaults** — The open-source repo ships with sensible defaults,
   14 standard catalogs, and generic UI. This is the product.

2. **Local overrides** — Your `.env` file and this `config/` directory hold
   everything specific to your deployment: credentials, branding, custom
   frameworks, and service account keys.

When you pull updates from upstream (`git fetch upstream && git merge upstream/main`),
only the product code changes. Your `.env`, `config/`, and database are untouched.

## Branding

Place your organization's logo at `config/branding/logo.svg` and set
`ATTESTING_LOGO_PATH=./config/branding/logo.svg` in `.env`.

Create `config/branding/theme.json` for color overrides:

```json
{
  "primaryColor": "#1F3864",
  "accentColor": "#2E75B6",
  "headerText": "Public Trust Compliance Program",
  "footerText": "Internal Use Only"
}
```

## Connector Credentials

Service account JSON keys go in `config/connectors/`. Reference them in `.env`:

```
GDRIVE_SERVICE_ACCOUNT_PATH=./config/connectors/gdrive-service-account.json
GCP_SERVICE_ACCOUNT_PATH=./config/connectors/gcp-service-account.json
```

**Never commit credential files.** The entire `config/` directory (except this
README) is gitignored.

## Custom Catalogs

If your organization has a custom compliance framework not included in the
upstream catalogs, place the OSCAL JSON in `config/catalogs/` and import it:

```bash
npx tsx src/index.ts import catalog config/catalogs/my-framework.json
```
