import { spawn } from "node:child_process";
import { tavily, type TavilyClient } from "@tavily/core";
import type { Config } from "./config.ts";
import { getTools, msg } from "./i18n.ts";

const SHELL_OUTPUT_LIMIT = 32_000;

export { getTools } from "./i18n.ts";

export function isShellUserRejected(result: string): boolean {
  return msg().isShellUserRejected(result);
}

const GIT_READONLY_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "remote",
  "rev-parse",
]);

const VERSION_COMMANDS = new Set([
  "node",
  "npm",
  "npx",
  "python",
  "python3",
  "ruby",
  "go",
  "rustc",
  "cargo",
  "java",
  "git",
]);

export const DEFAULT_SHELL_WHITELIST = [
  "ls",
  "pwd",
  "cat",
  "head",
  "tail",
  "wc",
  "file",
  "stat",
  "tree",
  "grep",
  "rg",
  "find",
  "which",
  "type",
  "echo",
  "date",
  "uname",
  "df",
  "du",
  "env",
  "printenv",
  ...[...GIT_READONLY_SUBCOMMANDS].map((s) => `git ${s}`),
];

export type ToolContext = {
  onLine: (line: string) => void;
  confirm: (prompt: string) => Promise<boolean>;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => string | Promise<string>;

/** One-line summary persisted after tool execution. */
export function formatToolSummary(name: string, result: string): string {
  const m = msg();
  if (m.isError(result) || result === m.unknownTool) return result;

  const lineCount = result.split("\n").length;
  const pageCount = (result.match(/^\d+\. https?:\/\//gm) ?? []).length;

  switch (name) {
    case "get_time":
    case "calc":
      return result.length > 80 ? `${result.slice(0, 77)}…` : result;
    case "web_search":
      if (result === m.noSearchResults) return result;
      return pageCount
        ? m.summaryDoneResults(pageCount, lineCount)
        : m.summaryDone(lineCount);
    case "web_extract":
      if (result === m.noExtractedContent) return result;
      return pageCount
        ? m.summaryDoneUrls(pageCount, lineCount)
        : m.summaryDone(lineCount);
    case "web_crawl":
      return pageCount
        ? m.summaryDonePages(pageCount, lineCount)
        : m.summaryDone(lineCount);
    case "shell": {
      if (m.isError(result)) return result;
      const exitMatch = result.match(/exit code: (\d+)/);
      return exitMatch
        ? m.summaryDoneExit(exitMatch[1]!)
        : m.summaryDone(lineCount);
    }
    default:
      return lineCount > 1 ? m.summaryDone(lineCount) : result;
  }
}

async function tavilyCall<T>(
  client: TavilyClient | undefined,
  label: string,
  fn: () => Promise<T>,
): Promise<T | string> {
  const m = msg();
  if (!client) return m.tavilyNotConfigured(label);
  try {
    return await fn();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return m.tavilyFailed(label, detail);
  }
}

function formatContentResults(
  results: { url: string; rawContent: string }[],
  failed: { url: string; error: string }[] = [],
): string {
  const m = msg();
  const lines: string[] = [];
  for (const [i, r] of results.entries()) {
    lines.push(`${i + 1}. ${r.url}`, `   ${r.rawContent}`, "");
  }
  if (failed.length) {
    lines.push(m.failedUrls);
    for (const f of failed) {
      lines.push(`- ${f.url}${f.error ? `: ${f.error}` : ""}`);
    }
  }
  return lines.join("\n").trimEnd() || m.noExtractedContent;
}

function truncateOutput(text: string, limit = SHELL_OUTPUT_LIMIT): string {
  const m = msg();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n${m.outputTruncated(text.length)}`;
}

/** Split compound shell commands by ; | && || */
export function splitShellSegments(command: string): string[] {
  return command
    .split(/\s*(?:;|&&|\|\||\|)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Detect redirects, privilege escalation, find -exec, subshells, background. */
export function hasDangerousPattern(segment: string): boolean {
  const s = segment.trim();
  if (!s) return false;
  if (/(?<![&])>>|(?<![&])>(?!=)/.test(s)) return true;
  if (/\b(sudo|doas)\b/.test(s)) return true;
  if (/\$\(|`/.test(s)) return true;
  if (/&\s*$/.test(s)) return true;
  if (/\bfind\b/.test(s) && /\s-(execdir|exec|delete|okdir|ok)\b/.test(s))
    return true;
  return false;
}

export function hasDangerousPatternInCommand(command: string): boolean {
  return splitShellSegments(command).some(hasDangerousPattern);
}

function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment))) {
    tokens.push(m[1] ?? m[2] ?? m[3]!);
  }
  return tokens;
}

