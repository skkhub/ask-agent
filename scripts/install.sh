#!/usr/bin/env bash
# Install ask CLI: set up ~/.ask, copy config templates, download platform binary.
set -euo pipefail

ASK_HOME="${ASK_HOME:-$HOME/.ask}"
ASK_BIN_DIR="$ASK_HOME/bin"
ASK_BIN="$ASK_BIN_DIR/ask"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

info() { printf '==> %s\n' "$*"; }
warn() { printf '警告: %s\n' "$*" >&2; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少依赖命令: $1"
}

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    arm64 | aarch64) arch="arm64" ;;
    x86_64 | amd64) arch="x64" ;;
    *) die "不支持的 CPU 架构: $arch" ;;
  esac

  case "$os-$arch" in
    darwin-arm64) ARTIFACT="ask-macos-arm64" ;;
    darwin-x64) ARTIFACT="ask-macos-x64" ;;
    linux-x64) ARTIFACT="ask-linux-x64" ;;
    linux-arm64) die "暂不提供 linux-arm64 预编译包，请从源码构建" ;;
    *) die "不支持的平台: $os ($arch)" ;;
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
  info "从 GitHub 获取最新 release 版本…"
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v?([^"]+)".*/\1/')"
  [[ -n "$VERSION" ]] || die "无法获取 release 版本，请设置 ASK_VERSION"
}

fetch_repo_file() {
  local name="$1" dest="$2"
  if [[ -f "$REPO_ROOT/$name" ]]; then
    cp "$REPO_ROOT/$name" "$dest"
    return
  fi
  need_cmd curl
  local url="https://raw.githubusercontent.com/${REPO}/v${VERSION}/${name}"
  info "下载 ${name} …"
  curl -fsSL "$url" -o "$dest"
}

download_binary() {
  need_cmd curl
  local url="https://github.com/${REPO}/releases/download/v${VERSION}/${ARTIFACT}"
  info "下载 ${ARTIFACT} (v${VERSION}) …"
  curl -fsSL "$url" -o "$ASK_BIN"
  chmod +x "$ASK_BIN"
}

print_success() {
  cat <<EOF

安装成功！

安装目录: ${ASK_HOME}
可执行文件: ${ASK_BIN}

请将 ~/.ask/bin 加入 PATH，例如在 ~/.zshrc 或 ~/.bashrc 中添加:
  export PATH="\$HOME/.ask/bin:\$PATH"

接下来请完成配置:
  1. 编辑 ${ASK_HOME}/config.json — 设置模型档案与 API 密钥引用
  2. 复制并编辑环境变量文件:
       cp ${ASK_HOME}/.env.example ${ASK_HOME}/.env
     在 .env 中填入 AI API 密钥（如 DEEPSEEK_API_KEY、ANTHROPIC_API_KEY 等）

配置完成后运行:
  ask --help

EOF
}

main() {
  need_cmd mkdir
  need_cmd chmod

  detect_platform
  info "平台: ${PLATFORM}（产物: ${ARTIFACT}）"

  detect_repo
  detect_version
  info "仓库: ${REPO}，版本: v${VERSION}"

  info "创建目录 ${ASK_HOME} …"
  mkdir -p "$ASK_BIN_DIR"

  if [[ -f "$ASK_HOME/config.json" ]]; then
    warn "已存在 ${ASK_HOME}/config.json，跳过复制"
  else
    info "复制 config.json …"
    fetch_repo_file "config.json" "$ASK_HOME/config.json"
  fi

  info "复制 .env.example …"
  fetch_repo_file ".env.example" "$ASK_HOME/.env.example"

  download_binary
  print_success
}

main "$@"
