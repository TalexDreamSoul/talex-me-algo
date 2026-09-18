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

/** 从 stdin 读一行（用于交互确认） */
export async function prompt(question) {
  process.stdout.write(question);
  for await (const line of readLines()) return line.trim();
  return '';
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