function skipEnvPrefix(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!))
    i++;
  return tokens.slice(i);
}

function isVersionOnly(tokens: string[]): boolean {
  if (tokens.length < 2) return false;
  return tokens.slice(1).every((t) => t === "--version" || t === "-v" || t === "-V");
}

function matchesWhitelist(tokens: string[], whitelist: string[]): boolean {
  if (!tokens.length) return false;
  if (isVersionOnly(tokens) && VERSION_COMMANDS.has(tokens[0]!)) return true;
  for (let len = tokens.length; len >= 1; len--) {
    const prefix = tokens.slice(0, len).join(" ");
    if (whitelist.includes(prefix)) return true;
  }
  return false;
}

function isSegmentWhitelisted(segment: string, whitelist: string[]): boolean {
  if (hasDangerousPattern(segment)) return false;
  const tokens = skipEnvPrefix(tokenizeSegment(segment.trim()));
  if (!tokens.length) return false;
  if (tokens[0] === "sudo" || tokens[0] === "doas") return false;
  return matchesWhitelist(tokens, whitelist);
}

export function isShellWhitelisted(
  command: string,
  extra: string[] = [],
): boolean {
  const whitelist = [...DEFAULT_SHELL_WHITELIST, ...extra];
  const segments = splitShellSegments(command);
  if (!segments.length) return false;
  return segments.every((seg) => isSegmentWhitelisted(seg, whitelist));
}

export function needsShellConfirm(
  command: string,
  extra: string[] = [],
): boolean {
  return !isShellWhitelisted(command, extra);
}

async function runShell(
  args: Record<string, unknown>,
  ctx: ToolContext,
  config: Config,
): Promise<string> {
  const m = msg();
  const command = String(args.command ?? "").trim();
  if (!command) return m.shellCommandEmpty;

  const cwd =
    typeof args.cwd === "string" && args.cwd.trim()
      ? args.cwd.trim()
      : process.cwd();
  const timeoutMs =
    typeof args.timeout_ms === "number"
      ? Math.max(1000, args.timeout_ms)
      : 120_000;

  const whitelist = config.shellWhitelist ?? [];
  const requireConfirm = config.shellRequireConfirm ?? true;
  if (requireConfirm && needsShellConfirm(command, whitelist)) {
    const reason = hasDangerousPatternInCommand(command)
      ? m.confirmDangerous
      : m.confirmNotWhitelisted;
    ctx.onLine(reason);
    const ok = await ctx.confirm(m.shellConfirmPrompt(command, cwd));
    if (!ok) return m.shellUserRejected;
  }

  ctx.onLine(m.shellExecuting(command));

  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      env: process.env,
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      stdoutChunks.push(text);
      const lines = text.split("\n").filter(Boolean);
      if (lines.length) ctx.onLine(lines.at(-1)!);
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderrChunks.push(data.toString());
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");

      if (killed) {
        const parts = [m.shellTimeout(timeoutMs)];
        if (stdout) parts.push(`stdout:\n${truncateOutput(stdout)}`);
        if (stderr) parts.push(`stderr:\n${truncateOutput(stderr)}`);
        resolve(parts.join("\n\n"));
        return;
      }

      const parts: string[] = [];
      if (stdout) parts.push(`stdout:\n${truncateOutput(stdout)}`);
      if (stderr) parts.push(`stderr:\n${truncateOutput(stderr)}`);
      parts.push(`exit code: ${code ?? "?"}`);
      resolve(parts.join("\n\n"));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(m.shellError(err.message));
    });
  });
}

async function webSearch(
  client: TavilyClient | undefined,
  searchTerm: string,
  ctx: ToolContext,
): Promise<string> {
  const m = msg();
  if (!searchTerm.trim()) return m.searchEmpty;

  ctx.onLine(m.searching(searchTerm));
  const data = await tavilyCall(client, m.tavilySearch, () =>
    client!.search(searchTerm, { maxResults: 5, searchDepth: "basic" }),
  );
  if (typeof data === "string") {
    ctx.onLine(data);
    return data;
  }

  const results = data.results ?? [];
  if (!results.length) {
    ctx.onLine(m.noSearchResults);
    return m.noSearchResults;
  }

  ctx.onLine(m.searchResults(results.length));

  const lines: string[] = [];
  if (data.answer) lines.push(m.searchSummary(data.answer), "");
  for (const [i, r] of results.entries()) {
    lines.push(
      `${i + 1}. ${r.title ?? m.noTitle}`,
      `   URL: ${r.url ?? ""}`,
      `   ${r.content ?? ""}`,
      "",
    );
  }
  return lines.join("\n").trimEnd();
}

