import type { UTool } from "./providers.ts";

export type Locale = "English" | "中文";
export type AgentMode = "interactive" | "oneshot";

let currentLocale: Locale = "English";

export function normalizeLocale(raw?: string): Locale {
  return raw === "中文" ? "中文" : "English";
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function msg(): Messages {
  return MESSAGES[currentLocale];
}

export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale];
}

export interface Messages {
  errorPrefix: string;
  shellUserRejectedPrefix: string;
  unknownTool: string;
  noSearchResults: string;
  noExtractedContent: string;

  isError(result: string): boolean;
  isShellUserRejected(result: string): boolean;

  help: string;
  systemPrompt(mode: AgentMode): string;
  routerPrompt(keys: string[], menu: string, userText: string): string;

  // CLI
  stdinTruncated(originalLength: number): string;
  stdinPipePrefix: string;
  confirmDenied: string;
  routing: string;
  modelSelected(pick: string, model: string, effort: string): string;
  replBanner(profiles: string): string;
  replTitle: string;
  replPrompt: string;
  replError(msg: string): string;
  noTask: string;
  effortInvalid(efforts: string, received: string): string;
  profileNotFound(name: string, options: string): string;
  maxTurnsInvalid(received: string): string;

  // Setup (update / uninstall)
  helpUpdate: string;
  helpUninstall: string;
  setupUnsupportedArch(arch: string): string;
  setupUnsupportedPlatform(platform: string): string;
  updateChecking(repo: string, platform: string, artifact: string): string;
  updateDownloading(artifact: string, version: string): string;
  updateAlreadyLatest(version: string): string;
  updateSuccess(from: string, to: string): string;
  updatePathHint(binPath: string): string;
  updateFailed(reason: string): string;
  uninstallConfirm(home: string): string;
  uninstallCancelled: string;
  uninstallNotFound: string;
  uninstallSuccess: string;
  uninstallPartialWindows(home: string): string;

  // Config
  configHint: string;
  configNotFound: string;
  configReadFailed(path: string, detail: string): string;
  envVarMissing(name: string): string;
  routerNotInProfiles(router: string): string;

  // Agent
  assistantHeader: string;
  thinking: string;
  thinkingTurn(turn: number): string;
  maxTurnsSystem(maxTurns: number): string;
  maxTurnsWarning(maxTurns: number): string;
  toolNotExecuted: string;
  toolCallsForbidden: string;
  forceEnd: string;
  toolSkippedRejected: string;
  toolSkippedShellRejected: string;
  invalidToolArgs: string;
  unknownToolError(name: string): string;
  toolExecError(detail: string): string;
  repeatHint: string;

  // Tools — schema
  tools: UTool[];

  // Tools — runtime
  shellUserRejected: string;
  shellCommandEmpty: string;
  confirmDangerous: string;
  confirmNotWhitelisted: string;
  shellConfirmPrompt(command: string, cwd: string): string;
  shellExecuting(command: string): string;
  shellTimeout(ms: number): string;
  shellError(detail: string): string;
  outputTruncated(totalChars: number): string;
  searchEmpty: string;
  searching(term: string): string;
  searchResults(count: number): string;
  searchSummary(answer: string): string;
  noTitle: string;
  urlsEmpty: string;
  urlsTooMany: string;
  extracting(count: number): string;
  extractDone(count: number): string;
  urlEmpty: string;
  crawling(url: string): string;
  crawlDone(count: number): string;
  crawlBaseUrl(url: string): string;
  failedUrls: string;
  gettingTime: string;
  calculating(expr: string): string;
  calcInvalidChars: string;
  calcFailed: string;
  tavilyNotConfigured(label: string): string;
  tavilyFailed(label: string, detail: string): string;

  // Tool summary
  summaryDone(lineCount: number): string;
  summaryDoneResults(count: number, lineCount: number): string;
  summaryDoneUrls(count: number, lineCount: number): string;
  summaryDonePages(count: number, lineCount: number): string;
  summaryDoneExit(code: string): string;

  // Tavily operation labels
  tavilySearch: string;
  tavilyExtract: string;
  tavilyCrawl: string;

  err(name: string, detail?: string): string;
}

