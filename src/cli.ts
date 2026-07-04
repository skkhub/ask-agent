#!/usr/bin/env node
// ===== CLI 入口：参数解析 + 模式分发 =====
import * as readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { createReadStream, fstatSync } from "node:fs";
import { resolve } from "node:path";
import { askHome, loadConfig, peekLocale, type Config } from "./config.ts";
import {
  createProvider,
  type Provider,
  type UMessage,
  type Effort,
} from "./providers.ts";
import { route } from "./router.ts";
import { runAgent } from "./agent.ts";
import { createHandlers, type ToolHandler } from "./tools.ts";
import { msg, setLocale } from "./i18n.ts";
import { cmdUpdate, cmdUninstall } from "./setup.ts";
import * as ui from "./ui.ts";

declare const __APP_VERSION__: string | undefined;

const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

const EFFORTS = ["off", "low", "high"] as const;
const STDIN_LIMIT = 400_000;
const ROUTE_SAMPLE = 2_000;

interface Shared {
  config: Config;
  providers: Record<string, Provider>;
  handlers: Record<string, ToolHandler>;
  maxTurns: number;
  profileFlag?: string;
  effortFlag?: Effort;
}

function fail(message: string): never {
  ui.error(ui.c.red(message));
  process.exit(1);
}

function stdinIsPiped(): boolean {
  if (process.stdin.isTTY) return false;
  try {
    const st = fstatSync(0);
    return st.isFIFO() || st.isFile();
  } catch {
    return false;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
    bytes += (chunk as Buffer).length;
    if (bytes > STDIN_LIMIT * 4) break;
  }
  let text = Buffer.concat(chunks).toString("utf8");
  if (text.length > STDIN_LIMIT) {
    text = `${text.slice(0, STDIN_LIMIT)}\n${msg().stdinTruncated(text.length)}`;
  }
  return text;
}

const isYes = (a: string) => /^y(es)?$/i.test(a.trim());

function questionViaTty(q: string): Promise<string | null> {
  return new Promise((done) => {
    let settled = false;
    const finish = (v: string | null) => {
      if (!settled) {
        settled = true;
        done(v);
      }
    };
    try {
      const input = createReadStream("/dev/tty");
      input.on("error", () => finish(null));
      const rl = readline.createInterface({ input, output: process.stderr });
      rl.on("error", () => finish(null));
      rl.question(q)
        .then((a) => {
          rl.close();
          input.destroy();
          finish(a);
        })
        .catch(() => finish(null));
    } catch {
      finish(null);
    }
  });
}

async function oneshotConfirm(promptText: string): Promise<boolean> {
  const q = ui.c.yellow(`${promptText} [y/N] `);
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return isYes(await rl.question(q));
    } finally {
      rl.close();
    }
  }
  const answer = await questionViaTty(q);
  if (answer !== null) return isYes(answer);
  ui.error(ui.c.yellow(msg().confirmDenied));
  return false;
}

async function selectModel(
  text: string,
  s: Shared,
): Promise<{ pick: string; effort: Effort }> {
  const names = Object.keys(s.config.profiles);
  let pick = s.profileFlag ?? (names.length === 1 ? names[0]! : undefined);
  let effort = s.effortFlag;

  if (!pick) {
    const spin = ui.spinner(msg().routing).start();
    try {
      const d = await route(
        text.slice(0, ROUTE_SAMPLE),
        s.config,
        s.providers[s.config.router]!,
      );
      pick = d.profile;
      effort ??= d.effort;
    } finally {
      spin.stop();
    }
  }
  effort ??= "off";
  ui.traceLine(
    ui.c.dim(
      msg().modelSelected(pick, s.providers[pick]!.model, effort),
    ),
  );
  return { pick, effort };
}

async function oneshot(prompt: string, s: Shared): Promise<void> {
  const { pick, effort } = await selectModel(prompt, s);
  const messages: UMessage[] = [
    { role: "system", content: msg().systemPrompt("oneshot") },
    { role: "user", content: prompt },
  ];
  await runAgent({
    provider: s.providers[pick]!,
    messages,
    effort,
    handlers: s.handlers,
    mode: "oneshot",
    stream: false,
    maxTurns: s.maxTurns,
    confirm: oneshotConfirm,
  });
}