function parseUrls(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter((u) => u.trim());
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

async function webExtract(
  client: TavilyClient | undefined,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const m = msg();
  const urls = parseUrls(args.urls);
  if (!urls.length) return m.urlsEmpty;
  if (urls.length > 20) return m.urlsTooMany;

  ctx.onLine(m.extracting(urls.length));
  const options: Parameters<TavilyClient["extract"]>[1] = {
    format: "markdown",
  };
  const query = String(args.query ?? "").trim();
  if (query) options.query = query;
  if (args.extract_depth === "basic" || args.extract_depth === "advanced") {
    options.extractDepth = args.extract_depth;
  }
  if (typeof args.chunks_per_source === "number") {
    options.chunksPerSource = Math.min(5, Math.max(1, args.chunks_per_source));
  }
  if (options.extractDepth === "advanced") options.timeout = 60;
  else options.timeout = 30;

  const data = await tavilyCall(client, m.tavilyExtract, () =>
    client!.extract(urls, options),
  );
  if (typeof data === "string") {
    ctx.onLine(data);
    return data;
  }
  ctx.onLine(m.extractDone(data.results.length));
  return formatContentResults(data.results, data.failedResults);
}

async function webCrawl(
  client: TavilyClient | undefined,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const m = msg();
  const url = String(args.url ?? "").trim();
  if (!url) return m.urlEmpty;

  ctx.onLine(m.crawling(url));
  const options: Parameters<TavilyClient["crawl"]>[1] = {
    format: "markdown",
    maxDepth:
      typeof args.max_depth === "number"
        ? Math.min(5, Math.max(1, args.max_depth))
        : 1,
    limit: typeof args.limit === "number" ? Math.max(1, args.limit) : 10,
    timeout: 150,
  };
  const instructions = String(args.instructions ?? "").trim();
  if (instructions) options.instructions = instructions;
  if (args.extract_depth === "basic" || args.extract_depth === "advanced") {
    options.extractDepth = args.extract_depth;
  }
  if (typeof args.chunks_per_source === "number") {
    options.chunksPerSource = Math.min(5, Math.max(1, args.chunks_per_source));
  }
  if (Array.isArray(args.select_paths) && args.select_paths.length) {
    options.selectPaths = args.select_paths.map(String);
  }
  if (Array.isArray(args.exclude_paths) && args.exclude_paths.length) {
    options.excludePaths = args.exclude_paths.map(String);
  }

  const data = await tavilyCall(client, m.tavilyCrawl, () =>
    client!.crawl(url, options),
  );
  if (typeof data === "string") {
    ctx.onLine(data);
    return data;
  }

  ctx.onLine(m.crawlDone(data.results.length));
  const lines: string[] = [];
  if (data.baseUrl) lines.push(m.crawlBaseUrl(data.baseUrl), "");
  lines.push(formatContentResults(data.results));
  return lines.join("\n").trimEnd();
}

export function createHandlers(config: Config): Record<string, ToolHandler> {
  const tvly = config.tavilyApiKey
    ? tavily({ apiKey: config.tavilyApiKey })
    : undefined;
  return {
    shell: (args, ctx) => runShell(args, ctx, config),
    get_time: (_args, ctx) => {
      ctx.onLine(msg().gettingTime);
      return new Date().toISOString();
    },
    calc: ({ expr }, ctx) => {
      const m = msg();
      ctx.onLine(m.calculating(String(expr)));
      if (!/^[\d\s+\-*/().]+$/.test(String(expr))) return m.calcInvalidChars;
      try {
        return String(Function(`"use strict";return(${expr})`)());
      } catch {
        return m.calcFailed;
      }
    },
    web_search: ({ search_term }, ctx) =>
      webSearch(tvly, String(search_term ?? ""), ctx),
    web_extract: (args, ctx) => webExtract(tvly, args, ctx),
    web_crawl: (args, ctx) => webCrawl(tvly, args, ctx),
  };
}
