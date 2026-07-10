#!/usr/bin/env bash
# Install ask CLI: set up ~/.ask, copy config templates, download platform binary.
set -euo pipefail

INSTALL_DIR="$HOME/.ask"
BIN_DIR="$INSTALL_DIR/bin"
BIN="$BIN_DIR/ask"
CURL_UA="ask-cli-install"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

info() { printf '==> %s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: install.sh [OPTIONS]

Options:
  --version <ver>   Install a specific release version (default: latest on GitHub)
  --dev             Use version from local package.json (requires a git checkout)
  -h, --help        Show this help
EOF
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

LOCAL_CHECKOUT=0
if [[ -f "$REPO_ROOT/scripts/install.sh" && -f "$REPO_ROOT/package.json" ]]; then
  if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    LOCAL_CHECKOUT=1
  fi
fi

VERSION=""
LOCAL_DEV=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || die "--version requires an argument"
      VERSION="${2#v}"
      shift 2
      ;;
    --dev)
      LOCAL_DEV=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1 (try --help)"
      ;;
  esac
done

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
  if [[ "$LOCAL_CHECKOUT" -eq 1 ]]; then
    local url
    url="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
    if [[ "$url" =~ github\.com[:/](.+)(\.git)?$ ]]; then
      REPO="${BASH_REMATCH[1]%.git}"
      return
    fi
  fi
  REPO="$DEFAULT_REPO"
}

github_api() {
  local path="$1"
  local url body status msg
  need_cmd curl
  url="https://api.github.com/repos/${REPO}/${path}"
  body="$(curl -sSL --retry 3 --retry-delay 2 \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: ${CURL_UA}" \
    -w '\n%{http_code}' \
    "$url")"

  status="${body##*$'\n'}"
  body="${body%$'\n'*}"

  if [[ ! "$status" =~ ^2[0-9][0-9]$ ]]; then
    msg="$(printf '%s\n' "$body" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    [[ -n "$msg" ]] || msg="$(printf '%s' "$body" | tr '\n' ' ' | cut -c1-180)"
    die "GitHub API request failed (${status}) for ${path}: ${msg}"
  fi

  printf '%s\n' "$body"
}

