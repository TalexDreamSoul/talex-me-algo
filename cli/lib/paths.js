import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * 包自身目录。随包分发的**只读资产**（roadmap.json、web-dist）都从这里找，
 * 这样全局安装后 CLI 也认得出自己的家在哪。
 */
export const PKG_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');

/**
 * 用户工作区。problems/ 和 data/algo.db 这种**会写、属于你个人**的东西落在这里。
 *
 * 为什么不能直接用包目录：`npm i -g` 装完，包在 node_modules 里，
 * 往那儿写题目等于往只读的安装目录里塞个人数据，升级一次全没。
 *
 * 解析顺序：
 *   1. $ALGO_HOME —— 显式指定，最优先
 *   2. 包目录自己带 problems/ —— 把工具仓库直接当工作区用（本仓库的开发/自用形态）
 *   3. 从 cwd 向上找带 problems/ 或 .algo 的目录 —— 像 git 找 .git
 *   4. ~/.algo —— 兜底，首次使用时自动建出来
 */
function resolveWorkspace() {
  const explicit = process.env.ALGO_HOME;
  if (explicit) return path.resolve(explicit);

  const looksLikeWorkspace = (dir) =>
    fs.existsSync(path.join(dir, 'problems')) || fs.existsSync(path.join(dir, '.algo'));

  if (looksLikeWorkspace(PKG_ROOT)) return PKG_ROOT;

  let dir = process.cwd();
  for (;;) {
    if (looksLikeWorkspace(dir)) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }

  return path.join(os.homedir(), '.algo');
}

/**
 * 路径统一走一次 realpath。
 *
 * macOS 上 /tmp、/var 都是软链，工作区落在那种地方时，
 * 「/tmp/ws」和「/private/tmp/ws」会被 git 当成两个不同的仓库而拒绝操作。
 */
function realpath(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir; // 目录还没建出来（比如兜底的 ~/.algo），保持原样
  }
}

export const ROOT = realpath(resolveWorkspace());
export const DATA_DIR = path.join(ROOT, 'data');
export const PROBLEMS_DIR = path.join(ROOT, 'problems');
export const ROADMAP_FILE = path.join(PKG_ROOT, 'data', 'roadmap.json');
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
