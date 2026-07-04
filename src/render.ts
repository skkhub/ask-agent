// ===== markdown 渲染 =====
// 仅负责把 markdown 文本渲染成终端字符串（含表格自适应）。
// 流式输出为纯文本、不经过这里；非流式输出在整轮结束后调用 renderMd 美化。
import stringWidth from "string-width";
import chalk from "chalk";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

const termWidth = () => process.stdout.columns || 80;

/**
 * 估算一张表用原生边框渲染后的自然宽度（内容 + 每列左右各 1 空格 + 竖线）。
 * 中文按 2 列计（string-width）。
 */
function naturalTableWidth(header: any[], rows: any[][]): number {
  const ncol = header.length;
  if (!ncol) return 0;
  const colW = header.map((h, j) => {
    let w = stringWidth(h?.text ?? "");
    for (const r of rows) w = Math.max(w, stringWidth(r[j]?.text ?? ""));
    return w;
  });
  return colW.reduce((s, w) => s + w + 2, 0) + (ncol + 1); // padding + 边框竖线
}

/** 把一行取到的内联内容渲染成终端字符串（保留加粗等样式），失败则退回纯文本。 */
function inline(parser: any, cell: any): string {
  try {
    return String(parser.parseInline(cell.tokens)).trim();
  } catch {
    return String(cell?.text ?? "").trim();
  }
}

/**
 * 宽表转竖排：每条数据行渲染成一组「列名：值」，各占一行，记录之间空一行。
 * 无论终端多窄都可读、不会被边框折断成乱码。
 */
function renderTableVertical(parser: any, header: any[], rows: any[][]): string {
  const labels = header.map((h) => String(h?.text ?? ""));
  const blocks = rows.map((row) =>
    labels
      .map((label, j) => `${chalk.cyan(label)}：${inline(parser, row[j] ?? {})}`)
      .join("\n"),
  );
  return "\n" + blocks.join("\n\n") + "\n";
}

// marked-terminal 提供默认渲染，再覆写 table：宽表转竖排，窄表沿用原生表格。
const termExt: any = markedTerminal();
const origTable = termExt.renderer.table;
termExt.renderer.table = function (token: any) {
  const header: any[] = token.header ?? [];
  const rows: any[][] = token.rows ?? [];
  if (header.length && naturalTableWidth(header, rows) > termWidth()) {
    return renderTableVertical(this.parser, header, rows);
  }
  return origTable.call(this, token);
};
marked.use(termExt);

/** 把 markdown 渲染成终端字符串（去掉尾部多余空行）。 */
export const renderMd = (text: string): string =>
  (marked.parse(text) as string).trimEnd();
