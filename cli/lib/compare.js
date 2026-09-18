/**
 * 判题比较策略。
 *
 * 为什么要分策略：很多题的正确答案不唯一（全排列的顺序、子集的顺序、浮点误差、
 * 「任意一个合法解」），一律 deepEqual 会造成大量假失败，逼你去改对的代码。
 * 策略写在 meta.json 的 `compare` 字段里，第一次 `algo test` 时可以改。
 */

/** @typedef {'exact'|'unordered'|'unorderedDeep'|'float'|'anyOf'|'set'|'custom'} CompareMode */

const EPS_DEFAULT = 1e-5;

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {{mode?: CompareMode, eps?: number, fn?: (a: unknown, e: unknown, input: unknown[]) => boolean}} [opts]
 * @param {unknown[]} [input]
 * @returns {{ok: boolean, reason?: string}}
 */
export function compare(actual, expected, opts = {}, input = []) {
  const mode = opts.mode ?? 'exact';
  switch (mode) {
    case 'exact':
      return deepEqual(actual, expected)
        ? { ok: true }
        : { ok: false, reason: '值不相等' };

    case 'float':
      return floatEqual(actual, expected, opts.eps ?? EPS_DEFAULT)
        ? { ok: true }
        : { ok: false, reason: `浮点误差超过 ${opts.eps ?? EPS_DEFAULT}` };

    case 'unordered':
      // 一维数组，元素顺序无关（如 twoSum 的下标对）
      return multisetEqual(actual, expected)
        ? { ok: true }
        : { ok: false, reason: '元素集合不一致（已忽略顺序）' };

    case 'unorderedDeep':
      // 二维数组，外层顺序无关、内层顺序有关（如全排列、组合、子集）
      return multisetEqual(
        asArray(actual).map(canonical),
        asArray(expected).map(canonical),
      )
        ? { ok: true }
        : { ok: false, reason: '子数组集合不一致（已忽略外层顺序）' };

    case 'set':
      // 二维数组，内外层顺序都无关（如 nSum 的三元组）
      return multisetEqual(
        asArray(actual).map((row) => canonical(sortDeep(row))),
        asArray(expected).map((row) => canonical(sortDeep(row))),
      )
        ? { ok: true }
        : { ok: false, reason: '解集合不一致（已忽略内外层顺序）' };

    case 'anyOf':
      // expected 是若干合法答案组成的数组，命中任意一个即可
      return asArray(expected).some((cand) => deepEqual(actual, cand))
        ? { ok: true }
        : { ok: false, reason: '不在任何一个合法答案里' };

    case 'custom':
      if (typeof opts.fn !== 'function') {
        return { ok: false, reason: 'compare.mode=custom 但没有提供 checker.js' };
      }
      try {
        const verdict = opts.fn(actual, expected, input);
        if (verdict === true) return { ok: true };
        if (verdict === false) return { ok: false, reason: 'checker 判定不通过' };
        return verdict; // checker 可以直接返回 {ok, reason}
      } catch (err) {
        return { ok: false, reason: `checker 抛错：${err.message}` };
      }

    default:
      return { ok: false, reason: `未知比较模式 ${mode}` };
  }
}

function asArray(v) {
  return Array.isArray(v) ? v : [v];
}

/** 稳定的结构化字符串，用作 multiset 的 key */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(Object.is(v, -0) ? 0 : v);
}

function sortDeep(v) {
  if (!Array.isArray(v)) return v;
  return v.map(sortDeep).sort((a, b) => (canonical(a) < canonical(b) ? -1 : 1));
}

function multisetEqual(a, b) {
  const aa = asArray(a);
  const bb = asArray(b);
  if (aa.length !== bb.length) return false;
  const counts = new Map();
  for (const x of aa) {
    const k = canonical(x);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const x of bb) {
    const k = canonical(x);
    const n = counts.get(k);
    if (!n) return false;
    if (n === 1) counts.delete(k);
    else counts.set(k, n - 1);
  }
  return counts.size === 0;
}

export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function floatEqual(a, b, eps) {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= eps;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => floatEqual(x, b[i], eps));
  }
  return deepEqual(a, b);
}

/**
 * 根据题目返回类型、标签和题面文字猜一个默认比较模式。只是初值，写进 meta.json 后由你自己调。
 *
 * 题面文字是最可靠的信号：返回类型看不出「顺序无关」，但题面会明说
 * 「元素的顺序可能发生改变」「可以按任意顺序返回」——这类题用 exact 会把正确答案判错。
 * @param {string} returnType
 * @param {string[]} tags
 * @param {string} [statement] 题面纯文本
 */
export function guessCompareMode(returnType, tags = [], statement = '') {
  if (returnType === 'double' || returnType === 'double[]') return 'float';

  const isNested = /list<list<|\[\]\[\]/.test(returnType);
  const orderFree =
    /顺序可能发生改变|顺序可以改变|任意顺序|以任何顺序|不考虑.{0,6}顺序|any order|in any order/i.test(
      statement,
    );

  if (isNested && (orderFree || tags.some((t) => ['backtracking', 'combinatorics'].includes(t)))) {
    return 'unorderedDeep';
  }
  if (orderFree) return 'unordered';
  return 'exact';
}