function buildMessages(locale: Locale): Messages {
  const en = locale === "English";
  const errorPrefix = en ? "Error:" : "错误：";
  const shellUserRejectedPrefix = en
    ? "Error: user rejected execution"
    : "错误：用户拒绝执行";

  const m: Messages = {
    errorPrefix,
    shellUserRejectedPrefix,
    unknownTool: en ? "Unknown tool" : "未知工具",
    noSearchResults: en ? "No relevant results found" : "未找到相关结果",
    noExtractedContent: en ? "No content extracted" : "未提取到内容",

    isError(result: string) {
      return result.startsWith(errorPrefix);
    },
    isShellUserRejected(result: string) {
      return result.startsWith(shellUserRejectedPrefix);
    },

    help: en
      ? `ask — lightweight multi-model CLI agent (auto-routing / tool use / self-correction / pipe-friendly)

Usage:
  ask [options] <task>           One-shot: progress logs → stderr, final answer → stdout
  echo data | ask [options] [task]  Pipe input as context (becomes the task if no task arg)
  ask                            Interactive mode (REPL)

Options:
  -p, --profile <name>   Use a specific model profile (skip auto-routing)
  -e, --effort <level>   Reasoning depth: off / low / high
  -q, --quiet            Suppress progress logs (stderr)
  -y, --yes              Auto-approve shell command confirmations (use with caution)
      --max-turns <n>    Max model call rounds (default 30)
      --config <path>    Config file path (default ~/.ask/config.json)
  -h, --help             Show help
  -V, --version          Show version

Commands:
  ask update [--version <ver>]   Download latest release binary to ~/.ask/bin
  ask uninstall [-y]             Remove ~/.ask entirely (config + binary)

Examples:
  ask "What are the 5 largest files in the current directory?"
  cat error.log | ask "Analyze the cause of this error"
  ask -q "List all dependency names from package.json, one per line, names only" | sort
`
      : `ask — 轻量多模型命令行 agent（自动路由 / 工具调用 / 自主纠错 / 管道友好）

用法：
  ask [选项] <任务描述>        一次性执行：过程日志 → stderr，最终结果 → stdout
  echo 数据 | ask [选项] [任务]  管道输入作为上下文（无任务参数时直接作为任务）
  ask                          交互模式（REPL）

选项：
  -p, --profile <name>   指定模型档案（跳过自动路由）
  -e, --effort <level>   思考深度：off / low / high
  -q, --quiet            静默过程日志（stderr）
  -y, --yes              自动批准 shell 命令确认（慎用）
      --max-turns <n>    最大模型调用轮数（默认 30）
      --config <path>    指定配置文件（默认 ~/.ask/config.json）
  -h, --help             显示帮助
  -V, --version          显示版本

子命令：
  ask update [--version <ver>]   下载最新 release 二进制到 ~/.ask/bin
  ask uninstall [-y]             删除整个 ~/.ask（含配置与二进制）

示例：
  ask "当前目录下最大的 5 个文件是哪些"
  cat error.log | ask "分析这个报错的原因"
  ask -q "列出 package.json 里所有依赖名，每行一个，只输出名字" | sort
`,

    systemPrompt(mode: AgentMode): string {
      const base = en
        ? `You are an efficient command-line agent that completes tasks by calling tools.
Environment: os=${process.platform}, arch=${process.arch}, cwd=${process.cwd()}

Guidelines:
- Multi-step tasks: break them into steps and execute sequentially; after each step, verify the tool result before proceeding.
- Self-correction: when a tool returns an error, analyze the cause (bad args, missing command, network failure, etc.), fix it, and retry; do not resend identical failed calls; if the same approach fails twice, try a different approach; if you truly cannot finish, explain what you tried, where it failed, and what the user can do manually.
- shell tool: read-only whitelisted commands run automatically; other commands and dangerous patterns (sudo, redirects, find -exec, etc.) require user confirmation. If the user rejects execution, stop all tool calls for this turn and only explain the situation with manually runnable commands.
- Web: web_search for real-time info; web_extract for batch page content; web_crawl for site/docs crawling (returns an error if the API key is not configured).
- Keep replies concise; give results and conclusions directly.
- For queries about "latest/current" information, you must call get_time first (and no other tools in the same turn), then use that date for subsequent decisions.
- If get_time was called, later tool arguments must match the returned date; do not use default years from training data.`
        : `你是一个高效的命令行 agent，可调用工具完成任务。
环境信息：os=${process.platform}，arch=${process.arch}，cwd=${process.cwd()}

工作准则：
- 多步任务：先拆解成步骤再逐步执行；每一步都检查工具返回结果是否符合预期，确认无误再进行下一步。
- 自主纠错：工具返回错误时，先分析原因（参数不对、命令不存在、网络失败等），修正后再试；不要原样重发失败过的调用；同一思路连续失败两次就换思路；确实无法完成时，如实说明尝试过什么、失败在哪、建议用户怎么做。
- shell 工具：白名单内的只读命令可直接执行；其余命令及危险模式（sudo、重定向、find -exec 等）需要用户确认。若用户拒绝执行，本回合立即停止调用一切工具，只能向用户解释并给出可手动执行的命令。
- 联网：web_search 搜索实时信息；web_extract 批量提取网页正文；web_crawl 爬取站点/文档（未配置密钥时会返回错误）。
- 回复精简，直接给出结果与结论。
- 查询「最新/当前/latest/current」类信息时，必须先调用 get_time （且不能同时调用其他工具）获取当前时间，然后以此为依据进行后续决策。
- 若已调用 get_time，后续工具参数必须与返回日期一致，不得使用训练数据中的默认年份。`;

      if (mode === "oneshot") {
        return en
          ? `${base}

Output requirement (important): this is one-shot CLI mode. Your final answer goes to stdout and may be piped to another program. The final answer must contain only the result: no greetings, no task restatement, no process explanation (process is already in logs). If the task requires a specific format (JSON, CSV, one item per line, etc.), output strictly that format only.`
          : `${base}

输出要求（重要）：当前是命令行一次性执行模式，你的最终回答会写入 stdout，可能被管道传给下一个程序处理。最终回答只包含结果本身：不要寒暄、不要复述任务、不要解释过程（过程已在日志中）。若任务要求特定格式（JSON、CSV、每行一条等），严格只输出该格式的内容。`;
      }
      return base;
    },

    routerPrompt(keys: string[], menu: string, userText: string) {
      return en
        ? `You are a task router. Based on the profiles below, pick the best profile for the user input and decide the reasoning depth.\n` +
            `effort values: off (simple direct answer), low (some reasoning), high (complex, deep reasoning).\n` +
            `Output exactly one line of JSON: {"profile":"<profile name>","effort":"off|low|high"} with no extra text.\n\n` +
            `Profiles (profile values: ${keys.join(" / ")}):\n${menu}\n\nUser input: ${userText}`
        : `你是一个任务路由器。根据下面的分类，为用户输入选择最合适的处理档案，并判断需要的思考深度。\n` +
            `思考深度 effort 取值：off（简单直答）、low（需要一点推理）、high（复杂、需深度推理）。\n` +
            `严格只输出一行 JSON，格式：{"profile":"<档案名>","effort":"off|low|high"}，不要多余文字。\n\n` +
            `档案（profile 取值：${keys.join(" / ")}）：\n${menu}\n\n用户输入：${userText}`;
    },

    stdinTruncated(originalLength: number) {
      return en
        ? `…(stdin input truncated; original length ${originalLength} characters)`
        : `…（stdin 输入过长已截断，原始长度 ${originalLength} 字符）`;
    },
    stdinPipePrefix: en
      ? "Data piped via stdin:"
      : "以下是通过管道（stdin）传入的数据：",
    confirmDenied: en
      ? "  (Non-interactive environment; auto-rejected. Use --yes to auto-approve.)"
      : "  （非交互环境无法确认，已自动拒绝；如需自动批准请加 --yes）",
    routing: en ? "Routing…" : "路由中…",
    modelSelected(pick, model, effort) {
      return en
        ? `  ↳ model → ${pick} (${model}), effort: ${effort}`
        : `  ↳ 模型 → ${pick} (${model})，思考：${effort}`;
    },
    replBanner(profiles) {
      return en
        ? `(profiles: ${profiles}; type exit to quit)\n`
        : `（档案：${profiles}；输入 exit 退出）\n`;
    },
    replTitle: en ? "Multi-model Agent" : "多模型 Agent",
    replPrompt: en ? "You › " : "你 › ",
    replError(msg) {
      return en ? `  ✗ Error: ${msg} (session continues)` : `  ✗ 出错：${msg}（会话继续）`;
    },
    noTask: en
      ? "No task to run: provide a task description or pipe input (--help for usage)"
      : "没有任务可执行：请传入任务描述或通过管道输入内容（--help 查看用法）",
    effortInvalid(efforts, received) {
      return en
        ? `--effort must be one of ${efforts}, got: ${received}`
        : `--effort 只能是 ${efforts}，收到：${received}`;
    },
    profileNotFound(name, options) {
      return en
        ? `--profile "${name}" not found; available: ${options}`
        : `--profile "${name}" 不存在，可选：${options}`;
    },
    maxTurnsInvalid(received) {
      return en
        ? `--max-turns must be a positive integer, got: ${received}`
        : `--max-turns 需要正整数，收到：${received}`;
    },

    helpUpdate: en
      ? `ask update — download release binary to ~/.ask/bin

Usage:
  ask update [--version <ver>] [-y]

Options:
      --version <ver>   Install a specific release version (default: latest)
  -y, --yes             Non-interactive (reserved)
  -h, --help            Show this help

Repository: skkhub/ask-agent
`
      : `ask update — 下载 release 二进制到 ~/.ask/bin

用法：
  ask update [--version <ver>] [-y]

选项：
      --version <ver>   安装指定 release 版本（默认：最新）
  -y, --yes             非交互模式（保留）
  -h, --help            显示帮助

仓库：skkhub/ask-agent
`,

    helpUninstall: en
      ? `ask uninstall — remove ~/.ask entirely

Usage:
  ask uninstall [-y]

Options:
  -y, --yes   Skip confirmation (removes config, .env, and binary)
  -h, --help  Show this help
`
      : `ask uninstall — 删除整个 ~/.ask 目录

用法：
  ask uninstall [-y]

选项：
  -y, --yes   跳过确认（删除配置、.env 与二进制）
  -h, --help  显示帮助
`,

    setupUnsupportedArch(arch) {
      return en
        ? `Unsupported CPU architecture: ${arch}`
        : `不支持的 CPU 架构：${arch}`;
    },
    setupUnsupportedPlatform(platform) {
      return en
        ? `Unsupported platform: ${platform}`
        : `不支持的平台：${platform}`;
    },
    updateChecking(repo, platform, artifact) {
      return en
        ? `Checking update: ${repo} (${platform}, ${artifact})`
        : `检查更新：${repo}（${platform}，${artifact}）`;
    },
    updateDownloading(artifact, version) {
      return en
        ? `Downloading ${artifact} (v${version})…`
        : `下载 ${artifact}（v${version}）…`;
    },
    updateAlreadyLatest(version) {
      return en
        ? `Already up to date (v${version}).`
        : `已是最新版本（v${version}）。`;
    },
    updateSuccess(from, to) {
      return en
        ? `Updated: v${from} → v${to}`
        : `更新完成：v${from} → v${to}`;
    },
    updatePathHint(binPath) {
      return en
        ? `Binary: ${binPath}\nEnsure ~/.ask/bin is on your PATH.`
        : `二进制：${binPath}\n请确保 ~/.ask/bin 已加入 PATH。`;
    },
    updateFailed(reason) {
      return en ? `Update failed: ${reason}` : `更新失败：${reason}`;
    },
    uninstallConfirm(home) {
      return en
        ? `This will permanently delete ${home} (config, .env, binary). Continue?`
        : `将永久删除 ${home}（含配置、.env、二进制）。继续？`;
    },
    uninstallCancelled: en ? "Uninstall cancelled." : "已取消卸载。",
    uninstallNotFound: en
      ? "Nothing to uninstall (~/.ask not found)."
      : "无需卸载（未找到 ~/.ask）。",
    uninstallSuccess: en ? "Uninstall complete." : "卸载完成。",
    uninstallPartialWindows(home) {
      return en
        ? `Removed config and data from ${home}. The running ask.exe could not be deleted — close this terminal and delete ${home} manually.`
        : `已删除 ${home} 中的配置与数据。正在运行的 ask.exe 无法删除 — 请关闭终端后手动删除 ${home}。`;
    },

    configHint: en
      ? "Place config.json at ~/.ask/config.json, or pass --config."
      : "请将 config.json 放到 ~/.ask/config.json；也可用 --config 指定路径。",
    configNotFound: "",
    configReadFailed(path, detail) {
      return en
        ? `Failed to read config (${path}): ${detail}`
        : `读取配置文件失败（${path}）：${detail}`;
    },
    envVarMissing(name) {
      return en
        ? `Environment variable ${name} is not set (referenced in config.json)`
        : `环境变量 ${name} 未设置（config.json 引用了它）`;
    },
    routerNotInProfiles(router) {
      return en
        ? `config.json router "${router}" is not in profiles`
        : `config.json 的 router "${router}" 不在 profiles 中`;
    },

    assistantHeader: en ? "Assistant ›" : "助手 ›",
    thinking: en ? "Thinking…" : "思考中…",
    thinkingTurn(turn) {
      return en ? `Thinking… (turn ${turn})` : `思考中…（第 ${turn} 轮）`;
    },
    maxTurnsSystem(maxTurns) {
      return en
        ? `(System: maximum tool call rounds (${maxTurns}) reached. Provide a final answer immediately; do not request any more tools.)`
        : `（系统提示：已达到最大工具调用轮数，请立即根据已有信息给出最终回答，不要再请求任何工具。）`;
    },
    maxTurnsWarning(maxTurns) {
      return en
        ? `  ⚠ Max turns (${maxTurns}) reached; asking model to wrap up`
        : `  ⚠ 已达最大轮数（${maxTurns}），要求模型收尾`;
    },
    toolNotExecuted: en ? "not executed (wrap-up requested)" : "未执行（已要求收尾）",
    toolCallsForbidden: en
      ? `${errorPrefix} tool calls are not allowed this turn; provide the final answer directly.`
      : `${errorPrefix}本回合已不允许调用工具，请直接给出最终回答。`,
    forceEnd: en
      ? "  ⚠ Model refused to wrap up; forcing end"
      : "  ⚠ 模型多次拒绝收尾，强制结束",
    toolSkippedRejected: en ? "skipped (user rejected execution)" : "已跳过（用户拒绝执行）",
    toolSkippedShellRejected: en
      ? `${errorPrefix} skipped (user rejected shell execution)`
      : `${errorPrefix}已跳过（用户拒绝执行 shell）`,
    invalidToolArgs: en
      ? "Error: tool arguments are not valid JSON; fix and retry"
      : "错误：工具参数不是合法 JSON，请修正参数后重试",
    unknownToolError(name) {
      return en ? `Error: unknown tool ${name}` : `错误：未知工具 ${name}`;
    },
    toolExecError(detail) {
      return en ? `Error: tool execution failed (${detail})` : `错误：工具执行异常（${detail}）`;
    },
    repeatHint: en
      ? "(Note: this exact call already failed with the same arguments; do not retry identically; adjust args or use another approach.)"
      : "（注意：这一调用之前已用完全相同的参数失败过，不要原样重试；请调整参数或改用其他方法。）",

    tools: buildTools(locale),

    shellUserRejected: en
      ? "Error: user rejected execution. All tool calls are stopped for this turn; explain the situation to the user and suggest manually runnable commands only; do not call any more tools."
      : "错误：用户拒绝执行。本回合已终止所有工具调用；请直接向用户说明情况并给出可手动执行的命令建议，勿再调用任何工具。",
    shellCommandEmpty: en ? "Error: command must not be empty" : "错误：command 不能为空",
    confirmDangerous: en
      ? "Confirmation required (dangerous pattern)"
      : "需要确认（含危险模式）",
    confirmNotWhitelisted: en
      ? "Confirmation required (not on whitelist)"
      : "需要确认（非白名单命令）",
    shellConfirmPrompt(command, cwd) {
      return en
        ? `About to run:\n  ${command}\n  cwd=${cwd}\nConfirm?`
        : `即将执行：\n  ${command}\n  cwd=${cwd}\n确认？`;
    },
    shellExecuting(command) {
      return en ? `Running: ${command}` : `执行：${command}`;
    },
    shellTimeout(ms) {
      return en ? `Error: command timed out (${ms}ms)` : `错误：命令超时（${ms}ms）`;
    },
    shellError(detail) {
      return `${errorPrefix} ${detail}`;
    },
    outputTruncated(totalChars) {
      return en
        ? `…(output truncated; ${totalChars} characters total)`
        : `…（输出已截断，共 ${totalChars} 字符）`;
    },
    searchEmpty: en ? "Error: search term must not be empty" : "错误：搜索词不能为空",
    searching(term) {
      return en ? `Searching: ${term}` : `搜索：${term}`;
    },
    searchResults(count) {
      return en ? `Received ${count} results` : `收到 ${count} 条结果`;
    },
    searchSummary(answer) {
      return en ? `Summary: ${answer}` : `摘要：${answer}`;
    },
    noTitle: en ? "(no title)" : "（无标题）",
    urlsEmpty: en ? "Error: urls must not be empty" : "错误：urls 不能为空",
    urlsTooMany: en ? "Error: at most 20 URLs supported" : "错误：最多支持 20 个 URL",
    extracting(count) {
      return en ? `Extracting ${count} URL(s)…` : `提取 ${count} 个 URL…`;
    },
    extractDone(count) {
      return en ? `Extracted ${count} URL(s)` : `提取完成，${count} 个 URL`;
    },
    urlEmpty: en ? "Error: url must not be empty" : "错误：url 不能为空",
    crawling(url) {
      return en ? `Crawling: ${url}` : `爬取：${url}`;
    },
    crawlDone(count) {
      return en ? `Crawled ${count} page(s)` : `爬取完成，${count} 页`;
    },
    crawlBaseUrl(url) {
      return en ? `Start URL: ${url}` : `起始 URL：${url}`;
    },
    failedUrls: en ? "Failed URLs:" : "失败的 URL：",
    gettingTime: en ? "Getting time…" : "获取时间…",
    calculating(expr) {
      return en ? `Calculating: ${expr}` : `计算：${expr}`;
    },
    calcInvalidChars: en
      ? "Error: expression contains invalid characters"
      : "错误：表达式含非法字符",
    calcFailed: en ? "Error: unable to calculate" : "错误：无法计算",
    tavilyNotConfigured(label) {
      return en
        ? `Error: TAVILY_API_KEY is not configured; cannot run ${label}`
        : `错误：未配置 TAVILY_API_KEY，无法执行${label}`;
    },
    tavilyFailed(label, detail) {
      return en ? `Error: ${label} failed (${detail})` : `错误：${label}失败（${detail}）`;
    },

    summaryDone(lineCount) {
      return en ? `Done (${lineCount} lines)` : `完成（${lineCount} 行）`;
    },
    summaryDoneResults(count, lineCount) {
      return en
        ? `Done, ${count} results (${lineCount} lines)`
        : `完成，${count} 条结果（${lineCount} 行）`;
    },
    summaryDoneUrls(count, lineCount) {
      return en
        ? `Done, ${count} URL(s) (${lineCount} lines)`
        : `完成，${count} 个 URL（${lineCount} 行）`;
    },
    summaryDonePages(count, lineCount) {
      return en
        ? `Done, ${count} page(s) (${lineCount} lines)`
        : `完成，${count} 页（${lineCount} 行）`;
    },
    summaryDoneExit(code) {
      return en ? `Done, exit ${code}` : `完成，exit ${code}`;
    },

    tavilySearch: en ? "search" : "搜索",
    tavilyExtract: en ? "content extraction" : "内容提取",
    tavilyCrawl: en ? "site crawl" : "网站爬取",

    err(name, detail) {
      return detail ? `${errorPrefix} ${name} (${detail})` : `${errorPrefix} ${name}`;
    },
  };

  m.configNotFound = en
    ? `config.json not found. ${m.configHint}`
    : `找不到 config.json。${m.configHint}`;

  return m;
}

