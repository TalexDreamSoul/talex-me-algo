/**
 * 从题面「提示」段落解析数据范围，供自测生成器用。
 *
 * 为什么要解析而不是让人手填：生成的边界/随机输入必须落在题目合法范围内，
 * 否则跑出来的失败是假失败（比如给只接受正数的题喂负数）。
 * 解析不出来就返回 null，生成器退化成保守默认值，绝不瞎编范围。
 */

/**
 * @typedef {object} Bound
 * @property {number} [min]
 * @property {number} [max]
 */

/**
 * @typedef {object} Constraints
 * @property {Record<string, Bound>} len   变量名 -> 长度范围（nums.length / s.length / 节点数）
 * @property {Record<string, Bound>} val   变量名 -> 元素取值范围（nums[i] / Node.val）
 * @property {Record<string, Bound>} scalar 变量名 -> 标量参数自身范围（target / k）
 * @property {string[]} flags              结构性约束：sorted / distinct / lowercase 等
 * @property {string[]} raw                原始提示行，人工核对用
 */

/** `3 * 10^4` / `2^31 - 1` / `-10^9` 这类写法求值 */
function evalNumeric(text) {
  const s = String(text)
    .replace(/\s+/g, '')
    .replace(/[，,]/g, '')
    .replace(/×/g, '*');

  // 先处理 a^b，再处理可选的 c * 前缀和 ± d 后缀
  const m = s.match(/^(-?)(?:(\d+)\*)?(\d+)\^(\d+)(?:([+-])(\d+))?$/);
  if (m) {
    const [, sign, mul, base, exp, op, delta] = m;
    let v = Number(base) ** Number(exp);
    if (mul) v *= Number(mul);
    if (op) v = op === '+' ? v + Number(delta) : v - Number(delta);
    return sign === '-' ? -v : v;
  }
  const plain = s.match(/^-?\d+$/);
  if (plain) return Number(s);
  return null;
}

/** 把 `nums.length` / `nums[i]` / `Node.val` 归一成 {name, kind} */
function classifyTerm(term) {
  const t = term.trim();
  let m = t.match(/^([A-Za-z_$][\w$]*)\.length$/);
  if (m) return { name: m[1], kind: 'len' };
  m = t.match(/^([A-Za-z_$][\w$]*)\.size\(\)$/);
  if (m) return { name: m[1], kind: 'len' };
  m = t.match(/^([A-Za-z_$][\w$]*)\[[^\]]*\](?:\[[^\]]*\])?$/);
  if (m) return { name: m[1], kind: 'val' };
  m = t.match(/^Node\.val$/);
  if (m) return { name: '__node', kind: 'val' };
  m = t.match(/^([A-Za-z_$][\w$]*)$/);
  if (m) return { name: m[1], kind: 'scalar' };
  return null;
}

const FLAG_PATTERNS = [
  [/非递减|非严格递增|升序|已按.{0,6}顺序排列|已排序|sorted/i, 'sorted'],
  [/互不相同|均不相同|各不相同|distinct|唯一/i, 'distinct'],
  [/小写英文字母|lowercase/i, 'lowercase'],
  [/英文字母|letters/i, 'letters'],
  [/二进制|只包含 ?0 ?和 ?1|'0' 和 '1'/i, 'binary'],
  [/非负|不含负数/i, 'nonnegative'],
];

/**
 * @param {string} statement 题面纯文本
 * @returns {Constraints|null}
 */
export function parseConstraints(statement) {
  if (!statement) return null;
  const hintStart = statement.search(/提示\s*[:：]|Constraints\s*:/);
  if (hintStart === -1) return null;

  // 提示段到下一个大标题（进阶/示例）为止
  const tail = statement.slice(hintStart);
  const stop = tail.search(/\n\s*(?:进阶|Follow\s*up|示例)/);
  const block = stop === -1 ? tail : tail.slice(0, stop);

  const lines = block
    .split('\n')
    .map((l) => l.replace(/^[\s\t]*[-•*]\s*/, '').trim())
    .filter((l) => l && !/^(?:提示|Constraints)\s*[:：]?$/.test(l));

  /** @type {Constraints} */
  const out = { len: {}, val: {}, scalar: {}, flags: [], raw: lines };

  for (const line of lines) {
    for (const [re, flag] of FLAG_PATTERNS) {
      if (re.test(line) && !out.flags.includes(flag)) out.flags.push(flag);
    }

    // `1 <= nums.length <= 10^4`（双边）
    let m = line.match(/^(.+?)\s*<=\s*(.+?)\s*<=\s*(.+?)\s*$/);
    if (m) {
      const lo = evalNumeric(m[1]);
      const hi = evalNumeric(m[3]);
      const term = classifyTerm(m[2]);
      if (term && lo !== null && hi !== null) {
        out[term.kind][term.name] = { min: lo, max: hi };
      }
      continue;
    }

    // `nums.length <= 100` / `k >= 1`（单边）
    m = line.match(/^(.+?)\s*(<=|>=|<|>)\s*(.+?)\s*$/);
    if (m) {
      const term = classifyTerm(m[1]);
      const v = evalNumeric(m[3]);
      if (term && v !== null) {
        const slot = (out[term.kind][term.name] ??= {});
        if (m[2].startsWith('<')) slot.max = v;
        else slot.min = v;
      }
      continue;
    }

    // `树中节点的数量在 [0, 10^4] 区间内` / `节点数目在范围 [0, 100] 内`
    m = line.match(/节点\s*(?:的)?\s*(?:数量|数目|个数).*?\[\s*([^,\]]+?)\s*,\s*([^\]]+?)\s*\]/);
    if (m) {
      const lo = evalNumeric(m[1]);
      const hi = evalNumeric(m[2]);
      if (lo !== null && hi !== null) out.len.__node = { min: lo, max: hi };
    }
  }

  const empty =
    !Object.keys(out.len).length &&
    !Object.keys(out.val).length &&
    !Object.keys(out.scalar).length &&
    !out.flags.length;
  return empty ? null : out;
}

/**
 * 取某个参数的长度范围，找不到就用兜底。
 * @param {Constraints|null} cons
 * @param {string} name
 * @param {Bound} fallback
 */
export function lenOf(cons, name, fallback = { min: 0, max: 20 }) {
  const b = cons?.len?.[name] ?? cons?.len?.__node;
  return { min: b?.min ?? fallback.min, max: b?.max ?? fallback.max };
}

/**
 * 取某个参数的元素取值范围，找不到就用兜底。
 * @param {Constraints|null} cons
 * @param {string} name
 * @param {Bound} fallback
 */
export function valOf(cons, name, fallback = { min: -50, max: 50 }) {
  const b = cons?.val?.[name] ?? cons?.val?.__node;
  return { min: b?.min ?? fallback.min, max: b?.max ?? fallback.max };
}
