#!/usr/bin/env bash
# DevAgent installer for macOS and Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/your-repo/devagent/main/scripts/install.sh | bash

set -e

REPO="your-repo/devagent"
INSTALL_DIR="$HOME/.devagent"
BIN_LINK="/usr/local/bin/da"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}  ℹ  $1${NC}"; }
success() { echo -e "${GREEN}  ✓  $1${NC}"; }
warn()    { echo -e "${YELLOW}  ⚠  $1${NC}"; }
error()   { echo -e "${RED}  ✗  $1${NC}"; exit 1; }

echo ""
echo -e "${CYAN}  DevAgent installer${NC}"
echo -e "${CYAN}  ─────────────────────────────────${NC}"
echo ""

# --- Check Node.js ---
if ! command -v node &>/dev/null; then
  error "Node.js is required (v18+). Install from https://nodejs.org"
fi
NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$MAJOR" -lt 18 ]; then
  error "Node.js v18+ is required (found v$NODE_VER). Upgrade at https://nodejs.org"
fi
success "Node.js v$NODE_VER found"

# --- Check npm ---
if ! command -v npm &>/dev/null; then
  error "npm is required. It usually comes with Node.js."
fi

# --- Download / update ---
info "Installing DevAgent to $INSTALL_DIR …"
mkdir -p "$INSTALL_DIR"

# If git is available, clone/pull; otherwise download tarball
if command -v git &>/dev/null && [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing installation…"
  git -C "$INSTALL_DIR" pull --ff-only
elif command -v git &>/dev/null; then
  git clone --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR/src" 2>/dev/null || {
    warn "git clone failed, falling back to tarball download"
    _download_tarball
  }
else
  _download_tarball
fi

_download_tarball() {
  TARBALL_URL="https://github.com/$REPO/archive/refs/heads/main.tar.gz"
  TMP=$(mktemp -d)
  curl -fsSL "$TARBALL_URL" -o "$TMP/devagent.tar.gz"
  tar -xzf "$TMP/devagent.tar.gz" -C "$TMP"
  cp -r "$TMP"/devagent-main/. "$INSTALL_DIR/src/"
  rm -rf "$TMP"
}

# --- npm install ---
info "Installing dependencies…"
npm install --prefix "$INSTALL_DIR/src" --omit=dev --silent

# --- Make executable ---
chmod +x "$INSTALL_DIR/src/src/da.js"

# --- Symlink to PATH ---
info "Linking \`da\` command…"
if [ -w "$(dirname $BIN_LINK)" ]; then
  ln -sf "$INSTALL_DIR/src/src/da.js" "$BIN_LINK"
  success "Linked: $BIN_LINK"
else
  warn "Cannot write to $(dirname $BIN_LINK) — trying with sudo…"
  sudo ln -sf "$INSTALL_DIR/src/src/da.js" "$BIN_LINK"
  success "Linked (sudo): $BIN_LINK"
fi

# --- Done ---
echo ""
success "DevAgent installed successfully!"
echo ""
echo -e "  Next steps:"
echo -e "  ${CYAN}da config set api-key YOUR_ANTHROPIC_KEY${NC}"
echo -e "  ${CYAN}da${NC}   — start interactive chat"
echo -e "  ${CYAN}da \"explain this codebase\"${NC}   — one-shot query"
echo ""
echo -e "  Get an API key at: https://console.anthropic.com"
echo ""
