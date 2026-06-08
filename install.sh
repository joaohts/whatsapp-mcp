#!/usr/bin/env bash
# Zero-prereq installer for whatsapp-mcp (CLI variant).
# Aimed at users who already have Claude Code (which means they already have
# Node — Claude Code ships as an npm package).
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/joaohts/whatsapp-mcp/main/install.sh)
#
# What this does:
#   1. Verifies git + node ≥ 20 are present.
#   2. Clones the repo into ~/.whatsapp-mcp/repo (or pulls if it exists).
#   3. npm install + npm run build.
#   4. Runs `whatsapp-mcp setup` to pair + register with Claude Code.
#
# Note: this clones main, which includes the DMG (Electron) sources too. They
# install but never run on a headless box; the cost is ~150 MB of unused
# node_modules. We accept that to avoid maintaining a separate branch.

set -euo pipefail

REPO_URL="https://github.com/joaohts/whatsapp-mcp.git"
BRANCH="main"
TARGET="${WHATSAPP_MCP_REPO:-$HOME/.whatsapp-mcp/repo}"

if ! command -v git >/dev/null 2>&1; then
  echo "error: git is required" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node ≥ 20 is required (Claude Code ships with one)" >&2
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "error: Node ≥ 20 required, found $(node -v)" >&2
  exit 1
fi

if [ -d "$TARGET/.git" ]; then
  echo "↻ Updating existing checkout at $TARGET"
  git -C "$TARGET" fetch origin "$BRANCH"
  git -C "$TARGET" checkout "$BRANCH"
  git -C "$TARGET" reset --hard "origin/$BRANCH"
else
  echo "↓ Cloning into $TARGET"
  mkdir -p "$(dirname "$TARGET")"
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$TARGET"
fi

echo "→ npm install (this can take a couple of minutes)"
(cd "$TARGET" && npm install --silent)

echo "→ Building"
(cd "$TARGET" && npm run build --silent)

echo "→ Pairing and registering with Claude Code"
(cd "$TARGET" && node bin/whatsapp-mcp setup)
