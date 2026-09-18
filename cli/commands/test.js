import fs from 'node:fs';
import path from 'node:path';
import { resolveProblem, listProblems } from '../lib/paths.js';
import { runCases, runAcm, runLevels } from '../lib/runner.js';
import { recordRun } from '../lib/db.js';
import { c, preview, prompt } from '../lib/term.js';

/**
 * algo test [题号] [--level 1|2|3] [--acm] [--case 2,3] [--timeout 5000] [--yes]
 *
 * 分级自测：
 *   L1 官方样例——写完第一遍跑这个
 *   L2 + 边界用例——空/单元素/全同/极值，按题面约束生成
 *   L3 + 随机对拍 + 性能门槛——需要 tests/brute.js 才能真判对错
 */
export async function cmdTest(args) {
  const meta = mustResolve(args._[0]);
  const casePath = path.join(meta.dir, 'tests', 'cases.json');
  const caseFile = JSON.parse(fs.readFileSync(casePath, 'utf8'));

  if (!caseFile.cases.length) {
    console.log(c.yellow('这题没有用例。手动往 tests/cases.json 里加 { input, expected }。'));
    return { ok: false };
  }

  // 期望输出是从题面正则抠出来的，没人工确认过就不能当判题依据
  if (!caseFile.verified && !args.yes) {
    const confirmed = await confirmCases(caseFile, casePath);
    if (!confirmed) {
      console.log(c.yellow('\n没确认，先跑一遍看实际结果。改完 cases.json 再来。\n'));
    }
  }

  const level = clampLevel(args.level);
  const timeoutMs = Number(args.timeout ?? (level >= 3 ? 10000 : 5000));

  // ACM 模式和分级是两条正交的路径：ACM 验证的是你自己写的 I/O 解析，只跑官方样例
  if (args.acm) {
    const started = performance.now();
    const { results } = await runAcm(meta, caseFile);
    const totalMs = performance.now() - started;
    printResults(meta, results, { acm: true, totalMs });
    return summarize(meta, [{ stage: 'ACM 官方样例', results, oracle: '力扣题面' }], { level, totalMs });
  }

  if (level === 1 && args.case) {
    const only = String(args.case)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter(Boolean);
    const started = performance.now();
    const { results } = await runCases(meta, caseFile, { timeoutMs, only });
    const totalMs = performance.now() - started;
    printResults(meta, results, { acm: false, totalMs });
    return summarize(meta, [{ stage: '官方样例', results, oracle: '力扣题面' }], { level, totalMs });
  }

  const started = performance.now();
  const { stages } = await runLevels(meta, caseFile, {
    level,
    timeoutMs,
    seed: args.seed ? Number(args.seed) : undefined,
    randomCount: args.count ? Number(args.count) : undefined,
  });
  const totalMs = performance.now() - started;

  printStages(meta, stages, { level, totalMs });
  return summarize(meta, stages, { level, totalMs });
}

function clampLevel(raw) {
  const n = Number(raw ?? 1);
  if (Number.isNaN(n) || n < 1) return 1;
  return Math.min(3, Math.trunc(n));
}

/** 汇总所有阶段，落库并返回结论 */
function summarize(meta, stages, { level = 1, totalMs = 0 } = {}) {
  const all = stages.flatMap((s) => s.results);
  const passed = all.filter((r) => r.ok === true).length;
  const failed = all.filter((r) => r.ok === false);

  recordRun({
    problemId: meta.id,
    // kind 记的是这次跑到哪一档，历史里能看出你是只跑样例还是真上了对拍
    kind: stages.some((s) => s.stage.startsWith('ACM')) ? 'acm' : `L${level}`,
    passed,
    total: all.length,
    ms: totalMs,
    failure: failed.length ? failed.map((r) => r.name).join(', ') : null,
  });

  return { ok: failed.length === 0, passed, total: all.length, stages };
}

export function mustResolve(key) {
  if (!key) {
    // 不给题号就用最近改过 solution.js 的那道题
    const recent = mostRecentlyEdited();
    if (!recent) throw new Error('还没有任何题目。先跑 algo new <题号>。');
    return recent;
  }
  const meta = resolveProblem(key);
  if (!meta) throw new Error(`找不到题目 ${key}。先跑 algo new ${key}。`);
  return meta;
}

function mostRecentlyEdited() {
  let best = null;
  let bestMtime = 0;
  for (const m of listProblems()) {
    const f = path.join(m.dir, 'solution.js');
    if (!fs.existsSync(f)) continue;
    const mt = fs.statSync(f).mtimeMs;
    if (mt > bestMtime) {
      bestMtime = mt;
      best = m;
    }
  }
  return best;
}

