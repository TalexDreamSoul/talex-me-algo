/**
 * 本地判题执行器。
 *
 * 默认路径：直接 import solution.js 拿到纯函数/类，在本进程里跑（快，栈信息完整）。
 * --acm 路径：spawn 子进程跑 acm.js，喂 stdin 读 stdout（验证你自己写的 I/O 解析）。
 */

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { planFromMeta, decodeArgs, encodeResult } from './codec.js';
import { compare } from './compare.js';
import { boundaryCases, randomCases, perfCase } from './generate.js';

/**
 * 设计题执行：ops[0] 是构造函数名，args[0] 是构造参数。
 * @param {new (...a: any[]) => any} Klass
 * @param {string[]} ops
 * @param {unknown[][]} args
 * @returns {(unknown|null)[]}
 */
export function runDesign(Klass, ops, args) {
  const out = [null];
  const instance = new Klass(...(args[0] ?? []));
  for (let i = 1; i < ops.length; i++) {
    const method = instance[ops[i]];
    if (typeof method !== 'function') {
      throw new Error(`实例上没有方法 ${ops[i]}（已实现：${methodNames(instance).join(', ')}）`);
    }
    const ret = method.apply(instance, args[i] ?? []);
    out.push(ret === undefined ? null : ret);
  }
  return out;
}

function methodNames(instance) {
  const proto = Object.getPrototypeOf(instance);
  return Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
}

/**
 * 跑一道题的全部用例。
 * @param {object} meta 题目 meta.json
 * @param {{cases: any[]}} caseFile tests/cases.json
 * @param {{timeoutMs?: number, only?: number[]}} [opts]
 */
export async function runCases(meta, caseFile, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const solutionPath = path.join(meta.dir, 'solution.js');
  if (!fs.existsSync(solutionPath)) throw new Error(`找不到 ${solutionPath}`);

  // 加 query 参数绕过 ESM module cache，保证每次 test 拿到最新代码
  const mod = await import(`${pathToFileURL(solutionPath).href}?t=${Date.now()}`);
  const plan = planFromMeta(meta.leetcodeMeta, meta.codec ?? {});

  const entry = mod[meta.entry] ?? mod.default;
  if (!entry) {
    throw new Error(
      `solution.js 没有导出 ${meta.entry}。在文件末尾加：export { ${meta.entry} };`,
    );
  }

  const checker = await loadChecker(meta);
  const results = [];
  let pickedCases = caseFile.cases;
  if (opts.only?.length) pickedCases = opts.only.map((i) => caseFile.cases[i - 1]).filter(Boolean);

  for (const [i, c] of pickedCases.entries()) {
    const started = performance.now();
    let actual;
    let error = null;
    try {
      actual = await withTimeout(() => execOne(entry, plan, c.input, meta), timeoutMs);
    } catch (err) {
      error = err;
    }
    const ms = performance.now() - started;

    if (error) {
      results.push({ index: i + 1, name: c.name, ok: false, ms, error: error.message, stack: error.stack, input: c.input, expected: c.expected });
      continue;
    }
    if (c.expected === null && c.expectedRaw === null) {
      results.push({ index: i + 1, name: c.name, ok: null, ms, actual, input: c.input, expected: null, reason: '没有期望输出，只展示实际结果' });
      continue;
    }
    const verdict = compare(actual, c.expected, { ...meta.compare, fn: checker }, c.input);
    results.push({
      index: i + 1,
      name: c.name,
      ok: verdict.ok,
      reason: verdict.reason,
      ms,
      actual,
      expected: c.expected,
      input: c.input,
    });
  }
  return { results, plan };
}

async function loadChecker(meta) {
  if (meta.compare?.mode !== 'custom') return null;
  const p = path.join(meta.dir, 'tests', 'checker.js');
  if (!fs.existsSync(p)) return null;
  const mod = await import(`${pathToFileURL(p).href}?t=${Date.now()}`);
  return mod.check ?? mod.default ?? null;
}

/**
 * 执行单个用例，返回已编码成纯数据的结果。
 */
function execOne(entry, plan, input, meta) {
  if (plan.kind === 'design') {
    const [ops, args] = input;
    return runDesign(entry, ops, args);
  }
  const args = decodeArgs(input, plan.paramTypes);
  const ret = entry(...args);
  if (plan.outputParamIndex !== null) {
    // 原地修改题：真正的答案是被改过的那个入参
    const mutated = encodeResult(args[plan.outputParamIndex], plan.paramTypes[plan.outputParamIndex]);
    return plan.outputSizeFromReturn ? mutated.slice(0, ret) : mutated;
  }
  return encodeResult(ret, plan.returnType);
}

