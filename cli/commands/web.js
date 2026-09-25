import fs from 'node:fs';
import path from 'node:path';
import { getDb, upsertProblem } from '../lib/db.js';
import { schedule } from '../lib/srs.js';
import { PKG_ROOT, roadmap, listProblems, resolveProblem, todayISO } from '../lib/paths.js';
import { readNotes } from './submit.js';
import { openBrowser, openInCursor } from '../lib/editor.js';
import { c } from '../lib/term.js';

const DIST_DIR = path.join(PKG_ROOT, 'web-dist');

/**
 * algo web [--port 5177] [--no-open]
 * 本地看板。可写：改笔记、标状态、手动排复习、直接在 Cursor 里打开题目。
 */
export async function cmdWeb(args) {
  const port = Number(args.port ?? 5177);

  // 看板是 Vue + TuffEx 应用，必须先有产物。缺了或比源码旧就自动构建一次。
  if (args.build || needsBuild()) {
    console.log(c.gray('  正在构建看板…'));
    const proc = Bun.spawn(['bunx', 'vite', 'build'], { cwd: PKG_ROOT, stdout: 'pipe', stderr: 'pipe' });
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(`看板构建失败：\n${await new Response(proc.stderr).text()}`);
    }
  }

  const server = Bun.serve({
    port,
    idleTimeout: 60,
    fetch: handle,
    error: (err) => new Response(JSON.stringify({ error: err.message }), { status: 500 }),
  });
  const url = `http://localhost:${server.port}/`;
  console.log('');
  console.log(`  ${c.green('看板已启动')} ${c.cyan(url)}`);
  console.log(c.gray('  改前端源码后加 --build 重新构建；Ctrl-C 停止'));
  console.log('');
  if (!args['no-open']) openBrowser(url);
}

/** 产物缺失，或任一前端源码比产物新 */
function needsBuild() {
  const entry = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(entry)) return true;
  // 全局安装的包里只有预构建产物、没有 web/ 源码，这种时候不需要（也没法）重建
  const srcDir = path.join(PKG_ROOT, 'web');
  if (!fs.existsSync(srcDir)) return false;
  const builtAt = fs.statSync(entry).mtimeMs;
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).some((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? walk(full) : fs.statSync(full).mtimeMs > builtAt;
    });
  return walk(srcDir);
}

async function handle(req) {
  const p = new URL(req.url).pathname;
  if (p.startsWith('/api/')) return apiRoute(p, req);
  return staticAsset(p);
}

/** 单页应用：未知路径一律回 index.html */
function staticAsset(p) {
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const target = path.join(DIST_DIR, rel);
  if (target.startsWith(DIST_DIR) && fs.existsSync(target) && fs.statSync(target).isFile()) {
    return new Response(fs.readFileSync(target), {
      headers: { 'content-type': mimeOf(target) },
    });
  }
  const index = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(index)) {
    return new Response('看板还没构建，跑 algo web --build', { status: 503 });
  }
  return new Response(fs.readFileSync(index), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};
const mimeOf = (f) => MIME[path.extname(f)] ?? 'application/octet-stream';

