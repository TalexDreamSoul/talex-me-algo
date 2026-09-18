import { roadmap, listProblems, todayISO } from '../lib/paths.js';
import { getDb } from '../lib/db.js';
import { c, table, DIFF_COLOR } from '../lib/term.js';

/**
 * algo list [--topic x] [--status new|solved|mastered|shaky] [--todo]
 */
export function cmdList(args) {
  const done = new Map(listProblems().map((m) => [m.id, m]));
  const rm = roadmap();
  let rows = rm.problems;

  if (args.topic) rows = rows.filter((p) => p.topic === args.topic);
  if (args.todo) rows = rows.filter((p) => !done.has(p.id));
  if (args.status) rows = rows.filter((p) => (done.get(p.id)?.status ?? 'new') === args.status);
  if (args.paid === false) rows = rows.filter((p) => !p.paid);

  const limit = Number(args.limit ?? 40);
  const shown = rows.slice(0, limit);

  console.log('');
  console.log(
    table(
      shown.map((p) => {
        const local = done.get(p.id);
        return {
          id: p.id,
          status: statusIcon(local?.status, p.paid),
          title: p.title,
          diff: DIFF_COLOR[p.difficulty](p.difficulty),
          topic: c.gray(p.topic),
          mastery: local ? '★'.repeat(local.mastery ?? 0).padEnd(5, '·') : c.gray('·····'),
        };
      }),
      [
        { key: 'status', label: '' },
        { key: 'id', label: '#' },
        { key: 'title', label: '题目' },
        { key: 'diff', label: '难度' },
        { key: 'topic', label: '分类' },
        { key: 'mastery', label: '掌握' },
      ],
    ),
  );
  console.log('');
  console.log(
    c.gray(
      `  显示 ${shown.length}/${rows.length}，路线共 ${rm.problems.length} 题，已建立 ${done.size} 题`,
    ),
  );
  console.log('');
}

function statusIcon(status, paid) {
  if (paid) return c.gray('$');
  switch (status) {
    case 'mastered':
      return c.green('●');
    case 'solved':
      return c.cyan('◐');
    case 'shaky':
      return c.yellow('◔');
    default:
      return c.gray('○');
  }
}

/**
 * algo today — 今天该干啥：到期复习 + 路线上下一道新题
 */
export function cmdToday(args) {
  const db = getDb();
  const today = todayISO();
  const due = db
    .prepare(
      `SELECT r.*, p.title, p.difficulty, p.topic FROM reviews r
       JOIN problems p ON p.id = r.problem_id
       WHERE r.due_on <= ? ORDER BY r.due_on ASC`,
    )
    .all(today);

  const rm = roadmap();
  const local = new Map(listProblems().map((m) => [m.id, m]));
  const nextNew = rm.problems.filter((p) => !local.has(p.id) && !p.paid).slice(0, Number(args.n ?? 3));

  console.log('');
  console.log(c.bold(`  ${today}`));
  console.log('');

  if (due.length) {
    console.log(`  ${c.magenta('复习')} ${c.gray(`${due.length} 道到期`)}`);
    for (const r of due.slice(0, 10)) {
      const overdue = r.due_on < today ? c.red(`（逾期 ${daysBetween(r.due_on, today)} 天）`) : '';
      console.log(
        `    ${r.problem_id}. ${r.title} ${DIFF_COLOR[r.difficulty](r.difficulty)} ${c.gray(`第 ${r.reps} 轮`)} ${overdue}`,
      );
    }
    console.log(c.gray(`    → algo review`));
    console.log('');
  } else {
    console.log(`  ${c.green('没有到期复习')}`);
    console.log('');
  }

  console.log(`  ${c.blue('新题')} ${c.gray('路线上接下来这几道')}`);
  for (const p of nextNew) {
    const chapter = rm.chapters.find((ch) => ch.id === p.chapters[0]);
    console.log(
      `    ${p.id}. ${p.title} ${DIFF_COLOR[p.difficulty](p.difficulty)} ${c.gray(chapter ? `· ${chapter.title}` : '')}`,
    );
  }
  if (nextNew.length) console.log(c.gray(`    → algo new ${nextNew[0].id}`));
  console.log('');
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