function withTimeout(fn, ms) {
  // 同步解法会阻塞事件循环，超时只能兜住 async 的情况；
  // 死循环由外层 `algo test` 的进程级 watchdog 处理。
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`超时（>${ms}ms），可能是死循环或复杂度爆炸`)), ms),
    ),
  ]);
}

/**
 * ACM 模式：spawn 子进程跑 acm.js。
 * @param {object} meta
 * @param {{cases: any[]}} caseFile
 */
export async function runAcm(meta, caseFile) {
  const acmPath = path.join(meta.dir, 'acm.js');
  if (!fs.existsSync(acmPath)) throw new Error(`找不到 ${acmPath}`);
  const plan = planFromMeta(meta.leetcodeMeta, meta.codec ?? {});
  const results = [];

  for (const [i, c] of caseFile.cases.entries()) {
    const stdin = c.input.map((v) => JSON.stringify(v)).join('\n') + '\n';
    const started = performance.now();
    const proc = Bun.spawn(['bun', acmPath], {
      stdin: new TextEncoder().encode(stdin),
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: meta.dir,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const ms = performance.now() - started;

    if (code !== 0) {
      results.push({ index: i + 1, name: c.name, ok: false, ms, error: stderr.trim() || `退出码 ${code}`, input: c.input, expected: c.expected });
      continue;
    }
    let actual;
    try {
      actual = JSON.parse(stdout.trim().split('\n').pop() ?? 'null');
    } catch {
      actual = stdout.trim();
    }
    const verdict = compare(actual, c.expected, meta.compare ?? {}, c.input);
    results.push({ index: i + 1, name: c.name, ok: verdict.ok, reason: verdict.reason, ms, actual, expected: c.expected, input: c.input });
  }
  return { results, plan };
}

/**
 * 分级自测。
 *
 * 核心难点：生成的输入没有官方答案，必须自带判定依据，否则就是假测试。
 * 判定来源按优先级：
 *   1. tests/brute.js 的暴力参考解——对拍，最可靠
 *   2. tests/invariant.js 的性质断言——答案不唯一时用（例如「是原数组的一个排列」）
 *   3. 都没有：只报告崩溃/超时，结果标 null 不判对错，并明说缺 oracle
 * 绝不拿你自己的解法当标准答案自我验证。
 *
 * @param {object} meta
 * @param {{cases: any[]}} caseFile
 * @param {{level?: number, timeoutMs?: number, seed?: number, randomCount?: number}} [opts]
 */
export async function runLevels(meta, caseFile, opts = {}) {
  const level = opts.level ?? 1;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const solutionPath = path.join(meta.dir, 'solution.js');
  if (!fs.existsSync(solutionPath)) throw new Error(`找不到 ${solutionPath}`);

  const mod = await import(`${pathToFileURL(solutionPath).href}?t=${Date.now()}`);
  const plan = planFromMeta(meta.leetcodeMeta, meta.codec ?? {});
  const entry = mod[meta.entry] ?? mod.default;
  if (!entry) {
    throw new Error(`solution.js 没有导出 ${meta.entry}。在文件末尾加：export { ${meta.entry} };`);
  }

  const checker = await loadChecker(meta);
  const { fn: brute, stub: bruteStub } = await loadOptional(meta.dir, 'brute.js', meta.entry);
  const { fn: invariant, stub: invStub } = await loadOptional(meta.dir, 'invariant.js', 'check');
  const cons = caseFile.constraints ?? null;
  const flags = cons?.flags ?? [];

  /** 有骨架但没写实现时要说清楚「差什么」，否则容易以为是判题器坏了 */
  const oracleNote =
    !brute && !invariant && (bruteStub || invStub)
      ? `${bruteStub ? 'tests/brute.js' : 'tests/invariant.js'} 还是骨架，没写实现`
      : null;

  /** @type {{stage: string, results: any[], oracle: string, generated?: boolean, oracleNote?: string|null}[]} */
  const stages = [];

  // ── L1：官方样例 ─────────────────────────────────────────
  const l1 = await runCases(meta, caseFile, { timeoutMs });
  stages.push({ stage: '官方样例', results: l1.results, oracle: '力扣题面' });
  if (level < 2) return { stages, plan };

  // ── L2：边界用例 ─────────────────────────────────────────
  const bounds = boundaryCases(plan, cons, flags);
  stages.push({
    stage: '边界用例',
    generated: true,
    oracle: brute ? '对拍 brute.js' : invariant ? '性质断言 invariant.js' : null,
    oracleNote,
    results: await judgeGenerated(entry, plan, meta, bounds, { brute, invariant, checker, timeoutMs }),
  });
  if (level < 3) return { stages, plan };

  // ── L3：随机对拍 + 性能 ──────────────────────────────────
  const randoms = randomCases(plan, cons, flags, {
    count: opts.randomCount ?? 30,
    seed: opts.seed ?? 0xc0ffee,
  });
  stages.push({
    stage: '随机对拍',
    generated: true,
    oracle: brute ? '对拍 brute.js' : invariant ? '性质断言 invariant.js' : null,
    oracleNote,
    results: await judgeGenerated(entry, plan, meta, randoms, { brute, invariant, checker, timeoutMs }),
  });

  const perf = perfCase(plan, cons, flags);
  if (perf) {
    stages.push({
      stage: '性能门槛',
      oracle: `n=${perf.n}，门槛 ${timeoutMs}ms`,
      results: await judgePerf(entry, plan, meta, perf, timeoutMs),
    });
  }
  return { stages, plan };
}

/** 骨架标记：模板里那行注释，写完实现才删 */
const STUB_MARK = /ALGO_BRUTE_NOT_WRITTEN/;

/**
 * 可选的 oracle 模块：不存在、或还停在骨架上，都算「没有 oracle」。
 *
 * 判定必须和 `algo oracle` 认定骨架的口径一致。骨架被当成真 oracle 时，生成用例
 * 全是 ok:null，而 submit 的门禁只看 oracle 是否为 null——会直接放行。
 * 所以读源文件而不是 fn.toString()：Bun 的 toString() 返回转译结果，注释被剥掉、
 * 中文被转成 \uXXXX，拿它做匹配只会得出「骨架是真 oracle」。
 *
 * @returns {Promise<{ fn: Function|null, stub: boolean }>}
 */
async function loadOptional(dir, file, exportName) {
  const p = path.join(dir, 'tests', file);
  if (!fs.existsSync(p)) return { fn: null, stub: false };
  const stub = STUB_MARK.test(fs.readFileSync(p, 'utf8'));
  const mod = await import(`${pathToFileURL(p).href}?t=${Date.now()}`);
  const fn = mod[exportName] ?? mod.default;
  if (typeof fn !== 'function') return { fn: null, stub: false };
  if (fn.__ALGO_STUB__ === true || stub) return { fn: null, stub };
  return { fn, stub: false };
}

/**
 * 判定生成用例。没有 oracle 时只能确认「没崩」，结果标 null 而不是 true——
 * 把「没崩」当成「对了」是自欺。
 */
async function judgeGenerated(entry, plan, meta, cases, { brute, invariant, checker, timeoutMs }) {
  const results = [];
  for (const [i, c] of cases.entries()) {
    const started = performance.now();
    let actual;
    let error = null;
    try {
      actual = await withTimeout(() => execOne(entry, plan, c.input, meta), timeoutMs);
    } catch (err) {
      error = err;
    }
    const ms = performance.now() - started;
    const base = { index: i + 1, name: c.name, ms, input: c.input, seed: c.seed };

    if (error) {
      results.push({ ...base, ok: false, error: error.message, reason: '抛异常或超时' });
      continue;
    }
    if (brute) {
      let expected;
      try {
        expected = execOne(brute, plan, c.input, meta);
      } catch (err) {
        results.push({ ...base, ok: null, actual, reason: `brute.js 自己崩了：${err.message}` });
        continue;
      }
      const verdict = compare(actual, expected, { ...meta.compare, fn: checker }, c.input);
      results.push({ ...base, ok: verdict.ok, reason: verdict.reason, actual, expected });
      continue;
    }
    if (invariant) {
      let verdict;
      try {
        verdict = invariant(actual, structuredClone(c.input));
      } catch (err) {
        results.push({ ...base, ok: false, actual, reason: `invariant.js 抛错：${err.message}` });
        continue;
      }
      const ok = verdict === true || verdict?.ok === true;
      results.push({ ...base, ok, actual, reason: ok ? undefined : (verdict?.reason ?? '不满足性质断言') });
      continue;
    }
    results.push({ ...base, ok: null, actual, reason: '没有 oracle，只验证了不崩溃' });
  }
  return results;
}

/** 性能门槛：只看耗时，不判对错——大输入没有可信答案 */
async function judgePerf(entry, plan, meta, perf, timeoutMs) {
  const started = performance.now();
  try {
    await withTimeout(() => execOne(entry, plan, perf.input, meta), timeoutMs);
  } catch (err) {
    return [
      {
        index: 1,
        name: perf.name,
        ok: false,
        ms: performance.now() - started,
        error: err.message,
        reason: `n=${perf.n} 跑不动，复杂度可能不达标`,
      },
    ];
  }
  const ms = performance.now() - started;
  return [{ index: 1, name: perf.name, ok: true, ms, reason: `n=${perf.n} 在门槛内` }];
}
