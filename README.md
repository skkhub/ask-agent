[中文文档](README.zh-CN.md)

# ask — Lightweight Multi-Model CLI Agent

A lightweight TypeScript CLI agent. Supports **OpenAI-compatible** APIs (DeepSeek / Kimi / Qwen, etc.) and **Anthropic** (Claude). Routes each task to the best model profile, runs a full **tool-calling loop** with **self-correction**, and stays **pipe-friendly** — use it like any UNIX tool in shell pipelines.

## Features

- **One-shot + pipes**: progress logs on stderr, final answer on stdout — safe to pipe
- **Visible progress**: routing decisions and tool call traces in the terminal (`⚙ tool(args) → result`)
- **Multi-step tasks**: the model breaks work into steps and checks each tool result before continuing
- **Self-correction**: tool errors are fed back for retry; identical failed calls get a nudge to try another approach; bad args / unknown tools never crash the process
- **Runaway guard**: after `--max-turns` (default 30) tools are disabled and the model must wrap up
- **Multi-model routing**: a fast model picks profile + reasoning depth (off/low/high); override with `-p` / `-e`
- **Minimal deps**: argument parsing uses Node built-in `parseArgs`, no CLI framework

## Quick start

Requires Node.js ≥ 23.6 (native TypeScript execution).

```bash
npm install
cp .env.example .env   # fill in API keys, or export env vars directly
npm link               # optional: install `ask` globally
```

Three usage modes:

```bash
# 1. One-shot: pipe the result
ask "What are the 5 largest files in the current directory?"
ask -q "List dependency names from package.json, one per line, names only" | sort

# 2. Pipe input as context (or as the task itself)
cat error.log | ask "Analyze the cause of this error"
git diff | ask "Write a commit message for me"

# 3. Interactive REPL: run with no arguments
ask          # or npm start
```

Without `npm link`, use `node src/cli.ts …` or `npm start -- …`.

### Options

| Option | Description |
|---|---|
| `-p, --profile <name>` | Use a specific model profile (skip auto-routing) |
| `-e, --effort <level>` | Reasoning depth: `off` / `low` / `high` |
| `-q, --quiet` | Suppress progress logs (stderr) |
| `-y, --yes` | Auto-approve shell command confirmations (use with caution) |
| `--max-turns <n>` | Max model call rounds (default 30) |
| `--config <path>` | Config file path (default `~/.ask/config.json`) |
| `-h, --help` / `-V, --version` | Help / version |

### Commands

