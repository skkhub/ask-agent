// ===== 输出通道约定 =====
// 过程信息（路由、工具调用轨迹、进度、警告）→ stderr；
// 最终结果 → stdout。
// 这样 `ask "任务" | jq` 之类的管道只会接到干净的结果，
// 而终端上依然能实时看到 stderr 里的调用过程。
import { chalkStderr } from "chalk";
import ora, { type Ora } from "ora";
import { renderMd } from "./render.ts";

/** stderr 专用 chalk 实例（按 stderr 是否为 TTY 决定是否着色） */
export const c = chalkStderr;

export const outIsTTY = process.stdout.isTTY === true;
export const errIsTTY = process.stderr.isTTY === true;

let quiet = false;
export function setQuiet(v: boolean): void {
  quiet = v;
}

/** 过程日志（不换行），--quiet 时静默 */
export function trace(text: string): void {
  if (!quiet) process.stderr.write(text);
}

/** 过程日志（带换行），--quiet 时静默 */
export function traceLine(text: string): void {
  trace(`${text}\n`);
}

/** 错误提示：无视 --quiet，始终写 stderr */
export function error(text: string): void {
  process.stderr.write(`${text}\n`);
}

/** 加载动画：走 stderr；非 TTY 或 --quiet 时完全静默 */
export function spinner(text: string): Ora {
  return ora({
    text: c.dim(text),
    color: "cyan",
    stream: process.stderr,
    isSilent: quiet || !errIsTTY,
  });
}

/** 最终回答 → stdout：TTY 下 markdown 美化，管道下输出原文 */
export function answer(text: string): void {
  const body = outIsTTY ? renderMd(text) : text.trimEnd();
  process.stdout.write(`${body}\n`);
}
