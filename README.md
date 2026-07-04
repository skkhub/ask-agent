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

Build on the **target platform** (macOS / Linux / Windows — no cross-compilation). Artifact size ~80–100 MB.

### CI artifacts

Push a `v*` tag or manually trigger [Build executable](.github/workflows/build.yml) to download platform binaries from GitHub Actions Artifacts:

- `ask-macos-arm64` / `ask-macos-x64`
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

---

# 中文

# ask — 轻量多模型命令行 Agent

TypeScript 编写的轻量 CLI agent。支持 **OpenAI 格式**（DeepSeek / Kimi / 通义等兼容）与 **Anthropic 格式**（Claude），按问题类型**自动路由**到最合适的模型，带完整的**工具调用循环**与**自主纠错**，并且**管道友好**——可以像普通 UNIX 工具一样串进 shell 管道。

## 特性

- **一次性执行 + 管道**：过程日志走 stderr，最终结果走 stdout，接管道不会混入过程信息
- **过程可见**：终端上实时显示路由决策与每次工具调用轨迹（`⚙ 工具(参数) → 结果`）
- **多步任务**：模型自动拆步执行，每步依据工具返回结果决定下一步
- **自主纠错**：工具报错原样回喂模型分析重试；完全相同的失败调用会附加提醒促使换方法；非法参数/未知工具不会崩进程
- **防失控**：`--max-turns`（默认 30）超限后禁用工具强制模型收尾
- **多模型自动路由**：轻量模型判断问题类型与思考深度（off/low/high），转给对应档案处理；`-p`/`-e` 可跳过路由直接指定
- **轻量**：参数解析用 Node 内置 `parseArgs`，无 CLI 框架依赖

## 使用

需要 Node.js ≥ 23.6（原生运行 TypeScript）。

```bash
npm install
cp .env.example .env   # 填入密钥；或直接 export 环境变量
npm link               # 可选：把 ask 装成全局命令
```

三种用法：

```bash
# 1. 一次性执行：结果可直接接管道
ask "当前目录下最大的 5 个文件是哪些"
ask -q "列出 package.json 里所有依赖名，每行一个，只输出名字" | sort

# 2. 管道输入作为上下文（或直接作为任务）
cat error.log | ask "分析这个报错的原因"
git diff | ask "帮我写一条 commit message"

# 3. 交互模式（REPL）：不带参数直接运行
ask          # 或 npm start
```

未 `npm link` 时用 `node src/cli.ts …` 或 `npm start -- …` 等价调用。

### 选项

| 选项 | 说明 |
|---|---|
| `-p, --profile <name>` | 指定模型档案，跳过自动路由 |
| `-e, --effort <level>` | 思考深度：`off` / `low` / `high` |
| `-q, --quiet` | 静默过程日志（stderr） |
| `-y, --yes` | 自动批准 shell 命令确认（慎用） |
| `--max-turns <n>` | 最大模型调用轮数（默认 30） |
| `--config <path>` | 指定配置文件（默认 `~/.ask/config.json`） |
| `-h, --help` / `-V, --version` | 帮助 / 版本 |

### 子命令