detect_version() {
  if [[ -n "$VERSION" ]]; then
    return
  fi
  if [[ "$LOCAL_DEV" -eq 1 ]]; then
    [[ "$LOCAL_CHECKOUT" -eq 1 ]] || die "--dev requires a local git checkout"
    if [[ -f "$REPO_ROOT/package.json" ]]; then
      VERSION="$(sed -n '1,20p' "$REPO_ROOT/package.json" | sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
      [[ -n "$VERSION" ]] || die "Could not read version from ${REPO_ROOT}/package.json"
      warn "Using local dev version v${VERSION} (--dev)"
      return
    fi
    die "Could not read version from local package.json"
  fi
  info "Fetching latest release version from GitHub…"
  local latest_json
  latest_json="$(github_api "releases/latest")"
  VERSION="$(printf '%s\n' "$latest_json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  VERSION="${VERSION#v}"

  if [[ -z "$VERSION" ]]; then
    warn "Could not parse tag_name from releases/latest; trying latest tag…"
    VERSION="$(github_api "tags?per_page=1" | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    VERSION="${VERSION#v}"
  fi

  [[ -n "$VERSION" ]] || die "Could not determine version from GitHub (tried releases/latest and tags). Use --version <ver> to install explicitly."
}

download_with_progress() {
  local url="$1" dest="$2" label="$3"
  need_cmd curl
  info "Downloading ${label} …"
  local curl_opts=(-fL --retry 3 --retry-delay 2 -H "User-Agent: ${CURL_UA}")
  if [[ -t 2 ]]; then
    curl_opts+=(--progress-bar)
  else
    curl_opts+=(-sS)
  fi
  curl "${curl_opts[@]}" "$url" -o "$dest"
}

fetch_repo_file() {
  local name="$1" dest="$2"
  if [[ "$LOCAL_CHECKOUT" -eq 1 && -f "$REPO_ROOT/$name" ]]; then
    cp "$REPO_ROOT/$name" "$dest"
    return
  fi
  local url="https://raw.githubusercontent.com/${REPO}/v${VERSION}/${name}"
  download_with_progress "$url" "$dest" "$name"
}

download_binary() {
  local url tmp
  url="https://github.com/${REPO}/releases/download/v${VERSION}/${ARTIFACT}"
  tmp="${BIN}.new"
  rm -f "$tmp"
  download_with_progress "$url" "$tmp" "${ARTIFACT} (v${VERSION})"
  [[ -s "$tmp" ]] || die "Downloaded binary is empty"
  chmod +x "$tmp"
  mv -f "$tmp" "$BIN"
}

PATH_LINE='export PATH="$HOME/.ask/bin:$PATH"'
PATH_MARKER='# Added by ask install'

path_already_configured() {
  local rc="$1"
  [[ -f "$rc" ]] && grep -qF "$PATH_MARKER" "$rc"
}

append_path_to_rc() {
  local rc="$1"
  if path_already_configured "$rc"; then
    info "~/.ask/bin already in ${rc}"
    return
  fi
  {
    printf '\n%s\n' "$PATH_MARKER"
    printf '%s\n' "$PATH_LINE"
  } >>"$rc"
  info "Added ~/.ask/bin to PATH in ${rc}"
}

shell_rc_files() {
  case "${SHELL:-}" in
    */zsh)
      printf '%s\n' "$HOME/.zshrc"
      if [[ "$(uname -s)" == "Darwin" ]]; then
        printf '%s\n' "$HOME/.zprofile"
      fi
      ;;
    */bash)
      if [[ -f "$HOME/.bashrc" ]]; then
        printf '%s\n' "$HOME/.bashrc"
      elif [[ -f "$HOME/.bash_profile" ]]; then
        printf '%s\n' "$HOME/.bash_profile"
      else
        printf '%s\n' "$HOME/.bashrc"
      fi
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_path() {
  local rc
  PATH_CONFIGURED=0
  PATH_RCS=()

  if ! shell_rc_files >/dev/null; then
    warn "Unknown shell (${SHELL:-unset}); add ~/.ask/bin to PATH manually:"
    warn "  ${PATH_LINE}"
    return
  fi

  while IFS= read -r rc; do
    [[ -n "$rc" ]] || continue
    append_path_to_rc "$rc"
    PATH_RCS+=("$rc")
  done < <(shell_rc_files)

  export PATH="$HOME/.ask/bin:$PATH"
  PATH_CONFIGURED=1
  PATH_RC="${PATH_RCS[0]}"
}

verify_install() {
  if [[ ! -x "$BIN" ]]; then
    die "Binary not found or not executable: ${BIN}"
  fi
  if ! "$BIN" --help >/dev/null 2>&1; then
    die "Binary failed to run: ${BIN}"
  fi
}

print_success() {
  local reload_note path_note rc

  if [[ "${PATH_CONFIGURED:-0}" -eq 1 ]]; then
    path_note="PATH updated in:"
    for rc in "${PATH_RCS[@]}"; do
      path_note="${path_note}
  ${rc}"
    done
    reload_note="Open a new terminal, or reload your shell:"
    for rc in "${PATH_RCS[@]}"; do
      reload_note="${reload_note}
  source ${rc}"
    done
    reload_note="${reload_note}

Then use the short command:
  ask --help"
  else
    path_note='Add ~/.ask/bin to PATH manually:
  export PATH="$HOME/.ask/bin:$PATH"'
    reload_note="$path_note"
  fi

  cat <<EOF

Installation complete!

Install directory: ${INSTALL_DIR}
Executable: ${BIN}
Version: v${VERSION}

${path_note}

${reload_note}

Run now without reloading (full path):
  ${BIN} --help

Next steps:
  1. Edit ${INSTALL_DIR}/config.json — model profiles and API key references
  2. Copy and edit environment file:
       cp ${INSTALL_DIR}/.env.example ${INSTALL_DIR}/.env
     Fill in AI API keys (e.g. DEEPSEEK_API_KEY, ANTHROPIC_API_KEY)

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

  if [[ -f "$INSTALL_DIR/.env.example" ]]; then
    warn "Already exists: ${INSTALL_DIR}/.env.example — skipping"
  else
    info "Copying .env.example …"
    fetch_repo_file ".env.example" "$INSTALL_DIR/.env.example"
  fi

  download_binary
  ensure_path
  verify_install
  print_success
}

main "$@"
