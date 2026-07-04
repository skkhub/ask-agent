import chalk from "chalk";
import type { Provider, UMessage, Effort } from "./providers.ts";
import {
  getTools,
  formatToolSummary,
  type ToolHandler,
  type ToolContext,
} from "./tools.ts";
import { msg } from "./i18n.ts";
import { renderMd } from "./render.ts";
import * as ui from "./ui.ts";

export type AgentMode = "interactive" | "oneshot";

export interface RunOptions {
  provider: Provider;
  messages: UMessage[]; // 会话历史，原地追加
  effort: Effort;
  handlers: Record<string, ToolHandler>;
  mode: AgentMode;
  stream: boolean; // 仅交互模式生效：逐字流式输出正文
  maxTurns: number; // 最大模型调用轮数，防止无限循环
  confirm: (prompt: string) => Promise<boolean>;
}

// ===== agent 循环：模型 -> 工具 -> 模型，直到没有工具调用 =====
export async function runAgent(o: RunOptions): Promise<string> {
  const { provider, messages, effort, handlers, mode, confirm } = o;
  const m = msg();
  const streaming = o.stream && mode === "interactive";
  const header = chalk.magenta.bold(`${m.assistantHeader}\n`);
  const spinner = ui.spinner(m.thinking);
  const failedCalls = new Set<string>();
  let toolChoice: "auto" | "none" = "auto";
  let forcedTurns = 0;

  try {
    for (let turn = 1; ; turn++) {
      if (turn > o.maxTurns && toolChoice === "auto") {
        toolChoice = "none";
        messages.push({
          role: "user",
          content: m.maxTurnsSystem(o.maxTurns),
        });
        ui.traceLine(ui.c.yellow(m.maxTurnsWarning(o.maxTurns)));
      }

      spinner.start(
        ui.c.dim(turn > 1 ? m.thinkingTurn(turn) : m.thinking),
      );
      let started = false;
      const res = await provider.chat(messages, getTools(), effort, {
        toolChoice,
        onToken: streaming
          ? (delta) => {
              if (spinner.isSpinning) spinner.stop();
              if (!started) {
                started = true;
                process.stdout.write(header);
              }
              const text = delta.replace(/\r/g, "");
              if (text) process.stdout.write(text);
            }
          : undefined,
      });
      spinner.stop();
      messages.push({
        role: "assistant",
        content: res.content,
        toolCalls: res.toolCalls,
        raw: res.raw,
      });

      let isFinal = !res.toolCalls.length;

      if (!isFinal && toolChoice === "none") {
        for (const call of res.toolCalls) {
          ui.traceLine(
            ui.c.gray(`  ⚙ ${call.name}(…) → ${m.toolNotExecuted}`),
          );
          messages.push({
            role: "tool",
            content: m.toolCallsForbidden,
            toolCallId: call.id,
          });
        }
        if (++forcedTurns >= 2) {
          ui.traceLine(ui.c.yellow(m.forceEnd));
          isFinal = true;
        }
      }

      if (streaming) {
        if (started) process.stdout.write("\n");
      } else if (res.content) {
        if (mode === "interactive") {
          process.stdout.write(`${header}${renderMd(res.content)}\n`);
        } else if (isFinal) {
          ui.answer(res.content);
        } else {
          ui.traceLine(
            ui.c.dim(res.content.split("\n").map((l) => `  ┆ ${l}`).join("\n")),
          );
        }
      }

      if (isFinal) {
        if (mode === "interactive") process.stdout.write("\n");
        return res.content ?? "";
      }
      if (toolChoice === "none") continue;

      let rejected = false;
      for (const call of res.toolCalls) {
        if (rejected) {
          ui.traceLine(
            ui.c.gray(`  ⚙ ${call.name}(…) → ${m.toolSkippedRejected}`),
          );
          messages.push({
            role: "tool",
            content: m.toolSkippedShellRejected,
            toolCallId: call.id,
          });
          continue;
        }

        const argsStr = call.args || "{}";
        const displayArgs =
          argsStr.length > 80 ? `${argsStr.slice(0, 77)}…` : argsStr;
        ui.trace(ui.c.gray(`  ⚙ ${call.name}(${displayArgs})`));

        let hadProgress = false;
        const ctx: ToolContext = {
          onLine: (line) => {
            if (!hadProgress) {
              ui.trace("\n");
              hadProgress = true;
            }
            ui.traceLine(ui.c.dim(`    ${line}`));
          },
          confirm,
        };

        const raw = await execCall(call.name, argsStr, handlers, ctx);
        const result = withRepeatHint(failedCalls, call.name, argsStr, raw);

        const summary = formatToolSummary(call.name, result).split("\n").join(" ");
        if (hadProgress) {
          ui.traceLine(ui.c.gray(`  → ${summary}`));
        } else {
          ui.trace(ui.c.gray(` → ${summary}\n`));
        }

        messages.push({ role: "tool", content: result, toolCallId: call.id });
        if (call.name === "shell" && m.isShellUserRejected(result)) {
          rejected = true;
        }
      }

      if (rejected) toolChoice = "none";
    }
  } finally {
    spinner.stop();
  }
}

async function execCall(
  name: string,
  argsStr: string,
  handlers: Record<string, ToolHandler>,
  ctx: ToolContext,
): Promise<string> {
  const m = msg();
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsStr || "{}");
  } catch {
    return m.invalidToolArgs;
  }
  const handler = handlers[name];
  if (!handler) return m.unknownToolError(name);
  try {
    return await handler(args, ctx);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return m.toolExecError(detail);
  }
}

function withRepeatHint(
  failed: Set<string>,
  name: string,
  argsStr: string,
  result: string,
): string {
  const m = msg();
  const key = `${name}\0${argsStr}`;
  if (!m.isError(result)) {
    failed.delete(key);
    return result;
  }
  const repeated = failed.has(key);
  failed.add(key);
  return repeated ? `${result}\n${m.repeatHint}` : result;
}
