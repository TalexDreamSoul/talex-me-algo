import fs from 'node:fs';

/** 终端输出的一点点糖，不引第三方依赖 */

const isTTY = process.stdout.isTTY;
const wrap = (code) => (s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  gray: wrap('90'),
};

export const DIFF_COLOR = {
  Easy: c.green,
  Medium: c.yellow,
  Hard: c.red,
};

/** 截断长 JSON，避免刷屏 */
export function preview(value, max = 160) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (s === undefined) return 'undefined';
  return s.length > max ? `${s.slice(0, max)}… (共 ${s.length} 字符)` : s;
}

/**
 * 从 stdin 读一行（用于交互确认）。
 *
 * 没有可读的 stdin 时必须立刻报错，不能干等——被 VSCode task、CI、
 * 或任何没接终端的环境调起来时，光标停在问号后面不动，看着像卡死。
 */
export async function prompt(question) {
  if (!process.stdin.isTTY && !hasPipedStdin()) {
    throw new Error(
      `这里读不到键盘输入（stdin 不是终端）。把值直接写在命令里，例如 --rating 4。`,
    );
  }
  process.stdout.write(question);
  for await (const line of readLines()) return line.trim();
  return '';
}

/** stdin 被重定向（管道/文件）时仍然可读，只有既非 TTY 又无重定向才是真读不到 */
function hasPipedStdin() {
  try {
    return fs.fstatSync(0).isFIFO() || fs.fstatSync(0).isFile();
  } catch {
    return false;
  }
}

/**
 * 读一个 0-5 的自评。
 *
 * 单独抽出来是因为 Number('') === 0——直接回车会被静默当成「自评 0 分」，
 * 而 0 分会把复习间隔打回 1 天。自评是 SRS 的唯一输入，不能猜。
 */
export async function promptRating(question, preset) {
  const raw = preset ?? (await prompt(question));
  if (String(raw).trim() === '') throw new Error('得给个 0-5 的自评，不能空着');
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error('自评必须是 0-5 的整数');
  return n;
}

async function* readLines() {
  let buf = '';
  for await (const chunk of process.stdin) {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, i);
      buf = buf.slice(i + 1);
    }
  }
  if (buf) yield buf;
}

export function table(rows, headers) {
  if (!rows.length) return '';
  const cols = headers.map((h) => h.key);
  const widths = headers.map((h, i) =>
    Math.max(displayWidth(h.label), ...rows.map((r) => displayWidth(String(r[cols[i]] ?? '')))),
  );
  const line = (cells) =>
    cells.map((cell, i) => pad(String(cell ?? ''), widths[i])).join('  ');
  const out = [c.bold(line(headers.map((h) => h.label)))];
  out.push(c.gray(widths.map((w) => '─'.repeat(w)).join('  ')));
  for (const r of rows) out.push(line(cols.map((k) => r[k])));
  return out.join('\n');
}

/** 中文字符按 2 宽算，否则表格会错位 */
function displayWidth(s) {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of plain) w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
  return w;
}

function pad(s, w) {
  return s + ' '.repeat(Math.max(0, w - displayWidth(s)));
}
