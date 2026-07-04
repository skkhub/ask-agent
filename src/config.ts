import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  type Locale,
  normalizeLocale,
  messagesFor,
  setLocale,
} from "./i18n.ts";

export type ProviderKind = "openai" | "anthropic";

export interface Profile {
  provider: ProviderKind;
  baseURL: string;
  apiKey: string;
  model: string;
  description: string; // 供路由器判断用途
  maxTokens?: number;
  thinkingBudget?: { low: number; high: number }; // 仅 anthropic：思考深度(budget_tokens)
}

export interface Config {
  language?: Locale;
  router: string; // 用于分类路由的档案名（通常选便宜/快的）
  profiles: Record<string, Profile>;
  tavilyApiKey?: string; // Tavily API（web_search / web_extract / web_crawl）
  stream: boolean; // 是否流式输出（默认 false）：true=纯文本流式；false=结束后 markdown 美化
  shellRequireConfirm?: boolean; // shell 非白名单/危险命令是否须确认（默认 true）
  shellWhitelist?: string[]; // 追加到内置只读白名单的命令前缀
  maxTurns?: number; // 单次任务最大模型调用轮数（默认 30），防止无限循环
}

function expandEnv(value: string): string {
  const m = messagesFor(getLocaleFromPartial());
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => {
    const v = process.env[name];
    if (v === undefined) throw new Error(m.envVarMissing(name));
    return v;
  });
}

function expandEnvOptional(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const missing: string[] = [];
  const expanded = value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => {
    const v = process.env[name];
    if (v === undefined) {
      missing.push(name);
      return "";
    }
    return v;
  });
  return missing.length ? undefined : expanded;
}

/** Locale set during partial config parse; falls back to English. */
let partialLocale: Locale = "English";

function getLocaleFromPartial(): Locale {
  return partialLocale;
}

async function readConfigFile(customPath?: string): Promise<{ path: string; text: string }> {
  const path = customPath
    ? resolve(process.cwd(), customPath)
    : await resolveDefaultConfigPath();
  const text = await readFile(path, "utf8");
  return { path, text };
}

/** User-level data directory: ~/.ask */
export function askHome(): string {
  return resolve(homedir(), ".ask");
}

export function defaultConfigPath(): string {
  return resolve(askHome(), "config.json");
}

async function resolveDefaultConfigPath(): Promise<string> {
  const path = defaultConfigPath();
  try {
    await access(path);
  } catch {
    const m = messagesFor("English");
    throw new Error(m.configNotFound);
  }
  return path;
}

/** Read language from config without full validation; defaults to English. */
export async function peekLocale(customPath?: string): Promise<Locale> {
  try {
    const path = customPath
      ? resolve(process.cwd(), customPath)
      : defaultConfigPath();
    await access(path);
    const raw = JSON.parse(await readFile(path, "utf8")) as { language?: string };
    return normalizeLocale(raw.language);
  } catch {
    return "English";
  }
}

export async function loadConfig(customPath?: string): Promise<Config> {
  let path: string;
  let text: string;
  try {
    ({ path, text } = await readConfigFile(customPath));
  } catch (err) {
    if (err instanceof Error && err.message.includes("config.json")) throw err;
    throw new Error(messagesFor("English").configNotFound);
  }

  let raw: Config;
  try {
    raw = JSON.parse(text) as Config;
  } catch (err) {
    partialLocale = "English";
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(messagesFor("English").configReadFailed(path, msg));
  }

  partialLocale = normalizeLocale(raw.language);
  setLocale(partialLocale);
  const m = messagesFor(partialLocale);

  for (const profile of Object.values(raw.profiles ?? {})) {
    profile.apiKey = expandEnv(profile.apiKey);
    profile.baseURL = expandEnv(profile.baseURL);
  }
  if (raw.tavilyApiKey) {
    raw.tavilyApiKey = expandEnvOptional(raw.tavilyApiKey);
  }
  if (!raw.profiles?.[raw.router]) {
    throw new Error(m.routerNotInProfiles(raw.router));
  }
  raw.language = partialLocale;
  raw.stream = raw.stream ?? false;
  raw.shellRequireConfirm = raw.shellRequireConfirm ?? true;
  return raw;
}