async function apiRoute(p, req) {
  if (p === '/api/overview') return json(overview());
  if (p.startsWith('/api/problem/')) {
    const id = decodeURIComponent(p.slice('/api/problem/'.length));
    if (req.method === 'GET') return json(problemDetail(id));
    if (req.method === 'PATCH') return json(patchProblem(id, await req.json()));
  }
  if (p === '/api/open' && req.method === 'POST') {
    const { id, file: which } = await req.json();
    const meta = resolveProblem(id);
    if (!meta) return json({ error: '找不到题目' }, 404);
    openInCursor(path.join(meta.dir, which ?? 'solution.js'), 1);
    return json({ ok: true });
  }
  return new Response('Not Found', { status: 404 });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function overview() {
  const db = getDb();
  const rm = roadmap();
  const local = listProblems();
  const byId = new Map(local.map((m) => [m.id, m]));
  const today = todayISO();

  const reviews = new Map(
    db.prepare('SELECT * FROM reviews').all().map((r) => [r.problem_id, r]),
  );
  const runStats = new Map(
    db
      .prepare(
        `SELECT problem_id, COUNT(*) runs, SUM(CASE WHEN passed = total THEN 1 ELSE 0 END) green
         FROM runs GROUP BY problem_id`,
      )
      .all()
      .map((r) => [r.problem_id, r]),
  );
  const attempts = new Map(
    db
      .prepare(
        `SELECT problem_id, COUNT(*) n, MAX(submitted_at) last, AVG(self_rating) rating
         FROM attempts GROUP BY problem_id`,
      )
      .all()
      .map((r) => [r.problem_id, r]),
  );

  const problems = rm.problems.map((p) => {
    const m = byId.get(p.id);
    const rv = reviews.get(p.id);
    const notes = m ? readNotes(m.dir) : {};
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      difficulty: p.difficulty,
      topic: p.topic,
      chapters: p.chapters,
      paid: p.paid,
      url: `https://leetcode.cn/problems/${p.slug}/`,
      started: Boolean(m),
      status: m?.status ?? 'new',
      mastery: m?.mastery ?? 0,
      pattern: notes.pattern ?? '',
      dueOn: rv?.due_on ?? null,
      overdue: rv ? rv.due_on <= today : false,
      reps: rv?.reps ?? 0,
      lapses: rv?.lapses ?? 0,
      runs: runStats.get(p.id)?.runs ?? 0,
      attempts: attempts.get(p.id)?.n ?? 0,
      lastDone: attempts.get(p.id)?.last ?? null,
    };
  });

  // 磁盘上有、但不在路线里的题（手动 algo new 进来的）
  for (const m of local) {
    if (problems.some((p) => p.id === m.id)) continue;
    const rv = reviews.get(m.id);
    const notes = readNotes(m.dir);
    problems.push({
      id: m.id,
      slug: m.slug,
      title: m.title,
      difficulty: m.difficulty,
      topic: m.topic,
      chapters: m.chapters ?? [],
      paid: false,
      url: m.url,
      started: true,
      offRoadmap: true,
      status: m.status ?? 'new',
      mastery: m.mastery ?? 0,
      pattern: notes.pattern ?? '',
      dueOn: rv?.due_on ?? null,
      overdue: rv ? rv.due_on <= today : false,
      reps: rv?.reps ?? 0,
      lapses: rv?.lapses ?? 0,
      runs: runStats.get(m.id)?.runs ?? 0,
      attempts: attempts.get(m.id)?.n ?? 0,
      lastDone: null,
    });
  }

  const activity = db
    .prepare(
      `SELECT substr(ran_at, 1, 10) day, COUNT(*) n FROM runs
       WHERE ran_at >= date('now', '-120 day') GROUP BY day`,
    )
    .all();

  const patternCounts = {};
  for (const m of local) {
    const n = readNotes(m.dir);
    if (n.pattern) patternCounts[n.pattern] = (patternCounts[n.pattern] ?? 0) + 1;
  }

  return {
    today,
    topics: rm.topics,
    chapters: rm.chapters,
    problems,
    activity,
    patternCounts,
  };
}

function problemDetail(id) {
  const meta = resolveProblem(id);
  if (!meta) return { error: '这题还没建立本地目录' };
  const db = getDb();
  const readFile = (f) => {
    const p = path.join(meta.dir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  return {
    meta: { ...meta, dir: path.relative(process.cwd(), meta.dir) },
    readme: readFile('README.md'),
    notes: readFile('notes.md'),
    solution: readFile('solution.js'),
    variant: readFile('VARIANT.md'),
    runs: db
      .prepare('SELECT * FROM runs WHERE problem_id = ? ORDER BY id DESC LIMIT 20')
      .all(meta.id),
    attempts: db
      .prepare('SELECT * FROM attempts WHERE problem_id = ? ORDER BY id DESC')
      .all(meta.id),
    review: db.prepare('SELECT * FROM reviews WHERE problem_id = ?').get(meta.id) ?? null,
    snapshots: fs.existsSync(path.join(meta.dir, 'attempts'))
      ? fs
          .readdirSync(path.join(meta.dir, 'attempts'))
          .filter((f) => f.endsWith('.js') && !f.startsWith('.'))
          .sort()
          .reverse()
      : [],
  };
}

/** 看板的写操作：改笔记、标状态、手动排复习 */
function patchProblem(id, body) {
  const meta = resolveProblem(id);
  if (!meta) return { error: '这题还没建立本地目录' };

  if (typeof body.notes === 'string') {
    fs.writeFileSync(path.join(meta.dir, 'notes.md'), body.notes);
  }
  let metaChanged = false;
  if (body.status) {
    meta.status = body.status;
    metaChanged = true;
  }
  if (body.mastery !== undefined) {
    meta.mastery = Number(body.mastery);
    metaChanged = true;
  }
  if (metaChanged) {
    const { dir, ...rest } = meta;
    fs.writeFileSync(path.join(meta.dir, 'meta.json'), JSON.stringify(rest, null, 2) + '\n');
    upsertProblem(meta);
  }
  if (body.reviewInDays !== undefined) {
    const db = getDb();
    const due = new Date();
    due.setDate(due.getDate() + Number(body.reviewInDays));
    const prev = db.prepare('SELECT * FROM reviews WHERE problem_id = ?').get(meta.id);
    db.prepare(
      `INSERT INTO reviews (problem_id, due_on, interval_day, ease, reps, lapses, last_mode, last_done)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(problem_id) DO UPDATE SET due_on = excluded.due_on, interval_day = excluded.interval_day`,
    ).run(
      meta.id,
      due.toISOString().slice(0, 10),
      Number(body.reviewInDays),
      prev?.ease ?? 2.5,
      prev?.reps ?? 0,
      prev?.lapses ?? 0,
      prev?.last_mode ?? null,
      prev?.last_done ?? null,
    );
  }
  if (body.rate !== undefined) {
    schedule({
      problemId: meta.id,
      difficulty: meta.difficulty,
      mode: body.mode ?? 'rewrite',
      quality: Number(body.rate),
    });
  }
  return problemDetail(meta.id);
}