| Command | Description |
|---|---|
| `ask update [--version <ver>]` | Download latest (or specified) release binary to `~/.ask/bin` from [skkhub/ask-agent](https://github.com/skkhub/ask-agent) |
| `ask uninstall [-y]` | Remove entire `~/.ask` directory (config, `.env`, binary). Prompts for confirmation unless `-y` |

Install the binary for the first time with `scripts/install.sh` (macOS/Linux) or `scripts/install.ps1` (Windows). By default both install from `skkhub/ask-agent` releases; set `ASK_REPO=owner/repo` to override (e.g. for a fork).

Add `~/.ask/bin` to your PATH:

```bash
export PATH="$HOME/.ask/bin:$PATH"
```

### Output channels

- **stdout**: final answer only (Markdown-rendered on TTY, plain text in pipes)
- **stderr**: routing, tool traces, progress, confirmations, errors

So `ask "task" > result.md` still shows the full run on the terminal.

## Shell tool & safety

The `shell` tool runs local commands with a **whitelist**:

- Built-in read-only whitelist (`ls`, `cat`, `grep`, `git status`, etc.) runs automatically
- Other commands and dangerous patterns (`sudo`, redirects, `find -exec`, `$(...)`, etc.) require confirmation
- In one-shot mode with piped stdin, confirmation is attempted via `/dev/tty`; fully non-interactive environments (CI) auto-reject
- After user rejection, all tool calls stop for that turn
- Extend with `shellWhitelist` (e.g. `"docker ps"`); set `shellRequireConfirm: false` or pass `--yes` to disable confirmation (grants broad command execution — use with caution)

## Configuration (config.json)

Each profile has `provider` (`openai` / `anthropic`), `baseURL`, `apiKey`, `model`, `description`. Keys use `${ENV_VAR}` references (loaded from `~/.ask/.env` or exported env vars). `description` drives auto-routing — edit it to tune routing.

### Language

Set `"language"` to control all **runtime user-facing text**: CLI messages, help, AI system prompts, tool schemas, router prompts, and error strings.

| Value | Effect |
|---|---|
| `"English"` | English (default) |
| `"中文"` | Chinese |

Write profile `description` fields in the same language as `language` for best routing quality.

```jsonc
{
  "language": "English",    // "English" (default) or "中文"
  "router": "fast",         // profile used for routing (pick a cheap/fast one)
  "stream": false,          // REPL output: false = Markdown after each turn; true = streaming plain text
  "maxTurns": 30,
  "shellRequireConfirm": true,
  "shellWhitelist": [],
  "tavilyApiKey": "${TAVILY_API_KEY}",   // optional, for web_search / web_extract / web_crawl
  "profiles": {
    "fast": { "provider": "openai", "baseURL": "https://api.deepseek.com", "apiKey": "${DEEPSEEK_API_KEY}", "model": "deepseek-v4-flash", "description": "Daily chat, simple Q&A, quick lookups" },
    "pro":  { "provider": "anthropic", "baseURL": "https://api.anthropic.com", "apiKey": "${ANTHROPIC_API_KEY}", "model": "claude-sonnet-4-5", "description": "Complex tasks, coding, deep analysis" }
  }
}
```

Reasoning depth mapping: OpenAI format → `reasoning_effort`; Anthropic format → `thinking.budget_tokens` (override per profile with `thinkingBudget`; Anthropic profiles may also set `maxTokens`).

## Built-in tools

`shell` (local commands), `get_time`, `calc`, `web_search` / `web_extract` / `web_crawl` (Tavily key required).

To add a tool: declare it in `src/i18n.ts` (`buildTools`) and implement it in `createHandlers` in `src/tools.ts` — the agent loop handles the rest.

## Building a standalone executable

Package into a **single binary** (embeds Node; target machine does not need Node.js installed).

### Local build

```bash
npm install
npm run build          # output: dist/ask (dist/ask.exe on Windows)
```

JS bundle only (no SEA binary):

```bash
npm run build:bundle   # output: dist/bundle.cjs
```

Build on the **target platform** (macOS Apple Silicon / Linux / Windows — no cross-compilation). Intel Mac has no prebuilt binary; build from source with `npm run build`. Artifact size ~80–100 MB.

### CI artifacts

Push a `v*` tag or manually trigger [Build executable](.github/workflows/build.yml) to download platform binaries from GitHub Actions Artifacts:

- `ask-macos-arm64`
- `ask-linux-x64`
- `ask-windows-x64.exe`

### Standalone binary setup

Install with the install script (downloads the release binary and copies config templates):

```bash
curl -fsSL https://raw.githubusercontent.com/skkhub/ask-agent/main/scripts/install.sh | bash
# or locally: ./scripts/install.sh
```

Default repository: `skkhub/ask-agent`. Override with `ASK_REPO=owner/repo` for forks.

Update or remove an existing installation:

```bash
ask update                    # download latest release
ask update --version v1.0.0   # install a specific version
ask uninstall                 # remove ~/.ask (prompts for confirmation)
ask uninstall -y              # remove without confirmation
```

The binary does **not** bundle `config.json`. Before first use (if not using the install script):

```bash
mkdir -p ~/.ask
cp config.json ~/.ask/
cp .env ~/.ask/          # or export env vars directly
```

Or place `config.json` and `.env` in the working directory.

Default config path (without `--config`): `~/.ask/config.json`

Default env file: `~/.ask/.env`

macOS Gatekeeper (binaries downloaded from CI):

```bash
xattr -d com.apple.quarantine dist/ask
```

## Debugging (VS Code breakpoints)

`.vscode/launch.json` is preconfigured — set breakpoints and press `F5` (add a one-shot task in `args` if needed). From the shell:

```bash
node --inspect-brk src/cli.ts "your task"
```

## Project layout

- `src/cli.ts` — CLI entry: args, one-shot / REPL dispatch
- `src/setup.ts` — update / uninstall lifecycle commands
- `src/agent.ts` — agent loop: model → tools → model, correction & turn limits
- `src/i18n.ts` — locale strings (English / 中文)
- `src/providers.ts` — provider abstraction (OpenAI / Anthropic)
- `src/router.ts` — profile routing from descriptions
- `src/tools.ts` — tool implementations, shell whitelist
- `src/ui.ts` — output channels (stderr progress / stdout result)
- `src/render.ts` — terminal Markdown rendering
- `src/config.ts` — config loading + `${ENV}` expansion
