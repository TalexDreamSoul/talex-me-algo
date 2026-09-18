import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db.js';
import { nextMode } from '../lib/srs.js';
import { resolveProblem, todayISO } from '../lib/paths.js';
import { readNotes } from './submit.js';
import { openInCursor } from '../lib/editor.js';
import { c, prompt, promptRating } from '../lib/term.js';

/**
 * algo review [题号] [--mode recall|rewrite|variant]
 *
 * 不给题号就取最早到期的那道。三种模式对应三种动作：
 *   recall  只问你问题，不动代码
 *   rewrite 把 solution.js 备份后清空，限时重写
 *   variant 让你在变式约束下重写（约束来自 README 的相似题 + 常见加强方向）
 */
export async function cmdReview(args) {
  const db = getDb();
  const today = todayISO();

  let meta;
  if (args._[0]) {
    meta = resolveProblem(args._[0]);
    if (!meta) throw new Error(`找不到题目 ${args._[0]}`);
  } else {
    const row = db
      .prepare('SELECT problem_id FROM reviews WHERE due_on <= ? ORDER BY due_on ASC LIMIT 1')
      .get(today);
    if (!row) {
      console.log(c.green('\n  今天没有到期复习。去做新题：algo today\n'));
      return;
    }
    meta = resolveProblem(row.problem_id);
  }

  const review = db.prepare('SELECT * FROM reviews WHERE problem_id = ?').get(meta.id);
  const mode = args.mode ?? nextMode(review);
  const notes = readNotes(meta.dir);

  console.log('');
  console.log(`  ${c.bold(`${meta.id}. ${meta.title}`)} ${c.gray(`· 第 ${(review?.reps ?? 0) + 1} 轮 · ${modeLabel(mode)}`)}`);
  console.log('');

  if (mode === 'recall') {
    await runRecall(meta, notes);
    return;
  }
  if (mode === 'rewrite') {
    await runRewrite(meta, notes, 'rewrite');
    return;
  }
  await runVariant(meta, notes);
}

function modeLabel(mode) {
  return { recall: '秒答', rewrite: '重写', variant: '变式' }[mode] ?? mode;
}

/** 秒答：只考索引，不写代码 */
async function runRecall(meta, notes) {
  const questions = [
    '这题用的是哪个模板/套路？',
    '时间和空间复杂度分别是多少？',
    '最容易写错的那一步是什么？',
  ];
  const answers = [];
  for (const q of questions) {
    answers.push(await prompt(`  ${c.cyan('Q')} ${q}\n    `));
  }

  console.log('');
  console.log(c.gray('  ── 你当时写的 ──'));
  console.log(`    模板    ${notes.pattern || c.red('（没写）')}`);
  console.log(`    复杂度  ${notes.complexity || c.red('（没写）')}`);
  console.log(`    坑      ${fmtPitfalls(notes.pitfalls)}`);
  console.log('');

  const self = await promptRating(`  ${c.bold('对上了吗？')} [0-5] `);
  finish(meta, 'recall', self, { answers });
}

/** 重写：备份当前解法，清空文件，限时重写 */
async function runRewrite(meta, notes, mode) {
  const solutionPath = path.join(meta.dir, 'solution.js');
  const current = fs.readFileSync(solutionPath, 'utf8');
  const backup = path.join(meta.dir, 'attempts', `.before-${mode}-${Date.now()}.js`);
  fs.writeFileSync(backup, current);

  const blanked = blankOutBody(current, meta.entry);
  fs.writeFileSync(solutionPath, blanked);

  console.log(`  ${c.yellow('已清空 solution.js')}，原解法备份在 ${c.gray(path.basename(backup))}`);
  console.log(c.gray(`  上次思路：${notes.pattern || '（没写）'}  ${notes.keyInsight || ''}`));
  console.log('');
  console.log(`  重写完跑 ${c.cyan(`algo test ${meta.id}`)}，过了再 ${c.cyan(`algo submit ${meta.id} --mode ${mode}`)}`);
  console.log(`  想看原解法：${c.gray(`diff ${path.relative(process.cwd(), backup)} ${path.relative(process.cwd(), solutionPath)}`)}`);
  console.log('');
  openInCursor(solutionPath, 1);
}

