#!/usr/bin/env bash
# ============================================================
# Attesting — Quickstart Setup
# ============================================================
# Run this once after cloning to set up your local deployment.
# Usage: ./scripts/setup.sh
# ============================================================

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BOLD}${CYAN}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║         Attesting — Deployment Setup         ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Step 1: Check Node.js ────────────────────────────────────
echo -e "${BOLD}[1/6] Checking Node.js...${NC}"
if ! command -v node &>/dev/null; then
  echo "  ✗ Node.js not found. Install Node.js 20+ and try again."
  exit 1
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "  ✗ Node.js $NODE_VERSION found, but 20+ is required."
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"

# ── Step 2: Install dependencies ─────────────────────────────
echo -e "${BOLD}[2/6] Installing dependencies...${NC}"
npm ci --silent
echo -e "  ${GREEN}✓${NC} Dependencies installed"

# ── Step 3: Build ────────────────────────────────────────────
echo -e "${BOLD}[3/6] Building...${NC}"
npm run build --silent
echo -e "  ${GREEN}✓${NC} Build complete"

# ── Step 4: Create config directories ────────────────────────
echo -e "${BOLD}[4/6] Creating config directories...${NC}"
mkdir -p config/branding config/connectors config/catalogs
echo -e "  ${GREEN}✓${NC} config/branding/"
echo -e "  ${GREEN}✓${NC} config/connectors/"
echo -e "  ${GREEN}✓${NC} config/catalogs/"

# ── Step 5: Create .env if it doesn't exist ──────────────────
echo -e "${BOLD}[5/6] Checking .env...${NC}"
if [ -f .env ]; then
  echo -e "  ${YELLOW}→${NC} .env already exists, skipping"
else
  cp .env.example .env
  echo -e "  ${GREEN}✓${NC} Created .env from .env.example"
  echo -e "  ${YELLOW}→${NC} Edit .env to add your organization name and connector credentials"
fi

# ── Step 6: Verify database ─────────────────────────────────
echo -e "${BOLD}[6/6] Checking database...${NC}"
DB_DIR="$HOME/.attesting"
DB_PATH="$DB_DIR/attesting.db"
if [ -f "$DB_PATH" ]; then
  SIZE=$(du -h "$DB_PATH" | cut -f1)
  echo -e "  ${GREEN}✓${NC} Database exists at $DB_PATH ($SIZE)"
else
  echo -e "  ${YELLOW}→${NC} Database will be created on first run at $DB_PATH"
fi

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Setup complete.${NC}"
echo ""
echo -e "Next steps:"
echo -e "  ${CYAN}1.${NC} Edit .env with your org name and connector credentials"
echo -e "  ${CYAN}2.${NC} Import catalogs:"
echo -e "     npx tsx src/index.ts import catalog data/catalogs/nist-800-171r3.json"
echo -e "  ${CYAN}3.${NC} Start the server:"
echo -e "     npx tsx src/index.ts serve --port 3000"
echo ""
echo -e "  For the full deployment guide: ${CYAN}docs/DEPLOYMENT.md${NC}"
echo ""

# ── Upstream remote hint ─────────────────────────────────────
if ! git remote | grep -q upstream 2>/dev/null; then
  echo -e "${YELLOW}Tip:${NC} Add the upstream remote to pull future updates:"
  echo "  git remote add upstream https://github.com/xtonyknucklesx/attesting.git"
  echo ""
fi