async function confirmCases(caseFile, casePath) {
  console.log('');
  console.log(c.yellow('首次判题：下面的期望输出是从题面「输出：」行抓的，请核对一次。'));
  console.log('');
  for (const [i, x] of caseFile.cases.entries()) {
    console.log(`  ${c.bold(`#${i + 1}`)} 输入 ${c.gray(preview(x.input, 100))}`);
    console.log(
      `     期望 ${x.expected === null ? c.red('（没抓到，判题会跳过）') : c.cyan(preview(x.expected, 100))}` +
        (x.expectedRaw && String(x.expected) !== x.expectedRaw
          ? c.gray(`   ← 原文「${x.expectedRaw}」`)
          : ''),
    );
  }
  console.log('');
  const ans = await prompt(`${c.bold('都对吗？')} [y/N] `);
  if (ans.toLowerCase() === 'y') {
    caseFile.verified = true;
    fs.writeFileSync(casePath, JSON.stringify(caseFile, null, 2) + '\n');
    console.log(c.green('已标记为已确认，之后不再问。\n'));
    return true;
  }
  return false;
}

function printResults(meta, results, { acm, totalMs }) {
  console.log('');
  console.log(
    `${c.bold(`${meta.id}. ${meta.title}`)} ${c.gray(acm ? '[ACM 模式]' : '[函数模式]')}`,
  );
  console.log('');

  for (const r of results) {
    const ms = c.gray(`${r.ms.toFixed(1)}ms`);
    if (r.ok === true) {
      console.log(`  ${c.green('✓')} ${r.name} ${ms}`);
      continue;
    }
    if (r.ok === null) {
      console.log(`  ${c.yellow('?')} ${r.name} ${ms} ${c.gray(r.reason)}`);
      console.log(`     实际 ${c.cyan(preview(r.actual))}`);
      continue;
    }
    console.log(`  ${c.red('✗')} ${r.name} ${ms}`);
    console.log(`     输入 ${c.gray(preview(r.input))}`);
    if (r.error) {
      console.log(`     ${c.red('抛错')} ${r.error}`);
      if (r.stack) {
        const frame = r.stack.split('\n').find((l) => l.includes('solution.js'));
        if (frame) console.log(c.gray(`     ${frame.trim()}`));
      }
    } else {
      console.log(`     期望 ${c.green(preview(r.expected))}`);
      console.log(`     实际 ${c.red(preview(r.actual))}`);
      if (r.reason) console.log(c.gray(`     ${r.reason}`));
    }
  }

  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log('');
  const summary = [
    `${passed}/${results.length} 通过`,
    failed ? c.red(`${failed} 失败`) : null,
    skipped ? c.yellow(`${skipped} 无期望值`) : null,
    c.gray(`${totalMs.toFixed(0)}ms`),
  ]
    .filter(Boolean)
    .join('  ');
  console.log(`  ${failed === 0 && skipped === 0 ? c.green(summary) : summary}`);
  if (failed === 0 && skipped === 0) {
    console.log(c.gray(`  可以去力扣提交了，回来跑 algo submit ${meta.id}`));
  }
  console.log('');
}

const LEVEL_LABEL = {
  1: 'L1 官方样例',
  2: 'L2 官方 + 边界',
  3: 'L3 官方 + 边界 + 随机对拍 + 性能',
};

/**
 * 分级输出：每个阶段单独小结，失败只展开前几条——
 * 随机对拍失败 20 条时全打出来没人看，看第一条就够定位。
 */
function printStages(meta, stages, { level, totalMs }) {
  console.log('');
  console.log(`${c.bold(`${meta.id}. ${meta.title}`)} ${c.gray(LEVEL_LABEL[level])}`);

  let anyFailed = false;
  let missingOracle = false;

  for (const st of stages) {
    const pass = st.results.filter((r) => r.ok === true).length;
    const fail = st.results.filter((r) => r.ok === false);
    const skip = st.results.filter((r) => r.ok === null);
    if (fail.length) anyFailed = true;
    if (st.oracle === null) missingOracle = true;

    const badge = fail.length ? c.red('✗') : skip.length ? c.yellow('?') : c.green('✓');
    const counts = [
      `${pass}/${st.results.length}`,
      fail.length ? c.red(`${fail.length} 失败`) : null,
      skip.length ? c.yellow(`${skip.length} 未判定`) : null,
    ]
      .filter(Boolean)
      .join(' ');

    console.log('');
    console.log(`  ${badge} ${c.bold(st.stage)}  ${counts}  ${c.gray(st.oracle ?? '缺 oracle')}`);

    // 失败详情最多展开 3 条，其余只报名字
    for (const r of fail.slice(0, 3)) {
      console.log(`     ${c.red('✗')} ${r.name}${r.seed ? c.gray(` seed=${r.seed}`) : ''}`);
      console.log(`       输入 ${c.gray(preview(r.input))}`);
      if (r.error) {
        console.log(`       ${c.red('抛错')} ${r.error}`);
      } else {
        if (r.expected !== undefined) console.log(`       期望 ${c.green(preview(r.expected))}`);
        console.log(`       实际 ${c.red(preview(r.actual))}`);
      }
      if (r.reason) console.log(c.gray(`       ${r.reason}`));
    }
    if (fail.length > 3) {
      console.log(c.gray(`     还有 ${fail.length - 3} 条失败：${fail.slice(3).map((r) => r.name).join('、')}`));
    }
    // 性能阶段即便通过也要报耗时——那是这阶段唯一的信息量
    if (st.stage === '性能门槛' && !fail.length) {
      const r = st.results[0];
      console.log(`     ${c.green('✓')} ${r.name} ${c.cyan(`${r.ms.toFixed(0)}ms`)}`);
    }
  }

  console.log('');
  if (anyFailed) {
    console.log(`  ${c.red('有失败')} ${c.gray(`${totalMs.toFixed(0)}ms`)}`);
  } else if (missingOracle) {
    // 不能说「全过」——没有 oracle 的阶段一条都没判过对错
    console.log(`  ${c.yellow('没崩，但边界/随机用例未判定对错')} ${c.gray(`${totalMs.toFixed(0)}ms`)}`);
    console.log(c.gray('  写 tests/brute.js 的暴力解才能真对拍；或写 tests/invariant.js 断言性质。'));
  } else {
    console.log(`  ${c.green(`${LEVEL_LABEL[level]} 全过`)} ${c.gray(`${totalMs.toFixed(0)}ms`)}`);
    if (level < 3) {
      console.log(c.gray(`  再严一档：algo test ${meta.id} --level ${level + 1}`));
    } else {
      console.log(c.gray(`  去力扣提交，回来跑 algo submit ${meta.id}`));
    }
  }
  console.log('');
}
