/**
 * 自测输入生成器。
 *
 * 分级自测的三档输入都从这里出：
 *   L1 官方样例（不生成）
 *   L2 边界用例——按类型枚举「最容易写错的那几种形状」，确定性、可复现
 *   L3 随机大样本——用于对拍和性能门槛，种子固定所以失败可复现
 *
 * 所有生成值都受 tests/cases.json 里记录的题面约束限制，落在合法范围内。
 * 约束解析不出来时退化成保守小范围，宁可测得弱，也不造假失败。
 */

import { lenOf, valOf } from './constraints.js';

/** xorshift32：种子固定 -> 序列可复现，失败能原样重跑 */
export function rngFrom(seed) {
  let s = seed >>> 0 || 0x2545f491;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.trunc(v)));

function randInt(rnd, lo, hi) {
  if (hi <= lo) return lo;
  return lo + Math.floor(rnd() * (hi - lo + 1));
}

/**
 * 元素取值范围收窄到可读区间。
 * 题面常写 `-2^31 <= nums[i] <= 2^31-1`，照着生成会得到一屏没法肉眼核对的数字，
 * 而且重复元素概率几乎为 0——恰恰错过「有重复」这个最容易写错的场景。
 */
function readableValRange(bound, spread) {
  const lo = Math.max(bound.min, -spread);
  const hi = Math.min(bound.max, spread);
  return lo <= hi ? { min: lo, max: hi } : { min: bound.min, max: bound.min };
}

/** 数组按 flags 后处理：有序 / 互不相同 */
function applyFlags(arr, flags) {
  let out = arr;
  if (flags.includes('distinct')) out = [...new Set(out)];
  if (flags.includes('sorted')) out = [...out].sort((a, b) => a - b);
  return out;
}

/**
 * 生成一个参数值。
 * @param {string} type 力扣类型名
 * @param {string} name 参数名
 * @param {object} ctx { cons, flags, rnd, size, mode }
 */
function genParam(type, name, ctx) {
  const { cons, flags, rnd, size } = ctx;
  const lenB = lenOf(cons, name, { min: 0, max: 20 });
  const valB = readableValRange(valOf(cons, name, { min: -50, max: 50 }), ctx.spread ?? 50);
  const n = clampInt(size, Math.max(lenB.min, 0), lenB.max);

  switch (type) {
    case 'integer':
    case 'long': {
      const b = cons?.scalar?.[name] ?? { min: 0, max: 100 };
      const lo = Math.max(b.min ?? 0, -(ctx.spread ?? 50));
      const hi = Math.min(b.max ?? 100, ctx.spread ?? 50);
      return randInt(rnd, lo, Math.max(lo, hi));
    }
    case 'double':
      return Math.round(rnd() * 1000) / 100;
    case 'boolean':
      return rnd() < 0.5;
    case 'string': {
      const alpha = flags.includes('binary')
        ? '01'
        : flags.includes('lowercase')
          ? 'abcde'
          : 'abcABC012 ';
      return Array.from({ length: n }, () => alpha[randInt(rnd, 0, alpha.length - 1)]).join('');
    }
    case 'character':
      return 'abc'[randInt(rnd, 0, 2)];
    case 'integer[]':
    case 'long[]': {
      const arr = Array.from({ length: n }, () => randInt(rnd, valB.min, valB.max));
      return applyFlags(arr, flags);
    }
    case 'double[]':
      return Array.from({ length: n }, () => Math.round(rnd() * 1000) / 100);
    case 'string[]': {
      const alpha = flags.includes('lowercase') ? 'abcde' : 'abcAB';
      return Array.from({ length: n }, () =>
        Array.from({ length: randInt(rnd, 1, 4) }, () => alpha[randInt(rnd, 0, alpha.length - 1)]).join(''),
      );
    }
    case 'character[]':
      return Array.from({ length: n }, () => 'abc'[randInt(rnd, 0, 2)]);
    case 'integer[][]': {
      const cols = clampInt(size, 1, 6);
      return Array.from({ length: Math.max(1, Math.min(n, 6)) }, () =>
        Array.from({ length: cols }, () => randInt(rnd, valB.min, valB.max)),
      );
    }
    case 'character[][]': {
      const cols = clampInt(size, 1, 6);
      return Array.from({ length: Math.max(1, Math.min(n, 6)) }, () =>
        Array.from({ length: cols }, () => 'ab.'[randInt(rnd, 0, 2)]),
      );
    }
    case 'ListNode':
    case 'TreeNode':
      // 两者的 wire format 都是数组；TreeNode 允许 null 空位
      return type === 'TreeNode'
        ? randomTreeArray(rnd, n, valB)
        : Array.from({ length: n }, () => randInt(rnd, valB.min, valB.max));
    default:
      return Array.from({ length: n }, () => randInt(rnd, valB.min, valB.max));
  }
}