| 子命令 | 说明 |
|---|---|
| `ask update [--version <ver>]` | 从 [skkhub/ask-agent](https://github.com/skkhub/ask-agent) 下载最新（或指定）release 二进制到 `~/.ask/bin` |
| `ask uninstall [-y]` | 删除整个 `~/.ask` 目录（含配置、`.env`、二进制）。默认需确认，`-y` 跳过确认 |

首次安装可用 `scripts/install.sh`（macOS/Linux）或 `scripts/install.ps1`（Windows），默认从 `skkhub/ask-agent` Release 安装；设置 `ASK_REPO=owner/repo` 可覆盖（如 fork 仓库）。

将 `~/.ask/bin` 加入 PATH：

```bash
export PATH="$HOME/.ask/bin:$PATH"
```

### 输出通道约定

- **stdout**：只有最终回答（TTY 下 Markdown 美化渲染，管道下纯文本）
- **stderr**：路由决策、工具调用轨迹、进度、确认提示、错误

所以 `ask "任务" > result.md` 的同时，终端上仍能看到完整执行过程。

## Shell 工具与安全

`shell` 工具可执行本地命令，采用**白名单模式**：

- 内置只读白名单（`ls`、`cat`、`grep`、`git status` 等）自动执行
- 其余命令及危险模式（`sudo`、重定向、`find -exec`、`$(...)` 等）需用户确认
- 一次性执行时若 stdin 被管道占用，会尝试从 `/dev/tty` 询问；完全无法交互的环境（CI 等）自动拒绝
- 用户拒绝后本回合立即终止一切工具调用
- `shellWhitelist` 可追加自定义前缀（如 `"docker ps"`）；`shellRequireConfirm: false` 或 `--yes` 关闭确认（等于放开命令执行权限，慎用）

## 配置（config.json）

每个档案含 `provider`（`openai` / `anthropic`）、`baseURL`、`apiKey`、`model`、`description`。密钥用 `${ENV_VAR}` 引用环境变量（支持 `~/.ask/.env` 或直接 export），不写明文。`description` 是自动路由的判断依据——改描述即可调整路由策略。

### 语言

通过 `"language"` 控制所有**运行时用户可见文案**：CLI 提示、help、AI 系统提示词、工具 schema、路由提示、错误信息等。

| 取值 | 效果 |
|---|---|
| `"English"` | 英文（默认） |
| `"中文"` | 中文 |

建议 profile 的 `description` 与 `language` 使用同一种语言，以获得最佳路由效果。

```jsonc
{
  "language": "中文",
  "router": "fast",
  "stream": false,
  "maxTurns": 30,
  "shellRequireConfirm": true,
  "shellWhitelist": [],
  "tavilyApiKey": "${TAVILY_API_KEY}",
  "profiles": {
    "fast": { "provider": "openai", "baseURL": "https://api.deepseek.com", "apiKey": "${DEEPSEEK_API_KEY}", "model": "deepseek-v4-flash", "description": "日常对话、简单问答、快速查询" },
    "pro":  { "provider": "anthropic", "baseURL": "https://api.anthropic.com", "apiKey": "${ANTHROPIC_API_KEY}", "model": "claude-sonnet-4-5", "description": "复杂任务、写代码、深度分析" }
  }
}
```

思考深度映射：OpenAI 格式 → `reasoning_effort`；Anthropic 格式 → `thinking.budget_tokens`（可用 profile 的 `thinkingBudget` 覆盖，Anthropic 档案另可设 `maxTokens`）。

## 内置工具

`shell`（本地命令）、`get_time`、`calc`、`web_search` / `web_extract` / `web_crawl`（需 Tavily 密钥）。

添加新工具：在 `src/i18n.ts`（`buildTools`）加声明、`src/tools.ts` 的 `createHandlers` 加实现即可，agent 循环自动处理。

## 构建可执行文件

可将项目打包为**单个可执行文件**（内嵌 Node 运行时，目标机器无需安装 Node.js）。

```bash
npm install
npm run build          # 产物：dist/ask（Windows 为 dist/ask.exe）
npm run build:bundle   # 仅 JS bundle：dist/bundle.cjs
```

构建需在**目标平台**上进行。产物体积约 80–100 MB。推送 `v*` 标签或手动触发 CI 工作流可下载三平台二进制。

### 安装与更新

```bash
curl -fsSL https://raw.githubusercontent.com/skkhub/ask-agent/main/scripts/install.sh | bash
# 或本地：./scripts/install.sh
```

默认仓库：`skkhub/ask-agent`。fork 可通过 `ASK_REPO=owner/repo` 覆盖。

```bash
ask update                    # 下载最新 release
ask update --version v1.0.0   # 安装指定版本
ask uninstall                 # 删除 ~/.ask（需确认）
ask uninstall -y              # 跳过确认
```

首次使用前（若未用 install 脚本）：

```bash
mkdir -p ~/.ask
cp config.json ~/.ask/
cp .env ~/.ask/
```

默认配置路径：`~/.ask/config.json`；默认 env 文件：`~/.ask/.env`

## 调试

`.vscode/launch.json` 已配置：设断点后按 `F5` 启动。命令行：

```bash
node --inspect-brk src/cli.ts "任务"
```

## 文件结构

- `src/cli.ts` — CLI 入口
- `src/setup.ts` — update / uninstall 生命周期命令
- `src/agent.ts` — agent 循环
- `src/i18n.ts` — 多语言文案（English / 中文）
- `src/providers.ts` — Provider 抽象层
- `src/router.ts` — 自动路由
- `src/tools.ts` — 工具实现、shell 白名单
- `src/ui.ts` — 输出通道
- `src/render.ts` — Markdown 渲染
- `src/config.ts` — 配置加载