async function repl(s: Shared): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  const messages: UMessage[] = [
    { role: "system", content: msg().systemPrompt("interactive") },
  ];
  const confirm = async (promptText: string): Promise<boolean> => {
    rl.resume();
    const answer = await rl.question(ui.c.yellow(`${promptText} [y/N] `));
    rl.pause();
    return isYes(answer);
  };

  const profileList = Object.keys(s.config.profiles).join(" / ");
  ui.traceLine(
    ui.c.bold.cyan(`\n  ${msg().replTitle}  `) +
      ui.c.dim(msg().replBanner(profileList)),
  );

  while (true) {
    const q = (await rl.question(ui.c.green.bold(msg().replPrompt))).trim();
    if (!q) continue;
    if (["exit", "quit", "/exit"].includes(q.toLowerCase())) break;

    const checkpoint = messages.length;
    try {
      const { pick, effort } = await selectModel(q, s);
      messages.push({ role: "user", content: q });
      rl.pause();
      try {
        await runAgent({
          provider: s.providers[pick]!,
          messages,
          effort,
          handlers: s.handlers,
          mode: "interactive",
          stream: s.config.stream,
          maxTurns: s.maxTurns,
          confirm,
        });
      } finally {
        rl.resume();
      }
    } catch (err) {
      messages.length = checkpoint;
      const detail = err instanceof Error ? err.message : String(err);
      ui.error(ui.c.red(msg().replError(detail)));
    }
  }
  rl.close();
}

function loadEnvFiles(): void {
  try {
    process.loadEnvFile(resolve(askHome(), ".env"));
  } catch {
    // no .env — skip
  }
}

async function main(): Promise<void> {
  loadEnvFiles();

  const { values: flags, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: "string", short: "p" },
      effort: { type: "string", short: "e" },
      quiet: { type: "boolean", short: "q" },
      yes: { type: "boolean", short: "y" },
      "max-turns": { type: "string" },
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "V" },
    },
  });

  setLocale(await peekLocale(flags.config));

  const [sub, ...subRest] = positionals;
  if (sub === "update" || sub === "uninstall") {
    if (flags.help) {
      process.stdout.write(sub === "update" ? msg().helpUpdate : msg().helpUninstall);
      return;
    }
    const subParsed = parseArgs({
      args: subRest,
      allowPositionals: true,
      options: {
        version: { type: "string" },
        yes: { type: "boolean", short: "y" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (subParsed.values.help) {
      process.stdout.write(sub === "update" ? msg().helpUpdate : msg().helpUninstall);
      return;
    }
    const setupOpts = {
      yes: subParsed.values.yes === true || flags.yes === true,
      version: subParsed.values.version,
      currentVersion: APP_VERSION,
      confirm: oneshotConfirm,
    };
    if (sub === "update") {
      await cmdUpdate(setupOpts);
    } else {
      await cmdUninstall(setupOpts);
    }
    return;
  }

  if (flags.help) {
    process.stdout.write(msg().help);
    return;
  }
  if (flags.version) {
    process.stdout.write(`${APP_VERSION}\n`);
    return;
  }

  ui.setQuiet(flags.quiet === true);

  const effortRaw = flags.effort;
  if (
    effortRaw !== undefined &&
    !(EFFORTS as readonly string[]).includes(effortRaw)
  ) {
    fail(msg().effortInvalid(EFFORTS.join(" / "), effortRaw));
  }
  const effortFlag = effortRaw as Effort | undefined;

  const config = await loadConfig(flags.config);
  setLocale(config.language!);
  if (flags.yes) config.shellRequireConfirm = false;

  const profileFlag = flags.profile;
  if (profileFlag && !config.profiles[profileFlag]) {
    fail(
      msg().profileNotFound(
        profileFlag,
        Object.keys(config.profiles).join(" / "),
      ),
    );
  }

  let maxTurns = config.maxTurns ?? 30;
  if (flags["max-turns"] !== undefined) {
    maxTurns = Number.parseInt(flags["max-turns"], 10);
    if (!Number.isInteger(maxTurns) || maxTurns < 1) {
      fail(msg().maxTurnsInvalid(flags["max-turns"]));
    }
  }

  const providers: Record<string, Provider> = {};
  for (const [name, profile] of Object.entries(config.profiles)) {
    providers[name] = createProvider(profile);
  }
  const handlers = createHandlers(config);

  let prompt = positionals.join(" ").trim();
  if (stdinIsPiped()) {
    const stdinText = (await readStdin()).trim();
    if (stdinText) {
      prompt = prompt
        ? `${prompt}\n\n${msg().stdinPipePrefix}\n${stdinText}`
        : stdinText;
    }
  }

  const shared: Shared = {
    config,
    providers,
    handlers,
    maxTurns,
    profileFlag,
    effortFlag,
  };
  if (prompt) {
    await oneshot(prompt, shared);
  } else if (process.stdin.isTTY) {
    await repl(shared);
  } else {
    fail(msg().noTask);
  }
}

main().catch((err) => {
  ui.error(ui.c.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
