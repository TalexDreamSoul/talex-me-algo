import fs from 'node:fs';
import path from 'node:path';
import { scaffold } from '../lib/scaffold.js';
import { upsertProblem } from '../lib/db.js';
import { c, DIFF_COLOR } from '../lib/term.js';
import { openInCursor } from '../lib/editor.js';

/**
 * algo new <题号|slug> [--topic x] [--force] [--no-open]
 */
export async function cmdNew(args) {
  const key = args._[0];
  if (!key) throw new Error('用法：algo new <题号|slug> [--topic <分类>] [--force]');

  const { dir, meta, created } = await scaffold(key, {
    topic: args.topic,
    force: Boolean(args.force),
  });
  meta.dir = dir;
  upsertProblem(meta);

  const rel = path.relative(process.cwd(), dir);
  const caseFile = JSON.parse(fs.readFileSync(path.join(dir, 'tests', 'cases.json'), 'utf8'));
  const withExpected = caseFile.cases.filter((x) => x.expectedRaw !== null).length;

  console.log('');
  console.log(
    `${c.bold(`${meta.id}. ${meta.title}`)}  ${DIFF_COLOR[meta.difficulty](meta.difficulty)}`,
  );
  console.log(c.gray(`  ${meta.tags.map((t) => t.name).join(' / ')}`));
  console.log(c.gray(`  ${meta.url}`));
  console.log('');
  console.log(`${created ? c.green('已生成') : c.yellow('已存在')}  ${rel}/`);
  console.log(
    c.gray(
      `  样例 ${caseFile.cases.length} 组，其中 ${withExpected} 组抓到了期望输出` +
        `${withExpected < caseFile.cases.length ? c.yellow('（缺的那些首次判题时只展示实际结果）') : ''}`,
    ),
  );
  console.log(
    c.gray(`  比较模式 ${c.cyan(meta.compare.mode)}（不合适就改 meta.json 的 compare.mode）`),
  );
  console.log('');
  console.log(`  ${c.dim('写完跑：')} ${c.cyan(`algo test ${meta.id}`)}`);
  console.log(`  ${c.dim('完成后：')} ${c.cyan(`algo submit ${meta.id}`)}`);
  console.log('');

  if (!args['no-open']) {
    const solutionPath = path.join(dir, 'solution.js');
    const line = findEntryLine(solutionPath, meta.entry);
    openInCursor(solutionPath, line);
  }
  return meta;
}

/** 找到函数体第一行，把光标直接放在你要动手的地方 */
function findEntryLine(file, entry) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const idx = lines.findIndex(
    (l) => l.includes(`var ${entry} =`) || l.includes(`function ${entry}`) || l.includes(`class ${entry}`),
  );
  if (idx === -1) return 1;
  // 光标落在签名的下一行（函数体里）
  return idx + 2;
}
