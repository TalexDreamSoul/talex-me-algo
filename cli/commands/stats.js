import { getDb } from '../lib/db.js';
import { roadmap, listProblems } from '../lib/paths.js';
import { readNotes } from './submit.js';
import { c, table } from '../lib/term.js';

/**
 * algo stats — 聚合分析：路线进度、分类掌握度、模板覆盖、易错模式、效率趋势
 */
export function cmdStats() {
  const db = getDb();
  const rm = roadmap();
  const local = listProblems();
  const byId = new Map(local.map((m) => [m.id, m]));

  console.log('');
  console.log(c.bold('  路线进度'));
  console.log('');
  const topicRows = rm.topics
    .map((t) => {
      const total = rm.problems.filter((p) => p.topic === t.slug).length;
      if (!total) return null;
      const doneList = rm.problems
        .filter((p) => p.topic === t.slug && byId.has(p.id))
        .map((p) => byId.get(p.id));
      const mastered = doneList.filter((m) => m.status === 'mastered').length;
      const shaky = doneList.filter((m) => m.status === 'shaky').length;
      return {
        topic: t.name,
        bar: progressBar(doneList.length, total, mastered),
        n: `${doneList.length}/${total}`,
        mastered: mastered ? c.green(String(mastered)) : c.gray('0'),
        shaky: shaky ? c.yellow(String(shaky)) : c.gray('0'),
      };
    })
    .filter(Boolean);

  console.log(
    table(topicRows, [
      { key: 'topic', label: '分类' },
      { key: 'bar', label: '进度' },
      { key: 'n', label: '已做' },
      { key: 'mastered', label: '掌握' },
      { key: 'shaky', label: '不稳' },
    ]),
  );

  // 模板覆盖：notes.md 的 pattern 字段聚合
  const patterns = new Map();
  const pitfalls = new Map();
  for (const m of local) {
    const n = readNotes(m.dir);
    if (n.pattern) patterns.set(n.pattern, (patterns.get(n.pattern) ?? 0) + 1);
    const ps = Array.isArray(n.pitfalls) ? n.pitfalls : [];
    for (const p of ps) pitfalls.set(p, (pitfalls.get(p) ?? 0) + 1);
  }

  if (patterns.size) {
    console.log('');
    console.log(c.bold('  模板使用频次') + c.gray('  （来自 notes.md 的 pattern 字段）'));
    console.log('');
    for (const [k, v] of [...patterns].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(v).padStart(3)}×  ${k}`);
    }
  }

  const repeated = [...pitfalls].filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]);
  if (repeated.length) {
    console.log('');
    console.log(c.bold('  ') + c.red('反复踩的坑') + c.gray('  （出现 ≥2 次）'));
    console.log('');
    for (const [k, v] of repeated) console.log(`    ${c.red(`${v}×`)}  ${k}`);
  }

  // 效率：每题提交前跑了多少次本地判题
  const effort = db
    .prepare(
      `SELECT p.difficulty,
              COUNT(*) n,
              ROUND(AVG(a.local_runs), 1) avg_runs,
              ROUND(AVG(a.self_rating), 2) avg_rating,
              ROUND(AVG(a.duration_min), 0) avg_min
       FROM attempts a JOIN problems p ON p.id = a.problem_id
       WHERE a.mode = 'first'
       GROUP BY p.difficulty`,
    )
    .all();
  if (effort.length) {
    console.log('');
    console.log(c.bold('  首刷效率') + c.gray('  （avg_runs = 提交前平均本地跑了几遍）'));
    console.log('');
    console.log(
      table(
        effort.map((e) => ({
          difficulty: e.difficulty,
          n: e.n,
          avg_runs: e.avg_runs ?? '-',
          avg_rating: e.avg_rating ?? '-',
          avg_min: e.avg_min ?? '-',
        })),
        [
          { key: 'difficulty', label: '难度' },
          { key: 'n', label: '题数' },
          { key: 'avg_runs', label: '平均试错' },
          { key: 'avg_rating', label: '平均自评' },
          { key: 'avg_min', label: '平均分钟' },
        ],
      ),
    );
  }

  // 高频失败信息
  const failures = db
    .prepare(
      `SELECT failure, COUNT(*) n FROM runs
       WHERE failure IS NOT NULL GROUP BY failure ORDER BY n DESC LIMIT 8`,
    )
    .all();
  if (failures.length) {
    console.log('');
    console.log(c.bold('  最常见的本地判题失败'));
    console.log('');
    for (const f of failures) console.log(`    ${String(f.n).padStart(3)}×  ${c.gray(f.failure)}`);
  }

  const dueSoon = db
    .prepare(`SELECT COUNT(*) n FROM reviews WHERE due_on <= date('now', '+7 day')`)
    .get();
  console.log('');
  console.log(
    c.gray(
      `  共建立 ${local.length} 题 / 路线 ${rm.problems.length} 题，未来 7 天 ${dueSoon?.n ?? 0} 道待复习`,
    ),
  );
  console.log('');
}

function progressBar(done, total, mastered, width = 18) {
  const doneCells = Math.round((done / total) * width);
  const masteredCells = Math.round((mastered / total) * width);
  let out = '';
  for (let i = 0; i < width; i++) {
    if (i < masteredCells) out += c.green('█');
    else if (i < doneCells) out += c.cyan('▓');
    else out += c.gray('░');
  }
  return out;
}
