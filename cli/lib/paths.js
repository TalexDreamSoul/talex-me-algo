import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const PROBLEMS_DIR = path.join(ROOT, 'problems');
export const ROADMAP_FILE = path.join(DATA_DIR, 'roadmap.json');
export const DB_FILE = path.join(DATA_DIR, 'algo.db');

let roadmapCache = null;

/** @returns {{topics: {slug:string,name:string}[], chapters: any[], problems: any[]}} */
export function roadmap() {
  if (!roadmapCache) roadmapCache = JSON.parse(fs.readFileSync(ROADMAP_FILE, 'utf8'));
  return roadmapCache;
}

/** @param {string} idOrSlug @returns {any|null} */
export function findRoadmapProblem(idOrSlug) {
  const key = String(idOrSlug).trim().toLowerCase();
  return (
    roadmap().problems.find((p) => p.id === key || p.slug === key) ?? null
  );
}

/** 题目目录：problems/<topic>/<id>-<slug> */
export function problemDir(meta) {
  return path.join(PROBLEMS_DIR, meta.topic, `${meta.id}-${meta.slug}`);
}

/** 扫描磁盘上所有已建立的题目 */
export function listProblems() {
  if (!fs.existsSync(PROBLEMS_DIR)) return [];
  const out = [];
  for (const topic of fs.readdirSync(PROBLEMS_DIR)) {
    const topicDir = path.join(PROBLEMS_DIR, topic);
    if (!fs.statSync(topicDir).isDirectory()) continue;
    for (const entry of fs.readdirSync(topicDir)) {
      const metaFile = path.join(topicDir, entry, 'meta.json');
      if (!fs.existsSync(metaFile)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        meta.dir = path.join(topicDir, entry);
        out.push(meta);
      } catch (err) {
        console.error(`跳过损坏的 meta.json: ${metaFile} (${err.message})`);
      }
    }
  }
  return out.sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * 按 id / slug / 目录名 / 绝对或相对路径定位一道已建立的题目。
 * 支持路径是为了让编辑器任务能直接传 ${fileDirname}——在题目目录下的任意文件里
 * 按快捷键判题，不用先想题号。
 * @param {string} key
 */
export function resolveProblem(key) {
  const raw = String(key).trim();
  const all = listProblems();

  // 路径形式：向上找最近的、含 meta.json 的祖先目录
  if (raw.includes(path.sep)) {
    let dir = path.resolve(raw);
    if (fs.existsSync(dir) && fs.statSync(dir).isFile()) dir = path.dirname(dir);
    while (dir.startsWith(PROBLEMS_DIR)) {
      const hit = all.find((m) => m.dir === dir);
      if (hit) return hit;
      dir = path.dirname(dir);
    }
  }

  const k = raw.toLowerCase();
  return (
    all.find((m) => m.id === k) ??
    all.find((m) => m.slug === k) ??
    all.find((m) => path.basename(m.dir) === k) ??
    null
  );
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