/** 随机二叉树的层序数组表示，带 null 空位，形状不规则 */
function randomTreeArray(rnd, n, valB) {
  if (n <= 0) return [];
  const out = [randInt(rnd, valB.min, valB.max)];
  let slots = 2;
  while (out.filter((v) => v !== null).length < n && out.length < n * 3) {
    if (slots <= 0) break;
    const put = rnd() < 0.72;
    out.push(put ? randInt(rnd, valB.min, valB.max) : null);
    slots += put ? 1 : -1;
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/**
 * L2 边界用例：按参数类型枚举最容易写错的形状。
 *
 * 不是随机——每一条都对应一类真实 bug：
 *   空 / 单元素     → 循环初值、越界
 *   全同元素         → 去重、快慢指针收缩
 *   已排序 / 逆序    → 依赖顺序的写法
 *   极值             → 溢出、比较符号
 * @returns {{name: string, input: unknown[]}[]}
 */
export function boundaryCases(plan, cons, flags) {
  if (plan.kind === 'design') return [];
  const rnd = rngFrom(0x51ed270b);
  const shapes = [];

  const primary = plan.paramTypes.findIndex((t) => /\[\]$|ListNode|TreeNode|string/.test(t));
  if (primary === -1) return [];

  const name = plan.paramNames[primary];
  const type = plan.paramTypes[primary];
  const lenB = lenOf(cons, name, { min: 0, max: 20 });
  const valB = readableValRange(valOf(cons, name, { min: -50, max: 50 }), 20);

  /** 用给定的主参数值补全其余参数，构成一组完整入参 */
  const withPrimary = (value, size) =>
    plan.paramTypes.map((t, i) =>
      i === primary ? value : genParam(t, plan.paramNames[i], { cons, flags, rnd, size, spread: 10 }),
    );

  const isNumericSeq = /^(?:integer|long)\[\]$/.test(type) || type === 'ListNode' || type === 'TreeNode';

  if (lenB.min <= 0) shapes.push({ name: '空输入', value: type === 'string' ? '' : [], size: 0 });
  if (lenB.min <= 1) {
    shapes.push({
      name: '单元素',
      value: type === 'string' ? 'a' : [valB.min],
      size: 1,
    });
  }

  if (isNumericSeq) {
    const n = clampInt(6, Math.max(lenB.min, 1), lenB.max);
    if (!flags.includes('distinct')) {
      shapes.push({ name: '全部相同', value: Array(n).fill(valB.min), size: n });
      shapes.push({
        name: '相邻重复',
        value: applyFlags([1, 1, 2, 2, 3, 3].map((v) => clampInt(v, valB.min, valB.max)), flags),
        size: 6,
      });
    }
    const asc = Array.from({ length: n }, (_, i) => clampInt(valB.min + i, valB.min, valB.max));
    shapes.push({ name: '严格递增', value: asc, size: n });
    if (!flags.includes('sorted')) {
      shapes.push({ name: '严格递减', value: [...asc].reverse(), size: n });
    }
    shapes.push({
      name: '取值边界',
      value: applyFlags([valB.min, valB.max, 0, valB.max, valB.min].filter((v) => v >= valB.min && v <= valB.max), flags),
      size: 5,
    });
    const maxN = clampInt(Math.min(lenB.max, 12), Math.max(lenB.min, 1), lenB.max);
    shapes.push({
      name: '长度上限附近',
      value: applyFlags(Array.from({ length: maxN }, () => randInt(rnd, valB.min, valB.max)), flags),
      size: maxN,
    });
  }

  if (type === 'string') {
    const alpha = flags.includes('binary') ? '01' : flags.includes('lowercase') ? 'abc' : 'abAB1 ';
    shapes.push({ name: '全同字符', value: alpha[0].repeat(5), size: 5 });
    shapes.push({ name: '无重复字符', value: alpha.slice(0, 4), size: 4 });
    shapes.push({ name: '首尾重复', value: `${alpha[0]}${alpha[1]}${alpha[2]}${alpha[0]}`, size: 4 });
  }

  return shapes
    .filter((s) => (Array.isArray(s.value) ? s.value.length >= lenB.min : true))
    .map((s) => ({ name: `边界·${s.name}`, input: withPrimary(s.value, s.size) }));
}

/**
 * L3 随机用例：规模递增，用于对拍和性能观察。
 * @returns {{name: string, input: unknown[], seed: number}[]}
 */
export function randomCases(plan, cons, flags, { count = 30, seed = 0xc0ffee } = {}) {
  if (plan.kind === 'design') return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = (seed + i * 2654435761) >>> 0;
    const rnd = rngFrom(s);
    // 规模阶梯：前半小（易于肉眼 debug），后半逐步放大
    const size = i < count / 2 ? randInt(rnd, 0, 8) : randInt(rnd, 8, 60);
    out.push({
      name: `随机 #${i + 1}`,
      seed: s,
      input: plan.paramTypes.map((t, idx) =>
        genParam(t, plan.paramNames[idx], { cons, flags, rnd, size, spread: 20 }),
      ),
    });
  }
  return out;
}

/**
 * 性能门槛用的大输入。规模按题面长度上限取，但封顶避免本地跑几分钟。
 */
export function perfCase(plan, cons, flags, { cap = 100000 } = {}) {
  if (plan.kind === 'design') return null;
  const primary = plan.paramTypes.findIndex((t) => /\[\]$|ListNode|TreeNode|string/.test(t));
  if (primary === -1) return null;

  const name = plan.paramNames[primary];
  const lenB = lenOf(cons, name, { min: 0, max: 0 });
  const n = Math.min(lenB.max, cap);
  // 上限太小的题（比如全排列 n<=6）没有性能可言
  if (n < 1000) return null;

  const rnd = rngFrom(0x9e3779b9);
  return {
    name: `性能·n=${n}`,
    n,
    input: plan.paramTypes.map((t, i) =>
      genParam(t, plan.paramNames[i], { cons, flags, rnd, size: n, spread: 1000 }),
    ),
  };
}
