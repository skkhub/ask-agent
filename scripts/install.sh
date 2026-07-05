#!/usr/bin/env bash
# Install ask CLI: set up ~/.ask, copy config templates, download platform binary.
set -euo pipefail

INSTALL_DIR="$HOME/.ask"
BIN_DIR="$INSTALL_DIR/bin"
BIN="$BIN_DIR/ask"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

info() { printf '==> %s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    arm64 | aarch64) arch="arm64" ;;
    x86_64 | amd64) arch="x64" ;;
    *) die "Unsupported CPU architecture: $arch" ;;
  esac

  case "$os-$arch" in
    darwin-arm64) ARTIFACT="ask-macos-arm64" ;;
    darwin-x64) die "No prebuilt package for Intel Mac (darwin-x64); build from source" ;;
    linux-x64) ARTIFACT="ask-linux-x64" ;;
    linux-arm64) die "No prebuilt package for linux-arm64; build from source" ;;
    *) die "Unsupported platform: $os ($arch)" ;;
  esac

  PLATFORM="$os-$arch"
}

DEFAULT_REPO="skkhub/ask-agent"

detect_repo() {
  if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local url
    url="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
    if [[ "$url" =~ github\.com[:/]([^/]+/[^/.]+) ]]; then
      REPO="${BASH_REMATCH[1]%.git}"
      return
    fi
  fi
  REPO="$DEFAULT_REPO"
}

detect_version() {
  if [[ -f "$REPO_ROOT/package.json" ]]; then
    VERSION="$(grep -m1 '"version"' "$REPO_ROOT/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
    [[ -n "$VERSION" ]] && return
  fi
  need_cmd curl
  info "Fetching latest release version from GitHub…"
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v?([^"]+)".*/\1/')"
  [[ -n "$VERSION" ]] || die "Could not fetch release version from GitHub"
}

fetch_repo_file() {
  local name="$1" dest="$2"
  if [[ -f "$REPO_ROOT/$name" ]]; then
    cp "$REPO_ROOT/$name" "$dest"
    return
  fi
  need_cmd curl
  local url="https://raw.githubusercontent.com/${REPO}/v${VERSION}/${name}"
  info "Downloading ${name} …"
  curl -fsSL "$url" -o "$dest"
}

download_binary() {
  need_cmd curl
  local url="https://github.com/${REPO}/releases/download/v${VERSION}/${ARTIFACT}"
  info "Downloading ${ARTIFACT} (v${VERSION}) …"
  curl -fsSL "$url" -o "$BIN"
  chmod +x "$BIN"
}

print_success() {
  cat <<EOF

Installation complete!

Install directory: ${INSTALL_DIR}
Executable: ${BIN}

Add ~/.ask/bin to PATH, e.g. in ~/.zshrc or ~/.bashrc:
  export PATH="\$HOME/.ask/bin:\$PATH"

Next steps:
  1. Edit ${INSTALL_DIR}/config.json — model profiles and API key references
  2. Copy and edit environment file:
       cp ${INSTALL_DIR}/.env.example ${INSTALL_DIR}/.env
     Fill in AI API keys (e.g. DEEPSEEK_API_KEY, ANTHROPIC_API_KEY)

Then run:
  ask --help

EOF
}

main() {
  need_cmd mkdir
  need_cmd chmod

  detect_platform
  info "Platform: ${PLATFORM} (artifact: ${ARTIFACT})"

  detect_repo
  detect_version
  info "Repository: ${REPO}, version: v${VERSION}"

  info "Creating ${INSTALL_DIR} …"
  mkdir -p "$BIN_DIR"

  if [[ -f "$INSTALL_DIR/config.json" ]]; then
    warn "Already exists: ${INSTALL_DIR}/config.json — skipping"
  else
    info "Copying config.json …"
    fetch_repo_file "config.json" "$INSTALL_DIR/config.json"
  fi

  info "Copying .env.example …"
  fetch_repo_file ".env.example" "$INSTALL_DIR/.env.example"

  download_binary
  print_success
}

main "$@"
