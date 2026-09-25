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
  // 原来用 90（bright black），在浅色主题下会被映射成极浅的灰，几乎看不清；
  // 换成 256 色固定中灰（#767676），深浅背景都可读
  gray: wrap('38;5;243'),
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
 *
 * 不给 preset 时走单键倒计时：按 0-5 立刻生效，不用回车；
 * 干等超时就用 fallback，避免提交流程停在这儿不动。
 */
export async function promptRating(question, preset, opts = {}) {
  if (preset !== undefined) {
    if (String(preset).trim() === '') throw new Error('得给个 0-5 的自评，不能空着');
    const n = Number(preset);
    if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error('自评必须是 0-5 的整数');
    return n;
  }
  // 超时默认取最低分：沉默意味着「人不在」，不是「秒杀了」。
  // 记 0 只是让这题明天再出现一次，代价最小；记高分会让它消失几十天。
  const fallback = opts.fallback ?? 0;
  const timeoutMs = opts.timeoutMs ?? 15000;

  if (!process.stdin.isTTY) {
    // 没终端就别装作在问：管道/文件里读一行，真没有就用默认值
    if (hasPipedStdin()) {
      const line = (await prompt(question)).trim();
      if (line === '') throw new Error('得给个 0-5 的自评，不能空着');
      const n = Number(line);
      if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error('自评必须是 0-5 的整数');
      return n;
    }
    console.log(c.yellow(`  读不到键盘输入，自评按 ${fallback} 记。要准确就加 --rating。`));
    return fallback;
  }

  const picked = await readKeyWithCountdown(question, {
    valid: '012345',
    timeoutMs,
    fallback: String(fallback),
  });
  return Number(picked);
}

/**
 * 单键选择 + 倒计时。按下有效键立刻返回；任意键都会取消倒计时，
 * 免得你正在想的时候被超时抢答。
 */
async function readKeyWithCountdown(question, { valid, timeoutMs, fallback }) {
  const stdin = process.stdin;
  const deadline = Date.now() + timeoutMs;
  let counting = true;

  const render = () => {
    const left = Math.ceil((deadline - Date.now()) / 1000);
    const hint = counting ? c.gray(`(${left}s 后按 ${fallback} 记) `) : '';
    process.stdout.write(`\r\x1b[2K${question}${hint}`);
  };

  render();
  const ticker = setInterval(render, 250);

  stdin.setRawMode(true);
  stdin.resume();

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!counting) return;
        finish(fallback, c.gray(`${fallback}（超时默认）`));
      }, timeoutMs);

      const onData = (buf) => {
        const ch = buf.toString();
        if (ch === '\u0003') {
          cleanup();
          reject(new Error('已取消'));
          return;
        }
        // 开始打字就别再倒计时了，想多久想多久
        if (counting) {
          counting = false;
          clearTimeout(timer);
          render();
        }
        if (valid.includes(ch)) finish(ch, ch);
      };

      function finish(value, echo) {
        cleanup();
        process.stdout.write(`\r\x1b[2K${question}${echo}\n`);
        resolve(value);
      }

      function cleanup() {
        clearTimeout(timer);
        clearInterval(ticker);
        stdin.off('data', onData);
      }

      stdin.on('data', onData);
    });
  } finally {
    clearInterval(ticker);
    stdin.setRawMode(false);
    stdin.pause();
  }
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