function buildTools(locale: Locale): UTool[] {
  const en = locale === "English";
  return [
    {
      name: "shell",
      description: en
        ? "Run a CLI command in the local shell; returns stdout, stderr, and exit code"
        : "在本地 shell 中执行 CLI 命令，返回 stdout、stderr 与退出码",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: en ? "Shell command to run" : "要执行的 shell 命令",
          },
          cwd: {
            type: "string",
            description: en
              ? "Optional working directory (default: current directory)"
              : "可选：工作目录，默认为当前目录",
          },
          timeout_ms: {
            type: "number",
            description: en
              ? "Optional timeout in milliseconds (default 120000)"
              : "可选：超时毫秒数，默认 120000",
          },
        },
        required: ["command"],
      },
    },
    {
      name: "get_time",
      description: en ? "Get the current date and time" : "获取当前日期和时间",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "calc",
      description: en
        ? "Evaluate a math expression, e.g. (1+2)*3"
        : "计算一个数学表达式，例如 (1+2)*3",
      parameters: {
        type: "object",
        properties: {
          expr: {
            type: "string",
            description: en ? "Math expression" : "数学表达式",
          },
        },
        required: ["expr"],
      },
    },
    {
      name: "web_search",
      description: en
        ? "Search the web for real-time information"
        : "搜索互联网获取实时信息",
      parameters: {
        type: "object",
        properties: {
          search_term: {
            type: "string",
            description: en ? "Search keywords or question" : "搜索关键词或问题",
          },
        },
        required: ["search_term"],
      },
    },
    {
      name: "web_extract",
      description: en
        ? "Extract clean page content from one or more URLs (Tavily Extract: strips ads/nav, supports JS rendering and tables, up to 20 URLs)"
        : "从一个或多个 URL 提取干净的网页正文（Tavily Extract：去广告/导航、支持 JS 渲染与表格，可批量最多 20 个 URL）",
      parameters: {
        type: "object",
        properties: {
          urls: {
            type: "array",
            items: { type: "string" },
            description: en
              ? "URLs to extract (max 20)"
              : "要提取内容的 URL 列表（最多 20 个）",
          },
          query: {
            type: "string",
            description: en
              ? "Optional: rerank and trim each page to the most relevant snippets for this question"
              : "可选：按此问题重排并截取各页最相关的内容片段",
          },
          extract_depth: {
            type: "string",
            enum: ["basic", "advanced"],
            description: en
              ? "Extraction depth: basic is faster; advanced supports JS rendering and tables"
              : "提取深度：basic 较快，advanced 支持 JS 渲染与表格",
          },
          chunks_per_source: {
            type: "number",
            description: en
              ? "With query: relevant snippets per URL (1-5)"
              : "配合 query 使用，每个 URL 返回的相关片段数（1-5）",
          },
        },
        required: ["urls"],
      },
    },
    {
      name: "web_crawl",
      description: en
        ? "Crawl a site from a start URL and extract page content (Tavily Crawl: good for docs/sites; depth and path filters supported)"
        : "从起始 URL 沿链接爬取网站并提取各页正文（Tavily Crawl：适合文档站、整站调研，可限定深度与路径）",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: en ? "Start URL" : "起始 URL" },
          max_depth: {
            type: "number",
            description: en
              ? "Max crawl depth (1-5, default 1)"
              : "最大爬取深度（1-5，默认 1）",
          },
          limit: {
            type: "number",
            description: en
              ? "Max pages to crawl (default 10)"
              : "最多爬取的页面数（默认 10）",
          },
          instructions: {
            type: "string",
            description: en
              ? "Optional natural-language guidance to focus on semantically relevant pages"
              : "可选：自然语言指引，聚焦语义相关的页面",
          },
          select_paths: {
            type: "array",
            items: { type: "string" },
            description: en
              ? "Optional: only crawl paths matching these regexes (e.g. /docs/.*)"
              : "可选：只爬取匹配这些正则的路径（如 /docs/.*）",
          },
          exclude_paths: {
            type: "array",
            items: { type: "string" },
            description: en
              ? "Optional: exclude paths matching these regexes"
              : "可选：排除匹配这些正则的路径",
          },
          extract_depth: {
            type: "string",
            enum: ["basic", "advanced"],
            description: en
              ? "Extraction depth: basic is faster; advanced supports JS rendering and tables"
              : "提取深度：basic 较快，advanced 支持 JS 渲染与表格",
          },
          chunks_per_source: {
            type: "number",
            description: en
              ? "With instructions: relevant snippets per page (1-5)"
              : "配合 instructions 使用，每页返回的相关片段数（1-5）",
          },
        },
        required: ["url"],
      },
    },
  ];
}

const MESSAGES: Record<Locale, Messages> = {
  English: buildMessages("English"),
  中文: buildMessages("中文"),
};

export function getTools(locale?: Locale): UTool[] {
  return messagesFor(locale ?? getLocale()).tools;
}
