/**
 * sqlite 持久层：记录每次本地判题、每次「完成」提交、复习排期、以及笔记的结构化标签。
 * meta.json 是每道题的真源（可 git diff、可手改），db 是跨题聚合的索引与历史。
 */

import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DB_FILE, DATA_DIR } from './paths.js';

let db = null;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_FILE, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS problems (
      id          TEXT PRIMARY KEY,
      slug        TEXT NOT NULL,
      title       TEXT NOT NULL,
      difficulty  TEXT NOT NULL,
      topic       TEXT NOT NULL,
      chapters    TEXT NOT NULL DEFAULT '[]',
      tags        TEXT NOT NULL DEFAULT '[]',
      dir         TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'new',
      mastery     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id  TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      ran_at      TEXT NOT NULL,
      kind        TEXT NOT NULL,
      passed      INTEGER NOT NULL,
      total       INTEGER NOT NULL,
      ms          REAL NOT NULL DEFAULT 0,
      failure     TEXT,
      -- 判过对错的条数 / 只验证了没崩的条数。老记录反推不出来，保持 NULL。
      judged      INTEGER,
      unjudged    INTEGER
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id   TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      submitted_at TEXT NOT NULL,
      mode         TEXT NOT NULL DEFAULT 'first',
      duration_min INTEGER,
      self_rating  INTEGER,
      approach     TEXT,
      complexity   TEXT,
      pitfalls     TEXT,
      code_sha     TEXT NOT NULL,
      code_path    TEXT NOT NULL,
      local_runs   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reviews (
      problem_id   TEXT PRIMARY KEY REFERENCES problems(id) ON DELETE CASCADE,
      due_on       TEXT NOT NULL,
      interval_day INTEGER NOT NULL DEFAULT 1,
      ease         REAL NOT NULL DEFAULT 2.5,
      reps         INTEGER NOT NULL DEFAULT 0,
      lapses       INTEGER NOT NULL DEFAULT 0,
      last_mode    TEXT,
      last_done    TEXT
    );
  `);

  // 已有库补列：CREATE TABLE IF NOT EXISTS 不会改老表，而 sqlite 没有
  // ADD COLUMN IF NOT EXISTS，只能查一次 PRAGMA。
  addColumn(d, 'runs', 'judged', 'INTEGER');
  addColumn(d, 'runs', 'unjudged', 'INTEGER');
}

function addColumn(d, table, column, type) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/** 把 meta.json 同步进 db（幂等） */
export function upsertProblem(meta) {
  const d = getDb();
  d.prepare(
    `INSERT INTO problems (id, slug, title, difficulty, topic, chapters, tags, dir, created_at, status, mastery)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       slug = excluded.slug, title = excluded.title, difficulty = excluded.difficulty,
       topic = excluded.topic, chapters = excluded.chapters, tags = excluded.tags,
       dir = excluded.dir, status = excluded.status, mastery = excluded.mastery`,
  ).run(
    meta.id,
    meta.slug,
    meta.title,
    meta.difficulty,
    meta.topic,
    JSON.stringify(meta.chapters ?? []),
    JSON.stringify((meta.tags ?? []).map((t) => t.slug ?? t)),
    path.relative(path.dirname(DATA_DIR), meta.dir ?? ''),
    meta.createdAt,
    meta.status ?? 'new',
    meta.mastery ?? 0,
  );
}

export function recordRun({ problemId, kind, passed, total, ms, failure, judged = null, unjudged = null }) {
  getDb()
    .prepare(
      `INSERT INTO runs (problem_id, ran_at, kind, passed, total, ms, failure, judged, unjudged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(problemId, new Date().toISOString(), kind, passed, total, ms, failure ?? null, judged, unjudged);
}

export function recordAttempt(a) {
  getDb()
    .prepare(
      `INSERT INTO attempts
        (problem_id, submitted_at, mode, duration_min, self_rating, approach, complexity, pitfalls, code_sha, code_path, local_runs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      a.problemId,
      new Date().toISOString(),
      a.mode,
      a.durationMin ?? null,
      a.selfRating ?? null,
      a.approach ?? null,
      a.complexity ?? null,
      a.pitfalls ?? null,
      a.codeSha,
      a.codePath,
      a.localRuns ?? 0,
    );
}

export function getReview(problemId) {
  return getDb().prepare('SELECT * FROM reviews WHERE problem_id = ?').get(problemId) ?? null;
}

export function upsertReview(r) {
  getDb()
    .prepare(
      `INSERT INTO reviews (problem_id, due_on, interval_day, ease, reps, lapses, last_mode, last_done)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(problem_id) DO UPDATE SET
         due_on = excluded.due_on, interval_day = excluded.interval_day, ease = excluded.ease,
         reps = excluded.reps, lapses = excluded.lapses,
         last_mode = excluded.last_mode, last_done = excluded.last_done`,
    )
    .run(
      r.problemId,
      r.dueOn,
      r.intervalDay,
      r.ease,
      r.reps,
      r.lapses,
      r.lastMode ?? null,
      r.lastDone ?? null,
    );
}

export function countRunsSinceLastAttempt(problemId) {
  const d = getDb();
  const last = d
    .prepare('SELECT submitted_at FROM attempts WHERE problem_id = ? ORDER BY id DESC LIMIT 1')
    .get(problemId);
  const sql = last
    ? 'SELECT COUNT(*) n FROM runs WHERE problem_id = ? AND ran_at > ?'
    : 'SELECT COUNT(*) n FROM runs WHERE problem_id = ?';
  const row = last
    ? d.prepare(sql).get(problemId, last.submitted_at)
    : d.prepare(sql).get(problemId);
  return row?.n ?? 0;
}

/** 最近一次 attempt，用来判断这次提交的代码是不是原封不动的重复提交 */
export function lastAttempt(problemId) {
  return (
    getDb()
      .prepare('SELECT * FROM attempts WHERE problem_id = ? ORDER BY id DESC LIMIT 1')
      .get(problemId) ?? null
  );
}