/** 变式：给出加强约束，让你在新约束下重写 */
async function runVariant(meta, notes) {
  const variants = buildVariants(meta);
  const pick = variants[Math.floor(Math.random() * variants.length)];

  const file = path.join(meta.dir, 'VARIANT.md');
  fs.writeFileSync(
    file,
    `# 变式：${meta.id}. ${meta.title}

> 生成于 ${todayISO()}

## 新约束

${pick}

## 要求

1. 不看原解法，在 \`solution.js\` 里按新约束重写。
2. 原来的用例仍然必须过：\`algo test ${meta.id}\`。
3. 如果新约束让原用例不再适用，往 \`tests/cases.json\` 里补用例。

## 原思路（写完再看）

<details><summary>展开</summary>

- 模板：${notes.pattern || '（没写）'}
- 关键点：${notes.keyInsight || '（没写）'}
- 复杂度：${notes.complexity || '（没写）'}

</details>
`,
  );

  console.log(`  ${c.magenta('变式约束')}`);
  console.log(`    ${pick}`);
  console.log('');
  await runRewrite(meta, notes, 'variant');
  openInCursor(file, 1);
}

/**
 * 变式约束池。按题目类型给出真正会改变解法结构的加强方向，
 * 而不是「把变量名改一下」这种假变式。
 */
function buildVariants(meta) {
  const tags = (meta.tags ?? []).map((t) => t.slug ?? t);
  const generic = [
    '把空间复杂度压到 O(1)（不允许额外数组/哈希表）。',
    '输入规模放大到 1e6，原来的解法会超时——找到更优的复杂度。',
    '不允许使用任何内置排序函数。',
    '改成返回所有满足条件的答案，而不是只返回一个。',
    '输入可能非法（空数组、null、越界值），补齐防御并说明你的契约。',
  ];
  const byTag = {
    'two-pointers': ['改用滑动窗口重写一遍，对比两种写法的边界处理差异。'],
    'sliding-window': ['窗口改成「恰好 k 个不同元素」而不是「至多 k 个」，看模板怎么变。'],
    'binary-search': [
      '把解法改成左闭右开区间 [left, right) 写法。',
      '改成求右边界而不是左边界。',
    ],
    'hash-table': ['不允许用 Map/Set，只能用数组做计数。'],
    'linked-list': ['改成递归实现（或者反过来，把递归改成迭代）。'],
    'binary-tree': [
      '把递归解法改成显式栈的迭代版本。',
      '改成「分解问题」思维（或者反过来改成「遍历」思维）重写。',
    ],
    'dynamic-programming': [
      '把二维 dp 压成一维滚动数组。',
      '把自底向上的递推改成带备忘录的递归（或反过来）。',
      '除了最优值，还要还原出取得最优值的那个具体方案。',
    ],
    backtracking: ['加上剪枝，并说明剪枝把搜索空间砍掉了多少。'],
    'breadth-first-search': ['改成双向 BFS。'],
    greedy: ['证明贪心的正确性：说明交换论证为什么成立。'],
    stack: ['改用单调栈重写，或者说明为什么这题用不了单调栈。'],
  };
  const pool = [...generic];
  for (const t of tags) if (byTag[t]) pool.push(...byTag[t]);
  return pool;
}

function fmtPitfalls(p) {
  if (!p || !p.length) return c.red('（没写）');
  return Array.isArray(p) ? p.join('；') : String(p);
}

function finish(meta, mode, quality, extra) {
  if (Number.isNaN(quality) || quality < 0 || quality > 5) {
    console.log(c.yellow('  没给有效评分，这次不计入排期。'));
    return;
  }
  // 复用 submit 的排期逻辑，但不产生代码快照
  import('../lib/srs.js').then(({ schedule }) => {
    const srs = schedule({ problemId: meta.id, difficulty: meta.difficulty, mode, quality });
    console.log('');
    console.log(`  ${c.bold('下次复习')} ${c.cyan(srs.dueOn)} ${c.gray(`(${srs.intervalDay} 天后)`)}`);
    if (quality < 3) {
      console.log(c.red('  没答上来——明天用「重写」模式再来一次。'));
    }
    console.log('');
  });
}

/**
 * 把函数体掏空，保留签名和 JSDoc。这样重写时不用重新查签名。
 */
function blankOutBody(code, entry) {
  const lines = code.split('\n');
  const startIdx = lines.findIndex(
    (l) =>
      l.includes(`var ${entry} =`) ||
      l.includes(`function ${entry}`) ||
      l.includes(`class ${entry}`),
  );
  if (startIdx === -1) return code;

  // 从签名行开始找配平的大括号
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && i > startIdx) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return code;

  const head = lines[startIdx];
  const tail = lines[endIdx];
  return [
    ...lines.slice(0, startIdx),
    head,
    '    // TODO: 重写',
    tail,
    ...lines.slice(endIdx + 1),
  ].join('\n');
}
