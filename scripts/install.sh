#!/usr/bin/env bash
# Install ask CLI: set up ~/.ask, copy config templates, download platform binary.
set -euo pipefail

ASK_HOME="${ASK_HOME:-$HOME/.ask}"
ASK_BIN_DIR="$ASK_HOME/bin"
ASK_BIN="$ASK_BIN_DIR/ask"

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
  if [[ -n "${ASK_REPO:-}" ]]; then
    REPO="$ASK_REPO"
    return
  fi
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
  if [[ -n "${ASK_VERSION:-}" ]]; then
    VERSION="${ASK_VERSION#v}"
    return
  fi
  if [[ -f "$REPO_ROOT/package.json" ]]; then
    VERSION="$(grep -m1 '"version"' "$REPO_ROOT/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
    [[ -n "$VERSION" ]] && return
  fi
  need_cmd curl
  info "Fetching latest release version from GitHub…"
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v?([^"]+)".*/\1/')"
  [[ -n "$VERSION" ]] || die "Could not fetch release version; set ASK_VERSION"
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
  curl -fsSL "$url" -o "$ASK_BIN"
  chmod +x "$ASK_BIN"
}

print_success() {
  cat <<EOF

Installation complete!

Install directory: ${ASK_HOME}
Executable: ${ASK_BIN}

Add ~/.ask/bin to PATH, e.g. in ~/.zshrc or ~/.bashrc:
  export PATH="\$HOME/.ask/bin:\$PATH"

Next steps:
  1. Edit ${ASK_HOME}/config.json — model profiles and API key references
  2. Copy and edit environment file:
       cp ${ASK_HOME}/.env.example ${ASK_HOME}/.env
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

  info "Creating ${ASK_HOME} …"
  mkdir -p "$ASK_BIN_DIR"

  if [[ -f "$ASK_HOME/config.json" ]]; then
    warn "Already exists: ${ASK_HOME}/config.json — skipping"
  else
    info "Copying config.json …"
    fetch_repo_file "config.json" "$ASK_HOME/config.json"
  fi

  info "Copying .env.example …"
  fetch_repo_file ".env.example" "$ASK_HOME/.env.example"

  download_binary
  print_success
}

main "$@"
