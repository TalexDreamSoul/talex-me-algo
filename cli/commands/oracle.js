import fs from 'node:fs';
import path from 'node:path';
import { listProblems } from '../lib/paths.js';
import { ensureBruteSkeleton } from '../lib/scaffold.js';
import { mustResolve } from './test.js';
import { c } from '../lib/term.js';

/** 骨架里的标记：runner 见到它就认定「这题没有 oracle」 */
const STUB_MARK = /ALGO_BRUTE_NOT_WRITTEN/;

/**
 * algo oracle [题号|slug …]
 *
 * 补缺失的 tests/brute.js 骨架 —— L2 边界 / L3 随机对拍的唯一判定依据。
 * 不给题号就扫全仓，只补缺的，绝不覆盖已有文件（brute.js 是你的思考过程，不是生成物）。
 *
 * 为什么需要单独一个命令：骨架只在 `algo new` 建目录那一刻写一次，目录已存在的题
 * 再也走不到那条分支。早于这个机制的题目于是永远缺 oracle，而 submit 的门禁要求
 * L2/L3 必须有判定依据——它们会卡在「缺 oracle」出不去，而且光看那句报错不知道该往哪写。
 */
export function cmdOracle(args) {
  const keys = args._ ?? [];
  const targets = keys.length ? keys.map((k) => mustResolve(k)) : listProblems();

  if (!targets.length) throw new Error('还没有任何题目。先跑 algo new <题号>。');

  const created = [];
  const pending = [];
  const done = [];

  for (const meta of targets) {
    if (ensureBruteSkeleton(meta) === 'created') {
      created.push(meta);
      continue;
    }
    const text = fs.readFileSync(path.join(meta.dir, 'tests', 'brute.js'), 'utf8');
    (STUB_MARK.test(text) ? pending : done).push(meta);
  }

  console.log('');
  if (created.length) {
    console.log(`  ${c.green(`补了 ${created.length} 个骨架`)} ${c.gray('tests/brute.js')}`);
    for (const m of created) console.log(`    ${c.cyan(String(m.id).padEnd(4))} ${m.title}`);
  }
  if (pending.length) {
    if (created.length) console.log('');
    console.log(`  ${c.yellow(`${pending.length} 道骨架还没写实现`)}`);
    for (const m of pending) console.log(`    ${c.cyan(String(m.id).padEnd(4))} ${m.title}`);
  }
  if (done.length) {
    if (created.length || pending.length) console.log('');
    console.log(`  ${c.gray(`${done.length} 道已有对拍实现`)}`);
  }
  if (!created.length && !pending.length) {
    console.log(`  ${c.green('全都有对拍实现了')} ${c.gray('没什么要补的')}`);
  }

  if (created.length || pending.length) {
    console.log('');
    console.log(
      c.gray('  骨架不等于答案：带 ALGO_BRUTE_NOT_WRITTEN 标记的 brute.js 判题器仍算「缺 oracle」，'),
    );
    console.log(c.gray('  L2/L3 只会验证不崩。删掉那行 throw、写出「慢但显然正确」的实现，对拍才真判对错。'));
    console.log(c.gray('  答案不唯一的题改写 tests/invariant.js 断言性质。'));
    const next = [...created, ...pending][0];
    console.log('');
    console.log(c.gray(`  下一步：${c.cyan(`algo test ${next.id} --level 2`)}`));
  }
  console.log('');
}
